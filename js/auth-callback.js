/* Confirmación de correo: no imprime sesiones, tokens ni metadatos. */
document.addEventListener('DOMContentLoaded', async () => {
  const client = window.LasNanasSupabase?.client;
  const status = document.querySelector('[data-auth-callback-status]');
  const back = document.querySelector('[data-auth-callback-back]');
  const loader = window.LasNanasLoader;
  const retryMessage = 'No pudimos abrir tu sesión desde este enlace. Si ya confirmaste tu correo, ingresa con tu contraseña en Mi Ruka. Si aún aparece pendiente, solicita un nuevo enlace desde allí.';
  let completed = false;
  let checking = false;
  let timer;

  const fail = message => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    loader?.hide();
    status.textContent = message;
    back.hidden = false;
  };

  loader?.show('Confirmando tu correo…');
  if (!client) {
    fail(window.LasNanasSupabase?.error || 'Falta configurar Supabase.');
    return;
  }

  // Supabase puede devolver un error en la query o en el fragmento del enlace.
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const authError = query.get('error_code') || fragment.get('error_code') || query.get('error') || fragment.get('error');
  if (authError) {
    fail(authError === 'otp_expired'
      ? 'El enlace expiró o ya se utilizó. Ingresa en Mi Ruka; si tu correo sigue pendiente, solicita uno nuevo desde allí.'
      : retryMessage);
    return;
  }

  const finish = async () => {
    if (completed || checking) return;
    checking = true;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) return;
      const adminCheck = await client.rpc('admin_list_membership_applications');
      if (!adminCheck.error) {
        completed = true;
        clearTimeout(timer);
        location.replace('coordinacion-voluntariado.html');
        return;
      }
      if (adminCheck.error.code !== '42501' && !/admin_access_required/i.test(adminCheck.error.message || '')) {
        fail('No pudimos comprobar el acceso. Ingresa nuevamente desde Mi Ruka.');
        return;
      }
      completed = true;
      clearTimeout(timer);
      const meta = data.user.user_metadata || {};
      const params = new URLSearchParams();
      if (['keyuwün', 'kimün', 'pülli'].includes(meta.selected_plan)) params.set('plan', meta.selected_plan);
      if (['monthly', 'yearly'].includes(meta.selected_billing)) params.set('billing', meta.selected_billing);
      if (['CLP', 'USD'].includes(meta.selected_currency)) params.set('currency', meta.selected_currency);
      location.replace(`mi-voluntariado.html${params.size ? `?${params}` : ''}`);
    } catch (_) {
      fail('No pudimos comprobar el acceso. Ingresa nuevamente desde Mi Ruka.');
    } finally {
      checking = false;
    }
  };

  client.auth.onAuthStateChange(event => {
    if (['SIGNED_IN', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event)) setTimeout(finish, 0);
  });
  timer = setTimeout(() => fail(retryMessage), 15000);

  // Mantiene válidos los enlaces PKCE enviados antes de esta corrección cuando
  // se abren en el mismo navegador donde se inició el registro.
  const code = query.get('code');
  if (code) {
    try {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) { fail(retryMessage); return; }
    } catch (_) { fail(retryMessage); return; }
  }
  await finish();
});
