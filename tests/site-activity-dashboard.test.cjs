const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../js/site-activity-dashboard.js'), 'utf8');
const html = () => readFileSync(resolve(__dirname, '../pages/coordinacion-voluntariado.html'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const metricNames = ['visits-today', 'visits-7', 'visits-30', 'unique', 'new', 'returning', 'volunteer', 'registrations', 'applications'];

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, handler) {
      listeners.set(name, [...(listeners.get(name) || []), handler]);
    },
    dispatch(name, event = {}) {
      return Promise.all((listeners.get(name) || []).map(handler => handler({ preventDefault() {}, ...event })));
    }
  };
}

function element() {
  const classes = new Set();
  let ownText = '';
  return {
    ...eventTarget(), children: [], dataset: {}, style: {}, attributes: {}, hidden: false, disabled: false, value: '',
    get textContent() { return ownText + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { ownText = String(value); this.children = []; },
    set innerHTML(_) { throw new Error('Private rankings must be rendered as text'); },
    classList: {
      toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { ownText = ''; this.children = nodes; },
    click() { return this.dispatch('click'); }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function metrics(days = 7, overrides = {}) {
  return {
    updated_at: '2026-09-27T15:00:00Z', timezone: 'America/Santiago',
    period: { days, starts_at: '2026-09-20T03:00:00Z', ends_at: '2026-09-27T15:00:00Z' },
    visits: { today: 2, last7: 12, last30: 40, selected: days },
    unique_visitors: days + 3, new_visitors: days, returning_visitors: 3,
    volunteer_visits: 5, registration_starts: 2, applications_submitted: 1,
    top_countries: [{ country_code: 'CL', visits: 8 }],
    top_pages: [{ path: '/pages/voluntariado.html', views: 5 }],
    performance: { avg_load_ms: 1200, samples: 4 }, health: null,
    tracking_started_at: '2026-09-26T15:00:00Z', ...overrides
  };
}

function mount({ signedIn = true, authorized = true, authError = null, permissionError = null,
  configured = true, authHandler, metricHandler, summaryHandler, fetchHandler } = {}) {
  const nodes = new Map();
  const select = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const root = select('[data-admin-view="activity"]');
  root.hidden = true;
  root.querySelector = select;
  const periods = [1, 7, 30].map(days => {
    const button = element();
    button.dataset.activityPeriod = String(days);
    return button;
  });
  root.querySelectorAll = selector => {
    if (selector === '[data-activity-period]') return periods;
    throw new Error(`Unexpected dashboard selector: ${selector}`);
  };
  const document = { ...eventTarget(), hidden: false, querySelector: select, createElement: element };
  let user = signedIn ? { id: 'admin-1' } : null;
  let permission = authorized;
  let authCalls = 0;
  const rpcCalls = [], fetchCalls = [], copied = [];
  const client = {
    auth: { getUser: async () => {
      authCalls++;
      const result = { data: { user }, error: authError };
      return authHandler ? authHandler(authCalls, result) : result;
    } },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'is_site_activity_admin') return { data: permission, error: permissionError };
      if (name === 'admin_get_site_activity') return metricHandler ? metricHandler(args) : { data: metrics(args.p_days), error: null };
      if (name === 'admin_record_site_health') return { data: null, error: null };
      if (name === 'generate_daily_site_activity_summary') return summaryHandler ? summaryHandler() : {
        data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Las Ñañas · 26/09/2026\nVisitas: 12\nSolicitudes enviadas: 1' }, error: null
      };
      throw new Error(`Unexpected dashboard RPC: ${name}`);
    },
    from() { throw new Error('Dashboard must use protected RPCs instead of direct table reads'); }
  };
  const fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return fetchHandler ? fetchHandler(url, options) : { ok: true };
  };
  const timeoutHandlers = new Map(), intervalHandlers = new Map();
  let timerId = 0, elapsed = 0;
  const performance = { now() { elapsed += 40; return elapsed; } };
  const window = {
    LasNanasSupabase: { client: configured ? client : null },
    location: { href: 'https://lasnanas.example.test/pages/coordinacion-voluntariado.html' },
    navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
    fetch, performance
  };
  vm.runInNewContext(source, { window, document, Date, Intl, URL, AbortController, fetch, performance,
    setTimeout(handler) { const id = ++timerId; timeoutHandlers.set(id, handler); return id; },
    clearTimeout(id) { timeoutHandlers.delete(id); },
    setInterval(handler) { const id = ++timerId; intervalHandlers.set(id, handler); return id; },
    clearInterval(id) { intervalHandlers.delete(id); }
  });
  return { api: window.LasNanasActivityDashboard, select, periods, document, rpcCalls, fetchCalls, copied,
    timeoutHandlers, intervalHandlers, get authCalls() { return authCalls; },
    setUser(value) { user = value; }, setAuthorized(value) { permission = value; },
    metric(name) { return select(`[data-activity-metric="${name}"]`).textContent; },
    calls(name) { return rpcCalls.filter(call => call.name === name); }
  };
}

test('dashboard section and metric content are initially hidden in administrative HTML', () => {
  assert.match(html(), /<section\b[^>]*data-admin-view="activity"[^>]*\bhidden\b/);
  assert.match(html(), /<div\b[^>]*data-activity-content[^>]*\bhidden\b/);
});

test('module stays private and inert until the administrator panel explicitly opens it', async () => {
  const dashboard = mount();
  await settle();
  assert.equal(dashboard.authCalls, 0);
  assert.equal(dashboard.rpcCalls.length, 0);
  assert.equal(dashboard.fetchCalls.length, 0);
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary]').disabled, true);
  dashboard.api.open();
  await settle();
  assert.equal(dashboard.rpcCalls.length, 0);
  assert.equal(dashboard.fetchCalls.length, 0);
});

for (const [label, options] of Object.entries({
  'missing session': { signedIn: false }, 'invalid authentication': { authError: { message: 'expired' } },
  'missing admin role': { authorized: false }, 'failed role verification': { permissionError: { code: '42501', message: 'denied' } },
  'unconfigured client': { configured: false }
})) {
  test(`${label} cannot query metrics, probe the site, or reveal private content`, async () => {
    const dashboard = mount(options);
    await dashboard.api.open('admin-1');
    assert.equal(dashboard.calls('admin_get_site_activity').length, 0);
    assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 0);
    assert.equal(dashboard.fetchCalls.length, 0);
    assert.equal(dashboard.select('[data-activity-content]').hidden, true);
    assert.ok(metricNames.every(name => dashboard.metric(name) === '—'));
    assert.equal(dashboard.select('[data-activity-health]').textContent, 'Sin comprobar');
  });
}

test('identity changing after panel authorization cannot open metrics under the earlier account', async () => {
  const dashboard = mount();
  dashboard.setUser({ id: 'different-account' });
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.calls('is_site_activity_admin').length, 0);
  assert.equal(dashboard.calls('admin_get_site_activity').length, 0);
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
});

test('authorized dashboard renders metrics and selector requests the exact chosen period', async () => {
  const dashboard = mount();
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.select('[data-activity-content]').hidden, false);
  assert.deepEqual(metricNames.map(name => dashboard.metric(name)), ['2', '12', '40', '10', '7', '3', '5', '2', '1']);
  assert.match(dashboard.select('[data-activity-countries]').textContent, /Chile/);
  assert.match(dashboard.select('[data-activity-pages]').textContent, /voluntariado/);
  assert.match(dashboard.select('[data-activity-performance]').textContent, /1[.,]200 ms/);
  assert.equal(dashboard.select('[data-activity-health]').textContent, 'Online');
  assert.notEqual(dashboard.select('[data-activity-updated]').textContent, 'Sin actualizar');
  assert.equal(dashboard.fetchCalls[0].options.referrerPolicy, 'no-referrer');
  for (const days of [1, 30]) {
    await dashboard.periods.find(button => button.dataset.activityPeriod === String(days)).click();
    await settle();
    assert.equal(dashboard.metric('unique'), String(days + 3));
    assert.equal(dashboard.periods.find(button => button.dataset.activityPeriod === String(days)).attributes['aria-pressed'], 'true');
    assert.ok(dashboard.periods.filter(button => button.dataset.activityPeriod !== String(days)).every(button => button.attributes['aria-pressed'] === 'false'));
  }
  assert.deepEqual(dashboard.calls('admin_get_site_activity').map(call => call.args.p_days), [7, 1, 30]);
  assert.equal(dashboard.calls('is_site_activity_admin').length, 3);
  assert.equal(dashboard.authCalls, 3);
  dashboard.api.close();
  assert.equal(dashboard.intervalHandlers.size, 0);
});

test('failed metric query clears values instead of presenting fabricated zeros or stale data', async () => {
  let failure = false;
  const dashboard = mount({ metricHandler: args => failure ? { data: null, error: { message: 'temporary failure' } } : { data: metrics(args.p_days), error: null } });
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.metric('unique'), '10');
  failure = true;
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  assert.ok(metricNames.every(name => dashboard.metric(name) === '—'));
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.equal(dashboard.select('[data-activity-updated]').textContent, 'Sin actualizar');
  assert.equal(dashboard.select('[data-activity-status]').classList.contains('is-error'), true);
});

test('unavailable numeric data stays unknown and unsafe ranking labels are rendered as text', async () => {
  const dashboard = mount({ metricHandler: args => ({ data: metrics(args.p_days, {
    unique_visitors: null, new_visitors: undefined, performance: { avg_load_ms: null, samples: 0 },
    top_pages: [{ path: '<img src=x onerror=alert(1)>', views: 3 }]
  }), error: null }) });
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.metric('unique'), '—');
  assert.equal(dashboard.metric('new'), '—');
  assert.equal(dashboard.select('[data-activity-performance]').textContent, 'Sin datos');
  assert.match(dashboard.select('[data-activity-pages]').textContent, /<img src=x onerror=alert\(1\)>/);
});

test('late result from an earlier period cannot overwrite the selected period', async () => {
  const earlier = deferred();
  const dashboard = mount({ metricHandler: args => args.p_days === 7 ? earlier.promise : { data: metrics(args.p_days), error: null } });
  const opening = dashboard.api.open('admin-1');
  await settle();
  await dashboard.periods[0].click();
  await settle();
  assert.equal(dashboard.metric('unique'), '4');
  assert.equal(dashboard.select('[data-activity-period-label]').textContent, 'Hoy');
  earlier.resolve({ data: metrics(7, { unique_visitors: 777 }), error: null });
  await opening;
  assert.equal(dashboard.metric('unique'), '4');
  assert.equal(dashboard.select('[data-activity-period-label]').textContent, 'Hoy');
  assert.equal(dashboard.calls('admin_record_site_health').length, 1, 'only the current period can save its probe');
});

test('logout/reset invalidates in-flight results and removes all private values', async () => {
  const pending = deferred();
  const dashboard = mount({ metricHandler: () => pending.promise });
  const opening = dashboard.api.open('admin-1');
  await settle();
  dashboard.setUser(null);
  dashboard.api.reset();
  pending.resolve({ data: metrics(7), error: null });
  await opening;
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.ok(metricNames.every(name => dashboard.metric(name) === '—'));
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
  assert.equal(dashboard.calls('admin_record_site_health').length, 0);
  assert.equal(dashboard.intervalHandlers.size, 0);
});

test('only a failed HTTP probe marks the site offline', async () => {
  const dashboard = mount({ fetchHandler: async () => { throw new Error('HTTP probe unavailable'); } });
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.select('[data-activity-content]').hidden, false);
  assert.equal(dashboard.select('[data-activity-health]').textContent, 'Offline');
  assert.equal(dashboard.calls('admin_record_site_health')[0].args.p_online, false);
});

test('daily summary is manual, private, and can be copied without starting any delivery', async () => {
  const dashboard = mount();
  await dashboard.api.open('admin-1');
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 0);
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  assert.equal(dashboard.authCalls, 2);
  assert.equal(dashboard.calls('is_site_activity_admin').length, 2);
  const output = dashboard.select('[data-activity-summary-output]');
  assert.equal(output.hidden, false);
  assert.match(output.value, /Las Ñañas/);
  await dashboard.select('[data-activity-summary-copy]').click();
  await settle();
  assert.deepEqual(dashboard.copied, [output.value]);
  assert.equal(dashboard.fetchCalls.length, 1, 'summary generation and copy must never make an external delivery request');
});

test('generated summary survives authorized manual refresh, period change, and polling', async () => {
  const dashboard = mount();
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  const output = dashboard.select('[data-activity-summary-output]');
  const message = output.value;
  const summaryStatus = dashboard.select('[data-activity-summary-status]').textContent;
  assert.ok(message);
  const updates = [
    () => dashboard.select('[data-activity-refresh]').click(),
    () => dashboard.periods.find(button => button.dataset.activityPeriod === '30').click(),
    () => { for (const poll of dashboard.intervalHandlers.values()) poll(); }
  ];
  for (const update of updates) {
    await update();
    await settle();
    assert.equal(dashboard.select('[data-activity-content]').hidden, false);
    assert.equal(output.value, message, 'metrics refresh must retain the independent daily summary');
    assert.equal(output.hidden, false);
    assert.equal(dashboard.select('[data-activity-summary-status]').textContent, summaryStatus);
    assert.equal(dashboard.select('[data-activity-summary-copy]').hidden, false);
  }
  assert.deepEqual(dashboard.calls('admin_get_site_activity').map(call => call.args.p_days), [7, 7, 30, 30]);
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  await dashboard.select('[data-activity-summary-copy]').click();
  await settle();
  assert.deepEqual(dashboard.copied, [message]);
});

test('pending summary survives authorized refresh and period changes without another generation request', async () => {
  const pending = deferred();
  const dashboard = mount({ summaryHandler: () => pending.promise });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  const preparingStatus = dashboard.select('[data-activity-summary-status]').textContent;
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  const updates = [
    () => dashboard.select('[data-activity-refresh]').click(),
    () => dashboard.periods.find(button => button.dataset.activityPeriod === '1').click(),
    () => { for (const poll of dashboard.intervalHandlers.values()) poll(); }
  ];
  for (const update of updates) {
    await update();
    await settle();
    assert.equal(dashboard.select('[data-activity-content]').hidden, false);
    assert.equal(dashboard.select('[data-activity-summary]').disabled, true, 'refresh must not enable duplicate generation while the first request is pending');
    assert.equal(dashboard.select('[data-activity-summary-status]').textContent, preparingStatus);
    await dashboard.select('[data-activity-summary]').click();
    await settle();
    assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  }
  pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Summary requested before refresh' }, error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-summary-output]').value, 'Summary requested before refresh');
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, false);
  assert.equal(dashboard.select('[data-activity-summary]').disabled, false);
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
});

test('summary authorization in flight remains valid across an independent authorized metrics refresh', async () => {
  const authorization = deferred();
  const dashboard = mount({ authHandler: (call, result) => call === 2 ? authorization.promise : result });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 0);
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  assert.equal(dashboard.calls('admin_get_site_activity').length, 2);
  assert.equal(dashboard.select('[data-activity-summary]').disabled, true);
  authorization.resolve({ data: { user: { id: 'admin-1' } }, error: null });
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  assert.match(dashboard.select('[data-activity-summary-output]').value, /Las Ñañas/);
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, false);
});

test('summary authorization failure invalidates a concurrently pending metrics response', async () => {
  const authorization = deferred(), pendingMetrics = deferred();
  let metricCalls = 0;
  const dashboard = mount({ authHandler: (call, result) => call === 2 ? authorization.promise : result,
    metricHandler: args => ++metricCalls === 1 ? { data: metrics(args.p_days), error: null } : pendingMetrics.promise });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  assert.equal(dashboard.calls('admin_get_site_activity').length, 2);
  dashboard.setAuthorized(false);
  authorization.resolve({ data: { user: { id: 'admin-1' } }, error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 0);
  pendingMetrics.resolve({ data: metrics(7, { unique_visitors: 888 }), error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.ok(metricNames.every(name => dashboard.metric(name) === '—'));
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
  assert.equal(dashboard.calls('admin_record_site_health').length, 1, 'a response after lost authority must not save or render its probe');
});

test('authorized copy waiting for authentication survives an independent metrics refresh', async () => {
  const authorization = deferred();
  const dashboard = mount({ authHandler: (call, result) => call === 3 ? authorization.promise : result });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  const message = dashboard.select('[data-activity-summary-output]').value;
  const copying = dashboard.select('[data-activity-summary-copy]').click();
  await settle();
  assert.equal(dashboard.copied.length, 0);
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  authorization.resolve({ data: { user: { id: 'admin-1' } }, error: null });
  await copying;
  assert.deepEqual(dashboard.copied, [message]);
  assert.equal(dashboard.select('[data-activity-summary-status]').textContent, 'Resumen copiado.');
});

for (const state of ['generated', 'pending']) {
  test(`opening the view under another administrator cannot retain the previous account's ${state} summary`, async () => {
    const pending = deferred();
    const dashboard = mount(state === 'pending' ? { summaryHandler: () => pending.promise } : {});
    await dashboard.api.open('admin-1');
    await dashboard.select('[data-activity-summary]').click();
    await settle();
    assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
    if (state === 'generated') assert.ok(dashboard.select('[data-activity-summary-output]').value);
    dashboard.setUser({ id: 'admin-2' });
    await dashboard.api.open('admin-2');
    assert.equal(dashboard.select('[data-activity-content]').hidden, false);
    assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
    if (state === 'pending') {
      pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Summary belonging to previous session' }, error: null });
      await settle();
    }
    assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
    assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
    assert.equal(dashboard.select('[data-activity-summary-copy]').hidden, true);
    assert.equal(dashboard.intervalHandlers.size, 1, 'the newly authorized view must have only its own polling interval');
  });
}

test('role loss during refresh clears the generated summary along with all private metrics', async () => {
  const dashboard = mount();
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.ok(dashboard.select('[data-activity-summary-output]').value);
  dashboard.setAuthorized(false);
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  assert.equal(dashboard.calls('admin_get_site_activity').length, 1);
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.ok(metricNames.every(name => dashboard.metric(name) === '—'));
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary-copy]').hidden, true);
});

test('role loss during refresh invalidates an earlier pending summary response', async () => {
  const pending = deferred();
  const dashboard = mount({ summaryHandler: () => pending.promise });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  dashboard.setAuthorized(false);
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Summary after access was revoked' }, error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary]').disabled, true);
});

test('server denial of a metrics refresh invalidates pending summary even after successful role precheck', async () => {
  const pending = deferred();
  let denied = false;
  const dashboard = mount({ summaryHandler: () => pending.promise, metricHandler: args => denied
    ? { data: null, error: { code: '42501', message: 'private_access_required' } }
    : { data: metrics(args.p_days), error: null } });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  denied = true;
  await dashboard.select('[data-activity-refresh]').click();
  await settle();
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Late summary after server denied access' }, error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary]').disabled, true);
});

for (const action of ['logout', 'close', 'hidden-tab']) {
  async function leavePrivateView(dashboard) {
    if (action === 'logout') { dashboard.setUser(null); dashboard.api.reset(); }
    else if (action === 'close') dashboard.api.close();
    else { dashboard.document.hidden = true; await dashboard.document.dispatch('visibilitychange'); }
  }
  test(`${action} removes an already generated private summary`, async () => {
    const dashboard = mount();
    await dashboard.api.open('admin-1');
    await dashboard.select('[data-activity-summary]').click();
    await settle();
    assert.ok(dashboard.select('[data-activity-summary-output]').value);
    await leavePrivateView(dashboard);
    assert.equal(dashboard.select('[data-activity-content]').hidden, true);
    assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
    assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
    assert.equal(dashboard.select('[data-activity-summary-copy]').hidden, true);
  });
  test(`${action} discards the late response of a pending private summary`, async () => {
    const pending = deferred();
    const dashboard = mount({ summaryHandler: () => pending.promise });
    await dashboard.api.open('admin-1');
    await dashboard.select('[data-activity-summary]').click();
    await settle();
    assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
    await leavePrivateView(dashboard);
    pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Late private summary' }, error: null });
    await settle();
    assert.equal(dashboard.select('[data-activity-content]').hidden, true);
    assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
    assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
    assert.equal(dashboard.select('[data-activity-summary]').disabled, true);
  });
}

test('revoked administrator cannot generate a summary after metrics were displayed', async () => {
  const dashboard = mount();
  await dashboard.api.open('admin-1');
  dashboard.setAuthorized(false);
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 0);
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
});

test('repeated summary click cannot duplicate the pending request or reveal its result after logout', async () => {
  const pending = deferred();
  const dashboard = mount({ summaryHandler: () => pending.promise });
  await dashboard.api.open('admin-1');
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  await dashboard.select('[data-activity-summary]').click();
  await settle();
  assert.equal(dashboard.calls('generate_daily_site_activity_summary').length, 1);
  dashboard.api.reset();
  pending.resolve({ data: { summary_date: '2026-09-26', generated_at: '2026-09-27T15:00:00Z', message: 'Private summary' }, error: null });
  await settle();
  assert.equal(dashboard.select('[data-activity-summary-output]').hidden, true);
  assert.equal(dashboard.select('[data-activity-summary-output]').value, '');
});

test('hidden browser tab invalidates pending metrics and skips polling until visible again', async () => {
  const pending = deferred();
  let first = true;
  const dashboard = mount({ metricHandler: args => {
    if (first) { first = false; return pending.promise; }
    return { data: metrics(args.p_days), error: null };
  } });
  const opening = dashboard.api.open('admin-1');
  await settle();
  dashboard.document.hidden = true;
  await dashboard.document.dispatch('visibilitychange');
  pending.resolve({ data: metrics(7), error: null });
  await opening;
  assert.equal(dashboard.select('[data-activity-content]').hidden, true);
  const requestsBeforePoll = dashboard.rpcCalls.length;
  for (const poll of dashboard.intervalHandlers.values()) poll();
  await settle();
  assert.equal(dashboard.rpcCalls.length, requestsBeforePoll);
  dashboard.document.hidden = false;
  await dashboard.document.dispatch('visibilitychange');
  await settle();
  assert.equal(dashboard.select('[data-activity-content]').hidden, false);
  assert.equal(dashboard.metric('unique'), '10');
  dashboard.api.close();
  assert.equal(dashboard.intervalHandlers.size, 0);
});
