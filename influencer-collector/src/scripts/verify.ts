/**
 * Verificação automática (sem abrir Instagram): build + API HTTP + módulos.
 * Rode: npm run verify
 */

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import assert from 'node:assert/strict';
import type { InstagramClient } from '../instagram.js';
import { loadConfig, mergeCollectorConfig } from '../config.js';
import * as runner from '../runner.js';
import { getProfiles } from '../memoryStorage.js';
import { createCollectorRequestHandler } from '../server.js';
import type { Page } from 'playwright';

const mockClient = {} as InstagramClient;
const mockPage = {
  url: () => 'https://www.instagram.com/',
} as unknown as Page;
const mockPageRef = { page: mockPage };
const noopRebind = (_p: Page): void => {};

async function runHttpSmoke(): Promise<void> {
  const handler = createCollectorRequestHandler(mockClient, mockPageRef, noopRebind);
  const server = createServer((req, res) => {
    void handler(req, res);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address() as AddressInfo;
      resolve(a.port);
    });
    server.on('error', reject);
  });

  const base = `http://127.0.0.1:${port}`;

  try {
    let r = await fetch(`${base}/api/health`);
    assert.equal(r.ok, true);
    const health = (await r.json()) as { ok?: boolean };
    assert.equal(health.ok, true);

    r = await fetch(`${base}/api/defaults`);
    assert.equal(r.ok, true);
    const d = (await r.json()) as Record<string, unknown>;
    assert.ok(Number.isFinite(d.minFollowersToSave as number));
    assert.ok(Number.isFinite(d.maxProfiles as number));
    assert.equal(typeof d.excludeBusinessProfiles, 'boolean');
    assert.equal(typeof d.skipIfAlreadyInRemoteDb, 'boolean');

    r = await fetch(`${base}/api/status`);
    assert.equal(r.ok, true);
    const st = (await r.json()) as { running?: boolean; scheduled?: boolean };
    assert.equal(st.running, false);
    assert.equal(st.scheduled, false);

    r = await fetch(base + '/');
    assert.equal(r.ok, true);
    const html = await r.text();
    assert.ok(html.includes('btnStart'), 'HTML deve conter botão Iniciar');
    assert.ok(html.includes('/api/start'), 'HTML deve chamar /api/start');
    assert.ok(html.includes('startRequestInFlight'), 'lógica anti-corrida do clique');
    assert.ok(html.includes('rowsColetados'), 'três tabelas: coletados');
    assert.ok(html.includes('rowsIntegrados'), 'três tabelas: integrados');
    assert.ok(html.includes('remove-issue'), 'UI deve permitir remover erro persistido');

    r = await fetch(`${base}/api/list`);
    assert.equal(r.ok, true);
    const list = (await r.json()) as {
      influencers?: unknown[];
      coletados?: unknown[];
      problemas?: unknown[];
      integrados?: unknown[];
      processing?: unknown;
      counts?: Record<string, number>;
    };
    assert.ok(Array.isArray(list.influencers));
    assert.ok(Array.isArray(list.coletados));
    assert.ok(Array.isArray(list.problemas));
    assert.ok(Array.isArray(list.integrados));
    assert.ok(list.counts && typeof list.counts.coletados === 'number');
    assert.ok(
      list.processing === null || (typeof list.processing === 'object' && list.processing),
      'processing null ou objeto'
    );
    assert.ok(typeof list.counts!.emProcessamento === 'number');

    r = await fetch(`${base}/api/stop`, { method: 'POST' });
    assert.equal(r.ok, true);

    r = await fetch(`${base}/api/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'naoexiste12345' }),
    });
    assert.equal(r.status, 404);

    r = await fetch(`${base}/api/remove-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);

    r = await fetch(`${base}/api/remove-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000000' }),
    });
    assert.equal(r.status, 404);
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
}

async function main(): Promise<void> {
  runner.clearScheduledStart();
  assert.equal(runner.isRunning(), false);

  const c = loadConfig();
  assert.ok(c.authStatePath.length > 0, 'authStatePath');
  assert.ok(Number.isFinite(c.minFollowersToSave));

  const m = mergeCollectorConfig(c, { minFollowersToSave: 12_345 });
  assert.equal(m.minFollowersToSave, 12_345);

  assert.equal(runner.tryScheduleCollection(), true);
  assert.equal(runner.tryScheduleCollection(), false);
  runner.clearScheduledStart();
  assert.equal(runner.tryScheduleCollection(), true);
  runner.clearScheduledStart();

  assert.ok(Array.isArray(getProfiles()));

  await runHttpSmoke();

  console.log('[verify] Todas as checagens passaram (módulos + API HTTP em porta efêmera).');
  console.log('[verify] Coleta real: rode npm start e teste Iniciar no browser com Instagram logado.');
}

main().catch((e) => {
  console.error('[verify] FALHOU:', e);
  process.exit(1);
});
