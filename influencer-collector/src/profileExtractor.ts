/**
 * Extração de perfil e seguidores — interceptação da API GraphQL.
 */

import type { Page } from 'playwright';
import { coletaLog } from './coletaLog.js';
import { collectBioRawText, getFollowersFromEntity, isPrivateFromEntity } from './entityRules.js';

const PROFILE_RESPONSE_URL = /graphql\/query/i;
const TIMEOUT_MS = 25_000;

/** Scripts em string — tsx injeta __name em arrow functions e quebra page.evaluate no browser. */
const EVAL_SCROLL_LAZY = `
  var dyN = Number(dy) || 0;
  function tryScroll(el) {
    if (!el) return false;
    if (el.scrollHeight > el.clientHeight + 40) {
      el.scrollTop += dyN;
      return true;
    }
    return false;
  }
  var main = document.querySelector('main');
  if (tryScroll(main instanceof HTMLElement ? main : null)) return;
  var rMain = document.querySelector('[role="main"]');
  if (tryScroll(rMain instanceof HTMLElement ? rMain : null)) return;
  window.scrollBy(0, dyN);
  document.documentElement.scrollTop += dyN;
  document.body.scrollTop += dyN;
`;

const EVAL_IS_PRIVATE_PAGE = `
  var raw = document.body ? document.body.innerText : '';
  var n = raw.toLowerCase().normalize('NFD').replace(/\\p{M}/gu, '').replace(/\\s+/g, ' ');
  if (n.indexOf('este perfil e privado') !== -1) return true;
  if (n.indexOf('esta conta e privada') !== -1) return true;
  if (n.indexOf('perfil e privado') !== -1) return true;
  if (n.indexOf('conta e privada') !== -1) return true;
  if (n.indexOf('this account is private') !== -1) return true;
  var l = raw.toLowerCase();
  if (l.indexOf('este perfil') !== -1 && l.indexOf('privado') !== -1) return true;
  if (l.indexOf('this account') !== -1 && l.indexOf('private') !== -1) return true;
  return false;
`;

const EVAL_IS_UNAVAILABLE_PAGE = `
  var raw = document.body ? document.body.innerText : '';
  var n = raw.toLowerCase().normalize('NFD').replace(/\\p{M}/gu, '').replace(/\\s+/g, ' ');
  if (n.indexOf('esta pagina nao esta disponivel') !== -1) return true;
  if (n.indexOf("this page isn't available") !== -1 || n.indexOf('this page is not available') !== -1) return true;
  if (n.indexOf('sorry, this page') !== -1 || n.indexOf('sorry this page') !== -1) return true;
  return false;
`;

const EVAL_READ_FOLLOWERS_DOM = `
  function readFollowersLink(a) {
    var txt = a.textContent || '';
    if (!/\\bseguidores\\b/i.test(txt) && !/\\bfollowers?\\b/i.test(txt)) return null;
    var span = a.querySelector('span[title]');
    var t = span && span.getAttribute('title') ? span.getAttribute('title').trim() : '';
    if (!t) return null;
    var numStr = t.replace(/\\s/g, '').replace(/\\./g, '').replace(',', '.');
    var n = parseFloat(numStr);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  var header = document.querySelector('header');
  if (header) {
    var links = header.querySelectorAll('a[role="link"], a[href*="/followers/"]');
    for (var i = 0; i < links.length; i++) {
      var n0 = readFollowersLink(links[i]);
      if (n0 != null) return n0;
    }
  }
  var main = document.querySelector('main');
  if (main) {
    var tops = [];
    var firstSec = main.querySelector('section');
    if (firstSec) tops.push(firstSec);
    var children = Array.from(main.children).slice(0, 5);
    for (var c = 0; c < children.length; c++) {
      if (children[c] !== firstSec) tops.push(children[c]);
    }
    for (var t = 0; t < tops.length; t++) {
      var root = tops[t];
      var walked = 0;
      var alinks = root.querySelectorAll('a[role="link"], a[href*="/followers/"], a._a6hd');
      for (var j = 0; j < alinks.length; j++) {
        if (walked++ > 50) break;
        var n1 = readFollowersLink(alinks[j]);
        if (n1 != null) return n1;
      }
    }
  }
  var secs = Array.from(document.querySelectorAll('body > section')).slice(0, 4);
  for (var s = 0; s < secs.length; s++) {
    var walked2 = 0;
    var alinks2 = secs[s].querySelectorAll('a[role="link"], a._a6hd');
    for (var k = 0; k < alinks2.length; k++) {
      if (walked2++ > 40) break;
      var n2 = readFollowersLink(alinks2[k]);
      if (n2 != null) return n2;
    }
  }
  return null;
`;

const EVAL_PROFILE_HEADER_TEXT = `
  var bits = [];
  var h = document.querySelector('header');
  if (h) bits.push((h.textContent || '').slice(0, 6000));
  var main = document.querySelector('main');
  if (main) {
    var ch = Array.from(main.children).slice(0, 3);
    for (var i = 0; i < ch.length; i++) bits.push((ch[i].textContent || '').slice(0, 4000));
  }
  return bits.join(' ').slice(0, 14000);
`;

/** Respostas GraphQL são grandes; acúmulo ilimitado + várias abas → heap de vários GB. */
const MAX_CAPTURED_GRAPHQL_BODIES = 72;
const MAX_MINIMAL_USER_BODIES = 22;

function pushCapturedGraphqlBody(captured: Record<string, unknown>[], body: Record<string, unknown>): void {
  if (captured.length >= MAX_CAPTURED_GRAPHQL_BODIES) {
    captured.splice(0, captured.length - MAX_CAPTURED_GRAPHQL_BODIES + 1);
  }
  captured.push(body);
}

function pushMinimalUserBody(capturedBodies: Record<string, unknown>[], body: Record<string, unknown>): void {
  if (capturedBodies.length >= MAX_MINIMAL_USER_BODIES) {
    capturedBodies.splice(0, capturedBodies.length - MAX_MINIMAL_USER_BODIES + 1);
  }
  capturedBodies.push(body);
}

/**
 * Rola o feed do perfil para disparar lazy-load (GraphQL).
 * Evita `page.mouse.wheel` (abas em segundo plano). Não percorre todos os `div` do DOM do IG
 * (isso deixava cada passo de scroll na casa de segundos ou minutos).
 */
async function scrollInstagramProfileLazyStep(page: Page, deltaY: number): Promise<void> {
  await page.evaluate(new Function('dy', EVAL_SCROLL_LAZY) as (dy: number) => void, deltaY);
}

function getIn(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') break;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

function hasDataUser(b: Record<string, unknown>): boolean {
  return (
    b?.data != null &&
    typeof b.data === 'object' &&
    (b.data as Record<string, unknown>)?.user != null
  );
}

/** Detalhe gravado em Problemas (seção “Erro (após processamento)”) quando o IG não mostra o perfil. */
export const INSTAGRAM_PROFILE_UNAVAILABLE_DETAIL =
  'Perfil não existe no Instagram ou está indisponível no momento da abertura.';

/** Mesmo texto usado em `runCollectorProfileRules` (regra) ao detectar privado na entidade. */
export const INSTAGRAM_PROFILE_PRIVATE_DETAIL =
  'Perfil privado — não dá para validar posts/seguidores para o filtro do coletor.';

/**
 * Página de perfil privado para visitante que não segue (sem posts na grade; costuma travar timeouts).
 */
export async function isInstagramPrivateProfilePage(page: Page): Promise<boolean> {
  try {
    const hit = await page.evaluate(new Function(EVAL_IS_PRIVATE_PAGE) as () => boolean);
    if (hit) return true;
    return await page
      .getByText(/este perfil.{0,24}privado/i)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Detecta a página “Esta página não está disponível” / “This page isn’t available” após abrir instagram.com/handle/.
 */
export async function isInstagramProfileUnavailablePage(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(new Function(EVAL_IS_UNAVAILABLE_PAGE) as () => boolean);
  } catch {
    return false;
  }
}

function applyMultiplier(num: number, rest: string): number {
  const lower = rest.toLowerCase();
  if (lower.includes('milh') || /m\s/i.test(rest)) return Math.round(num * 1_000_000);
  if (lower.includes('mil') || lower.includes('k')) return Math.round(num * 1000);
  return Math.round(num);
}

function parseFollowersFromText(fullText: string): number | null {
  if (!fullText || fullText.length < 2) return null;
  const compact = fullText.replace(/\s+/g, ' ').trim();
  const tryMatch = (re: RegExp): number | null => {
    const match = compact.match(re);
    if (!match?.[1]) return null;
    const numStr = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numStr);
    if (Number.isNaN(n)) return null;
    return applyMultiplier(n, match[0] ?? '');
  };
  return (
    tryMatch(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores\b/i) ??
    tryMatch(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?\b/i) ??
    /** Alguns layouts colocam o rótulo antes do número. */
    tryMatch(/\bseguidores?\s*[·•:]?\s*(\d[\d.,\s]*)\b/i) ??
    tryMatch(/\bfollowers?\s*[·•:]?\s*(\d[\d.,\s]*)\b/i) ??
    null
  );
}

function parsePlainTitle(title: string | null): number | null {
  if (!title || !title.trim()) return null;
  const numStr = title.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(numStr);
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Layout antigo: a[href*="/followers/"]. Layout novo (2024+): a[role=link] com "N seguidores" e span[title="N"].
 * Evita `locator('main a[role="link"]').filter(...)` — no feed há milhares de links e o Playwright fica minutos em “travado”.
 * Cabeçalho: `header` + só os primeiros links do `main` (topo do perfil).
 */
export async function readFollowersFromDOM(page: Page): Promise<number | null> {
  if (await isInstagramPrivateProfilePage(page)) return null;
  await page.waitForTimeout(450);
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => null);

  const classicTitle = await page
    .locator('a[href*="/followers/"] span[title]')
    .first()
    .getAttribute('title')
    .catch(() => null);
  const classicN = parsePlainTitle(classicTitle);
  if (classicN != null) return classicN;

  /** Só topo do perfil — nunca `querySelectorAll` em todo o `main` (feed = milhares de nós, ~30s). */
  const fromDomJs = await page.evaluate(
    new Function(EVAL_READ_FOLLOWERS_DOM) as () => number | null
  );
  if (fromDomJs != null) return fromDomJs;

  /** textContent só em header + primeiros blocos do main — `innerText` no main inteiro trava o Chrome (~30s). */
  const tinyText = await page.evaluate(new Function(EVAL_PROFILE_HEADER_TEXT) as () => string);
  const fromSnippet = parseFollowersFromText(tinyText.replace(/\s+/g, ' '));
  if (fromSnippet != null) return fromSnippet;

  return null;
}

export interface GetFollowersOptions {
  doNavigate?: () => Promise<void>;
  skipGoto?: boolean;
  /** Só validação rápida: espera mínima, sem scrolls (evita duplicar extração pesada). */
  quickGate?: boolean;
}

/** Entre várias respostas GraphQL com `data.user`, usa a que tiver a bio mais completa (a primeira costuma vir truncada). */
function pickGraphqlBodyWithRichestBio(bodies: Record<string, unknown>[]): Record<string, unknown> | null {
  if (bodies.length === 0) return null;
  let best = bodies[0]!;
  let bestLen = collectBioRawText(best).trim().length;
  for (let i = 1; i < bodies.length; i++) {
    const b = bodies[i]!;
    const n = collectBioRawText(b).trim().length;
    if (n > bestLen) {
      best = b;
      bestLen = n;
    }
  }
  return best;
}

function maxFollowersFromBodies(bodies: Record<string, unknown>[]): number {
  let m = 0;
  for (const b of bodies) {
    const f = getFollowersFromEntity(b);
    if (f > m) m = f;
  }
  return m;
}

export async function getFollowersAndMinimalProfile(
  page: Page,
  profileUrl: string,
  options?: GetFollowersOptions
): Promise<{ followers: number | null; minimalProfile: Record<string, unknown> | null }> {
  const capturedBodies: Record<string, unknown>[] = [];
  const onResponse = async (response: import('playwright').Response) => {
    const url = response.url();
    if (!PROFILE_RESPONSE_URL.test(url) || response.status() >= 400) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (body != null && hasDataUser(body)) pushMinimalUserBody(capturedBodies, body);
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);
  try {
    const finalize = async (): Promise<{
      followers: number | null;
      minimalProfile: Record<string, unknown> | null;
    }> => {
      const minimalProfile = pickGraphqlBodyWithRichestBio(capturedBodies);
      const fromApi = maxFollowersFromBodies(capturedBodies);
      /** Em perfil privado o GraphQL costuma vir com 0 seguidores no payload; ler o DOM dispara esperas longas (main visível etc.). */
      const privateDom = await isInstagramPrivateProfilePage(page);
      let followers: number | null = fromApi > 0 ? fromApi : null;
      /** Gate rápido: não ler DOM pesado aqui (várias abas + feed grande = travamento); `resolveFollowersForEarlyGate` faz uma leitura se precisar. */
      if (followers == null && !privateDom && !options?.quickGate) {
        followers = await readFollowersFromDOM(page);
      }
      return {
        followers: followers != null && followers > 0 ? followers : null,
        minimalProfile,
      };
    };

    if (options?.skipGoto) {
      if (options.quickGate) {
        await page.waitForTimeout(450);
        if (await isInstagramPrivateProfilePage(page)) return finalize();
        return finalize();
      }
      await page.waitForTimeout(400);
      if (await isInstagramPrivateProfilePage(page)) return finalize();
      await page.waitForTimeout(450);
      await scrollInstagramProfileLazyStep(page, 300).catch(() => {});
      await page.waitForTimeout(1100);
      await scrollInstagramProfileLazyStep(page, 350).catch(() => {});
      await page.waitForTimeout(1400);
      await scrollInstagramProfileLazyStep(page, 300).catch(() => {});
      await page.waitForTimeout(1100);
      /* Sem reload: é aba secundária de perfil; reload aqui só atrapalha e não deve afetar a grade. */
      if (capturedBodies.length === 0) {
        await page.waitForTimeout(2000);
        await scrollInstagramProfileLazyStep(page, 500).catch(() => {});
        await page.waitForTimeout(1800);
      }
      return finalize();
    }
    if (options?.doNavigate) {
      await options.doNavigate();
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    if (options?.quickGate) {
      await page.waitForTimeout(700);
      if (await isInstagramPrivateProfilePage(page)) return finalize();
      return finalize();
    }
    await page.waitForTimeout(500);
    if (await isInstagramPrivateProfilePage(page)) return finalize();
    await page.waitForTimeout(1300);
    await scrollInstagramProfileLazyStep(page, 450).catch(() => {});
    await page.waitForTimeout(1400);
    await scrollInstagramProfileLazyStep(page, 400).catch(() => {});
    await page.waitForTimeout(1200);
    return finalize();
  } finally {
    page.off('response', onResponse);
  }
}

const TIMELINE_EDGES_PATHS = [
  'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges',
  'data.xdt_api__v1__feed__timeline__connection.edges',
  'data.feed_user_timeline.edges',
];

function getEdgesFromRaw(raw: unknown): unknown[] {
  if (raw == null || typeof raw !== 'object') return [];
  for (const path of TIMELINE_EDGES_PATHS) {
    const current = getIn(raw, path);
    if (Array.isArray(current)) return current;
  }
  return [];
}

function extractUserFromRaw(raw: Record<string, unknown>): Record<string, unknown> | null {
  const user = getIn(raw, 'data.user');
  if (user != null && typeof user === 'object') return user as Record<string, unknown>;
  const edges = getEdgesFromRaw(raw);
  if (edges.length === 0) return null;
  const first = edges[0];
  if (first == null || typeof first !== 'object') return null;
  const node = (first as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return null;
  const u = (node as Record<string, unknown>).user;
  return u != null && typeof u === 'object' ? (u as Record<string, unknown>) : null;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Constrói um post normalizado com like_count a partir de node da API. */
function nodeToPost(edge: unknown): Record<string, unknown> | null {
  if (edge == null || typeof edge !== 'object') return null;
  const node = (edge as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  const edgeLikedBy = n.edge_liked_by as Record<string, unknown> | undefined;
  const edgePreview = n.edge_media_preview_like as Record<string, unknown> | undefined;
  const likeCount =
    toNum(edgeLikedBy?.count ?? n.like_count) ?? toNum(edgePreview?.count);
  return {
    ...n,
    like_count: likeCount ?? 0,
    metrics: { likes: likeCount ?? 0 },
  };
}

export interface ExtractedProfile {
  profile: Record<string, unknown>;
  posts: Record<string, unknown>[];
}

/**
 * Extrai perfil completo + posts da timeline interceptando respostas GraphQL.
 */
export async function extractProfile(
  page: Page,
  handle: string,
  profileUrl: string,
  options?: { pageAlreadyOnProfile?: boolean }
): Promise<ExtractedProfile | null> {
  const captured: Record<string, unknown>[] = [];
  const onResponse = async (response: import('playwright').Response) => {
    const url = response.url();
    if (!/graphql\/query/i.test(url) || response.status() >= 400) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (body != null && (hasDataUser(body) || getEdgesFromRaw(body).length > 0)) {
        pushCapturedGraphqlBody(captured, body);
      }
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);
  try {
    if (options?.pageAlreadyOnProfile) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await page.waitForTimeout(600);
    if (await isInstagramProfileUnavailablePage(page)) {
      coletaLog(`@${handle}: página indisponível — extração rápida abortada.`);
      return null;
    }
    if (await isInstagramPrivateProfilePage(page)) {
      coletaLog(`@${handle}: perfil privado (página) — extração rápida abortada.`);
      return null;
    }
    for (const body of captured) {
      if (hasDataUser(body) && isPrivateFromEntity(body as Record<string, unknown>)) {
        coletaLog(`@${handle}: perfil privado (GraphQL) — extração rápida abortada.`);
        return null;
      }
    }
    await page.waitForTimeout(2400);
    let profileRaw: Record<string, unknown> | null = null;
    const allPosts: Record<string, unknown>[] = [];
    const seenShortcode = new Set<string>();
    for (const body of captured) {
      if (hasDataUser(body) && profileRaw == null) {
        profileRaw = body;
      }
      const edges = getEdgesFromRaw(body);
      for (const edge of edges) {
        const post = nodeToPost(edge);
        if (!post) continue;
        const code = String(post.shortcode ?? post.code ?? '');
        if (code && !seenShortcode.has(code)) {
          seenShortcode.add(code);
          allPosts.push(post);
        }
      }
    }
    if (!profileRaw) return null;
    const user = extractUserFromRaw(profileRaw);
    const profile: Record<string, unknown> = {
      ...profileRaw,
      handle,
      username: handle,
      ...(user ?? {}),
      _collected_at: new Date().toISOString(),
    };
    return { profile, posts: allPosts };
  } finally {
    page.off('response', onResponse);
  }
}

const REELS_EDGES_PATHS = [
  'data.xdt_api__v1__feed__reels_media_graphql_connection.edges',
  'data.reels_media.edges',
  'data.user.edge_felix_video_timeline.edges',
];

const TAGGED_EDGES_PATHS = [
  'data.xdt_api__v1__usertags__user_id__feed_connection.edges',
  'data.xdt_api__v1__feed__user_tagged_posts_connection.edges',
  'data.user.edge_owner_to_tagged_media.edges',
  'data.user.edge_web_feed_timeline.edges',
];

function getEdgesAtPath(raw: unknown, dotPath: string): unknown[] {
  if (raw == null || typeof raw !== 'object') return [];
  const cur = getIn(raw as Record<string, unknown>, dotPath);
  return Array.isArray(cur) ? cur : [];
}

function bodyWorthCapturing(body: Record<string, unknown>): boolean {
  if (hasDataUser(body)) return true;
  if (getEdgesFromRaw(body).length > 0) return true;
  for (const p of REELS_EDGES_PATHS) {
    if (getEdgesAtPath(body, p).length > 0) return true;
  }
  for (const p of TAGGED_EDGES_PATHS) {
    if (getEdgesAtPath(body, p).length > 0) return true;
  }
  return false;
}

function isReelProductType(node: Record<string, unknown>): boolean {
  const pt = String(node.product_type ?? '').toLowerCase();
  return pt === 'clips' || pt === 'reel' || pt.includes('reel');
}

export interface ExtractedProfileFull {
  profile: Record<string, unknown>;
  /** Nós GraphQL do feed (posts, não reels) */
  feedMedia: Record<string, unknown>[];
  reelMedia: Record<string, unknown>[];
  taggedMedia: Record<string, unknown>[];
  /** Posts da timeline para regras (curtidas mínimas) */
  postsForRules: Record<string, unknown>[];
}

export type ExtractProfileFullOptions = {
  pageAlreadyOnProfile?: boolean;
  /**
   * Logo após abrir o perfil (antes do scroll longo da timeline e de Reels/Marcados).
   * Útil para reprovar por `account_type` assim que o GraphQL trouxer o usuário.
   */
  afterInitialLoad?: (ctx: {
    profile: Record<string, unknown>;
    posts: Record<string, unknown>[];
  }) => Promise<boolean>;
  /**
   * Chamado após scroll da timeline e antes de abrir Reels/Marcados.
   * Se retornar false, a extração para aqui (sem Reels/Marcados).
   */
  afterTimeline?: (ctx: {
    profile: Record<string, unknown>;
    posts: Record<string, unknown>[];
  }) => Promise<boolean>;
};

export type ExtractProfileFullResult =
  | { ok: true; data: ExtractedProfileFull }
  | { ok: false; reason: 'validation' | 'technical' | 'private' | 'unavailable' };

function mergeMissingShallow(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];
    if ((tv === undefined || tv === null) && sv !== undefined && sv !== null) {
      target[k] = sv;
    }
  }
}

/**
 * Une `data.user` de todas as respostas com `hasDataUser` — o primeiro payload costuma vir sem `account_type`
 * e um GraphQL seguinte traz o campo; sem isso a validação de tipo falha só depois de Reels.
 */
function mergeProfileRawFromCaptured(captured: Record<string, unknown>[]): Record<string, unknown> | null {
  const userBodies = captured.filter((b) => hasDataUser(b));
  if (userBodies.length === 0) {
    for (const body of captured) {
      const edges = getEdgesFromRaw(body);
      if (edges.length > 0) {
        const first = edges[0];
        if (first != null && typeof first === 'object') {
          const node = (first as Record<string, unknown>).node;
          const u =
            node != null && typeof node === 'object'
              ? (node as Record<string, unknown>).user
              : null;
          if (u != null && typeof u === 'object') {
            return { data: { user: u } } as Record<string, unknown>;
          }
        }
      }
    }
    return null;
  }
  const firstUser = getIn(userBodies[0], 'data.user');
  if (firstUser == null || typeof firstUser !== 'object') return null;
  const tu = structuredClone(firstUser) as Record<string, unknown>;
  const merged = { data: { user: tu } } as Record<string, unknown>;
  if (userBodies.length > 1) {
    for (let i = 1; i < userBodies.length; i++) {
      const ui = getIn(userBodies[i], 'data.user');
      if (ui != null && typeof ui === 'object') mergeMissingShallow(tu, ui as Record<string, unknown>);
    }
  }
  return merged;
}

/** Perfil + posts só da timeline (respostas já capturadas) — para validar antes de Reels/Marcados. */
function buildTimelineProfileAndPostsFromCaptured(
  captured: Record<string, unknown>[],
  keyHandle: string
): { profile: Record<string, unknown>; posts: Record<string, unknown>[] } | null {
  const profileRaw = mergeProfileRawFromCaptured(captured);
  if (!profileRaw) return null;
  const seenRules = new Set<string>();
  const postsForRules: Record<string, unknown>[] = [];
  for (const body of captured) {
    for (const path of TIMELINE_EDGES_PATHS) {
      for (const edge of getEdgesAtPath(body, path)) {
        if (edge == null || typeof edge !== 'object') continue;
        const p = nodeToPost(edge);
        if (!p) continue;
        const code = String(p.shortcode ?? p.code ?? '');
        if (!code || seenRules.has(code)) continue;
        seenRules.add(code);
        postsForRules.push(p);
      }
    }
  }
  const user = extractUserFromRaw(profileRaw);
  const profile: Record<string, unknown> = {
    ...profileRaw,
    handle: keyHandle,
    username: keyHandle,
    ...(user ?? {}),
    _collected_at: new Date().toISOString(),
  };
  return { profile, posts: postsForRules };
}

/**
 * Extrai perfil + timeline (scroll) + abas Reels e Marcados (GraphQL).
 * Usado para envio completo à API do crawl (métricas / ER no site).
 */
export async function extractProfileFull(
  page: Page,
  handle: string,
  profileUrl: string,
  options?: ExtractProfileFullOptions
): Promise<ExtractProfileFullResult> {
  const keyHandle = handle.replace(/^@/, '').trim().toLowerCase();
  const captured: Record<string, unknown>[] = [];
  const onResponse = async (response: import('playwright').Response) => {
    const url = response.url();
    if (!/graphql\/query/i.test(url) || response.status() >= 400) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (body != null && bodyWorthCapturing(body)) {
        pushCapturedGraphqlBody(captured, body);
      }
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);

  const clickTab = async (index: number): Promise<boolean> => {
    const tabList = page.locator('[role="tablist"]').first();
    if ((await tabList.count()) === 0) return false;
    const links = tabList.locator('a[href]');
    const n = await links.count();
    if (index >= n) return false;
    try {
      await links.nth(index).scrollIntoViewIfNeeded().catch(() => null);
      await links.nth(index).click({ timeout: 8000 });
      await page.waitForTimeout(2600);
      return true;
    } catch {
      return false;
    }
  };

  const clickHrefTab = async (part: string): Promise<boolean> => {
    const selectors = [
      `a[href*="/${keyHandle}/${part}/"]`,
      `a[href*="/${keyHandle}/${part}"]`,
      `a[href*="/${part}/"]`,
    ];
    for (const sel of selectors) {
      const link = page.locator(sel).first();
      if ((await link.count()) === 0) continue;
      try {
        await link.scrollIntoViewIfNeeded().catch(() => null);
        await link.click({ timeout: 8000 });
        await page.waitForTimeout(2600);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  };

  try {
    coletaLog(`@${keyHandle} [full] abrindo perfil + aguardando GraphQL…`);
    if (options?.pageAlreadyOnProfile) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    }
    await page.waitForTimeout(650);
    if (await isInstagramProfileUnavailablePage(page)) {
      coletaLog(`@${keyHandle} [full] página indisponível — abortando (sem scroll).`);
      return { ok: false, reason: 'unavailable' };
    }
    if (await isInstagramPrivateProfilePage(page)) {
      coletaLog(`@${keyHandle} [full] perfil privado (página) — abortando (sem scroll/Reels).`);
      return { ok: false, reason: 'private' };
    }
    const mergedPrivacyCheck = mergeProfileRawFromCaptured(captured);
    if (mergedPrivacyCheck && isPrivateFromEntity(mergedPrivacyCheck as Record<string, unknown>)) {
      coletaLog(`@${keyHandle} [full] perfil privado (GraphQL is_private) — abortando (sem scroll longo).`);
      return { ok: false, reason: 'private' };
    }
    await page.waitForTimeout(2150);

    if (options?.afterInitialLoad) {
      await page.waitForTimeout(1200);
      const rawMerged = mergeProfileRawFromCaptured(captured);
      if (rawMerged) {
        const userEarly = extractUserFromRaw(rawMerged);
        const profileEarly: Record<string, unknown> = {
          ...rawMerged,
          handle: keyHandle,
          username: keyHandle,
          ...(userEarly ?? {}),
        };
        const proceedEarly = await options.afterInitialLoad({ profile: profileEarly, posts: [] });
        if (!proceedEarly) {
          coletaLog(
            `@${keyHandle} [full] validação inicial reprovou (ex.: tipo de conta) — sem scroll longo da timeline nem Reels.`
          );
          return { ok: false, reason: 'validation' };
        }
      }
    }

    coletaLog(`@${keyHandle} [full] rolando timeline (8×) para carregar mais posts…`);
    for (let s = 0; s < 8; s++) {
      await scrollInstagramProfileLazyStep(page, 950);
      await page.waitForTimeout(1300);
    }

    const timelineBuilt = buildTimelineProfileAndPostsFromCaptured(captured, keyHandle);
    if (!timelineBuilt) {
      coletaLog(`@${keyHandle} [full] ERRO: sem dados de usuário após timeline — abortando antes de Reels.`);
      return { ok: false, reason: 'technical' };
    }
    if (options?.afterTimeline) {
      const proceed = await options.afterTimeline({
        profile: timelineBuilt.profile,
        posts: timelineBuilt.posts,
      });
      if (!proceed) {
        coletaLog(`@${keyHandle} [full] validação reprovou — não abre Reels nem Marcados.`);
        return { ok: false, reason: 'validation' };
      }
    }

    let reelsOk = await clickTab(1);
    if (!reelsOk) reelsOk = await clickHrefTab('reels');
    coletaLog(`@${keyHandle} [full] aba Reels ${reelsOk ? 'OK' : 'não achada'} → scroll…`);
    if (reelsOk) {
      for (let s = 0; s < 6; s++) {
        await scrollInstagramProfileLazyStep(page, 900);
        await page.waitForTimeout(1100);
      }
    }

    coletaLog(`@${keyHandle} [full] voltando ao perfil para aba Marcados…`);
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 22000 }).catch(() => null);
    await page.waitForTimeout(2200);

    let taggedOk = await clickTab(3);
    if (!taggedOk) taggedOk = await clickTab(2);
    if (!taggedOk) taggedOk = await clickHrefTab('tagged');
    coletaLog(`@${keyHandle} [full] aba Marcados ${taggedOk ? 'OK' : 'não achada'} → scroll…`);
    if (taggedOk) {
      for (let s = 0; s < 5; s++) {
        await scrollInstagramProfileLazyStep(page, 900);
        await page.waitForTimeout(1100);
      }
    }

    const profileRaw = mergeProfileRawFromCaptured(captured);
    if (!profileRaw) {
      coletaLog(`@${keyHandle} [full] ERRO: nenhum body GraphQL com dados de usuário.`);
      return { ok: false, reason: 'technical' };
    }

    coletaLog(`@${keyHandle} [full] montando listas (${captured.length} respostas GraphQL capturadas)…`);

    const seenFeed = new Set<string>();
    const seenReel = new Set<string>();
    const seenTagged = new Set<string>();
    const feedMedia: Record<string, unknown>[] = [];
    const reelMedia: Record<string, unknown>[] = [];
    const taggedMedia: Record<string, unknown>[] = [];
    const postsForRules: Record<string, unknown>[] = [];
    const seenRules = new Set<string>();

    const pushNode = (
      node: Record<string, unknown>,
      bucket: 'timeline' | 'reelOnly' | 'taggedOnly'
    ): void => {
      const code = String(node.shortcode ?? node.code ?? '');
      if (!code) return;
      if (bucket === 'taggedOnly') {
        if (!seenTagged.has(code)) {
          seenTagged.add(code);
          taggedMedia.push(node);
        }
        return;
      }
      if (bucket === 'reelOnly') {
        if (!seenReel.has(code)) {
          seenReel.add(code);
          reelMedia.push(node);
        }
        return;
      }
      if (!seenRules.has(code)) {
        seenRules.add(code);
        const syntheticEdge = { node };
        const p = nodeToPost(syntheticEdge);
        if (p) postsForRules.push(p);
      }
      if (isReelProductType(node)) {
        if (!seenReel.has(code)) {
          seenReel.add(code);
          reelMedia.push(node);
        }
      } else {
        if (!seenFeed.has(code)) {
          seenFeed.add(code);
          feedMedia.push(node);
        }
      }
    };

    for (const body of captured) {
      for (const path of TIMELINE_EDGES_PATHS) {
        for (const edge of getEdgesAtPath(body, path)) {
          if (edge == null || typeof edge !== 'object') continue;
          const node = (edge as Record<string, unknown>).node;
          if (node != null && typeof node === 'object') {
            pushNode(node as Record<string, unknown>, 'timeline');
          }
        }
      }
      for (const path of REELS_EDGES_PATHS) {
        for (const edge of getEdgesAtPath(body, path)) {
          if (edge == null || typeof edge !== 'object') continue;
          const node = (edge as Record<string, unknown>).node;
          if (node != null && typeof node === 'object') {
            pushNode(node as Record<string, unknown>, 'reelOnly');
          }
        }
      }
      for (const path of TAGGED_EDGES_PATHS) {
        for (const edge of getEdgesAtPath(body, path)) {
          if (edge == null || typeof edge !== 'object') continue;
          const node = (edge as Record<string, unknown>).node;
          if (node != null && typeof node === 'object') {
            pushNode(node as Record<string, unknown>, 'taggedOnly');
          }
        }
      }
    }

    const user = extractUserFromRaw(profileRaw);
    const profile: Record<string, unknown> = {
      ...profileRaw,
      handle: keyHandle,
      username: keyHandle,
      ...(user ?? {}),
      _collected_at: new Date().toISOString(),
    };

    return {
      ok: true,
      data: {
        profile,
        feedMedia,
        reelMedia,
        taggedMedia,
        postsForRules,
      },
    };
  } finally {
    captured.length = 0;
    page.off('response', onResponse);
  }
}
