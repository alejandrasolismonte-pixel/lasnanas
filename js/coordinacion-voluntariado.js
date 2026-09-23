/* Las Ñañas · primera etapa de lectura segura del panel de coordinación. */
(function () {
  'use strict';
  const client = window.LasNanasSupabase && window.LasNanasSupabase.client;
  const loader = window.LasNanasLoader;
  const sessionStatus = document.querySelector('[data-admin-session-status]');
  const notice = document.querySelector('[data-admin-notice]');
  const noticeText = document.querySelector('[data-admin-notice-text]');
  const workspace = document.querySelector('[data-admin-workspace]');
  const applicationsStatus = document.querySelector('[data-applications-status]');
  const applicationsList = document.querySelector('[data-applications-list]');
  const detail = document.querySelector('[data-application-detail]');
  const detailStatus = document.querySelector('[data-detail-status]');
  const detailContent = document.querySelector('[data-detail-content]');
  const adminActions = document.querySelector('[data-admin-actions]');
  const closeDetailButton = document.querySelector('[data-close-detail]');
  const approveButton = document.querySelector('[data-approve-application]');
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
  let currentApplication = null;
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
    workspace.hidden = true;
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

  async function loadAdminDocuments(applicationId) {
    adminDocumentList.replaceChildren();
    const { data, error } = await client.rpc('admin_list_application_documents', { p_application_id: applicationId });
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

  function createApplicationCard(application) {
    const card = document.createElement('article');
    card.className = 'review-box';
    const summary = document.createElement('div');
    const name = document.createElement('strong');
    const metadata = document.createElement('p');
    name.textContent = `${application.first_name} ${application.last_name}`.trim();
    metadata.textContent = `${application.plan_id} · ${billingLabels[application.billing] || application.billing} · ${statusLabels[application.application_status] || application.application_status} · ${formatDate(application.application_created_at)}`;
    summary.append(name, metadata);
    const openButton = document.createElement('button');
    openButton.className = 'btn btn-ghost';
    openButton.type = 'button';
    openButton.textContent = 'Ver detalle';
    openButton.addEventListener('click', function () { loadApplicationDetail(application.application_id); });
    card.append(summary, openButton);
    return card;
  }

  async function loadApplications(initialApplications) {
    applicationsStatus.textContent = 'Cargando solicitudes…';
    applicationsList.replaceChildren();
    let data = initialApplications;
    if (!Array.isArray(data)) {
      const result = await client.rpc('admin_list_membership_applications');
      if (result.error) {
        applicationsStatus.textContent = 'No fue posible cargar las solicitudes. Vuelve a intentarlo en unos minutos.';
        return;
      }
      data = result.data;
    }
    const applications = Array.isArray(data) ? data : [];
    applicationsStatus.textContent = applications.length ? `${applications.length} solicitud${applications.length === 1 ? '' : 'es'} registrada${applications.length === 1 ? '' : 's'}.` : 'Todavía no existen solicitudes registradas.';
    applications.forEach(function (application) { applicationsList.append(createApplicationCard(application)); });
  }

  async function loadApplicationDetail(applicationId) {
    const token = ++detailGeneration;
    currentApplication = null; currentReceipt = null; workflowState = null; receiptOpened = false;
    receiptDownload.disabled = true; syncTransferButton();
    loader?.show('Cargando detalle…');
    workspace.hidden = true;
    detail.hidden = false;
    detailContent.hidden = true;
    adminActions.hidden = true;
    detailStatus.textContent = 'Cargando detalle…';
    const { data, error } = await client.rpc('admin_get_membership_application', { p_application_id: applicationId });
    if (token !== detailGeneration) return;
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
    setDetailField('membership', workflowState?.membership_active ? `Activa hasta ${formatDate(workflowState.ends_at)}` : 'Sin membresía activa');
    detailStatus.textContent = '';
    detailContent.hidden = false;
    adminActions.hidden = false;
    approveButton.disabled = application.application_status === 'approved';
    syncTransferButton();
    actionMessage.textContent = '';
    await loadAdminDocuments(application.application_id);
    await loadReceipt(application.application_id, token);
    loader?.hide();
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
    const { data: initialApplications, error: adminError } = await client.rpc('admin_list_membership_applications');
    if (adminError) {
      redirectNonAdmin();
      return;
    }
    sessionStatus.textContent = 'Sesión administrativa verificada.';
    notice.hidden = true;
    workspace.hidden = false;
    editMapButton.disabled = false;
    await loadApplications(initialApplications);
  }

  editMapButton.addEventListener('click', function () {
    window.location.assign('../desarrollo.html?editar-mapa=1#territorio');
  });

  closeDetailButton.addEventListener('click', function () {
    ++detailGeneration; currentApplication = null; currentReceipt = null; receiptOpened = false;
    syncTransferButton();
    detail.hidden = true;
    workspace.hidden = false;
  });

  approveButton.addEventListener('click', async function () {
    if (!currentApplication) return;
    approveButton.disabled = true;
    loader?.show('Aprobando solicitud…');
    actionMessage.textContent = 'Aprobando solicitud…';
    const { data, error } = await client.rpc('admin_approve_membership_application', { p_application_id: currentApplication.application_id });
    if (error || !data?.[0]) { actionMessage.textContent = 'No fue posible aprobar la solicitud.'; approveButton.disabled = false; loader?.hide(); return; }
    currentApplication.application_status = data[0].application_status;
    setDetailField('status', statusLabels[currentApplication.application_status] || currentApplication.application_status);
    syncTransferButton();
    actionMessage.textContent = 'Solicitud aprobada correctamente.';
    await loadApplications();
    loader?.hide();
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
    const file = adminDocumentForm.elements.document.files[0];
    if (!(await validDocumentFile(file))) { adminDocumentMessage.textContent = 'Selecciona un PDF, JPG o PNG válido de hasta 10 MB.'; return; }
    const button = adminDocumentForm.querySelector('[type="submit"]'); button.disabled = true;
    loader?.show('Cargando documento…');
    adminDocumentMessage.textContent = 'Preparando carga privada…';
    const { data: reserved, error: reserveError } = await client.rpc('admin_reserve_document_upload', { p_application_id: currentApplication.application_id, p_original_name: file.name, p_mime_type: file.type, p_byte_size: file.size });
    const reservation = Array.isArray(reserved) ? reserved[0] : null;
    if (reserveError || !reservation) { button.disabled = false; adminDocumentMessage.textContent = 'No fue posible reservar el archivo.'; loader?.hide(); return; }
    const { error: uploadError } = await client.storage.from('volunteer-documents').upload(reservation.storage_path, file, { contentType: file.type, upsert: false });
    button.disabled = false;
    if (uploadError) { adminDocumentMessage.textContent = 'La carga no pudo completarse.'; loader?.hide(); return; }
    const releaseResult = await client.rpc('admin_release_volunteer_document', { p_document_id: reservation.document_id });
    adminDocumentForm.reset();
    adminDocumentMessage.textContent = releaseResult.error ? 'Archivo guardado. Se liberará cuando exista una membresía activa.' : 'Archivo guardado y liberado para la voluntaria.';
    await loadAdminDocuments(currentApplication.application_id);
    loader?.hide();
  });
  loader?.show('Cargando panel de coordinación…');
  initializeAdminPanel().catch(function () {
    // No se muestran mensajes internos de Supabase ni datos potencialmente sensibles.
    showConnectionError('Ocurrió un error inesperado al preparar el panel.');
  }).finally(function () { loader?.hide(); });
})();
