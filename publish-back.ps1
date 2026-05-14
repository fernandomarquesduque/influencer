# Publish influencer LITE: só a API (backend), sem frontend, sem node_modules, sem data
# No servidor: npm ci e opcionalmente playwright install
# Uso: .\publish-back.ps1

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer\backend"
$ProjectRoot = $PSScriptRoot

Write-Host "=== Publish influencer (LITE) -> $PublishRoot ===" -ForegroundColor Cyan
Write-Host "  (só backend, sem node_modules e sem data)" -ForegroundColor Gray

# 1) Limpar e criar pasta de publish
if (Test-Path $PublishRoot) {
    Write-Host "Limpando $PublishRoot ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PublishRoot
}
New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null

# 2) Build do backend na pasta do projeto (gera dist/)
Write-Host "Build do backend (na pasta do projeto) ..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "backend")
try {
    npm run build
    if (-not $?) { throw "npm run build no backend falhou" }
} finally {
    Pop-Location
}

# 3) Copiar backend para Publish SEM node_modules e SEM data (inclui dist já buildado)
$backendSrc = Join-Path $ProjectRoot "backend"
$backendExclude = @("node_modules", "data", ".auth", ".env")
Get-ChildItem -Path $backendSrc -Force | Where-Object { $backendExclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $PublishRoot -Recurse -Force
}

Write-Host ""
Write-Host "=== Pronto (LITE) ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot" -ForegroundColor White
Write-Host "  - API (backend) com dist/ e package.json, SEM node_modules e SEM data." -ForegroundColor Gray
Write-Host "  - No servidor: npm ci && npx playwright install chromium (se precisar)" -ForegroundColor Gray
Write-Host ""
