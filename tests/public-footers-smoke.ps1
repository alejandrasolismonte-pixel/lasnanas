$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$publicPages = @(
  'desarrollo.html',
  'pages/nanas.html',
  'pages/productos.html',
  'pages/servicios.html',
  'pages/voluntariado.html'
)
$footerCss = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/desarrollo.css')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

foreach ($relativePath in $publicPages) {
  $html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $relativePath)
  $footerMatch = [regex]::Match($html, '(?is)<footer class="site-footer ethnic-footer">.*?</footer>')
  Assert-True $footerMatch.Success "$relativePath has the shared public footer"

  $footer = $footerMatch.Value
  $openDivs = ([regex]::Matches($footer, '<div\b')).Count
  $closeDivs = ([regex]::Matches($footer, '</div>')).Count
  Assert-True ($openDivs -eq $closeDivs) "$relativePath footer HTML is balanced"
  Assert-True (([regex]::Matches($footer, 'logo-web\.png')).Count -eq 1) "$relativePath footer has exactly one logo"
  Assert-True ($footer -match 'mailto:nanamapuche@gmail\.com' -and $footer -match '>nanamapuche@gmail\.com<') "$relativePath footer shows the requested Gmail address"
  Assert-True ($footer -match 'instagram\.com/nanamapuche/' -and $footer -match 'aria-label="Instagram de Las [^"]+"') "$relativePath footer has an accessible Instagram link"
  Assert-True ($footer -match 'facebook\.com/nanamapuche' -and $footer -match 'aria-label="Facebook de Las [^"]+"') "$relativePath footer has an accessible Facebook link"
  Assert-True ($footer -match 'La Araucan.a, Chile') "$relativePath footer keeps the location"
  Assert-True ($html -match 'desarrollo\.css\?v=83' -and $html -match 'desarrollo\.js\?v=30') "$relativePath requests current shared footer assets"
}

$combinedPublicHtml = ($publicPages | ForEach-Object {
  Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $_)
}) -join "`n"

Assert-True ($combinedPublicHtml -notmatch 'equipolasnanas\.aiep@gmail\.com|alejandra\.solis\.monte@gmail\.com') 'public pages contain no stale email addresses'
Assert-True ($footerCss -match '\.ethnic-footer\s*\{[\s\S]*?min-height:\s*242px;[\s\S]*?padding:\s*2\.5rem 0 1\.25rem;' -and $footerCss -match '\.footer-content\s*\{[\s\S]*?min-height:\s*108px;') 'shared footer has a consistent balanced desktop height'
Assert-True ($footerCss -match '\.glowing-ring\s*\{[\s\S]*?width:\s*108px;[\s\S]*?height:\s*108px;' -and $footerCss -match '\.ethnic-border\s*\{[\s\S]*?width:\s*90px;[\s\S]*?height:\s*90px;') 'logo presentation has consistent dimensions'
Assert-True ($footerCss -match '\.footer-social-icon\s*\{' -and $footerCss -match '\.footer-social-icon--facebook\s*\{') 'shared Instagram, Facebook, and Gmail icon styles exist'

Write-Output 'Result: public footer consistency checks passed.'
