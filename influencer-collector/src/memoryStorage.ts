/**
 * Armazenamento em memória dos perfis coletados — lista visível ao usuário.
 */

import type { Entity } from './entityRules.js';

export interface StoredProfile {
  handle: string;
  profile: Entity & { handle: string };
  collectedAt: string;
}

const profiles = new Map<string, StoredProfile>();

export function addProfile(entity: Entity & { handle: string }): void {
  const handle = String((entity.handle ?? '').trim()).toLowerCase();
  if (!handle) return;
  const collectedAt = String(
    (entity as Record<string, unknown>)._collected_at ?? new Date().toISOString()
  );
  profiles.set(handle, { handle: entity.handle as string, profile: entity, collectedAt });
}

export function listHandles(): Set<string> {
  return new Set(profiles.keys());
}

export function getProfiles(): StoredProfile[] {
  return Array.from(profiles.values());
}

export function clearAll(): void {
  profiles.clear();
}

/** Remove um perfil da lista em memória (ex.: captura incorreta). */
export function removeProfile(handle: string): boolean {
  const key = handle.replace(/^@/, '').trim().toLowerCase();
  if (!key) return false;
  return profiles.delete(key);
}
