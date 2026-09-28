import assert from 'node:assert/strict';
import { buildReportMessage, handler } from './index.ts';

const NOW = Date.parse('2026-09-28T14:05:00.000Z');
const WORKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_ENV: Record<string, string> = {
  SITE_ACTIVITY_REPORT_WEBHOOK_SECRET: 'webhook-test-only-key',
  SITE_ACTIVITY_REPORT_EMAIL: 'reports@example.test',
  BREVO_API_KEY: 'brevo-test-only-key',
  BREVO_SENDER_EMAIL: 'sender@example.test',
  PUBLIC_SITE_URL: 'https://lasnanas.example.test',
  SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-test-only-key',
};
const CONFIG = {
  reportEmail: BASE_ENV.SITE_ACTIVITY_REPORT_EMAIL,
  senderEmail: BASE_ENV.BREVO_SENDER_EMAIL,
  publicSiteUrl: BASE_ENV.PUBLIC_SITE_URL,
  brevoApiKey: BASE_ENV.BREVO_API_KEY,
  webhookSecret: BASE_ENV.SITE_ACTIVITY_REPORT_WEBHOOK_SECRET,
  supabaseUrl: BASE_ENV.SUPABASE_URL,
  supabaseSecretKey: BASE_ENV.SUPABASE_SERVICE_ROLE_KEY,
};

function report(milestone: 100 | 200 = 100) {
  return {
    id: milestone === 100 ? '11111111-1111-4111-8111-111111111100' : '22222222-2222-4222-8222-222222222200',
    report_date: '2026-09-28', milestone,
    reached_at: '2026-09-28T14:00:00.000Z', snapshot_at: '2026-09-28T14:01:00.000Z',
    status: 'sending', attempts: 1, first_attempt_at: '2026-09-28T14:04:00.000Z',
    metrics: {
      updated_at: '2026-09-28T14:01:00.000Z', timezone: 'America/Santiago',
      period: { days: 1, starts_at: '2026-09-28T03:00:00.000Z', ends_at: '2026-09-28T14:01:00.000Z' },
      visits: { today: milestone, last7: milestone + 25, last30: milestone + 50, selected: milestone },
      unique_visitors: 80, new_visitors: 50, returning_visitors: 30,
      volunteer_visits: 45, registration_starts: 15, applications_submitted: 3,
      top_countries: [{ country_code: 'CL', visits: 65 }],
      top_pages: [{ path: '/pages/voluntariado.html', views: 90 }],
      performance: { avg_load_ms: 1100, samples: 80 },
      health: { checked_at: '2026-09-28T14:00:00.000Z', online: true, latency_ms: 60 },
      tracking_started_at: '2026-09-27T23:00:00.000Z',
    },
  };
}
type TestReport = ReturnType<typeof report>;
type Outgoing = { url: string; headers: Headers; body: Record<string, unknown> };
type MockOptions = {
  reports?: TestReport[];
  env?: Record<string, string | undefined>;
  now?: number;
  prepare?: () => Response | Promise<Response>;
  claim?: () => Response | Promise<Response>;
  smtp?: (call: Outgoing, index: number) => Response | Promise<Response>;
  markSent?: (call: Outgoing, index: number) => Response | Promise<Response>;
  markFailed?: (call: Outgoing) => Response | Promise<Response>;
};

function mock(options: MockOptions = {}) {
  const env = { ...BASE_ENV, ...options.env };
  const rows = options.reports ?? [report()];
  const calls: Outgoing[] = [];
  let smtpCalls = 0, sentCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) };
    calls.push(call);
    const url = new URL(call.url);
    if (url.hostname === 'api.brevo.com') {
      assert.equal(url.pathname, '/v3/smtp/email');
      assert.equal(init?.method, 'POST');
      return options.smtp ? options.smtp(call, ++smtpCalls) : Response.json({ messageId: '<accepted@example.test>' }, { status: 201 });
    }
    assert.equal(url.origin, BASE_ENV.SUPABASE_URL);
    assert.equal(init?.method, 'POST');
    assert.equal(call.headers.get('apikey'), env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_server_test_only');
    const rpc = url.pathname.split('/').pop();
    if (rpc === 'prepare_site_activity_email_reports') return options.prepare ? options.prepare() : Response.json(rows.length);
    if (rpc === 'claim_site_activity_email_reports') return options.claim ? options.claim() : Response.json(rows);
    if (rpc === 'mark_site_activity_email_report_sent') return options.markSent ? options.markSent(call, ++sentCalls) : Response.json(true);
    if (rpc === 'mark_site_activity_email_report_failed') return options.markFailed ? options.markFailed(call) : Response.json(true);
    throw new Error('Unexpected endpoint in test');
  };
  return {
    deps: { env: (name: string) => env[name], fetch: fetcher, randomUUID: () => WORKER, now: () => options.now ?? NOW },
    calls,
    smtp: () => calls.filter(call => new URL(call.url).hostname === 'api.brevo.com'),
    rpc: (name: string) => calls.filter(call => call.url.endsWith(`/rpc/${name}`)),
  };
}

function request(body: unknown = {}, overrides: RequestInit = {}) {
  return new Request('https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/send-site-activity-reports', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-notification-secret': BASE_ENV.SITE_ACTIVITY_REPORT_WEBHOOK_SECRET },
    body: JSON.stringify(body), ...overrides,
  });
}

Deno.test('manual delivery test renders actual sub-threshold metrics and is clearly labeled', () => {
  const base = report();
  const sample = { ...base, report_type: 'test', milestone: 0,
    metrics: { ...base.metrics, visits: { today: 9, selected: 9, last7: 13, last30: 13 } } };
  sample.metrics.unique_visitors = 6;
  sample.metrics.new_visitors = 4;
  sample.metrics.returning_visitors = 2;
  const message = buildReportMessage(sample, CONFIG);
  assert.match(message.subject, /^PRUEBA · Las Ñañas · actividad real/);
  assert.match(message.textContent, /Visitas registradas hoy: 9/);
  assert.match(message.textContent, /Visitantes únicos: 6/);
  assert.match(message.htmlContent, /PRUEBA DE ENTREGA/);
  assert.equal(message.headers.idempotencyKey, sample.id);
  assert.equal(message.to[0].email, 'reports@example.test');
  assert.doesNotMatch(message.subject, /100 visitas|0 visitas/);
  assert.throws(() => buildReportMessage({ ...sample, report_type: 'milestone' }, CONFIG));
  assert.throws(() => buildReportMessage({ ...sample, milestone: 100 }, CONFIG));
});

Deno.test('HTTP callers cannot request a manual test or override its server snapshot', async () => {
  const fixture = mock();
  const response = await handler(request({ action: 'send_test' }), fixture.deps);
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.length, 0);
});

async function privateResult(response: Response) {
  const text = await response.text();
  assert.doesNotMatch(text, /reports@example\.test|sender@example\.test|webhook-test-only-key|brevo-test-only-key|server-test-only-key|unique_visitors|volunteer_visits|reached_at|first_attempt_at|11111111-1111/i);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  return JSON.parse(text);
}

Deno.test('activity mail worker rejects browser JWTs, missing secret, and incorrect secret without calling any provider', async () => {
  const cases: Record<string, string>[] = [
    { 'content-type': 'application/json' },
    { 'content-type': 'application/json', authorization: 'Bearer browser-user-jwt' },
    { 'content-type': 'application/json', 'x-notification-secret': 'incorrect-secret' },
  ];
  for (const headers of cases) {
    const service = mock();
    const response = await handler(request({}, { headers }), service.deps);
    assert.equal(response.status, 401);
    await privateResult(response);
    assert.equal(service.calls.length, 0);
  }
});

Deno.test('activity mail webhook uses its own configured secret and supports the existing secret only as a fallback', async () => {
  const fallback = mock({ reports: [], env: { SITE_ACTIVITY_REPORT_WEBHOOK_SECRET: undefined, NOTIFICATION_WEBHOOK_SECRET: 'fallback-test-secret' } });
  const accepted = await handler(request({}, { headers: { 'content-type': 'application/json', 'x-notification-secret': 'fallback-test-secret' } }), fallback.deps);
  assert.equal(accepted.status, 200);
  await privateResult(accepted);
  const explicit = mock({ env: { NOTIFICATION_WEBHOOK_SECRET: 'fallback-test-secret' } });
  const rejected = await handler(request({}, { headers: { 'content-type': 'application/json', 'x-notification-secret': 'fallback-test-secret' } }), explicit.deps);
  assert.equal(rejected.status, 401);
  assert.equal(explicit.calls.length, 0);
});

Deno.test('browser Origin is rejected even with the correct server-only webhook secret', async () => {
  const service = mock();
  const response = await handler(request({}, { headers: {
    'content-type': 'application/json', 'x-notification-secret': BASE_ENV.SITE_ACTIVITY_REPORT_WEBHOOK_SECRET,
    origin: BASE_ENV.PUBLIC_SITE_URL,
  } }), service.deps);
  assert.equal(response.status, 403);
  await privateResult(response);
  assert.equal(service.calls.length, 0);
});

Deno.test('activity mail worker allows no public methods or recipient and milestone overrides', async () => {
  for (const method of ['GET', 'OPTIONS', 'PUT']) {
    const service = mock();
    const response = await handler(request({}, { method, body: undefined }), service.deps);
    assert.equal(response.status, 405);
    await privateResult(response);
    assert.equal(service.calls.length, 0);
  }
  for (const body of [{ reportEmail: 'other@example.test' }, { recipient: 'other@example.test' }, { milestone: 200 }, { test: true }, [], 'invalid']) {
    const service = mock();
    const response = await handler(request(body), service.deps);
    assert.equal(response.status, 400);
    await privateResult(response);
    assert.equal(service.calls.length, 0);
  }
});

Deno.test('activity mail worker fails closed for incomplete config and never falls back to the administrative recipient', async () => {
  for (const name of Object.keys(BASE_ENV)) {
    const service = mock({ env: { [name]: undefined, ADMIN_NOTIFICATION_EMAIL: 'admin@example.test' } });
    const response = await handler(request(), service.deps);
    assert.equal(response.status, 503, `missing ${name} must disable the worker`);
    await privateResult(response);
    assert.equal(service.calls.length, 0);
  }
  for (const env of [
    { PUBLIC_SITE_URL: 'http://lasnanas.example.test' },
    { PUBLIC_SITE_URL: 'https://user:password@lasnanas.example.test' },
    { SITE_ACTIVITY_REPORT_EMAIL: 'first@example.test,second@example.test' },
  ]) {
    const service = mock({ env });
    const response = await handler(request(), service.deps);
    assert.equal(response.status, 503);
    assert.equal(service.calls.length, 0);
  }
});

Deno.test('activity mail worker accepts empty cron bodies and runtime Supabase secret-key mapping', async () => {
  const service = mock({ reports: [], env: { SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_server_test_only' }) } });
  const response = await handler(request({}, { body: undefined }), service.deps);
  assert.equal(response.status, 200);
  const result = await privateResult(response);
  assert.equal(result.processed, 0);
  assert.equal(service.smtp().length, 0);
});

Deno.test('100 and 200 milestone messages use the exact report destination, stable UUID, and intraday snapshot label', () => {
  for (const milestone of [100, 200] as const) {
    const row = report(milestone);
    const message = buildReportMessage(row, CONFIG);
    assert.deepEqual(message.to, [{ email: 'reports@example.test' }]);
    assert.equal(message.sender.email, 'sender@example.test');
    assert.equal(message.headers.idempotencyKey, row.id);
    assert.match(message.subject, new RegExp(`\\b${milestone}\\b`));
    assert.match(message.subject, /visitas/i);
    assert.match(message.textContent, /parcial|intrad[ií]a|corte|captura.*hasta/i);
    assert.doesNotMatch(message.textContent, /d[ií]a completo|resumen final del d[ií]a/i);
    assert.match(message.textContent, /80/);
    assert.equal('cc' in message || 'bcc' in message, false);
  }
});

Deno.test('activity report HTML escapes snapshot labels instead of interpreting markup', () => {
  const row = report();
  row.metrics.top_pages = [{ path: '<img src=x onerror=alert(1)>', views: 90 }];
  const message = buildReportMessage(row, CONFIG);
  assert.doesNotMatch(message.htmlContent, /<img\b|<script\b|onerror=alert\(1\)>/i);
  assert.match(message.htmlContent, /&lt;img/);
  assert.match(message.textContent, /<img src=x onerror=alert\(1\)>/);
});

Deno.test('valid one-microsecond cutoff at midnight is preserved while reversed microsecond intervals are rejected', () => {
  const base = report();
  const row = { ...base, reached_at: '2026-09-28T03:00:00.000000+00:00', metrics: {
    ...base.metrics, health: null, period: {
      ...base.metrics.period, starts_at: '2026-09-28T03:00:00.000000+00:00', ends_at: '2026-09-28T03:00:00.000001+00:00',
    },
  } };
  assert.equal(Date.parse(row.metrics.period.starts_at), Date.parse(row.metrics.period.ends_at), 'the SQL interval is finer than JavaScript millisecond precision');
  const message = buildReportMessage(row, CONFIG);
  assert.match(message.textContent, /100 visitas alcanzadas/);
  assert.equal(message.headers.idempotencyKey, row.id);
  const reversed = { ...row, metrics: { ...row.metrics, period: {
    ...row.metrics.period, starts_at: row.metrics.period.ends_at, ends_at: row.metrics.period.starts_at,
  } } };
  assert.throws(() => buildReportMessage(reversed, CONFIG), /invalid_report_payload/);
});

Deno.test('claimed 100 and 200 reports each send one email and acknowledge only an accepted provider response', async () => {
  const rows = [report(100), report(200)];
  const service = mock({ reports: rows });
  const response = await handler(request(), service.deps);
  assert.equal(response.status, 200);
  const result = await privateResult(response);
  assert.equal(result.prepared, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.sent, 2);
  assert.deepEqual(service.rpc('prepare_site_activity_email_reports')[0].body, { p_limit: 20 });
  assert.deepEqual(service.rpc('claim_site_activity_email_reports')[0].body, { p_worker: WORKER, p_limit: 5 });
  assert.equal(service.smtp().length, 2);
  assert.deepEqual(service.smtp().map(call => (call.body.headers as Record<string, unknown>).idempotencyKey), rows.map(row => row.id));
  for (const call of service.smtp()) {
    assert.equal(call.headers.get('api-key'), BASE_ENV.BREVO_API_KEY);
    assert.deepEqual(call.body.to, [{ email: BASE_ENV.SITE_ACTIVITY_REPORT_EMAIL }]);
    assert.equal('cc' in call.body || 'bcc' in call.body, false);
  }
  assert.deepEqual(service.rpc('mark_site_activity_email_report_sent').map(call => call.body), rows.map(row => ({
    p_report_id: row.id, p_worker: WORKER, p_provider_message_id: '<accepted@example.test>',
  })));
  assert.equal(service.rpc('mark_site_activity_email_report_failed').length, 0);
});

for (const status of [400, 409]) {
  Deno.test(`provider ${status} explicitly identifies an idempotency duplicate as accepted without a second delivery`, async () => {
    const service = mock({ smtp: () => Response.json({ code: 'duplicate_parameter', message: 'idempotency key has already been used' }, { status }) });
    const response = await handler(request(), service.deps);
    const result = await privateResult(response);
    assert.equal(result.sent, 1);
    assert.equal(service.smtp().length, 1);
    assert.equal(service.rpc('mark_site_activity_email_report_sent').length, 1);
    assert.equal(service.rpc('mark_site_activity_email_report_failed').length, 0);
  });
}

Deno.test('a duplicate_parameter unrelated to idempotency is a permanent provider failure', async () => {
  const service = mock({ smtp: () => Response.json({ code: 'duplicate_parameter', message: 'sender parameter duplicated' }, { status: 400 }) });
  const response = await handler(request(), service.deps);
  const result = await privateResult(response);
  assert.equal(result.sent, 0);
  const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
  assert.equal(failed.p_retryable, false);
  assert.equal(failed.p_ambiguous, false);
  assert.equal(service.rpc('mark_site_activity_email_report_sent').length, 0);
});

for (const scenario of [
  { name: 'rate limit', status: 429, retryable: true, ambiguous: false },
  { name: 'provider server failure', status: 503, retryable: true, ambiguous: true },
  { name: 'invalid provider request', status: 400, retryable: false, ambiguous: false },
  { name: 'invalid provider credentials', status: 401, retryable: false, ambiguous: false },
]) {
  Deno.test(`${scenario.name} marks the queue with the correct safe retry classification`, async () => {
    const service = mock({ smtp: () => Response.json({ message: 'private provider information' }, { status: scenario.status }) });
    const response = await handler(request(), service.deps);
    const result = await privateResult(response);
    assert.equal(result.sent, 0);
    const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
    assert.equal(failed.p_report_id, report().id);
    assert.equal(failed.p_worker, WORKER);
    assert.equal(failed.p_retryable, scenario.retryable);
    assert.equal(failed.p_ambiguous, scenario.ambiguous);
    assert.equal(typeof failed.p_error_code, 'string');
    assert.doesNotMatch(String(failed.p_error_code), /private provider information/);
    assert.equal(service.rpc('mark_site_activity_email_report_sent').length, 0);
  });
}

Deno.test('historical delivery uncertainty remains uncertain after a currently safe or permanent provider rejection', async () => {
  for (const status of [400, 429]) {
    const row = { ...report(), delivery_uncertain: true };
    const service = mock({ reports: [row], smtp: () => Response.json({ code: 'invalid_request', message: 'current attempt was rejected' }, { status }) });
    const result = await privateResult(await handler(request(), service.deps));
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 0, 'a rejected current attempt does not prove an earlier ambiguous attempt was never delivered');
    assert.equal(result.uncertain, 1);
    const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
    assert.equal(failed.p_retryable, status === 429);
    assert.equal(failed.p_ambiguous, false, 'the current provider result remains unambiguous; SQL preserves the earlier uncertainty');
  }
});

for (const name of ['network error', 'timeout']) {
  Deno.test(`${name} after sending is ambiguous and retries only with the same idempotency UUID`, async () => {
    const service = mock({ smtp: () => { throw new DOMException('private connection details', name === 'timeout' ? 'TimeoutError' : 'NetworkError'); } });
    const response = await handler(request(), service.deps);
    const result = await privateResult(response);
    assert.equal(result.sent, 0);
    assert.equal(result.uncertain, 1);
    const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
    assert.equal(failed.p_retryable, true);
    assert.equal(failed.p_ambiguous, true);
    assert.equal((service.smtp()[0].body.headers as Record<string, unknown>).idempotencyKey, report().id);
  });
}

Deno.test('provider success without a messageId stays uncertain instead of reporting delivery', async () => {
  const service = mock({ smtp: () => Response.json({ unexpected: 'response' }, { status: 202 }) });
  const response = await handler(request(), service.deps);
  const result = await privateResult(response);
  assert.equal(result.sent, 0);
  assert.equal(result.uncertain, 1);
  const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
  assert.equal(failed.p_retryable, true);
  assert.equal(failed.p_ambiguous, true);
});

Deno.test('lost queue acknowledgement never claims success and the reclaim uses identical provider idempotency', async () => {
  const first = mock({ markSent: () => Response.json({ details: 'internal queue error' }, { status: 500 }) });
  const firstResponse = await handler(request(), first.deps);
  const firstResult = await privateResult(firstResponse);
  assert.equal(firstResult.sent, 0);
  assert.equal(firstResult.uncertain, 1);
  assert.equal(first.rpc('mark_site_activity_email_report_failed').length, 0, 'an accepted email with a lost acknowledgement must not schedule a new unkeyed delivery');
  const reclaimed = { ...report(), attempts: 2 };
  const retry = mock({ reports: [reclaimed], smtp: () => Response.json({ code: 'duplicate_parameter', message: 'idempotency key already used' }, { status: 400 }) });
  const retryResult = await privateResult(await handler(request(), retry.deps));
  assert.equal(retryResult.sent, 1);
  assert.deepEqual(retry.smtp()[0].body, first.smtp()[0].body, 'a reclaimed report must preserve its destination, snapshot, and UUID');
});

for (const stage of ['prepare', 'claim'] as const) {
  Deno.test(`failed ${stage} stops the worker without attempting SMTP and hides database errors`, async () => {
    const service = mock({ [stage]: () => Response.json({ message: 'internal database details', recipient: 'reports@example.test' }, { status: 500 }) });
    const response = await handler(request(), service.deps);
    assert.equal(response.status, 503);
    await privateResult(response);
    assert.equal(service.smtp().length, 0);
    assert.equal(service.rpc('mark_site_activity_email_report_sent').length, 0);
  });
}

Deno.test('report at the fourteen-minute safety boundary cannot start another provider request', async () => {
  const row = { ...report(), first_attempt_at: new Date(NOW - 14 * 60 * 1000).toISOString() };
  const service = mock({ reports: [row] });
  const result = await privateResult(await handler(request(), service.deps));
  assert.equal(result.sent, 0);
  assert.equal(service.smtp().length, 0);
  const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
  assert.equal(failed.p_retryable, false);
  assert.equal(failed.p_ambiguous, true);
});

Deno.test('report just inside the fourteen-minute window can deliver using its original UUID', async () => {
  const row = { ...report(), first_attempt_at: new Date(NOW - 14 * 60 * 1000 + 1).toISOString() };
  const service = mock({ reports: [row] });
  const result = await privateResult(await handler(request(), service.deps));
  assert.equal(result.sent, 1);
  assert.equal(service.smtp().length, 1);
  assert.equal((service.smtp()[0].body.headers as Record<string, unknown>).idempotencyKey, row.id);
});

Deno.test('each claimed report rechecks the safety window after an earlier SMTP request consumed its remaining time', async () => {
  const started = new Date(NOW - 14 * 60 * 1000 + 500).toISOString();
  const rows = [report(100), report(200)].map(row => ({ ...row, first_attempt_at: started }));
  const options: MockOptions = { reports: rows, now: NOW };
  options.smtp = () => {
    options.now = NOW + 501;
    return Response.json({ messageId: '<accepted@example.test>' }, { status: 201 });
  };
  const service = mock(options);
  const result = await privateResult(await handler(request(), service.deps));
  assert.equal(result.processed, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.uncertain, 1);
  assert.equal(service.smtp().length, 1);
  const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
  assert.equal(failed.p_report_id, rows[1].id);
  assert.equal(failed.p_retryable, false);
  assert.equal(failed.p_ambiguous, true);
});

Deno.test('missing or future first-attempt metadata fails closed before SMTP', async () => {
  for (const first_attempt_at of ['', 'not-a-date', new Date(NOW + 1000).toISOString()]) {
    const service = mock({ reports: [{ ...report(), first_attempt_at }] });
    const result = await privateResult(await handler(request(), service.deps));
    assert.equal(result.sent, 0);
    assert.equal(service.smtp().length, 0);
    assert.equal(service.rpc('mark_site_activity_email_report_failed').length, 1);
  }
});

Deno.test('inconsistent snapshot metrics fail permanently before any provider delivery', async () => {
  const row = report();
  row.metrics.unique_visitors = 81;
  const service = mock({ reports: [row] });
  const result = await privateResult(await handler(request(), service.deps));
  assert.equal(result.sent, 0);
  assert.equal(service.smtp().length, 0);
  const failed = service.rpc('mark_site_activity_email_report_failed')[0].body;
  assert.equal(failed.p_retryable, false);
  assert.equal(failed.p_ambiguous, false);
});
