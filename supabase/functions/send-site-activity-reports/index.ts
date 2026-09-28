/* Reportes privados de actividad. Cola y envío independientes de voluntariado y pagos. */
type JsonObject = Record<string, unknown>;
export type ReportRow = {
  id: string;
  report_date: string;
  milestone: number;
  reached_at: string;
  snapshot_at: string;
  metrics: JsonObject;
  first_attempt_at?: string | null;
  [key: string]: unknown;
};
export type ReportConfig = {
  reportEmail: string;
  senderEmail: string;
  publicSiteUrl: string;
  brevoApiKey: string;
  webhookSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
};
export type Dependencies = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  randomUUID: () => string;
  now: () => number;
};
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,";]+@[^\s@<>,";]+\.[^\s@<>,";]+$/;
const RETRY_WINDOW_MS = 14 * 60 * 1000;
const MAX_BODY_BYTES = 512;
const CHILE = 'America/Santiago';
const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: CHILE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_report_payload');
  return value as JsonObject;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid_report_payload');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error('invalid_report_payload');
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error('invalid_report_payload');
  return result;
}
function preciseTimestamp(value: unknown): bigint {
  const milliseconds = timestamp(value);
  // PostgreSQL incluye microsegundos; Date.parse conserva sólo milisegundos.
  // Mantener la fracción restante evita rechazar cortes válidos cerca de medianoche.
  const fraction = (value as string).match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? '';
  return BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}
function cleanText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
}
function escapeHtml(value: unknown): string {
  return cleanText(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}
function localTime(value: unknown): string {
  return dateFormatter.format(timestamp(value));
}
function publicUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('missing_report_configuration');
  return url.origin;
}
function runtimeConfig(env: Dependencies['env'], webhookSecret: string): ReportConfig {
  const read = (key: string) => env(key)?.trim() ?? '';
  let supabaseSecretKey = '';
  const currentSecretKeys = read('SUPABASE_SECRET_KEYS');
  if (currentSecretKeys) {
    const values = object(JSON.parse(currentSecretKeys));
    if (typeof values.default === 'string') supabaseSecretKey = values.default.trim();
  }
  supabaseSecretKey ||= read('SUPABASE_SERVICE_ROLE_KEY');
  const reportEmail = read('SITE_ACTIVITY_REPORT_EMAIL');
  const senderEmail = read('BREVO_SENDER_EMAIL');
  const brevoApiKey = read('BREVO_API_KEY');
  const supabaseUrl = read('SUPABASE_URL');
  const publicSiteUrl = read('PUBLIC_SITE_URL');
  // Nunca tomar el destinatario de un request ni usar un correo administrativo como fallback.
  if (!EMAIL.test(reportEmail) || !EMAIL.test(senderEmail) || reportEmail.length > 254 ||
      senderEmail.length > 254 || !brevoApiKey || !supabaseSecretKey ||
      supabaseSecretKey.startsWith('sb_publishable_') || !supabaseUrl || !publicSiteUrl) {
    throw new Error('missing_report_configuration');
  }
  return {
    reportEmail, senderEmail, brevoApiKey, webhookSecret, supabaseSecretKey,
    supabaseUrl: publicUrl(supabaseUrl), publicSiteUrl: publicUrl(publicSiteUrl),
  };
}
async function secretsMatch(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}
async function validCronBody(request: Request): Promise<boolean> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return false; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) return true;
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return false;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return Object.keys(object(JSON.parse(new TextDecoder().decode(bytes)))).length === 0; }
  catch (_) { return false; }
}
export function buildReportMessage(report: ReportRow, config: ReportConfig) {
  const isTest = report.report_type === 'test';
  if (!UUID.test(report.id) || !/^\d{4}-\d{2}-\d{2}$/.test(report.report_date) ||
      !Number.isSafeInteger(report.milestone) || (isTest ? report.milestone !== 0
        : report.milestone < 100 || report.milestone % 100 !== 0)) {
    throw new Error('invalid_report_payload');
  }
  const metrics = object(report.metrics), visits = object(metrics.visits), period = object(metrics.period);
  const today = count(visits.today), last7 = count(visits.last7), last30 = count(visits.last30);
  if (today < report.milestone || preciseTimestamp(period.starts_at) >= preciseTimestamp(period.ends_at) ||
      preciseTimestamp(report.reached_at) > preciseTimestamp(report.snapshot_at)) throw new Error('invalid_report_payload');
  const unique = count(metrics.unique_visitors), newlySeen = count(metrics.new_visitors), returning = count(metrics.returning_visitors);
  if (newlySeen + returning !== unique) throw new Error('invalid_report_payload');
  const lists = (value: unknown, kind: 'country' | 'page'): string[] => {
    if (!Array.isArray(value) || value.length > 5) throw new Error('invalid_report_payload');
    return value.map(item => {
      const row = object(item);
      const label = kind === 'country' ? (row.country_code ?? 'Sin determinar') : row.path;
      if (typeof label !== 'string') throw new Error('invalid_report_payload');
      return cleanText(label) + ': ' + count(kind === 'country' ? row.visits : row.views);
    });
  };
  const countries = lists(metrics.top_countries, 'country'), pages = lists(metrics.top_pages, 'page');
  const performance = object(metrics.performance), samples = count(performance.samples);
  let speed = 'Sin muestras de carga';
  if (samples > 0) {
    if (typeof performance.avg_load_ms !== 'number' || !Number.isFinite(performance.avg_load_ms) ||
        performance.avg_load_ms < 0 || performance.avg_load_ms > 120000) throw new Error('invalid_report_payload');
    speed = Math.round(performance.avg_load_ms) + ' ms de carga media (' + samples + ' muestras)';
  }
  let health = 'Sin comprobación disponible';
  if (metrics.health != null) {
    const check = object(metrics.health);
    if (typeof check.online !== 'boolean') throw new Error('invalid_report_payload');
    health = (check.online ? 'Online' : 'Offline') + ' · comprobación puntual: ' + localTime(check.checked_at);
    if (check.latency_ms != null) {
      if (typeof check.latency_ms !== 'number' || !Number.isFinite(check.latency_ms) ||
          check.latency_ms < 0 || check.latency_ms > 120000) throw new Error('invalid_report_payload');
      health += ' · ' + Math.round(check.latency_ms) + ' ms';
    }
  }
  const [year, month, day] = report.report_date.split('-');
  const labelDate = day + '-' + month + '-' + year;
  const dashboardUrl = new URL('/pages/coordinacion-voluntariado.html?view=activity', publicUrl(config.publicSiteUrl)).href;
  const rows: [string, string][] = [
    ['Visitas registradas hoy', String(today)],
    ['Visitas en 7 días / 30 días', last7 + ' / ' + last30],
    ['Visitantes únicos', String(unique)],
    ['Nuevos / recurrentes', newlySeen + ' / ' + returning],
    ['Visitas a Voluntariado', String(count(metrics.volunteer_visits))],
    ['Registros iniciados', String(count(metrics.registration_starts))],
    ['Solicitudes enviadas', String(count(metrics.applications_submitted))],
    ['Países principales', countries.join(' · ') || 'Sin visitas registradas'],
    ['Páginas más visitadas', pages.join(' · ') || 'Sin visitas registradas'],
    ['Estado del sitio', health],
    ['Rendimiento', speed],
    ['Última actualización del snapshot', localTime(metrics.updated_at)],
  ];
  let coverage = 'La captura cuenta sesiones de navegador; visitantes únicos es una métrica aparte.';
  if (metrics.tracking_started_at == null) {
    coverage += ' Aún no hay datos de captura suficientes para confirmar todo el tráfico.';
  } else if (preciseTimestamp(metrics.tracking_started_at) > preciseTimestamp(period.starts_at)) {
    coverage += ' Cobertura parcial: medición disponible desde ' + localTime(metrics.tracking_started_at) + '.';
  }
  const heading = isTest ? 'Las Ñañas · prueba con datos reales' : 'Las Ñañas · ' + report.milestone + ' visitas alcanzadas';
  const interval = 'Fecha: ' + labelDate + ' · período desde ' + localTime(period.starts_at) + ' hasta ' +
    localTime(period.ends_at) + ', hora de Chile.';
  const explanation = isTest
    ? 'PRUEBA DE ENTREGA · cifras reales del sitio al corte indicado. Los reportes automáticos se envían cada 100 visitas del día.'
    : 'Reporte por cada 100 visitas del día. Estas cifras corresponden al corte indicado; el día continúa.';
  const textContent = [heading, interval, (isTest ? 'Corte de la prueba: ' : 'Umbral alcanzado: ') + localTime(report.reached_at), explanation, '',
    ...rows.map(([label, value]) => label + ': ' + value), '', coverage, 'Dashboard privado: ' + dashboardUrl,
  ].join('\n');
  const htmlContent = '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:24px 12px;background:#edf7f5;font-family:Arial,sans-serif;color:#173d3a">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #d4e8e4;border-radius:16px;overflow:hidden">' +
    '<div style="padding:24px;background:#148b89;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:1px">ACTIVIDAD PRIVADA</p>' +
    '<h1 style="font-family:Georgia,serif;font-size:25px;margin:0">' + escapeHtml(heading) + '</h1></div>' +
    '<div style="padding:24px"><p style="margin:0 0 10px;font-size:13px">' + escapeHtml(interval) + '</p>' +
    '<p style="margin:0 0 20px;font-size:13px;color:#52706c">' + escapeHtml(explanation) + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px" role="presentation">' +
    rows.map(([label, value]) => '<tr><th style="padding:12px 8px;text-align:left;vertical-align:top;font-weight:600;border-bottom:1px solid #e4eeec;width:46%">' +
      escapeHtml(label) + '</th><td style="padding:12px 8px;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #e4eeec">' +
      escapeHtml(value) + '</td></tr>').join('') + '</table>' +
    '<p style="font-size:12px;line-height:1.6;border-left:3px solid #ed8b40;padding-left:12px;color:#52706c">' + escapeHtml(coverage) + '</p>' +
    '<p style="margin:24px 0 0"><a href="' + escapeHtml(dashboardUrl) +
    '" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2c7a5c;color:#fff;text-decoration:none">Abrir dashboard privado</a></p>' +
    '<p style="font-size:12px;color:#52706c">El panel requiere una sesión administradora de Las Ñañas.</p>' +
    '</div></div></body></html>';
  return {
    sender: { email: config.senderEmail, name: 'Las Ñañas' },
    to: [{ email: config.reportEmail }],
    subject: isTest ? 'PRUEBA · Las Ñañas · actividad real · ' + labelDate : 'Las Ñañas · ' + report.milestone + ' visitas · ' + labelDate,
    textContent, htmlContent, headers: { idempotencyKey: report.id },
  };
}
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function handler(request: Request, dependencies: Partial<Dependencies> = {}): Promise<Response> {
  const deps: Dependencies = {
    env: name => Deno.env.get(name), fetch, randomUUID: () => crypto.randomUUID(), now: Date.now, ...dependencies,
  };
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const webhookSecret = (deps.env('SITE_ACTIVITY_REPORT_WEBHOOK_SECRET') || deps.env('NOTIFICATION_WEBHOOK_SECRET'))?.trim();
  if (!webhookSecret) return json({ error: 'report_configuration_unavailable' }, 503);
  const received = request.headers.get('x-notification-secret') || '';
  if (received.length > 512 || !received || !(await secretsMatch(received, webhookSecret))) return json({ error: 'unauthorized' }, 401);
  if (request.headers.has('origin')) return json({ error: 'browser_calls_forbidden' }, 403);
  let config: ReportConfig;
  try { config = runtimeConfig(deps.env, webhookSecret); }
  catch (_) { return json({ error: 'report_configuration_unavailable' }, 503); }
  try { if (!(await validCronBody(request))) return json({ error: 'invalid_request' }, 400); }
  catch (_) { return json({ error: 'invalid_request' }, 400); }
  const rpc = async (name: string, args: JsonObject): Promise<unknown> => {
    const response = await deps.fetch(config.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: {
        'content-type': 'application/json', apikey: config.supabaseSecretKey,
        Authorization: 'Bearer ' + config.supabaseSecretKey,
      }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('report_database_unavailable');
    return response.json();
  };
  const worker = deps.randomUUID();
  let prepared: number, reports: ReportRow[];
  try {
    if (!UUID.test(worker)) throw new Error('invalid_worker');
    prepared = count(await rpc('prepare_site_activity_email_reports', { p_limit: 20 }));
    const claimed = await rpc('claim_site_activity_email_reports', { p_worker: worker, p_limit: 5 });
    if (!Array.isArray(claimed) || claimed.length > 5) throw new Error('invalid_claim');
    reports = claimed as ReportRow[];
  } catch (_) { return json({ error: 'report_database_unavailable' }, 503); }
  let sent = 0, failed = 0, uncertain = 0;
  for (const report of reports) {
    const markFailure = async (code: string, retryable: boolean, ambiguous: boolean): Promise<void> => {
      try {
        const acknowledged = await rpc('mark_site_activity_email_report_failed', {
          p_report_id: report.id, p_worker: worker, p_error_code: code,
          p_retryable: retryable, p_ambiguous: ambiguous,
        });
        if (acknowledged !== true) { uncertain++; return; }
        if (ambiguous || report.delivery_uncertain === true) uncertain++; else failed++;
      } catch (_) { uncertain++; }
    };
    let message: ReturnType<typeof buildReportMessage>;
    try {
      message = buildReportMessage(report, config);
      const attemptStarted = timestamp(report.first_attempt_at);
      const now = deps.now();
      if (!Number.isFinite(now) || now < attemptStarted || now >= attemptStarted + RETRY_WINDOW_MS) {
        await markFailure('delivery_window_expired', false, true);
        continue;
      }
    } catch (_) { await markFailure('invalid_report_payload', false, false); continue; }
    let response: Response, providerResult: JsonObject;
    try {
      response = await deps.fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(message), signal: AbortSignal.timeout(12000),
      });
      try { providerResult = object(await response.json()); }
      catch (_) { providerResult = {}; }
    } catch (_) { await markFailure('provider_network_error', true, true); continue; }
    const duplicate = !response.ok && [400, 409].includes(response.status) &&
      providerResult.code === 'duplicate_parameter' && typeof providerResult.message === 'string' &&
      /idempotenc/i.test(providerResult.message);
    if (!response.ok && !duplicate) {
      const ambiguous = response.status === 408 || response.status >= 500;
      await markFailure('brevo_http_' + response.status, ambiguous || response.status === 429, ambiguous);
      continue;
    }
    const providerId = duplicate ? 'brevo-idempotent' : providerResult.messageId;
    if (typeof providerId !== 'string' || !providerId.trim() || providerId.length > 255 ||
        /[\u0000-\u001f\u007f]/.test(providerId)) {
      await markFailure('provider_acceptance_unconfirmed', true, true);
      continue;
    }
    try {
      const acknowledged = await rpc('mark_site_activity_email_report_sent', {
        p_report_id: report.id, p_worker: worker, p_provider_message_id: providerId,
      });
      if (acknowledged === true) sent++; else uncertain++;
    } catch (_) {
      // Puede haberse aceptado el correo. Conservar lease/UUID para un reintento deduplicado.
      uncertain++;
    }
  }
  return json({ prepared, processed: reports.length, sent, failed, uncertain });
}
if (import.meta.main) Deno.serve(request => handler(request));
