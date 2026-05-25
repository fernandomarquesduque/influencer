/**
 * Storage: perfis e posts só no RocksDB; SQLite para profile_activation e índice de busca (FTS5 + métricas por handle).
 * Contrato: apenas dados slim/normalizados (SlimProfile + NormalizedPost). Não persistir JSON completo do response.
 */

import type { Entity } from '../types/index.js';
import type { MediaKind } from '../types/index.js';
import type { RocksDBStorage } from './rocksdb.js';
import type { ProfileSearchIndexPayload } from '../api/profilesSearch.js';
import type { SqliteSync, ProfileActivationData, GlobalAuxSqlFilter, AuxNumericFacetAggregate } from './sqliteSync.js';
import { deleteInfluencerFromMeilisearch } from '../search/meilisearchProfile.js';

export type ProfileSearchIndexSyncFn = (db: CompositeStorage, handle: string) => void | Promise<void>;

export class CompositeStorage {
  constructor(
    private readonly rocks: RocksDBStorage,
    private readonly sqlite: SqliteSync,
    /** Chamado após save/savePosts com this (storage) para reaquecer cache em background sem zerar (ex.: scheduleSearchCacheRewarm). */
    private readonly onInvalidateSearch?: (db: CompositeStorage) => void,
    /** Atualiza índice FTS + auxiliar de busca (SQLite) para um handle após gravar perfil/posts. */
    private readonly onProfileSearchIndexSync?: ProfileSearchIndexSyncFn
  ) { }

  private applySearchSideEffects(handle: string, opts?: { skipSearchInvalidation?: boolean }): void {
    if (opts?.skipSearchInvalidation) return;
    const h = handle.toLowerCase().replace(/^@/, '').trim();
    if (!h) return;
    void Promise.resolve(this.onProfileSearchIndexSync?.(this, h)).catch((e) =>
      console.warn('[profile-search-index] sync após save:', h, e instanceof Error ? e.message : e)
    );
    this.onInvalidateSearch?.(this);
  }

  /**
   * Após extração/refresh completo: atualiza FTS do handle (uma vez).
   * Rewarm do cache de perfis deve ser agendado em debounce pelo caller (`scheduleSearchCacheRewarmDebounced`).
   */
  async finalizeSearchAfterHandlePersist(handle: string): Promise<void> {
    const h = handle.toLowerCase().replace(/^@/, '').trim();
    if (!h) return;
    if (this.onProfileSearchIndexSync) {
      await Promise.resolve(this.onProfileSearchIndexSync(this, h)).catch((e) =>
        console.warn('[profile-search-index] finalize sync:', h, e instanceof Error ? e.message : e)
      );
    }
  }

  async save(
    entity: Entity & { handle: string },
    opts?: { skipSearchInvalidation?: boolean }
  ): Promise<{ path: string; bytes: number }> {
    const result = await this.rocks.save(entity);
    this.applySearchSideEffects(entity.handle || '', opts);
    return result;
  }

  async deletePostsByHandle(profileHandle: string): Promise<number> {
    return this.rocks.deletePostsByHandle(profileHandle);
  }

  async deletePostKeysExcept(profileHandle: string, keepLogicalKeys: ReadonlySet<string>): Promise<number> {
    return this.rocks.deletePostKeysExcept(profileHandle, keepLogicalKeys);
  }

  /**
   * Remove o perfil do RocksDB + ativação/candidaturas (S3 e demais SQLite: ver removeInfluencerNotFoundOnInstagram).
   */
  async deleteProfileCompletely(profileHandle: string): Promise<void> {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    await this.rocks.deleteProfileByHandle(handle);
    await this.rocks.deletePostsByHandle(handle);
    this.sqlite.deleteActivation(handle);
    this.sqlite.deleteProjectApplicationsByHandle(handle);
    this.deleteProfileSearchIndex(handle);
    this.onInvalidateSearch?.(this);
  }

  async savePosts(
    profileHandle: string,
    posts: Entity[],
    collectedAt: string,
    opts?: { skipSearchInvalidation?: boolean }
  ): Promise<number> {
    const n = await this.rocks.savePosts(profileHandle, posts, collectedAt);
    this.applySearchSideEffects(profileHandle, opts);
    return n;
  }

  async saveMedia(
    profileHandle: string,
    mediaKind: MediaKind,
    items: Entity[],
    collectedAt: string,
    opts?: { skipSearchInvalidation?: boolean }
  ): Promise<number> {
    const n = await this.rocks.saveMedia(profileHandle, mediaKind, items, collectedAt);
    this.applySearchSideEffects(profileHandle, opts);
    return n;
  }

  async listHandles(): Promise<Set<string>> {
    return this.rocks.listHandles();
  }

  async getByBucket<T = unknown>(
    bucket: string,
    keyPrefix?: string,
    opts?: { sort?: boolean }
  ): Promise<{ key: string; value: T }[]> {
    return this.rocks.getByBucket<T>(bucket, keyPrefix, opts);
  }

  async listKeys(bucket: string): Promise<string[]> {
    return this.rocks.listKeys(bucket);
  }

  async countKeysInBucket(bucket: string): Promise<number> {
    return this.rocks.countKeysInBucket(bucket);
  }

  async get<T = unknown>(bucket: string, key: string): Promise<T | null> {
    return this.rocks.get<T>(bucket, key);
  }

  async set(
    bucket: string,
    key: string,
    value: unknown,
    opts?: { skipSearchInvalidation?: boolean }
  ): Promise<void> {
    await this.rocks.set(bucket, key, value);
    if (bucket === 'profile') {
      const handle = String(key ?? '')
        .trim()
        .toLowerCase()
        .replace(/^@/, '');
      if (handle) this.applySearchSideEffects(handle, opts);
    } else if (bucket === 'post' && !opts?.skipSearchInvalidation) {
      const handle = String(key ?? '').split(':')[0]?.trim().toLowerCase().replace(/^@/, '');
      if (handle) this.applySearchSideEffects(handle, opts);
    }
  }

  async loadByHandle(handle: string): Promise<Entity | null> {
    return this.rocks.loadByHandle(handle);
  }

  /** Dados de ativação do perfil (cadastro completo na plataforma), do SQLite. */
  getActivation(profileHandle: string): ProfileActivationData | null {
    return this.sqlite.getActivation(profileHandle);
  }

  /** Várias ativações em uma query (uso em listagem/busca para ganho de performance). */
  getActivationsBatch(handles: string[]): Map<string, ProfileActivationData> {
    return this.sqlite.getActivationsBatch(handles);
  }

  upsertProfileSearchIndexFromPayload(
    handle: string,
    payload: ProfileSearchIndexPayload & { costTier?: string | null }
  ): void {
    this.sqlite.upsertProfileSearchIndex(
      handle,
      payload.ftsText,
      payload.engagementJson,
      payload.hashtagsJson,
      payload.searchBlob,
      {
        followersCount: payload.followersCount ?? 0,
        engagementRate: payload.engagementRate ?? 0,
        avgLikes: payload.avgLikes ?? 0,
        postsCount: payload.postsCount ?? 0,
        accountType: payload.accountType ?? null,
        isPrivate: payload.isPrivate,
        categoriesJson: payload.categoriesJson,
        costTier: payload.costTier ?? null,
        llmQualificationJson: payload.llmQualificationJson,
        llmBrandLevel: payload.llmBrandLevel,
        llmPostSentiment: payload.llmPostSentiment,
      }
    );
  }

  searchProfileHandlesFts(matchExpr: string, limit: number): { handle: string; bm25: number }[] {
    return this.sqlite.searchProfileHandlesFts(matchExpr, limit);
  }

  getAllProfileSearchAuxRows(): {
    handle: string;
    engagement_json: string;
    hashtags_json: string;
    search_blob: string;
    followers_count: number;
    engagement_rate: number;
    avg_likes: number;
    posts_count: number;
    account_type: number | null;
    llm_post_sentiment: string | null;
  }[] {
    return this.sqlite.getAllProfileSearchAuxRows();
  }

  getProfileSearchAuxRowsForHandles(
    handles: string[]
  ): {
    handle: string;
    engagement_json: string;
    hashtags_json: string;
    search_blob: string;
    followers_count: number;
    engagement_rate: number;
    avg_likes: number;
    posts_count: number;
    account_type: number | null;
    llm_post_sentiment: string | null;
  }[] {
    return this.sqlite.getProfileSearchAuxRowsForHandles(handles);
  }

  globalAuxSearchHandles(filter: GlobalAuxSqlFilter): { handles: string[]; total: number } {
    return this.sqlite.globalAuxSearchHandles(filter);
  }

  aggregateAuxNumericFacetsForHandles(handles: string[]): AuxNumericFacetAggregate | null {
    return this.sqlite.aggregateAuxNumericFacetsForHandles(handles);
  }

  countProfileSearchAuxRows(): number {
    return this.sqlite.countProfileSearchAuxRows();
  }

  deleteProfileSearchIndex(handle: string): void {
    this.sqlite.deleteProfileSearchIndex(handle);
    void deleteInfluencerFromMeilisearch(handle).catch((e) =>
      console.warn('[meilisearch] delete:', handle, e instanceof Error ? e.message : e)
    );
  }

  async clearAll(): Promise<void> {
    await this.rocks.clearAll();
    try {
      this.sqlite.clearAll();
    } catch (e) {
      console.warn('[CompositeStorage] SQLite clearAll:', e instanceof Error ? e.message : e);
    }
  }

  async close(): Promise<void> {
    this.sqlite.close();
    if (typeof (this.rocks as { close?: () => Promise<void> }).close === 'function') {
      await (this.rocks as { close: () => Promise<void> }).close();
    }
  }
}
