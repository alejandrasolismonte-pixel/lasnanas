$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function Assert-True($condition, $message) {
  if (-not $condition) { throw "FAIL: $message" }
  Write-Host "PASS: $message"
}

$assetPaths = @(
  (Join-Path $root 'assets/hero-web.webp'),
  (Join-Path $root 'assets/img/logo-web.png'),
  (Join-Path $root 'assets/img/mapa-araucania-web.webp'),
  (Join-Path $root 'assets/img/marcos/ventana-rustica-transparente-web.webp'),
  (Join-Path $root 'assets/img/voluntariado/nana-preguntas-web.webp')
)
$assetPaths += (Get-ChildItem -LiteralPath (Join-Path $root 'assets/icons') -Filter '*-web.webp').FullName
$assetPaths += (Get-ChildItem -LiteralPath (Join-Path $root 'assets/img/carrusel') -Filter '*-web.webp').FullName
$assetPaths += (Get-ChildItem -LiteralPath (Join-Path $root 'assets/img/carrusel_servicios') -Filter '*-web.webp').FullName
$assetPaths += (Get-ChildItem -LiteralPath (Join-Path $root 'assets/img/letreros') -Filter '*-web.webp').FullName

Assert-True ($assetPaths.Count -eq 26) 'all 26 optimized public assets exist'
Assert-True (($assetPaths | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0) 'optimized files are present'
Assert-True (($assetPaths | Get-Item | Measure-Object Length -Sum).Sum -lt 9MB) 'optimized asset set stays below 9 MB'
Assert-True ((Get-ChildItem -LiteralPath (Join-Path $root 'assets/icons') -Filter '*-web.webp').Count -eq 3) 'three animated ecosystem icons were generated'
Assert-True ((Get-ChildItem -LiteralPath (Join-Path $root 'assets/img/carrusel') -Filter '*-web.webp').Count -eq 7) 'seven ecosystem carousel images were generated'
Assert-True ((Get-ChildItem -LiteralPath (Join-Path $root 'assets/img/carrusel_servicios') -Filter '*-web.webp').Count -eq 8) 'eight service carousel images were generated'

$publicFiles = @(
  (Join-Path $root 'desarrollo.html'),
  (Join-Path $root 'index.html'),
  (Join-Path $root 'pages/nanas.html'),
  (Join-Path $root 'pages/productos.html'),
  (Join-Path $root 'pages/servicios.html'),
  (Join-Path $root 'pages/voluntariado.html'),
  (Join-Path $root 'pages/mi-voluntariado.html'),
  (Join-Path $root 'js/desarrollo.js')
)
$publicSource = ($publicFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_ }) -join "`n"

Assert-True ($publicSource -notmatch 'assets/(img/logo|logo)\.png') 'public pages do not request the oversized original logo'
Assert-True ($publicSource -notmatch 'assets/icons/(voluntariado|productos|servicios)\.gif') 'public pages do not request the heavy ecosystem GIF files'
Assert-True ($publicSource -notmatch 'assets/img/carrusel(?:_servicios)?/[^"'']+\.png') 'public carousels use optimized WebP images'
Assert-True ($publicSource -match 'hero-web\.webp' -and $publicSource -match 'mapa-araucania-web\.webp') 'home hero and map use optimized images'
Assert-True ($publicSource -match 'voluntariado-web\.webp' -and $publicSource -match 'productos-web\.webp' -and $publicSource -match 'servicios-web\.webp') 'ecosystem visuals use optimized images'

$developmentCss = Get-Content -Raw -LiteralPath (Join-Path $root 'css/desarrollo.css')
$nanasCss = Get-Content -Raw -LiteralPath (Join-Path $root 'css/nanas.css')
$volunteerCss = Get-Content -Raw -LiteralPath (Join-Path $root 'css/voluntariado.css')

Assert-True ($developmentCss -match 'font-size:\s*clamp\(2rem,\s*4\.2vw,\s*3rem\)') 'global section titles use a balanced fluid scale'
Assert-True ($developmentCss -match 'min-height:\s*175px' -and $developmentCss -match 'width:\s*70px\s*!important') 'home ecosystem cards are about 30 percent smaller on mobile'
Assert-True ($nanasCss -match 'padding:\s*1\.75rem 1\.05rem 1\.4rem' -and $nanasCss -match 'width:\s*37px\s*!important') 'ecosystem page cards are about 30 percent smaller on mobile'
Assert-True ($volunteerCss -match 'clamp\(1\.95rem,\s*4\.2vw,\s*3\.3rem\)' -and $volunteerCss -match 'clamp\(2rem,\s*4\.4vw,\s*3\.6rem\)') 'volunteer section titles follow the revised hierarchy'

Write-Host 'Web image optimization and typography smoke checks passed.'
