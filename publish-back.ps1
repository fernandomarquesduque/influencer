# Publish influencer LITE: só a API (crawl), sem frontend, sem node_modules, sem data
# No servidor: npm ci e opcionalmente playwright install
# Uso: .\publish-lite.ps1

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer\crawl"
$ProjectRoot = $PSScriptRoot

Write-Host "=== Publish influencer (LITE) -> $PublishRoot ===" -ForegroundColor Cyan
Write-Host "  (só crawl, sem node_modules e sem data)" -ForegroundColor Gray

# 1) Limpar e criar pasta de publish
if (Test-Path $PublishRoot) {
    Write-Host "Limpando $PublishRoot ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PublishRoot
}
New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null

# 2) Build do crawl na pasta do projeto (gera dist/)
Write-Host "Build do crawl (na pasta do projeto) ..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "crawl")
try {
    npm run build
    if (-not $?) { throw "npm run build no crawl falhou" }
} finally {
    Pop-Location
}

# 3) Copiar crawl para Publish SEM node_modules e SEM data (inclui dist já buildado)
$crawlSrc = Join-Path $ProjectRoot "crawl"
$crawlExclude = @("node_modules", "data", ".auth", ".env")
Get-ChildItem -Path $crawlSrc -Force | Where-Object { $crawlExclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $PublishRoot -Recurse -Force
}

Write-Host ""
Write-Host "=== Pronto (LITE) ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot" -ForegroundColor White
Write-Host "  - API (crawl) com dist/ e package.json, SEM node_modules e SEM data." -ForegroundColor Gray
Write-Host "  - No servidor: npm ci && npx playwright install chromium (se precisar)" -ForegroundColor Gray
Write-Host ""
