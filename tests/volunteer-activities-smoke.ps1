$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'pages/voluntariado.html')
$css = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'css/voluntariado.css')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

$activitiesIndex = $html.IndexOf('class="section-shell section volunteer-activities"')
$plansIndex = $html.IndexOf('class="section-shell section participation"')
$cards = [regex]::Matches($html, 'class="activity-card"')
$mediaSlots = [regex]::Matches($html, 'data-activity-media')
$icons = [regex]::Matches($html, 'class="activity-card__icon(?:\s|\")')

Assert-True ($activitiesIndex -ge 0 -and $activitiesIndex -lt $plansIndex) 'activities section appears before memberships'
Assert-True ($html -match 'id="volunteer-activities-title"' -and $html -match 'aria-labelledby="volunteer-activities-title"') 'section has an accessible heading relationship'
Assert-True ($cards.Count -eq 3) 'section presents three activity cards'
Assert-True ($mediaSlots.Count -eq 3) 'every activity reserves a replaceable image or icon area'
Assert-True ($icons.Count -eq 3) 'every activity includes a related provisional icon'
Assert-True ($html -match 'activity-card__icon--garden' -and $html -match 'activity-card__icon--gathering' -and $html -match 'activity-card__icon--skills') 'icons depict gardening, knowledge exchange, and personal skills'
Assert-True ($html -match 'Huerta y agroecolog' -and $html -match 'Intercambio de saberes' -and $html -match 'Aportes desde habilidades personales') 'all requested activity lines are explained'
Assert-True ($css -match '\.activity-card__media img[\s\S]*object-fit:\s*cover') 'future images already have a fitted presentation rule'
Assert-True ($css -match 'html\[data-theme="day"\] body\.volunteer-page \.volunteer-activities') 'new section supports day mode'
Assert-True ($css -match '@media \(max-width: 820px\)[\s\S]*\.volunteer-activities__grid') 'activity cards adapt for tablet and mobile'
Assert-True ($css -match '@media \(max-width: 520px\)[\s\S]*\.activity-card__media\s*\{\s*min-height:\s*132px') 'mobile icon area stays compact'
Assert-True ($css -match '@media \(hover: none\)[\s\S]*transform:\s*none') 'touch screens do not retain a displaced hover card'
Assert-True ($css -match '@media \(prefers-reduced-motion: reduce\)[\s\S]*\.activity-card__icon') 'activity motion respects reduced-motion preferences'
Assert-True ($css -match '@keyframes activityGardenBob' -and $css -match '@keyframes activityFlame' -and $css -match '@keyframes activityFlash') 'each provisional illustration has pertinent motion'
Assert-True ($css -match '\.volunteer-activities\s*\{[\s\S]*?background:\s*#0b121b;' -and $css -match '\.volunteer-activities::before\s*\{\s*display:\s*none') 'night background matches memberships without decorative stars or gradients'
Assert-True ($html -match 'voluntariado\.css\?v=20') 'page requests the refreshed activity styles'

Write-Output 'Result: volunteer activities section smoke checks passed.'
