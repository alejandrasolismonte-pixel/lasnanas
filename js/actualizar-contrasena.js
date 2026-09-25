/* Actualiza la contraseña únicamente después de validar la sesión de recuperación. */
document.addEventListener('DOMContentLoaded', async()=>{
  const client=window.LasNanasSupabase?.client;const form=document.querySelector('[data-password-update]');const status=document.querySelector('[data-password-status]');
  const loader=window.LasNanasLoader;
  loader?.show('Validando el enlace de recuperación…');
  if(!client){loader?.hide();status.textContent=window.LasNanasSupabase?.error||'Falta configurar Supabase.';form.querySelector('button').disabled=true;return;}
  const{data,error}=await client.auth.getUser();loader?.hide();if(error||!data.user){status.textContent='El enlace de recuperación no es válido o expiró.';form.querySelector('button').disabled=true;return;}
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    if (password.length < 12) { status.textContent = 'Usa al menos 12 caracteres.'; return; }
    if (password !== form.elements.confirmation.value) { status.textContent = 'Las contraseñas no coinciden.'; return; }
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Actualizando…';
    loader?.show('Actualizando tu contraseña…');
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      form.reset();
      let destination = 'voluntariado.html?access=mi-ruka';
      try {
        const adminCheck = await client.rpc('admin_list_membership_applications');
        if (!adminCheck.error) destination = 'coordinacion-voluntariado.html';
        else if (adminCheck.error.code === '42501' || /admin_access_required/i.test(adminCheck.error.message || '')) destination = 'mi-voluntariado.html';
      } catch (_) { /* Mi Ruka volverá a verificar el rol con la sesión actual. */ }
      status.textContent = 'Contraseña actualizada. Abriendo tu espacio…';
      setTimeout(() => location.replace(destination), 1200);
    } catch (_) {
      status.textContent = 'No se pudo actualizar la contraseña.';
      button.disabled = false;
    } finally { loader?.hide(); }
  });
});
