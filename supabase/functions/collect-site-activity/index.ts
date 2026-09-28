/* Ingesta pública de escritura únicamente. Las métricas se leen por RPC privada. */
type ActivityPayload = {
  event_id: string;
  visitor_id: string;
  visit_id: string;
  event_type: 'page_view' | 'registration_started';
  path: string;
  load_ms: number | null;
};
type CollectorConfig = { supabaseUrl: string; serviceRoleKey: string; allowedOrigins: Set<string> };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PATHS = new Set(['/', '/index.html', '/pages/voluntariado.html', '/pages/servicios.html', '/pages/productos.html', '/pages/nanas.html']);
const MAX_BYTES = 2048;

export function validatePayload(value: unknown): ActivityPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const keys = ['event_id', 'visitor_id', 'visit_id', 'event_type', 'path', 'load_ms'];
  if (Object.keys(payload).some(key => !keys.includes(key)) ||
      !['event_id', 'visitor_id', 'visit_id'].every(key => typeof payload[key] === 'string' && UUID.test(payload[key] as string)) ||
      !['page_view', 'registration_started'].includes(payload.event_type as string) ||
      !PATHS.has(payload.path as string) ||
      (payload.event_type === 'registration_started' && payload.path !== '/pages/voluntariado.html') ||
      (payload.load_ms != null && (typeof payload.load_ms !== 'number' || !Number.isFinite(payload.load_ms) || payload.load_ms < 0 || payload.load_ms > 120000))) return null;
  return { ...payload, path: payload.path === '/index.html' ? '/' : payload.path, load_ms: payload.load_ms ?? null } as ActivityPayload;
}

export function countryFromHeaders(headers: Headers): string | null {
  // No se infiere por idioma ni se consulta GeoIP externo. Puede faltar en el runtime.
  const country = headers.get('cf-ipcountry')?.toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
}

export function loadConfig(): CollectorConfig {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const origins = Deno.env.get('SITE_ACTIVITY_ALLOWED_ORIGINS') || Deno.env.get('PUBLIC_SITE_URL') || '';
  const allowedOrigins = new Set(origins.split(',').filter(Boolean).map(value => {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('invalid_origin');
    return url.origin;
  }));
  if (!supabaseUrl || !serviceRoleKey || !allowedOrigins.size) throw new Error('missing_collector_config');
  return { supabaseUrl, serviceRoleKey, allowedOrigins };
}

async function limitedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES || !request.body) throw new Error('invalid_body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error('invalid_body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createHandler(config: CollectorConfig, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) return Response.json({ error: 'forbidden_origin' }, { status: 403 });
    const headers = {
      'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey',
      'Cache-Control': 'no-store'
    };
    const json = (body: unknown, status: number) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'invalid_payload' }, 400);
    let payload: ActivityPayload | null;
    try { payload = validatePayload(await limitedJson(request)); } catch (_) { return json({ error: 'invalid_payload' }, 400); }
    if (!payload) return json({ error: 'invalid_payload' }, 400);
    try {
      const response = await fetcher(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_site_activity_event`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
        body: JSON.stringify({
          p_event_id: payload.event_id, p_visitor_id: payload.visitor_id, p_visit_id: payload.visit_id,
          p_event_type: payload.event_type, p_path: payload.path,
          p_country_code: countryFromHeaders(request.headers),
          p_load_ms: payload.event_type === 'page_view' ? payload.load_ms : null
        }), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return json({ error: 'collector_unavailable' }, 503);
      // Nunca devuelve eventos, UUID, países de otros visitantes ni errores internos de la BD.
      return json({ accepted: true }, 202);
    } catch (_) { return json({ error: 'collector_unavailable' }, 503); }
  };
}

if (import.meta.main) {
  let handler: (request: Request) => Promise<Response>;
  try { handler = createHandler(loadConfig()); }
  catch (_) { handler = () => Promise.resolve(Response.json({ error: 'collector_unavailable' }, { status: 503 })); }
  Deno.serve(handler);
}
