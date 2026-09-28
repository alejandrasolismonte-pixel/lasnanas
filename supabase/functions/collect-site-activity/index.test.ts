import assert from 'node:assert/strict';
import { countryFromHeaders, createHandler, validatePayload } from './index.ts';

const event = {
  event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  visitor_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  visit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  event_type: 'page_view', path: '/pages/voluntariado.html', load_ms: 425
};
const config = { supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'server-only-key', allowedOrigins: new Set(['https://lasnanas.test']) };
const request = (body: unknown = event, overrides: RequestInit = {}) => new Request('https://test.supabase.co/functions/v1/collect-site-activity', {
  method: 'POST', headers: { origin: 'https://lasnanas.test', 'content-type': 'application/json' }, body: JSON.stringify(body), ...overrides
});

Deno.test('collector accepts only known events, public paths and bounded timing without PII', () => {
  assert.equal(validatePayload(event)?.load_ms, 425);
  assert.equal(validatePayload({ ...event, path: '/index.html' })?.path, '/');
  for (const changed of [
    { path: '/pages/coordinacion-voluntariado.html' }, { path: '/?token=private' },
    { visitor_id: 'not-a-uuid' }, { event_type: 'payment_confirmed' }, { load_ms: -1 }, { load_ms: 120001 },
    { email: 'someone@example.test' }, { country_code: 'CL' }, { occurred_at: '2099-01-01' },
    { event_type: 'registration_started', path: '/' }
  ]) assert.equal(validatePayload({ ...event, ...changed }), null);
  assert.equal(validatePayload({ ...event, load_ms: null })?.load_ms, null);
});

Deno.test('countries use request metadata only and unavailable geography stays null', () => {
  assert.equal(countryFromHeaders(new Headers({ 'cf-ipcountry': 'cl' })), 'CL');
  for (const country of ['', 'XX', 'T1', 'Chile']) assert.equal(countryFromHeaders(new Headers({ 'cf-ipcountry': country })), null);
  assert.equal(countryFromHeaders(new Headers({ 'accept-language': 'es-CL' })), null);
});

Deno.test('collector rejects other origins, reads and oversized bodies before any database call', async () => {
  let calls = 0;
  const handler = createHandler(config, () => { calls++; throw new Error('should not call backend'); });
  assert.equal((await handler(request(event, { headers: { origin: 'https://untrusted.test', 'content-type': 'application/json' } }))).status, 403);
  assert.equal((await handler(request(event, { headers: { 'content-type': 'application/json' } }))).status, 403);
  assert.equal((await handler(request(event, { method: 'GET', body: undefined }))).status, 405);
  assert.equal((await handler(request({ ...event, padding: 'x'.repeat(2049) }))).status, 400);
  assert.equal((await handler(request(event, { headers: { origin: 'https://lasnanas.test', 'content-type': 'text/plain' } }))).status, 400);
  const preflight = await handler(request(event, { method: 'OPTIONS', body: undefined }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://lasnanas.test');
  assert.equal(calls, 0);
});

Deno.test('collector writes through service-only RPC and returns no stored data', async () => {
  let outgoing: { url: string; options: RequestInit } | undefined;
  const handler = createHandler(config, ((url, options) => {
    outgoing = { url: String(url), options: options! };
    return Promise.resolve(Response.json(true));
  }) as typeof fetch);
  const response = await handler(request(event, { headers: { origin: 'https://lasnanas.test', 'content-type': 'application/json', 'cf-ipcountry': 'CL' } }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(outgoing?.url, 'https://test.supabase.co/rest/v1/rpc/record_site_activity_event');
  assert.equal(new Headers(outgoing?.options.headers).get('authorization'), 'Bearer server-only-key');
  assert.deepEqual(JSON.parse(String(outgoing?.options.body)), {
    p_event_id: event.event_id, p_visitor_id: event.visitor_id, p_visit_id: event.visit_id,
    p_event_type: event.event_type, p_path: event.path, p_country_code: 'CL', p_load_ms: 425
  });
});

Deno.test('collector hides backend errors and network failure', async () => {
  for (const fetcher of [
    () => Promise.resolve(Response.json({ secret: 'internal DB content' }, { status: 500 })),
    () => Promise.reject(new Error('internal connection details'))
  ]) {
    const result = await createHandler(config, fetcher as typeof fetch)(request());
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'collector_unavailable' });
  }
});
