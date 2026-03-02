import { Level } from 'level';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Entity } from '../types/index.js';
import { estimatePayloadSize } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig, MediaKind } from '../types/index.js';

const NODE_MAX_BYTES_DEFAULT = 1024 * 1024; // 1MB

/** Prefixo por bucket para keys: "bucket:key" -> valor JSON do response. */
function dbKey(bucket: string, key: string): string {
  return `${bucket}:${key}`;
}

function parseKey(fullKey: string, bucket: string): string | null {
  const prefix = `${bucket}:`;
  if (!fullKey.startsWith(prefix)) return null;
  return fullKey.slice(prefix.length);
}

export interface RocksDBStorageOptions {
  dbPath?: string;
  nodeMaxBytes?: number;
  config?: CrawlConfig;
}

export class RocksDBStorage {
  private readonly dbPath: string;
  private readonly nodeMaxBytes: number;
  private db: Level<string, unknown> | null = null;

  constructor(options: RocksDBStorageOptions = {}) {
    this.dbPath = options.dbPath ?? './data/rocksdb';
    this.nodeMaxBytes = options.nodeMaxBytes ?? options.config?.nodeMaxBytes ?? NODE_MAX_BYTES_DEFAULT;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private async getDb(): Promise<Level<string, unknown>> {
    if (!this.db) {
      this.db = new Level<string, unknown>(this.dbPath, { valueEncoding: 'json' });
      await this.db.open();
    }
    return this.db;
  }

  /** Remove todos os dados. */
  async clearAll(): Promise<void> {
    const db = await this.getDb();
    const stream = db.iterator();
    const keys: string[] = [];
    try {
      for await (const [key] of stream) {
        keys.push(key);
      }
    } finally {
      await stream.close();
    }
    if (keys.length > 0) {
      await db.batch(keys.map((k) => ({ type: 'del' as const, key: k })));
    }
  }

  /**
   * Grava um valor (JSON do response ou qualquer objeto). Key = bucket:key.
   */
  async set(bucket: string, key: string, value: unknown): Promise<void> {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    if (Buffer.byteLength(json, 'utf8') > this.nodeMaxBytes) {
      throw new Error(`Valor excede limite de ${this.nodeMaxBytes} bytes (bucket=${bucket}, key=${key})`);
    }
    const db = await this.getDb();
    const fullKey = dbKey(bucket, key);
    await db.put(fullKey, typeof value === 'string' ? JSON.parse(value) : value);
  }

  /**
   * Lê um valor por bucket e key. Retorna o objeto parseado ou null.
   */
  async get<T = unknown>(bucket: string, key: string): Promise<T | null> {
    const db = await this.getDb();
    try {
      const value = await db.get(dbKey(bucket, key));
      return value as T;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Remove um valor por bucket e key.
   */
  async delete(bucket: string, key: string): Promise<void> {
    const db = await this.getDb();
    const fullKey = dbKey(bucket, key);
    try {
      await db.del(fullKey);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'LEVEL_NOT_FOUND') {
        return;
      }
      throw err;
    }
  }

  /**
   * Remove todas as chaves de um bucket que tenham o keyPrefix dado (ex.: bucket "post", keyPrefix "handle:" remove todos os posts do perfil).
   * Usa iterator por intervalo para não iterar todo o bucket (evita ~26s quando há muitos posts).
   */
  async deleteByKeyPrefix(bucket: string, keyPrefix: string): Promise<number> {
    const db = await this.getDb();
    const fullPrefix = dbKey(bucket, keyPrefix);
    const limitKey = fullPrefix.slice(0, -1) + String.fromCharCode(fullPrefix.charCodeAt(fullPrefix.length - 1) + 1);
    const toDelete: string[] = [];
    const stream = db.iterator({ gte: fullPrefix, lt: limitKey });
    try {
      for await (const [fullKey] of stream) {
        toDelete.push(fullKey);
      }
    } finally {
      await stream.close();
    }
    if (toDelete.length === 0) return 0;
    await db.batch(toDelete.map((k) => ({ type: 'del' as const, key: k })));
    return toDelete.length;
  }

  /**
   * Lista todas as chaves de um bucket.
   */
  async listKeys(bucket: string): Promise<string[]> {
    const db = await this.getDb();
    const prefix = `${bucket}:`;
    const keys: string[] = [];
    const stream = db.iterator({ gte: prefix, lt: prefix + '\xff' });
    try {
      for await (const [fullKey] of stream) {
        const k = parseKey(fullKey, bucket);
        if (k != null) keys.push(k);
      }
    } finally {
      await stream.close();
    }
    return keys.sort();
  }

  /**
   * Retorna todos os itens de um bucket como { key, value }.
   * Se keyPrefix for informado, retorna apenas itens cuja chave (após "bucket:") começa com keyPrefix
   * (ex.: para bucket "post", keyPrefix "jonathas_avis:" retorna só posts desse perfil).
   */
  async getByBucket<T = unknown>(bucket: string, keyPrefix?: string): Promise<{ key: string; value: T }[]> {
    const db = await this.getDb();
    const prefix = keyPrefix != null ? `${bucket}:${keyPrefix}` : `${bucket}:`;
    const limitKey = keyPrefix != null
      ? prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
      : prefix + '\xff';
    const items: { key: string; value: T }[] = [];
    const stream = db.iterator({ gte: prefix, lt: limitKey });
    try {
      for await (const [fullKey, value] of stream) {
        const k = parseKey(fullKey, bucket);
        if (k != null) items.push({ key: k, value: value as T });
      }
    } finally {
      await stream.close();
    }
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  estimatePayloadSize(obj: unknown): number {
    return estimatePayloadSize(obj);
  }

  /**
   * Salva perfil no bucket "profile" (key = entity.handle).
   * Deve receber apenas perfil slim (buildSlimProfile); não persistir JSON completo do response.
   */
  async save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }> {
    const size = estimatePayloadSize(entity);
    if (size > this.nodeMaxBytes) {
      throw new Error(`Payload excede limite (${this.nodeMaxBytes} bytes). Size: ${size}`);
    }
    const key = (entity.handle || '').toLowerCase().replace(/^@/, '');
    await this.set('profile', key, entity);
    return { path: `rocksdb:profile:${key}`, bytes: size };
  }

  /**
   * Lista handles já armazenados (chaves do bucket "profile").
   */
  async listHandles(): Promise<Set<string>> {
    const keys = await this.listKeys('profile');
    return new Set(keys.map((k) => k.toLowerCase()));
  }

  /**
   * Carrega entidade por handle (bucket "profile").
   */
  async loadByHandle(handle: string): Promise<Entity | null> {
    const key = handle.toLowerCase().replace(/^@/, '');
    return this.get<Entity>('profile', key);
  }

  /**
   * Remove o perfil do bucket "profile" (ex.: perfil não encontrado no Instagram).
   */
  async deleteProfileByHandle(profileHandle: string): Promise<void> {
    const key = profileHandle.toLowerCase().replace(/^@/, '');
    await this.delete('profile', key);
  }

  /**
   * Remove todos os posts/reels/tagged/highlights de um perfil (key prefix = handle:).
   * Usado no refresh para manter só os da última extração.
   */
  async deletePostsByHandle(profileHandle: string): Promise<number> {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    return this.deleteByKeyPrefix('post', handle + ':');
  }

  /**
   * Salva itens de mídia no bucket "post" (key = profileHandle:mediaKind:shortcode).
   * Deve receber apenas itens normalizados (buildNormalizedPost); não persistir JSON bruto da API.
   * Inclui content_type no valor para filtro na API.
   */
  async saveMedia(profileHandle: string, mediaKind: MediaKind, items: Entity[], collectedAt: string): Promise<number> {
    if (items.length === 0) return 0;
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    let saved = 0;
    for (const p of items) {
      const po = p as Record<string, unknown>;
      const postBlock = po.post as Record<string, unknown> | undefined;
      const shortcode =
        (postBlock?.shortcode != null ? String(postBlock.shortcode) : null) ??
        (po.shortcode != null ? String(po.shortcode) : null) ??
        (po.post_url != null ? String(po.post_url) : null) ??
        String(saved);
      const key = `${handle}:${mediaKind}:${shortcode}`;
      await this.set('post', key, { ...p, profile_handle: handle, content_type: mediaKind });
      saved++;
    }
    return saved;
  }

  /**
   * Salva posts do feed principal (key = profileHandle:post:shortcode).
   * Mantido para compatibilidade com CrawlStorage.savePosts.
   */
  async savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number> {
    return this.saveMedia(profileHandle, 'post', posts, collectedAt);
  }

  /** Fecha o banco (opcional, para shutdown limpo). */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
