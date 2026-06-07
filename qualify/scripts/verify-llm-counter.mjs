/**
 * Verifica se Com LLM sobe apos um ingest (pos-correcao sync SQLite).
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = 'https://buscainfluencer.com.br/api';
const key = process.env.QUALIFY_INGEST_KEY;
const headers = { 'X-Collector-Key': key };

async function coverageStats(forceRefresh) {
  const url =
    base + '/crawl/collector-llm-pending?coverageStats=1' + (forceRefresh ? '&refresh=1' : '');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const t0 = Date.now();
    const r = await fetch(url, { headers, signal: ac.signal });
    const j = await r.json();
    console.log(`coverage (${forceRefresh ? 'refresh' : 'cache'}) ${Date.now() - t0}ms:`, j);
    return j;
  } finally {
    clearTimeout(t);
  }
}

console.log('=== Baseline Com LLM ===');
const before = await coverageStats(true);
const beforeWith = Number(before.withLlm ?? 0);

console.log('\n=== Qualify 1 perfil (aguardando OK no log)... ===');
const qualifyDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const proc = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: qualifyDir,
  shell: true,
  env: { ...process.env, QUALIFY_BATCH_SIZE: '5' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let okLine = null;
const deadline = Date.now() + 600_000;
proc.stdout.on('data', (buf) => {
  const text = buf.toString();
  process.stdout.write(text);
  if (!okLine && /\[qualify\] @\w+ \| ok \|/.test(text)) okLine = text.trim();
});
proc.stderr.on('data', (buf) => process.stderr.write(buf));

while (!okLine && Date.now() < deadline) {
  if (proc.exitCode != null) break;
  await new Promise((r) => setTimeout(r, 500));
}
proc.kill('SIGTERM');

if (!okLine) {
  console.error('\nNenhum OK em 10 min — abortando verificacao.');
  process.exit(1);
}
console.log('\nOK detectado:', okLine);

console.log('\nAguardando sync SQLite (5s)...');
await new Promise((r) => setTimeout(r, 5000));

console.log('\n=== Depois Com LLM ===');
const after = await coverageStats(true);
const afterWith = Number(after.withLlm ?? 0);
const delta = afterWith - beforeWith;

console.log('\n=== Resultado ===');
console.log(`Antes: ${beforeWith} | Depois: ${afterWith} | Delta: ${delta >= 0 ? '+' : ''}${delta}`);
if (delta >= 1) {
  console.log('CORRECAO OK: contador Com LLM subiu apos ingest.');
} else if (delta === 0) {
  console.log('CORRECAO NAO CONFIRMADA: contador nao subiu (deploy ausente ou sync falhou).');
} else {
  console.log('Contador caiu (exclusoes na mesma janela?) — interprete com logs acima.');
}
