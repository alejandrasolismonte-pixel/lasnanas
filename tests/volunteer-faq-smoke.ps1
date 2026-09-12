$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'pages/voluntariado.html')
$css = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/voluntariado.css')
$js = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'js/voluntariado.js')
$avatarPath = Join-Path $root 'assets/img/voluntariado/nana-preguntas-web.webp'

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

$experiencesIndex = $html.IndexOf('class="section-shell section volunteer-experiences"')
$faqIndex = $html.IndexOf('class="section-shell section volunteer-faq"')
$contactIndex = $html.IndexOf('class="section-shell section contact-section"')
$faqItems = [regex]::Matches($html, 'class="volunteer-faq__item"')
$guideMessages = [regex]::Matches($html, 'data-guide-message=')

Assert-True ($experiencesIndex -ge 0 -and $faqIndex -gt $experiencesIndex -and $contactIndex -gt $faqIndex) 'FAQ sits directly after the experience diaries and before registration'
Assert-True ($html -match 'id="volunteer-faq-title"' -and $html -match 'aria-labelledby="volunteer-faq-title"') 'FAQ has an accessible heading relationship'
Assert-True ($faqItems.Count -eq 10) 'FAQ contains no more and no fewer than ten proposed questions'
Assert-True ($guideMessages.Count -eq 10) 'every question has a short human guide message'
Assert-True ($html -match 'seguridad' -and $html -match 'conexi.n a internet' -and $html -match 'locomoci.n p.blica') 'FAQ covers safety, connectivity, and transportation'
Assert-True ($html -match 'horas de apoyo' -and $html -match 'flexibilidad' -and $html -match 'acuerdo com.n') 'FAQ explains hours and flexible mutual agreement'
Assert-True ($html -match 'volunteer-faq__portrait' -and $html -match 'nana-preguntas-web\.webp') 'human guide illustration is connected to the section'
Assert-True (Test-Path -LiteralPath $avatarPath) 'guide illustration asset exists'

$python = (Get-Command python.exe -ErrorAction Stop).Source
$avatarInfo = & $python -c 'from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(im.mode, im.getpixel((0, 0))[3], sep=chr(44))' $avatarPath
Assert-True ($LASTEXITCODE -eq 0 -and $avatarInfo -match '^RGBA,') 'guide illustration carries an alpha channel'
Assert-True ($avatarInfo -eq 'RGBA,0') 'guide illustration has a transparent outer background'

Assert-True ($css -match '\.volunteer-faq\s*\{[\s\S]*background:\s*var\(--volunteer-faq-bg\)' -and $css -match 'Vetas discretas e irregulares') 'section uses a restrained bark-like background instead of stars'
Assert-True ($css -match '\.volunteer-faq__answer[\s\S]*clip-path:\s*polygon') 'answers use an angular organic speech shape'
Assert-True ($css -match 'html\[data-theme="day"\] body\.volunteer-page \.volunteer-faq') 'FAQ supports day mode'
Assert-True ($css -match '@media \(max-width: 920px\)[\s\S]*\.volunteer-faq__layout' -and $css -match '@media \(max-width: 600px\)[\s\S]*\.volunteer-faq__item summary') 'FAQ has dedicated tablet and mobile layouts'
Assert-True ($css -match '@media \(prefers-reduced-motion: reduce\)[\s\S]*\.volunteer-faq__answer') 'FAQ respects reduced-motion preferences'
Assert-True ($js -match "item\.addEventListener\('toggle'" -and $js -match "otherItem\.removeAttribute\('open'\)") 'FAQ keeps one conversational answer open at a time'
Assert-True ($js -match 'data-faq-guide-status' -and $js -match 'dataset\.guideMessage') 'guide text follows the open question'
Assert-True ($html -match 'voluntariado\.css\?v=20' -and $html -match 'voluntariado\.js\?v=4') 'page requests refreshed FAQ styles and behavior'

Write-Output 'Result: volunteer FAQ smoke checks passed.'
