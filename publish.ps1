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

# 4) Copiar projeto backend (API) para Publish\influencer\backend (sem node_modules, sem data/)
$backendSrc = Join-Path $ProjectRoot "backend"
$backendDest = Join-Path $PublishRoot "backend"
New-Item -ItemType Directory -Path $backendDest -Force | Out-Null

# Copiar backend excluindo node_modules (e outras pastas) em todos os níveis
$backendExclude = @("node_modules", ".auth", "dist", ".env", "data")
$backendItems = Get-ChildItem -Path $backendSrc -Force | Where-Object { $backendExclude -notcontains $_.Name }
foreach ($item in $backendItems) {
    $destItem = Join-Path $backendDest $item.Name
    if ($item.PSIsContainer) {
        # Copiar pasta sem node_modules: usar robocopy para excluir em todos os níveis
        $null = robocopy $item.FullName $destItem /E /XD node_modules .auth dist .env data /NFL /NDL /NJH /NJS
        if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ao copiar $($item.Name)" }
    } else {
        Copy-Item -Path $item.FullName -Destination $destItem -Force
    }
}
# Garantir que nenhum node_modules ficou no publish
Get-ChildItem -Path $backendDest -Filter "node_modules" -Recurse -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Removendo $($_.FullName) do publish." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $_.FullName
}

# 5) npm ci + build no backend (iisnode usa dist/ + openapi-rocksdb.json + openapi-sqlite.json)
Write-Host "Instalando dependencias do backend (npm ci) em $backendDest ..." -ForegroundColor Yellow
Push-Location $backendDest
try {
    npm ci
    if (-not $?) { throw "npm ci no backend falhou" }
    Write-Host "Build do backend (dist + openapi specs) para iisnode ..." -ForegroundColor Yellow
    npm run build
    if (-not $?) { throw "npm run build no backend falhou" }
} finally {
    Pop-Location
}
# Remover node_modules da pasta de publicacao do backend (instalar no servidor com npm ci)
$backendNodeModules = Join-Path $backendDest "node_modules"
if (Test-Path $backendNodeModules) {
    Write-Host "Removendo node_modules da pasta de publicacao do backend ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $backendNodeModules
}

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot" -ForegroundColor White
Write-Host "  - Raiz: site (frontend). No IIS, physical path = esta pasta." -ForegroundColor Gray
Write-Host "  - backend\: API (iisnode). No IIS, adicione Application alias 'api', path /api, physical path = pasta backend. A API sobe com o App Pool." -ForegroundColor Gray
Write-Host "  - Na pasta backend do servidor, rode 'npm ci --omit=dev' (ou npm ci) para instalar dependencias; node_modules nao e publicado." -ForegroundColor Gray
Write-Host ""
