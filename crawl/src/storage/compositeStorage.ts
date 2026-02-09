/**
 * Storage que grava no RocksDB e também sincroniza para SQLite (tabelas profiles e post).
 * Contrato: apenas dados slim/normalizados (SlimProfile + NormalizedPost). Não persistir JSON completo do response.
 */

import type { Entity } from '../types/index.js';
import type { RocksDBStorage } from './rocksdb.js';
import type { SqliteSync, ProfileActivationData } from './sqliteSync.js';

export class CompositeStorage {
  constructor(
    private readonly rocks: RocksDBStorage,
    private readonly sqlite: SqliteSync,
    /** Chamado após save/savePosts para invalidar cache da busca (ex.: clearSearchCache). */
    private readonly onInvalidateSearch?: () => void
  ) { }

  async save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }> {
    const result = await this.rocks.save(entity);
    try {
      this.sqlite.saveProfile(entity as Record<string, unknown>);
    } catch (e) {
      console.warn('[CompositeStorage] SQLite saveProfile:', e instanceof Error ? e.message : e);
    }
    this.onInvalidateSearch?.();
    return result;
  }

  async savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number> {
    const n = await this.rocks.savePosts(profileHandle, posts, collectedAt);
    try {
      this.sqlite.savePosts(profileHandle, posts, collectedAt);
    } catch (e) {
      console.warn('[CompositeStorage] SQLite savePosts:', e instanceof Error ? e.message : e);
    }
    this.onInvalidateSearch?.();
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
