import type { Entity, MediaKind } from '../types/index.js';
import type { CompositeStorage } from './compositeStorage.js';
import type { CrawlStorage } from '../crawl/runCrawl.js';

export function postLogicalKey(handle: string, mediaKind: MediaKind, item: Entity, fallbackIndex: number): string {
  const h = handle.toLowerCase().replace(/^@/, '');
  const po = item as Record<string, unknown>;
  const postBlock = po.post as Record<string, unknown> | undefined;
  const shortcode =
    (postBlock?.shortcode != null ? String(postBlock.shortcode) : null) ??
    (po.shortcode != null ? String(po.shortcode) : null) ??
    (po.post_url != null ? String(po.post_url) : null) ??
    String(fallbackIndex);
  return `${h}:${mediaKind}:${shortcode}`;
}

export function buildExpectedPostKeySet(
  handle: string,
  posts: Entity[],
  reels: Entity[],
  tagged: Entity[],
  highlights: Entity[]
): Set<string> {
  const keys = new Set<string>();
  posts.forEach((p, i) => keys.add(postLogicalKey(handle, 'post', p, i)));
  reels.forEach((p, i) => keys.add(postLogicalKey(handle, 'reel', p, i)));
  tagged.forEach((p, i) => keys.add(postLogicalKey(handle, 'tagged', p, i)));
  highlights.forEach((p, i) => keys.add(postLogicalKey(handle, 'highlight', p, i)));
  return keys;
}

/** Grava novos itens antes; remove só chaves que não pertencem à extração atual (sem janela vazia). */
export async function pruneStalePostMediaAfterSave(
  storage: CrawlStorage,
  handle: string,
  keepKeys: ReadonlySet<string>
): Promise<number> {
  const cs = storage as CompositeStorage;
  if (typeof cs.deletePostKeysExcept === 'function') {
    return cs.deletePostKeysExcept(handle, keepKeys);
  }
  if (typeof storage.deletePostsByHandle === 'function') {
    return storage.deletePostsByHandle(handle);
  }
  return 0;
}
