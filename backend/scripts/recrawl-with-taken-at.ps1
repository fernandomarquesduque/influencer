# Garante que os posts sejam extraídos com taken_at (data de publicação).
# 1. Pare a API (Ctrl+C no terminal onde ela está rodando).
# 2. Execute este script.
# 3. Inicie a API novamente e confira GET /api/posts (post.taken_at deve aparecer).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Limpando banco e rodando crawl (tag=viagem, limit=1)..." -ForegroundColor Cyan
npx tsx src/cli/crawl-hashtag.ts --tag viagem --limit 1 --clear

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nCrawl concluído. Inicie a API e verifique os posts: GET http://localhost:3000/api/posts" -ForegroundColor Green
    Write-Host "Cada item deve ter post.taken_at (timestamp Unix da publicação)." -ForegroundColor Green
}
else {
    Write-Host "`nSe o erro for 'LOCK' ou 'Database failed to open', pare a API e execute este script de novo." -ForegroundColor Yellow
}
