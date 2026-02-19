/**
 * Storage: perfis e posts só no RocksDB; SQLite só para profile_activation (cadastro do influenciador).
 * Contrato: apenas dados slim/normalizados (SlimProfile + NormalizedPost). Não persistir JSON completo do response.
 */

import type { Entity } from '../types/index.js';
import type { RocksDBStorage } from './rocksdb.js';
import type { SqliteSync, ProfileActivationData } from './sqliteSync.js';

export class CompositeStorage {
  constructor(
    private readonly rocks: RocksDBStorage,
    private readonly sqlite: SqliteSync,
    /** Chamado após save/savePosts com this (storage) para reaquecer cache em background sem zerar (ex.: scheduleSearchCacheRewarm). */
    private readonly onInvalidateSearch?: (db: CompositeStorage) => void
  ) { }

  async save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }> {
    const result = await this.rocks.save(entity);
    this.onInvalidateSearch?.(this);
    return result;
  }

  async deletePostsByHandle(profileHandle: string): Promise<number> {
    return this.rocks.deletePostsByHandle(profileHandle);
  }

  /**
   * Remove o perfil completamente (RocksDB + SQLite). Usado quando o refresh falha com "Perfil não encontrado".
   */
  async deleteProfileCompletely(profileHandle: string): Promise<void> {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    await this.rocks.deleteProfileByHandle(handle);
    await this.rocks.deletePostsByHandle(handle);
    this.sqlite.deleteActivation(handle);
    this.sqlite.deleteProjectApplicationsByHandle(handle);
    this.onInvalidateSearch?.(this);
  }

  async savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number> {
    const n = await this.rocks.savePosts(profileHandle, posts, collectedAt);
    this.onInvalidateSearch?.(this);
    return n;
  }

  async listHandles(): Promise<Set<string>> {
    return this.rocks.listHandles();
  }

  async getByBucket<T = unknown>(bucket: string, keyPrefix?: string): Promise<{ key: string; value: T }[]> {
    return this.rocks.getByBucket<T>(bucket, keyPrefix);
  }

  async listKeys(bucket: string): Promise<string[]> {
    return this.rocks.listKeys(bucket);
  }

  async get<T = unknown>(bucket: string, key: string): Promise<T | null> {
    return this.rocks.get<T>(bucket, key);
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
