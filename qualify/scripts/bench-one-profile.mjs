/**
 * Diagnostico de lentidao: mede cada etapa do qualify em 1 perfil.
 * Uso: node scripts/bench-one-profile.mjs
 */
import 'dotenv/config';
import { Ollama } from 'ollama';

const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_API_TIMEOUT_MS = 30000;

function normalizeBaseUrl(raw) {
  return raw.trim().replace(/\/+$/, '');
}

function getApiBase() {
  const base = process.env.QUALIFY_API_BASE?.trim() || process.env.COLLECTOR_API_BASE?.trim();
  if (!base) throw new Error('QUALIFY_API_BASE nao definido');
  if (process.env.QUALIFY_API_NO_AUTO_SUFFIX === '1') return normalizeBaseUrl(base);
  if (/\/api(\/|$)/i.test(base)) return normalizeBaseUrl(base);
  return normalizeBaseUrl(`${base}/api`);
}

function getIngestKey() {
  const key = process.env.QUALIFY_INGEST_KEY?.trim() || process.env.COLLECTOR_INGEST_KEY?.trim();
  if (!key) throw new Error('QUALIFY_INGEST_KEY nao definido');
  return key;
}

function getTimeoutMs() {
  const n = Number(process.env.QUALIFY_API_TIMEOUT_MS ?? DEFAULT_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_API_TIMEOUT_MS;
}

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    console.log(`  [${String(ms).padStart(6)} ms] ${label}`);
    return { ms, result, ok: true };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  [${String(ms).padStart(6)} ms] ${label} — ERRO: ${msg}`);
    return { ms, error: msg, ok: false };
  }
}

async function fetchJson(url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${data.error ?? text.slice(0, 120)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiBase = getApiBase();
  const ingestKey = getIngestKey();
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  const ollamaHost = process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';

  console.log('=== Bench qualify (1 perfil) ===');
  console.log(`API: ${apiBase}`);
  console.log(`Ollama: ${ollamaHost} | modelo: ${model}`);
  console.log('');

  const rows = [];

  console.log('1) API remota');
  rows.push(await timed('coverageStats (collector-llm-pending?coverageStats=1)', () =>
    fetchJson(`${apiBase}/crawl/collector-llm-pending?coverageStats=1`, {
      method: 'GET',
      headers: { 'X-Collector-Key': ingestKey },
    }, getTimeoutMs())
  ));

  const pending = await timed('fila pendentes (limit=1)', () =>
    fetchJson(`${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=0&mediaLimit=4`, {
      method: 'GET',
      headers: { 'X-Collector-Key': ingestKey },
    }, getTimeoutMs())
  );
  rows.push(pending);

  if (!pending.ok || !pending.result?.items?.length) {
    console.log('\nSem perfil pendente na fila. Tentando refreshAll=1...');
    const pending2 = await timed('fila com refreshAll=1 (limit=1)', () =>
      fetchJson(`${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=1&mediaLimit=4`, {
        method: 'GET',
        headers: { 'X-Collector-Key': ingestKey },
      }, getTimeoutMs())
    );
    rows.push(pending2);
    if (!pending2.ok || !pending2.result?.items?.length) {
      console.log('Nenhum perfil disponivel para benchmark LLM.');
      return;
    }
    pending.result = pending2.result;
  }

  const item = pending.result.items[0];
  const handle = String(item.handle ?? item.profile?.handle ?? '').trim();
  const bio = String(item.profile?.biography ?? item.profile?.bio ?? '').slice(0, 80);
  console.log(`\nPerfil teste: @${handle} | bio: "${bio}..."`);

  console.log('\n2) Ollama (local)');
  const ollama = new Ollama({ host: ollamaHost });

  rows.push(await timed('ollama.tags (health)', () => ollama.list()));

  const minimalPrompt = JSON.stringify({
    handle,
    bio: item.profile?.biography ?? item.profile?.bio ?? '',
    task: 'Responda somente JSON: {"profileType":"pessoal","mainCategory":"Teste"}',
  });

  rows.push(await timed(`ollama.chat minimo (${model})`, () =>
    ollama.chat({
      model,
      messages: [
        { role: 'system', content: 'Responda somente JSON valido.' },
        { role: 'user', content: minimalPrompt },
      ],
      stream: false,
      options: { num_predict: 80 },
    })
  ));

  const fullPromptLen = JSON.stringify(item.profile ?? {}).length;
  console.log(`\n  Tamanho payload perfil na fila: ~${fullPromptLen} chars (~${Math.ceil(fullPromptLen / 4)} tok estimados)`);

  rows.push(await timed(`ollama.chat prompt real perfil (${model})`, () =>
    ollama.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Voce responde somente JSON valido. Textos descritivos em portugues do Brasil.',
        },
        {
          role: 'user',
          content: `Classifique este perfil Instagram. Retorne JSON com profileType, mainCategory, gender, subCategories, contentPillars, audienceType, brandSafety, personaSummary.\n${JSON.stringify({
            handle: item.profile?.handle,
            full_name: item.profile?.full_name,
            biography: item.profile?.biography ?? item.profile?.bio,
            followers: item.profile?.followers,
            category: item.profile?.category,
          })}`,
        },
      ],
      stream: false,
    })
  ));

  console.log('\n3) Resumo');
  const apiMs = rows.filter((r) => r.label?.includes?.('coverage') || r.label?.includes?.('fila')).reduce((s, r) => s + (r.ms ?? 0), 0);
  const ollamaRows = rows.filter((r) => r.label?.includes?.('ollama.chat'));
  const ollamaMs = ollamaRows.reduce((s, r) => s + (r.ms ?? 0), 0);

  console.log(`  Startup API (stats + fila): ~${rows[0]?.ms + rows[1]?.ms ?? '?'} ms`);
  console.log(`  Ollama chat minimo: ${rows.find((r) => String(r).includes('minimo'))?.ms ?? ollamaRows[0]?.ms ?? '?'} ms`);
  console.log(`  Ollama chat perfil real: ${ollamaRows[ollamaRows.length - 1]?.ms ?? '?'} ms`);

  const slowOllama = (ollamaRows[ollamaRows.length - 1]?.ms ?? 0) > 60000;
  const slowApi = (rows[0]?.ms ?? 0) + (rows[1]?.ms ?? 0) > 15000;

  console.log('\n4) Diagnostico provavel');
  if (slowApi) {
    console.log('  - API remota LENTA: stats/fila demoram >15s (rede ou servidor buscainfluencer.com.br).');
    console.log('    O qualify loga "pode levar ~1 min" nessa etapa antes de cada lote.');
  }
  if (slowOllama) {
    console.log('  - Ollama LENTO: >60s por chamada. CPU/GPU saturada, modelo 8b pesado, ou Ollama 0.24 com fila.');
  } else if ((ollamaRows[ollamaRows.length - 1]?.ms ?? 0) > 25000) {
    console.log('  - Ollama moderado: 25-60s por perfil e normal para llama3.1:8b em CPU.');
  } else {
    console.log('  - Ollama OK: <25s por chamada neste teste.');
  }
  console.log('  - Reparos de validacao (+1-2 chamadas Ollama) e fetch de legendas na API aumentam tempo por perfil.');
  console.log('  - QUALIFY_CONCURRENCY>1 nao acelera Ollama local (processa em serie).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
