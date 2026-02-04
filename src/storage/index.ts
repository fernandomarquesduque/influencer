import type { Entity } from '../types/index.js';
import { estimatePayloadSize } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig } from '../types/index.js';
import { writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { RocksDBStorage } from './rocksdb.js';

const NODE_MAX_BYTES_DEFAULT = 1024 * 1024; // 1MB

export type StorageBackend = 'rocksdb' | 'json';

export interface StorageAdapterOptions {
  basePath?: string;
  nodeMaxBytes?: number;
  config?: CrawlConfig;
}

/**
 * Adapter de armazenamento: 1 perfil = 1 node (documento) ≤ 1MB.
 * Valida tamanho antes de salvar; trunca se exceder (nunca falha silenciosamente).
 */
export class StorageAdapter {
  private readonly basePath: string;
  private readonly nodeMaxBytes: number;
  private readonly config: CrawlConfig | undefined;

  constructor(options: StorageAdapterOptions = {}) {
    this.basePath = options.basePath ?? './data/profiles';
    this.nodeMaxBytes = options.nodeMaxBytes ?? options.config?.nodeMaxBytes ?? NODE_MAX_BYTES_DEFAULT;
    this.config = options.config;
  }

  /**
   * Estima tamanho do payload (útil antes de salvar).
   */
  estimatePayloadSize(obj: unknown): number {
    return estimatePayloadSize(obj);
  }

  /**
   * Salva uma entidade dinâmica como arquivo JSON (sem normalização).
   */
  async save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }> {
    const size = estimatePayloadSize(entity);
    if (size > this.nodeMaxBytes) {
      throw new Error(`Payload excede limite (${this.nodeMaxBytes} bytes). Size: ${size}`);
    }
    await mkdir(this.basePath, { recursive: true });
    const filename = `instagram_${sanitizeHandle(entity.handle)}_${Date.now()}.json`;
    const path = join(this.basePath, filename);
    await writeFile(path, JSON.stringify(entity, null, 0), 'utf-8');
    return { path, bytes: size };
  }

  /**
   * Lista handles já armazenados (para deduplicação).
   */
  async listHandles(): Promise<Set<string>> {
    const handles = new Set<string>();
    if (!existsSync(this.basePath)) return handles;
    const files = await readdir(this.basePath).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const match = f.match(/instagram_(.+)_\d+\.json/);
      if (match) handles.add(match[1].toLowerCase());
    }
    return handles;
  }

  /**
   * Carrega um node por handle (último arquivo encontrado para esse handle).
   */
  async loadByHandle(handle: string): Promise<Entity | null> {
    if (!existsSync(this.basePath)) return null;
    const files = await readdir(this.basePath).catch(() => []);
    const prefix = `instagram_${sanitizeHandle(handle)}_`;
    const matching = files.filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse();
    if (matching.length === 0) return null;
    const content = await readFile(join(this.basePath, matching[0]), 'utf-8');
    return JSON.parse(content) as Entity;
  }
}

function sanitizeHandle(handle: string): string {
  return handle.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '_').toLowerCase();
}

export interface CreateStorageOptions {
  basePath?: string;
  dbPath?: string;
  nodeMaxBytes?: number;
  config?: CrawlConfig;
  backend?: StorageBackend;
}

/**
 * Cria o adapter de armazenamento. Por padrão usa RocksDB (level) para salvar JSON do response.
 * Use STORAGE_BACKEND=json no .env para salvar em arquivos JSON.
 */
export function createStorage(options: CreateStorageOptions = {}): StorageAdapter | RocksDBStorage {
  const backend = (options.backend ?? process.env.STORAGE_BACKEND ?? 'rocksdb') as StorageBackend;
  if (backend === 'json') {
    return new StorageAdapter({
      basePath: options.basePath,
      nodeMaxBytes: options.nodeMaxBytes,
      config: options.config,
    });
  }
  return new RocksDBStorage({
    dbPath: options.dbPath ?? process.env.STORAGE_DB_PATH ?? './data/rocksdb',
    nodeMaxBytes: options.nodeMaxBytes,
    config: options.config,
  });
}
