import type { Page } from 'playwright';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { getFollowersFromProfile, getFollowersAndMinimalProfile } from '../profileExtractor/index.js';
import { crawlLogDiscovery } from '../utils/crawlLogger.js';
import { randomDelay, humanDelay } from '../utils/delay.js';
import { containsRejectedKeyword, getBusinessBlockReason, getInfluencerRejectionDiagnostic, getRejectedKeywordReason, hasRejectedProfileKeyword, isBlocklistedHandle, isBusinessFromEntity, qualifiesAsInfluencer } from '../utils/entityAccess.js';
import { get429BackoffMs, record429, shouldAbortRunAfter429 } from '../utils/rateLimit429.js';

export interface DiscoveredProfileRef {
  handle: string;
  profileUrl: string;
  /** Seguidores já lidos na página durante a descoberta (quando minFollowers > 0). */
  followersFromDiscovery?: number;
}

/**
 * Processa uma hashtag: para cada post, obtém o autor, checa seguidores e, se >= minFollowers,
 * chama onProfileQualified e **espera terminar** (extrair + salvar) antes de ir ao próximo post.
 * Regra: 1 perfil completo por vez — NUNCA avança para o próximo post até o fluxo do perfil
 * atual estar 100% concluído (onProfileQualified retornar).
 */
export async function discoverAndProcessByHashtag(
  client: InstagramClient,
  tag: string,
  maxPosts: number,
  maxProfiles: number,
  minFollowers: number,
  existingHandles: Set<string>,
  onProfileQualified: (ref: DiscoveredProfileRef, pageAlreadyOnProfile?: Page) => Promise<boolean>,
  shouldAbort?: () => boolean,
  excludeBusinessProfiles: boolean = true
): Promise<{ saved: number; processed: number; failed: number }> {
  const CONSECUTIVE_FAILURES_BEFORE_RELOGIN = 5;
  const zero = { saved: 0, processed: 0, failed: 0 };
  let page = await client.newPage();
  let savedCount = 0;
  let processedCount = 0;
  let consecutiveLoadFailures = 0;
  try {
    const url = InstagramClient.tagUrl(tag);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay();

    const currentUrl = page.url();
    const isLoginOrChallenge = currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/');
    if (isLoginOrChallenge) {
      crawlLogDiscovery('Página de login/challenge detectada — sessão expirada ou não logado.');
      const user = process.env.INSTAGRAM_USER;
      const password = process.env.INSTAGRAM_PASSWORD;
      if (user && password) {
        crawlLogDiscovery('Tentando login com credenciais do .env...');
        await page.close().catch(() => { });
        await client.closeContext();
        await client.clearAuthStateFile();
        try {
          const loginOk = await loginWithCredentials(client, user, password);
          if (loginOk) {
            page = await client.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
            const urlAfterLogin = page.url();
            if (urlAfterLogin.includes('/accounts/login/') || urlAfterLogin.includes('/challenge/')) {
              crawlLogDiscovery('Ainda na página de login após tentativa. Verifique usuário/senha no .env.');
              return zero;
            }
          } else {
            crawlLogDiscovery('Login falhou. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
            return zero;
          }
        } catch (loginErr) {
          crawlLogDiscovery(`Erro ao fazer login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
          return zero;
        }
      } else {
        crawlLogDiscovery('Rode: npm run login (sessão em data/instagram-auth.json) ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return zero;
      }
    }

    await page.evaluate(() => window.scrollTo(0, 600));
    await randomDelay(1500, 3000);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) {
      postLinks = page.locator('a[href*="/p/"]');
      postCount = await postLinks.count();
    }
    if (postCount === 0) {
      const urlNow = page.url();
      if (urlNow.includes('/accounts/login/') || urlNow.includes('/challenge/')) {
        crawlLogDiscovery('Redirecionado para login/challenge. Rode npm run login ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return zero;
      }
      crawlLogDiscovery('Nenhum post encontrado para esta hashtag. Verifique o termo ou se a hashtag existe.');
      return zero;
    }
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    crawlLogDiscovery(`${tag}: ${toProcess} posts para processar (abrindo por clique)`);

    let postIndex = 0;
    let stoppedDueToBlock = false;
    const profileUrlRe = /instagram\.com\/[^/]+\/?(\?.*)?$/;
    /** Handles já tentados nesta sessão (salvos ou rejeitados) para não reprocessar quando o mesmo autor aparece em vários posts. */
    const triedInThisSession = new Set<string>();

    const scrollHashtag = async (): Promise<void> => {
      await page.evaluate(() => window.scrollBy(0, 350));
      await randomDelay(600, 1200);
    };

    const profileHrefRe = /^\/[^/]+\/?$/;
    const isProfileHref = (h: string) => profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/');
    while (postIndex < toProcess && savedCount < maxProfiles && !stoppedDueToBlock) {
      if (shouldAbort?.()) {
        crawlLogDiscovery('Crawl interrompido pelo usuário.');
        break;
      }

      postLinks = page.locator('article a[href^="/p/"]');
      if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
      const currentPostCount = await postLinks.count();
      if (postIndex >= currentPostCount) break;

      const postLink = postLinks.nth(postIndex);
      const postHref = await postLink.getAttribute('href');
      let authorFromGrid: string | null = null;
      if (postHref != null && postHref.startsWith('/') && postHref.includes('/p/')) {
        const m = postHref.match(/^\/([^/]+)\/p\//);
        if (m) authorFromGrid = m[1].split('?')[0]?.trim() ?? null;
      }
      if (!authorFromGrid) {
        try {
          const article = postLink.locator('xpath=ancestor::article[1]');
          const linkCount = await article.locator('a[href^="/"]').count();
          for (let j = 0; j < linkCount; j++) {
            const h = await article.locator('a[href^="/"]').nth(j).getAttribute('href');
            if (h && isProfileHref(h)) {
              authorFromGrid = h.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? null;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
      if (!authorFromGrid) {
        try {
          const fromDom = await postLink.evaluate((el) => {
            const profileRe = /^\/[^/]+\/?$/;
            let container: Element | null = el;
            for (let i = 0; i < 8 && container; i++) {
              container = container.parentElement;
              if (!container) return null;
              const links = container.querySelectorAll('a[href^="/"]');
              for (const a of links) {
                const href = (a as HTMLAnchorElement).getAttribute('href');
                const path = href ? href.split('?')[0] : '';
                if (path && !path.includes('/p/') && !path.includes('/reel/') && profileRe.test(path)) {
                  const user = path.replace(/^\//, '').split('/')[0]?.trim();
                  if (user) return user;
                }
              }
            }
            return null;
          });
          if (fromDom) authorFromGrid = fromDom;
        } catch {
          // ignore
        }
      }
      if (!authorFromGrid) {
        try {
          const fromArticle = await page.evaluate((idx: number) => {
            const profileRe = /^\/[^/]+\/?$/;
            const posts = document.querySelectorAll('article a[href*="/p/"], a[href*="/p/"]');
            const node = posts[idx];
            if (!node) return null;
            let root: Element | null = node;
            for (let i = 0; i < 12 && root; i++) {
              root = root.parentElement;
              if (!root) return null;
              const links = root.querySelectorAll('a[href^="/"]');
              for (const a of links) {
                const href = (a as HTMLAnchorElement).getAttribute('href');
                const path = href ? href.split('?')[0] : '';
                if (path && !path.includes('/p/') && !path.includes('/reel/') && profileRe.test(path)) {
                  const user = path.replace(/^\//, '').split('/')[0]?.trim();
                  if (user) return user;
                }
              }
            }
            return null;
          }, postIndex);
          if (fromArticle) authorFromGrid = fromArticle;
        } catch {
          // ignore
        }
      }
      if (authorFromGrid) {
        const authorLower = authorFromGrid.toLowerCase();
        if (existingHandles.has(authorLower) || triedInThisSession.has(authorLower)) {
          triedInThisSession.add(authorLower);
          crawlLogDiscovery(`@${authorFromGrid} → pulado (já no storage/tentado), post não aberto`);
          postIndex++;
          continue;
        }
      }

      await randomDelay(1500, 3500);
      try {
        await postLink.scrollIntoViewIfNeeded();
        await randomDelay(300, 600);
        await postLink.click({ force: true, timeout: 15000 });
        await page.waitForURL(/\/p\//, { timeout: 20000 });
        consecutiveLoadFailures = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('closed') || msg.includes('Target')) {
          crawlLogDiscovery(`Browser fechado, encerrando descoberta.`);
          break;
        }
        const isBlock = msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || msg.includes('403') || msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('401') || msg.includes('rate limit');
        if (isBlock) {
          record429();
          stoppedDueToBlock = true;
          crawlLogDiscovery(`  -> Bloqueio (403/429) detectado. Parando esta fase e passando para a próxima.`);
          break;
        }
        consecutiveLoadFailures++;
        crawlLogDiscovery(`  -> post falhou ao abrir (clique): ${msg.slice(0, 80)}`);
        if (consecutiveLoadFailures >= CONSECUTIVE_FAILURES_BEFORE_RELOGIN) {
          const user = process.env.INSTAGRAM_USER;
          const password = process.env.INSTAGRAM_PASSWORD;
          await page.close().catch(() => { });
          if (user && password) {
            crawlLogDiscovery(`  -> Sessão provavelmente expirada. Limpando cookies e fazendo login novamente...`);
            await client.closeContext();
            await client.clearAuthStateFile();
            try {
              const loginOk = await loginWithCredentials(client, user, password);
              if (loginOk) {
                crawlLogDiscovery(`  -> Login OK. Retomando extração.`);
                consecutiveLoadFailures = 0;
              } else {
                crawlLogDiscovery(`  -> Login falhou. Continuando com nova página.`);
              }
            } catch (loginErr) {
              crawlLogDiscovery(`  -> Erro no re-login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
            }
          } else {
            crawlLogDiscovery(`  -> Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env para re-login automático, ou rode npm run login.`);
          }
          page = await client.newPage();
          await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
        await humanDelay();
        postIndex++;
        continue;
      }
      await humanDelay();

      const authorSelectors = [
        'section a[href^="/"]',
        'header a[href^="/"]',
        '[role="presentation"] a[href^="/"]',
        'a[href^="/"][href*="/"]',
      ];

      let authorHref: string | null = null;
      let authorLinkLocator: import('playwright').Locator | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'attached', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && isProfileHref(h)) {
            authorHref = h;
            authorLinkLocator = el;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!authorHref) {
        try {
          const hrefsSection = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
            nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
          );
          const first = hrefsSection.find((h) => isProfileHref(h));
          if (first) {
            authorHref = first;
            const handleFromHref = first.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
            if (handleFromHref) authorLinkLocator = page.locator(`a[href^="/${handleFromHref}"]`).first();
          }
        } catch {
          // ignore
        }
      }

      if (!authorHref || !authorLinkLocator) {
        try {
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await humanDelay();
        postIndex++;
        continue;
      }

      const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
      if (!handle) {
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        postIndex++;
        continue;
      }
      const handleLower = handle.toLowerCase();
      if (existingHandles.has(handleLower)) {
        triedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → pulado: já no storage`);
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }

      if (triedInThisSession.has(handleLower)) {
        crawlLogDiscovery(`@${handle} → pulado: já tentado nesta sessão`);
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }

      if (isBlocklistedHandle(handle)) {
        triedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → pulado: handle bloqueado`);
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }
      if (containsRejectedKeyword(handle)) {
        triedInThisSession.add(handleLower);
        const reason = getRejectedKeywordReason({ handle });
        crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }
      if (isBusinessFromEntity({ handle })) {
        triedInThisSession.add(handleLower);
        const reason = getBusinessBlockReason({ handle });
        crawlLogDiscovery(`@${handle} → pulado: empresa${reason ? ` (${reason})` : ''}`);
        try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }

      const profileUrl = InstagramClient.profileUrl(handle);
      const doNavigateToProfile = async () => {
        await authorLinkLocator!.scrollIntoViewIfNeeded();
        await randomDelay(300, 600);
        await authorLinkLocator!.click({ force: true, timeout: 15000 });
        await page.waitForURL(profileUrlRe, { timeout: 20000 });
      };

      let followers: number | null = null;
      let minimalProfile: Record<string, unknown> | null = null;
      if (minFollowers > 0) {
        if (excludeBusinessProfiles) {
          const result = await getFollowersAndMinimalProfile(page, profileUrl, { doNavigate: doNavigateToProfile });
          followers = result.followers;
          minimalProfile = result.minimalProfile;
        } else {
          followers = await getFollowersFromProfile(page, profileUrl, { doNavigate: doNavigateToProfile });
        }
      }

      if (minFollowers > 0 && (followers == null || followers < minFollowers)) {
        triedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → pulado: abaixo de ${minFollowers} seguidores`);
        processedCount++;
        try { await page.goBack({ timeout: 15000 }); await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
        await humanDelay();
        for (let s = 0; s < 2; s++) await scrollHashtag();
        postIndex++;
        continue;
      }

      if (excludeBusinessProfiles && minimalProfile != null) {
        const dataUser = minimalProfile?.data != null && typeof minimalProfile.data === 'object'
          ? (minimalProfile.data as Record<string, unknown>).user
          : undefined;
        const entity: Record<string, unknown> = {
          handle,
          username: handle,
          ...(typeof dataUser === 'object' && dataUser != null ? (dataUser as Record<string, unknown>) : {}),
          followers_count: followers ?? 0,
        };
        if (hasRejectedProfileKeyword(entity)) {
          triedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          try { await page.goBack({ timeout: 15000 }); await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
          await humanDelay();
          for (let s = 0; s < 2; s++) await scrollHashtag();
          postIndex++;
          continue;
        }
        if (isBusinessFromEntity(entity)) {
          triedInThisSession.add(handleLower);
          const reason = getBusinessBlockReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: empresa${reason ? ` (${reason})` : ''}`);
          try { await page.goBack({ timeout: 15000 }); await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
          await humanDelay();
          for (let s = 0; s < 2; s++) await scrollHashtag();
          postIndex++;
          continue;
        }
        if (!qualifiesAsInfluencer(entity, minFollowers)) {
          triedInThisSession.add(handleLower);
          const diag = getInfluencerRejectionDiagnostic(entity, minFollowers, true);
          const reasonMsg = diag.reason === 'seguidores_abaixo_minimo' && diag.minRequired != null
            ? `seguidores abaixo do mínimo (${diag.followers} < ${diag.minRequired})`
            : diag.reason === 'conta_tipo_desconhecido'
              ? 'tipo de conta não permitido'
              : diag.reason ?? 'filtro';
          crawlLogDiscovery(`@${handle} → pulado: não qualifica (filtro: ${reasonMsg})`);
          try { await page.goBack({ timeout: 15000 }); await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
          await humanDelay();
          for (let s = 0; s < 2; s++) await scrollHashtag();
          postIndex++;
          continue;
        }
      } else {
        if (hasRejectedProfileKeyword({ handle, username: handle })) {
          triedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason({ handle, username: handle });
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          if (minFollowers > 0) {
            try { await page.goBack({ timeout: 15000 }); await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
          } else {
            try { await page.goBack({ timeout: 15000 }); } catch { await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 }); }
          }
          await humanDelay();
          for (let s = 0; s < 2; s++) await scrollHashtag();
          postIndex++;
          continue;
        }
      }

      const ref: DiscoveredProfileRef = { handle, profileUrl, followersFromDiscovery: followers ?? undefined };
      processedCount++;
      triedInThisSession.add(handleLower);
      try {
        const saved = await onProfileQualified(ref, page);
        if (saved) {
          savedCount++;
          existingHandles.add(handleLower);
        }
        const failed = processedCount - savedCount;
        crawlLogDiscovery(`Totais: ${savedCount} salvos, ${failed} falhas`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'RATE_LIMIT_429') {
          const backoffMs = get429BackoffMs();
          const min = Math.round(backoffMs / 60000);
          crawlLogDiscovery(`  -> 429 detectado. Pausa de ${min} min antes de continuar.`);
          await new Promise((r) => setTimeout(r, backoffMs));
          if (shouldAbortRunAfter429()) {
            crawlLogDiscovery('  -> Segundo 429 no mesmo run. Encerrando crawl (volte em ~12h).');
            break;
          }
          consecutiveLoadFailures = 0;
        } else {
          throw err;
        }
      }
      await humanDelay();
      try {
        await page.goBack({ timeout: 15000 });
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.tagUrl(tag), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await humanDelay();
      postIndex++;
    }

    if (stoppedDueToBlock) {
      crawlLogDiscovery('Bloqueio (403/429): encerrando esta fase e passando para a próxima (sem esperar backoff).');
      await randomDelay(20000, 40000);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return { saved: savedCount, processed: processedCount, failed: processedCount - savedCount };
}

/**
 * Processa o feed principal (home): abre a página inicial logada, rola para carregar posts,
 * coleta autores dos posts visíveis e chama onProfileQualified para cada um (extrair + salvar).
 * Requer sessão logada (INSTAGRAM_USER/INSTAGRAM_PASSWORD ou npm run login).
 */
export async function discoverAndProcessByHomeFeed(
  client: InstagramClient,
  maxPosts: number,
  maxProfiles: number,
  minFollowers: number,
  existingHandles: Set<string>,
  onProfileQualified: (ref: DiscoveredProfileRef, pageAlreadyOnProfile?: Page) => Promise<boolean>,
  shouldAbort?: () => boolean,
  excludeBusinessProfiles: boolean = true
): Promise<{ saved: number; processed: number; failed: number }> {
  const CONSECUTIVE_FAILURES_BEFORE_RELOGIN = 5;
  const zero = { saved: 0, processed: 0, failed: 0 };
  let page = await client.newPage();
  let savedCount = 0;
  let processedCount = 0;
  let consecutiveLoadFailures = 0;
  try {
    const url = InstagramClient.homeFeedUrl();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay();

    const currentUrl = page.url();
    const isLoginOrChallenge = currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/');
    if (isLoginOrChallenge) {
      crawlLogDiscovery('Página de login/challenge detectada — sessão expirada ou não logado.');
      const user = process.env.INSTAGRAM_USER;
      const password = process.env.INSTAGRAM_PASSWORD;
      if (user && password) {
        crawlLogDiscovery('Tentando login com credenciais do .env...');
        await page.close().catch(() => { });
        await client.closeContext();
        await client.clearAuthStateFile();
        try {
          const loginOk = await loginWithCredentials(client, user, password);
          if (loginOk) {
            page = await client.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
            const urlAfterLogin = page.url();
            if (urlAfterLogin.includes('/accounts/login/') || urlAfterLogin.includes('/challenge/')) {
              crawlLogDiscovery('Ainda na página de login após tentativa. Verifique usuário/senha no .env.');
              return zero;
            }
          } else {
            crawlLogDiscovery('Login falhou. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
            return zero;
          }
        } catch (loginErr) {
          crawlLogDiscovery(`Erro ao fazer login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
          return zero;
        }
      } else {
        crawlLogDiscovery('Rode: npm run login (sessão em data/instagram-auth.json) ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return zero;
      }
    }

    crawlLogDiscovery('Feed principal: modo infinito — rolando e clicando no perfil do primeiro post até atingir limite ou interromper.');
    const profileHrefRe = /^\/[^/]+\/?$/;
    const isProfileHref = (h: string) => profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/') && !h.includes('/reel/') && !h.includes('/stories/') && !h.includes('/explore/');
    let stoppedDueToBlock = false;
    /** Handles já pulados nesta sessão (rejeitados/empresa/já no storage) para não ficar preso no mesmo perfil. */
    const skippedInThisSession = new Set<string>();

    const ensureOnFeed = async (): Promise<boolean> => {
      const url = page.url();
      if (url.includes('/accounts/login/') || url.includes('/challenge/')) return false;
      const base = InstagramClient.homeFeedUrl();
      const onFeed = url === base || url === `${base}/` || url.replace(/\/$/, '') === base;
      if (!onFeed) {
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay();
      }
      return true;
    };

    const scrollFeed = async (): Promise<void> => {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(800, 1600);
    };

    let emptyFeedCount = 0;
    const MAX_EMPTY_FEED = 5;

    while (true) {
      if (shouldAbort?.()) {
        crawlLogDiscovery('Crawl interrompido pelo usuário.');
        break;
      }
      if (savedCount >= maxProfiles) {
        crawlLogDiscovery(`Limite de ${maxProfiles} perfis atingido.`);
        break;
      }

      const onFeed = await ensureOnFeed();
      if (!onFeed) break;

      await randomDelay(1500, 3500);

      let articleCount = await page.locator('main article').count();
      if (articleCount === 0) {
        articleCount = await page.locator('article').count();
      }
      if (articleCount === 0) {
        emptyFeedCount++;
        crawlLogDiscovery('Nenhum post visível no feed; rolando para carregar...');
        await scrollFeed();
        if (emptyFeedCount >= MAX_EMPTY_FEED) {
          crawlLogDiscovery('Feed continua vazio após várias tentativas. Encerrando.');
          break;
        }
        continue;
      }
      emptyFeedCount = 0;

      const article = page.locator('article').first();
      const isSponsored = await article.locator('text=/patrocinado/i').count() > 0;
      if (isSponsored) {
        crawlLogDiscovery('  Post impulsionado (patrocinado) detectado; rolando para o próximo.');
        for (let s = 0; s < 3; s++) await scrollFeed();
        continue;
      }
      const linkCount = await article.locator('a[href^="/"]').count();
      let authorHref: string | null = null;
      let linkIndex = -1;
      for (let j = 0; j < linkCount; j++) {
        const h = await article.locator('a[href^="/"]').nth(j).getAttribute('href');
        if (h && isProfileHref(h)) {
          authorHref = h;
          linkIndex = j;
          break;
        }
      }
      if (!authorHref || linkIndex < 0) {
        crawlLogDiscovery('  Primeiro post sem link de perfil; rolando para o próximo.');
        await scrollFeed();
        continue;
      }
      const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
      if (!handle) {
        await scrollFeed();
        continue;
      }
      const handleLower = handle.toLowerCase();
      if (skippedInThisSession.has(handleLower)) {
        for (let s = 0; s < 4; s++) await scrollFeed();
        continue;
      }
      if (existingHandles.has(handleLower)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → já no storage; rolando para o próximo.`);
        for (let s = 0; s < 3; s++) await scrollFeed();
        continue;
      }
      if (isBlocklistedHandle(handle)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → handle bloqueado; rolando.`);
        for (let s = 0; s < 3; s++) await scrollFeed();
        continue;
      }
      if (containsRejectedKeyword(handle)) {
        skippedInThisSession.add(handleLower);
        const reason = getRejectedKeywordReason({ handle });
        crawlLogDiscovery(`@${handle} → palavra rejeitada; rolando.${reason ? ` (${reason})` : ''}`);
        for (let s = 0; s < 3; s++) await scrollFeed();
        continue;
      }
      if (isBusinessFromEntity({ handle })) {
        skippedInThisSession.add(handleLower);
        const reason = getBusinessBlockReason({ handle });
        crawlLogDiscovery(`@${handle} → empresa; rolando.${reason ? ` (${reason})` : ''}`);
        for (let s = 0; s < 3; s++) await scrollFeed();
        continue;
      }

      const profileLink = article.locator('a[href^="/"]').nth(linkIndex);
      try {
        await profileLink.click();
        await page.waitForURL(/instagram\.com\/[^/]+\/?(\?.*)?$/, { timeout: 20000 });
        consecutiveLoadFailures = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('closed') || msg.includes('Target')) {
          crawlLogDiscovery('Browser fechado, encerrando descoberta.');
          break;
        }
        const isBlock = msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || msg.includes('403') || msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('401') || msg.includes('rate limit');
        if (isBlock) {
          record429();
          stoppedDueToBlock = true;
          crawlLogDiscovery('  -> Bloqueio (403/429) detectado. Parando esta fase e passando para a próxima.');
          break;
        }
        consecutiveLoadFailures++;
        crawlLogDiscovery(`  -> falha ao clicar/navegar para @${handle}: ${msg.slice(0, 80)}`);
        if (consecutiveLoadFailures >= CONSECUTIVE_FAILURES_BEFORE_RELOGIN) {
          const user = process.env.INSTAGRAM_USER;
          const password = process.env.INSTAGRAM_PASSWORD;
          await page.close().catch(() => { });
          if (user && password) {
            crawlLogDiscovery('  -> Sessão provavelmente expirada. Limpando cookies e fazendo login novamente...');
            await client.closeContext();
            await client.clearAuthStateFile();
            try {
              const loginOk = await loginWithCredentials(client, user, password);
              if (loginOk) {
                crawlLogDiscovery('  -> Login OK. Retomando extração.');
                consecutiveLoadFailures = 0;
              } else {
                crawlLogDiscovery('  -> Login falhou. Continuando com nova página.');
              }
            } catch (loginErr) {
              crawlLogDiscovery(`  -> Erro no re-login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
            }
          } else {
            crawlLogDiscovery('  -> Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env para re-login automático, ou rode npm run login.');
          }
          page = await client.newPage();
          await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
        await humanDelay();
        continue;
      }
      await humanDelay();

      const profileUrl = InstagramClient.profileUrl(handle);
      let followers: number | null = null;
      let minimalProfile: Record<string, unknown> | null = null;
      if (minFollowers > 0) {
        if (excludeBusinessProfiles) {
          const result = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true });
          followers = result.followers;
          minimalProfile = result.minimalProfile;
        } else {
          followers = await getFollowersFromProfile(page, profileUrl, { skipGoto: true });
        }
      }
      if (minFollowers > 0 && (followers == null || followers < minFollowers)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → pulado: abaixo de ${minFollowers} seguidores`);
        processedCount++;
        try {
          await page.goBack({ timeout: 15000 });
          await humanDelay();
        } catch {
          await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
        continue;
      }
      if (excludeBusinessProfiles && minimalProfile != null) {
        const dataUser = minimalProfile?.data != null && typeof minimalProfile.data === 'object'
          ? (minimalProfile.data as Record<string, unknown>).user
          : undefined;
        const entity: Record<string, unknown> = {
          handle,
          username: handle,
          ...(typeof dataUser === 'object' && dataUser != null ? (dataUser as Record<string, unknown>) : {}),
          followers_count: followers ?? 0,
        };
        if (hasRejectedProfileKeyword(entity)) {
          skippedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          try {
            await page.goBack({ timeout: 15000 });
            await humanDelay();
          } catch {
            await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
          }
          continue;
        }
        if (isBusinessFromEntity(entity)) {
          skippedInThisSession.add(handleLower);
          const reason = getBusinessBlockReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: empresa${reason ? ` (${reason})` : ''}`);
          try {
            await page.goBack({ timeout: 15000 });
            await humanDelay();
          } catch {
            await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
          }
          continue;
        }
        if (!qualifiesAsInfluencer(entity, minFollowers)) {
          skippedInThisSession.add(handleLower);
          const diag = getInfluencerRejectionDiagnostic(entity, minFollowers, true);
          const reasonMsg = diag.reason === 'seguidores_abaixo_minimo' && diag.minRequired != null
            ? `seguidores abaixo do mínimo (${diag.followers} < ${diag.minRequired})`
            : diag.reason === 'conta_tipo_desconhecido'
              ? 'tipo de conta não permitido'
              : diag.reason ?? 'filtro';
          crawlLogDiscovery(`@${handle} → pulado: não qualifica (filtro: ${reasonMsg})`);
          try {
            await page.goBack({ timeout: 15000 });
            await humanDelay();
          } catch {
            await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
          }
          continue;
        }
      } else {
        if (hasRejectedProfileKeyword({ handle, username: handle })) {
          skippedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason({ handle, username: handle });
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          try {
            await page.goBack({ timeout: 15000 });
            await humanDelay();
          } catch {
            await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
          }
          continue;
        }
      }

      const ref: DiscoveredProfileRef = { handle, profileUrl, followersFromDiscovery: followers ?? undefined };
      processedCount++;
      try {
        const saved = await onProfileQualified(ref, page);
        if (saved) savedCount++;
        crawlLogDiscovery(`Totais: ${savedCount} salvos, ${processedCount - savedCount} falhas`);
        if (savedCount >= maxProfiles) {
          crawlLogDiscovery(`Limite de ${maxProfiles} perfis atingido.`);
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'RATE_LIMIT_429') {
          const backoffMs = get429BackoffMs();
          const min = Math.round(backoffMs / 60000);
          crawlLogDiscovery(`  -> 429 detectado. Pausa de ${min} min antes de continuar.`);
          await new Promise((r) => setTimeout(r, backoffMs));
          if (shouldAbortRunAfter429()) {
            crawlLogDiscovery('  -> Segundo 429 no mesmo run. Encerrando crawl (volte em ~12h).');
            break;
          }
          consecutiveLoadFailures = 0;
        } else {
          throw err;
        }
      }
      try {
        await page.goBack({ timeout: 15000 });
        await humanDelay();
      } catch {
        await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay();
      }
    }

    if (stoppedDueToBlock) {
      crawlLogDiscovery('Bloqueio (403/429): encerrando esta fase e passando para a próxima (sem esperar backoff).');
      await randomDelay(20000, 40000);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return { saved: savedCount, processed: processedCount, failed: processedCount - savedCount };
}

/**
 * Processa o Explore (https://www.instagram.com/explore/): abre a página, rola para carregar a grade,
 * clica no primeiro post, na página do post clica no perfil do autor, processa o perfil e volta ao Explore.
 * Loop contínuo até atingir limite ou interrupção.
 */
export async function discoverAndProcessByExplore(
  client: InstagramClient,
  maxProfiles: number,
  minFollowers: number,
  existingHandles: Set<string>,
  onProfileQualified: (ref: DiscoveredProfileRef, pageAlreadyOnProfile?: Page) => Promise<boolean>,
  shouldAbort?: () => boolean,
  excludeBusinessProfiles: boolean = true
): Promise<{ saved: number; processed: number; failed: number }> {
  const CONSECUTIVE_FAILURES_BEFORE_RELOGIN = 5;
  const zero = { saved: 0, processed: 0, failed: 0 };
  let page = await client.newPage();
  let savedCount = 0;
  let processedCount = 0;
  let consecutiveLoadFailures = 0;
  try {
    const url = InstagramClient.exploreUrl();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay();

    const currentUrl = page.url();
    const isLoginOrChallenge = currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/');
    if (isLoginOrChallenge) {
      crawlLogDiscovery('Página de login/challenge detectada — sessão expirada ou não logado.');
      const user = process.env.INSTAGRAM_USER;
      const password = process.env.INSTAGRAM_PASSWORD;
      if (user && password) {
        crawlLogDiscovery('Tentando login com credenciais do .env...');
        await page.close().catch(() => { });
        await client.closeContext();
        await client.clearAuthStateFile();
        try {
          const loginOk = await loginWithCredentials(client, user, password);
          if (loginOk) {
            page = await client.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
            const urlAfterLogin = page.url();
            if (urlAfterLogin.includes('/accounts/login/') || urlAfterLogin.includes('/challenge/')) {
              crawlLogDiscovery('Ainda na página de login após tentativa. Verifique usuário/senha no .env.');
              return zero;
            }
          } else {
            crawlLogDiscovery('Login falhou. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
            return zero;
          }
        } catch (loginErr) {
          crawlLogDiscovery(`Erro ao fazer login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
          return zero;
        }
      } else {
        crawlLogDiscovery('Rode: npm run login (sessão em data/instagram-auth.json) ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return zero;
      }
    }

    crawlLogDiscovery('Explore: modo infinito — clicando em posts, depois no perfil do autor, até limite ou interrupção.');
    const profileHrefRe = /^\/[^/]+\/?$/;
    const isProfileHref = (h: string) => profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/') && !h.includes('/reel/') && !h.includes('/stories/') && !h.includes('/explore/');
    const authorSelectors = ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]', 'a[href^="/"][href*="/"]'];
    let stoppedDueToBlock = false;
    /** Handles já pulados nesta sessão para não ficar preso no mesmo perfil. */
    const skippedInThisSession = new Set<string>();

    const ensureOnExplore = async (): Promise<boolean> => {
      const u = page.url();
      if (u.includes('/accounts/login/') || u.includes('/challenge/')) return false;
      if (!u.includes('/explore')) {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay();
      }
      return true;
    };

    const scrollExplore = async (): Promise<void> => {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(800, 1600);
    };

    let emptyCount = 0;
    const MAX_EMPTY = 5;
    const MAX_EXPLORE_FAILURES = 3;

    while (true) {
      if (shouldAbort?.()) {
        crawlLogDiscovery('Crawl interrompido pelo usuário.');
        break;
      }
      if (savedCount >= maxProfiles) {
        crawlLogDiscovery(`Limite de ${maxProfiles} perfis atingido.`);
        break;
      }
      if (processedCount > 0 && processedCount - savedCount >= MAX_EXPLORE_FAILURES) {
        crawlLogDiscovery(`Explore: ${MAX_EXPLORE_FAILURES} falhas; passando para o próximo ciclo.`);
        break;
      }

      const onExplore = await ensureOnExplore();
      if (!onExplore) break;

      await randomDelay(1500, 3500);

      let postCount = await page.locator('a[href*="/p/"]').count();
      if (postCount === 0) {
        postCount = await page.locator('article a[href^="/p/"]').count();
      }
      if (postCount === 0) {
        emptyCount++;
        crawlLogDiscovery('Nenhum post visível no Explore; rolando...');
        await scrollExplore();
        if (emptyCount >= MAX_EMPTY) {
          crawlLogDiscovery('Explore continua vazio após várias tentativas. Encerrando.');
          break;
        }
        continue;
      }
      emptyCount = 0;

      const firstPostLink = page.locator('a[href*="/p/"]').first();
      try {
        await firstPostLink.click();
        await page.waitForURL(/instagram\.com\/p\//, { timeout: 20000 });
        consecutiveLoadFailures = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('closed') || msg.includes('Target')) {
          crawlLogDiscovery('Browser fechado, encerrando.');
          break;
        }
        const isBlock = msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || msg.includes('403') || msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('401') || msg.includes('rate limit');
        if (isBlock) {
          record429();
          stoppedDueToBlock = true;
          crawlLogDiscovery('  -> Bloqueio (403/429) detectado. Parando esta fase e passando para a próxima.');
          break;
        }
        consecutiveLoadFailures++;
        crawlLogDiscovery(`  -> Falha ao abrir post: ${msg.slice(0, 80)}`);
        if (consecutiveLoadFailures >= CONSECUTIVE_FAILURES_BEFORE_RELOGIN) {
          const user = process.env.INSTAGRAM_USER;
          const password = process.env.INSTAGRAM_PASSWORD;
          await page.close().catch(() => { });
          if (user && password) {
            crawlLogDiscovery('  -> Limpando sessão e fazendo login novamente...');
            await client.closeContext();
            await client.clearAuthStateFile();
            try {
              const loginOk = await loginWithCredentials(client, user, password);
              if (loginOk) { consecutiveLoadFailures = 0; }
            } catch { }
          }
          page = await client.newPage();
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
        await humanDelay();
        continue;
      }
      await humanDelay();

      let authorHref: string | null = null;
      let authorLinkLocator: import('playwright').Locator | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'attached', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && isProfileHref(h)) {
            authorHref = h;
            authorLinkLocator = el;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!authorHref) {
        try {
          const hrefsAll = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
            nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
          );
          const first = hrefsAll.find((h) => isProfileHref(h));
          if (first) {
            authorHref = first;
            const handleFromHref = first.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
            if (handleFromHref) authorLinkLocator = page.locator(`a[href^="/${handleFromHref}"]`).first();
          }
        } catch { }
      }
      const goBackToExplore = async () => {
        try {
          await page.goBack({ timeout: 15000 });
          await humanDelay();
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
      };
      const goBackTwiceToExplore = async () => {
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
          await humanDelay();
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay();
        }
      };

      if (!authorHref || !authorLinkLocator) {
        crawlLogDiscovery('  Post sem link de perfil; voltando ao Explore.');
        await goBackToExplore();
        continue;
      }

      const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
      if (!handle) {
        await goBackToExplore();
        continue;
      }
      const handleLower = handle.toLowerCase();
      if (skippedInThisSession.has(handleLower)) {
        await goBackToExplore();
        for (let s = 0; s < 4; s++) await scrollExplore();
        continue;
      }
      if (existingHandles.has(handleLower)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → já no storage; voltando ao Explore.`);
        await goBackToExplore();
        for (let s = 0; s < 3; s++) await scrollExplore();
        continue;
      }
      if (isBlocklistedHandle(handle)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → handle bloqueado; voltando ao Explore.`);
        await goBackToExplore();
        for (let s = 0; s < 3; s++) await scrollExplore();
        continue;
      }
      if (containsRejectedKeyword(handle)) {
        skippedInThisSession.add(handleLower);
        const reason = getRejectedKeywordReason({ handle });
        crawlLogDiscovery(`@${handle} → palavra rejeitada; voltando ao Explore.${reason ? ` (${reason})` : ''}`);
        await goBackToExplore();
        for (let s = 0; s < 3; s++) await scrollExplore();
        continue;
      }
      if (isBusinessFromEntity({ handle })) {
        skippedInThisSession.add(handleLower);
        const reason = getBusinessBlockReason({ handle });
        crawlLogDiscovery(`@${handle} → empresa; voltando ao Explore.${reason ? ` (${reason})` : ''}`);
        await goBackToExplore();
        for (let s = 0; s < 3; s++) await scrollExplore();
        continue;
      }

      const profileUrl = InstagramClient.profileUrl(handle);
      const profileUrlRe = /instagram\.com\/[^/]+\/?(\?.*)?$/;
      try {
        await authorLinkLocator.scrollIntoViewIfNeeded();
        await randomDelay(300, 600);
        await authorLinkLocator.click({ force: true, timeout: 15000 });
        await page.waitForURL(profileUrlRe, { timeout: 20000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429') || msg.includes('403')) {
          record429();
          stoppedDueToBlock = true;
          crawlLogDiscovery('  -> Bloqueio ao abrir perfil. Parando.');
          break;
        }
        await goBackToExplore();
        continue;
      }
      await humanDelay();

      let followers: number | null = null;
      let minimalProfile: Record<string, unknown> | null = null;
      if (minFollowers > 0) {
        if (excludeBusinessProfiles) {
          const result = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true });
          followers = result.followers;
          minimalProfile = result.minimalProfile;
        } else {
          followers = await getFollowersFromProfile(page, profileUrl, { skipGoto: true });
        }
      }
      if (minFollowers > 0 && (followers == null || followers < minFollowers)) {
        skippedInThisSession.add(handleLower);
        crawlLogDiscovery(`@${handle} → pulado: abaixo de ${minFollowers} seguidores`);
        processedCount++;
        await goBackTwiceToExplore();
        for (let s = 0; s < 3; s++) await scrollExplore();
        continue;
      }
      if (excludeBusinessProfiles && minimalProfile != null) {
        const dataUser = minimalProfile?.data != null && typeof minimalProfile.data === 'object'
          ? (minimalProfile.data as Record<string, unknown>).user
          : undefined;
        const entity: Record<string, unknown> = {
          handle,
          username: handle,
          ...(typeof dataUser === 'object' && dataUser != null ? (dataUser as Record<string, unknown>) : {}),
          followers_count: followers ?? 0,
        };
        if (hasRejectedProfileKeyword(entity)) {
          skippedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          await goBackTwiceToExplore();
          for (let s = 0; s < 3; s++) await scrollExplore();
          continue;
        }
        if (isBusinessFromEntity(entity)) {
          skippedInThisSession.add(handleLower);
          const reason = getBusinessBlockReason(entity);
          crawlLogDiscovery(`@${handle} → pulado: empresa${reason ? ` (${reason})` : ''}`);
          await goBackTwiceToExplore();
          for (let s = 0; s < 3; s++) await scrollExplore();
          continue;
        }
        if (!qualifiesAsInfluencer(entity, minFollowers)) {
          skippedInThisSession.add(handleLower);
          const diag = getInfluencerRejectionDiagnostic(entity, minFollowers, true);
          const reasonMsg = diag.reason === 'seguidores_abaixo_minimo' && diag.minRequired != null
            ? `seguidores abaixo do mínimo (${diag.followers} < ${diag.minRequired})`
            : diag.reason === 'conta_tipo_desconhecido'
              ? 'tipo de conta não permitido'
              : diag.reason ?? 'filtro';
          crawlLogDiscovery(`@${handle} → pulado: não qualifica (filtro: ${reasonMsg})`);
          await goBackTwiceToExplore();
          for (let s = 0; s < 3; s++) await scrollExplore();
          continue;
        }
      } else {
        if (hasRejectedProfileKeyword({ handle, username: handle })) {
          skippedInThisSession.add(handleLower);
          const reason = getRejectedKeywordReason({ handle, username: handle });
          crawlLogDiscovery(`@${handle} → pulado: palavra rejeitada${reason ? ` (${reason})` : ''}`);
          await goBackTwiceToExplore();
          for (let s = 0; s < 3; s++) await scrollExplore();
          continue;
        }
      }

      const ref: DiscoveredProfileRef = { handle, profileUrl, followersFromDiscovery: followers ?? undefined };
      processedCount++;
      try {
        const saved = await onProfileQualified(ref, page);
        if (saved) savedCount++;
        const failures = processedCount - savedCount;
        crawlLogDiscovery(`Totais: ${savedCount} salvos, ${failures} falhas`);
        if (savedCount >= maxProfiles) {
          crawlLogDiscovery(`Limite de ${maxProfiles} perfis atingido.`);
          break;
        }
        if (failures >= MAX_EXPLORE_FAILURES) {
          crawlLogDiscovery(`Explore: ${MAX_EXPLORE_FAILURES} falhas; passando para o próximo ciclo.`);
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'RATE_LIMIT_429') {
          const backoffMs = get429BackoffMs();
          const min = Math.round(backoffMs / 60000);
          crawlLogDiscovery(`  -> 429 detectado. Pausa de ${min} min.`);
          await new Promise((r) => setTimeout(r, backoffMs));
          if (shouldAbortRunAfter429()) {
            crawlLogDiscovery('  -> Segundo 429. Encerrando crawl.');
            break;
          }
          consecutiveLoadFailures = 0;
        } else {
          throw err;
        }
      }
      await goBackTwiceToExplore();
    }

    if (stoppedDueToBlock) {
      crawlLogDiscovery('Bloqueio (403/429): encerrando esta fase e passando para a próxima (sem esperar backoff).');
      await randomDelay(20000, 40000);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return { saved: savedCount, processed: processedCount, failed: processedCount - savedCount };
}

/**
 * Versão que apenas coleta refs (para uso programático).
 * Para crawl com "1 perfil por vez", use discoverAndProcessByHashtag.
 */
export async function discoverProfilesByHashtag(
  client: InstagramClient,
  tag: string,
  maxPosts: number,
  maxProfiles: number,
  minFollowers: number = 0
): Promise<DiscoveredProfileRef[]> {
  const result: DiscoveredProfileRef[] = [];
  await discoverAndProcessByHashtag(
    client,
    tag,
    maxPosts,
    maxProfiles,
    minFollowers,
    new Set<string>(),
    async (ref) => {
      result.push(ref);
      return true;
    }
  );
  return result;
}

/**
 * Descobre perfis por localização (explore/locations/...).
 * Abre a página do local e coleta autores dos posts (até maxPosts).
 */
export async function discoverProfilesByLocation(
  client: InstagramClient,
  locationIdOrSlug: string,
  maxPosts: number
): Promise<DiscoveredProfileRef[]> {
  const page = await client.newPage();
  const seen = new Set<string>();
  const result: DiscoveredProfileRef[] = [];
  try {
    const url = InstagramClient.locationExploreUrl(locationIdOrSlug);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1500, 3000);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(800, 1500);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(800, 1500);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) {
      postLinks = page.locator('a[href*="/p/"]');
      postCount = await postLinks.count();
    }
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    const hrefs: string[] = [];
    for (let i = 0; i < toProcess; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }
    crawlLogDiscovery(`location ${locationIdOrSlug}: ${postCount} links, ${hrefs.length} posts`);

    let postIndex = 0;
    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(600, 1200);

      const authorSelectors = [
        'section a[href^="/"]',
        'header a[href^="/"]',
        '[role="presentation"] a[href^="/"]',
        'a[href^="/"][href*="/"]',
      ];
      let authorHref: string | null = null;
      let lastError = '';
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'attached', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && /^\/[^/]+\/?$/.test(h.replace(/\?.*$/, '')) && !h.includes('/p/')) {
            authorHref = h;
            crawlLogDiscovery(`  seletor ok: ${sel} -> ${h}`);
            break;
          }
          if (h) crawlLogDiscovery(`  seletor ${sel}: href ignorado (nao perfil)`);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          crawlLogDiscovery(`  seletor falhou: ${sel} - ${lastError}`);
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle && !seen.has(handle.toLowerCase())) {
          seen.add(handle.toLowerCase());
          result.push({ handle, profileUrl: InstagramClient.profileUrl(handle) });
          crawlLogDiscovery(`  -> autor: @${handle}`);
        }
      } else {
        crawlLogDiscovery(`  -> nenhum autor: ${lastError || 'href nao passou no regex'}`);
      }
      await randomDelay(600, 1200);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}

/**
 * Descoberta orgânica: abre o feed Explore e coleta autores dos posts sugeridos.
 */
export async function discoverProfilesFromExplore(
  client: InstagramClient,
  maxPosts: number
): Promise<DiscoveredProfileRef[]> {
  const page = await client.newPage();
  const seen = new Set<string>();
  const result: DiscoveredProfileRef[] = [];
  try {
    const url = InstagramClient.exploreUrl();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1200, 2500);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(800, 1500);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(800, 1500);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) postLinks = page.locator('a[href*="/p/"]');
    postCount = await postLinks.count();
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    const hrefs: string[] = [];
    for (let i = 0; i < toProcess; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }
    crawlLogDiscovery(`explore: ${postCount} links, ${hrefs.length} posts para processar`);

    let postIndex = 0;
    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(600, 1200);

      const authorSelectors = ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]', 'a[href^="/"][href*="/"]'];
      let authorHref: string | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'attached', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && /^\/[^/]+\/?$/.test(h.replace(/\?.*$/, '')) && !h.includes('/p/')) {
            authorHref = h;
            break;
          }
        } catch {
          continue;
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle && !seen.has(handle.toLowerCase())) {
          seen.add(handle.toLowerCase());
          result.push({ handle, profileUrl: InstagramClient.profileUrl(handle) });
          crawlLogDiscovery(`  -> autor: @${handle}`);
        }
      }
      await randomDelay(600, 1200);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}
