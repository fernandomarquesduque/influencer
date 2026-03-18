import type { Request, Response } from 'express';
import { warmSearchCache } from '../profilesSearch.js';
import type { CompositeStorage } from '../../storage/compositeStorage.js';
import type { Entity } from '../../types/index.js';
import { buildNormalizedPost } from '../../utils/slimPost.js';

export interface CollectorIngestResponse {
  ok: true;
  handle: string;
  /** true se já existia perfil no RocksDB (merge aplicado) */
  updated: boolean;
}

export interface CollectorIngestFullResponse extends CollectorIngestResponse {
  savedPosts: number;
  savedReels: number;
  savedTagged: number;
}

function normalizeRawMediaNodes(nodes: unknown[], collectedAt: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const item of nodes) {
    if (item == null || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const code = node.shortcode ?? node.code;
    if (code == null) continue;
    const sc = String(code);
    if (seen.has(sc)) continue;
    seen.add(sc);
    try {
      out.push(buildNormalizedPost(node, collectedAt) as Entity);
    } catch (e) {
      console.warn('[collector-ingest-full] node ignorado', sc, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Controller: ingest do influencer-collector → RocksDB (`ingestProfile` slim · `ingestProfileFull` + mídias).
 */
export function createCollectorController(storage: CompositeStorage) {
  return {
    /**
     * POST body: objeto JSON do perfil (campos slim + handle obrigatório).
     * Faz merge com registro existente no bucket profile.
     */
    async ingestProfile(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body deve ser um objeto JSON com os campos do perfil (incluindo handle).',
            code: 'COLLECTOR_INGEST_INVALID_BODY',
          });
          return;
        }

        const handle = String(body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'Campo handle é obrigatório.',
            code: 'COLLECTOR_INGEST_MISSING_HANDLE',
          });
          return;
        }

        const existing = await storage.loadByHandle(handle);
        const merged =
          existing != null && typeof existing === 'object' && !Array.isArray(existing)
            ? { ...(existing as Record<string, unknown>), ...body, handle }
            : { ...body, handle };

        await storage.save(merged as Entity & { handle: string }, { skipSearchInvalidation: true });

        await warmSearchCache(storage);

        const payload: CollectorIngestResponse = {
          ok: true,
          handle,
          updated: existing != null,
        };
        res.status(200).json(payload);
      } catch (e) {
        console.error('[collectorController.ingestProfile]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_INGEST_ERROR',
        });
      }
    },

    /**
     * Perfil + nós brutos GraphQL (feed, reels, marcados) → normaliza com buildNormalizedPost e grava no RocksDB.
     * Substitui posts/reels/tagged anteriores desse handle.
     */
    async ingestProfileFull(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body inválido. Envie { profile, feedMedia?, reelMedia?, taggedMedia? }.',
            code: 'COLLECTOR_INGEST_FULL_INVALID',
          });
          return;
        }

        const profileObj = body.profile as Record<string, unknown> | undefined;
        const flatProfile =
          profileObj != null && typeof profileObj === 'object'
            ? profileObj
            : (body as Record<string, unknown>);

        const handle = String(flatProfile.handle ?? body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'profile.handle (ou handle) é obrigatório.',
            code: 'COLLECTOR_INGEST_MISSING_HANDLE',
          });
          return;
        }

        const collectedAt = String(
          flatProfile._collected_at ?? body._collected_at ?? new Date().toISOString()
        );

        const feedRaw = asArray(body.feedMedia ?? body.feed_media);
        const reelRaw = asArray(body.reelMedia ?? body.reel_media);
        const taggedRaw = asArray(body.taggedMedia ?? body.tagged_media);

        const posts = normalizeRawMediaNodes(feedRaw, collectedAt);
        const reels = normalizeRawMediaNodes(reelRaw, collectedAt);
        const tagged = normalizeRawMediaNodes(taggedRaw, collectedAt);

        const existing = await storage.loadByHandle(handle);
        const slimMerge =
          existing != null && typeof existing === 'object' && !Array.isArray(existing)
            ? { ...(existing as Record<string, unknown>), ...flatProfile, handle }
            : { ...flatProfile, handle };

        await storage.deletePostsByHandle(handle);
        const skip = { skipSearchInvalidation: true } as const;
        await storage.save(slimMerge as Entity & { handle: string }, skip);

        let savedPosts = 0;
        let savedReels = 0;
        let savedTagged = 0;
        if (posts.length > 0) {
          savedPosts = await storage.saveMedia(handle, 'post', posts, collectedAt, skip);
        }
        if (reels.length > 0) {
          savedReels = await storage.saveMedia(handle, 'reel', reels, collectedAt, skip);
        }
        if (tagged.length > 0) {
          savedTagged = await storage.saveMedia(handle, 'tagged', tagged, collectedAt, skip);
        }

        await warmSearchCache(storage);

        const payload: CollectorIngestFullResponse = {
          ok: true,
          handle,
          updated: existing != null,
          savedPosts,
          savedReels,
          savedTagged,
        };
        res.status(200).json(payload);
      } catch (e) {
        console.error('[collectorController.ingestProfileFull]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_INGEST_FULL_ERROR',
        });
      }
    },

    /**
     * Confirma se o perfil existe no RocksDB (e contagens de mídia) — para o collector validar após ingest.
     */
    async verifyProfile(req: Request, res: Response): Promise<void> {
      try {
        const fromQuery = String(req.query.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        const body = req.body as { handle?: string } | null | undefined;
        const fromBody =
          body != null && typeof body === 'object' && !Array.isArray(body)
            ? String(body.handle ?? '')
                .trim()
                .toLowerCase()
                .replace(/^@/, '')
            : '';
        const handle = fromQuery || fromBody;
        if (!handle) {
          res.status(400).json({
            error: 'Informe o handle: GET ?handle=usuario ou POST JSON { "handle": "usuario" }.',
            code: 'COLLECTOR_VERIFY_MISSING_HANDLE',
          });
          return;
        }

        const profile = await storage.loadByHandle(handle);
        if (!profile) {
          res.status(200).json({
            ok: true,
            found: false,
            handle,
            message: 'Perfil não encontrado no RocksDB.',
          });
          return;
        }

        const p = profile as Record<string, unknown>;
        const rows = await storage.getByBucket<Record<string, unknown>>('post', `${handle}:`);
        let post = 0;
        let reel = 0;
        let tagged = 0;
        for (const { key } of rows) {
          const kind = key.split(':')[1];
          if (kind === 'post') post += 1;
          else if (kind === 'reel') reel += 1;
          else if (kind === 'tagged') tagged += 1;
        }

        res.status(200).json({
          ok: true,
          found: true,
          handle,
          full_name: p.full_name ?? null,
          followers_count: typeof p.followers_count === 'number' ? p.followers_count : null,
          _collected_at: p._collected_at != null ? String(p._collected_at) : null,
          mediaCounts: { post, reel, tagged },
          message: 'Perfil presente no RocksDB.',
        });
      } catch (e) {
        console.error('[collectorController.verifyProfile]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_VERIFY_ERROR',
        });
      }
    },
  };
}

export type CollectorController = ReturnType<typeof createCollectorController>;
