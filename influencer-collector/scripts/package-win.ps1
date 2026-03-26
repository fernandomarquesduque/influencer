# Empacota o coletor para distribuição no Windows (PowerShell).
# IMPORTANTE: rode no Windows (ou em CI com runner Windows) porque o Playwright baixa
# binários nativos (Chromium) específicos do SO/arquitetura.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$Name = "influencer-collector-windows"
$ReleaseDir = Join-Path $Root "release"
$Out = Join-Path $ReleaseDir $Name
# Monta primeiro em staging (evita falha se a pasta de release estiver aberta no Explorer / em uso)
$Staging = Join-Path $ReleaseDir "_collector-win-staging"

Write-Host "==> Instalando dependências e compilando..."
Push-Location $Root

# Instala dependências do projeto inteiro para compilar
npm ci
npm run build

Write-Host "==> Dependências de produção + Chromium (Playwright)..."
npm prune --production
npx playwright install chromium

Write-Host "==> Montando pasta de staging em: $Staging"
if (Test-Path $Staging) {
  Remove-Item -Recurse -Force $Staging
}
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

# Copia artefatos
Copy-Item -Recurse -Force (Join-Path $Root "dist") $Staging
Copy-Item -Recurse -Force (Join-Path $Root "node_modules") $Staging
Copy-Item -Force (Join-Path $Root "package.json") $Staging
Copy-Item -Force (Join-Path $Root "package-lock.json") $Staging
Copy-Item -Force (Join-Path $Root ".env.example") (Join-Path $Staging ".env.example")

# Script de execução para rodar com duplo clique
$RunBatPath = Join-Path $Staging "run.bat"
@'
@echo off
setlocal

set NODE_ENV=production

if exist "%~dp0.env" (
  echo Usando "%~dp0.env"
) else (
  if exist "%~dp0.env.example" (
    echo Copie ".env.example" para ".env" e configure.
  )
)

cd /d "%~dp0"
node dist\index.js %*

endlocal
'@ | Set-Content -Path $RunBatPath -Encoding ASCII

Write-Host "==> Publicando em: $Out"
if (Test-Path $Out) {
  try {
    Remove-Item -Recurse -Force $Out -ErrorAction Stop
  }
  catch {
    Write-Warning "Não foi possível remover a pasta antiga (em uso?). Copiando por cima do que for possível..."
    Get-ChildItem -LiteralPath $Out -Force -ErrorAction SilentlyContinue | ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
if (-not (Test-Path $Out)) {
  New-Item -ItemType Directory -Path $Out -Force | Out-Null
}
Copy-Item -Path (Join-Path $Staging "*") -Destination $Out -Recurse -Force

if (Test-Path $Staging) {
  Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue
}

Write-Host "==> Restaurando node_modules completo para desenvolvimento (npm ci)..."
npm ci

Pop-Location

Write-Host ""
Write-Host "Pronto. Distribua a pasta inteira: $Out"
Write-Host "No Windows: .\run.bat   ou duplo clique em 'run.bat'"

