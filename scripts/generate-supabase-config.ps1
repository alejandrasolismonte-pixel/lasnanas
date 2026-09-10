# Genera la configuración pública local sin imprimir sus valores.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
$outputFile = Join-Path $projectRoot 'js\supabase-config.js'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'No se encontró .env.local en la raíz del proyecto.' }
$values = @{}
Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
$url = $values['SUPABASE_URL']; $key = $values['SUPABASE_PUBLISHABLE_KEY']
if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($key)) { throw 'Faltan las variables públicas requeridas.' }
if ($url -notmatch '^https://[a-z0-9-]+\.supabase\.co/?$') { throw 'SUPABASE_URL debe ser la URL HTTPS completa del proyecto Supabase.' }
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]+$' -or $key -match 'service_role|secret') { throw 'SUPABASE_PUBLISHABLE_KEY no tiene formato de clave publicable.' }
$config = [ordered]@{ supabaseUrl = $url; supabasePublishableKey = $key } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($outputFile, "/* Archivo generado: no editar ni versionar. */`nwindow.LAS_NANAS_CONFIG = Object.freeze($config);`n", [System.Text.UTF8Encoding]::new($false))
Write-Output 'Configuración pública de Supabase generada.'
