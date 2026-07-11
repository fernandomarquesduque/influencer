/**
 * Controla a execução da coleta em background — Iniciar/Parar.
 */

import type { Page } from 'playwright';
import type { InstagramClient } from './instagram.js';
import { loadConfig, mergeCollectorConfig } from './config.js';
import {
  discoverByHashtag,
  discoverByFeed,
  discoverByExplore,
  discoverByGoogle,
  discoverByHandles,
  processGoogleQueue,
} from './discovery.js';
import type { DiscoveryMode } from './discovery.js';
import { coletaLog } from './coletaLog.js';
import { resetHandlesCompletedSession, setListQueueProgress } from './processingStatus.js';
import {
  fetchUnregisteredMentionHandles,
  isUnregisteredMentionsApiReady,
  sleepMs,
} from './unregisteredMentions.js';
let collecting = false;
/** true entre “Iniciar” na API e o runCollection de fato começar — evita duplo clique e libera a resposta HTTP antes do Playwright. */
let collectionStartScheduled = false;
let abortRequested = false;
let statusMessage = '';

/** Estado das linhas de busca Google (para a UI mostrar qual está em execução e as próximas). */
export interface GoogleQueriesState {
  queries: string[];
  currentIndex: number;
  phase: 'discover' | 'process';
}
let googleQueriesState: GoogleQueriesState | null = null;

function clampParallelTabsForRun(requested: number | undefined, fallback: number): number {
  const base = Number.isFinite(requested as number) ? (requested as number) : fallback;
  const raw = Math.floor(base) || 1;
  const envCapRaw = Number.parseInt(process.env.COLLECTOR_MAX_PARALLEL_PROFILE_TABS ?? '', 10);
  const envCap =
    Number.isFinite(envCapRaw) && envCapRaw > 0 ? Math.min(16, Math.max(1, envCapRaw)) : 16;
  return Math.max(1, Math.min(envCap, raw));
}

export function getGoogleQueriesState(): GoogleQueriesState | null {
  return googleQueriesState;
}

export function isRunning(): boolean {
  return collecting;
}

export function isCollectionStartScheduled(): boolean {
  return collectionStartScheduled;
}

/** Retorna false se já há coleta ou um start agendado. */
export function tryScheduleCollection(): boolean {
  if (collecting || collectionStartScheduled) return false;
  collectionStartScheduled = true;
  return true;
}

/** Se a resposta HTTP falhar após trySchedule, libera o botão Iniciar. */
export function clearScheduledStart(): void {
  collectionStartScheduled = false;
}

export function getStatusMessage(): string {
  return statusMessage;
}

export function requestAbort(): void {
  abortRequested = true;
}

function shouldAbort(): boolean {
  return abortRequested;
}

function parseTags(tag?: string, tags?: string[]): string[] {
  if (Array.isArray(tags) && tags.length > 0) {
    return tags
      .map((t) => String(t).replace(/^#/, '').trim())
      .filter((t) => t.length > 0 && !t.includes('node') && !t.includes('.exe'));
  }
  if (tag && String(tag).trim()) {
    return String(tag)
      .split(/[\n,;]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter((t) => t.length > 0 && !t.includes('node') && !t.includes('.exe'));
  }
  return ['microinfluencerbr'];
}

export interface StartOptions {
  mode: DiscoveryMode;
  /** Uma tag ou várias separadas por vírgula/linha (modo hashtag). */
  tag?: string;
  /** Lista explícita de tags (tem prioridade sobre tag). */
  tags?: string[];
  /** Modo google: consulta ou várias (uma por linha); após terminar uma, vai para a próxima. */
  googleQuery?: string;
  /** Modo handles: lista de @arrobas para extrair direto. */
  handles?: string[];
  /** Modo unregistered: amostra de perfis/posts no relatório (padrão 800). Usa COLLECTOR_INGEST_KEY. */
  unregisteredSample?: number;
  /** Modo unregistered: máx. @ retornados por rodada (padrão 500). */
  unregisteredLimit?: number;
  /** Modo unregistered: máx. posts por perfil na estratégia profiles (padrão 15). */
  unregisteredMaxPostsPerProfile?: number;
  /** Modo unregistered: pausa entre rodadas da API (ms, padrão 8000). */
  unregisteredPauseMs?: number;
  /** Modo unregistered: estratégia do relatório (padrão profiles). */
  unregisteredStrategy?: 'profiles' | 'posts';
  /** Modo google: máx. páginas SERP por consulta. */
  maxSerpPages?: number;
  /** Modo google: tipos de SERP a buscar — ex. ['39', '7', ''] para udm=39, udm=7 e busca geral. */
  udmValues?: string[];
  /** Modo google: filtro de tempo do Google (qdr: h/d/w/m/y). */
  googleQdr?: string;
  limit?: number;
  /** Regras escolhidas na UI (sobrescrevem .env para esta execução). */
  minFollowers?: number;
  maxFollowers?: number;
  minPostLikes?: number;
  minPostsWithMinLikes?: number;
  maxPostsPerTag?: number;
  excludeBusinessProfiles?: boolean;
  requireBioBrazilianPortuguese?: boolean;
  skipIfAlreadyInRemoteDb?: boolean;
  /** 1=pessoal, 2=criador, 3=empresa; vazio = aceitar todos. */
  allowedAccountTypes?: number[];
  /** Abas do Instagram em paralelo na extração (Arrobas e fila Google). 1–16. */
  parallelProfileTabs?: number;
}

export async function runCollection(
  client: InstagramClient,
  pageRef: { page: Page },
  rebindPersistence: (newPage: Page) => void,
  options: StartOptions
): Promise<{ saved: number; processed: number }> {
  if (collecting) {
    return { saved: 0, processed: 0 };
  }
  collecting = true;
  collectionStartScheduled = false;
  abortRequested = false;
  setListQueueProgress(null);
  resetHandlesCompletedSession();
  let result = { saved: 0, processed: 0 };
  let page = pageRef.page;
  try {
    const recovered = await client.ensurePageForCollection(page);
    if (recovered !== page) {
      pageRef.page = recovered;
      rebindPersistence(recovered);
      page = recovered;
      coletaLog(
        '[coleta] Janela do Instagram foi recriada (browser/aba tinha fechado). Nova aba aberta — faça login se aparecer.'
      );
    }
    const base = loadConfig();
    const config = mergeCollectorConfig(base, {
      minFollowersToSave: options.minFollowers,
      maxFollowersToSave: options.maxFollowers,
      minPostLikesToSave: options.minPostLikes,
      minPostsWithMinLikesToSave: options.minPostsWithMinLikes,
      maxPostsPerTag: options.maxPostsPerTag,
      excludeBusinessProfiles: options.excludeBusinessProfiles,
      requireBioBrazilianPortuguese: options.requireBioBrazilianPortuguese,
      skipIfAlreadyInRemoteDb: options.skipIfAlreadyInRemoteDb,
      allowedAccountTypes: options.allowedAccountTypes,
    });
    const maxProfiles = options.limit ?? base.maxProfiles;
    coletaLog(
      `INÍCIO modo=${options.mode} limite_salvar=${maxProfiles} minSeguidores=${config.minFollowersToSave} minCurtidasPost=${config.minPostLikesToSave}`
    );

    const sessionTriedHandles = new Set<string>();
    const parallelProfileTabs = clampParallelTabsForRun(
      options.parallelProfileTabs,
      base.parallelProfileTabs
    );
    const discoveryOptions = {
      mode: options.mode,
      tag: options.tag,
      handles: options.handles,
      googleQuery: options.googleQuery,
      maxSerpPages: options.maxSerpPages,
      udmValues: options.udmValues,
      googleQdr: options.googleQdr,
      googleSessionPath: base.googleSessionPath,
      maxProfiles,
      config,
      shouldAbort,
      sessionTriedHandles,
      parallelProfileTabs,
      onCollected(handle: string, followers: number) {
        statusMessage = `@${handle} (${followers.toLocaleString('pt-BR')} seguidores)`;
        console.log(`[coleta] ${statusMessage}`);
      },
    };

    if (options.mode === 'hashtag') {
      const tagList = parseTags(options.tag, options.tags);
      let totalSaved = 0;
      let totalProcessed = 0;
      for (let i = 0; i < tagList.length; i++) {
        if (shouldAbort()) break;
        const remaining = maxProfiles - totalSaved;
        if (remaining <= 0) break;
        const tag = tagList[i]!;
        setListQueueProgress({ kind: 'hashtag', index: i + 1, total: tagList.length });
        coletaLog(`Hashtag ${i + 1}/${tagList.length}: #${tag} — faltam salvar até ${remaining} perfil(is)`);
        statusMessage = `Hashtag ${i + 1}/${tagList.length}: #${tag} — restam ${remaining} perfil(is)`;
        const r = await discoverByHashtag(client, pageRef.page, tag, {
          ...discoveryOptions,
          maxProfiles: remaining,
        });
        totalSaved += r.saved;
        totalProcessed += r.processed;
        coletaLog(`#${tag} → +${r.saved} salvos (rodada) | total acumulado: ${totalSaved} salvos, ${totalProcessed} processados`);
      }
      result = { saved: totalSaved, processed: totalProcessed };
    } else if (options.mode === 'feed') {
      coletaLog(`Modo FEED — limite ${maxProfiles}`);
      statusMessage = `Feed — limite ${maxProfiles}`;
      result = await discoverByFeed(client, pageRef.page, discoveryOptions);
    } else if (options.mode === 'google') {
      const queryRaw = (options.googleQuery ?? '').trim();
      const queryList = queryRaw
        ? queryRaw.split(/\r?\n/).map((q) => q.trim()).filter(Boolean)
        : [];
      const queries = queryList.length > 0 ? queryList : (queryRaw ? [queryRaw] : []);
      if (queries.length === 0) {
        coletaLog('Modo Google: defina ao menos uma consulta (uma por linha para múltiplas).');
        result = { saved: 0, processed: 0 };
      } else {
        let totalSaved = 0;
        let totalProcessed = 0;
        googleQueriesState = { queries, currentIndex: 0, phase: 'discover' };
        try {
          for (let i = 0; i < queries.length; i++) {
            if (shouldAbort()) break;
            const remaining = maxProfiles - totalSaved;
            if (remaining <= 0) break;
            const q = queries[i]!;
            setListQueueProgress({ kind: 'google_queries', index: i + 1, total: queries.length });
            googleQueriesState.currentIndex = i;
            googleQueriesState.phase = 'discover';
            coletaLog(`Google ${i + 1}/${queries.length}: "${q.slice(0, 60)}${q.length > 60 ? '…' : ''}" — restam ${remaining} perfil(is) a salvar.`);
            statusMessage = `Google ${i + 1}/${queries.length} — preenchendo fila…`;
            await discoverByGoogle(client, pageRef.page, { ...discoveryOptions, googleQuery: q, maxProfiles: remaining });
            googleQueriesState.phase = 'process';
            statusMessage =
              parallelProfileTabs <= 1
                ? `Google ${i + 1}/${queries.length} — processando fila (1 perfil por vez)…`
                : `Google ${i + 1}/${queries.length} — processando fila (${parallelProfileTabs} perfis em paralelo)…`;
            const r = await processGoogleQueue(client, pageRef.page, { ...discoveryOptions, googleQuery: q, maxProfiles: remaining });
            totalSaved += r.saved;
            totalProcessed += r.processed;
            coletaLog(`Google consulta ${i + 1} → +${r.saved} salvos | total acumulado: ${totalSaved} salvos, ${totalProcessed} processados.`);
          }
        } finally {
          googleQueriesState = null;
        }
        result = { saved: totalSaved, processed: totalProcessed };
      }
    } else if (options.mode === 'handles') {
      const handlesRaw = Array.isArray(options.handles) ? options.handles : [];
      if (handlesRaw.length === 0) {
        coletaLog('Modo Arrobas: defina ao menos um @ (uma por linha).');
        result = { saved: 0, processed: 0 };
      } else {
        coletaLog(
          `Modo ARROBAS — ${handlesRaw.length} perfil(is) na lista | limite ${maxProfiles} | ${parallelProfileTabs} aba(s) paralela(s)`
        );
        statusMessage = `Arrobas — ${handlesRaw.length} perfil(is) · ${parallelProfileTabs} aba(s) paralela(s)`;
        result = await discoverByHandles(client, pageRef.page, discoveryOptions);
      }
    } else if (options.mode === 'unregistered') {
      if (!isUnregisteredMentionsApiReady()) {
        coletaLog(
          'Modo Menções sem cadastro: defina COLLECTOR_API_BASE e COLLECTOR_INGEST_KEY no .env (mesma chave do ingest).'
        );
        statusMessage =
          'Erro: COLLECTOR_API_BASE / COLLECTOR_INGEST_KEY ausentes para consultar collector-unregistered-mentions.';
        result = { saved: 0, processed: 0 };
      } else {
        const sample = Math.max(1, Math.min(3_000, Math.floor(options.unregisteredSample ?? 800) || 800));
        const batchLimit = Math.max(
          1,
          Math.min(2_000, Math.floor(options.unregisteredLimit ?? 500) || 500)
        );
        const maxPostsPerProfile = Math.max(
          1,
          Math.min(40, Math.floor(options.unregisteredMaxPostsPerProfile ?? 15) || 15)
        );
        const pauseMs = Math.max(
          0,
          Math.min(300_000, Math.floor(options.unregisteredPauseMs ?? 8_000) || 8_000)
        );
        const strategy = options.unregisteredStrategy === 'posts' ? 'posts' : 'profiles';
        const seenThisRun = new Set<string>();
        let totalSaved = 0;
        let totalProcessed = 0;
        let round = 0;
        let emptyStreak = 0;
        const maxEmptyStreak = 5;
        coletaLog(
          `Modo MENÇÕES SEM CADASTRO (loop) — sample=${sample} limit/rodada=${batchLimit} ` +
            `strategy=${strategy} pausa=${pauseMs}ms | limite salvar=${maxProfiles} | ${parallelProfileTabs} aba(s)`
        );
        statusMessage = `Menções sem cadastro — consultando API…`;

        while (!shouldAbort() && totalSaved < maxProfiles) {
          round += 1;
          statusMessage = `Menções sem cadastro — rodada ${round}: consultando API…`;
          let batch: string[] = [];
          try {
            const report = await fetchUnregisteredMentionHandles({
              strategy,
              sample,
              limit: batchLimit,
              maxPostsPerProfile,
            });
            batch = report.handles.filter((h) => {
              if (seenThisRun.has(h)) return false;
              if (sessionTriedHandles.has(h)) return false;
              return true;
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            coletaLog(`Menções sem cadastro rodada ${round}: falha na API — ${msg}`);
            statusMessage = `Erro: ${msg}`;
            break;
          }

          if (batch.length === 0) {
            emptyStreak += 1;
            coletaLog(
              `Menções sem cadastro rodada ${round}: nenhum @ novo (streak vazio ${emptyStreak}/${maxEmptyStreak}).`
            );
            if (emptyStreak >= maxEmptyStreak) {
              coletaLog(
                'Menções sem cadastro: várias rodadas sem @ novos — encerrando loop (Parar e reiniciar depois se quiser).'
              );
              break;
            }
            statusMessage = `Menções sem cadastro — sem @ novos; pausa antes da próxima consulta…`;
            await sleepMs(pauseMs, shouldAbort);
            continue;
          }

          emptyStreak = 0;
          for (const h of batch) seenThisRun.add(h);
          const remaining = maxProfiles - totalSaved;
          setListQueueProgress({ kind: 'handles', index: 0, total: batch.length });
          coletaLog(
            `Menções sem cadastro rodada ${round}: ${batch.length} @ novos — extraindo (restam salvar até ${remaining}).`
          );
          statusMessage = `Menções sem cadastro — rodada ${round}: ${batch.length} @ · ${parallelProfileTabs} aba(s)`;
          const r = await discoverByHandles(client, pageRef.page, {
            ...discoveryOptions,
            mode: 'handles',
            handles: batch,
            maxProfiles: remaining,
          });
          totalSaved += r.saved;
          totalProcessed += r.processed;
          coletaLog(
            `Menções sem cadastro rodada ${round} → +${r.saved} salvos | acumulado ${totalSaved} salvos, ${totalProcessed} processados.`
          );
          if (shouldAbort() || totalSaved >= maxProfiles) break;
          statusMessage = `Menções sem cadastro — pausa ${Math.round(pauseMs / 1000)}s antes da próxima rodada…`;
          await sleepMs(pauseMs, shouldAbort);
        }

        result = { saved: totalSaved, processed: totalProcessed };
      }
    } else {
      coletaLog(`Modo EXPLORE — limite ${maxProfiles}`);
      statusMessage = `Explore — limite ${maxProfiles}`;
      result = await discoverByExplore(client, pageRef.page, discoveryOptions);
    }
  } catch (err) {
    console.error('[coleta] Falha:', err);
    coletaLog(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
    statusMessage = `Erro: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    const userParou = abortRequested;
    collecting = false;
    collectionStartScheduled = false;
    abortRequested = false;
    if (!statusMessage.startsWith('Erro:')) {
      statusMessage = `Concluído: ${result.saved} salvos, ${result.processed} processados.`;
    }
    setListQueueProgress(null);
    if (userParou) {
      coletaLog(`INTERROMPIDO pelo usuário (Parar) → ${result.saved} salvos, ${result.processed} processados`);
    } else if (!statusMessage.startsWith('Erro:')) {
      coletaLog(`FIM → ${result.saved} salvos, ${result.processed} processados (veja também UI)`);
    }
  }
  return result;
}
