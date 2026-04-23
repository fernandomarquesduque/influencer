/**
 * Configuração a partir de variáveis de ambiente (Mac/Windows).
 */

export interface CollectorConfig {
  minFollowersToSave: number;
  /** Máximo de seguidores (0 = sem limite). Rejeita perfil com mais que isso. */
  maxFollowersToSave: number;
  minPostLikesToSave: number;
  minPostsWithMinLikesToSave: number;
  maxPostsPerTag: number;
  maxProfiles: number;
  headless: boolean;
  authStatePath: string;
  /** Cookies do Google (evita captcha na próxima vez). */
  googleSessionPath: string;
  excludeBusinessProfiles: boolean;
  /**
   * Exige bio identificável como pt-BR (franc + heurísticas).
   * COLLECTOR_REQUIRE_BIO_PT_BR=false desliga. Bios curtas: ver COLLECTOR_BIO_PT_BR_MIN_USEFUL_CHARS em bioLanguageBr.
   */
  requireBioBrazilianPortuguese: boolean;
  /**
   * Consulta a API (collector-verify-profile) antes de extrair; se o @ já existir no RocksDB, pula.
   * .env: COLLECTOR_SKIP_IF_ALREADY_IN_DB=false desliga o padrão.
   */
  skipIfAlreadyInRemoteDb: boolean;
  /**
   * Tipos de conta Instagram aceitos (account_type: 1=pessoal, 2=criador, 3=empresa).
   * Lista vazia = não filtrar por tipo.
   * .env: COLLECTOR_ALLOWED_ACCOUNT_TYPES=1,2,3 (vazio ou ausente = todos).
   */
  allowedAccountTypes: number[];
  /**
   * Abas do Instagram extraindo em paralelo (Arrobas e fila Google). 1 = um por vez; máx. 16.
   * .env: COLLECTOR_PARALLEL_PROFILE_TABS
   */
  parallelProfileTabs: number;
}

const DEFAULT_MIN_FOLLOWERS = 5000;
/** 0 = sem limite. Padrão 1M para rejeitar mega influenciadores. */
const DEFAULT_MAX_FOLLOWERS = 1_000_000;
const DEFAULT_MIN_POST_LIKES = 200;
const DEFAULT_MIN_POSTS_WITH_LIKES = 4;

function parseAllowedAccountTypesFromEnv(): number[] {
  const raw = process.env.COLLECTOR_ALLOWED_ACCOUNT_TYPES?.trim();
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const n = parseInt(part, 10);
    if (n === 1 || n === 2 || n === 3) out.push(n);
  }
  return [...new Set(out)];
}

export function loadConfig(): CollectorConfig {
  const minFollowersRaw = process.env.MIN_FOLLOWERS?.trim();
  const minFollowersToSave = minFollowersRaw
    ? Math.max(0, parseInt(minFollowersRaw, 10) || DEFAULT_MIN_FOLLOWERS)
    : DEFAULT_MIN_FOLLOWERS;

  const maxFollowersRaw = process.env.MAX_FOLLOWERS?.trim();
  const maxFollowersToSave =
    maxFollowersRaw !== undefined && maxFollowersRaw !== ''
      ? Math.max(0, parseInt(maxFollowersRaw, 10) ?? DEFAULT_MAX_FOLLOWERS)
      : DEFAULT_MAX_FOLLOWERS;

  const minPostLikesToSave =
    parseInt(process.env.MIN_POST_LIKES ?? String(DEFAULT_MIN_POST_LIKES), 10) || DEFAULT_MIN_POST_LIKES;
  const minPostsWithMinLikesToSave =
    parseInt(process.env.MIN_POSTS_WITH_MIN_LIKES ?? String(DEFAULT_MIN_POSTS_WITH_LIKES), 10) ||
    DEFAULT_MIN_POSTS_WITH_LIKES;

  const maxPostsPerTag = parseInt(process.env.MAX_POSTS_PER_TAG ?? '30', 10) || 30;
  const maxProfiles = parseInt(process.env.MAX_PROFILES ?? '19999', 10) || 19999;
  /** Por padrão o browser abre visível (login manual no Instagram). HEADLESS=true para ocultar. */
  const headless = process.env.HEADLESS === 'true';
  const authStatePath = process.env.AUTH_STATE_PATH ?? 'data/instagram-auth.json';
  const googleSessionPath = process.env.GOOGLE_SESSION_PATH ?? 'data/google-session.json';
  const excludeBusinessProfiles = process.env.EXCLUDE_BUSINESS_PROFILES !== 'false';
  const requireBioBrazilianPortuguese =
    process.env.COLLECTOR_REQUIRE_BIO_PT_BR !== 'false';
  const skipDbRaw = process.env.COLLECTOR_SKIP_IF_ALREADY_IN_DB;
  const skipIfAlreadyInRemoteDb =
    skipDbRaw === undefined || String(skipDbRaw).trim() === ''
      ? true
      : String(skipDbRaw).toLowerCase() !== 'false';
  const allowedAccountTypes = parseAllowedAccountTypesFromEnv();
  const parallelRaw = process.env.COLLECTOR_PARALLEL_PROFILE_TABS?.trim();
  const parallelProfileTabs = parallelRaw
    ? Math.max(1, Math.min(16, parseInt(parallelRaw, 10) || 1))
    : 1;

  return {
    minFollowersToSave,
    maxFollowersToSave: maxFollowersToSave > 0 ? maxFollowersToSave : 0,
    minPostLikesToSave,
    minPostsWithMinLikesToSave,
    maxPostsPerTag,
    maxProfiles,
    headless,
    authStatePath,
    googleSessionPath,
    excludeBusinessProfiles,
    requireBioBrazilianPortuguese,
    skipIfAlreadyInRemoteDb,
    allowedAccountTypes,
    parallelProfileTabs,
  };
}

/** Mescla overrides vindos da UI na config base (env). */
export function mergeCollectorConfig(
  base: CollectorConfig,
  overrides: Partial<{
    minFollowersToSave: number;
    maxFollowersToSave: number;
    minPostLikesToSave: number;
    minPostsWithMinLikesToSave: number;
    maxPostsPerTag: number;
    maxProfiles: number;
    excludeBusinessProfiles: boolean;
    requireBioBrazilianPortuguese?: boolean;
    skipIfAlreadyInRemoteDb?: boolean;
    allowedAccountTypes?: number[];
  }>
): CollectorConfig {
  const clamp = (n: number, min: number, max: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min;
  return {
    ...base,
    minFollowersToSave:
      overrides.minFollowersToSave !== undefined
        ? clamp(overrides.minFollowersToSave, 0, 50_000_000)
        : base.minFollowersToSave,
    maxFollowersToSave:
      overrides.maxFollowersToSave !== undefined
        ? clamp(overrides.maxFollowersToSave, 0, 50_000_000)
        : base.maxFollowersToSave,
    minPostLikesToSave:
      overrides.minPostLikesToSave !== undefined
        ? clamp(overrides.minPostLikesToSave, 0, 10_000_000)
        : base.minPostLikesToSave,
    minPostsWithMinLikesToSave:
      overrides.minPostsWithMinLikesToSave !== undefined
        ? clamp(overrides.minPostsWithMinLikesToSave, 1, 100)
        : base.minPostsWithMinLikesToSave,
    maxPostsPerTag:
      overrides.maxPostsPerTag !== undefined
        ? clamp(overrides.maxPostsPerTag, 1, 500)
        : base.maxPostsPerTag,
    maxProfiles:
      overrides.maxProfiles !== undefined
        ? clamp(overrides.maxProfiles, 1, 100_000)
        : base.maxProfiles,
    excludeBusinessProfiles:
      overrides.excludeBusinessProfiles !== undefined
        ? overrides.excludeBusinessProfiles
        : base.excludeBusinessProfiles,
    requireBioBrazilianPortuguese:
      overrides.requireBioBrazilianPortuguese !== undefined
        ? overrides.requireBioBrazilianPortuguese
        : base.requireBioBrazilianPortuguese,
    skipIfAlreadyInRemoteDb:
      overrides.skipIfAlreadyInRemoteDb !== undefined
        ? overrides.skipIfAlreadyInRemoteDb
        : base.skipIfAlreadyInRemoteDb,
    allowedAccountTypes:
      overrides.allowedAccountTypes !== undefined
        ? overrides.allowedAccountTypes.filter((n) => n === 1 || n === 2 || n === 3)
        : base.allowedAccountTypes,
  };
}
