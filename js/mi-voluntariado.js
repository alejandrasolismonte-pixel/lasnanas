/* PORTAL PERSONAL CON SUPABASE
   El servidor autoriza cada operación mediante RLS/RPC.
   sessionStorage conserva únicamente la selección de plan. */
document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.LasNanasSupabase?.client;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const banner = $('[data-connection-banner]');
  const loader = window.LasNanasLoader;
  const workspace = $('[data-private-workspace]');
  workspace.hidden = true;
  const setGlobal = (message, error = false) => { banner.textContent = message; banner.style.background = error ? '#7f1d1d' : ''; };
  if (!supabase) { setGlobal(window.LasNanasSupabase?.error || 'No se pudo iniciar Supabase.', true); return; }
  const transferPanel = window.LasNanasTransfers?.mountVolunteer(supabase, window.LAS_NANAS_TRANSFER, $('[data-conditions]'));

  const PLAN_ORDER = ['keyuwün','kimün','pülli'];
  const STATUS_LABELS = { draft:'Cuenta creada', submitted:'Solicitud enviada', in_review:'En revisión', needs_clarification:'Necesita aclaración', approved:'Solicitud aceptada', rejected:'Solicitud rechazada', withdrawn:'Retirada' };
  const pending = (() => { try { return JSON.parse(sessionStorage.getItem('lasnanas_pending_selection_v3') || '{}'); } catch (_) { return {}; } })();
  const query = new URLSearchParams(location.search);
  const requestedBilling = query.get('billing');
  const requestedCurrency = query.get('currency');
  const requested = {
    plan: PLAN_ORDER.includes(query.get('plan')) ? query.get('plan') : (PLAN_ORDER.includes(pending.plan) ? pending.plan : null),
    billing: ['monthly','yearly'].includes(requestedBilling) ? requestedBilling : (pending.billing === 'yearly' ? 'yearly' : 'monthly'),
    currency: ['CLP','USD'].includes(requestedCurrency) ? requestedCurrency : (pending.currency === 'USD' ? 'USD' : 'CLP')
  };
  let user, profile, application, price, messages = [], agenda = [], membership = null, volunteerDocuments = [];
  let sessionInvalidated = false;
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (user && session?.user && session.user.id !== user.id)) {
      sessionInvalidated = true;
      workspace.hidden = true;
      workspace.replaceChildren();
      $('[data-user-name]').textContent = 'Sesión finalizada';
      $('[data-avatar]').textContent = 'V';
      location.replace('voluntariado.html#membresias');
    }
  });
  // Retira estados ficticios de versiones anteriores sin utilizarlos.
  try { sessionStorage.removeItem('lasnanas_visual_demo_v1'); } catch (_) {}
  let photoPreview = '';

  const money = (value, currency = application?.currency || 'CLP') => new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-CL', { style:'currency', currency, maximumFractionDigits:0 }).format(value || 0);
  const showMessage = (selector, message, error = false) => { const node=$(selector); if(node){node.textContent=message;node.style.color=error?'#9f2f2f':'';} };
  const setBusy = (element, value) => {
    element?.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = value; });
    if (value) loader?.show('Procesando…'); else loader?.hide();
  };
  const currentStatus = () => application?.status || 'draft';
  const hasActiveMembership = () => Boolean(membership?.active && membership.owner_id === user?.id && Date.parse(membership.starts_at) <= Date.now() && Date.parse(membership.ends_at) > Date.now());
  const stage = () => hasActiveMembership() ? 5 : ['in_review','needs_clarification','approved','rejected'].includes(currentStatus()) ? 3 : currentStatus()==='submitted' ? 2 : 1;

  async function authenticatedUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) { location.replace('voluntariado.html#membresias'); return null; }
    return data.user;
  }
  async function currentPrice(planId) {
    const { data, error } = await supabase.from('plan_prices').select('*').eq('plan_id',planId).lte('valid_from',new Date().toISOString()).is('valid_until',null).order('valid_from',{ascending:false}).limit(1).maybeSingle();
    if (error || !data) throw new Error('No existe un precio vigente para el plan seleccionado.');
    return data;
  }
  const quote = (row, billing, currency) => row[`${billing}_${currency.toLowerCase()}`];

  // Crea únicamente un borrador: la cuenta ya existe y no se envía ni cobra automáticamente.
  async function ensureDraftSelection() {
    if (!requested.plan) return;
    if (application && application.status !== 'draft') return;
    const selectedPrice = await currentPrice(requested.plan);
    const values = { plan_price_id:selectedPrice.id, billing:requested.billing, currency:requested.currency, quoted_amount:quote(selectedPrice,requested.billing,requested.currency), updated_at:new Date().toISOString() };
    if (application) {
      const { data,error }=await supabase.from('membership_applications').update(values).eq('id',application.id).eq('status','draft').select('*,plan_prices(*)').single();
      if(error) throw error; application=data;
    } else {
      const { data,error }=await supabase.from('membership_applications').insert({...values,owner_id:user.id,status:'draft'}).select('*,plan_prices(*)').single();
      if(error) throw error; application=data;
    }
    price=application.plan_prices;
    sessionStorage.removeItem('lasnanas_pending_selection_v3');
  }

  async function loadAll() {
    workspace.hidden = true;
    loader?.show('Cargando tu espacio personal…');
    try {
      setGlobal('Cargando tu espacio privado…');
      user=await authenticatedUser(); if(!user)return;
      const [profileResult,applicationResult,messagesResult,agendaResult,membershipResult,documentsResult]=await Promise.all([
        supabase.from('volunteer_profiles').select('*').eq('id',user.id).single(),
        supabase.from('membership_applications').select('*,plan_prices(*)').eq('owner_id',user.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.from('application_messages').select('*').is('deleted_at',null).order('created_at',{ascending:true}),
        supabase.from('agenda_entries').select('*').is('deleted_at',null).order('starts_at',{ascending:true}),
        supabase.from('memberships').select('*,plan_prices(*)').eq('owner_id',user.id).eq('active',true).gt('ends_at',new Date().toISOString()).order('ends_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.rpc('list_my_volunteer_documents')
      ]);
      const failure=[profileResult,applicationResult,messagesResult,agendaResult,membershipResult,documentsResult].find(result=>result.error);
      if(failure)throw failure.error;
      if(sessionInvalidated)throw new Error('La sesión cambió durante la carga.');
      profile=profileResult.data; application=applicationResult.data; price=application?.plan_prices || null; messages=messagesResult.data || []; agenda=agendaResult.data || []; membership=membershipResult.data; volunteerDocuments=documentsResult.data || [];
      await ensureDraftSelection();
      if(sessionInvalidated)throw new Error('La sesión cambió durante la carga.');
      setGlobal('Datos de tu cuenta actualizados.');
      renderAll();
      await transferPanel?.refresh(application);
      if(sessionInvalidated)throw new Error('La sesión cambió durante la carga.');
      workspace.hidden = false;
    } catch (error) {
      workspace.hidden = true;
      setGlobal('No se pudo cargar tu espacio privado. Vuelve a cargar la página para intentarlo nuevamente.', true);
      throw error;
    } finally { loader?.hide(); }
  }

  function renderHeader(){
    $('[data-application-code]').textContent = application?.id || 'Pendiente de crear solicitud';
    const name=profile.display_name || `${profile.first_name} ${profile.last_name}`;
    $('[data-user-name]').textContent=name; $('[data-avatar]').textContent=(name[0]||'V').toUpperCase();
    $$('[data-steps] li').forEach((item,index)=>{item.classList.toggle('done',index+1<stage());item.classList.toggle('current',index+1===stage());});
    $('[data-status-pill]').textContent=hasActiveMembership()?'Membresía activa':STATUS_LABELS[currentStatus()] || 'Cuenta creada';
    $('#portal-title').textContent=hasActiveMembership()?'Tu membresía está activa':currentStatus()==='draft'?'Tu inscripción está guardada':'Revisa el estado de tu proceso';
  }
  function renderMembership(){
    const form=$('[data-membership-form]');
    const planId=price?.plan_id || requested.plan || 'keyuwün'; const billing=application?.billing || requested.billing; const currency=application?.currency || requested.currency;
    form.elements.plan.value=planId; form.elements.billing.value=billing; form.elements.respect.checked=Boolean(application?.respect_accepted); form.elements.coordination.checked=Boolean(application?.coordination_accepted);
    $('[data-plan-summary]').textContent=`${planId} · ${billing==='yearly'?'anual':'mensual'} · ${currency}`; $('[data-total]').textContent=money(application?.quoted_amount || quote(price || {},billing,currency),currency);
    const editable=application?.status==='draft'; form.querySelectorAll('input').forEach(input=>{input.disabled=!editable;});
    const verified=Boolean(user.email_confirmed_at); $('[data-email-gate]').classList.toggle('verified',verified); $('[data-email-gate] strong').textContent=verified?'Correo verificado':'Correo pendiente de verificación'; $('[data-email-gate] p').textContent=verified?'Ya puedes enviar la solicitud cuando completes los acuerdos.':'Confirma el enlace enviado a tu correo.';
    $('[data-submit-application]').disabled=!editable || !verified || !form.elements.respect.checked || !form.elements.coordination.checked;
    $('[data-review-state]').hidden=!['submitted','in_review','rejected'].includes(currentStatus()); $('[data-review-state] h3').textContent=currentStatus()==='rejected'?'La solicitud fue rechazada':'El equipo está revisando tu solicitud';
    $('[data-clarification-form]').hidden=currentStatus()!=='needs_clarification';
    const latestRequest=[...messages].reverse().find(message=>message.application_id===application?.id && message.author_id!==user.id && message.visible_to_member);
    $('[data-public-clarification]').textContent=latestRequest?.body || 'Coordinación solicitó información adicional.';
    const rejectionReason=$('[data-rejection-reason]');
    rejectionReason.hidden=currentStatus()!=='rejected' || !latestRequest;
    rejectionReason.textContent=latestRequest ? `Motivo comunicado por el equipo: ${latestRequest.body}` : '';
    $('[data-conditions]').hidden=currentStatus()!=='approved';
  }
  function renderDocuments(){
    const root=$('[data-documents]');
    root.replaceChildren();
    if(!volunteerDocuments.length){const empty=document.createElement('div');empty.className='locked';empty.textContent=membership?'Aún no tienes documentos disponibles.':'Los archivos de Las Ñañas se habilitarán únicamente después del pago confirmado. Puedes enviar documentación para tu propia solicitud.';root.append(empty);return;}
    const grid=document.createElement('div');grid.className='document-grid';
    volunteerDocuments.forEach(record=>{const card=document.createElement('article');card.className='document';const title=document.createElement('h3');title.textContent=record.original_name;const status=document.createElement('p');status.textContent=record.document_kind==='volunteer_submission'?'Enviado para revisión':'Disponible para descarga';const button=document.createElement('button');button.className='btn btn-ghost';button.type='button';button.textContent='Descargar';button.onclick=()=>downloadVolunteerDocument(record.document_id);card.append(title,status,button);grid.append(card);});
    root.append(grid);
  }

  async function validDocumentFile(file){if(!file||!['application/pdf','image/jpeg','image/png'].includes(file.type)||file.size<1||file.size>10*1024*1024)return false;const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());const pdf=bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d;const jpg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;const png=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);return(file.type==='application/pdf'&&pdf)||(file.type==='image/jpeg'&&jpg)||(file.type==='image/png'&&png);}
  async function downloadVolunteerDocument(documentId){const pathResult=await supabase.rpc('authorize_volunteer_document_download',{p_document_id:documentId});if(pathResult.error||!pathResult.data){showMessage('[data-volunteer-document-message]','No fue posible autorizar la descarga.',true);return;}const signed=await supabase.storage.from('volunteer-documents').createSignedUrl(pathResult.data,60);if(signed.error||!signed.data?.signedUrl){showMessage('[data-volunteer-document-message]','No fue posible generar el enlace privado.',true);return;}window.open(signed.data.signedUrl,'_blank','noopener,noreferrer');}
  function renderProfile(){
    const name=profile.display_name || `${profile.first_name} ${profile.last_name}`; $('[data-profile-form]').elements.displayName.value=name; $('[data-credential-name]').textContent=name; $('[data-credential-plan]').textContent=price?.plan_id || membership?.plan_prices?.plan_id || '—'; $('[data-credential-photo]').innerHTML=photoPreview?`<img src="${photoPreview}" alt="Fotografía seleccionada">`:(name[0]||'V').toUpperCase(); $('[data-download-credential]').disabled=true;
  }
  const agendaRecord=(item)=>{const start=new Date(item.starts_at),end=new Date(item.ends_at);return{id:item.id,official:item.official,type:item.type,title:item.title,date:start.toLocaleDateString('en-CA'),start:start.toTimeString().slice(0,5),end:end.toTimeString().slice(0,5),place:item.general_place||'',notes:item.private_notes||'',status:item.status};};
  function renderAgenda(){
    const items=agenda.map(agendaRecord); const root=$('[data-agenda-list]');
    root.innerHTML=items.length?items.map(item=>`<article class="agenda-item ${item.official?'official':''}"><header><div><span class="badge">${item.official?'Actividad oficial':'Anotación personal'}</span><h3>${escapeHtml(item.title)}</h3></div><strong>${item.status}</strong></header><p>${item.date} · ${item.start}–${item.end} · ${escapeHtml(item.place||'Sin lugar indicado')}</p><p>${escapeHtml(item.notes)}</p>${item.official?'':`<div class="button-row"><button class="btn btn-ghost" data-edit-agenda="${item.id}">Editar</button><button class="btn btn-ghost" data-delete-agenda="${item.id}">Eliminar</button></div>`}</article>`).join(''):'<p class="locked">Aún no tienes registros en tu agenda privada.</p>';
    $$('[data-edit-agenda]').forEach(button=>button.onclick=()=>editAgenda(button.dataset.editAgenda)); $$('[data-delete-agenda]').forEach(button=>button.onclick=()=>deleteAgenda(button.dataset.deleteAgenda));
    const days=[...new Set(items.map(item=>item.date))].sort(); $('[data-agenda-calendar]').innerHTML=days.length?days.map(day=>`<div class="calendar-day"><strong>${day}</strong>${items.filter(item=>item.date===day).map(item=>`<div class="calendar-event ${item.official?'official':''}">${item.start} ${escapeHtml(item.title)}</div>`).join('')}</div>`).join(''):'<p>Sin fechas registradas.</p>';
  }
  const escapeHtml=value=>String(value||'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const renderAll=()=>{renderHeader();renderMembership();renderDocuments();renderProfile();renderAgenda();};

  $$('[data-view-button]').forEach(button=>button.onclick=()=>{$$('[data-view-button]').forEach(item=>item.classList.toggle('active',item===button));$$('[data-view]').forEach(view=>{view.hidden=view.dataset.view!==button.dataset.viewButton;});});
  $('[data-membership-form]').addEventListener('change',async event=>{
    if(!application || application.status!=='draft')return;
    const form=event.currentTarget; const plan=form.elements.plan.value; const billing=form.elements.billing.value; const currency=application.currency;
    try{setBusy(form,true);const selectedPrice=await currentPrice(plan);const values={plan_price_id:selectedPrice.id,billing,currency,quoted_amount:quote(selectedPrice,billing,currency),respect_accepted:form.elements.respect.checked,coordination_accepted:form.elements.coordination.checked,updated_at:new Date().toISOString()};const{data,error}=await supabase.from('membership_applications').update(values).eq('id',application.id).eq('status','draft').select('*,plan_prices(*)').single();if(error)throw error;application=data;price=data.plan_prices;showMessage('[data-membership-message]','Cambios guardados.');renderMembership();}catch(error){showMessage('[data-membership-message]','No se pudieron guardar los cambios.',true);}finally{setBusy(form,false);renderMembership();}
  });
  $$('[data-save-later]').forEach(button=>button.onclick=()=>showMessage(button.closest('[data-clarification-form]')?'[data-clarification-message]':'[data-membership-message]','Los cambios enviados ya están guardados en tu cuenta.'));
  $('[data-membership-form]').addEventListener('submit',async event=>{event.preventDefault();const button=$('[data-submit-application]');button.disabled=true;showMessage('[data-membership-message]','Enviando solicitud…');const{error}=await supabase.rpc('submit_membership_application',{p_application_id:application.id});if(error){showMessage('[data-membership-message]','No se pudo enviar la solicitud.',true);button.disabled=false;return;}await loadAll();showMessage('[data-membership-message]','Solicitud enviada correctamente.');});
  $('[data-previous-step]').onclick=()=>showMessage('[data-membership-message]',application?.status==='draft'?'Ya estás en el primer paso editable.':'El estado enviado no se revierte desde el navegador.');

  $('[data-clarification-form]').addEventListener('submit',async event=>{event.preventDefault();const body=event.currentTarget.elements.reply.value.trim();if(!body){showMessage('[data-clarification-message]','Escribe una respuesta.',true);return;}setBusy(event.currentTarget,true);const{error}=await supabase.rpc('respond_to_membership_clarification',{p_application_id:application.id,p_body:body});setBusy(event.currentTarget,false);if(error){showMessage('[data-clarification-message]','No se pudo enviar la respuesta. Comprueba que tu solicitud siga esperando una aclaración e inténtalo nuevamente.',true);return;}event.currentTarget.elements.reply.value='';await loadAll();});
  // Adjuntos siguen fuera de alcance: no se suben hasta implementar la Edge Function segura.
  $('[data-clarification-form]').elements.attachments.addEventListener('change',event=>{event.target.value='';showMessage('[data-clarification-message]','Los adjuntos permanecen deshabilitados hasta conectar su función segura.',true);});

  $('[data-profile-form]').addEventListener('submit',async event=>{event.preventDefault();const displayName=event.currentTarget.elements.displayName.value.trim();if(displayName.length<2)return;setBusy(event.currentTarget,true);const{data,error}=await supabase.from('volunteer_profiles').update({display_name:displayName,updated_at:new Date().toISOString()}).eq('id',user.id).select().single();setBusy(event.currentTarget,false);if(error){setGlobal('No se pudo actualizar el perfil.',true);return;}profile=data;renderProfile();});

  $('[data-volunteer-document-form]').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const file=form.elements.document.files[0];if(!application){showMessage('[data-volunteer-document-message]','Primero debes tener una solicitud guardada.',true);return;}if(!(await validDocumentFile(file))){showMessage('[data-volunteer-document-message]','Selecciona un PDF, JPG o PNG válido de hasta 10 MB.',true);return;}setBusy(form,true);showMessage('[data-volunteer-document-message]','Preparando carga privada…');const reserve=await supabase.rpc('reserve_volunteer_document_upload',{p_application_id:application.id,p_original_name:file.name,p_mime_type:file.type,p_byte_size:file.size});const reservation=reserve.data?.[0];if(reserve.error||!reservation){setBusy(form,false);showMessage('[data-volunteer-document-message]','No fue posible reservar el archivo para tu solicitud.',true);return;}const uploaded=await supabase.storage.from('volunteer-documents').upload(reservation.storage_path,file,{contentType:file.type,upsert:false});setBusy(form,false);if(uploaded.error){showMessage('[data-volunteer-document-message]','No fue posible completar la carga.',true);return;}form.reset();const refreshed=await supabase.rpc('list_my_volunteer_documents');if(!refreshed.error)volunteerDocuments=refreshed.data||[];renderDocuments();showMessage('[data-volunteer-document-message]','Documento enviado de forma privada.');});
  $('[data-profile-form]').elements.photo.addEventListener('change',event=>{const file=event.target.files[0];if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024){event.target.value='';return;}const reader=new FileReader();reader.onload=()=>{photoPreview=reader.result;renderProfile();};reader.readAsDataURL(file);});
  $('[data-remove-photo]').onclick=()=>{photoPreview='';$('[data-profile-form]').elements.photo.value='';renderProfile();};

  const agendaForm=$('[data-agenda-form]');
  agendaForm.addEventListener('submit',async event=>{event.preventDefault();if(!agendaForm.reportValidity())return;const data=Object.fromEntries(new FormData(agendaForm));const start=new Date(`${data.date}T${data.start}`),end=new Date(`${data.date}T${data.end}`);if(end<=start){showMessage('[data-agenda-message]','La hora de término debe ser posterior al inicio.',true);return;}const values={owner_id:user.id,created_by:user.id,official:false,type:data.type,title:data.title.trim(),starts_at:start.toISOString(),ends_at:end.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,general_place:data.place.trim()||null,private_notes:data.notes.trim()||null,status:data.status,updated_at:new Date().toISOString()};setBusy(agendaForm,true);const result=data.id?await supabase.from('agenda_entries').update(values).eq('id',data.id).eq('owner_id',user.id).eq('official',false):await supabase.from('agenda_entries').insert(values);setBusy(agendaForm,false);if(result.error){showMessage('[data-agenda-message]','No se pudo guardar el registro.',true);return;}agendaForm.reset();showMessage('[data-agenda-message]','Registro guardado.');await reloadAgenda();});
  function editAgenda(id){const item=agenda.find(entry=>entry.id===id&&!entry.official);if(!item)return;const value=agendaRecord(item);Object.entries(value).forEach(([key,val])=>{if(agendaForm.elements[key])agendaForm.elements[key].value=val;});agendaForm.scrollIntoView({behavior:'smooth'});}
  async function deleteAgenda(id){if(!confirm('¿Eliminar este registro?'))return;const{error}=await supabase.from('agenda_entries').delete().eq('id',id).eq('owner_id',user.id).eq('official',false);if(error){showMessage('[data-agenda-message]','No se pudo eliminar.',true);return;}await reloadAgenda();}
  async function reloadAgenda(){const{data,error}=await supabase.from('agenda_entries').select('*').is('deleted_at',null).order('starts_at');if(error){showMessage('[data-agenda-message]','No se pudo actualizar la agenda.',true);return;}agenda=data||[];renderAgenda();}
  $('[data-cancel-agenda]').onclick=()=>{agendaForm.reset();showMessage('[data-agenda-message]','');};
  $$('[data-agenda-view]').forEach(button=>button.onclick=()=>{$$('[data-agenda-view]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});$('[data-agenda-list]').hidden=button.dataset.agendaView!=='list';$('[data-agenda-calendar]').hidden=button.dataset.agendaView!=='calendar';});
  $('[data-logout]').onclick=async()=>{setGlobal('Cerrando sesión…');loader?.show('Cerrando tu sesión…');try{await supabase.auth.signOut();sessionStorage.removeItem('lasnanas_pending_selection_v3');sessionStorage.removeItem('lasnanas_visual_demo_v1');location.assign('voluntariado.html#membresias');}finally{loader?.hide();}};

  try{await loadAll();}catch(error){setGlobal('No se pudo cargar tu espacio privado. Revisa la conexión o las políticas RLS.',true);}
});
