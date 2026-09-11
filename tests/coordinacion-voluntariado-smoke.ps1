$ErrorActionPreference = 'Stop'

# Las Ñañas · comprobaciones estáticas de la primera etapa administrativa.
$projectRoot = Split-Path -Parent $PSScriptRoot
$html = Get-Content -LiteralPath (Join-Path $projectRoot 'pages/coordinacion-voluntariado.html') -Raw
$script = Get-Content -LiteralPath (Join-Path $projectRoot 'js/coordinacion-voluntariado.js') -Raw
$migration = Get-Content -LiteralPath (Join-Path $projectRoot 'supabase/migrations/202609100004_admin_volunteer_read_panel.sql') -Raw

$checks = [ordered]@{
  'HTML carga cliente público y controlador administrativo' = $html -match 'supabase-client\.js' -and $html -match 'coordinacion-voluntariado\.js'
  'Rechazar permanece deshabilitado en la etapa actual' = ([regex]::Matches($html, '<button[^>]+disabled[^>]*>Rechazar</button>')).Count -eq 1
  'JavaScript valida la sesión mediante Auth' = $script -match 'client\.auth\.getUser\(\)'
  'JavaScript delega la autorización admin en la RPC protegida' = $script -match "rpc\('admin_list_membership_applications'\)" -and $script -notmatch "from\('staff_roles'\)"
  'JavaScript usa RPC separadas para lista y detalle' = $script -match "rpc\('admin_list_membership_applications'\)" -and $script -match "rpc\('admin_get_membership_application'"
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
