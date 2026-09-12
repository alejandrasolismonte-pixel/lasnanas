$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'index.html')
$css = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'style.css')
$js = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'script.js')
$homeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'desarrollo.html')
$homeCss = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/desarrollo.css')
$homeJs = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/desarrollo.js')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

Assert-True ($html -match 'Marri marri pu lamien \.<br>K.me akuym.n!!' -and $html -match 'Ra.ces profundas\.<br>Ecosistemas vivos\.') 'established greeting and subtitle remain unchanged'
Assert-True ($html -match '<h1 class="silver-text">Marri marri' -and $html -match '<h2 class="silver-text welcome-subtitle">Ra.ces profundas') 'greeting leads and the motto is its subtitle'
Assert-True ($css -match '\.silver-text\.welcome-subtitle\s*\{\s*font-size:\s*1\.7rem;\s*\}') 'subtitle changes size without replacing the established lettering style'

Assert-True ($html -notmatch 'progress-track|progress-fill') 'old progress bar is no longer rendered'
Assert-True ($html -notmatch 'loading-overlay__loader|class="loader-path"|class="loader-inner"') 'loader is not permanently rendered inside the welcome card'
Assert-True ($html -match 'loading-overlay\.css\?v=2' -and $html -match 'loading-overlay\.js\?v=2') 'shared loader files remain connected'
Assert-True ($html -notmatch 'landing-header|landing-nav|landing-menu-toggle|landing-ecosystem') 'top menu and its ecosystem access are removed from the welcome'
Assert-True ($html -match '<a href="desarrollo\.html#inicio" class="cta-button landing-entry-button" data-kupage[^>]*>K.page</a>') 'Küpage is the sole visible entry control at the former loader position'
Assert-True ($html -notmatch 'social-links|Instagram|mailto:|.nete a nuestro ciclo') 'Instagram and the former secondary call to action are removed'
Assert-True ($js -match "querySelector\('\[data-kupage\]'\)" -and $js -match 'event\.preventDefault\(\)' -and $js -match "LasNanasLoader\?\.show\('Ingresando al sitio'\)" -and $js -match 'window\.setTimeout' -and $js -match '\},\s*2000\);' -and $js -match 'window\.location\.assign\(entryButton\.href\)') 'Küpage displays the loader for exactly two seconds before entering'
Assert-True ($css -match 'body\.landing-welcome-page\s*\{\s*padding-top:\s*0;' -and $css -match 'body\.landing-welcome-page \.main-container\s*\{\s*display:\s*grid;\s*place-items:\s*center;' -and $css -match 'body\.landing-welcome-page \.glass-panel\s*\{[\s\S]*?border:\s*2px solid #ea580c;') 'welcome is vertically centered and its card has an orange border'

$desktopStart = $js.IndexOf('const elementosDesktop = [')
$mobileStart = $js.IndexOf('const elementosMovil = [')
$desktopBlock = $js.Substring($desktopStart, $mobileStart - $desktopStart)
$mobileEnd = $js.IndexOf('const elementos =', $mobileStart)
$mobileBlock = $js.Substring($mobileStart, $mobileEnd - $mobileStart)

Assert-True (([regex]::Matches($desktopBlock, "type: '(box|text)'")).Count -eq 11) 'desktop balances six symbols and five floating words'
Assert-True (([regex]::Matches($mobileBlock, "type: '(box|text)'")).Count -eq 4) 'tablet and mobile keep only four floating symbols'
Assert-True ($desktopBlock -match 'content:\s*"lahuen"' -and $desktopBlock -match 'content:\s*"soberania alimentaria"' -and $desktopBlock -match 'content:\s*"nutram"') 'requested words are distributed around the central card'
Assert-True ($js -match 'geometr.a inspirada en tejido mapuche' -and $js -match 'lawen y semillas' -and $js -match '// ruka' -and $js -match '// kultr.n' -and $js -match '// araucaria') 'floating motifs are culturally and territorially pertinent'
Assert-True ($js -notmatch '139, 92, 246|59, 130, 246|245, 158, 11|234, 179, 8') 'unrelated purple, blue, and gold symbol colors were removed'
Assert-True ($js -match '234, 88, 12' -and $js -match '121, 198, 197' -and $js -match '52, 211, 153') 'floating symbols use the site orange, turquoise, and green palette'
Assert-True ($js -match 'duration = 7 \+ Math\.random\(\) \* 6') 'existing floating movement style remains unchanged'
Assert-True ($js -match 'el\.style\.left = `\$\{data\.x\}%`' -and $css -match 'width:\s*min\(1100px,\s*100vw\)') 'floating icons stay closer to the central card on wide screens'
Assert-True ($css -match 'body\.landing-welcome-page \.loading-overlay__loader[\s\S]*animation-duration:\s*2\.34s,\s*2\.34s\s*!important') 'welcome loader runs exactly 30 percent slower'
Assert-True ($css -match '\.landing-entry-button\s*\{[\s\S]*?min-width:\s*240px;[\s\S]*?padding:\s*18px 45px;[\s\S]*?font-size:\s*1\.425rem;') 'Küpage is exactly fifty percent larger'
Assert-True ($html -match 'style\.css\?v=7' -and $html -match 'script\.js\?v=6') 'welcome requests only the refreshed scoped assets'
Assert-True ($homeHtml -notmatch 'poster="assets/hero-web\.webp"' -and $homeHtml -match '<video class="hero__video"[^>]*preload="auto"') 'obsolete static poster is never shown before the home video'
Assert-True ($html -match 'rel="prefetch" href="desarrollo\.html"' -and $html -match 'rel="prefetch" href="assets/videos/video-header\.mp4"') 'welcome prepares the destination and its hero video at low priority'
Assert-True ($homeCss -match '\.hero\s*\{[\s\S]*?background:\s*#0f151c;' -and $homeCss -match '\.hero__video\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transition:\s*opacity \.7s ease;' -and $homeCss -match '\.hero__video\.is-ready\s*\{\s*opacity:\s*1;') 'home holds a stable dark background while the video fades in smoothly'
Assert-True ($homeJs -match "querySelector\('\.hero__video'\)" -and $homeJs -match 'readyState\s*>=\s*2' -and $homeJs -match "addEventListener\('loadeddata',\s*revealHeroVideo,\s*\{ once: true \}\)") 'video appears only when its first frame is available'
Assert-True ($homeHtml -match 'desarrollo\.css\?v=83' -and $homeHtml -match 'desarrollo\.js\?v=30') 'home requests the refreshed shared assets'

Write-Output 'Result: scoped landing welcome checks passed.'
