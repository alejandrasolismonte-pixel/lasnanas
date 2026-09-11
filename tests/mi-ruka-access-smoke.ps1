$ErrorActionPreference = 'Stop'

# Las Ñañas · pruebas estáticas del acceso único Mi Ruka.
$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -LiteralPath (Join-Path $root 'pages/voluntariado.html') -Raw
$accessScript = Get-Content -LiteralPath (Join-Path $root 'js/voluntariado-demo.js') -Raw
$adminScript = Get-Content -LiteralPath (Join-Path $root 'js/coordinacion-voluntariado.js') -Raw

$checks = [ordered]@{
  'Existe un único acceso Mi Ruka' = ([regex]::Matches($html, 'data-mi-ruka')).Count -eq 1 -and ([regex]::Matches($html, '>Mi Ruka<')).Count -eq 1
  'El texto anterior fue reemplazado' = $html -notmatch 'Súmate como voluntaria/o'
  'Mi Ruka reutiliza el modal existente' = $accessScript -match "activateTab\('login'\)" -and $accessScript -match 'dialog\.showModal\(\)'
  'Mi Ruka no guarda ni modifica selección temporal' = $accessScript -match "accessMode = 'ruka'" -and $accessScript -match "if\(accessMode==='plan'\)saveUiSelection\(\)" -and $accessScript -notmatch "accessMode === 'ruka'[^\r\n]+saveUiSelection"
  'Registro abierto desde Mi Ruka no recibe un plan implícito' = $accessScript -match "if \(accessMode === 'plan'\) Object\.assign\(metadata" -and $accessScript -notmatch 'const metadata = \{[^\r\n]+selected_plan'
  'La sesión se verifica con auth.getUser' = ([regex]::Matches($accessScript, 'supabase\.auth\.getUser\(\)')).Count -ge 2
  'El rol administrativo se comprueba mediante RPC 004' = $accessScript -match "rpc\('admin_list_membership_applications'\)" -and $adminScript -match "rpc\('admin_list_membership_applications'\)"
  'Mi Ruka no consulta staff_roles directamente' = $accessScript -notmatch "from\('staff_roles'\)"
  'Admin prevalece sobre el espacio personal' = $accessScript -match "adminCheck\.error \? 'mi-voluntariado\.html' : 'coordinacion-voluntariado\.html'"
  'Panel redirige sin sesión al acceso fijo' = $adminScript -match "voluntariado\.html\?access=mi-ruka"
  'Panel envía cuenta normal al espacio personal' = $adminScript -match "window\.location\.replace\('mi-voluntariado\.html'\)"
  'No se admiten retornos arbitrarios' = ($accessScript + $adminScript) -notmatch '(returnUrl|return_to|redirectToParam|location\.search.*location\.assign)'
  'No hay secretos ni service_role' = ($html + $accessScript + $adminScript) -notmatch '(service_role|SUPABASE_SECRET_KEY|BREVO_API_KEY|NOTIFICATION_WEBHOOK_SECRET|eyJ[A-Za-z0-9_-]{20,})'
}

$failures = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
$checks.GetEnumerator() | ForEach-Object { Write-Host "[$(if ($_.Value) {'OK'} else {'ERROR'})] $($_.Key)" }
if ($failures.Count) { throw "$($failures.Count) comprobación(es) fallaron." }
Write-Host "Mi Ruka: $($checks.Count) comprobaciones superadas."
