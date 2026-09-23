const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(resolve(__dirname, '../js/mi-voluntariado.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '../pages/mi-voluntariado.html'), 'utf8');

async function portal({ status = 'draft', membership = null, failure = false, signedIn = true, configured = true, invalidateDuringLoad = false } = {}) {
  const nodes = new Map();
  function node() {
    return { hidden: true, style: {}, dataset: {}, textContent: '', value: '', checked: false,
      classList: { toggle() {} }, addEventListener() {}, querySelectorAll: () => [],
      append() {}, replaceChildren() { this.cleared = true; },
      elements: new Proxy({}, { get(target, key) { return target[key] ||= node(); } }) };
  }
  const select = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  let start, authChange, redirected;
  const removed = [];
  const user = { id: 'owner-a', email_confirmed_at: '2026-01-01' };
  const rows = {
    volunteer_profiles: { first_name: 'Cuenta', last_name: 'Prueba' },
    membership_applications: { id:'10000000-0000-0000-0000-000000000001', status, plan_prices: {}, owner_id: user.id },
    application_messages: [], agenda_entries: [], memberships: membership
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? user : null } }), onAuthStateChange(fn) { authChange = fn; } },
    from(table) {
      const query = new Proxy({}, { get(_, key) {
        if (key === 'then') return (accept, reject) => Promise.resolve().then(() => {
          if (invalidateDuringLoad) authChange('SIGNED_OUT', null);
          return { data: rows[table], error: failure ? new Error('RLS denied') : null };
        }).then(accept, reject);
        if (['insert', 'update', 'delete'].includes(key)) throw new Error('Unexpected write');
        return () => query;
      } });
      return query;
    },
    rpc: async name => {
      assert.equal(name, 'list_my_volunteer_documents');
      return { data: [] };
    }
  };
  vm.runInNewContext(source, {
    document: { addEventListener(_, fn) { start = fn; }, querySelector: select, querySelectorAll: () => [], createElement: node },
    window: { LasNanasSupabase: { client: configured ? client : null } },
    sessionStorage: { getItem(key) { assert.notEqual(key, 'lasnanas_visual_demo_v1'); return '{}'; }, removeItem(key) { removed.push(key); } },
    location: { search: '', replace(url) { redirected = url; } }, URLSearchParams, Intl, Date
  });
  await start();
  return { select, removed, get redirected() { return redirected; }, authChange };
}

test('portal is hidden in HTML; simulated approval/payment controls are absent', () => {
  assert.match(html, /<main[^>]*data-private-workspace hidden>/);
  assert.doesNotMatch(html, /data-demo-action|data-demo-verify|data-report-payment/);
});
test('stored demonstration state is discarded; approval alone does not activate membership', async () => {
  const result = await portal({ status: 'approved' });
  assert.ok(result.removed.includes('lasnanas_visual_demo_v1'));
  assert.equal(result.select('[data-status-pill]').textContent, 'Solicitud aceptada');
  assert.equal(result.select('[data-conditions]').hidden, false);
  assert.equal(result.select('[data-private-workspace]').hidden, false);
  assert.equal(result.select('[data-application-code]').textContent, '10000000-0000-0000-0000-000000000001');
});
const active = { active: true, owner_id: 'owner-a', starts_at: '2000-01-01', ends_at: '2999-01-01' };
test('server membership belonging to the current account activates the displayed state', async () => {
  const result = await portal({ membership: active });
  assert.equal(result.select('[data-status-pill]').textContent, 'Membresía activa');
});
for (const [label, membership] of Object.entries({
  inactive: { ...active, active: false }, expired: { ...active, ends_at: '2001-01-01' },
  future: { ...active, starts_at: '2998-01-01' }, foreign: { ...active, owner_id: 'owner-b' },
  malformed: { ...active, ends_at: 'invalid' }
})) test(`${label} membership cannot activate the displayed state`, async () => {
  const result = await portal({ membership });
  assert.notEqual(result.select('[data-status-pill]').textContent, 'Membresía activa');
});
for (const options of [{ configured: false }, { signedIn: false }, { failure: true }, { invalidateDuringLoad: true }]) {
  test(`private content stays hidden: ${JSON.stringify(options)}`, async () => {
    const result = await portal(options);
    assert.equal(result.select('[data-private-workspace]').hidden, true);
  });
}
test('sign-out clears visible private content and redirects', async () => {
  const result = await portal();
  result.authChange('SIGNED_OUT', null);
  assert.equal(result.select('[data-private-workspace]').hidden, true);
  assert.equal(result.select('[data-private-workspace]').cleared, true);
  assert.equal(result.redirected, 'voluntariado.html#membresias');
});
