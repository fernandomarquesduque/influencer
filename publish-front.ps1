# Publish apenas frontend: build e monta C:\Publish\influencer (só site, sem crawl/API)
# Uso: .\publish-front.ps1

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer"
$ProjectRoot = $PSScriptRoot

Write-Host "=== Publish frontend -> $PublishRoot ===" -ForegroundColor Cyan

# 1) Limpar e criar pasta de publish
if (Test-Path $PublishRoot) {
    Write-Host "Limpando $PublishRoot ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PublishRoot
}
New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null

# 2) Build frontend
Write-Host "Build frontend ..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "frontend")
try {
    npm ci 2>&1 | Out-Null
    if (-not $?) { throw "npm ci falhou" }
    npm run build
    if (-not $?) { throw "npm run build falhou" }
} finally {
    Pop-Location
}

# 3) Copiar conteúdo do frontend (dist) para a raiz do publish (site para IIS)
$distPath = Join-Path $ProjectRoot "frontend\dist"
Write-Host "Copiando site (frontend\dist) para $PublishRoot ..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $distPath "*") -Destination $PublishRoot -Recurse -Force

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot (apenas frontend)" -ForegroundColor White
Write-Host "No IIS, defina o physical path do site para esta pasta." -ForegroundColor Gray
Write-Host ""
