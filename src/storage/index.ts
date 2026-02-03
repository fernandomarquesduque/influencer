import type { ExtractedProfile } from '../types/index.js';
import { estimatePayloadSize, ensureWithinLimit } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig } from '../types/index.js';
import { writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const NODE_MAX_BYTES_DEFAULT = 1024 * 1024; // 1MB

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
   * Garante que o perfil está dentro do limite e retorna o objeto (possivelmente truncado).
   */
  prepareForSave(profile: ExtractedProfile): ExtractedProfile {
    const bioMax = this.config?.bioMaxChars ?? 500;
    const rawMax = this.config?.addressRawTextMaxChars ?? 300;
    return ensureWithinLimit(profile, this.nodeMaxBytes, bioMax, rawMax) as ExtractedProfile;
  }

  /**
   * Salva um perfil como um node (arquivo JSON). Valida tamanho; se exceder, trunca e salva.
   */
  async save(profile: ExtractedProfile): Promise<{ path: string; bytes: number }> {
    const prepared = this.prepareForSave(profile);
    const size = estimatePayloadSize(prepared);
    if (size > this.nodeMaxBytes) {
      throw new Error(
        `Payload ainda excede limite de node (${this.nodeMaxBytes} bytes) após truncar. Size: ${size}`
      );
    }
    await mkdir(this.basePath, { recursive: true });
    const filename = `instagram_${sanitizeHandle(prepared.handle)}_${Date.now()}.json`;
    const path = join(this.basePath, filename);
    await writeFile(path, JSON.stringify(prepared, null, 0), 'utf-8');
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
  async loadByHandle(handle: string): Promise<ExtractedProfile | null> {
    if (!existsSync(this.basePath)) return null;
    const files = await readdir(this.basePath).catch(() => []);
    const prefix = `instagram_${sanitizeHandle(handle)}_`;
    const matching = files.filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse();
    if (matching.length === 0) return null;
    const content = await readFile(join(this.basePath, matching[0]), 'utf-8');
    return JSON.parse(content) as ExtractedProfile;
  }
}

function sanitizeHandle(handle: string): string {
  return handle.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '_').toLowerCase();
}
