# Reinicia o coletador automaticamente após qualquer saída (OOM, crash, Ctrl+C no processo filho).
# Uso (na pasta influencer-collector): npm run watchdog
# Ou da raiz do monorepo: npm run collector:watchdog
# Heap: variável COLLECTOR_NODE_HEAP_MB no ambiente ou no arquivo .env (mesma pasta do package.json).

$ErrorActionPreference = 'Stop'
$CollectorRoot = Split-Path $PSScriptRoot -Parent
Set-Location $CollectorRoot

$envFile = Join-Path $CollectorRoot '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -lt 1) { continue }
    $k = $t.Substring(0, $eq).Trim()
    $v = $t.Substring($eq + 1).Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    elseif ($v.StartsWith("'") -and $v.EndsWith("'") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    [Environment]::SetEnvironmentVariable($k, $v, 'Process')
  }
}

$heapMb = $env:COLLECTOR_NODE_HEAP_MB
if (-not $heapMb -or $heapMb -notmatch '^\d+$') { $heapMb = '8192' }

Write-Host "[watchdog] Diretório: $CollectorRoot | heap Node: ${heapMb} MB | Ctrl+C encerra o watchdog (não reinicia)."

while ($true) {
  Write-Host "[watchdog] Iniciando Node $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')..."
  $p = Start-Process -FilePath 'node' -ArgumentList @(
    "--max-old-space-size=$heapMb",
    (Join-Path $CollectorRoot 'node_modules/tsx/dist/cli.mjs'),
    (Join-Path $CollectorRoot 'src/index.ts')
  ) -WorkingDirectory $CollectorRoot -NoNewWindow -Wait -PassThru
  $code = $p.ExitCode
  Write-Host "[watchdog] Processo encerrou com código $code em $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). Nova tentativa em 8 s..."
  Start-Sleep -Seconds 8
}
