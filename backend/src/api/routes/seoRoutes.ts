import { Router, type Request, type Response, type NextFunction } from 'express';
import type { CompositeStorage } from '../../storage/compositeStorage.js';
import type { ProfileRefDb } from '../../storage/profileRefDb.js';
import { getLlmQualification, getProfileSummary } from '../profilesSearch.js';
import { listAllProfileHandlesCached, SEO_SITEMAP_CHUNK_SIZE } from '../seo/handlesCache.js';
import { listAllSeoPostsCached } from '../seo/postsCache.js';
import {
  getPublicSiteOrigin,
  seoDirectoryAbsoluteUrl,
  seoInfluencerAbsoluteUrl,
  seoInfluencerPath,
  seoPostAbsoluteUrl,
  seoPostPath,
} from '../seo/publicSiteUrl.js';
import {
  pickTopSeoPosts,
  renderInfluencerSeoHtml,
  renderInfluencersDirectoryHtml,
} from '../seo/renderInfluencerHtml.js';
import {
  buildSeoPostPageData,
  findSeoPostItem,
  renderPostSeoHtml,
} from '../seo/renderPostHtml.js';
import { redactContactInfoInText } from '../../utils/redactContactInfo.js';
import { stripControlChars } from '../seo/htmlEscape.js';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void fn(req, res).catch(next);
  };
}

function normalizeHandleParam(raw: string | undefined): string {
  return String(raw ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

function normalizeShortcodeParam(raw: string | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const DIRECTORY_PAGE_SIZE = 200;

export type SeoRouterDeps = {
  db: CompositeStorage;
  profileRefDb: ProfileRefDb;
};

async function loadProfileForSeo(
  db: CompositeStorage,
  handle: string
): Promise<{ profile: Record<string, unknown>; engagement: unknown } | null> {
  const summary = await getProfileSummary(db, handle);
  if (summary == null) return null;
  const profile = { ...(summary.profile as Record<string, unknown>) };

  if (!getLlmQualification(profile)) {
    try {
      const aux = db.getProfileSearchAuxRowsForHandles([handle])[0] as
        | { llm_qualification_json?: string | null; categories_json?: string | null }
        | undefined;
      const rawQual = aux?.llm_qualification_json?.trim();
      if (rawQual) {
        const parsed = JSON.parse(rawQual) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          profile.llm = { status: 'done', qualification: parsed };
        }
      }
    } catch {
      /* ignore aux parse */
    }
  }

  return { profile, engagement: summary.engagement };
}

/**
 * Rotas SEO públicas (HTML + sitemaps).
 * Montar em: app.use('/api/seo', createSeoRouter(...))
 *
 * IIS deve fazer proxy de /p/:handle, /p/:handle/:shortcode, /influenciadores e sitemaps dinâmicos para cá.
 */
export function createSeoRouter(deps: SeoRouterDeps): Router {
  const { db, profileRefDb } = deps;
  const router = Router();

  /** Página pública do post — registrar antes de /p/:handle. */
  router.get(
    '/p/:handle/:shortcode',
    asyncHandler(async (req, res) => {
      const handle = normalizeHandleParam(req.params.handle);
      const shortcode = normalizeShortcodeParam(req.params.shortcode);
      if (!handle || !shortcode || handle.includes('/') || handle.includes('..')) {
        res
          .status(404)
          .type('html')
          .send('<!doctype html><title>Não encontrado</title><h1>Publicação não encontrada</h1>');
        return;
      }

      const loaded = await loadProfileForSeo(db, handle);
      if (!loaded) {
        res
          .status(404)
          .type('html')
          .send('<!doctype html><title>Não encontrado</title><h1>Publicação não encontrada</h1>');
        return;
      }

      const postsRaw = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
      const found = findSeoPostItem(postsRaw, shortcode);
      if (!found) {
        res
          .status(404)
          .type('html')
          .send('<!doctype html><title>Não encontrado</title><h1>Publicação não encontrada</h1>');
        return;
      }

      const profileRef = profileRefDb.getOrCreateRef(handle);
      const pageData = buildSeoPostPageData({
        handle,
        profile: loaded.profile,
        profileRef,
        postKey: found.key,
        postValue: found.value,
        contentType: found.contentType,
        shortcode: found.shortcode,
      });
      const html = renderPostSeoHtml(pageData, { profileRef });
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.status(200).type('html').send(html);
    })
  );

  router.get(
    '/p/:handle',
    asyncHandler(async (req, res) => {
      const handle = normalizeHandleParam(req.params.handle);
      if (!handle || handle.includes('/') || handle.includes('..')) {
        res
          .status(404)
          .type('html')
          .send('<!doctype html><title>Não encontrado</title><h1>Perfil não encontrado</h1>');
        return;
      }
      const loaded = await loadProfileForSeo(db, handle);
      if (loaded == null) {
        res
          .status(404)
          .type('html')
          .send('<!doctype html><title>Não encontrado</title><h1>Perfil não encontrado</h1>');
        return;
      }
      const { profile } = loaded;
      const profileRef = profileRefDb.getOrCreateRef(handle);

      let aboutText = '';
      const q =
        getLlmQualification(profile) ??
        (() => {
          const llm = profile.llm;
          if (llm && typeof llm === 'object' && !Array.isArray(llm)) {
            const qual = (llm as { qualification?: unknown }).qualification;
            if (qual && typeof qual === 'object' && !Array.isArray(qual))
              return qual as Record<string, unknown>;
          }
          return null;
        })();
      if (q) {
        aboutText = String(q.personaSummary ?? q.personaDescription ?? q.description ?? '').trim();
      }
      if (!aboutText) {
        const bio =
          (typeof profile.biography === 'string' && profile.biography.trim()) ||
          (typeof (profile.data as { user?: { biography?: string } } | undefined)?.user?.biography ===
          'string'
            ? String((profile.data as { user: { biography: string } }).user.biography).trim()
            : '') ||
          (typeof profile.bio === 'string' ? profile.bio.trim() : '');
        if (bio) aboutText = redactContactInfoInText(bio);
      }
      if (!aboutText) {
        try {
          const act = db.getActivation(handle) as { description?: string | null } | null;
          const actDesc = typeof act?.description === 'string' ? act.description.trim() : '';
          const wordCount = actDesc.split(/\s+/).filter(Boolean).length;
          if (actDesc.length >= 20 && wordCount >= 3) {
            aboutText = redactContactInfoInText(actDesc);
          }
        } catch {
          /* ignore */
        }
      }
      aboutText = stripControlChars(aboutText);

      const categoryLabels: string[] = [];
      const cats = profile.categories;
      if (Array.isArray(cats)) {
        for (const c of cats) {
          if (typeof c === 'string' && c.trim()) categoryLabels.push(c.trim());
        }
      }

      const postsRaw = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
      const topPosts = pickTopSeoPosts(postsRaw, {
        profileRef,
        siteOrigin: getPublicSiteOrigin(),
        limit: 3,
      });

      const html = renderInfluencerSeoHtml(
        {
          handle,
          profile,
          engagement: loaded.engagement as {
            engagement_rate?: number;
            posts_count?: number;
            avg_likes?: number;
            total_likes?: number;
          } | null,
          aboutText: aboutText || undefined,
          categoryLabels,
          topPosts,
        },
        { profileRef }
      );
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.status(200).type('html').send(html);
    })
  );

  router.get(
    '/influenciadores',
    asyncHandler(async (req, res) => {
      const handles = await listAllProfileHandlesCached(db);
      const total = handles.length;
      const pageRaw = Number(req.query.page);
      const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
      const totalPages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * DIRECTORY_PAGE_SIZE;
      const slice = handles.slice(start, start + DIRECTORY_PAGE_SIZE);
      const entries = slice.map((h) => ({
        handle: h,
        href: seoInfluencerAbsoluteUrl(h),
      }));
      const html = renderInfluencersDirectoryHtml({
        page: safePage,
        pageSize: DIRECTORY_PAGE_SIZE,
        total,
        entries,
      });
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.status(200).type('html').send(html);
    })
  );

  /** Índice de sitemaps de perfis (chunks de até SEO_SITEMAP_CHUNK_SIZE). */
  router.get(
    '/sitemap-influencers.xml',
    asyncHandler(async (_req, res) => {
      const handles = await listAllProfileHandlesCached(db);
      const chunks = Math.max(1, Math.ceil(handles.length / SEO_SITEMAP_CHUNK_SIZE));
      const origin = getPublicSiteOrigin();
      const now = new Date().toISOString().slice(0, 10);
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <sitemap><loc>${xmlEscape(`${origin}/sitemap-influencers-dir.xml`)}</loc><lastmod>${now}</lastmod></sitemap>`,
        ...Array.from({ length: chunks }, (_, i) => {
          const loc = `${origin}/sitemap-influencers-${i + 1}.xml`;
          return `  <sitemap><loc>${xmlEscape(loc)}</loc><lastmod>${now}</lastmod></sitemap>`;
        }),
        '</sitemapindex>',
      ].join('\n');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).type('application/xml').send(body);
    })
  );

  /** Sitemap das páginas do diretório (/influenciadores?page=N). */
  router.get(
    '/sitemap-influencers-dir.xml',
    asyncHandler(async (_req, res) => {
      const handles = await listAllProfileHandlesCached(db);
      const totalPages = Math.max(1, Math.ceil(handles.length / DIRECTORY_PAGE_SIZE));
      const now = new Date().toISOString().slice(0, 10);
      const urls: string[] = [];
      for (let p = 1; p <= totalPages; p++) {
        urls.push(
          `  <url><loc>${xmlEscape(seoDirectoryAbsoluteUrl(p))}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`
        );
      }
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
      ].join('\n');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).type('application/xml').send(body);
    })
  );

  /** Chunk N do sitemap de perfis (1-based). */
  router.get(
    '/sitemap-influencers-:chunk.xml',
    asyncHandler(async (req, res) => {
      const chunkNum = Number(req.params.chunk);
      if (!Number.isInteger(chunkNum) || chunkNum < 1) {
        res.status(404).type('text').send('Not found');
        return;
      }
      const handles = await listAllProfileHandlesCached(db);
      const chunks = Math.max(1, Math.ceil(handles.length / SEO_SITEMAP_CHUNK_SIZE));
      if (chunkNum > chunks) {
        res.status(404).type('text').send('Not found');
        return;
      }
      const start = (chunkNum - 1) * SEO_SITEMAP_CHUNK_SIZE;
      const slice = handles.slice(start, start + SEO_SITEMAP_CHUNK_SIZE);
      const now = new Date().toISOString().slice(0, 10);
      const urls = slice.map(
        (h) =>
          `  <url><loc>${xmlEscape(seoInfluencerAbsoluteUrl(h))}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
      );
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
      ].join('\n');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).type('application/xml').send(body);
    })
  );

  /** Índice de sitemaps de posts. */
  router.get(
    '/sitemap-posts.xml',
    asyncHandler(async (_req, res) => {
      const posts = await listAllSeoPostsCached(db);
      const chunks = Math.max(1, Math.ceil(posts.length / SEO_SITEMAP_CHUNK_SIZE));
      const origin = getPublicSiteOrigin();
      const now = new Date().toISOString().slice(0, 10);
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...Array.from({ length: chunks }, (_, i) => {
          const loc = `${origin}/sitemap-posts-${i + 1}.xml`;
          return `  <sitemap><loc>${xmlEscape(loc)}</loc><lastmod>${now}</lastmod></sitemap>`;
        }),
        '</sitemapindex>',
      ].join('\n');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).type('application/xml').send(body);
    })
  );

  /** Chunk N do sitemap de posts (1-based). */
  router.get(
    '/sitemap-posts-:chunk.xml',
    asyncHandler(async (req, res) => {
      const chunkNum = Number(req.params.chunk);
      if (!Number.isInteger(chunkNum) || chunkNum < 1) {
        res.status(404).type('text').send('Not found');
        return;
      }
      const posts = await listAllSeoPostsCached(db);
      const chunks = Math.max(1, Math.ceil(posts.length / SEO_SITEMAP_CHUNK_SIZE));
      if (chunkNum > chunks) {
        res.status(404).type('text').send('Not found');
        return;
      }
      const start = (chunkNum - 1) * SEO_SITEMAP_CHUNK_SIZE;
      const slice = posts.slice(start, start + SEO_SITEMAP_CHUNK_SIZE);
      const now = new Date().toISOString().slice(0, 10);
      const urls = slice.map(
        (p) =>
          `  <url><loc>${xmlEscape(seoPostAbsoluteUrl(p.handle, p.shortcode))}</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`
      );
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
      ].join('\n');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.status(200).type('application/xml').send(body);
    })
  );

  /** JSON leve para debug / health do SEO. */
  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      const handles = await listAllProfileHandlesCached(db);
      const posts = await listAllSeoPostsCached(db);
      res.json({
        profiles: handles.length,
        posts: posts.length,
        samplePath: handles[0] ? seoInfluencerPath(handles[0]) : null,
        samplePostPath: posts[0] ? seoPostPath(posts[0].handle, posts[0].shortcode) : null,
        sitemapIndex: `${getPublicSiteOrigin()}/sitemap-influencers.xml`,
        sitemapPostsIndex: `${getPublicSiteOrigin()}/sitemap-posts.xml`,
        directory: seoDirectoryAbsoluteUrl(1),
      });
    })
  );

  return router;
}
