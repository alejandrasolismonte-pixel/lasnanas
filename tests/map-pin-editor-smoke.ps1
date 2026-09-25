$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$homeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'index.html')
$adminHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'pages/coordinacion-voluntariado.html')
$mapJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/map-pins.js')
$adminJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/coordinacion-voluntariado.js')
$css = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/desarrollo.css')
$migration = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'supabase/migrations/202609110001_map_pin_editor.sql')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

$htmlIds = [regex]::Matches($homeHtml, 'data-pin-id="([a-z0-9-]+)"') | ForEach-Object { $_.Groups[1].Value }
$sqlIds = [regex]::Matches($migration, "\('([a-z0-9-]+)',\s*\d+") | ForEach-Object { $_.Groups[1].Value }

Assert-True ($htmlIds.Count -eq 11) 'the map exposes eleven editable pins'
Assert-True (($htmlIds | Select-Object -Unique).Count -eq $htmlIds.Count) 'every map pin has a unique stable id'
Assert-True (((($htmlIds | Sort-Object) -join ',') -eq (($sqlIds | Sort-Object) -join ','))) 'database seeds match the visible map pins'
Assert-True ($homeHtml -match 'data-map-editor hidden') 'private editing controls are hidden by default'
Assert-True ($css -match '\.map-editor\[hidden\][\s\S]*display:\s*none\s*!important') 'author styles cannot accidentally reveal private controls'
Assert-True ($homeHtml -match 'data-map-edit-toggle' -and $homeHtml -match 'data-map-edit-save disabled' -and $homeHtml -match 'data-map-edit-cancel disabled' -and $homeHtml -match 'data-map-edit-reset') 'editor includes toggle, save, cancel, and restore actions'
Assert-True ($homeHtml -match 'supabase-client\.js' -and $homeHtml -match 'map-pins\.js') 'public map loads shared positions through the existing client'
Assert-True ($adminHtml -match 'data-admin-layout hidden[\s\S]*data-admin-edit-map') 'admin map entry remains inside the private layout until access is verified'
Assert-True ($adminJs -match "rpc\('admin_list_membership_applications_v2'\)[\s\S]*layout\.hidden\s*=\s*false") 'admin layout opens only after the existing role check'
Assert-True ($adminJs -match '\.\./\?editar-mapa=1#territorio') 'admin entry opens the visual editor on the home page directly'
Assert-True ($mapJs -match "client\.auth\.getUser\(\)" -and $mapJs -match "admin_get_map_pin_positions") 'visual editor validates session and admin authorization'
Assert-True ($mapJs -match "client\.rpc\('get_map_pin_positions'\)") 'visitors load the published positions'
Assert-True ($mapJs -match "client\.rpc\('admin_save_map_pin_positions'" -and $mapJs -match 'p_positions:\s*payload') 'save action publishes all visual positions through one protected operation'
Assert-True ($mapJs -match "pointerdown" -and $mapJs -match "pointermove" -and $mapJs -match "pointerup") 'pins support mouse and touch dragging through pointer events'
Assert-True ($mapJs -match "ArrowLeft" -and $mapJs -match "ArrowRight") 'pins can also be adjusted with the keyboard'
Assert-True ($mapJs -match 'mobile_x' -and $mapJs -match 'mobile_y' -and $mapJs -match 'matchMedia') 'mobile positions are edited independently without exposing coordinates'
Assert-True ($mapJs -notmatch 'localStorage|sessionStorage') 'published map positions are not limited to one browser'
Assert-True ($css -match '\.map-stage\.is-map-editing' -and $css -match 'touch-action:\s*none') 'editing mode has visible and touch-safe interaction states'
Assert-True ($migration -match 'enable row level security' -and $migration -match 'force row level security') 'map position storage has row-level security enabled'
Assert-True ($migration -match 'revoke all on table public\.map_pin_positions from public, anon, authenticated') 'browsers have no direct table writes'
Assert-True ($migration -match "grant execute on function public\.get_map_pin_positions\(\) to anon, authenticated") 'published coordinates remain publicly readable'
Assert-True ($migration -match "r\.role = 'admin'::public\.volunteer_role" -and $migration -match 'r\.revoked_at is null') 'saving requires an active administrator role'
Assert-True ($migration -match 'between 0 and 100' -and $mapJs -match 'MIN_POSITION' -and $mapJs -match 'MAX_POSITION') 'server and interface keep pins inside the map'

Write-Output 'Result: all map editor static smoke checks passed.'
