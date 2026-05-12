/**
 * Testa o fluxo extract + request-code em uma única chamada (sem frontend no meio).
 * A API deve estar rodando (npm run api). O endpoint executa extract e envio de DM em sequência no backend.
 *
 * Uso: npx tsx scripts/test-request-code-with-extract.ts [handle]
 * Ex.: npx tsx scripts/test-request-code-with-extract.ts marquesduque
 *
 * Se omitir o handle, usa INSTAGRAM_PERFIL do .env.
 */
import 'dotenv/config';

const API_BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 3500}`;
const handle = process.argv[2]?.trim().replace(/^@/, '') ?? process.env.INSTAGRAM_PERFIL?.trim().replace(/^@/, '');

if (!handle) {
  console.error('Uso: npx tsx scripts/test-request-code-with-extract.ts [handle]');
  console.error('Ou defina INSTAGRAM_PERFIL no .env');
  process.exit(1);
}

async function main() {
  console.log(`[test] Chamando POST ${API_BASE}/api/auth/request-code-with-extract com handle=@${handle}`);
  const t0 = Date.now();

  const res = await fetch(`${API_BASE}/api/auth/request-code-with-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: handle, handle }),
  });

  const elapsed = Date.now() - t0;
  const body = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log(`[test] OK em ${elapsed}ms — sent=${body.sent}${body.code ? `, code=${body.code}` : ''}`);
  } else {
    console.error(`[test] ERRO ${res.status} em ${elapsed}ms —`, body.error ?? body);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[test] Falha:', e instanceof Error ? e.message : e);
  process.exit(1);
});
