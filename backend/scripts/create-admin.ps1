# Cria ou atualiza o usuário admin no servidor (usa o mesmo DB da API).
# Uso no servidor (PowerShell):
#   cd C:\Publish\influencer\backend   (ou o caminho da pasta backend no servidor)
#   .\scripts\create-admin.ps1
#   .\scripts\create-admin.ps1 -Password "MinhaS3nha"
#   .\scripts\create-admin.ps1 -Username admin -Password "OutraS3nha"
param(
    [string]$Username = "admin",
    [string]$Password = "admin"
)
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$crawlDir = Split-Path -Parent $scriptDir
Push-Location $crawlDir
try {
    $env:ADMIN_USERNAME = $Username
    $env:ADMIN_PASSWORD = $Password
    Write-Host "Criando/atualizando usuario: $Username (pasta: $crawlDir)" -ForegroundColor Cyan
    npm run create-admin:server
    if ($LASTEXITCODE -ne 0) { throw "create-admin:server falhou" }
    Write-Host "Pronto. Faca login em https://influencer.creait.com.br/login com usuario e senha informados." -ForegroundColor Green
} finally {
    Pop-Location
}
