/* Actualiza la contraseña únicamente después de validar la sesión de recuperación. */
document.addEventListener('DOMContentLoaded', async()=>{
  const client=window.LasNanasSupabase?.client;const form=document.querySelector('[data-password-update]');const status=document.querySelector('[data-password-status]');
  const loader=window.LasNanasLoader;
  loader?.show('Validando el enlace de recuperación…');
  if(!client){loader?.hide();status.textContent=window.LasNanasSupabase?.error||'Falta configurar Supabase.';form.querySelector('button').disabled=true;return;}
  const{data,error}=await client.auth.getUser();loader?.hide();if(error||!data.user){status.textContent='El enlace de recuperación no es válido o expiró.';form.querySelector('button').disabled=true;return;}
  form.addEventListener('submit',async event=>{event.preventDefault();const password=form.elements.password.value;const confirmation=form.elements.confirmation.value;if(password.length<12){status.textContent='Usa al menos 12 caracteres.';return;}if(password!==confirmation){status.textContent='Las contraseñas no coinciden.';return;}form.querySelector('button').disabled=true;status.textContent='Actualizando…';loader?.show('Actualizando tu contraseña…');try{const{error:updateError}=await client.auth.updateUser({password});if(updateError){status.textContent='No se pudo actualizar la contraseña.';form.querySelector('button').disabled=false;return;}form.reset();status.textContent='Contraseña actualizada. Ya puedes continuar a tu espacio personal.';setTimeout(()=>location.replace('mi-voluntariado.html'),1200);}finally{loader?.hide();}});
});
