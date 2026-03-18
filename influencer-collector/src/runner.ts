/**
 * Controla a execução da coleta em background — Iniciar/Parar.
 */

import type { Page } from 'playwright';
import type { InstagramClient } from './instagram.js';
import { loadConfig, mergeCollectorConfig } from './config.js';
import { discoverByHashtag, discoverByFeed, discoverByExplore } from './discovery.js';
import type { DiscoveryMode } from './discovery.js';

let collecting = false;
/** true entre “Iniciar” na API e o runCollection de fato começar — evita duplo clique e libera a resposta HTTP antes do Playwright. */
let collectionStartScheduled = false;
let abortRequested = false;
let statusMessage = '';

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
  limit?: number;
  /** Regras escolhidas na UI (sobrescrevem .env para esta execução). */
  minFollowers?: number;
  minPostLikes?: number;
  minPostsWithMinLikes?: number;
  maxPostsPerTag?: number;
  excludeBusinessProfiles?: boolean;
}

export async function runCollection(
  client: InstagramClient,
  page: Page,
  options: StartOptions
): Promise<{ saved: number; processed: number }> {
  if (collecting) {
    return { saved: 0, processed: 0 };
  }
  collecting = true;
  collectionStartScheduled = false;
  abortRequested = false;
  let result = { saved: 0, processed: 0 };
  try {
    const base = loadConfig();
    const config = mergeCollectorConfig(base, {
      minFollowersToSave: options.minFollowers,
      minPostLikesToSave: options.minPostLikes,
      minPostsWithMinLikesToSave: options.minPostsWithMinLikes,
      maxPostsPerTag: options.maxPostsPerTag,
      excludeBusinessProfiles: options.excludeBusinessProfiles,
    });
    const maxProfiles = options.limit ?? base.maxProfiles;

    const discoveryOptions = {
      mode: options.mode,
      tag: options.tag,
      maxProfiles,
      config,
      shouldAbort,
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
        statusMessage = `Hashtag ${i + 1}/${tagList.length}: #${tag} — restam ${remaining} perfil(is)`;
        const r = await discoverByHashtag(client, page, tag, {
          ...discoveryOptions,
          maxProfiles: remaining,
        });
        totalSaved += r.saved;
        totalProcessed += r.processed;
      }
      result = { saved: totalSaved, processed: totalProcessed };
    } else if (options.mode === 'feed') {
      statusMessage = `Feed — limite ${maxProfiles}`;
      result = await discoverByFeed(client, page, discoveryOptions);
    } else {
      statusMessage = `Explore — limite ${maxProfiles}`;
      result = await discoverByExplore(client, page, discoveryOptions);
    }
  } catch (err) {
    console.error('[coleta] Falha:', err);
    statusMessage = `Erro: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    collecting = false;
    collectionStartScheduled = false;
    abortRequested = false;
    if (!statusMessage.startsWith('Erro:')) {
      statusMessage = `Concluído: ${result.saved} salvos, ${result.processed} processados.`;
    }
  }
  return result;
}
