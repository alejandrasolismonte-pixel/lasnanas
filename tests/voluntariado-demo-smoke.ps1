# Comprobaciones estáticas del flujo público, portal y esquema Supabase.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$public = Get-Content (Join-Path $root 'pages\voluntariado.html') -Raw -Encoding utf8
$portal = Get-Content (Join-Path $root 'pages\mi-voluntariado.html') -Raw -Encoding utf8
$publicJs = Get-Content (Join-Path $root 'js\voluntariado-demo.js') -Raw -Encoding utf8
$portalJs = Get-Content (Join-Path $root 'js\mi-voluntariado.js') -Raw -Encoding utf8
$sql = Get-Content (Join-Path $root 'supabase\migrations\202609100001_voluntariado.sql') -Raw -Encoding utf8
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
Has $portalJs 'sessionStorage' 'demo uses tab-scoped storage'
if($portalJs.Contains('localStorage')){throw 'FAILED: portal must not use localStorage'}else{Write-Output 'OK: portal does not use localStorage'}
Has $portalJs "state.payment === 'pending'" 'activation waits for payment confirmation'
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
Write-Output 'Result: all static smoke checks passed.'
