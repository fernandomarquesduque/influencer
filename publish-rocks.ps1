# Publish influencer (RocksDB): só backend\data\rocksdb, mesma estrutura. Sem frontend, sem backend.
# Uso: .\publish-rocks.ps1
# Para publicar só o banco e colar no servidor onde já está o site e a API.

$ErrorActionPreference = "Stop"
$PublishRoot = "C:\Publish\influencer"
$ProjectRoot = $PSScriptRoot

Write-Host "=== Publish influencer (só banco rocksdb) -> $PublishRoot ===" -ForegroundColor Cyan

# 1) Deletar tudo no início para um publish limpo (pasta do projeto inteira)
if (Test-Path $PublishRoot) {
    Write-Host "Deletando tudo em $PublishRoot (publish limpo) ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PublishRoot -ErrorAction Stop
    if (Test-Path $PublishRoot) {
        Write-Host "ERRO: pasta nao foi removida (arquivo em uso?). Feche e tente de novo." -ForegroundColor Red
        exit 1
    }
}
New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null
Write-Host "Pasta limpa; criada de novo." -ForegroundColor Gray

# 2) Copiar só backend\data\rocksdb mantendo a estrutura (Publish\influencer\backend\data\rocksdb)
$rocksdbSrc = Join-Path $ProjectRoot "backend\data\rocksdb"
$rocksdbDest = Join-Path $PublishRoot "backend\data\rocksdb"
if (Test-Path $rocksdbSrc) {
    New-Item -ItemType Directory -Path $rocksdbDest -Force | Out-Null
    Write-Host "Copiando backend\data\rocksdb (banco) para $rocksdbDest ..." -ForegroundColor Yellow
    Get-ChildItem -Path $rocksdbSrc -Force | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $rocksdbDest -Recurse -Force
    }
} else {
    Write-Host "backend\data\rocksdb nao existe; pulando." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host "Pasta: $PublishRoot" -ForegroundColor White
Write-Host "  - backend\data\rocksdb: banco (só esta pasta). Sem frontend; colar no servidor." -ForegroundColor Gray
Write-Host ""
