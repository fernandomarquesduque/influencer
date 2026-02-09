# Publish influencer: build frontend + monta C:\Publish\influencer pronto para copiar ao servidor
# Uso: .\publish.ps1

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer"
$ProjectRoot = $PSScriptRoot

Write-Host "=== Publish influencer -> $PublishRoot ===" -ForegroundColor Cyan

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

# 4) Copiar projeto crawl (API) para Publish\influencer\crawl (sem node_modules; COM data/ para o banco)
$crawlSrc = Join-Path $ProjectRoot "crawl"
$crawlDest = Join-Path $PublishRoot "crawl"
New-Item -ItemType Directory -Path $crawlDest -Force | Out-Null

$crawlExclude = @("node_modules", ".auth", "dist", ".env")
Get-ChildItem -Path $crawlSrc -Force | Where-Object { $crawlExclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $crawlDest -Recurse -Force
}
if (Test-Path (Join-Path $crawlSrc "data")) {
    Write-Host "Copiando banco de dados (crawl\data) ..." -ForegroundColor Yellow
}

# 5) npm ci + build no crawl (iisnode usa run.mjs + dist/)
Write-Host "Instalando dependencias do crawl (npm ci) em $crawlDest ..." -ForegroundColor Yellow
Push-Location $crawlDest
try {
    npm ci
    if (-not $?) { throw "npm ci no crawl falhou" }
    Write-Host "Build do crawl (dist + openapi.json) para iisnode ..." -ForegroundColor Yellow
    npm run build
    if (-not $?) { throw "npm run build no crawl falhou" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot" -ForegroundColor White
Write-Host "  - Raiz: site (frontend). No IIS, physical path = esta pasta." -ForegroundColor Gray
Write-Host "  - crawl\: API (iisnode). No IIS, adicione Application alias 'api', path /api, physical path = pasta crawl. A API sobe com o App Pool." -ForegroundColor Gray
Write-Host ""
