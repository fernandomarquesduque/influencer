param(
  [switch] $UseExampleEnvOnly,
  [string] $OutputZip = ""
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-UnixFile {
  param([string] $Path, [string] $Content)
  $cr = [char]13
  $lf = [char]10
  $normalized = $Content.Replace($cr + $lf, $lf).Replace($cr, $lf)
  [System.IO.File]::WriteAllText($Path, $normalized, $Utf8NoBom)
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$Stamp = Get-Date -Format "yyyyMMdd-HHmm"
$FolderName = "InfluencerCollector-Mac-$Stamp"
$ReleaseDir = Join-Path $Root "release"
$Out = Join-Path $ReleaseDir $FolderName

if (-not $OutputZip) {
  $OutputZip = Join-Path $ReleaseDir "InfluencerCollector-Mac-$Stamp.zip"
}

Write-Host "==> Build..."
Push-Location $Root
try {
  npm ci
  npm run build
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $Root "dist\index.js"))) {
  throw "Build failed: dist/index.js missing"
}

Write-Host "==> Staging: $Out"
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Path $Out -Force | Out-Null

Copy-Item -Recurse -Force (Join-Path $Root "dist") $Out
Copy-Item -Force (Join-Path $Root "package.json") $Out
Copy-Item -Force (Join-Path $Root "package-lock.json") $Out
Copy-Item -Force (Join-Path $Root ".env.example") (Join-Path $Out ".env.example")

$envDest = Join-Path $Out ".env"
if ($UseExampleEnvOnly) {
  Copy-Item -Force (Join-Path $Root ".env.example") $envDest
  Write-Host "==> .env from .env.example only"
}
elseif (Test-Path (Join-Path $Root ".env")) {
  Copy-Item -Force (Join-Path $Root ".env") $envDest
  Write-Warning "ZIP contains your .env (secrets). Be careful when emailing."
}
else {
  Copy-Item -Force (Join-Path $Root ".env.example") $envDest
  Write-Host "==> No .env in project; using .env.example as .env"
}

$runLines = @(
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'DIR="$(cd "$(dirname "$0")" && pwd)"',
  'cd "$DIR"',
  'export NODE_ENV=production',
  '',
  'need_install=false',
  'if [[ ! -d node_modules ]] || [[ ! -f node_modules/playwright/package.json ]]; then',
  '  need_install=true',
  'fi',
  'if [[ "$need_install" == true ]]; then',
  '  echo "=========================================="',
  '  echo "  Primeira vez no Mac: npm + Chromium"',
  '  echo "  (Node 18+ precisa estar instalado)"',
  '  echo "=========================================="',
  '  npm ci --omit=dev',
  '  npx playwright install chromium',
  '  echo "Instalacao concluida."',
  'fi',
  'exec node dist/index.js "$@"'
)
Write-UnixFile (Join-Path $Out "run.sh") ($runLines -join [char]10)

$cmdLines = @(
  '#!/usr/bin/env bash',
  'cd "$(dirname "$0")"',
  'exec bash ./run.sh'
)
Write-UnixFile (Join-Path $Out "Influencer Collector.command") ($cmdLines -join [char]10)

$readmeLines = @(
  'Influencer Collector - Mac (email package)',
  '===========================================',
  '',
  '1) Install Node.js 18+: https://nodejs.org/',
  '',
  '2) Unzip this folder.',
  '',
  '3) In Terminal: bash run.sh',
  '   First run installs npm deps + Chromium for Mac.',
  '',
  '4) Open http://localhost:3967 (or COLLECTOR_UI_PORT in .env).',
  '',
  '5) Edit .env for API keys if needed.',
  '',
  'node_modules is created on first run on the Mac.'
)
Write-UnixFile (Join-Path $Out "LEIA-ME-MAC.txt") ($readmeLines -join [char]10)

Write-Host "==> Zipping: $OutputZip"
if (Test-Path $OutputZip) { Remove-Item -Force $OutputZip }
Compress-Archive -Path $Out -DestinationPath $OutputZip -CompressionLevel Optimal

Write-Host ""
Write-Host "Done. Email this file:"
Write-Host "  $OutputZip"
$mb = [math]::Round((Get-Item $OutputZip).Length / 1MB, 2)
Write-Host "Size: $mb MB"
