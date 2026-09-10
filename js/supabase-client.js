/* Cliente único del frontend. RLS sigue siendo la fuente real de autorización. */
(function initializeSupabaseClient() {
  const config = window.LAS_NANAS_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    window.LasNanasSupabase = { client: null, error: 'La conexión de Supabase no está configurada.' };
    return;
  }
  if (/service_role|secret/i.test(config.supabasePublishableKey)) {
    window.LasNanasSupabase = { client: null, error: 'La configuración contiene un tipo de clave no permitido en el navegador.' };
    return;
  }
  window.LasNanasSupabase = {
    client: window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'lasnanas-auth-v1' }
    }),
    error: ''
  };
})();
