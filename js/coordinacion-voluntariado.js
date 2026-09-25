/* Las Ñañas · panel privado de coordinación de voluntariado. */
(function () {
  'use strict';
  const client = window.LasNanasSupabase && window.LasNanasSupabase.client;
  const loader = window.LasNanasLoader;
  const sessionStatus = document.querySelector('[data-admin-session-status]');
  const notice = document.querySelector('[data-admin-notice]');
  const noticeText = document.querySelector('[data-admin-notice-text]');
  const layout = document.querySelector('[data-admin-layout]');
  const views = [...document.querySelectorAll('[data-admin-view]')];
  const viewButtons = [...document.querySelectorAll('[data-admin-view-button]')];
  const categoryButtons = [...document.querySelectorAll('[data-category]')];
  const logoutButton = document.querySelector('[data-admin-logout]');
  const applicationsStatus = document.querySelector('[data-applications-status]');
  const applicationsList = document.querySelector('[data-applications-list]');
  const detail = document.querySelector('[data-application-detail]');
  const detailStatus = document.querySelector('[data-detail-status]');
  const detailContent = document.querySelector('[data-detail-content]');
  const adminActions = document.querySelector('[data-admin-actions]');
  const closeDetailButton = document.querySelector('[data-close-detail]');
  const approveButton = document.querySelector('[data-approve-application]');
  const reviewButton = document.querySelector('[data-mark-review]');
  const rejectButton = document.querySelector('[data-show-rejection]');
  const rejectForm = document.querySelector('[data-admin-reject-form]');
  const clarificationForm = document.querySelector('[data-admin-clarification-form]');
  const noteForm = document.querySelector('[data-admin-note-form]');
  const confirmTransferButton = document.querySelector('[data-confirm-transfer]');
  const actionMessage = document.querySelector('[data-admin-action-message]');
  const transferDialog = document.querySelector('[data-transfer-dialog]');
  const transferForm = document.querySelector('[data-transfer-form]');
  const adminDocumentForm = document.querySelector('[data-admin-document-form]');
  const adminDocumentList = document.querySelector('[data-admin-document-list]');
  const adminDocumentMessage = document.querySelector('[data-admin-document-message]');
  const editMapButton = document.querySelector('[data-admin-edit-map]');
  const statusLabels = { draft: 'Borrador', submitted: 'Enviada', in_review: 'En revisión', needs_clarification: 'Aclaración solicitada', approved: 'Aprobada', rejected: 'Rechazada', withdrawn: 'Retirada' };
  const billingLabels = { monthly: 'Mensual', yearly: 'Anual' };
  const agendaTypeLabels = { arrival: 'Llegada', departure: 'Salida', meeting: 'Reunión', extra: 'Actividad extra', workshop: 'Taller', other: 'Otro' };
  const agendaStatusLabels = { planned: 'Planificada', confirmed: 'Confirmada', completed: 'Realizada', cancelled: 'Cancelada' };
  let currentApplication = null;
  let applications = [], volunteers = [], adminUser = null, agendaAccess = false;
  let selectedCategory = 'all', activeView = 'applications';
  let applicationsGeneration = 0;
  const transfers = window.LasNanasTransfers.createService(client);
  const receiptStatus = document.querySelector('[data-admin-receipt-status]');
  const receiptDownload = document.querySelector('[data-admin-receipt-download]');
  let currentReceipt = null, receiptOpened = false, workflowState = null, confirming = false;
  let detailGeneration = 0;
  const transferEnabled = () => window.LasNanasTransfers.configured(window.LAS_NANAS_TRANSFER);
  const canConfirm = () => transferEnabled() && currentApplication?.application_status === 'approved' &&
    currentReceipt?.status === 'received' && receiptOpened && workflowState &&
    !workflowState.membership_active && (!workflowState.payment_status || workflowState.payment_status === 'pending');
  function syncTransferButton() { confirmTransferButton.disabled = confirming || !canConfirm(); }
  async function loadReceipt(applicationId, token) {
    if (token !== detailGeneration) return;
    currentReceipt = null; receiptOpened = false; receiptDownload.disabled = true; syncTransferButton();
    receiptStatus.textContent = 'Consultando comprobante…';
    try {
      const record = await transfers.receipt(applicationId);
      if (token !== detailGeneration) return;
      currentReceipt = record?.status === 'received' ? record : null;
      receiptDownload.disabled = !currentReceipt;
      receiptStatus.textContent = currentReceipt ? 'Comprobante recibido. Descárgalo para revisar sus datos y verifica el abono bancario.' : 'No hay un comprobante recibido para revisar.';
      if (!transferEnabled()) receiptStatus.textContent += ' La confirmación de transferencias todavía no está habilitada.';
    } catch (_) {
      if (token === detailGeneration) receiptStatus.textContent = 'No se pudo consultar el comprobante. La confirmación permanece bloqueada.';
    }
    syncTransferButton();
  }
  receiptDownload.addEventListener('click', async () => {
    if (!currentReceipt) return;
    const token = detailGeneration;
    receiptDownload.disabled = true;
    try {
      await transfers.download(currentReceipt);
      if (token !== detailGeneration) return;
      receiptOpened = true;
      receiptStatus.textContent = 'Comprobante descargado. Confirma únicamente después de comprobar el abono en la cuenta bancaria.';
    } catch (_) {
      if (token === detailGeneration) { receiptOpened = false; receiptStatus.textContent = 'No se pudo descargar el comprobante.'; }
    } finally {
      if (token === detailGeneration) { receiptDownload.disabled = !currentReceipt; syncTransferButton(); }
    }
  });

  async function validDocumentFile(file) {
    if (!file || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) return false;
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
    return (file.type === 'application/pdf' && pdf) || (file.type === 'image/jpeg' && jpg) || (file.type === 'image/png' && png);
  }

  function redirectMissingSession() {
    // Ruta fija: voluntariado abrirá directamente la pestaña de acceso de Mi Ruka.
    window.location.replace('voluntariado.html?access=mi-ruka');
  }

  function redirectNonAdmin() {
    // Una cuenta válida sin permiso administrativo vuelve a su espacio personal.
    window.location.replace('mi-voluntariado.html');
  }

  function showConnectionError(message) {
    sessionStatus.textContent = 'No fue posible abrir el panel.';
    noticeText.textContent = message;
    notice.hidden = false;
    layout.hidden = true;
    detail.hidden = true;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function formatAmount(amount, currency) {
    const number = Number(amount);
    if (!Number.isFinite(number)) return 'Importe no disponible';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(number);
  }

  function setDetailField(field, value) {
    const target = detail.querySelector(`[data-detail-field="${field}"]`);
    if (target) target.textContent = value || '—';
  }

  async function downloadDocument(documentId) {
    loader?.show('Preparando documento…');
    try {
      const { data: path, error: pathError } = await client.rpc('authorize_volunteer_document_download', { p_document_id: documentId });
      if (pathError || !path) throw new Error('download_not_authorized');
      const { data, error } = await client.storage.from('volunteer-documents').createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw new Error('signed_url_failed');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } finally {
      loader?.hide();
    }
  }

  async function loadAdminDocuments(applicationId, token) {
    adminDocumentList.replaceChildren();
    const { data, error } = await client.rpc('admin_list_application_documents', { p_application_id: applicationId });
    if (token !== detailGeneration) return;
    if (error) { adminDocumentList.textContent = 'No fue posible consultar la documentación.'; return; }
    const documents = Array.isArray(data) ? data : [];
    if (!documents.length) { adminDocumentList.textContent = 'Aún no hay documentación.'; return; }
    documents.forEach(function (documentRecord) {
      const row = document.createElement('div');
      row.className = 'review-box';
      const label = document.createElement('span');
      label.textContent = `${documentRecord.original_name} · ${documentRecord.document_kind === 'volunteer_submission' ? 'Enviado por voluntaria' : documentRecord.released_at ? 'Liberado' : 'Pendiente de membresía'}`;
      const button = document.createElement('button');
      button.className = 'btn btn-ghost'; button.type = 'button'; button.textContent = 'Ver archivo';
      button.addEventListener('click', async function () {
        try { await downloadDocument(documentRecord.document_id); } catch (_) { adminDocumentMessage.textContent = 'No fue posible abrir el archivo.'; }
      });
      row.append(label, button); adminDocumentList.append(row);
    });
  }

  function applicationCategory(application) {
    if (application.membership_active === true) return 'active';
    if (application.application_status === 'rejected') return 'rejected';
    if (application.application_status === 'submitted') return 'pending';
    if (application.application_status === 'withdrawn') return 'withdrawn';
    return 'process';
  }

  function createApplicationCard(application, context = 'applications') {
    const card = document.createElement('article');
    card.className = 'admin-card';
    card.dataset.category = applicationCategory(application);
    const summary = document.createElement('div');
    const name = document.createElement('strong');
    const metadata = document.createElement('p');
    name.textContent = `${application.first_name} ${application.last_name}`.trim();
    metadata.textContent = `${application.plan_id} · ${billingLabels[application.billing] || application.billing} · ${formatDate(application.application_created_at)}`;
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    badge.dataset.category = applicationCategory(application);
    badge.textContent = application.membership_active ? 'Activa' : statusLabels[application.application_status] || application.application_status;
    summary.append(name, badge, metadata);
    if (context === 'payments') {
      const payment = document.createElement('p');
      payment.textContent = `Pago: ${application.payment_status === 'confirmed' ? 'Confirmado' : application.payment_status === 'pending' ? 'Pendiente' : 'Sin confirmar'}`;
      summary.append(payment);
    }
    const openButton = document.createElement('button');
    openButton.className = 'btn btn-ghost';
    openButton.type = 'button';
    openButton.textContent = context === 'applications' ? 'Ver detalle' : 'Abrir gestión';
    openButton.addEventListener('click', function () { loadApplicationDetail(application.application_id, context); });
    card.append(summary, openButton);
    return card;
  }

  function renderList(selector, rows, context, emptyMessage) {
    const list = document.querySelector(selector);
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'admin-empty'; empty.textContent = emptyMessage;
      list.append(empty); return;
    }
    rows.forEach(application => list.append(createApplicationCard(application, context)));
  }

  function renderApplicationLists() {
    const counts = { all: applications.length, pending: 0, process: 0, rejected: 0, active: 0, withdrawn: 0 };
    applications.forEach(application => { const category = applicationCategory(application); if (category in counts) counts[category] += 1; });
    Object.entries(counts).forEach(([category, count]) => {
      document.querySelector(`[data-category-count="${category}"]`).textContent = count;
    });
    const filtered = selectedCategory === 'all' ? applications : applications.filter(application => applicationCategory(application) === selectedCategory);
    applicationsStatus.textContent = `${filtered.length} de ${applications.length} solicitud${applications.length === 1 ? '' : 'es'} registrada${applications.length === 1 ? '' : 's'}.`;
    renderList('[data-applications-list]', filtered, 'applications', 'No hay solicitudes en esta categoría.');
    const clarificationPriority = { needs_clarification: 0, submitted: 1, in_review: 2 };
    const clarifications = [...applications].sort((a, b) =>
      (clarificationPriority[a.application_status] ?? 3) - (clarificationPriority[b.application_status] ?? 3));
    document.querySelector('[data-clarifications-status]').textContent = `${clarifications.length} expediente${clarifications.length === 1 ? '' : 's'} para consultar.`;
    renderList('[data-clarifications-list]', clarifications, 'clarifications', 'No hay aclaraciones pendientes.');
    const payments = applications.filter(application => application.application_status === 'approved' || application.membership_active);
    document.querySelector('[data-payments-status]').textContent = `${payments.length} solicitud${payments.length === 1 ? '' : 'es'} con pago o aprobación para revisar.`;
    renderList('[data-payments-list]', payments, 'payments', 'No hay pagos para revisar.');
    document.querySelector('[data-documents-status]').textContent = `${applications.length} expediente${applications.length === 1 ? '' : 's'} disponible${applications.length === 1 ? '' : 's'}.`;
    renderList('[data-documents-list]', applications, 'documents', 'Aún no hay expedientes.');
  }

  async function loadApplications(initialApplications) {
    const generation = ++applicationsGeneration;
    applicationsStatus.textContent = 'Cargando solicitudes…';
    let data = initialApplications;
    if (!Array.isArray(data)) {
      const result = await client.rpc('admin_list_membership_applications_v2');
      if (generation !== applicationsGeneration) return false;
      if (result.error) {
        if (result.error.code === '42501' || /admin_access_required/i.test(result.error.message || '')) {
          layout.hidden = true;
          detail.hidden = true;
          applications = [];
          redirectNonAdmin();
          return false;
        }
        applicationsStatus.textContent = 'No fue posible cargar las solicitudes. Vuelve a intentarlo en unos minutos.';
        return false;
      }
      data = result.data;
    }
    applications = Array.isArray(data) ? data : [];
    renderApplicationLists();
    return true;
  }

  function showView(name) {
    if (!views.some(view => view.dataset.adminView === name)) return;
    activeView = name;
    ++detailGeneration;
    currentApplication = null;
    loader?.hide();
    detail.hidden = true;
    views.forEach(view => { view.hidden = view.dataset.adminView !== name; });
    viewButtons.forEach(button => {
      const active = button.dataset.adminViewButton === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (name === 'activities') loadActivities();
    if (name === 'agendas') loadAgendas();
  }

  async function loadApplicationDetail(applicationId, context = activeView) {
    const token = ++detailGeneration;
    currentApplication = null; currentReceipt = null; workflowState = null; receiptOpened = false;
    receiptDownload.disabled = true; syncTransferButton();
    loader?.show('Cargando detalle…');
    views.forEach(view => { view.hidden = true; });
    detail.hidden = false;
    detailContent.hidden = true;
    adminActions.hidden = true;
    rejectForm.reset(); clarificationForm.reset(); noteForm.reset(); adminDocumentForm.reset();
    rejectForm.hidden = true;
    document.querySelector('[data-rejection-message]').textContent = '';
    document.querySelector('[data-clarification-message]').textContent = '';
    document.querySelector('[data-note-message]').textContent = '';
    adminDocumentMessage.textContent = '';
    detailStatus.textContent = 'Cargando detalle…';
    const { data, error } = await client.rpc('admin_get_membership_application', { p_application_id: applicationId });
    if (token !== detailGeneration) return;
    if (error && (error.code === '42501' || /admin_access_required/i.test(error.message || ''))) {
      layout.hidden = true;
      detail.hidden = true;
      loader?.hide();
      redirectNonAdmin();
      return;
    }
    const application = Array.isArray(data) ? data[0] : null;
    if (error || !application) {
      detailStatus.textContent = 'No fue posible cargar esta solicitud.';
      loader?.hide();
      return;
    }
    currentApplication = application;
    setDetailField('application_code', application.application_id);
    setDetailField('name', `${application.first_name} ${application.last_name}`.trim());
    setDetailField('email', application.email);
    setDetailField('plan', application.plan_id);
    setDetailField('billing', billingLabels[application.billing] || application.billing);
    setDetailField('currency', application.currency);
    setDetailField('amount', formatAmount(application.quoted_amount, application.currency));
    setDetailField('status', statusLabels[application.application_status] || application.application_status);
    setDetailField('created_at', formatDate(application.application_created_at));
    const workflow = await client.rpc('admin_get_application_membership', { p_application_id: application.application_id });
    if (token !== detailGeneration) return;
    workflowState = !workflow.error && workflow.data?.[0] ? workflow.data[0] : null;
    setDetailField('membership', workflow.error ? 'No fue posible consultar la membresía' : workflowState?.membership_active ? `Activa hasta ${formatDate(workflowState.ends_at)}` : 'Sin membresía activa');
    detailStatus.textContent = workflow.error ? 'No fue posible consultar el estado de pago. Algunas acciones permanecerán bloqueadas.' : '';
    detailContent.hidden = false;
    adminActions.hidden = false;
    syncDecisionButtons();
    syncTransferButton();
    actionMessage.textContent = '';
    const loaded = await Promise.allSettled([
      loadAdminDocuments(application.application_id, token),
      loadReceipt(application.application_id, token),
      loadApplicationMessages(application.application_id, token)
    ]);
    if (token !== detailGeneration) return;
    if (loaded.some(result => result.status === 'rejected'))
      detailStatus.textContent = 'Algunas secciones no pudieron cargarse. Puedes volver a abrir la solicitud para reintentar.';
    loader?.hide();
    const section = context === 'clarifications' ? 'clarifications' : context === 'payments' ? 'payments' : context === 'documents' ? 'documents' : null;
    if (section) detail.querySelector(`[data-detail-section="${section}"]`)?.scrollIntoView({ block: 'start' });
    else detail.scrollIntoView({ block: 'start' });
  }

  function syncDecisionButtons() {
    const status = currentApplication?.application_status;
    reviewButton.disabled = !['submitted', 'needs_clarification', 'rejected'].includes(status);
    approveButton.disabled = !['submitted', 'in_review'].includes(status);
    rejectButton.disabled = !['submitted', 'in_review', 'needs_clarification', 'approved'].includes(status) ||
      (status === 'approved' && !workflowState) ||
      workflowState?.payment_status === 'confirmed' || workflowState?.membership_active === true;
    clarificationForm.querySelector('[type="submit"]').disabled = !['submitted', 'in_review'].includes(status);
  }

  function appendTextRecord(list, heading, body, date) {
    const article = document.createElement('article');
    article.className = 'admin-card';
    const title = document.createElement('strong'); title.textContent = heading;
    const content = document.createElement('p'); content.textContent = body;
    const time = document.createElement('small'); time.textContent = formatDate(date);
    article.append(title, content, time);
    list.append(article);
  }

  async function loadApplicationMessages(applicationId, token) {
    const messageList = document.querySelector('[data-admin-messages-list]');
    const noteList = document.querySelector('[data-admin-notes-list]');
    const attachmentList = document.querySelector('[data-admin-attachments-list]');
    const status = document.querySelector('[data-messages-status]');
    messageList.replaceChildren(); noteList.replaceChildren(); attachmentList.replaceChildren();
    status.textContent = 'Cargando comunicaciones…';
    const [messagesResult, notesResult] = await Promise.all([
      client.from('application_messages').select('id,author_id,body,created_at').eq('application_id', applicationId).is('deleted_at', null).order('created_at', { ascending: true }),
      client.from('admin_notes').select('id,author_id,body,created_at').eq('application_id', applicationId).is('deleted_at', null).order('created_at', { ascending: false })
    ]);
    if (token !== detailGeneration) return;
    if (messagesResult.error) status.textContent = 'No fue posible consultar los mensajes.';
    else {
      const messages = messagesResult.data || [];
      status.textContent = messages.length ? `${messages.length} mensaje${messages.length === 1 ? '' : 's'} en esta solicitud.` : 'Todavía no hay mensajes.';
      messages.forEach(row => appendTextRecord(messageList, row.author_id === currentApplication?.owner_id ? 'Voluntaria' : 'Administración', row.body, row.created_at));
      if (messages.length) {
        const attachmentResult = await client.from('clarification_attachments')
          .select('id,message_id,original_name,storage_path,scan_status,created_at')
          .in('message_id', messages.map(row => row.id)).is('deleted_at', null).order('created_at', { ascending: false });
        if (token !== detailGeneration) return;
        if (attachmentResult.error) attachmentList.textContent = 'No fue posible consultar los adjuntos.';
        else if (!attachmentResult.data?.length) attachmentList.textContent = 'No hay adjuntos de aclaraciones.';
        else attachmentResult.data.forEach(record => {
          const row = document.createElement('div'); row.className = 'admin-card';
          const name = document.createElement('span'); name.textContent = record.original_name;
          row.append(name);
          if (record.scan_status === 'clean') {
            const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-ghost'; open.textContent = 'Ver adjunto';
            open.addEventListener('click', async () => {
              const { data, error } = await client.storage.from('volunteer-attachments').createSignedUrl(record.storage_path, 60);
              if (error || !data?.signedUrl) { status.textContent = 'No fue posible abrir este adjunto.'; return; }
              window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
            });
            row.append(open);
          } else {
            const pending = document.createElement('small'); pending.textContent = 'Archivo no disponible para lectura'; row.append(pending);
          }
          attachmentList.append(row);
        });
      } else attachmentList.textContent = 'No hay adjuntos de aclaraciones.';
    }
    if (notesResult.error) noteList.textContent = 'No fue posible consultar las notas internas.';
    else if (!notesResult.data?.length) noteList.textContent = 'No hay notas internas.';
    else notesResult.data.forEach(row => appendTextRecord(noteList, 'Nota interna', row.body, row.created_at));
  }

  async function setApplicationStatus(nextStatus, message, target) {
    if (!currentApplication || target.disabled) return false;
    const applicationId = currentApplication.application_id;
    const token = detailGeneration;
    target.disabled = true;
    actionMessage.textContent = 'Guardando cambio…';
    loader?.show('Actualizando solicitud…');
    try {
      const { data, error } = await client.rpc('admin_set_application_status', {
        p_application_id: applicationId, p_status: nextStatus, p_message: message || null
      });
      if (error || !data?.[0]) throw new Error('status_change_failed');
      if (token !== detailGeneration) return true;
      currentApplication.application_status = data[0].application_status;
      setDetailField('status', statusLabels[currentApplication.application_status] || currentApplication.application_status);
      syncDecisionButtons();
      const refreshed = await loadApplications();
      if (token === detailGeneration) await loadApplicationMessages(applicationId, token);
      if (token === detailGeneration) actionMessage.textContent = refreshed ? 'Estado actualizado correctamente.' : 'Estado actualizado. No fue posible refrescar el listado; vuelve a cargar el panel.';
      return true;
    } catch (_) {
      if (token === detailGeneration) actionMessage.textContent = 'No fue posible cambiar el estado. Recarga y revisa la solicitud antes de reintentar.';
      return false;
    } finally {
      target.disabled = false;
      if (token === detailGeneration) { syncDecisionButtons(); loader?.hide(); }
    }
  }

  async function loadVolunteerOptions() {
    const result = await client.from('volunteer_profiles')
      .select('id,first_name,last_name').is('deleted_at', null).order('first_name', { ascending: true });
    const activitySelect = document.querySelector('[data-activity-owner]');
    const agendaSelect = document.querySelector('[data-agenda-owner]');
    activitySelect.replaceChildren(); agendaSelect.replaceChildren();
    for (const select of [activitySelect, agendaSelect]) {
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Selecciona una voluntaria';
      select.append(placeholder);
    }
    if (result.error) {
      document.querySelector('[data-activities-status]').textContent = 'No fue posible cargar las voluntarias.';
      document.querySelector('[data-agendas-status]').textContent = 'No fue posible cargar las voluntarias.';
      return;
    }
    volunteers = result.data || [];
    volunteers.forEach(person => {
      const label = `${person.first_name} ${person.last_name}`.trim();
      for (const select of [activitySelect, agendaSelect]) {
        if (select === activitySelect && person.id === adminUser.id) continue;
        const option = document.createElement('option'); option.value = person.id; option.textContent = label;
        select.append(option);
      }
    });
    document.querySelector('[data-activities-status]').textContent = volunteers.length ? 'Selecciona una voluntaria para gestionar sus actividades.' : 'Aún no hay voluntarias registradas.';
    document.querySelector('[data-agendas-status]').textContent = volunteers.length ? 'Selecciona una voluntaria para consultar su agenda.' : 'Aún no hay voluntarias registradas.';
  }

  function agendaSummary(entry) {
    const type = agendaTypeLabels[entry.type] || entry.type;
    const status = agendaStatusLabels[entry.status] || entry.status;
    return `${type} · ${status} · ${formatDate(entry.starts_at)}–${formatDate(entry.ends_at)}`;
  }

  function makeAgendaCard(entry, editable) {
    const card = document.createElement('article'); card.className = 'admin-card';
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = entry.title;
    const summary = document.createElement('p'); summary.textContent = agendaSummary(entry);
    const notes = document.createElement('p'); notes.textContent = [entry.general_place, entry.private_notes].filter(Boolean).join(' · ');
    content.append(title, summary, notes);
    if (!editable) {
      const kind = document.createElement('span'); kind.className = 'admin-badge'; kind.dataset.category = entry.official ? 'active' : 'process';
      kind.textContent = entry.official ? 'Oficial' : 'Personal'; content.prepend(kind);
    }
    card.append(content);
    if (editable && entry.created_by === adminUser.id) {
      const actions = document.createElement('div'); actions.className = 'button-row';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-ghost'; edit.textContent = 'Editar';
      edit.addEventListener('click', () => editActivity(entry));
      const archive = document.createElement('button'); archive.type = 'button'; archive.className = 'btn btn-ghost'; archive.textContent = 'Archivar';
      archive.addEventListener('click', () => archiveActivity(entry.id));
      actions.append(edit, archive); card.append(actions);
    }
    return card;
  }

  async function loadActivities() {
    const ownerId = document.querySelector('[data-activity-owner]').value;
    const status = document.querySelector('[data-activities-status]');
    const list = document.querySelector('[data-activities-list]');
    list.replaceChildren();
    if (!ownerId) { status.textContent = 'Selecciona una voluntaria para ver sus actividades oficiales.'; return; }
    status.textContent = 'Cargando actividades…';
    const result = await client.from('agenda_entries').select('id,owner_id,created_by,official,type,title,starts_at,ends_at,timezone,general_place,private_notes,status')
      .eq('owner_id', ownerId).eq('official', true).is('deleted_at', null).order('starts_at', { ascending: false });
    if (ownerId !== document.querySelector('[data-activity-owner]').value) return;
    if (result.error) { status.textContent = 'No fue posible consultar las actividades.'; return; }
    status.textContent = result.data?.length ? `${result.data.length} actividad${result.data.length === 1 ? '' : 'es'} oficial${result.data.length === 1 ? '' : 'es'}.` : 'No hay actividades oficiales para esta voluntaria.';
    (result.data || []).forEach(entry => list.append(makeAgendaCard(entry, true)));
  }

  async function loadAgendas() {
    if (!agendaAccess) return;
    const ownerId = document.querySelector('[data-agenda-owner]').value;
    const status = document.querySelector('[data-agendas-status]');
    const list = document.querySelector('[data-agendas-list]');
    list.replaceChildren();
    if (!ownerId) { status.textContent = 'Selecciona una voluntaria para ver su agenda.'; return; }
    status.textContent = 'Cargando agenda…';
    const result = await client.from('agenda_entries').select('id,official,type,title,starts_at,ends_at,general_place,private_notes,status')
      .eq('owner_id', ownerId).is('deleted_at', null).order('starts_at', { ascending: false });
    if (ownerId !== document.querySelector('[data-agenda-owner]').value) return;
    if (result.error) { status.textContent = 'No fue posible consultar la agenda. Revisa el permiso de acceso.'; return; }
    status.textContent = result.data?.length ? `${result.data.length} registro${result.data.length === 1 ? '' : 's'} en la agenda.` : 'Esta agenda aún no tiene registros.';
    (result.data || []).forEach(entry => list.append(makeAgendaCard(entry, false)));
  }

  function localDateAndTime(value) {
    const date = new Date(value);
    const part = number => String(number).padStart(2, '0');
    return { date: `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`, time: `${part(date.getHours())}:${part(date.getMinutes())}` };
  }

  function editActivity(entry) {
    const form = document.querySelector('[data-official-agenda-form]');
    form.elements.id.value = entry.id;
    form.elements.type.value = entry.type;
    form.elements.title.value = entry.title;
    const start = localDateAndTime(entry.starts_at), end = localDateAndTime(entry.ends_at);
    form.elements.date.value = start.date;
    form.elements.start.value = start.time;
    form.elements.endDate.value = end.date;
    form.elements.end.value = end.time;
    form.elements.status.value = entry.status;
    form.elements.place.value = entry.general_place || '';
    form.elements.notes.value = entry.private_notes || '';
    document.querySelector('[data-activity-message]').textContent = 'Editando actividad oficial.';
    form.scrollIntoView({ block: 'start' });
  }

  async function archiveActivity(id) {
    const ownerId = document.querySelector('[data-activity-owner]').value;
    if (!window.confirm('¿Archivar esta actividad oficial?')) return;
    const result = await client.from('agenda_entries').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('owner_id', ownerId).eq('created_by', adminUser.id).eq('official', true).select('id');
    document.querySelector('[data-activity-message]').textContent = result.error || !result.data?.length ? 'No fue posible archivar la actividad.' : 'Actividad archivada.';
    await loadActivities();
  }

  async function initializeAdminPanel() {
    if (!client) {
      showConnectionError('Falta la configuración pública necesaria para iniciar Supabase.');
      return;
    }
    // getUser valida la sesión contra Auth; no se confía solo en datos locales del navegador.
    const { data: userData, error: userError } = await client.auth.getUser();
    const user = userData && userData.user;
    if (userError || !user) {
      redirectMissingSession();
      return;
    }
    // La RPC 004 comprueba en servidor el rol admin activo y revoked_at IS NULL.
    const { data: initialApplications, error: adminError } = await client.rpc('admin_list_membership_applications_v2');
    if (adminError) {
      if (adminError.code === '42501' || /admin_access_required/i.test(adminError.message || '')) redirectNonAdmin();
      else showConnectionError('No fue posible validar el acceso con el servidor. Recarga la página para volver a intentarlo.');
      return;
    }
    adminUser = user;
    sessionStatus.textContent = 'Sesión administrativa verificada.';
    notice.hidden = true;
    layout.hidden = false;
    logoutButton.hidden = false;
    await loadApplications(initialApplications);
    await loadVolunteerOptions();
    const agendaPermission = await client.rpc('can_read_agenda');
    agendaAccess = !agendaPermission.error && agendaPermission.data === true;
    document.querySelector('[data-agenda-permission]').hidden = !agendaAccess;
    document.querySelector('[data-agenda-locked]').hidden = agendaAccess;
  }

  editMapButton.addEventListener('click', function () {
    window.location.assign('../?editar-mapa=1#territorio');
  });

  viewButtons.forEach(button => button.addEventListener('click', () => showView(button.dataset.adminViewButton)));
  categoryButtons.forEach(button => button.addEventListener('click', () => {
    selectedCategory = button.dataset.category;
    categoryButtons.forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    renderApplicationLists();
  }));
  categoryButtons.forEach(button => button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = categoryButtons.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? categoryButtons.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : -1) + categoryButtons.length) % categoryButtons.length;
    categoryButtons[next].focus(); categoryButtons[next].click();
  }));
  document.querySelector('[data-refresh-applications]').addEventListener('click', () => loadApplications());
  logoutButton.addEventListener('click', async () => {
    layout.hidden = true;
    logoutButton.disabled = true;
    await client.auth.signOut();
    window.location.replace('voluntariado.html?access=mi-ruka');
  });

  closeDetailButton.addEventListener('click', function () {
    ++detailGeneration; currentApplication = null; currentReceipt = null; receiptOpened = false;
    syncTransferButton();
    loader?.hide();
    showView(activeView);
  });

  approveButton.addEventListener('click', async function () {
    if (!currentApplication || approveButton.disabled) return;
    const applicationId = currentApplication.application_id;
    const token = detailGeneration;
    approveButton.disabled = true;
    loader?.show('Aprobando solicitud…');
    actionMessage.textContent = 'Aprobando solicitud…';
    try {
      const { data, error } = await client.rpc('admin_approve_membership_application', { p_application_id: applicationId });
      if (error || !data?.[0]) throw new Error('approval_failed');
      const refreshed = await loadApplications();
      if (token !== detailGeneration || currentApplication?.application_id !== applicationId) return;
      currentApplication.application_status = data[0].application_status;
      setDetailField('status', statusLabels[currentApplication.application_status] || currentApplication.application_status);
      syncDecisionButtons();
      syncTransferButton();
      actionMessage.textContent = refreshed ? 'Solicitud aprobada correctamente.' : 'Solicitud aprobada. No fue posible refrescar el listado; vuelve a cargar el panel.';
    } catch (_) {
      if (token === detailGeneration && currentApplication?.application_id === applicationId)
        actionMessage.textContent = 'No fue posible aprobar la solicitud. Revisa su estado antes de reintentar.';
    } finally {
      if (token === detailGeneration && currentApplication?.application_id === applicationId) { syncDecisionButtons(); loader?.hide(); }
    }
  });

  reviewButton.addEventListener('click', () => setApplicationStatus('in_review', null, reviewButton));
  rejectButton.addEventListener('click', () => {
    if (rejectButton.disabled) return;
    rejectForm.hidden = false;
    rejectForm.elements.reason.focus();
  });
  document.querySelector('[data-cancel-rejection]').addEventListener('click', () => {
    rejectForm.reset(); rejectForm.hidden = true;
  });
  rejectForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!rejectForm.reportValidity()) return;
    const reason = rejectForm.elements.reason.value.trim();
    if (reason.length < 5) { document.querySelector('[data-rejection-message]').textContent = 'Escribe un motivo de al menos 5 caracteres.'; return; }
    const button = rejectForm.querySelector('[type="submit"]');
    const succeeded = await setApplicationStatus('rejected', reason, button);
    document.querySelector('[data-rejection-message]').textContent = succeeded ? '' : 'No se pudo rechazar la solicitud.';
    if (succeeded) { rejectForm.reset(); rejectForm.hidden = true; }
  });
  clarificationForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!clarificationForm.reportValidity()) return;
    const message = clarificationForm.elements.message.value.trim();
    if (message.length < 5) { document.querySelector('[data-clarification-message]').textContent = 'Escribe una aclaración de al menos 5 caracteres.'; return; }
    const button = clarificationForm.querySelector('[type="submit"]');
    const succeeded = await setApplicationStatus('needs_clarification', message, button);
    document.querySelector('[data-clarification-message]').textContent = succeeded ? 'Aclaración enviada.' : 'No fue posible solicitar la aclaración.';
    if (succeeded) clarificationForm.reset();
  });
  noteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentApplication || !noteForm.reportValidity()) return;
    const applicationId = currentApplication.application_id;
    const token = detailGeneration;
    const body = noteForm.elements.note.value.trim();
    if (!body) return;
    const button = noteForm.querySelector('[type="submit"]'); button.disabled = true;
    const message = document.querySelector('[data-note-message]');
    const { error } = await client.from('admin_notes').insert({ application_id: applicationId, author_id: adminUser.id, body });
    button.disabled = false;
    if (token !== detailGeneration || currentApplication?.application_id !== applicationId) return;
    message.textContent = error ? 'No fue posible guardar la nota.' : 'Nota guardada.';
    if (!error) { noteForm.reset(); await loadApplicationMessages(applicationId, token); }
  });

  const activityOwner = document.querySelector('[data-activity-owner]');
  const agendaOwner = document.querySelector('[data-agenda-owner]');
  const activityForm = document.querySelector('[data-official-agenda-form]');
  activityOwner.addEventListener('change', () => { activityForm.reset(); activityForm.elements.id.value = ''; loadActivities(); });
  agendaOwner.addEventListener('change', loadAgendas);
  document.querySelector('[data-cancel-activity]').addEventListener('click', () => {
    activityForm.reset(); activityForm.elements.id.value = '';
    document.querySelector('[data-activity-message]').textContent = 'Edición cancelada.';
  });
  activityForm.addEventListener('submit', async event => {
    event.preventDefault();
    const ownerId = activityOwner.value;
    const message = document.querySelector('[data-activity-message]');
    if (!ownerId) { message.textContent = 'Selecciona una voluntaria.'; activityOwner.focus(); return; }
    if (!activityForm.reportValidity()) return;
    const startDate = new Date(`${activityForm.elements.date.value}T${activityForm.elements.start.value}:00`);
    const endDate = new Date(`${activityForm.elements.endDate.value}T${activityForm.elements.end.value}:00`);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
      message.textContent = 'La fecha de término debe ser posterior al inicio.'; return;
    }
    if (!activityForm.elements.title.value.trim()) { message.textContent = 'Escribe un título para la actividad.'; return; }
    const values = {
      type: activityForm.elements.type.value,
      title: activityForm.elements.title.value.trim(),
      starts_at: startDate.toISOString(), ends_at: endDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago',
      status: activityForm.elements.status.value,
      general_place: activityForm.elements.place.value.trim() || null,
      private_notes: activityForm.elements.notes.value.trim() || null,
      updated_at: new Date().toISOString()
    };
    const button = activityForm.querySelector('[type="submit"]'); button.disabled = true;
    message.textContent = 'Guardando actividad…';
    let result;
    if (activityForm.elements.id.value) {
      result = await client.from('agenda_entries').update(values).eq('id', activityForm.elements.id.value)
        .eq('owner_id', ownerId).eq('created_by', adminUser.id).eq('official', true).select('id');
    } else {
      result = await client.from('agenda_entries').insert({ ...values, owner_id: ownerId, created_by: adminUser.id, official: true }).select('id');
    }
    button.disabled = false;
    if (result.error || !result.data?.length) { message.textContent = 'No fue posible guardar la actividad.'; return; }
    activityForm.reset(); activityForm.elements.id.value = '';
    message.textContent = 'Actividad oficial guardada.';
    await loadActivities();
  });

  confirmTransferButton.addEventListener('click', function () {
    if (!canConfirm()) return;
    transferDialog.querySelector('[data-transfer-summary="application_code"]').textContent = currentApplication.application_id;
    transferDialog.querySelector('[data-transfer-summary="volunteer"]').textContent = `${currentApplication.first_name} ${currentApplication.last_name}`.trim();
    transferDialog.querySelector('[data-transfer-summary="plan"]').textContent = `${currentApplication.plan_id} · ${billingLabels[currentApplication.billing] || currentApplication.billing}`;
    transferDialog.querySelector('[data-transfer-summary="amount"]').textContent = formatAmount(currentApplication.quoted_amount, currentApplication.currency);
    transferDialog.querySelector('[data-transfer-summary="currency"]').textContent = currentApplication.currency;
    transferDialog.querySelector('[data-transfer-summary="date"]').textContent = formatDate(new Date().toISOString());
    transferForm.elements.reference.value = '';
    transferForm.elements.bankVerified.checked = false;
    document.querySelector('[data-transfer-message]').textContent = '';
    transferDialog.showModal();
  });

  document.querySelector('[data-cancel-transfer]').addEventListener('click', function () { transferDialog.close(); });
  transferForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (confirming || !transferForm.reportValidity() || !canConfirm() || !transferForm.elements.bankVerified.checked) return;
    const applicationId = currentApplication.application_id;
    confirming = true; syncTransferButton();
    const submit = transferForm.querySelector('[type="submit"]');
    submit.disabled = true;
    loader?.show('Confirmando transferencia…');
    const transferMessage = document.querySelector('[data-transfer-message]');
    transferMessage.textContent = 'Confirmando pago y activando membresía…';
    try {
      // Revalidar rol y comprobante justo antes de la RPC que confirma el pago.
      const access = await client.rpc('admin_get_membership_application', { p_application_id:applicationId });
      if (access.error || !access.data?.[0]) throw new Error('admin_access_required');
      const latestReceipt = await transfers.receipt(applicationId);
      if (latestReceipt?.status !== 'received') throw new Error('receipt_required');
      const { data, error } = await client.rpc('admin_confirm_transfer', { p_application_id:applicationId, p_transfer_reference:transferForm.elements.reference.value.trim() });
      if (error || data?.[0]?.payment_status !== 'confirmed') throw new Error('confirmation_failed');
      transferDialog.close();
      await loadApplicationDetail(applicationId);
      actionMessage.textContent = data[0].membership_active ? 'Transferencia confirmada y membresía activa.' : 'Transferencia confirmada. Revisa el estado de la membresía.';
    } catch (_) {
      transferMessage.textContent = 'No se pudo verificar la confirmación. Consulta el estado antes de reintentar.';
    } finally { confirming = false; submit.disabled = false; syncTransferButton(); loader?.hide(); }
  });

  adminDocumentForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!currentApplication) return;
    const applicationId = currentApplication.application_id;
    const token = detailGeneration;
    const file = adminDocumentForm.elements.document.files[0];
    if (!(await validDocumentFile(file))) { adminDocumentMessage.textContent = 'Selecciona un PDF, JPG o PNG válido de hasta 10 MB.'; return; }
    const button = adminDocumentForm.querySelector('[type="submit"]'); button.disabled = true;
    loader?.show('Cargando documento…');
    adminDocumentMessage.textContent = 'Preparando carga privada…';
    try {
      const { data: reserved, error: reserveError } = await client.rpc('admin_reserve_document_upload', {
        p_application_id: applicationId, p_original_name: file.name, p_mime_type: file.type, p_byte_size: file.size
      });
      const reservation = Array.isArray(reserved) ? reserved[0] : null;
      if (reserveError || !reservation) throw new Error('reserve_failed');
      const { error: uploadError } = await client.storage.from('volunteer-documents').upload(reservation.storage_path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error('upload_failed');
      const releaseResult = await client.rpc('admin_release_volunteer_document', { p_document_id: reservation.document_id });
      if (token !== detailGeneration || currentApplication?.application_id !== applicationId) return;
      adminDocumentForm.reset();
      adminDocumentMessage.textContent = releaseResult.error ? 'Archivo guardado. Se liberará cuando exista una membresía activa.' : 'Archivo guardado y liberado para la voluntaria.';
      await loadAdminDocuments(applicationId, token);
    } catch (error) {
      if (token === detailGeneration && currentApplication?.application_id === applicationId)
        adminDocumentMessage.textContent = error.message === 'reserve_failed' ? 'No fue posible reservar el archivo.' : 'La carga no pudo completarse.';
    } finally {
      button.disabled = false;
      if (token === detailGeneration) loader?.hide();
    }
  });
  client?.auth?.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT' || (adminUser && session?.user && session.user.id !== adminUser.id)) {
      ++detailGeneration;
      layout.hidden = true;
      detail.hidden = true;
      applications = [];
      window.location.replace('voluntariado.html?access=mi-ruka');
    }
  });
  loader?.show('Cargando panel de coordinación…');
  initializeAdminPanel().catch(function () {
    // No se muestran mensajes internos de Supabase ni datos potencialmente sensibles.
    showConnectionError('Ocurrió un error inesperado al preparar el panel.');
  }).finally(function () { loader?.hide(); });
})();
