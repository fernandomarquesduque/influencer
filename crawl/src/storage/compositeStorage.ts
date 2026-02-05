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
    private readonly sqlite: SqliteSync
  ) { }

  async save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }> {
    const result = await this.rocks.save(entity);
    try {
      this.sqlite.saveProfile(entity as Record<string, unknown>);
    } catch (e) {
      console.warn('[CompositeStorage] SQLite saveProfile:', e instanceof Error ? e.message : e);
    }
    return result;
  }

  async savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number> {
    const n = await this.rocks.savePosts(profileHandle, posts, collectedAt);
    try {
      this.sqlite.savePosts(profileHandle, posts, collectedAt);
    } catch (e) {
      console.warn('[CompositeStorage] SQLite savePosts:', e instanceof Error ? e.message : e);
    }
    return n;
  }

  async listHandles(): Promise<Set<string>> {
    return this.rocks.listHandles();
  }

  async getByBucket<T = unknown>(bucket: string): Promise<{ key: string; value: T }[]> {
    return this.rocks.getByBucket<T>(bucket);
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
