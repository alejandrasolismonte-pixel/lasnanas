$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$homeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'desarrollo.html')
$mapJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/map-pins.js')
$pageJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/desarrollo.js')
$migration = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'supabase/migrations/202609120001_map_pin_content_editor.sql')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

Assert-True ($homeHtml -match 'data-map-add-pin="nanas"' -and $homeHtml -match 'data-map-add-pin="experiences"') 'editor can start orange and green pins'
Assert-True ($homeHtml -match 'data-map-pin-form' -and $homeHtml -match 'name="category"' -and $homeHtml -match 'name="title"' -and $homeHtml -match 'name="description"') 'editor exposes category, title, and description fields'
Assert-True ($homeHtml -match 'data-map-pin-hide' -and $homeHtml -match 'data-map-inactive-list') 'editor exposes reversible retirement controls'
Assert-True ($mapJs -match "client\.rpc\('admin_create_map_pin'" -and $mapJs -match "client\.rpc\('admin_update_map_pin'") 'frontend creates and edits pins through protected RPCs'
Assert-True ($mapJs -match "client\.rpc\('admin_set_map_pin_active'" -and $mapJs -match 'p_active:\s*false' -and $mapJs -match 'p_active:\s*true') 'frontend can retire and recover pins'
Assert-True ($mapJs -match 'document\.createElement\(''button''\)' -and $mapJs -match 'stage\.appendChild\(pin\)') 'new database pins are rendered dynamically'
Assert-True ($mapJs -match 'pin\.dataset\.title\s*=\s*record\.title' -and $mapJs -match 'button\.textContent' -and $mapJs -notmatch 'innerHTML') 'editable content is inserted as text rather than executable markup'
Assert-True ($pageJs -match 'getMapPins' -and $pageJs -match "event\.target\.closest\('\.map-pin'\)") 'filters and detail panel support dynamically created pins'
Assert-True ($migration -match 'add column if not exists category text' -and $migration -match 'add column if not exists is_active boolean') 'second migration stores content, category, and visibility'
Assert-True ($migration -match 'where p\.is_active') 'public RPC returns only active pins'
Assert-True ($migration -match 'admin_create_map_pin' -and $migration -match 'admin_update_map_pin' -and $migration -match 'admin_set_map_pin_active') 'second migration defines all content editor operations'
Assert-True ($migration -match "r\.role = 'admin'::public\.volunteer_role" -and $migration -match 'r\.revoked_at is null') 'all mutations retain the existing active-admin check'
Assert-True ($migration -match 'revoke all on function public\.admin_create_map_pin[\s\S]*to authenticated' -and $migration -match 'revoke all on function public\.admin_update_map_pin[\s\S]*to authenticated') 'mutation RPCs are unavailable to anonymous visitors'
Assert-True ($migration -notmatch 'delete\s+from\s+public\.map_pin_positions') 'retirement is reversible and never deletes a pin row'

Write-Output 'Result: all map pin content editor static smoke checks passed.'
