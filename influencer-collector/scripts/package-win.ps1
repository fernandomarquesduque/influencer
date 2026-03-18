# Empacota o coletor para distribuição no Windows (PowerShell).
# IMPORTANTE: rode no Windows (ou em CI com runner Windows) porque o Playwright baixa
# binários nativos (Chromium) específicos do SO/arquitetura.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$Name = "influencer-collector-windows"
$Out = Join-Path $Root ("release\" + $Name)

Write-Host "==> Instalando dependências e compilando..."
Push-Location $Root

# Instala dependências do projeto inteiro para compilar
npm ci
npm run build

Write-Host "==> Dependências de produção + Chromium (Playwright)..."
npm prune --production
npx playwright install chromium

Write-Host "==> Montando pasta de release em: $Out"
if (Test-Path $Out) {
  Remove-Item -Recurse -Force $Out
}
New-Item -ItemType Directory -Path $Out -Force | Out-Null

# Copia artefatos
Copy-Item -Recurse -Force (Join-Path $Root "dist") $Out
Copy-Item -Recurse -Force (Join-Path $Root "node_modules") $Out
Copy-Item -Force (Join-Path $Root "package.json") $Out
Copy-Item -Force (Join-Path $Root "package-lock.json") $Out
Copy-Item -Force (Join-Path $Root ".env.example") (Join-Path $Out ".env.example")

# Script de execução para rodar com duplo clique
$RunBatPath = Join-Path $Out "run.bat"
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

Pop-Location

Write-Host ""
Write-Host "Pronto. Distribua a pasta inteira: $Out"
Write-Host "No Windows: .\run.bat   ou duplo clique em 'run.bat'"

