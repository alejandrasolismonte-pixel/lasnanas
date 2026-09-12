$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'desarrollo.html')

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Output "OK: $message"
}

Assert-True ($html -notmatch 'cdn\.tailwindcss\.com|font-awesome|cdnjs\.cloudflare\.com/ajax/libs/font-awesome') 'the game has no Tailwind or Font Awesome dependency'
Assert-True ($html -match "const memoryIconPaths = Object\.freeze" -and $html -match "renderMemoryIcon\(item\.icon, 'card-icon', item\.color\)") 'cards render the local SVG icon set'
Assert-True ($html -notmatch 'class="(?:[^" ]+ )*(?:w-full|aspect-\[3/4\]|text-green-500|text-gray-300)(?: [^"]+)*"') 'removed utility classes are not used in the game markup'
Assert-True ($html -match "document\.createElement\('button'\)" -and $html -match "cardElement\.type = 'button'" -and $html -match "cardElement\.disabled = true|firstCard\.disabled = true") 'cards are keyboard controls and matched pairs become inactive'
Assert-True ($html -match "setAttribute\('aria-label', 'Carta oculta'\)" -and $html -match "setAttribute\('aria-label', this\.dataset\.cardLabel\)") 'accessible card labels reveal content only while face up'
Assert-True ($html -match 'id="memory-status"[^>]*role="status"[^>]*aria-live="polite"') 'turn and match changes have a live announcement'
Assert-True ($html -match 'id="victory-message"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden' -and $html -match 'victoryMessage\.hidden = false' -and $html -match 'victoryMessage\.hidden = true') 'victory dialog uses one consistent visibility mechanism'
Assert-True ($html -notmatch 'victoryMessage\.classList\.(?:add|remove)\(''hidden''\)') 'obsolete modal class toggling is gone'
Assert-True ($html -match "title\.dataset\.tone = 'draw'" -and $html -notmatch 'title\.className\s*=') 'draw styling preserves the modal title component class'
Assert-True ($html -match 'window\.clearTimeout\(mismatchTimer\)' -and $html -match 'window\.clearTimeout\(victoryTimer\)') 'restart cancels pending board and victory timers'
Assert-True ($html -match "getElementById\('replay-btn'\)\.addEventListener\('click', resetGame\)") 'replay uses a registered event listener'
Assert-True ($html -notmatch '<style>[\s\S]*?body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?</style>' -and $html -match '#juego-memorice\s*\{[\s\S]*?padding:\s*\.75rem 1rem 7rem;[\s\S]*?justify-content:\s*flex-start;[\s\S]*?overflow:\s*visible;' -and $html -match '\.memory-game-container\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?overflow:\s*visible;') 'embedded game reserves its full height and an explicit safety area before the footer'
Assert-True ($html -match '@media \(min-width:\s*768px\)[\s\S]*?\.memory-game-container\s*\{[\s\S]*?margin-top:\s*-2\.5rem;') 'desktop board is raised toward the scoreboard'

Write-Output 'Result: Memorice smoke checks passed.'
