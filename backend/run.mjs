/**
 * Entry point para iisnode. O IIS executa: node run.mjs
 * Requer: npm run build (gera dist/) antes do deploy.
 *
 * Sem --max-old-space-size o V8 fica ~4144 MiB (veja [mem] v8_heap_limit_mb nos logs) e o segundo refresh pode dar OOM.
 * Opcional: NODE_HEAP_MB ou API_NODE_HEAP_MB no .env (MiB), default 16384.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @returns {number} */
function heapMbFromEnv() {
  const raw = process.env.NODE_HEAP_MB ?? process.env.API_NODE_HEAP_MB;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 512) return n;
  }
  return 16384;
}

const heapMb = heapMbFromEnv();
const serverEntry = path.join(__dirname, 'dist', 'api', 'server.js');

const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, serverEntry], {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('[run.mjs] falha ao iniciar worker da API:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal != null) process.exit(1);
  process.exit(code == null ? 1 : code);
});
