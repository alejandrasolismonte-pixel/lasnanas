/* Confirmación de correo: no imprime sesiones, tokens ni metadatos. */
document.addEventListener('DOMContentLoaded', async () => {
  const client=window.LasNanasSupabase?.client;const status=document.querySelector('[data-auth-callback-status]');const back=document.querySelector('[data-auth-callback-back]');
  const loader=window.LasNanasLoader;
  loader?.show('Confirmando tu correo…');
  if(!client){loader?.hide();status.textContent=window.LasNanasSupabase?.error||'Falta configurar Supabase.';back.hidden=false;return;}
  let completed=false;
  const finish=async()=>{if(completed)return;const{data,error}=await client.auth.getUser();if(error||!data.user)return;completed=true;const meta=data.user.user_metadata||{};const params=new URLSearchParams();if(['keyuwün','kimün','pülli'].includes(meta.selected_plan))params.set('plan',meta.selected_plan);if(['monthly','yearly'].includes(meta.selected_billing))params.set('billing',meta.selected_billing);if(['CLP','USD'].includes(meta.selected_currency))params.set('currency',meta.selected_currency);location.replace(`mi-voluntariado.html${params.size?`?${params}`:''}`);};
  client.auth.onAuthStateChange(event=>{if(['SIGNED_IN','INITIAL_SESSION','USER_UPDATED'].includes(event))setTimeout(finish,0);});
  await finish();
  setTimeout(()=>{if(!completed){loader?.hide();status.textContent='No pudimos confirmar este enlace. Puede haber expirado o ya haber sido utilizado.';back.hidden=false;}},8000);
});
