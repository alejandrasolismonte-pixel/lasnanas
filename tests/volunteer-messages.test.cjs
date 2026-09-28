const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../js/mi-voluntariado.js'), 'utf8');
const applicationId = '10000000-0000-0000-0000-000000000001';
const incoming = (id = 'message-1', values = {}) => ({
  id, application_id: applicationId, author_id: 'coordinator', visible_to_member: true,
  body: 'Tienes un documento disponible en Mis documentos.',
  created_at: '2026-09-28T12:00:00Z', member_read_at: null, deleted_at: null, ...values
});

async function mount({ messages = [incoming()], readError = false, search = '' } = {}) {
  const nodes = new Map();
  function element() {
    const classes = new Set(), listeners = new Map();
    return {
      hidden: false, disabled: false, style: {}, dataset: {}, children: [],
      textContent: '', value: '', checked: false, files: [], innerHTML: '',
      classList: {
        add(name) { classes.add(name); }, contains(name) { return classes.has(name); },
        toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
      },
      setAttribute() {}, querySelectorAll: () => [],
      addEventListener(name, listener) { listeners.set(name, listener); },
      click() { if (!this.disabled) return this.onclick?.() ?? listeners.get('click')?.(); },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      scrollIntoView() {}, focus() { this.focused = true; },
      elements: new Proxy({}, { get(target, key) { return target[key] ||= element(); } })
    };
  }
  const select = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const viewNames = ['membership', 'documents', 'profile', 'agenda'];
  const viewButtons = viewNames.map(name => {
    const button = select(`[data-view-button="${name}"]`); button.dataset.viewButton = name;
    return button;
  });
  const views = viewNames.map(name => {
    const view = select(`[data-view="${name}"]`); view.dataset.view = name; view.hidden = name !== 'membership';
    return view;
  });
  const collections = {
    '[data-view-button]': viewButtons, '[data-view]': views,
    '[data-member-unread-count]': [select('[data-member-unread-count]'), select('[data-member-documents-unread-count]')],
    '[data-member-new-message-alert]': [select('[data-member-new-message-alert]'), select('[data-document-new-message-alert]')],
    '[data-member-new-message-text]': [select('[data-member-new-message-text]'), select('[data-document-new-message-text]')],
    '[data-jump-member-messages]': [select('[data-jump-member-messages]'), select('[data-document-jump-member-messages]')]
  };
  const user = { id: 'owner-a', email_confirmed_at: '2026-01-01' };
  const rows = {
    volunteer_profiles: { first_name: 'Ana', last_name: 'Prueba' },
    membership_applications: {
      id: applicationId, status: 'draft', owner_id: user.id, billing: 'monthly', currency: 'CLP',
      plan_prices: { plan_id: 'keyuwün', monthly_clp: 10000 }, quoted_amount: 10000
    }, agenda_entries: [], memberships: null
  };
  let start, refresh, refreshGate = null, failRead = readError;
  let databaseMessages = structuredClone(messages), databaseDocuments = [];
  const readCalls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user } }), onAuthStateChange() {} },
    from(table) {
      const query = new Proxy({}, { get(_, name) {
        if (name === 'then') return (accept, reject) => {
          const result = { data: structuredClone(table === 'application_messages' ? databaseMessages : rows[table]), error: null };
          return (table === 'application_messages' && refreshGate ? refreshGate.then(() => result) : Promise.resolve(result)).then(accept, reject);
        };
        if (['update', 'insert', 'delete'].includes(name)) throw new Error('Unexpected write');
        return () => query;
      } });
      return query;
    },
    async rpc(name, args) {
      if (name === 'list_my_volunteer_documents') return { data: structuredClone(databaseDocuments), error: null };
      assert.equal(name, 'mark_application_messages_read');
      readCalls.push(args);
      if (failRead === 'throw') throw new Error('Network unavailable');
      if (failRead) return { error: new Error('Read denied') };
      for (const row of databaseMessages)
        if (row.application_id === args.p_application_id && row.author_id !== user.id && row.visible_to_member && !row.deleted_at)
          row.member_read_at ||= new Date().toISOString();
      return { data: 1, error: null };
    }
  };
  vm.runInNewContext(source, {
    document: {
      hidden: false, addEventListener(name, handler) { if (name === 'DOMContentLoaded') start = handler; },
      querySelector: select, querySelectorAll: selector => collections[selector] || [], createElement: element
    },
    window: { LasNanasSupabase: { client } },
    location: { search, replace() {} },
    sessionStorage: { getItem: () => '{}', removeItem() {} }, URLSearchParams, Date, Intl,
    setInterval(handler) { refresh = handler; }, setTimeout, clearTimeout
  });
  await start();
  assert.equal(select('[data-private-workspace]').hidden, false);
  return {
    select, readCalls, refresh: () => refresh(),
    setMessages(values) { databaseMessages = structuredClone(values); },
    setDocuments(values) { databaseDocuments = structuredClone(values); },
    setReadError(value) { failRead = value; },
    pauseRefresh() { let resume; refreshGate = new Promise(resolve => { resume = resolve; }); return () => { resume(); refreshGate = null; }; }
  };
}

test('Mis documentos keeps its unread signal on load and navigation until messages are opened', async () => {
  const panel = await mount({ search: '?view=documents' });
  assert.equal(panel.select('[data-view="documents"]').hidden, false);
  assert.equal(panel.readCalls.length, 0);
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, false);
  assert.equal(panel.select('[data-member-documents-unread-count]').textContent, '1 nuevo');
  assert.equal(panel.select('[data-document-new-message-alert]').hidden, false);
  assert.equal(panel.select('[data-view-button="documents"]').classList.contains('has-new-messages'), true);

  await panel.select('[data-document-jump-member-messages]').click();
  assert.equal(panel.select('[data-view="membership"]').hidden, false);
  assert.equal(panel.select('[data-member-message-panel]').focused, true);
  assert.equal(panel.readCalls[0].p_application_id, applicationId);
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, true);
  assert.equal(panel.select('[data-document-new-message-alert]').hidden, true);
  assert.equal(panel.select('[data-view-button="documents"]').classList.contains('has-new-messages'), false);
});

test('own, internal, deleted, read and other-application messages do not count as pending', async () => {
  const panel = await mount({ messages: [
    incoming('own', { author_id: 'owner-a' }), incoming('internal', { visible_to_member: false }),
    incoming('deleted', { deleted_at: '2026-09-28T13:00:00Z' }),
    incoming('read', { member_read_at: '2026-09-28T13:00:00Z' }),
    incoming('other', { application_id: 'other-application' })
  ] });
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, true);
  assert.equal(panel.select('[data-document-new-message-alert]').hidden, true);
  assert.equal(panel.select('[data-member-messages-list]').children.length, 2);
  await panel.select('[data-document-jump-member-messages]').click();
  assert.equal(panel.readCalls.length, 0);
});

for (const readError of [true, 'throw']) test(`failed read preserves the signal and allows retry (${readError})`, async () => {
  const panel = await mount({ readError });
  await panel.select('[data-document-jump-member-messages]').click();
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, false);
  assert.match(panel.select('[data-member-message-error]').textContent, /No se pudo guardar la lectura/);
  assert.equal(panel.select('[data-mark-member-messages-read]').disabled, false);
  panel.setReadError(false);
  await panel.select('[data-mark-member-messages-read]').click();
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, true);
});

test('the existing refresh shows a later message and its released document without reloading', async () => {
  const panel = await mount();
  await panel.select('[data-document-jump-member-messages]').click();
  panel.setMessages([incoming('message-1', { member_read_at: '2026-09-28T13:00:00Z' }), incoming('message-2')]);
  panel.setDocuments([{ document_id: 'document-2', original_name: 'Acuerdo.pdf', document_kind: 'admin_release' }]);
  await panel.refresh();
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, false);
  assert.equal(panel.select('[data-member-documents-unread-count]').textContent, '1 nuevo');
  const grid = panel.select('[data-documents]').children.at(-1);
  assert.equal(grid.children[0].children[0].textContent, 'Acuerdo.pdf');
});

test('a refresh started before opening messages cannot restore a stale unread signal', async () => {
  const panel = await mount();
  const resume = panel.pauseRefresh();
  const pendingRefresh = panel.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await panel.select('[data-document-jump-member-messages]').click();
  resume();
  await pendingRefresh;
  assert.equal(panel.select('[data-member-documents-unread-count]').hidden, true);
});
