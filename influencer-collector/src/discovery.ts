/**
 * Descoberta de perfis por hashtag, feed ou explore.
 */

import type { Page } from 'playwright';
import { InstagramClient } from './instagram.js';
import {
  getFollowersAndMinimalProfile,
  extractProfile,
  extractProfileFull,
} from './profileExtractor.js';
import { buildSlimProfile } from './slimProfile.js';
import {
  getFollowersFromEntity,
  hasPostWithMinLikes,
  hasRejectedProfileKeyword,
  isBlocklistedHandle,
  isBusinessFromEntity,
  isPrivateFromEntity,
  qualifiesAsInfluencer,
  containsRejectedKeyword,
  explainRejectedProfileKeyword,
  explainCommercialOrEstablishment,
  explainNotQualifiesAsInfluencer,
  type Entity,
} from './entityRules.js';
import {
  listHandles,
  recordDuplicate,
  recordIssue,
  registerCollectedWithIntegration,
} from './memoryStorage.js';
import {
  isRemoteIngestConfigured,
  pushProfileFullToServer,
  pushProfileToServerRocksDb,
} from './serverIngest.js';
import type { CollectorConfig } from './config.js';
import { coletaLog } from './coletaLog.js';
import { setProcessingState } from './processingStatus.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Conta links de post na grade da página atual (hashtag/explore). */
async function countGridPostLinks(page: Page): Promise<number> {
  let n = await page.locator('article a[href^="/p/"]').count();
  if (n === 0) n = await page.locator('main a[href*="/p/"]').count();
  return n;
}

/**
 * Garante URL da hashtag + grade com posts suficientes (lazy load).
 * Depois de visitar perfil, o Instagram muitas vezes não mostra mais a grade — precisa goto + scroll.
 */
async function ensureHashtagGridReady(
  page: Page,
  tagUrl: string,
  tag: string,
  neededCount: number
): Promise<void> {
  const tagKey = tag.replace(/^#/, '').trim().toLowerCase();

  function isOnTagExplorePage(url: string): boolean {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (!path.includes('/explore/tags/')) return false;
      const seg = path.split('/explore/tags/')[1]?.split('/')[0] ?? '';
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* keep seg */
      }
      return decoded.toLowerCase() === tagKey;
    } catch {
      return false;
    }
  }

  if (!isOnTagExplorePage(page.url())) {
    coletaLog(`#${tag}: abrindo página da hashtag (grade precisa estar visível)…`);
    await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(1800, 2800);
  }

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(600);

  let n = await countGridPostLinks(page);
  if (n === 0) {
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(1200);
    n = await countGridPostLinks(page);
  }

  let scrolls = 0;
  while (n < neededCount && scrolls < 45) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(450);
    const n2 = await countGridPostLinks(page);
    if (n2 > n) n = n2;
    scrolls++;
    if (n2 === n && scrolls % 8 === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(600);
    }
  }

  if (n < neededCount) {
    coletaLog(`#${tag}: recarregando hashtag — só ${n} post(s) visíveis, preciso ≥${neededCount}.`);
    await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(2000, 3200);
    await page.evaluate(() => window.scrollTo(0, 400));
    n = await countGridPostLinks(page);
    scrolls = 0;
    while (n < neededCount && scrolls < 45) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(450);
      n = await countGridPostLinks(page);
      scrolls++;
    }
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

const profileUrlRe = /instagram\.com\/[^/]+\/?(\?.*)?$/;
const profileHrefRe = /^\/[^/]+\/?$/;
const isProfileHref = (h: string) =>
  profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/') && !h.includes('/reel/');

export type DiscoveryMode = 'hashtag' | 'feed' | 'explore';

export interface DiscoveryOptions {
  mode: DiscoveryMode;
  tag?: string;
  maxProfiles: number;
  config: CollectorConfig;
  shouldAbort: () => boolean;
  onCollected?: (handle: string, followers: number) => void;
}

async function processOneProfile(
  page: Page,
  handle: string,
  config: CollectorConfig,
  existingHandles: Set<string>,
  discoveredBy: string,
  discoveredValue: string,
  options?: { pageAlreadyOnProfile?: boolean },
  onCollected?: (handle: string, followers: number) => void
): Promise<boolean> {
  const handleLower = handle.toLowerCase();
  if (existingHandles.has(handleLower)) {
    recordDuplicate(handle);
    coletaLog(`@${handle}: duplicado (processOneProfile), ignorado.`);
    return false;
  }

  const hk = handle.replace(/^@/, '').trim().toLowerCase();
  const proc = (stage: string) =>
    setProcessingState({ handle: hk, stage, since: new Date().toISOString() });

  const profileUrl = InstagramClient.profileUrl(handle);
  const pageAlready = options?.pageAlreadyOnProfile ?? false;
  const useRemote = isRemoteIngestConfigured();

  let rawProfile: Record<string, unknown>;
  let posts: Entity[];
  let mediaBundle: {
    feed: Record<string, unknown>[];
    reel: Record<string, unknown>[];
    tagged: Record<string, unknown>[];
  } | null = null;

  proc('Extraindo dados no Instagram…');

  try {
  if (useRemote) {
    coletaLog(`@${handle}: extração COMPLETA (timeline + Reels + Marcados)…`);
    proc('Capturando timeline, Reels e marcados (pode levar 1–3 min)…');
    const full = await extractProfileFull(page, handle, profileUrl, {
      pageAlreadyOnProfile: pageAlready,
    });
    if (full) {
      rawProfile = full.profile;
      posts = full.postsForRules as Entity[];
      mediaBundle = {
        feed: full.feedMedia,
        reel: full.reelMedia,
        tagged: full.taggedMedia,
      };
      coletaLog(
        `@${handle}: captura OK → feed=${full.feedMedia.length} reels=${full.reelMedia.length} marcados=${full.taggedMedia.length} itens GraphQL`
      );
    } else {
      coletaLog(`@${handle}: extração completa falhou → tentando extração rápida…`);
      proc('Extração rápida (fallback)…');
      const extracted = await extractProfile(page, handle, profileUrl, {
        pageAlreadyOnProfile: pageAlready,
      });
      if (!extracted) {
        recordIssue(handle, 'extracao', 'Não foi possível extrair dados do perfil');
        coletaLog(`@${handle}: falha na extração rápida também.`);
        return false;
      }
      rawProfile = extracted.profile;
      posts = extracted.posts as Entity[];
    }
  } else {
    coletaLog(`@${handle}: extração rápida (sem API remota configurada)…`);
    proc('Extração rápida do perfil…');
    const extracted = await extractProfile(page, handle, profileUrl, {
      pageAlreadyOnProfile: pageAlready,
    });
    if (!extracted) {
      recordIssue(handle, 'extracao', 'Não foi possível extrair dados do perfil');
      return false;
    }
    rawProfile = extracted.profile;
    posts = extracted.posts as Entity[];
  }
  proc('Validando regras (seguidores, curtidas, tipo de perfil)…');
  const raw = rawProfile as Record<string, unknown>;
  const followers = getFollowersFromEntity(raw);

  if (isPrivateFromEntity(raw)) {
    recordIssue(
      handle,
      'regra',
      'Perfil privado — não dá para validar posts/seguidores para o filtro do coletor.'
    );
    return false;
  }
  if (hasRejectedProfileKeyword(raw)) {
    recordIssue(handle, 'regra', explainRejectedProfileKeyword(raw));
    return false;
  }
  if (isBusinessFromEntity(raw)) {
    recordIssue(handle, 'regra', explainCommercialOrEstablishment(raw));
    return false;
  }
  if (config.excludeBusinessProfiles && !qualifiesAsInfluencer(raw, config.minFollowersToSave)) {
    recordIssue(
      handle,
      'regra',
      explainNotQualifiesAsInfluencer(raw, config.minFollowersToSave)
    );
    return false;
  }
  if (!config.excludeBusinessProfiles) {
    if (!qualifiesAsInfluencer(raw, config.minFollowersToSave)) {
      recordIssue(
        handle,
        'regra',
        explainNotQualifiesAsInfluencer(raw, config.minFollowersToSave)
      );
      return false;
    }
  }
  if (
    config.minPostLikesToSave > 0 &&
    !hasPostWithMinLikes(posts, config.minPostLikesToSave, config.minPostsWithMinLikesToSave)
  ) {
    recordIssue(handle, 'regra', `Posts sem curtidas suficientes (mín. ${config.minPostLikesToSave})`);
    return false;
  }
  if (isBlocklistedHandle(handle)) {
    recordIssue(handle, 'regra', `Handle @${handle} está na lista de bloqueio interna do coletor.`);
    return false;
  }

  const slim = buildSlimProfile(
    raw,
    handle,
    followers,
    posts,
    discoveredBy,
    discoveredValue
  );
  const nMedia =
    mediaBundle != null
      ? mediaBundle.feed.length + mediaBundle.reel.length + mediaBundle.tagged.length
      : 0;
  coletaLog(
    `@${handle}: enviando para API (${nMedia > 0 ? `ingest-full ~${nMedia} mídias` : 'só perfil slim'})…`
  );
  proc(
    nMedia > 0
      ? `Enviando para API (~${nMedia} itens de mídia)…`
      : 'Enviando perfil para API…'
  );
  const pushResult = await registerCollectedWithIntegration(
    slim as Record<string, unknown> & { handle: string },
    mediaBundle,
    pushProfileFullToServer,
    pushProfileToServerRocksDb
  );
  if (pushResult.skipped) {
    existingHandles.add(handleLower);
    onCollected?.(handle, followers);
    return true;
  }
  if (!pushResult.ok) {
    coletaLog(
      `@${handle}: API falhou — NÃO contado como salvo no servidor. Endpoint: ${pushResult.endpoint ?? '—'}`
    );
    return false;
  }
  existingHandles.add(handleLower);
  onCollected?.(handle, followers);
  return true;
  } finally {
    setProcessingState(null);
  }
}

/** Obtém o handle do autor na página do post (modal ou página). */
async function getAuthorFromPostPage(page: Page): Promise<string | null> {
  for (const sel of ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]']) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'attached', timeout: 5000 });
      const h = await el.getAttribute('href');
      if (h && isProfileHref(h)) {
        const handle = h.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle) return handle;
      }
    } catch {
      continue;
    }
  }
  try {
    const hrefs = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
      nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
    );
    const first = hrefs.find((h) => isProfileHref(h));
    if (first) return first.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? null;
  } catch {
    // ignore
  }
  return null;
}

/** Descoberta por hashtag: abre posts da grade, pega autor, extrai perfil. */
export async function discoverByHashtag(
  client: InstagramClient,
  page: Page,
  tag: string,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const triedInSession = new Set<string>();
  let saved = 0;
  let processed = 0;

  const url = InstagramClient.tagUrl(tag);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/')) {
    console.log('[discovery] Redirecionado para login — faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollTo(0, 600));
  await randomDelay(1500, 3000);

  let postLinks = page.locator('article a[href^="/p/"]');
  if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
  const toProcess = Math.min(options.maxProfiles * 3, await postLinks.count(), config.maxPostsPerTag);
  if (toProcess === 0) {
    coletaLog(`#${tag}: nenhum post na grade para processar.`);
    return { saved: 0, processed: 0 };
  }
  coletaLog(
    `#${tag}: fila de até ${toProcess} posts na grade | meta ${options.maxProfiles} perfil(is) salvos | handles já na base: ${existingHandles.size}`
  );

  for (let postIndex = 0; postIndex < toProcess && saved < options.maxProfiles; postIndex++) {
    if (shouldAbort()) {
      coletaLog(`Parar solicitado — saindo do loop da hashtag #${tag}.`);
      break;
    }
    if (postIndex % 5 === 0 || postIndex === 0) {
      coletaLog(`#${tag}: post ${postIndex + 1}/${toProcess} na grade | salvos até agora: ${saved}/${options.maxProfiles}`);
    }

    await ensureHashtagGridReady(page, url, tag, postIndex + 1);

    postLinks = page.locator('article a[href^="/p/"]');
    if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
    const postLink = postLinks.nth(postIndex);
    let authorFromGrid: string | null = null;
    try {
      const postHref = await postLink.getAttribute('href');
      if (postHref?.includes('/p/')) {
        const m = postHref.match(/^\/([^/]+)\/p\//);
        if (m) authorFromGrid = m[1].split('?')[0]?.trim() ?? null;
      }
      if (!authorFromGrid) {
        const fromDom = await postLink.evaluate((el) => {
          const profileRe = /^\/[^/]+\/?$/;
          let root: Element | null = el;
          for (let i = 0; i < 10 && root; i++) {
            root = root.parentElement;
            if (!root) return null;
            const links = root.querySelectorAll('a[href^="/"]');
            for (const a of links) {
              const href = (a as HTMLAnchorElement).getAttribute('href');
              const path = href ? href.split('?')[0] : '';
              if (path && !path.includes('/p/') && profileRe.test(path)) {
                return path.replace(/^\//, '').split('/')[0]?.trim() ?? null;
              }
            }
          }
          return null;
        });
        if (fromDom) authorFromGrid = fromDom;
      }
    } catch {
      // ignore
    }

    if (authorFromGrid) {
      const lower = authorFromGrid.toLowerCase();
      if (existingHandles.has(lower) || triedInSession.has(lower)) {
        if (existingHandles.has(lower)) {
          recordDuplicate(authorFromGrid);
          coletaLog(`post ${postIndex + 1}: @${authorFromGrid} duplicado (já na base), pulando.`);
        } else {
          coletaLog(`post ${postIndex + 1}: @${authorFromGrid} já tentado nesta rodada #${tag}, pulando.`);
        }
        await randomDelay(800, 1500);
        continue;
      }
      if (isBlocklistedHandle(authorFromGrid) || containsRejectedKeyword(authorFromGrid)) {
        triedInSession.add(lower);
        coletaLog(`post ${postIndex + 1}: @${authorFromGrid} bloqueado/lista, pulando.`);
        continue;
      }
    }

    await randomDelay(1500, 3500);
    try {
      await postLink.scrollIntoViewIfNeeded();
      await postLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(/\/p\//, { timeout: 20000 });
    } catch {
      coletaLog(`post ${postIndex + 1}: não abriu o post (clique/URL), próximo.`);
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1000, 2000);

    let handle = await getAuthorFromPostPage(page);
    if (!handle) {
      coletaLog(`post ${postIndex + 1}: não achei autor na página do post, voltando à hashtag.`);
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || triedInSession.has(handleLower)) {
      if (existingHandles.has(handleLower)) {
        recordDuplicate(handle);
        coletaLog(`@${handle}: duplicado após abrir post, voltando.`);
      } else {
        coletaLog(`@${handle}: já tentado nesta sessão na grade, voltando.`);
      }
      try {
        await page.goBack({ timeout: 15000 });
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, InstagramClient.profileUrl(handle), {
        doNavigate: async () => {
          const authorLink = page.locator(`a[href^="/${handle}"]`).first();
          await authorLink.click({ force: true, timeout: 15000 });
          await page.waitForURL(profileUrlRe, { timeout: 20000 });
        },
      });
      const followers = result.followers;
      if (followers == null || followers < config.minFollowersToSave) {
        recordIssue(
          handle,
          'regra',
          `Antes de extrair o perfil completo: exige pelo menos ${config.minFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${followers != null ? followers.toLocaleString('pt-BR') : '—'}.`,
          { followers_count: followers ?? undefined }
        );
        triedInSession.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: followers,
        } as Record<string, unknown>;
        if (hasRejectedProfileKeyword(entity)) {
          recordIssue(handle, 'regra', explainRejectedProfileKeyword(entity), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
        if (isBusinessFromEntity(entity)) {
          recordIssue(handle, 'regra', explainCommercialOrEstablishment(entity), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
        if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          recordIssue(handle, 'regra', explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
    } else {
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    }

    triedInSession.add(handleLower);
    processed++;
    coletaLog(`@${handle}: pré-filtros OK → extraindo perfil (pode levar 1–3 min com API completa)…`);
    const alreadyOnProfile = config.minFollowersToSave > 0;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'hashtag',
      tag,
      { pageAlreadyOnProfile: alreadyOnProfile },
      onCollected
    );
    if (ok) {
      saved++;
      coletaLog(`@${handle}: concluído e contabilizado (${saved}/${options.maxProfiles} salvos nesta hashtag).`);
    } else {
      coletaLog(`@${handle}: não entrou como salvo (regra/erro — veja tabela Problemas na UI).`);
    }

    coletaLog(`#${tag}: indo à URL da hashtag de novo (goBack não garante a grade após perfil completo)…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(1000, 1800);
    coletaLog(`#${tag}: hashtag carregada — na próxima volta da fila: post ${postIndex + 2}/${toProcess}`);
    await randomDelay(1500, 3000);
  }

  return { saved, processed };
}

/** Descoberta pelo feed: rola o feed, pega autor do primeiro post, extrai. */
export async function discoverByFeed(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  while (saved < options.maxProfiles && !shouldAbort()) {
    await randomDelay(1500, 3500);
    const article = page.locator('article').first();
    if ((await article.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    const isSponsored = (await article.locator('text=/patrocinado/i').count()) > 0;
    if (isSponsored) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const linkCount = await article.locator('a[href^="/"]').count();
    let authorHref: string | null = null;
    for (let j = 0; j < linkCount; j++) {
      const h = await article.locator('a[href^="/"]').nth(j).getAttribute('href');
      if (h && isProfileHref(h)) {
        authorHref = h;
        break;
      }
    }
    if (!authorHref) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
    if (!handle || skipped.has(handle.toLowerCase()) || existingHandles.has(handle.toLowerCase())) {
      if (handle && existingHandles.has(handle.toLowerCase())) recordDuplicate(handle);
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(handle.toLowerCase());
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }

    try {
      await article.locator(`a[href^="/${handle}"]`).first().click();
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
    } catch {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    await randomDelay(1500, 2500);

    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, InstagramClient.profileUrl(handle), {
        skipGoto: true,
      });
      if (
        result.followers == null ||
        result.followers < config.minFollowersToSave
      ) {
        recordIssue(
          handle,
          'regra',
          `No feed: exige ≥${config.minFollowersToSave.toLocaleString('pt-BR')} seguidores para abrir o perfil; @${handle} tem ${result.followers != null ? result.followers.toLocaleString('pt-BR') : '—'}.`,
          { followers_count: result.followers ?? undefined }
        );
        skipped.add(handle.toLowerCase());
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: result.followers,
        } as Record<string, unknown>;
        let feedDetail = '';
        if (hasRejectedProfileKeyword(entity)) {
          feedDetail = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          feedDetail = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          feedDetail = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (feedDetail) {
          recordIssue(handle, 'regra', `No feed: ${feedDetail}`, {
            followers_count: result.followers,
          });
          skipped.add(handle.toLowerCase());
          await page.goBack({ timeout: 15000 });
          continue;
        }
      }
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'feed',
      'home',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(handle.toLowerCase());

    await page.goBack({ timeout: 15000 });
    await randomDelay(1000, 2000);
  }

  return { saved, processed };
}

/** Descoberta pelo Explore: abre a grade, clica no primeiro post, pega autor e extrai. */
export async function discoverByExplore(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollBy(0, 400));
  await randomDelay(1500, 3000);

  while (saved < options.maxProfiles && !shouldAbort()) {
    const postLink = page.locator('article a[href*="/p/"], a[href*="/reel/"]').first();
    if ((await postLink.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1500, 3000);
    try {
      await postLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(/\/(p|reel)\//, { timeout: 20000 });
    } catch {
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1000, 2000);

    const handle = await getAuthorFromPostPage(page);
    if (!handle) {
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || skipped.has(handleLower)) {
      if (existingHandles.has(handleLower)) recordDuplicate(handle);
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(handleLower);
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      continue;
    }

    const profileUrl = InstagramClient.profileUrl(handle);
    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, profileUrl, {
        doNavigate: async () => {
          const authorLink = page.locator(`a[href^="/${handle}"]`).first();
          await authorLink.click({ force: true, timeout: 15000 });
          await page.waitForURL(profileUrlRe, { timeout: 20000 });
        },
      });
      if (
        result.followers == null ||
        result.followers < config.minFollowersToSave
      ) {
        recordIssue(
          handle,
          'regra',
          `No Explore: exige ≥${config.minFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${result.followers != null ? result.followers.toLocaleString('pt-BR') : '—'}.`,
          { followers_count: result.followers ?? undefined }
        );
        skipped.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: result.followers,
        } as Record<string, unknown>;
        let expDetail = '';
        if (hasRejectedProfileKeyword(entity)) {
          expDetail = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          expDetail = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          expDetail = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (expDetail) {
          recordIssue(handle, 'regra', `No Explore: ${expDetail}`, {
            followers_count: result.followers,
          });
          skipped.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    } else {
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'explore',
      'explore',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(handleLower);

    try {
      await page.goBack({ timeout: 15000 });
      await page.goBack({ timeout: 15000 });
    } catch {
      await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await randomDelay(1500, 3000);
  }

  return { saved, processed };
}
