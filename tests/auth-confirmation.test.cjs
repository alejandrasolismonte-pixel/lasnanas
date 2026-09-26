const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const clientSource = readFileSync(resolve(root, 'js/supabase-client.js'), 'utf8');
const callbackSource = readFileSync(resolve(root, 'js/auth-callback.js'), 'utf8');
const publicHtml = readFileSync(resolve(root, 'pages/voluntariado.html'), 'utf8');

test('browser auth uses implicit confirmation and all public pages load the updated client', () => {
  let options;
  const window = {
    LAS_NANAS_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
    supabase: { createClient(_url, _key, value) { options = value; return {}; } }
  };
  vm.runInNewContext(clientSource, { window });
  assert.equal(options.auth.flowType, 'implicit');
  assert.equal(options.auth.detectSessionInUrl, true);
  for (const page of ['voluntariado', 'mi-voluntariado', 'auth-callback', 'actualizar-contrasena', 'coordinacion-voluntariado']) {
    const html = readFileSync(resolve(root, `pages/${page}.html`), 'utf8');
    assert.match(html, /supabase-client\.js\?v=2/);
  }
  for (const plan of ['keyuwün', 'kimün', 'pülli']) {
    assert.match(publicHtml, new RegExp(`data-membership-plan="${plan}"`));
  }
});

async function runCallback({ user = null, search = '', hash = '', exchangeError = null, adminError = { code: '42501' } } = {}) {
  let start;
  let authChange;
  let redirect;
  let timerCallback;
  const status = { textContent: '' };
  const back = { hidden: true };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange(callback) { authChange = callback; },
      exchangeCodeForSession: async () => ({ error: exchangeError })
    },
    rpc: async () => ({ error: adminError })
  };
  vm.runInNewContext(callbackSource, {
    document: {
      addEventListener(_event, callback) { start = callback; },
      querySelector(selector) { return selector === '[data-auth-callback-status]' ? status : back; }
    },
    window: { LasNanasSupabase: { client }, LasNanasLoader: { show() {}, hide() {} } },
    location: { search, hash, replace(value) { redirect = value; } },
    URLSearchParams,
    setTimeout(callback) { timerCallback = callback; return 1; },
    clearTimeout() {}
  });
  await start();
  return { status, back, get redirect() { return redirect; }, get timerCallback() { return timerCallback; }, authChange };
}

for (const plan of ['keyuwün', 'kimün', 'pülli']) {
  test(`confirmed ${plan} account reaches its selected plan`, async () => {
    const result = await runCallback({ user: { user_metadata: { selected_plan: plan, selected_billing: 'yearly', selected_currency: 'USD' } } });
    assert.equal(result.redirect, `mi-voluntariado.html?plan=${encodeURIComponent(plan)}&billing=yearly&currency=USD`);
  });
}

test('old PKCE links can still complete when their verifier is available', async () => {
  const result = await runCallback({ user: { user_metadata: { selected_plan: 'kimün' } }, search: '?code=old-code' });
  assert.equal(result.redirect, 'mi-voluntariado.html?plan=kim%C3%BCn');
});

test('an unavailable old verifier gives a useful recovery path', async () => {
  const result = await runCallback({ search: '?code=old-code', exchangeError: { code: 'bad_code_verifier' } });
  assert.equal(result.back.hidden, false);
  assert.match(result.status.textContent, /Mi Ruka/);
  assert.doesNotMatch(result.status.textContent, /expirado|utilizado/);
});

test('expired links show the recovery path immediately', async () => {
  const result = await runCallback({ hash: '#error=access_denied&error_code=otp_expired' });
  assert.equal(result.back.hidden, false);
  assert.match(result.status.textContent, /enlace expiró/);
});
