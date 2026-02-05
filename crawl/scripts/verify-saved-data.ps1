# Verifica se perfis e posts foram salvos no formato esperado (após reiniciar API e rodar crawl).
# Uso: .\scripts\verify-saved-data.ps1

$base = "http://localhost:3000"
Write-Host "=== Verificando dados salvos ===" -ForegroundColor Cyan

# 1. Um perfil
$profResp = Invoke-WebRequest -Uri "$base/api/profiles?limit=1" -UseBasicParsing
$profJson = $profResp.Content | ConvertFrom-Json
if ($profJson.total -eq 0) {
    Write-Host "Nenhum perfil no banco. Rode um crawl antes." -ForegroundColor Yellow
    exit 1
}
$p = $profJson.items[0]
$hasDataUser = $null -ne $p.data -and $null -ne $p.data.user
if ($hasDataUser) {
    Write-Host "[OK] Perfil no formato completo (data.user presente)" -ForegroundColor Green
}
else {
    Write-Host "[!] Perfil em formato antigo (sem data.user). Reinicie a API e rode o crawl de novo." -ForegroundColor Yellow
}

# 2. Um post
$postResp = Invoke-WebRequest -Uri "$base/api/posts?limit=1" -UseBasicParsing
$postJson = $postResp.Content | ConvertFrom-Json
if ($postJson.total -eq 0) {
    Write-Host "Nenhum post no banco." -ForegroundColor Yellow
    exit 0
}
$post = $postJson.items[0]
$slimPost = $null -ne $post.image_url -or $null -ne $post.video_url
$captionStr = $null -ne $post.caption -and $post.caption.GetType().Name -eq "String"
if ($slimPost -and $captionStr) {
    Write-Host "[OK] Post no formato kit minimo (image_url/video_url, caption string)" -ForegroundColor Green
}
else {
    Write-Host "[!] Post em formato bruto (caption objeto, sem image_url no topo). Reinicie a API e rode o crawl." -ForegroundColor Yellow
}

Write-Host "`nPerfil (amostra): handle=$($p.handle) keys=$($p.PSObject.Properties.Name -join ',')"
Write-Host "Post (amostra): code=$($post.code) image_url=$($null -ne $post.image_url) caption tipo=$($post.caption.GetType().Name)"
