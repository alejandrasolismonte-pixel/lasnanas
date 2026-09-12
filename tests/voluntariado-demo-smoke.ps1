# Comprobaciones estáticas del flujo público, portal y esquema Supabase.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$public = Get-Content (Join-Path $root 'pages\voluntariado.html') -Raw -Encoding utf8
$portal = Get-Content (Join-Path $root 'pages\mi-voluntariado.html') -Raw -Encoding utf8
$publicJs = Get-Content (Join-Path $root 'js\voluntariado-demo.js') -Raw -Encoding utf8
$portalJs = Get-Content (Join-Path $root 'js\mi-voluntariado.js') -Raw -Encoding utf8
$clientJs = Get-Content (Join-Path $root 'js\supabase-client.js') -Raw -Encoding utf8
$loaderJs = Get-Content (Join-Path $root 'js\loading-overlay.js') -Raw -Encoding utf8
$loaderCss = Get-Content (Join-Path $root 'css\loading-overlay.css') -Raw -Encoding utf8
$sql = Get-Content (Join-Path $root 'supabase\migrations\202609100001_voluntariado.sql') -Raw -Encoding utf8
$authSql = Get-Content (Join-Path $root 'supabase\migrations\202609100002_auth_frontend.sql') -Raw -Encoding utf8
function Has([string]$source,[string]$expected,[string]$label){if(-not $source.Contains($expected)){throw "FAILED: $label"};Write-Output "OK: $label"}
function Count([string]$source,[string]$pattern,[int]$expected,[string]$label){$actual=([regex]::Matches($source,$pattern)).Count;if($actual-ne$expected){throw "FAILED: $label ($actual)"};Write-Output "OK: $label"}
Count $public 'data-membership-plan="[^"]+"' 3 'three public plans remain connected'
Has $public 'name="firstName"' 'registration requests first name'
Has $public 'name="lastName"' 'registration requests last name'
Has $publicJs 'mi-voluntariado.html?plan=' 'access redirects to independent portal'
Has $publicJs 'dialog.showModal()' 'plan click opens modal'
Has $portal 'Mi agenda de voluntariado' 'private agenda exists'
Has $portal 'data-agenda-view="calendar"' 'calendar view exists'
Has $portal 'data-save-later' 'explicit save action exists'
Has $publicJs 'supabase.auth.signUp' 'registration uses Supabase Auth'
Has $publicJs 'supabase.auth.signInWithPassword' 'login uses Supabase Auth'
Has $publicJs 'supabase.auth.resetPasswordForEmail' 'recovery uses Supabase Auth'
# CARGA GLOBAL: asegura presencia, accesibilidad y alternativa de movimiento reducido.
Has $public 'loading-overlay.js' 'public registration loads the global loader'
Has $portal 'loading-overlay.js' 'private portal loads the global loader'
Has $loaderJs "setAttribute('role', 'status')" 'loader exposes an accessible status'
Has $loaderCss 'prefers-reduced-motion: reduce' 'loader respects reduced motion preference'
Has $loaderCss 'background: transparent' 'loader overlay has no background color'
Has $loaderCss 'backdrop-filter: none' 'loader overlay does not blur the page'
$loaderPages = @('index.html','desarrollo.html','pages\nanas.html','pages\servicios.html','pages\productos.html','pages\voluntariado.html','pages\mi-voluntariado.html','pages\coordinacion-voluntariado.html','pages\auth-callback.html','pages\actualizar-contrasena.html')
foreach($loaderPage in $loaderPages){
  $loaderMarkup = Get-Content (Join-Path $root $loaderPage) -Raw -Encoding utf8
  Has $loaderMarkup 'loading-overlay.css' "$loaderPage loads loader styles"
  Has $loaderMarkup 'loading-overlay.js' "$loaderPage loads loader behavior"
}
Has $portalJs "supabase.from('volunteer_profiles')" 'profile loads from Supabase'
Has $portalJs "supabase.from('membership_applications')" 'plan draft persists in Supabase'
Has $portalJs "supabase.from('application_messages')" 'messages load from Supabase'
Has $portalJs "supabase.from('agenda_entries')" 'agenda persists in Supabase'
Has $portalJs 'sessionStorage' 'sessionStorage is limited to UI fallback state'
if($portalJs.Contains('localStorage')){throw 'FAILED: portal must not use localStorage'}else{Write-Output 'OK: portal does not use localStorage'}
Has $clientJs 'persistSession: true' 'Supabase restores the authenticated session'
Has $clientJs 'supabasePublishableKey' 'client accepts only public configuration'
if($clientJs.Contains('SUPABASE_SERVICE_ROLE_KEY')){throw 'FAILED: client references an administrative environment key'}else{Write-Output 'OK: client has no administrative environment key'}
Has $sql 'enable row level security' 'RLS is enabled'
Has $sql 'admin_notes' 'private administrative notes are separated'
Has $sql "public.agenda_entries" 'private agenda model exists'
Has $sql "public.is_coordination()" 'coordination access is role-gated'
Has $sql 'create table public.staff_roles' 'administrative roles are separated from profiles'
Has $sql 'create table public.plan_prices' 'price history is versioned'
Has $sql 'grant execute on function public.activate_volunteer_membership(uuid,timestamptz,timestamptz,uuid) to service_role' 'membership activation is server-only'
Has $sql 'revoke all on all tables in schema public from anon, authenticated' 'anonymous table access is removed'
Has $sql "scan_status='clean'" 'coordination reads only clean attachment files'
if($sql.Contains('create policy payments_owner_report')){throw 'FAILED: browser must not create payments'}else{Write-Output 'OK: browser cannot create payments'}
if($sql.Contains('create policy memberships_coordination_write')){throw 'FAILED: browser must not activate memberships'}else{Write-Output 'OK: browser cannot activate memberships'}
Has $authSql 'respond_to_membership_clarification' 'clarification response is transactional'
Has $authSql "owner_id = auth.uid()" 'clarification RPC enforces ownership'
Write-Output 'Result: all static smoke checks passed.'
