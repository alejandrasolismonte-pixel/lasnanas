$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'pages/voluntariado.html')
$css = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/voluntariado.css')
$mainJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/desarrollo.js')
$pageJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/voluntariado.js')
$volunteerJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/voluntariado-demo.js')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

$legacyLeaves = [regex]::Matches($html, 'plant-cta__leaf plant-cta__leaf--[1-5]')
$rukaSvg = [regex]::Match($html, '<svg class="ruka-access__scene"[\s\S]*?</svg>')

Assert-True ($html -match 'class="plant-cta volunteer-opening-cta ruka-access"' -and $html -match 'data-mi-ruka') 'Mi Ruka keeps the existing access hook'
Assert-True ($html -match 'aria-label="Ingresar a Mi Ruka, espacio personal o administrativo"') 'new illustrated access has an explicit accessible name'
Assert-True ($rukaSvg.Success) 'button contains the illustrated ruka scene'
[xml]$parsedSvg = $rukaSvg.Value
Assert-True ($null -ne $parsedSvg.svg) 'ruka SVG is well formed'
Assert-True ($legacyLeaves.Count -eq 5) 'previous plant artwork remains available for a simple visual rollback'
Assert-True ($css -match '\.ruka-access__wall' -and $css -match '\.ruka-access__roof' -and $css -match '\.ruka-access__fire') 'ruka has wall, roof, and fire styling'
Assert-True ($css -match '\.ruka-access__wall\s*\{\s*fill:\s*transparent' -and $css -match '\.ruka-access__roof\s*\{\s*fill:\s*transparent') 'ruka walls and roof use transparent line art'
Assert-True ($css -match 'min-width:\s*106px' -and $css -match 'border-radius:\s*6px') 'Mi Ruka sign is readable with restrained corners'
Assert-True ($css -match '\.sweepstakes-action\s*\{[\s\S]*position:\s*relative;[\s\S]*grid-column:\s*3;[\s\S]*grid-row:\s*1;') 'desktop Ruka occupies a stable third hero column'
Assert-True ($css -match 'min-height:\s*180px;[\s\S]*opacity:\s*1;[\s\S]*visibility:\s*visible') 'Ruka container cannot collapse or remain hidden'
Assert-True ($pageJs -notmatch 'ruka-anchor-x' -and $pageJs -notmatch 'ecosystemButton\.getBoundingClientRect') 'Ruka position no longer depends on header measurements'
Assert-True ($css -match '@media \(max-width: 768px\)[\s\S]*width:\s*min\(156px, 54vw\)' -and $css -match 'max-height: 540px[\s\S]*width:\s*138px') 'Ruka keeps safe sizes on portrait and landscape mobile screens'
Assert-True ($css -match '@keyframes rukaBreathe' -and $css -match '@keyframes rukaFire' -and $css -match '@keyframes rukaSmoke') 'ruka uses subtle pertinent motion'
Assert-True ($css -match '@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ruka-access__smoke') 'ruka respects reduced-motion preferences'
Assert-True ($mainJs -match '\.plant-cta\[href\]:not\(\[data-mi-ruka\]\)') 'legacy mobile leaf delay does not intercept the Ruka access'
Assert-True ($volunteerJs -match "document\.querySelector\('\[data-mi-ruka\]'\)" -and $volunteerJs -match 'routeAuthenticatedUser' -and $volunteerJs -match "window\.location\.assign\('coordinacion-voluntariado\.html'\)") 'personal and administrative routing remains connected'
Assert-True ($html -match 'voluntariado\.css\?v=23' -and $html -match 'voluntariado\.js\?v=4' -and $html -match 'desarrollo\.js\?v=32' -and $html -match 'voluntariado-demo\.js\?v=5') 'page requests refreshed Ruka styles and behavior'

Write-Output 'Result: animated Ruka access smoke checks passed.'
