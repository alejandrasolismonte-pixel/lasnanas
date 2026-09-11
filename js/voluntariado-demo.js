/* ACCESO REAL DE VOLUNTARIADO
   Supabase Auth administra contraseñas y sesiones. Este archivo solo conserva
   temporalmente la selección visual; RLS y el servidor autorizan los datos. */
document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.querySelector('[data-membership-auth]');
  const planButtons = [...document.querySelectorAll('[data-membership-plan]')];
  const miRukaButton = document.querySelector('[data-mi-ruka]');
  const controls = document.querySelector('.membership-controls');
  const supabase = window.LasNanasSupabase?.client;
  const loader = window.LasNanasLoader;
  if (!dialog || !planButtons.length) return;

  let selection = { plan: 'keyuwün', billing: 'monthly', currency: 'CLP' };
  let opener = null;
  let dirty = false;
  let accessMode = 'plan';
  const normalizeEmail = value => value.trim().toLowerCase();
  const portalUrl = () => new URL(`mi-voluntariado.html?plan=${encodeURIComponent(selection.plan)}&billing=${selection.billing}&currency=${selection.currency}`, window.location.href).href;
  const callbackUrl = () => new URL('auth-callback.html', window.location.href).href;
  const recoveryUrl = () => new URL('actualizar-contrasena.html', window.location.href).href;
  const status = (selector, message, error = false) => { const node = dialog.querySelector(selector); if (node) { node.textContent = message; node.style.color = error ? '#a11b13' : ''; } };
  // ESPERA ACCESIBLE: bloquea dobles envíos y muestra el loader solo en registro.
  const busy = (form, enabled) => {
    form.querySelectorAll('button,input,select').forEach(control => { control.disabled = enabled; });
    form.setAttribute('aria-busy', String(enabled));
    const label = form.querySelector('[data-submit-label]');
    if (label) label.textContent = enabled ? 'Creando cuenta…' : 'Crear cuenta y continuar';
    if (enabled) loader?.show(form.matches('[data-register-form]') ? 'Creando tu cuenta…' : 'Ingresando a tu espacio…');
    else loader?.hide();
  };
  const setError = (form, field, id, message) => { form.elements[field]?.setAttribute('aria-invalid', message ? 'true' : 'false'); const node = document.getElementById(id); if (node) node.textContent = message; };
  const clearErrors = form => { form.querySelectorAll('.field-error').forEach(node => { node.textContent = ''; }); form.querySelectorAll('[aria-invalid]').forEach(node => node.setAttribute('aria-invalid', 'false')); };
  const saveUiSelection = () => sessionStorage.setItem('lasnanas_pending_selection_v3', JSON.stringify(selection));
  const goToPortal = () => { saveUiSelection(); window.location.assign(portalUrl()); };

  // La RPC de la migración 004 actúa como comprobación administrativa protegida.
  const routeAuthenticatedRuka = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;
    const adminCheck = await supabase.rpc('admin_list_membership_applications');
    window.location.assign(adminCheck.error ? 'mi-voluntariado.html' : 'coordinacion-voluntariado.html');
    return true;
  };

  const updateSummary = () => {
    dialog.querySelector('[data-auth-plan]').textContent = selection.plan;
    dialog.querySelector('[data-auth-billing]').textContent = selection.billing === 'yearly' ? 'anual' : 'mensual';
  };
  const activateTab = name => {
    dialog.querySelectorAll('[data-auth-tab]').forEach(tab => { const active = tab.dataset.authTab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    dialog.querySelectorAll('[data-auth-panel]').forEach(panel => { panel.hidden = panel.dataset.authPanel !== name; });
    dialog.querySelector(`[data-auth-panel="${name}"] input`)?.focus();
  };
  const requireClient = formSelector => {
    if (supabase) return true;
    status(formSelector, window.LasNanasSupabase?.error || 'No se pudo iniciar Supabase.', true);
    return false;
  };

  planButtons.forEach(button => button.addEventListener('click', async event => {
    event.preventDefault(); opener = button; accessMode = 'plan';
    selection = {
      plan: button.dataset.membershipPlan,
      billing: controls?.elements?.billing?.value === 'yearly' ? 'yearly' : 'monthly',
      currency: controls?.elements?.currency?.value === 'usd' ? 'USD' : 'CLP'
    };
    saveUiSelection(); updateSummary();
    dialog.querySelector('[data-auth-selection-summary]').hidden = false;
    if (!supabase) { dialog.showModal(); status('[data-register-status]', window.LasNanasSupabase?.error || 'Falta la configuración de Supabase.', true); return; }
    // getUser consulta Auth y evita confiar en una sesión manipulada localmente.
    loader?.show('Comprobando tu sesión…');
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) { goToPortal(); return; }
    } finally { loader?.hide(); }
    dialog.showModal(); dialog.querySelector('[data-auth-tab][aria-selected="true"]')?.focus();
  }));

  const openMiRuka = async openerElement => {
    opener = openerElement;
    accessMode = 'ruka';
    dialog.querySelector('[data-auth-selection-summary]').hidden = true;
    activateTab('login');
    if (!supabase) {
      dialog.showModal();
      status('[data-login-status]', window.LasNanasSupabase?.error || 'Falta la configuración de Supabase.', true);
      return;
    }
    loader?.show('Comprobando tu sesión…');
    try {
      if (await routeAuthenticatedRuka()) return;
    } finally { loader?.hide(); }
    dialog.showModal();
    activateTab('login');
  };

  miRukaButton?.addEventListener('click', event => {
    event.preventDefault();
    openMiRuka(miRukaButton);
  });

  // Ruta fija usada exclusivamente al regresar desde un acceso directo rechazado al panel.
  if (new URLSearchParams(window.location.search).get('access') === 'mi-ruka') {
    openMiRuka(miRukaButton);
  }

  dialog.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.authTab));
    tab.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); activateTab(tab.dataset.authTab === 'create' ? 'login' : 'create'); });
  });
  const closeDialog = () => { if (dirty && !window.confirm('Hay datos sin enviar. ¿Quieres cerrar igualmente?')) return; dialog.close(); };
  dialog.querySelector('[data-auth-close]').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('close', () => opener?.focus());
  dialog.querySelectorAll('input,select').forEach(field => field.addEventListener('input', () => { dirty = true; }));
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[href]')].filter(item => !item.closest('[hidden]'));
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  });
  dialog.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => { const field = button.parentElement.querySelector('input'); field.type = field.type === 'password' ? 'text' : 'password'; button.textContent = field.type === 'password' ? 'Mostrar' : 'Ocultar'; field.focus(); }));

  const register = dialog.querySelector('[data-register-form]');
  register.addEventListener('submit', async event => {
    event.preventDefault(); clearErrors(register); status('[data-register-status]', '');
    if (!requireClient('[data-register-status]')) return;
    const firstName = register.elements.firstName.value.trim(); const lastName = register.elements.lastName.value.trim();
    const email = normalizeEmail(register.elements.email.value); const password = register.elements.password.value; const country = register.elements.country.value;
    let valid = true;
    if (firstName.length < 2) { setError(register,'firstName','register-name-error','Escribe tu nombre.'); valid=false; }
    if (lastName.length < 2) { setError(register,'lastName','register-last-name-error','Escribe tu apellido.'); valid=false; }
    if (!register.elements.email.validity.valid) { setError(register,'email','register-email-error','Escribe un correo válido.'); valid=false; }
    if (!country) { setError(register,'country','register-country-error','Selecciona tu país.'); valid=false; }
    if (password.length < 12 || password.length > 256) { setError(register,'password','register-password-error','Usa entre 12 y 256 caracteres.'); valid=false; }
    if (!valid) { register.querySelector('[aria-invalid="true"]')?.focus(); return; }
    busy(register,true); status('[data-register-status]','Creando la cuenta…');
    try {
      // Desde Mi Ruka puede crearse una cuenta, pero nunca se adjunta una selección de inscripción implícita.
      const metadata = { first_name:firstName, last_name:lastName, country_code:country };
      if (accessMode === 'plan') Object.assign(metadata, { selected_plan:selection.plan, selected_billing:selection.billing, selected_currency:selection.currency });
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(), data: metadata } });
      if (error) throw error;
      dirty=false; register.elements.password.value=''; if(accessMode==='plan')saveUiSelection();
      if (data.session) { if(accessMode==='ruka')await routeAuthenticatedRuka();else goToPortal(); }
      else status('[data-register-status]','Revisa tu correo para confirmar la cuenta. Conservaremos el plan seleccionado al regresar.');
    } catch (error) {
      const message = /already|registered|exists/i.test(error.message) ? 'Este correo ya tiene una cuenta. Utiliza “Ya tengo cuenta”.' : error.message;
      status('[data-register-status]',message || 'No se pudo crear la cuenta.',true);
    } finally { busy(register,false); }
  });

  const login = dialog.querySelector('[data-login-form]');
  login.addEventListener('submit', async event => {
    event.preventDefault(); clearErrors(login); status('[data-login-status]','');
    if (!requireClient('[data-login-status]')) return;
    const email=normalizeEmail(login.elements.email.value); const password=login.elements.password.value;
    if (!login.elements.email.validity.valid) { setError(login,'email','login-email-error','Escribe un correo válido.'); return; }
    if (!password) { setError(login,'password','login-password-error','Escribe tu contraseña.'); return; }
    busy(login,true); status('[data-login-status]','Iniciando sesión…');
    try { const { error }=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; dirty=false; login.elements.password.value=''; if(accessMode==='ruka')await routeAuthenticatedRuka();else goToPortal(); }
    catch(error){ status('[data-login-status]',/confirm/i.test(error.message)?'Debes confirmar tu correo antes de ingresar.':'Correo o contraseña incorrectos.',true); }
    finally{ busy(login,false); }
  });

  // El mensaje es deliberadamente neutro para evitar revelar si un correo existe.
  dialog.querySelector('[data-demo-recovery]').addEventListener('click', async () => {
    if (!requireClient('[data-login-status]')) return;
    const email=normalizeEmail(login.elements.email.value);
    if (!login.elements.email.validity.valid) { setError(login,'email','login-email-error','Escribe primero un correo válido.'); return; }
    status('[data-login-status]','Solicitando recuperación…');
    loader?.show('Preparando la recuperación de acceso…');
    try {
      const { error }=await supabase.auth.resetPasswordForEmail(email,{redirectTo:recoveryUrl()});
      status('[data-login-status]',error ? 'No se pudo solicitar la recuperación. Intenta nuevamente.' : 'Si el correo pertenece a una cuenta, recibirás instrucciones.',Boolean(error));
    } finally { loader?.hide(); }
  });
});
