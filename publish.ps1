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
$frontendPath = Join-Path $ProjectRoot "frontend"
Push-Location $frontendPath
try {
    $errAct = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    npm ci 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm ci falhou (ex.: EPERM); tentando npm install ..." -ForegroundColor Yellow
        npm install 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $errAct; throw "npm install falhou" }
    }
    npm run build
    $ErrorActionPreference = $errAct
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }
} finally {
    Pop-Location
}

# 3) Copiar conteúdo do frontend (dist) para a raiz do publish (site para IIS)
$distPath = Join-Path $ProjectRoot "frontend\dist"
Write-Host "Copiando site (frontend\dist) para $PublishRoot ..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $distPath "*") -Destination $PublishRoot -Recurse -Force

# 4) Copiar projeto crawl (API) para Publish\influencer\crawl (sem node_modules, sem data/)
$crawlSrc = Join-Path $ProjectRoot "crawl"
$crawlDest = Join-Path $PublishRoot "crawl"
New-Item -ItemType Directory -Path $crawlDest -Force | Out-Null

$crawlExclude = @("node_modules", ".auth", "dist", ".env", "data")
Get-ChildItem -Path $crawlSrc -Force | Where-Object { $crawlExclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $crawlDest -Recurse -Force
}
# Garantir que node_modules não foi copiado (remover se existir)
$crawlNodeModules = Join-Path $crawlDest "node_modules"
if (Test-Path $crawlNodeModules) {
    Write-Host "Removendo node_modules do publish (não deve ser copiado)." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $crawlNodeModules
}

# 5) npm ci + build no crawl (iisnode usa dist/ + openapi-rocksdb.json + openapi-sqlite.json)
Write-Host "Instalando dependencias do crawl (npm ci) em $crawlDest ..." -ForegroundColor Yellow
Push-Location $crawlDest
try {
    npm ci
    if (-not $?) { throw "npm ci no crawl falhou" }
    Write-Host "Build do crawl (dist + openapi specs) para iisnode ..." -ForegroundColor Yellow
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
