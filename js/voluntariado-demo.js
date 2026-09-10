/* FLUJO PÚBLICO DE INSCRIPCIÓN
   Abre el acceso desde las tarjetas existentes y entrega el plan al portal.
   La sesión de demostración usa sessionStorage: no sustituye una base de datos. */
document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.querySelector('[data-membership-auth]');
  const planButtons = [...document.querySelectorAll('[data-membership-plan]')];
  const controls = document.querySelector('.membership-controls');
  if (!dialog || !planButtons.length) return;

  const DEMO_ACCOUNTS = 'lasnanas_demo_accounts_v2';
  const DEMO_SESSION = 'lasnanas_demo_session_v2';
  let selection = { plan: 'keyuwün', billing: 'monthly' };
  let opener = null;
  let dirty = false;
  const readAccounts = () => { try { return JSON.parse(sessionStorage.getItem(DEMO_ACCOUNTS) || '[]'); } catch (_) { return []; } };
  const saveAccounts = accounts => sessionStorage.setItem(DEMO_ACCOUNTS, JSON.stringify(accounts));
  const normalizedEmail = value => value.trim().toLowerCase();
  const portalUrl = () => `mi-voluntariado.html?plan=${encodeURIComponent(selection.plan)}&billing=${selection.billing}`;
  const status = (selector, message) => { const node = dialog.querySelector(selector); if (node) node.textContent = message; };
  const setError = (form, field, id, message) => {
    form.elements[field]?.setAttribute('aria-invalid', message ? 'true' : 'false');
    const target = document.getElementById(id); if (target) target.textContent = message;
  };
  const clearErrors = form => {
    form.querySelectorAll('.field-error').forEach(node => { node.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(node => node.setAttribute('aria-invalid', 'false'));
  };
  const goToPortal = email => {
    sessionStorage.setItem(DEMO_SESSION, email);
    sessionStorage.setItem('lasnanas_pending_selection_v2', JSON.stringify(selection));
    window.location.assign(portalUrl());
  };

  // Sincroniza el resumen del modal con la tarjeta y periodicidad elegidas.
  const updateSummary = () => {
    dialog.querySelector('[data-auth-plan]').textContent = selection.plan;
    dialog.querySelector('[data-auth-billing]').textContent = selection.billing === 'yearly' ? 'anual' : 'mensual';
  };
  const activateTab = name => {
    dialog.querySelectorAll('[data-auth-tab]').forEach(tab => {
      const active = tab.dataset.authTab === name;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    });
    dialog.querySelectorAll('[data-auth-panel]').forEach(panel => { panel.hidden = panel.dataset.authPanel !== name; });
    dialog.querySelector(`[data-auth-panel="${name}"] input`)?.focus();
  };

  planButtons.forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); opener = button;
    selection = { plan: button.dataset.membershipPlan, billing: controls?.elements?.billing?.value === 'yearly' ? 'yearly' : 'monthly' };
    // Una sesión existente pasa directamente a revisar el plan seleccionado.
    if (sessionStorage.getItem(DEMO_SESSION)) { goToPortal(sessionStorage.getItem(DEMO_SESSION)); return; }
    updateSummary(); dialog.showModal();
    dialog.querySelector('[data-auth-tab][aria-selected="true"]')?.focus();
  }));

  dialog.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.authTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); activateTab(tab.dataset.authTab === 'create' ? 'login' : 'create');
    });
  });
  const closeDialog = () => {
    if (dirty && !window.confirm('Hay datos sin guardar. ¿Quieres cerrar igualmente?')) return;
    dialog.close();
  };
  dialog.querySelector('[data-auth-close]').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('close', () => opener?.focus());
  dialog.querySelectorAll('input,select').forEach(field => field.addEventListener('input', () => { dirty = true; }));

  // Mantiene el foco dentro del modal para navegación por teclado.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[href]')].filter(item => !item.closest('[hidden]'));
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  });
  dialog.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const field = button.parentElement.querySelector('input');
    field.type = field.type === 'password' ? 'text' : 'password';
    button.textContent = field.type === 'password' ? 'Mostrar' : 'Ocultar'; field.focus();
  }));

  const register = dialog.querySelector('[data-register-form]');
  register.addEventListener('submit', event => {
    event.preventDefault(); clearErrors(register);
    const firstName = register.elements.firstName.value.trim();
    const lastName = register.elements.lastName.value.trim();
    const email = normalizedEmail(register.elements.email.value);
    const password = register.elements.password.value;
    let valid = true;
    if (firstName.length < 2) { setError(register, 'firstName', 'register-name-error', 'Escribe tu nombre.'); valid = false; }
    if (lastName.length < 2) { setError(register, 'lastName', 'register-last-name-error', 'Escribe tu apellido.'); valid = false; }
    if (!register.elements.email.validity.valid) { setError(register, 'email', 'register-email-error', 'Escribe un correo válido.'); valid = false; }
    if (!register.elements.country.value) { setError(register, 'country', 'register-country-error', 'Selecciona tu país.'); valid = false; }
    if (password.length < 12) { setError(register, 'password', 'register-password-error', 'Usa al menos 12 caracteres.'); valid = false; }
    if (!valid) { register.querySelector('[aria-invalid="true"]')?.focus(); return; }
    const accounts = readAccounts();
    if (accounts.some(account => account.email === email)) { setError(register, 'email', 'register-email-error', 'La cuenta ya existe en esta demostración. Inicia sesión.'); return; }
    // La contraseña no se persiste localmente; Supabase Auth la administrará al conectarse.
    accounts.push({ id: crypto.randomUUID(), firstName, lastName, email, country: register.elements.country.value });
    saveAccounts(accounts); dirty = false; goToPortal(email);
  });

  const login = dialog.querySelector('[data-login-form]');
  login.addEventListener('submit', event => {
    event.preventDefault(); clearErrors(login);
    const email = normalizedEmail(login.elements.email.value);
    const account = readAccounts().find(item => item.email === email);
    if (!login.elements.email.validity.valid || !account) { setError(login, 'email', 'login-email-error', 'No encontramos esta cuenta en la sesión de demostración.'); return; }
    if (!login.elements.password.value) { setError(login, 'password', 'login-password-error', 'Escribe tu contraseña.'); return; }
    dirty = false; goToPortal(email);
  });

  // La recuperación real se activará con Supabase Auth; nunca se simula un envío exitoso.
  dialog.querySelector('[data-demo-recovery]').addEventListener('click', () => status('[data-login-status]', 'Recuperación pendiente de conectar a Supabase. No se envió ningún correo.'));
});
