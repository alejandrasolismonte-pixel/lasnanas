const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../pages/coordinacion-voluntariado.html'), 'utf8');
const script = readFileSync(resolve(__dirname, '../js/coordinacion-voluntariado.js'), 'utf8');
const valuesInTags = (tag, attribute) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attribute}="([^"]+)"[^>]*>`, 'g'))].map(match => match[1]);

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    children: [], dataset: {}, hidden: false, disabled: false, textContent: '', value: '',
    attributes: {},
    classList: {
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatch(name, event = {}) { return listeners.get(name)?.({ preventDefault() {}, ...event }); },
    click() { return this.dispatch('click'); },
    focus() { this.focused = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    reset() { this.resetCount = (this.resetCount || 0) + 1; }, reportValidity() { return true; },
    scrollIntoView() {},
    querySelector(selector) {
      this.queried ||= new Map();
      if (!this.queried.has(selector)) this.queried.set(selector, element());
      return this.queried.get(selector);
    },
    elements: new Proxy({}, { get(target, key) { return target[key] ||= element(); } })
  };
}

async function mount({ authorized = true, failStatusOnce = false, membershipActive = false,
  releaseErrorOnce = null, invokeError = false, deliveryStatus = 'sent', uploadError = false } = {}) {
  const nodes = new Map();
  const select = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const categories = valuesInTags('button', 'data-category').map(category => {
    const button = element();
    button.dataset.category = category;
    return button;
  });
  const viewButtons = valuesInTags('button', 'data-admin-view-button').map(name => {
    const button = element();
    button.dataset.adminViewButton = name;
    return button;
  });
  const views = valuesInTags('section', 'data-admin-view').map(name => {
    const view = element();
    view.dataset.adminView = name;
    view.hidden = name !== 'applications';
    return view;
  });
  const layout = select('[data-admin-layout]');
  layout.hidden = true;
  select('[data-admin-notice]').hidden = false;
  select('[data-application-detail]').querySelector = select;
  const redirects = [];
  const statusCalls = [];
  const activityCalls = [];
  const documentCalls = { reservations: [], uploads: [], releases: [], dispatches: [], documents: [], messages: [] };
  const applications = [
    { application_id: 'pending', first_name: 'Paula', last_name: 'Pendiente', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'submitted', membership_active: false },
    { application_id: 'process', first_name: 'Inés', last_name: 'Proceso', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'in_review', membership_active: false },
    { application_id: 'rejected', first_name: 'Rosa', last_name: 'Rechazada', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'rejected', membership_active: false },
    { application_id: 'active', first_name: 'Ana', last_name: 'Activa', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'approved', membership_active: true },
    { application_id: 'awaiting', first_name: 'Elena', last_name: 'Espera', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'approved', membership_active: false },
    { application_id: 'withdrawn', first_name: 'Wanda', last_name: 'Retirada', plan_id: 'base', billing: 'monthly', application_created_at: '2026-01-01T12:00:00Z', application_status: 'withdrawn', membership_active: false }
  ];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    rpc: async (name, args) => {
      if (name === 'admin_list_membership_applications_v2') return authorized
        ? { data: applications, error: null }
        : { data: null, error: { code: '42501', message: 'admin_access_required' } };
      if (name === 'can_read_agenda') return { data: true, error: null };
      if (name === 'admin_get_membership_application')
        return { data: applications.filter(application => application.application_id === args.p_application_id), error: null };
      if (name === 'admin_get_application_membership')
        return { data: [{ membership_active: membershipActive, payment_status: 'pending' }], error: null };
      if (name === 'admin_list_application_documents') return { data: documentCalls.documents, error: null };
      if (name === 'admin_reserve_document_upload') {
        documentCalls.reservations.push(args);
        const record = { document_id: `document-${documentCalls.reservations.length}`, document_kind: 'admin_release',
          storage_path: `owner/${args.p_application_id}/document-${documentCalls.reservations.length}.pdf`,
          original_name: args.p_original_name, released_at: null };
        documentCalls.documents.push(record);
        return { data: [record], error: null };
      }
      if (name === 'admin_release_volunteer_document') {
        documentCalls.releases.push(args);
        if (releaseErrorOnce) {
          const message = releaseErrorOnce; releaseErrorOnce = null;
          return { data: null, error: { message } };
        }
        if (!membershipActive) return { data: null, error: { message: 'active_membership_required' } };
        const record = documentCalls.documents.find(row => row.document_id === args.p_document_id);
        if (!record.released_at) {
          record.released_at = '2026-09-28T12:00:00Z';
          documentCalls.messages.push({ id: `message-${record.document_id}`, author_id: 'admin-1', body: 'Documento disponible en Mis documentos',
            application_id: 'pending', visible_to_member: true, created_at: record.released_at });
        }
        return { data: record.released_at, error: null };
      }
      if (name === 'admin_get_document_notification_status') return { data: [{ delivery_status: deliveryStatus }], error: null };
      if (name === 'admin_set_application_status') {
        statusCalls.push(args);
        if (failStatusOnce) { failStatusOnce = false; return { error: { message: 'temporary_error' } }; }
        const application = applications.find(row => row.application_id === args.p_application_id);
        application.application_status = args.p_status;
        return { data: [{ application_status: args.p_status }], error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.ok(['volunteer_profiles', 'application_messages', 'admin_notes', 'clarification_attachments'].includes(table));
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, in() { return query; },
        order() { return query; },
        then(accept, reject) { return Promise.resolve({ data: table === 'application_messages' ? documentCalls.messages : [], error: null }).then(accept, reject); }
      };
      return query;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'volunteer-documents');
        return { upload: async (path, file, options) => {
          documentCalls.uploads.push({ path, file, options });
          return { error: uploadError ? { message: 'upload_failed' } : null };
        } };
      }
    },
    functions: {
      invoke: async (name, options) => {
        documentCalls.dispatches.push({ name, ...options });
        return invokeError ? { data: null, error: { message: 'delivery_unavailable' } }
          : { data: { processed: 1, sent: 1, failed: 0 }, error: null };
      }
    },
  };
  const document = {
    addEventListener() {},
    querySelector: select,
    querySelectorAll(selector) {
      if (selector === '[data-category]') return categories;
      if (selector === '[data-admin-view-button]') return viewButtons;
      if (selector === '[data-admin-view]') return views;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    createElement: element
  };
  vm.runInNewContext(script, {
    window: {
      LasNanasSupabase: { client },
      LasNanasTransfers: { configured: () => false, createService: () => ({ receipt: async () => null }) },
      LasNanasActivityDashboard: {
        open(userId) { activityCalls.push(['open', userId]); },
        close() { activityCalls.push(['close']); },
        reset() { activityCalls.push(['reset']); }
      },
      location: { search: '', replace: url => redirects.push(url), assign: url => redirects.push(url) }
    },
    document, Date, Intl, URLSearchParams,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout
  });
  await new Promise(resolve => setImmediate(resolve));
  return { select, categories, viewButtons, views, layout, redirects, statusCalls, activityCalls, documentCalls,
    setMembershipActive(value) { membershipActive = value; }, setDeliveryStatus(value) { deliveryStatus = value; } };
}

async function openPendingApplication(panel) {
  const card = panel.select('[data-applications-list]').children.find(item =>
    item.children[0].children[0].textContent === 'Paula Pendiente');
  assert.ok(card);
  card.children[1].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.select('[data-application-detail]').hidden, false);
  assert.equal(panel.select('[data-admin-actions]').hidden, false);
}

test('authorized administrator sees the panel and categorized applications', async () => {
  const panel = await mount();
  assert.equal(panel.layout.hidden, false);
  assert.equal(panel.select('[data-admin-notice]').hidden, true);
  assert.deepEqual(panel.categories.map(button => button.dataset.category),
    ['all', 'pending', 'process', 'rejected', 'active', 'withdrawn']);
  assert.equal(panel.select('[data-category-count="active"]').textContent, 1);
  assert.equal(panel.select('[data-category-count="process"]').textContent, 2);
  assert.equal(panel.select('[data-applications-list]').children.length, 6);
  assert.ok(panel.select('[data-applications-list]').children.some(card =>
    card.dataset.category === 'active' && card.children[0].children[0].textContent === 'Ana Activa'));
});

test('category tabs filter cards and update selected state', async () => {
  const panel = await mount();
  const expected = { pending: ['pending'], process: ['process', 'process'], rejected: ['rejected'], active: ['active'], withdrawn: ['withdrawn'] };
  for (const [category, cardCategories] of Object.entries(expected)) {
    const tab = panel.categories.find(button => button.dataset.category === category);
    tab.click();
    assert.deepEqual(panel.select('[data-applications-list]').children.map(card => card.dataset.category), cardCategories);
    assert.equal(tab.attributes['aria-selected'], 'true');
    assert.ok(panel.categories.filter(button => button !== tab).every(button => button.attributes['aria-selected'] === 'false'));
  }
});

test('navigation opens every administrative view and map editor', async () => {
  const panel = await mount();
  const names = ['applications', 'clarifications', 'payments', 'documents', 'activities', 'agendas', 'activity'];
  assert.deepEqual(panel.viewButtons.map(button => button.dataset.adminViewButton), names);
  assert.deepEqual(panel.views.map(view => view.dataset.adminView), names);
  for (const name of names) {
    panel.viewButtons.find(button => button.dataset.adminViewButton === name).click();
    assert.deepEqual(panel.views.filter(view => !view.hidden).map(view => view.dataset.adminView), [name]);
    assert.ok(panel.viewButtons.find(button => button.dataset.adminViewButton === name).classList.contains('active'));
  }
  assert.ok(panel.activityCalls.some(call => call[0] === 'open' && call[1] === 'admin-1'));
  panel.select('[data-admin-edit-map]').click();
  assert.deepEqual(panel.redirects, ['../?editar-mapa=1#territorio']);
});

test('account without administrative permission never reveals private layout', async () => {
  const panel = await mount({ authorized: false });
  assert.equal(panel.layout.hidden, true);
  assert.equal(panel.select('[data-admin-notice]').hidden, false);
  assert.equal(panel.select('[data-applications-list]').children.length, 0);
  assert.deepEqual(panel.redirects, ['mi-voluntariado.html']);
});

test('rejection can be retried after an RPC error and moves the application to rejected', async () => {
  const panel = await mount({ failStatusOnce: true });
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-reject-form]');
  panel.select('[data-show-rejection]').click();
  assert.equal(form.hidden, false);
  form.elements.reason.value = 'Faltan antecedentes suficientes';
  await form.dispatch('submit');
  assert.equal(form.hidden, false);
  assert.equal(panel.select('[data-rejection-message]').textContent, 'No se pudo rechazar la solicitud.');
  assert.equal(panel.select('[data-category-count="pending"]').textContent, 1);
  await form.dispatch('submit');
  assert.deepEqual(panel.statusCalls.map(call => [call.p_application_id, call.p_status, call.p_message]), [
    ['pending', 'rejected', 'Faltan antecedentes suficientes'],
    ['pending', 'rejected', 'Faltan antecedentes suficientes']
  ]);
  assert.equal(form.hidden, true);
  assert.equal(panel.select('[data-category-count="pending"]').textContent, 0);
  assert.equal(panel.select('[data-category-count="rejected"]').textContent, 2);
  assert.equal(panel.select('[data-detail-field="status"]').textContent, 'Rechazada');
  assert.equal(panel.select('[data-admin-action-message]').textContent, 'Estado actualizado correctamente.');
});

test('clarification updates the application category and shows confirmation', async () => {
  const panel = await mount();
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-clarification-form]');
  form.elements.message.value = 'Adjunta la información faltante';
  await form.dispatch('submit');
  assert.deepEqual(panel.statusCalls.map(call => [call.p_application_id, call.p_status, call.p_message]), [
    ['pending', 'needs_clarification', 'Adjunta la información faltante']
  ]);
  assert.equal(panel.select('[data-category-count="pending"]').textContent, 0);
  assert.equal(panel.select('[data-category-count="process"]').textContent, 3);
  assert.equal(panel.select('[data-detail-field="status"]').textContent, 'Aclaración solicitada');
  assert.equal(panel.select('[data-clarification-message]').textContent, 'Aclaración enviada.');
});

function documentFile() {
  return { name: 'acuerdos.pdf', type: 'application/pdf', size: 100,
    slice: () => ({ arrayBuffer: async () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0]).buffer }) };
}

test('administrative document keeps the existing storage and dispatches its own notice after release', async () => {
  const panel = await mount({ membershipActive: true });
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-document-form]');
  const resetsBeforeUpload = form.resetCount || 0;
  form.elements.document.files = [documentFile()];
  await Promise.all([form.dispatch('submit'), form.dispatch('submit')]);
  assert.equal(panel.documentCalls.reservations.length, 1);
  assert.equal(panel.documentCalls.uploads.length, 1);
  assert.equal(panel.documentCalls.uploads[0].options.upsert, false);
  assert.deepEqual(panel.documentCalls.releases.map(call => call.p_document_id), ['document-1']);
  assert.equal(panel.documentCalls.dispatches[0].name, 'send-volunteer-registration-notifications');
  assert.equal(panel.documentCalls.dispatches[0].body.application_id, 'pending');
  assert.equal(panel.documentCalls.dispatches[0].body.document_id, 'document-1');
  assert.equal(panel.select('[data-admin-messages-list]').children.length, 1);
  assert.equal(form.resetCount, resetsBeforeUpload + 1);
  assert.match(panel.select('[data-admin-document-message]').textContent, /Aviso por correo enviado/);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
});

test('a notice failure is distinguished from inactive membership and retry reuses the uploaded document', async () => {
  const panel = await mount({ membershipActive: true, releaseErrorOnce: 'document_notification_unavailable' });
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-document-form]');
  form.elements.document.files = [documentFile()];
  await form.dispatch('submit');
  assert.match(panel.select('[data-admin-document-message]').textContent, /no se pudo enviar su aviso/);
  assert.doesNotMatch(panel.select('[data-admin-document-message]').textContent, /membresía activa/);
  assert.equal(panel.documentCalls.dispatches.length, 0);
  const retry = panel.select('[data-admin-document-list]').children[0].children[2];
  assert.equal(retry.textContent, 'Enviar documento');
  await retry.click();
  assert.equal(panel.documentCalls.reservations.length, 1);
  assert.equal(panel.documentCalls.uploads.length, 1);
  assert.deepEqual(panel.documentCalls.releases.map(call => call.p_document_id), ['document-1', 'document-1']);
  assert.equal(panel.documentCalls.messages.length, 1);
  assert.match(panel.select('[data-admin-document-message]').textContent, /Aviso por correo enviado/);
});

test('a document without active membership stays pending and can be sent later without uploading again', async () => {
  const panel = await mount();
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-document-form]');
  form.elements.document.files = [documentFile()];
  await form.dispatch('submit');
  assert.match(panel.select('[data-admin-document-message]').textContent, /cuando exista una membresía activa/);
  assert.equal(panel.documentCalls.dispatches.length, 0);
  assert.equal(panel.documentCalls.messages.length, 0);
  assert.equal(panel.select('[data-admin-document-list]').children[0].children[2].disabled, true);
  panel.setMembershipActive(true);
  await openPendingApplication(panel);
  await panel.select('[data-admin-document-list]').children[0].children[2].click();
  assert.equal(panel.documentCalls.uploads.length, 1);
  assert.equal(panel.documentCalls.messages.length, 1);
  assert.equal(panel.documentCalls.dispatches.length, 1);
});

test('a delivery failure preserves the document and message, and checking its notice never uploads another copy', async () => {
  const panel = await mount({ membershipActive: true, invokeError: true, deliveryStatus: 'failed' });
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-document-form]');
  form.elements.document.files = [documentFile()];
  await form.dispatch('submit');
  assert.match(panel.select('[data-admin-document-message]').textContent, /Documento y mensaje disponibles.*correo no se pudo enviar/);
  const retry = panel.select('[data-admin-document-list]').children[0].children[2];
  assert.equal(retry.textContent, 'Revisar aviso');
  panel.setDeliveryStatus('sent');
  await retry.click();
  assert.equal(panel.documentCalls.uploads.length, 1);
  assert.equal(panel.documentCalls.messages.length, 1);
  assert.match(panel.select('[data-admin-document-message]').textContent, /Aviso por correo enviado/);
});

test('a failed storage upload never releases or dispatches a document notice', async () => {
  const panel = await mount({ membershipActive: true, uploadError: true });
  await openPendingApplication(panel);
  const form = panel.select('[data-admin-document-form]');
  form.elements.document.files = [documentFile()];
  await form.dispatch('submit');
  assert.equal(panel.documentCalls.releases.length, 0);
  assert.equal(panel.documentCalls.dispatches.length, 0);
  assert.equal(panel.documentCalls.messages.length, 0);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.match(panel.select('[data-admin-document-message]').textContent, /La carga no pudo completarse/);
});
