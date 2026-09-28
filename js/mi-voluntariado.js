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
  let user, profile, application, price, messages = [], agenda = [], membership = null, confirmedPayment = null, volunteerDocuments = [];
  let messagesGeneration = 0;
  let markingMemberMessages = false;
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
  let photoPreview = '', storedPhotoUrl = '', removePhotoOnSave = false, photoLoadFailed = false;
  let credentialRenderGeneration = 0;

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
  const photoBucket = () => supabase.storage.from('volunteer-profile-photos');
  const photoExtension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };
  async function validPhotoFile(file) {
    if (!file || !photoExtension[file.type] || file.size < 1 || file.size > 4 * 1024 * 1024) return false;
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    return file.type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : file.type === 'image/png' ? [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index) => bytes[index] === value)
      : bytes.slice(0,4).every((value,index) => value === [0x52,0x49,0x46,0x46][index]) &&
        bytes.slice(8,12).every((value,index) => value === [0x57,0x45,0x42,0x50][index]);
  }
  async function loadStoredPhoto() {
    if (storedPhotoUrl) URL.revokeObjectURL(storedPhotoUrl);
    storedPhotoUrl = '';
    photoLoadFailed = false;
    if (!profile.photo_path) return;
    try {
      const { data, error } = await photoBucket().download(profile.photo_path);
      if (!error && data) storedPhotoUrl = URL.createObjectURL(data);
      else photoLoadFailed = true;
    } catch (_) { photoLoadFailed = true; }
  }

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
        supabase.from('memberships').select('*,plan_prices(*)').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.rpc('list_my_volunteer_documents')
      ]);
      const failure=[profileResult,applicationResult,messagesResult,agendaResult,membershipResult,documentsResult].find(result=>result.error);
      if(failure)throw failure.error;
      if(sessionInvalidated)throw new Error('La sesión cambió durante la carga.');
      profile=profileResult.data; application=applicationResult.data; price=application?.plan_prices || null; messages=messagesResult.data || []; agenda=agendaResult.data || []; membership=membershipResult.data; volunteerDocuments=documentsResult.data || [];
      confirmedPayment=null;
      if(membership?.payment_id){
        const paymentResult=await supabase.from('payments')
          .select('id,application_id,amount,currency,status,provider_reference,confirmed_at,settled_amount,settled_currency')
          .eq('id',membership.payment_id).eq('owner_id',user.id).eq('status','confirmed').maybeSingle();
        if(!paymentResult.error)confirmedPayment=paymentResult.data;
      }
      // Si el enlace se abrió en otro dispositivo, sessionStorage no viaja con él.
      // Usa la selección verificada de Auth solo cuando aún no hay una solicitud.
      if (!application && !requested.plan) {
        const meta = user.user_metadata || {};
        if (PLAN_ORDER.includes(meta.selected_plan)) {
          requested.plan = meta.selected_plan;
          if (!['monthly','yearly'].includes(requestedBilling) && !['monthly','yearly'].includes(pending.billing) && ['monthly','yearly'].includes(meta.selected_billing)) requested.billing = meta.selected_billing;
          if (!['CLP','USD'].includes(requestedCurrency) && !['CLP','USD'].includes(pending.currency) && ['CLP','USD'].includes(meta.selected_currency)) requested.currency = meta.selected_currency;
        }
      }
      await ensureDraftSelection();
      await loadStoredPhoto();
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
  let membershipSelectionSaving=false;
  function renderMembership(){
    if(membershipSelectionSaving)return;
    const form=$('[data-membership-form]');
    const planId=price?.plan_id || requested.plan || 'keyuwün'; const billing=application?.billing || requested.billing; const currency=application?.currency || requested.currency;
    form.elements.plan.value=planId; form.elements.billing.value=billing; form.elements.currency.value=currency; form.elements.respect.checked=Boolean(application?.respect_accepted); form.elements.coordination.checked=Boolean(application?.coordination_accepted);
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
    const next=$('[data-member-next-step]');
    const nextText=$('[data-member-next-step-text]');
    next.classList.toggle('is-complete',hasActiveMembership());
    next.classList.toggle('is-next-step',!hasActiveMembership());
    nextText.textContent=hasActiveMembership()
      ? `Tu membresía está activa hasta el ${new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Santiago',hour12:false}).format(new Date(membership.ends_at))} (hora de Chile). Descarga tu comprobante, protocolo y credencial en Mis documentos.`
      : currentStatus()==='approved'
        ? 'Completa la transferencia y envía el comprobante. Coordinación activará tu membresía después de verificar el abono.'
        : currentStatus()==='needs_clarification'
          ? 'Responde la aclaración solicitada para que coordinación pueda continuar.'
          : currentStatus()==='submitted' || currentStatus()==='in_review'
            ? 'Tu solicitud está en revisión. Estamos cerca: pronto te indicaremos el siguiente paso para activar tu membresía.'
            : currentStatus()==='rejected'
              ? 'Lee el motivo comunicado por coordinación antes de enviar una nueva solicitud.'
              : 'Completa los acuerdos y envía tu solicitud para iniciar la revisión.';
  }
  function renderMemberMessages(){
    const rows=messages.filter(row=>row.application_id===application?.id && row.visible_to_member && !row.deleted_at);
    const incoming=rows.filter(row=>row.author_id!==user.id && !row.member_read_at);
    const panel=$('[data-member-message-panel]');
    const list=$('[data-member-messages-list]');
    const mark=$('[data-mark-member-messages-read]');
    panel.hidden=!rows.length;
    $$('[data-member-new-message-alert]').forEach(alert=>{alert.hidden=!incoming.length;});
    $$('[data-member-new-message-text]').forEach(text=>{
      text.textContent=incoming.length
        ? `${incoming.length} mensaje${incoming.length===1?'':'s'} nuevo${incoming.length===1?'':'s'} de coordinación` : '';
    });
    $$('[data-member-unread-count]').forEach(badge=>{
      badge.hidden=!incoming.length;
      badge.textContent=`${incoming.length} nuevo${incoming.length===1?'':'s'}`;
    });
    for(const view of ['membership','documents'])
      $(`[data-view-button="${view}"]`).classList.toggle('has-new-messages',incoming.length>0);
    mark.hidden=!incoming.length;
    $('[data-member-message-status]').textContent=incoming.length
      ? `Tienes ${incoming.length} mensaje${incoming.length===1?'':'s'} nuevo${incoming.length===1?'':'s'} de coordinación.`
      : `${rows.length} mensaje${rows.length===1?'':'s'} en esta solicitud.`;
    list.replaceChildren();
    rows.forEach(row=>{
      const card=document.createElement('article');
      card.className='message-card';
      if(row.author_id!==user.id && !row.member_read_at)card.classList.add('is-unread');
      const author=document.createElement('strong');author.textContent=row.author_id===user.id?'Tú':'Coordinación';
      const body=document.createElement('p');body.textContent=row.body;
      const date=document.createElement('small');date.textContent=`${new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Santiago',hour12:false}).format(new Date(row.created_at))} · hora de Chile`;
      card.append(author,body,date);list.append(card);
    });
  }
  async function refreshMemberMessages(){
    if(!user || !application || sessionInvalidated || markingMemberMessages || document.hidden)return;
    const generation=++messagesGeneration;
    const applicationId=application.id;
    const results=await Promise.allSettled([
      supabase.from('application_messages').select('*')
        .eq('application_id',applicationId).is('deleted_at',null).order('created_at',{ascending:true}),
      supabase.rpc('list_my_volunteer_documents')
    ]);
    if(generation!==messagesGeneration || application?.id!==applicationId || sessionInvalidated)return;
    const [messageResult,documentResult]=results.map(result=>result.status==='fulfilled'?result.value:{error:result.reason});
    if(!documentResult.error){
      const documents=documentResult.data||[];
      if(JSON.stringify(documents)!==JSON.stringify(volunteerDocuments)){
        volunteerDocuments=documents;renderDocuments();
      }
    }
    const {data,error}=messageResult;
    if(error)return;
    messages=data||[];
    renderMemberMessages();
    renderMembership();
  }
  async function markMemberMessagesRead(){
    if(!application || sessionInvalidated || markingMemberMessages)return;
    const applicationId=application.id;
    const incoming=messages.filter(row=>row.application_id===applicationId && row.visible_to_member && !row.deleted_at && row.author_id!==user.id && !row.member_read_at);
    if(!incoming.length)return;
    markingMemberMessages=true;
    ++messagesGeneration;
    const button=$('[data-mark-member-messages-read]');button.disabled=true;
    try{
      const {error}=await supabase.rpc('mark_application_messages_read',{p_application_id:applicationId});
      if(error)throw error;
      if(sessionInvalidated || application?.id!==applicationId)return;
      ++messagesGeneration;
      showMessage('[data-member-message-error]','');
      const readAt=new Date().toISOString();
      incoming.forEach(row=>{row.member_read_at=readAt;});
      renderMemberMessages();
    }catch(_){
      if(!sessionInvalidated && application?.id===applicationId)
        showMessage('[data-member-message-error]','No se pudo guardar la lectura. Inténtalo nuevamente.',true);
    }finally{button.disabled=false;markingMemberMessages=false;}
  }
  $('[data-mark-member-messages-read]').addEventListener('click',markMemberMessagesRead);
  $$('[data-jump-member-messages]').forEach(button=>button.addEventListener('click',async()=>{
    $('[data-view-button="membership"]').click();
    const panel=$('[data-member-message-panel]');
    panel.scrollIntoView({block:'start',behavior:'smooth'});
    panel.focus({preventScroll:true});
    await markMemberMessagesRead();
  }));
  setInterval(refreshMemberMessages,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshMemberMessages();});
  function downloadMembershipStatement(kind){
    if(!confirmedPayment || !membership || confirmedPayment.application_id!==membership.application_id)return;
    const isReceipt=kind==='payment';
    const title=isReceipt?'Comprobante de pago confirmado':'Constancia de suscripción activada';
    const name=profile.display_name || `${profile.first_name} ${profile.last_name}`;
    const plan=membership.plan_prices?.plan_id || '—';
    const date=value=>new Intl.DateTimeFormat('es-CL',{dateStyle:'long',timeZone:'America/Santiago'}).format(new Date(value));
    const rows=[
      ['Titular',name],['Plan',plan],['Código de pago',confirmedPayment.id],
      ['Importe del plan',money(confirmedPayment.amount,confirmedPayment.currency)],
      ['Fecha de confirmación',date(confirmedPayment.confirmed_at)]
    ];
    if(isReceipt){
      if(confirmedPayment.provider_reference)rows.push(['Referencia bancaria',confirmedPayment.provider_reference]);
      if(confirmedPayment.settled_amount && confirmedPayment.settled_currency)
        rows.push(['Abono bancario verificado',new Intl.NumberFormat('es-CL',{style:'currency',currency:confirmedPayment.settled_currency,maximumFractionDigits:2}).format(confirmedPayment.settled_amount)]);
    }else{
      rows.push(['Inicio de vigencia',date(membership.starts_at)],['Término de vigencia',date(membership.ends_at)]);
    }
    const protocolUrl=new URL('protocolo-acuerdos-voluntariado.html',location.href).href;
    const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)} · Las Ñañas</title>
      <style>body{font:16px/1.55 system-ui,sans-serif;color:#12343a;max-width:720px;margin:48px auto;padding:0 24px}h1{font:700 2rem Georgia,serif}header{border-bottom:3px solid #197d50;margin-bottom:28px}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #c7ddd8;vertical-align:top}th{width:42%}td{overflow-wrap:anywhere}.note{margin-top:28px;color:#526c70}@media print{body{margin:0;max-width:none}}</style></head>
      <body><header><strong>LAS ÑAÑAS · VOLUNTARIADO</strong><h1>${escapeHtml(title)}</h1></header>
      <p>${isReceipt?'Este comprobante acredita un pago confirmado por administración.':'Esta constancia acredita la activación de la membresía indicada.'}</p>
      <table>${rows.map(([label,value])=>`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>
      <p class="note">Documento generado desde Mi voluntariado. Protocolo y acuerdos: <a href="${escapeHtml(protocolUrl)}">${escapeHtml(protocolUrl)}</a>.</p></body></html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;
    link.download=isReceipt?'comprobante-pago-las-nanas.html':'suscripcion-activada-las-nanas.html';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function renderDocuments(){
    const root=$('[data-documents]');
    root.replaceChildren();
    const builtIn=document.createElement('div');builtIn.className='button-row';
    const protocol=document.createElement('a');protocol.className='btn btn-ghost';
    protocol.href='protocolo-acuerdos-voluntariado.html';
    protocol.download='protocolo-acuerdos-voluntariado.html';
    protocol.textContent='Descargar protocolo y acuerdos';builtIn.append(protocol);
    if(confirmedPayment && membership && confirmedPayment.application_id===membership.application_id){
      for(const [kind,label] of [['payment','Descargar comprobante de pago'],['activation','Descargar constancia de activación']]){
        const button=document.createElement('button');button.className='btn btn-ghost';button.type='button';
        button.textContent=label;button.onclick=()=>downloadMembershipStatement(kind);builtIn.append(button);
      }
    }
    if(hasActiveMembership()){
      const credential=document.createElement('button');credential.className='btn btn-primary';credential.type='button';
      credential.disabled=hasUnsavedProfileChanges() || photoLoadFailed;
      credential.textContent=photoLoadFailed?'Fotografía no disponible; recarga el panel':credential.disabled?'Guarda el perfil para descargar la credencial':'Descargar credencial PNG';
      credential.onclick=()=>$('[data-download-credential]').click();builtIn.append(credential);
    }
    root.append(builtIn);
    const credentialMessage=document.createElement('p');
    credentialMessage.className='field-message';credentialMessage.dataset.credentialDocumentMessage='';credentialMessage.setAttribute('aria-live','polite');
    root.append(credentialMessage);
    if(!volunteerDocuments.length){const empty=document.createElement('div');empty.className='locked';empty.textContent=membership?'Aún no tienes otros documentos disponibles.':'Los archivos de Las Ñañas se habilitarán únicamente después del pago confirmado. Puedes enviar documentación para tu propia solicitud.';root.append(empty);return;}
    const grid=document.createElement('div');grid.className='document-grid';
    volunteerDocuments.forEach(record=>{const card=document.createElement('article');card.className='document';const title=document.createElement('h3');title.textContent=record.original_name;const status=document.createElement('p');status.textContent=record.document_kind==='volunteer_submission'?'Enviado para revisión':'Disponible para descarga';const button=document.createElement('button');button.className='btn btn-ghost';button.type='button';button.textContent='Descargar';button.onclick=()=>downloadVolunteerDocument(record.document_id);card.append(title,status,button);grid.append(card);});
    root.append(grid);
  }

  async function validDocumentFile(file){if(!file||!['application/pdf','image/jpeg','image/png'].includes(file.type)||file.size<1||file.size>10*1024*1024)return false;const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());const pdf=bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d;const jpg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;const png=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);return(file.type==='application/pdf'&&pdf)||(file.type==='image/jpeg'&&jpg)||(file.type==='image/png'&&png);}
  async function downloadVolunteerDocument(documentId){const pathResult=await supabase.rpc('authorize_volunteer_document_download',{p_document_id:documentId});if(pathResult.error||!pathResult.data){showMessage('[data-volunteer-document-message]','No fue posible autorizar la descarga.',true);return;}const signed=await supabase.storage.from('volunteer-documents').createSignedUrl(pathResult.data,60);if(signed.error||!signed.data?.signedUrl){showMessage('[data-volunteer-document-message]','No fue posible generar el enlace privado.',true);return;}window.open(signed.data.signedUrl,'_blank','noopener,noreferrer');}
  const savedProfileName=()=>profile.display_name || `${profile.first_name} ${profile.last_name}`;
  function hasUnsavedProfileChanges(){
    const form=$('[data-profile-form]');
    return form.elements.displayName.value.trim()!==savedProfileName() ||
      Boolean(form.elements.photo.files.length || photoPreview || removePhotoOnSave);
  }
  function credentialData(preview=false){
    const active=hasActiveMembership();
    const expired=Boolean(membership?.ends_at && Date.parse(membership.ends_at)<=Date.now());
    const form=$('[data-profile-form]');
    return {
      templateUrl:$('[data-credential-canvas]').dataset.template,
      name:preview ? (form.elements.displayName.value.trim() || savedProfileName()) : savedProfileName(),
      planId:active ? (membership.plan_prices?.plan_id || price?.plan_id) : (price?.plan_id || membership?.plan_prices?.plan_id),
      expiresAt:active || expired ? membership?.ends_at : null,
      status:active ? 'active' : expired ? 'expired' : 'pending',
      photoUrl:preview ? (photoPreview || (removePhotoOnSave ? '' : storedPhotoUrl)) : storedPhotoUrl
    };
  }
  async function renderCredentialPreview(){
    const generation=++credentialRenderGeneration;
    const preview=document.createElement('canvas');
    try{
      await window.LasNanasCredential.renderToCanvas(preview,credentialData(true));
      if(generation!==credentialRenderGeneration)return;
      const canvas=$('[data-credential-canvas]');
      canvas.width=preview.width;canvas.height=preview.height;
      canvas.getContext('2d').drawImage(preview,0,0);
      canvas.setAttribute('aria-label',`Credencial de ${credentialData(true).name}`);
      showMessage('[data-credential-error]','');
    }catch(_){
      if(generation===credentialRenderGeneration){
        const canvas=$('[data-credential-canvas]');
        canvas.width=0;canvas.height=0;
        showMessage('[data-credential-error]','No se pudo cargar la vista previa de la credencial.',true);
      }
    }
  }
  function renderProfile(syncInput = false){
    if(syncInput)$('[data-profile-form]').elements.displayName.value=savedProfileName();
    void renderCredentialPreview();
    showMessage('[data-photo-load-message]',photoLoadFailed?'No se pudo recuperar la fotografía guardada. Recarga el panel antes de descargar la credencial.':'',photoLoadFailed);
    const download=$('[data-download-credential]');
    download.disabled=!hasActiveMembership() || hasUnsavedProfileChanges() || photoLoadFailed;
    download.textContent=!hasActiveMembership()?'Credencial pendiente de habilitación':photoLoadFailed?'Fotografía no disponible; recarga el panel':download.disabled?'Guarda el perfil para descargar':'Descargar credencial PNG';
  }
  const agendaRecord=(item)=>{const start=new Date(item.starts_at),end=new Date(item.ends_at);return{id:item.id,official:item.official,type:item.type,title:item.title,date:start.toLocaleDateString('en-CA'),start:start.toTimeString().slice(0,5),end:end.toTimeString().slice(0,5),place:item.general_place||'',notes:item.private_notes||'',status:item.status};};
  function renderAgenda(){
    const items=agenda.map(agendaRecord); const root=$('[data-agenda-list]');
    root.innerHTML=items.length?items.map(item=>`<article class="agenda-item ${item.official?'official':''}"><header><div><span class="badge">${item.official?'Actividad oficial':'Anotación personal'}</span><h3>${escapeHtml(item.title)}</h3></div><strong>${item.status}</strong></header><p>${item.date} · ${item.start}–${item.end} · ${escapeHtml(item.place||'Sin lugar indicado')}</p><p>${escapeHtml(item.notes)}</p>${item.official?'':`<div class="button-row"><button class="btn btn-ghost" data-edit-agenda="${item.id}">Editar</button><button class="btn btn-ghost" data-delete-agenda="${item.id}">Eliminar</button></div>`}</article>`).join(''):'<p class="locked">Aún no tienes registros en tu agenda privada.</p>';
    $$('[data-edit-agenda]').forEach(button=>button.onclick=()=>editAgenda(button.dataset.editAgenda)); $$('[data-delete-agenda]').forEach(button=>button.onclick=()=>deleteAgenda(button.dataset.deleteAgenda));
    const calendar=$('[data-agenda-calendar]');
    const states={confirmed:'Confirmada',planned:'Planificada',completed:'Realizada',cancelled:'Cancelada'};
    const months=[...new Set(items.map(item=>item.date.slice(0,7)))].sort();
    if(!months.length){calendar.innerHTML='<p class="locked">Sin fechas registradas.</p>';return;}
    const weekdays=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const legend=`<div class="calendar-legend" aria-label="Estados de la agenda">${Object.entries(states).map(([status,label])=>`<span><i class="calendar-mark is-status-${status}" aria-hidden="true"></i>${label}</span>`).join('')}</div>`;
    calendar.innerHTML=legend+months.map(month=>{
      const [year,monthNumber]=month.split('-').map(Number);
      const first=new Date(year,monthNumber-1,1);
      const dayCount=new Date(year,monthNumber,0).getDate();
      const offset=(first.getDay()+6)%7;
      const monthLabel=new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(first);
      const cells=Array.from({length:Math.ceil((offset+dayCount)/7)*7},(_,index)=>{
        const day=index-offset+1;
        if(day<1 || day>dayCount)return '<td class="calendar-empty" aria-hidden="true"></td>';
        const date=`${month}-${String(day).padStart(2,'0')}`;
        const entries=items.filter(item=>item.date===date);
        const statuses=[...new Set(entries.map(item=>Object.hasOwn(states,item.status)?item.status:'planned'))];
        const details=entries.map(item=>`${states[item.status]||'Planificada'} · ${item.start}–${item.end} · ${item.title}${item.official?' · Actividad oficial':''}`).join('\n');
        const label=`${day} de ${monthLabel}${entries.length?`\n${details}`:': sin registros'}`;
        const statusClass=statuses.length===1?` is-status-${statuses[0]}`:'';
        return `<td><div class="calendar-date${entries.length?' has-events':''}${statusClass}" role="group"${entries.length?' tabindex="0"':''} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><time datetime="${date}">${day}</time>${entries.length?`<span class="calendar-date-marks" aria-hidden="true">${statuses.map(status=>`<i class="calendar-mark is-status-${status}"></i>`).join('')}</span>`:''}</div></td>`;
      });
      const rows=Array.from({length:cells.length/7},(_,index)=>`<tr>${cells.slice(index*7,index*7+7).join('')}</tr>`).join('');
      return `<table class="calendar-month"><caption>${monthLabel}</caption><thead><tr>${weekdays.map(day=>`<th scope="col"><abbr title="${day}">${day.slice(0,2)}</abbr></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
  }
  const escapeHtml=value=>String(value||'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const renderAll=()=>{renderHeader();renderMembership();renderMemberMessages();renderProfile(true);renderDocuments();renderAgenda();};

  $$('[data-view-button]').forEach(button=>button.onclick=()=>{$$('[data-view-button]').forEach(item=>item.classList.toggle('active',item===button));$$('[data-view]').forEach(view=>{view.hidden=view.dataset.view!==button.dataset.viewButton;});});
  $('[data-membership-form]').addEventListener('change',async event=>{
    if(!application || application.status!=='draft' || membershipSelectionSaving)return;
    membershipSelectionSaving=true;
    const form=event.currentTarget; const plan=form.elements.plan.value; const billing=form.elements.billing.value; const currency=form.elements.currency.value;
    const saveState=$('[data-save-state]');
    form.querySelectorAll('button,input').forEach(control=>{control.disabled=true;});
    form.setAttribute('aria-busy','true');
    saveState.classList.add('saving');saveState.textContent='Guardando tu selección…';
    let saved=false;
    try{const selectedPrice=await currentPrice(plan);const values={plan_price_id:selectedPrice.id,billing,currency,quoted_amount:quote(selectedPrice,billing,currency),respect_accepted:form.elements.respect.checked,coordination_accepted:form.elements.coordination.checked,updated_at:new Date().toISOString()};const{data,error}=await supabase.from('membership_applications').update(values).eq('id',application.id).eq('status','draft').select('*,plan_prices(*)').single();if(error)throw error;application=data;price=data.plan_prices;saved=true;showMessage('[data-membership-message]','Cambios guardados.');renderProfile();}catch(error){showMessage('[data-membership-message]','No se pudieron guardar los cambios.',true);}finally{membershipSelectionSaving=false;form.querySelectorAll('button,input').forEach(control=>{control.disabled=false;});form.setAttribute('aria-busy','false');saveState.classList.remove('saving');saveState.textContent=saved?'Todos los cambios están guardados.':'No se pudieron guardar los cambios.';renderMembership();}
  });
  $$('[data-save-later]').forEach(button=>button.onclick=()=>showMessage(button.closest('[data-clarification-form]')?'[data-clarification-message]':'[data-membership-message]','Los cambios enviados ya están guardados en tu cuenta.'));
  $('[data-membership-form]').addEventListener('submit',async event=>{event.preventDefault();const button=$('[data-submit-application]');button.disabled=true;showMessage('[data-membership-message]','Enviando solicitud…');const{error}=await supabase.rpc('submit_membership_application',{p_application_id:application.id});if(error){showMessage('[data-membership-message]','No se pudo enviar la solicitud.',true);button.disabled=false;return;}await loadAll();showMessage('[data-membership-message]','Solicitud enviada correctamente.');});
  $('[data-previous-step]').onclick=()=>showMessage('[data-membership-message]',application?.status==='draft'?'Ya estás en el primer paso editable.':'El estado enviado no se revierte desde el navegador.');

  $('[data-clarification-form]').addEventListener('submit',async event=>{event.preventDefault();const body=event.currentTarget.elements.reply.value.trim();if(!body){showMessage('[data-clarification-message]','Escribe una respuesta.',true);return;}setBusy(event.currentTarget,true);const{error}=await supabase.rpc('respond_to_membership_clarification',{p_application_id:application.id,p_body:body});setBusy(event.currentTarget,false);if(error){showMessage('[data-clarification-message]','No se pudo enviar la respuesta. Comprueba que tu solicitud siga esperando una aclaración e inténtalo nuevamente.',true);return;}event.currentTarget.elements.reply.value='';await loadAll();});
  // Adjuntos siguen fuera de alcance: no se suben hasta implementar la Edge Function segura.
  $('[data-clarification-form]').elements.attachments.addEventListener('change',event=>{event.target.value='';showMessage('[data-clarification-message]','Los adjuntos permanecen deshabilitados hasta conectar su función segura.',true);});

  $('[data-profile-form]').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const displayName=form.elements.displayName.value.trim();
    const file=form.elements.photo.files[0];
    if(displayName.length<2){showMessage('[data-profile-message]','Escribe un nombre de uso válido.',true);return;}
    if(file && !(await validPhotoFile(file))){showMessage('[data-profile-message]','Selecciona una imagen JPG, PNG o WebP válida de hasta 4 MiB.',true);return;}
    const previousPath=profile.photo_path;
    let newPath='', committed=false;
    setBusy(form,true);
    showMessage('[data-profile-message]','Guardando perfil y fotografía…');
    try{
      if(file){
        newPath=`${user.id}/${crypto.randomUUID()}.${photoExtension[file.type]}`;
        const uploaded=await photoBucket().upload(newPath,file,{contentType:file.type,upsert:false});
        if(uploaded.error)throw uploaded.error;
      }
      const values={display_name:displayName,updated_at:new Date().toISOString()};
      if(newPath || removePhotoOnSave)values.photo_path=newPath || null;
      const{data,error}=await supabase.from('volunteer_profiles').update(values).eq('id',user.id).select().single();
      if(error)throw error;
      profile=data;
      committed=true;
      if((newPath || removePhotoOnSave) && previousPath && previousPath!==newPath) await photoBucket().remove([previousPath]);
      photoPreview='';removePhotoOnSave=false;form.elements.photo.value='';
      await loadStoredPhoto();
      renderProfile();
      renderDocuments();
      showMessage('[data-profile-message]',photoLoadFailed?'Perfil guardado, pero no pudimos recuperar la fotografía. Recarga el panel.':'Perfil y fotografía guardados.',photoLoadFailed);
    }catch(_){
      if(newPath && !committed)await photoBucket().remove([newPath]);
      showMessage('[data-profile-message]','No se pudo guardar el perfil o la fotografía. Intenta nuevamente.',true);
    }finally{setBusy(form,false);}
  });

  $('[data-volunteer-document-form]').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const file=form.elements.document.files[0];if(!application){showMessage('[data-volunteer-document-message]','Primero debes tener una solicitud guardada.',true);return;}if(!(await validDocumentFile(file))){showMessage('[data-volunteer-document-message]','Selecciona un PDF, JPG o PNG válido de hasta 10 MB.',true);return;}setBusy(form,true);showMessage('[data-volunteer-document-message]','Preparando carga privada…');const reserve=await supabase.rpc('reserve_volunteer_document_upload',{p_application_id:application.id,p_original_name:file.name,p_mime_type:file.type,p_byte_size:file.size});const reservation=reserve.data?.[0];if(reserve.error||!reservation){setBusy(form,false);showMessage('[data-volunteer-document-message]','No fue posible reservar el archivo para tu solicitud.',true);return;}const uploaded=await supabase.storage.from('volunteer-documents').upload(reservation.storage_path,file,{contentType:file.type,upsert:false});setBusy(form,false);if(uploaded.error){showMessage('[data-volunteer-document-message]','No fue posible completar la carga.',true);return;}form.reset();const refreshed=await supabase.rpc('list_my_volunteer_documents');if(!refreshed.error)volunteerDocuments=refreshed.data||[];renderDocuments();showMessage('[data-volunteer-document-message]','Documento enviado de forma privada.');});
  $('[data-profile-form]').elements.photo.addEventListener('change',async event=>{
    const file=event.target.files[0];
    if(!file)return;
    if(!(await validPhotoFile(file))){event.target.value='';showMessage('[data-profile-message]','Selecciona una imagen JPG, PNG o WebP válida de hasta 4 MiB.',true);return;}
    removePhotoOnSave=false;
    const reader=new FileReader();
    reader.onload=()=>{if(event.target.files[0]===file){photoPreview=reader.result;renderProfile();renderDocuments();}};
    reader.readAsDataURL(file);
    showMessage('[data-profile-message]','Fotografía lista. Pulsa “Guardar perfil” para conservarla.');
  });
  $('[data-profile-form]').elements.displayName.addEventListener('input',()=>{renderProfile();renderDocuments();});
  $('[data-remove-photo]').onclick=()=>{photoPreview='';removePhotoOnSave=true;$('[data-profile-form]').elements.photo.value='';renderProfile();renderDocuments();showMessage('[data-profile-message]','Pulsa “Guardar perfil” para quitar la fotografía.');};
  $('[data-download-credential]').onclick=async()=>{
    if(!hasActiveMembership() || hasUnsavedProfileChanges() || photoLoadFailed)return;
    const button=$('[data-download-credential]');
    button.disabled=true;
    try{
      const canvas=document.createElement('canvas');
      await window.LasNanasCredential.renderToCanvas(canvas,credentialData());
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('No se pudo generar el archivo PNG.');
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='credencial-las-nanas.png';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      showMessage('[data-credential-error]','');
      showMessage('[data-credential-document-message]','');
    }catch(_){
      showMessage('[data-credential-error]','No se pudo generar la credencial. Intenta nuevamente.',true);
      showMessage('[data-credential-document-message]','No se pudo generar la credencial. Intenta nuevamente.',true);
    }
    finally{button.disabled=!hasActiveMembership() || hasUnsavedProfileChanges() || photoLoadFailed;}
  };

  const agendaForm=$('[data-agenda-form]');
  agendaForm.addEventListener('submit',async event=>{event.preventDefault();if(!agendaForm.reportValidity())return;const data=Object.fromEntries(new FormData(agendaForm));const start=new Date(`${data.date}T${data.start}`),end=new Date(`${data.date}T${data.end}`);if(end<=start){showMessage('[data-agenda-message]','La hora de término debe ser posterior al inicio.',true);return;}const values={owner_id:user.id,created_by:user.id,official:false,type:data.type,title:data.title.trim(),starts_at:start.toISOString(),ends_at:end.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,general_place:data.place.trim()||null,private_notes:data.notes.trim()||null,status:data.status,updated_at:new Date().toISOString()};setBusy(agendaForm,true);const result=data.id?await supabase.from('agenda_entries').update(values).eq('id',data.id).eq('owner_id',user.id).eq('official',false):await supabase.from('agenda_entries').insert(values);setBusy(agendaForm,false);if(result.error){showMessage('[data-agenda-message]','No se pudo guardar el registro.',true);return;}agendaForm.reset();showMessage('[data-agenda-message]','Registro guardado.');await reloadAgenda();});
  function editAgenda(id){const item=agenda.find(entry=>entry.id===id&&!entry.official);if(!item)return;const value=agendaRecord(item);Object.entries(value).forEach(([key,val])=>{if(agendaForm.elements[key])agendaForm.elements[key].value=val;});agendaForm.scrollIntoView({behavior:'smooth'});}
  async function deleteAgenda(id){if(!confirm('¿Eliminar este registro?'))return;const{error}=await supabase.from('agenda_entries').delete().eq('id',id).eq('owner_id',user.id).eq('official',false);if(error){showMessage('[data-agenda-message]','No se pudo eliminar.',true);return;}await reloadAgenda();}
  async function reloadAgenda(){const{data,error}=await supabase.from('agenda_entries').select('*').is('deleted_at',null).order('starts_at');if(error){showMessage('[data-agenda-message]','No se pudo actualizar la agenda.',true);return;}agenda=data||[];renderAgenda();}
  $('[data-cancel-agenda]').onclick=()=>{agendaForm.reset();showMessage('[data-agenda-message]','');};
  $$('[data-agenda-view]').forEach(button=>button.onclick=()=>{$$('[data-agenda-view]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});$('[data-agenda-list]').hidden=button.dataset.agendaView!=='list';$('[data-agenda-calendar]').hidden=button.dataset.agendaView!=='calendar';});
  $('[data-logout]').onclick=async()=>{setGlobal('Cerrando sesión…');loader?.show('Cerrando tu sesión…');try{await supabase.auth.signOut();sessionStorage.removeItem('lasnanas_pending_selection_v3');sessionStorage.removeItem('lasnanas_visual_demo_v1');location.assign('voluntariado.html#membresias');}finally{loader?.hide();}};

  try{
    await loadAll();
    if (user && !workspace.hidden && ['documents', 'profile'].includes(query.get('view')))
      $(`[data-view-button="${query.get('view')}"]`).click();
  }catch(error){setGlobal('No se pudo cargar tu espacio privado. Revisa la conexión o las políticas RLS.',true);}
});
