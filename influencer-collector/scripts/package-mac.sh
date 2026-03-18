#!/usr/bin/env bash
# Empacota o coletor para distribuição no macOS.
# IMPORTANTE: execute no Mac (ou em runner macOS). Playwright inclui binários nativos por SO.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
NAME="influencer-collector-macos"
OUT="$ROOT/release/$NAME"

echo "==> Instalando dependências e compilando..."
npm ci
npm run build

echo "==> Dependências de produção + Chromium (Playwright)..."
npm prune --production
npx playwright install chromium

echo "==> Montando pasta de release em: $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist node_modules package.json package-lock.json "$OUT/"
cp -f .env.example "$OUT/" 2>/dev/null || true

cat > "$OUT/run.sh" << 'RUNEOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
export NODE_ENV=production
if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  echo "Copie .env.example para .env e configure."
fi
exec node dist/index.js "$@"
RUNEOF
chmod +x "$OUT/run.sh"

# Duplo clique no Finder abre o Terminal e roda o coletor
cat > "$OUT/Influencer Collector.command" << 'CMDEOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
exec ./run.sh
CMDEOF
chmod +x "$OUT/Influencer Collector.command"

echo ""
echo "Pronto. Distribua a pasta inteira: $OUT"
echo "No Mac: ./run.sh   ou duplo clique em 'Influencer Collector.command'"
echo "Primeira vez: copie .env.example -> .env"
