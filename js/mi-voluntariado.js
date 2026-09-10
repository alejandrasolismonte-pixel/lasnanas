/* PORTAL PERSONAL — DEMOSTRACIÓN CON ARQUITECTURA MIGRABLE
   Los datos viven en sessionStorage solo hasta conectar Supabase; nunca se
   presentan como persistencia de servidor ni se almacenan contraseñas. */
document.addEventListener('DOMContentLoaded', () => {
  const SESSION_KEY = 'lasnanas_demo_session_v2';
  const ACCOUNTS_KEY = 'lasnanas_demo_accounts_v2';
  const STATE_KEY = 'lasnanas_demo_portal_v2';
  const email = sessionStorage.getItem(SESSION_KEY);
  if (!email) { window.location.replace('voluntariado.html#membresias'); return; }
  const accounts = JSON.parse(sessionStorage.getItem(ACCOUNTS_KEY) || '[]');
  const account = accounts.find(item => item.email === email);
  if (!account) { sessionStorage.removeItem(SESSION_KEY); window.location.replace('voluntariado.html#membresias'); return; }

  const PLANS = {
    'keyuwün': { monthly: 10000, yearly: 96000, documents: ['Comprobante de pago', 'Credencial'] },
    'kimün': { monthly: 15000, yearly: 144000, documents: ['Comprobante de pago', 'Credencial', 'Experiencias territoriales', 'Actividades autorizadas'] },
    'pülli': { monthly: 25000, yearly: 240000, documents: ['Comprobante de pago', 'Credencial', 'Experiencias territoriales', 'Actividades autorizadas', 'Directorio autorizado'] }
  };
  const pending = JSON.parse(sessionStorage.getItem('lasnanas_pending_selection_v2') || '{}');
  const states = JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}');
  let state = states[email] || {
    plan: PLANS[pending.plan] ? pending.plan : 'keyuwün', billing: pending.billing === 'yearly' ? 'yearly' : 'monthly',
    verified: false, application: 'draft', payment: 'none', active: false, respect: false, coordination: false,
    clarificationReply: '', attachments: [], displayName: `${account.firstName} ${account.lastName}`.trim(), photo: '', agenda: [], history: []
  };
  if (!state.active && PLANS[pending.plan]) { state.plan = pending.plan; state.billing = pending.billing === 'yearly' ? 'yearly' : 'monthly'; }
  let saveTimer;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
  const save = (message = 'Todos los cambios están guardados.') => {
    clearTimeout(saveTimer); $('[data-save-state]').textContent = 'Guardando…'; $('[data-save-state]').classList.add('saving');
    saveTimer = setTimeout(() => {
      const all = JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}'); all[email] = state;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(all));
      $('[data-save-state]').textContent = message; $('[data-save-state]').classList.remove('saving');
    }, 180);
  };
  const total = () => PLANS[state.plan][state.billing];
  const stage = () => state.active ? 5 : state.payment !== 'none' ? 4 : ['review','clarify','approved','rejected'].includes(state.application) ? 3 : state.application === 'submitted' ? 2 : 1;
  const statusLabels = { draft: 'Cuenta creada', submitted: 'Solicitud enviada', review: 'En revisión', clarify: 'Necesita aclaración', approved: 'Solicitud aceptada', rejected: 'Solicitud rechazada' };

  const renderHeader = () => {
    const fullName = `${account.firstName} ${account.lastName}`.trim();
    $('[data-user-name]').textContent = fullName; $('[data-avatar]').textContent = (account.firstName[0] || 'V').toUpperCase();
    const current = stage();
    $$('[data-steps] li').forEach((item, index) => { item.classList.toggle('done', index + 1 < current); item.classList.toggle('current', index + 1 === current); });
    $('[data-status-pill]').textContent = state.active ? 'Membresía activa' : state.payment === 'pending' ? 'Pago pendiente' : statusLabels[state.application];
    $('#portal-title').textContent = state.active ? 'Tu membresía está activa' : state.application === 'draft' ? 'Tu inscripción está guardada' : 'Revisa el estado de tu proceso';
  };
  const renderMembership = () => {
    const form = $('[data-membership-form]');
    form.elements.plan.value = state.plan; form.elements.billing.value = state.billing;
    form.elements.respect.checked = state.respect; form.elements.coordination.checked = state.coordination;
    $('[data-plan-summary]').textContent = `${state.plan} · ${state.billing === 'yearly' ? 'anual' : 'mensual'}`; $('[data-total]').textContent = money(total());
    const editable = ['draft','rejected'].includes(state.application) && !state.active;
    form.querySelectorAll('input').forEach(input => { input.disabled = !editable; });
    $('[data-submit-application]').disabled = !editable || !state.verified || !state.respect || !state.coordination;
    $('[data-email-gate]').classList.toggle('verified', state.verified);
    $('[data-email-gate] strong').textContent = state.verified ? 'Correo verificado' : 'Correo pendiente de verificación';
    $('[data-email-gate] p').textContent = state.verified ? 'Ya puedes enviar la solicitud cuando completes los acuerdos.' : 'La solicitud se habilita después de verificar el correo.';
    $('[data-demo-verify]').hidden = state.verified;
    $('[data-review-state]').hidden = !['submitted','review','rejected'].includes(state.application);
    $('[data-review-state] h3').textContent = state.application === 'rejected' ? 'La solicitud fue rechazada' : 'El equipo está revisando tu solicitud';
    $('[data-clarification-form]').hidden = state.application !== 'clarify';
    $('[data-public-clarification]').textContent = 'Cuéntanos brevemente qué tipo de actividades generales te interesan.';
    $('[data-clarification-form]').elements.reply.value = state.clarificationReply || '';
    $('[data-conditions]').hidden = state.application !== 'approved' || state.active;
    $('[data-terms]').checked = Boolean(state.terms); $('[data-report-payment]').disabled = !state.terms || state.payment === 'pending';
    renderAttachments();
  };
  const renderDocuments = () => {
    const root = $('[data-documents]');
    if (!state.active) { root.innerHTML = '<div class="locked">🔒 Los documentos y la credencial se habilitan únicamente después del pago confirmado.</div>'; return; }
    root.innerHTML = `<div class="document-grid">${PLANS[state.plan].documents.map(name => `<article class="document"><h3>${name}</h3><p>Documento autorizado para el plan ${state.plan}.</p><button class="btn btn-ghost" type="button">Descarga pendiente del archivo real</button></article>`).join('')}</div>`;
  };
  const renderProfile = () => {
    $('[data-profile-form]').elements.displayName.value = state.displayName;
    $('[data-credential-name]').textContent = state.displayName; $('[data-credential-plan]').textContent = state.plan;
    $('[data-credential-photo]').innerHTML = state.photo ? `<img src="${state.photo}" alt="Fotografía de la credencial">` : (state.displayName[0] || 'V').toUpperCase();
    $('[data-download-credential]').disabled = !state.active;
  };
  const renderAttachments = () => {
    $('[data-attachment-list]').innerHTML = state.attachments.map((file, index) => `<li>${file.name} · ${(file.size / 1024).toFixed(0)} KB <button type="button" data-remove-attachment="${index}">Eliminar</button></li>`).join('');
    $$('[data-remove-attachment]').forEach(button => button.onclick = () => { state.attachments.splice(Number(button.dataset.removeAttachment), 1); save(); renderAttachments(); });
  };
  const renderAgenda = () => {
    const list = $('[data-agenda-list]');
    list.innerHTML = state.agenda.length ? state.agenda.sort((a,b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)).map(item => `<article class="agenda-item ${item.official ? 'official' : ''}"><header><div><span class="badge">${item.official ? 'Actividad oficial' : 'Anotación personal'}</span><h3>${item.title}</h3></div><strong>${item.status}</strong></header><p>${item.date} · ${item.start}–${item.end} · ${item.place || 'Sin lugar indicado'}</p><p>${item.notes || ''}</p>${item.official ? '' : `<div class="button-row"><button class="btn btn-ghost" data-edit-agenda="${item.id}">Editar</button><button class="btn btn-ghost" data-delete-agenda="${item.id}">Eliminar</button></div>`}</article>`).join('') : '<p class="locked">Aún no tienes registros en tu agenda privada.</p>';
    $$('[data-edit-agenda]').forEach(button => button.onclick = () => editAgenda(button.dataset.editAgenda));
    $$('[data-delete-agenda]').forEach(button => button.onclick = () => { if (confirm('¿Eliminar este registro?')) { state.agenda = state.agenda.filter(item => item.id !== button.dataset.deleteAgenda); save(); renderAgenda(); } });
    renderCalendar();
  };
  const renderCalendar = () => {
    const root = $('[data-agenda-calendar]');
    const days = [...new Set(state.agenda.map(item => item.date))].sort();
    root.innerHTML = days.length ? days.map(day => `<div class="calendar-day"><strong>${day}</strong>${state.agenda.filter(item => item.date === day).map(item => `<div class="calendar-event ${item.official ? 'official' : ''}">${item.start} ${item.title}</div>`).join('')}</div>`).join('') : '<p>Sin fechas registradas.</p>';
  };
  const renderAll = () => { renderHeader(); renderMembership(); renderDocuments(); renderProfile(); renderAgenda(); };

  $$('[data-view-button]').forEach(button => button.onclick = () => {
    $$('[data-view-button]').forEach(item => item.classList.toggle('active', item === button));
    $$('[data-view]').forEach(view => { view.hidden = view.dataset.view !== button.dataset.viewButton; });
  });
  $('[data-membership-form]').addEventListener('change', event => {
    if (event.target.name === 'plan') state.plan = event.target.value;
    if (event.target.name === 'billing') state.billing = event.target.value;
    state.respect = $('[data-membership-form]').elements.respect.checked; state.coordination = $('[data-membership-form]').elements.coordination.checked;
    save(); renderMembership(); renderHeader();
  });
  $('[data-membership-form]').addEventListener('submit', event => { event.preventDefault(); if (!state.verified || !state.respect || !state.coordination) return; state.history.push(state.application); state.application = 'submitted'; save(); renderAll(); });
  $('[data-demo-verify]').onclick = () => { state.verified = true; save(); renderAll(); };
  $$('[data-save-later]').forEach(button => button.onclick = () => save('Progreso guardado para continuar después en esta pestaña.'));
  $('[data-previous-step]').onclick = () => { const previous = state.history.pop(); if (previous) state.application = previous; else state.application = 'draft'; save(); renderAll(); };
  $$('[data-demo-action]').forEach(button => button.onclick = () => { const action = button.dataset.demoAction; if (action === 'clarify') state.application = 'clarify'; if (action === 'approve') state.application = 'approved'; if (action === 'reject') state.application = 'rejected'; if (action === 'confirm' && state.payment === 'pending') { state.payment = 'confirmed'; state.active = true; } save(); renderAll(); });

  // Validación local preventiva; el servidor deberá verificar MIME real y limpiar metadatos nuevamente.
  $('[data-clarification-form]').elements.attachments.addEventListener('change', event => {
    const allowed = new Map([['application/pdf',['pdf']],['image/jpeg',['jpg','jpeg']],['image/png',['png']],['image/webp',['webp']]]);
    for (const file of event.target.files) {
      const extension = file.name.split('.').pop().toLowerCase();
      const safeName = /^[\p{L}\p{N}._() -]+$/u.test(file.name) && !file.name.includes('..');
      if (!safeName || !allowed.get(file.type)?.includes(extension) || file.size > 5 * 1024 * 1024) { $('[data-clarification-message]').textContent = `Archivo rechazado: ${file.name}.`; continue; }
      state.attachments = state.attachments.filter(item => item.name !== file.name);
      state.attachments.push({ name: file.name, size: file.size, type: file.type });
    }
    event.target.value = ''; save(); renderAttachments();
  });
  $('[data-clarification-form]').addEventListener('submit', event => { event.preventDefault(); const reply = event.currentTarget.elements.reply.value.trim(); if (!reply) { $('[data-clarification-message]').textContent = 'Escribe una respuesta.'; return; } state.clarificationReply = reply; state.application = 'review'; save(); renderAll(); });
  $('[data-clarification-form]').elements.reply.addEventListener('input', event => { state.clarificationReply = event.target.value; save(); });
  $('[data-terms]').onchange = event => { state.terms = event.target.checked; save(); renderMembership(); };
  $('[data-report-payment]').onclick = () => { state.payment = 'pending'; save(); renderAll(); };

  $('[data-profile-form]').addEventListener('submit', event => { event.preventDefault(); state.displayName = event.currentTarget.elements.displayName.value.trim(); save(); renderProfile(); });
  $('[data-profile-form]').elements.photo.addEventListener('change', event => { const file = event.target.files[0]; if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 4*1024*1024) return; const reader = new FileReader(); reader.onload = () => { state.photo = reader.result; save(); renderProfile(); }; reader.readAsDataURL(file); });
  $('[data-remove-photo]').onclick = () => { state.photo = ''; save(); renderProfile(); };
  $('[data-download-credential]').onclick = () => { if (!state.active) return; const safe = state.displayName.replace(/[<>&]/g, ''); const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520"><rect width="900" height="520" rx="40" fill="#17633f"/><text x="55" y="75" fill="white" font-family="Arial" font-size="25">LAS ÑAÑAS · CREDENCIAL DEMO</text><text x="55" y="235" fill="white" font-family="Arial" font-size="45">${safe}</text><text x="55" y="310" fill="white" font-family="Arial" font-size="32">Plan ${state.plan}</text><text x="55" y="455" fill="white" font-family="Arial" font-size="20">Muestra sin validez</text></svg>`; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'})); link.download = 'credencial-las-nanas-demo.svg'; link.click(); URL.revokeObjectURL(link.href); };

  const agendaForm = $('[data-agenda-form]');
  agendaForm.addEventListener('submit', event => { event.preventDefault(); if (!agendaForm.reportValidity()) return; const data = Object.fromEntries(new FormData(agendaForm)); if (data.end <= data.start) { $('[data-agenda-message]').textContent = 'La hora de término debe ser posterior al inicio.'; return; } const record = { ...data, id: data.id || crypto.randomUUID(), official: false }; const index = state.agenda.findIndex(item => item.id === record.id); if (index >= 0) state.agenda[index] = record; else state.agenda.push(record); agendaForm.reset(); $('[data-agenda-message]').textContent = ''; save(); renderAgenda(); });
  const editAgenda = id => { const item = state.agenda.find(entry => entry.id === id); if (!item || item.official) return; Object.entries(item).forEach(([key,value]) => { if (agendaForm.elements[key]) agendaForm.elements[key].value = value; }); agendaForm.scrollIntoView({behavior:'smooth'}); };
  $('[data-cancel-agenda]').onclick = () => { agendaForm.reset(); $('[data-agenda-message]').textContent = ''; };
  $$('[data-agenda-view]').forEach(button => button.onclick = () => { $$('[data-agenda-view]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', String(item === button)); }); $('[data-agenda-list]').hidden = button.dataset.agendaView !== 'list'; $('[data-agenda-calendar]').hidden = button.dataset.agendaView !== 'calendar'; });
  $('[data-logout]').onclick = () => { sessionStorage.removeItem(SESSION_KEY); window.location.assign('voluntariado.html#membresias'); };
  save(); renderAll();
});
