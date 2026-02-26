# Publish apenas frontend: build e monta C:\Publish\influencer (só site, sem crawl/API)
# Uso: .\publish-front.ps1
#      .\publish-front.ps1 -OnlyCopy   # Só copia frontend\dist (sem build; use se já compilou antes)

param([switch]$OnlyCopy)

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer"
$ProjectRoot = $PSScriptRoot
$distPath = Join-Path $ProjectRoot "frontend\dist"

Write-Host "=== Publish frontend -> $PublishRoot ===" -ForegroundColor Cyan

# 1) Limpar e criar pasta de publish
if (Test-Path $PublishRoot) {
    Write-Host "Limpando $PublishRoot ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PublishRoot
}
New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null

# 2) Build frontend (a menos que -OnlyCopy)
if (-not $OnlyCopy) {
    Write-Host "Build frontend ..." -ForegroundColor Yellow
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        $npmCiOk = $false
        try {
            npm ci 2>&1 | Out-Null
            $npmCiOk = $LASTEXITCODE -eq 0
        } catch {
            Write-Host "npm ci falhou: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        if (-not $npmCiOk) {
            Write-Host "Executando npm install ..." -ForegroundColor Gray
            npm install 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "npm install falhou" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }
    } finally {
        Pop-Location
    }
} else {
    if (-not (Test-Path $distPath)) {
        throw "Pasta frontend\dist nao encontrada. Rode o build antes (npm run build no frontend) ou execute sem -OnlyCopy."
    }
    Write-Host "Pulando build (-OnlyCopy). Usando frontend\dist existente." -ForegroundColor Gray
}

# 3) Copiar conteúdo do frontend (dist) para a raiz do publish (site para IIS)
Write-Host "Copiando site (frontend\dist) para $PublishRoot ..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $distPath "*") -Destination $PublishRoot -Recurse -Force

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot (apenas frontend)" -ForegroundColor White
Write-Host "No IIS, defina o physical path do site para esta pasta." -ForegroundColor Gray
Write-Host ""
