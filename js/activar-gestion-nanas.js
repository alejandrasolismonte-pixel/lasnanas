/* Contraseña exclusiva de la cuenta encargada de Ñañas. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async function () {
    const form = document.querySelector('[data-activation-form]');
    const status = document.querySelector('[data-activation-status]');
    const config = window.LAS_NANAS_CONFIG;
    const validConfig = config?.supabaseUrl && config?.supabasePublishableKey &&
      !/service_role|secret/i.test(config.supabasePublishableKey) && window.supabase?.createClient;
    if (!validConfig) {
      status.textContent = 'No fue posible conectar con el servicio de acceso.';
      return;
    }

    const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
        storageKey: 'lasnanas-nanas-auth-v1' }
    });

    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        status.textContent = 'El enlace no es válido o expiró. Solicita uno nuevo desde el acceso de Ñañas.';
        return;
      }
      const { data: allowed, error: roleError } = await client.rpc('is_nanas_manager');
      if (roleError || allowed !== true) {
        await client.auth.signOut();
        status.textContent = 'Esta cuenta no tiene permiso para gestionar Ñañas.';
        return;
      }
      status.textContent = 'Cuenta verificada. Ingresa una contraseña de al menos 12 caracteres.';
      status.classList.add('is-success');
      form.hidden = false;
    } catch (_) {
      status.textContent = 'No fue posible validar el enlace. Solicita uno nuevo.';
      return;
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const password = form.elements.password.value;
      const confirmation = form.elements.confirmation.value;
      if (password.length < 12) {
        status.textContent = 'Usa al menos 12 caracteres.';
        status.classList.remove('is-success');
        return;
      }
      if (password !== confirmation) {
        status.textContent = 'Las contraseñas no coinciden.';
        status.classList.remove('is-success');
        return;
      }
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      status.textContent = 'Guardando contraseña…';
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        form.reset();
        form.hidden = true;
        status.textContent = 'Contraseña guardada. Volviendo al panel de Ñañas…';
        status.classList.add('is-success');
        location.replace('gestion-nanas.html');
      } catch (_) {
        status.textContent = 'No fue posible guardar la contraseña. Intenta nuevamente.';
        status.classList.remove('is-success');
        button.disabled = false;
      }
    });
  });
})();
