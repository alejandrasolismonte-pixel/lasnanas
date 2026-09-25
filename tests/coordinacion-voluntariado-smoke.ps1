$ErrorActionPreference = 'Stop'

# Las Ñañas · comprobaciones estáticas del panel administrativo.
$projectRoot = Split-Path -Parent $PSScriptRoot
$html = Get-Content -LiteralPath (Join-Path $projectRoot 'pages/coordinacion-voluntariado.html') -Raw
$script = Get-Content -LiteralPath (Join-Path $projectRoot 'js/coordinacion-voluntariado.js') -Raw
$migration = Get-Content -LiteralPath (Join-Path $projectRoot 'supabase/migrations/202609100004_admin_volunteer_read_panel.sql') -Raw
$workflowMigration = Get-Content -LiteralPath (Join-Path $projectRoot 'supabase/migrations/202609250001_volunteer_admin_workflow.sql') -Raw
$adminCss = Get-Content -LiteralPath (Join-Path $projectRoot 'css/coordinacion-voluntariado.css') -Raw
$sections = @('applications', 'clarifications', 'payments', 'documents', 'activities', 'agendas')
$categories = @('all', 'pending', 'process', 'rejected', 'active', 'withdrawn')
$navMatches = [regex]::Matches($html, '<button\b[^>]*data-admin-view-button="([^"]+)"[^>]*>')
$navNames = @($navMatches | ForEach-Object { $_.Groups[1].Value })
$viewNames = @([regex]::Matches($html, 'data-admin-view="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$rejectButton = [regex]::Match($html, '<button\b[^>]*data-show-rejection\b[^>]*>')

$checks = [ordered]@{
  'HTML carga cliente, estilos y controlador administrativo' = $html -match 'supabase-client\.js' -and $html -match 'coordinacion-voluntariado\.js' -and $html -match 'coordinacion-voluntariado\.css'
  'Navegación privada aparece después de autorizar' = $html -match 'data-admin-layout\s+hidden' -and $script -match 'layout\.hidden\s*=\s*false'
  'Todas las funciones tienen botón y sección navegable' = @($sections | Where-Object { $_ -notin $navNames -or $_ -notin $viewNames }).Count -eq 0 -and @($navMatches | Where-Object { $_.Value -match '\bdisabled\b' }).Count -eq 0
  'Pestañas muestran todas las categorías y sus recuentos' = @($categories | Where-Object { $html -notmatch ('data-category="' + $_ + '"') -or $html -notmatch ('data-category-count="' + $_ + '"') }).Count -eq 0
  'Categorías tienen estilos visuales y foco de teclado' = @(@('pending', 'process', 'rejected', 'active', 'withdrawn') | Where-Object { $adminCss -notmatch ('\[data-category="' + $_ + '"\]') }).Count -eq 0 -and $adminCss -match ':focus-visible'
  'Rechazo está disponible mediante formulario' = $rejectButton.Success -and $rejectButton.Value -notmatch '\bdisabled\b' -and $html -match 'data-admin-reject-form' -and $script -match "setApplicationStatus\('rejected'"
  'JavaScript valida la sesión mediante Auth' = $script -match 'client\.auth\.getUser\(\)'
  'JavaScript delega la autorización admin en la RPC protegida' = $script -match "rpc\('admin_list_membership_applications_v2'\)" -and $workflowMigration -match 'admin_access_required'
  'JavaScript usa RPC separadas para lista y detalle' = $script -match "rpc\('admin_list_membership_applications_v2'\)" -and $script -match "rpc\('admin_get_membership_application'"
  'Lista nueva distingue estado de pago y membresía vigente' = $workflowMigration -match 'payment_status\s+public\.payment_status' -and $workflowMigration -match 'membership_active\s+boolean' -and $script -match 'membership_active'
  'Migración conserva la lista anterior sin DROP FUNCTION' = $workflowMigration -match 'create or replace function public\.admin_list_membership_applications_v2\(\)' -and $workflowMigration -notmatch '\bdrop\s+function\b'
  'JavaScript no contiene claves privilegiadas' = $script -notmatch '(service_role|SUPABASE_SECRET_KEY|BREVO_API_KEY|NOTIFICATION_WEBHOOK_SECRET)'
  'SQL exige admin no revocado en ambas funciones' = ([regex]::Matches($migration, "sr\.role = 'admin'::public\.volunteer_role")).Count -eq 2 -and ([regex]::Matches($migration, 'sr\.revoked_at is null')).Count -eq 2
  'SQL usa SECURITY DEFINER y search_path fijo' = ([regex]::Matches($migration, 'security definer')).Count -eq 2 -and ([regex]::Matches($migration, "set search_path = ''")).Count -eq 2
  'SQL no concede ejecución anónima' = $migration -notmatch 'grant execute[^\r\n]+to (public|anon)'
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
$checks.GetEnumerator() | ForEach-Object {
  $label = if ($_.Value) { 'OK' } else { 'ERROR' }
  Write-Host "[$label] $($_.Key)"
}
if ($failed.Count -gt 0) { throw "$($failed.Count) comprobación(es) fallaron." }
Write-Host "Panel administrativo: $($checks.Count) comprobaciones superadas."
