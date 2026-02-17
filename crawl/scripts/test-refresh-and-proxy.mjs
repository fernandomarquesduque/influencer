/**
 * Testa o fluxo: queue-refresh -> aguardar re-extração -> GET perfil -> testar proxy-image.
 * Uso: node scripts/test-refresh-and-proxy.mjs [handle]
 * API deve estar rodando em http://localhost:3500
 */
const API = 'http://localhost:3500/api';
const handle = process.argv[2] || 'jonathas_avis';
const REFETCH_INTERVAL_MS = 20_000;
const REFETCH_MAX = 6;

async function getProfile(h) {
  const r = await fetch(`${API}/profiles/${encodeURIComponent(h)}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!r.ok) return null;
  return r.json();
}

async function queueRefresh(h) {
  const r = await fetch(`${API}/crawl/queue-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: h }),
  });
  return r.json();
}

async function testProxyImage(url) {
  const proxyUrl = `${API}/proxy-image?url=${encodeURIComponent(url)}`;
  const r = await fetch(proxyUrl);
  return { status: r.status, ok: r.ok };
}

async function main() {
  console.log('1. GET perfil atual:', handle);
  let profile = await getProfile(handle);
  if (!profile) {
    console.error('Perfil não encontrado.');
    process.exit(1);
  }
  const collectedAtBefore = profile._collected_at;
  const picBefore = profile.profile_pic_url ? profile.profile_pic_url.slice(0, 80) + '...' : '';

  console.log('2. POST queue-refresh');
  const q = await queueRefresh(handle);
  console.log('   Resposta:', q.message || q);

  console.log('3. Polling GET perfil a cada 20s (máx 6x) até _collected_at mudar ou timeout');
  for (let i = 0; i < REFETCH_MAX; i++) {
    await new Promise((r) => setTimeout(r, REFETCH_INTERVAL_MS));
    profile = await getProfile(handle);
    if (!profile) continue;
    if (profile._collected_at && profile._collected_at !== collectedAtBefore) {
      console.log(`   [${i + 1}] _collected_at atualizado:`, profile._collected_at);
      break;
    }
    console.log(`   [${i + 1}] ainda antigo (_collected_at: ${profile._collected_at})`);
  }

  const picUrl = profile?.profile_pic_url;
  if (!picUrl) {
    console.log('4. Sem profile_pic_url no perfil.');
    process.exit(0);
  }

  console.log('5. Testar proxy-image com a URL do perfil');
  const proxyResult = await testProxyImage(picUrl);
  console.log('   Status proxy-image:', proxyResult.status, proxyResult.ok ? '(OK)' : '(falha)');

  if (proxyResult.ok) {
    console.log('\nResultado: imagem acessível via proxy. Fluxo OK.');
  } else {
    console.log('\nResultado: proxy retornou', proxyResult.status, '- CDN/fallbacks podem estar bloqueando esta URL.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
