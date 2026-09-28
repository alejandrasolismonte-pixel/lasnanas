const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = () => readFileSync(resolve(__dirname, '../js/site-activity.js'), 'utf8');
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setImmediate(resolve));
};

function memoryStorage(values = new Map(), fail = false) {
  return {
    values,
    getItem(key) { if (fail) throw new Error('Storage unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (fail) throw new Error('Storage unavailable'); values.set(key, String(value)); },
    removeItem(key) { if (fail) throw new Error('Storage unavailable'); values.delete(key); }
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, handler, options) {
      const handlers = listeners.get(name) || [];
      handlers.push({ handler, once: Boolean(options && options.once) });
      listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      listeners.set(name, (listeners.get(name) || []).filter(item => item.handler !== handler));
    },
    dispatch(name, event = {}) {
      const handlers = [...(listeners.get(name) || [])];
      for (const item of handlers) {
        if (item.once) this.removeEventListener(name, item.handler);
        item.handler(event);
      }
    },
    listenerCount(name) { return (listeners.get(name) || []).length; }
  };
}

let uuidSequence = 0;
async function mount({
  pathname = '/', search = '?email=private@example.test&token=secret-token', hash = '#private-fragment',
  protocol = 'https:', configured = true, readyState = 'complete', failStorage = false, failNetwork = false,
  doNotTrack = '0', globalPrivacyControl = false, now = Date.parse('2026-09-27T15:00:00Z'),
  localValues = new Map(), sessionValues = new Map(), loadEventEnd = 900
} = {}) {
  const requests = [];
  let clock = now;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const document = { ...eventTarget(), readyState, referrer: 'https://private.example.test/?email=private@example.test' };
  const location = { protocol, pathname, search, hash, origin: 'https://lasnanas.example.test', href: `https://lasnanas.example.test${pathname}${search}${hash}` };
  const navigator = { doNotTrack, globalPrivacyControl };
  const localStorage = memoryStorage(localValues, failStorage);
  const sessionStorage = memoryStorage(sessionValues, failStorage);
  const performance = { getEntriesByType: () => [{ startTime: 0, loadEventEnd }], now: () => clock - now };
  const window = {
    ...eventTarget(), location, navigator, localStorage, sessionStorage, performance, setTimeout, clearTimeout,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}` },
    LAS_NANAS_CONFIG: configured ? { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' } : {},
    fetch: async (url, options) => {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      if (failNetwork) throw new Error('Network unavailable');
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    }
  };
  vm.runInNewContext(source(), { window, document, location, navigator, localStorage, sessionStorage, performance,
    Date: TestDate, URL, JSON, Math, console, setTimeout, clearTimeout });
  await settle();
  return { window, document, requests, localValues, sessionValues,
    advance(ms) { clock += ms; }, async settle() { await settle(); } };
}

test('public tracking sends one canonical page view without URL parameters or personal data', async () => {
  const tracker = await mount({ pathname: '/index.html' });
  assert.equal(tracker.requests.length, 1);
  const { url, options, payload } = tracker.requests[0];
  assert.equal(url, 'https://project.supabase.co/functions/v1/collect-site-activity');
  assert.equal(options.method, 'POST');
  assert.equal(options.keepalive, true);
  assert.equal(options.headers.apikey, 'public-test-key');
  assert.equal(payload.path, '/');
  assert.equal(payload.event_type, 'page_view');
  assert.equal(payload.load_ms, 900);
  assert.deepEqual(Object.keys(payload).sort(), ['event_id', 'event_type', 'load_ms', 'path', 'visit_id', 'visitor_id']);
  assert.doesNotMatch(options.body, /private@example|secret-token|private-fragment|referrer|user_id|email/i);
  tracker.window.dispatch('load');
  tracker.window.dispatch('load');
  assert.equal(tracker.requests.length, 1, 'repeated load events must not count another navigation');
});

test('page view waits for page load and never invents a performance measurement', async () => {
  const tracker = await mount({ readyState: 'loading', loadEventEnd: 0 });
  assert.equal(tracker.requests.length, 0);
  tracker.window.dispatch('load');
  await tracker.settle();
  assert.equal(tracker.requests.length, 1);
  assert.equal(tracker.requests[0].payload.load_ms, null);
  tracker.window.dispatch('load');
  assert.equal(tracker.requests.length, 1);
});

for (const pathname of ['/pages/coordinacion-voluntariado.html', '/pages/mi-voluntariado.html', '/pages/auth-confirmation.html', '/desarrollo.html']) {
  test(`private or unsupported page is excluded from collection: ${pathname}`, async () => {
    const tracker = await mount({ pathname });
    tracker.window.dispatch('load');
    tracker.document.dispatch('input', { target: { closest: () => ({}) } });
    await tracker.settle();
    assert.equal(tracker.requests.length, 0);
    assert.equal(tracker.localValues.size, 0, 'excluded pages must not create tracking identifiers');
  });
}

for (const options of [{ configured: false }, { protocol: 'file:' }, { doNotTrack: '1' }, { globalPrivacyControl: true }]) {
  test(`tracking respects unavailable configuration and browser privacy: ${JSON.stringify(options)}`, async () => {
    const tracker = await mount(options);
    tracker.window.dispatch('load');
    await tracker.settle();
    assert.equal(tracker.requests.length, 0);
    assert.equal(tracker.localValues.size, 0);
  });
}

test('registration start counts one input interaction per visit without modifying the form flow', async () => {
  const tracker = await mount({ pathname: '/pages/voluntariado.html' });
  const form = {};
  const field = { value: 'private@example.test', closest: selector => selector === '[data-register-form]' ? form : null };
  let preventDefaultCalls = 0;
  let stopPropagationCalls = 0;
  const event = { target: field, preventDefault() { preventDefaultCalls++; }, stopPropagation() { stopPropagationCalls++; } };
  tracker.document.dispatch('input', { ...event, target: { closest: () => null } });
  tracker.document.dispatch('input', event);
  tracker.document.dispatch('input', event);
  await tracker.settle();
  assert.deepEqual(tracker.requests.map(item => item.payload.event_type), ['page_view', 'registration_started']);
  assert.equal(field.value, 'private@example.test');
  assert.equal(preventDefaultCalls, 0);
  assert.equal(stopPropagationCalls, 0);
  assert.equal(tracker.document.listenerCount('submit'), 0, 'tracking must not intercept registration submission');
  assert.doesNotMatch(tracker.requests[1].options.body, /private@example/);

  const nextPage = await mount({ pathname: '/pages/voluntariado.html', localValues: tracker.localValues, sessionValues: tracker.sessionValues });
  nextPage.document.dispatch('input', event);
  await nextPage.settle();
  assert.equal(nextPage.requests.filter(item => item.payload.event_type === 'registration_started').length, 0);
});

test('visitor persists across navigation; visit renews only after thirty minutes of inactivity', async () => {
  const first = await mount();
  const firstPayload = first.requests[0].payload;
  const next = await mount({ pathname: '/pages/voluntariado.html', now: Date.parse('2026-09-27T15:29:00Z'),
    localValues: first.localValues, sessionValues: first.sessionValues });
  const nextPayload = next.requests[0].payload;
  assert.equal(nextPayload.visitor_id, firstPayload.visitor_id);
  assert.equal(nextPayload.visit_id, firstPayload.visit_id);
  assert.notEqual(nextPayload.event_id, firstPayload.event_id);

  next.advance(29 * 60 * 1000);
  next.document.dispatch('pointerdown');
  const active = await mount({ pathname: '/pages/servicios.html', now: Date.parse('2026-09-27T16:00:00Z'),
    localValues: next.localValues, sessionValues: next.sessionValues });
  assert.equal(active.requests[0].payload.visit_id, firstPayload.visit_id, 'recent interaction keeps the visit active');

  const expired = await mount({ pathname: '/pages/productos.html', now: Date.parse('2026-09-27T16:31:00Z'),
    localValues: active.localValues, sessionValues: active.sessionValues });
  assert.equal(expired.requests[0].payload.visitor_id, firstPayload.visitor_id);
  assert.notEqual(expired.requests[0].payload.visit_id, firstPayload.visit_id);
});

test('storage and collection failures do not break page load or registration input', async () => {
  const tracker = await mount({ pathname: '/pages/voluntariado.html', failStorage: true, failNetwork: true });
  tracker.document.dispatch('input', { target: { closest: () => ({}) } });
  tracker.document.dispatch('input', { target: { closest: () => ({}) } });
  await tracker.settle();
  assert.deepEqual(tracker.requests.map(item => item.payload.event_type), ['page_view', 'registration_started']);
  assert.equal(tracker.requests[0].payload.visitor_id, tracker.requests[1].payload.visitor_id);
  assert.equal(tracker.requests[0].payload.visit_id, tracker.requests[1].payload.visit_id);
});

test('interaction after thirty idle minutes starts a fresh visit on the current page', async () => {
  const tracker = await mount({ pathname: '/pages/voluntariado.html' });
  const first = tracker.requests[0].payload;
  tracker.advance(31 * 60 * 1000);
  tracker.document.dispatch('pointerdown');
  tracker.document.dispatch('input', { target: { closest: () => ({}) } });
  await tracker.settle();
  assert.deepEqual(tracker.requests.map(item => item.payload.event_type), ['page_view', 'page_view', 'registration_started']);
  assert.equal(tracker.requests[1].payload.visitor_id, first.visitor_id);
  assert.notEqual(tracker.requests[1].payload.visit_id, first.visit_id);
  assert.equal(tracker.requests[2].payload.visit_id, tracker.requests[1].payload.visit_id);
});
