#!/usr/bin/env bash
# Reinicia o coletador após qualquer saída. Uso: npm run watchdog:unix
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HEAP_MB="${COLLECTOR_NODE_HEAP_MB:-8192}"
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${line}" =~ ^[[:space:]]*COLLECTOR_NODE_HEAP_MB[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      v="${BASH_REMATCH[1]//$'\r'/}"
      v="${v%\"}"
      v="${v#\"}"
      v="${v%\'}"
      v="${v#\'}"
      v="${v## }"
      v="${v%% }"
      if [[ "${v}" =~ ^[0-9]+$ ]]; then HEAP_MB="${v}"; fi
    fi
  done < .env
fi

echo "[watchdog] Diretório: ${ROOT} | heap Node: ${HEAP_MB} MB"

while true; do
  echo "[watchdog] Iniciando Node $(date -Iseconds)..."
  set +e
  node --max-old-space-size="${HEAP_MB}" ./node_modules/tsx/dist/cli.mjs src/index.ts
  code=$?
  set -e
  echo "[watchdog] Encerrou com código ${code} em $(date -Iseconds). Nova tentativa em 8 s..."
  sleep 8
done
