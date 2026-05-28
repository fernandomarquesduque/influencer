/**
 * SQLite (data/influencer.db): profile_activation, projetos, fila, favoritos e índice de busca (FTS5 + aux por handle).
 * Perfis e posts continuam no RocksDB; o índice espelha texto/métricas para busca sem carregar todos os posts no Node.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

/** Filtros LLM espelhados em colunas/JSON do índice (`llm_qualification_json` + `llm_brand_level`). */
export interface GlobalAuxSqlLlmFilter {
  profileTypes: string[];
  mainCategoriesCanonical: string[];
  genders: string[];
  languages: string[];
  audienceTypes: string[];
  toneOfVoices: string[];
  /** Valores normalizados: familia | sensivel | adulto */
  brandSafetyLevels: string[];
  isFamilySafe?: boolean;
  isAdultContent?: boolean;
}

/** Filtros do atalho SQL em `globalAuxSearchHandles` (aux + `profile_activation` + JSON LLM). */
export interface GlobalAuxSqlFilter {
  ftsMatchExpr: string | null;
  minFollowers?: number;
  maxFollowers?: number;
  minEngagementRate?: number;
  minAvgLikes?: number;
  minPostsCount?: number;
  engagementRateBuckets: number[];
  avgLikesBuckets: number[];
  postsCountBuckets: number[];
  accountTypeFilter: number[];
  /** OR de faixas de seguidores; `maxExclusive` null = sem teto. */
  followerRanges?: { min: number; maxExclusive: number | null }[];
  sort: string;
  /** Subconjunto de handles (campanha); null = todos no índice. */
  restrictHandles?: string[] | null;
  excludePrivate?: boolean;
  /** Categorias/hashtags (lowercase); OR — mesmo critério do loop sem `no_perfil`. */
  categoriesAny?: string[] | null;
  /**
   * Exige linha com qualificação LLM indexada. true = descoberta global (só perfis com JSON no aux);
   * false = escopo campanha (handles podem não ter JSON ainda).
   */
  requireIndexedLlm?: boolean;
  /** `activated` = existe linha em profile_activation; `not` = sem linha. */
  activationMode?: 'activated' | 'not' | null;
  citiesLower?: string[] | null;
  statesLower?: string[] | null;
  neighborhoodsLower?: string[] | null;
  socialNetworksLower?: string[] | null;
  contentTypesLower?: string[] | null;
  pricingFeedValues?: number[] | null;
  pricingReelsValues?: number[] | null;
  pricingStoryValues?: number[] | null;
  pricingDestaqueValues?: number[] | null;
  costTiers?: string[] | null;
  llm?: GlobalAuxSqlLlmFilter | null;
  /** positivo | negativo | misto — coluna `llm_post_sentiment` (OR no multiselect). */
  postSentiments?: string[] | null;
}

/** Agregados numéricos de facetas a partir de `profile_search_aux` (sem loop em cada item). */
export interface AuxNumericFacetSums {
  engagement_baixa: number;
  engagement_media: number;
  engagement_alta: number;
  avg_likes_baixa: number;
  avg_likes_media: number;
  avg_likes_alta: number;
  posts_baixa: number;
  posts_media: number;
  posts_alta: number;
  followers_nano: number;
  followers_micro: number;
  followers_medio: number;
  followers_macro: number;
  followers_elite: number;
  followers_celebridade: number;
  account_pessoal: number;
  account_criador: number;
  account_empresa: number;
}

/** Resultado de `aggregateAuxNumericFacetsForHandles` — `auxRowCount` deve bater com o número de handles únicos para os facet counts coincidirem com o loop em memória. */
export interface AuxNumericFacetAggregate {
  sums: AuxNumericFacetSums;
  auxRowCount: number;
}

/** Valores por tipo de conteúdo (4 tipos). */
export interface PricingData {
  feed?: string;
  reels?: string;
  story?: string;
  destaque?: string;
}

/** Dados de ativação do perfil na plataforma (cadastro completo do influenciador). */
export interface ProfileActivationData {
  address?: string;
  /** Número e complemento do endereço (obrigatório quando allow_gifts). */
  address_number?: string;
  /** CEP (apenas números ou formatado). */
  zip_code?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  country?: string;
  /** Autorização para marcas enviarem brindes ao endereço informado. */
  allow_gifts?: boolean;
  whatsapp?: string;
  tiktok?: string;
  facebook?: string;
  linkedin?: string;
  twitter?: string;
  websites?: string;
  gender?: string;
  description?: string;
  about_topics?: string;
  pricing?: PricingData;
  /** Tipos de conteúdo (ex.: fitness, moda, adulto). */
  content_type?: string[];
  /** Público que influencia: classes socioeconômicas (A, B, C, D). */
  influence_audience?: string[];
  /** Faixa etária que influencia (ex.: 18-24, 25-34). */
  influence_age_range?: string[];
  /** Gênero predominante do público (majoritariamente_feminino, majoritariamente_masculino, publico_equilibrado, prefiro_nao_definir). */
  audience_gender?: string;
  /** Marcas com as quais já trabalhou (texto livre, opcional). */
  brands_worked_with?: string;
  activated_at?: string;
  updated_at: string;
}

export class SqliteSync {
  private db: Database.Database;
  private upsertActivation: Database.Statement;
  private getActivationStmt: Database.Statement;

  constructor(dbPath: string = process.env.SQLITE_DB_PATH ?? DEFAULT_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
    this.upsertActivation = this.db.prepare(`
      INSERT INTO profile_activation (
        profile_handle, address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
        whatsapp, tiktok, facebook, linkedin, twitter, websites,
        gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
        audience_gender, brands_worked_with,
        activated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_handle) DO UPDATE SET
        address = excluded.address, address_number = excluded.address_number, zip_code = excluded.zip_code, city = excluded.city, state = excluded.state,
        neighborhood = excluded.neighborhood, country = excluded.country, allow_gifts = excluded.allow_gifts,
        whatsapp = excluded.whatsapp, tiktok = excluded.tiktok, facebook = excluded.facebook,
        linkedin = excluded.linkedin, twitter = excluded.twitter, websites = excluded.websites,
        gender = excluded.gender, description = excluded.description,
        about_topics = excluded.about_topics, pricing = excluded.pricing,
        content_type = excluded.content_type, influence_audience = excluded.influence_audience, influence_age_range = excluded.influence_age_range,
        audience_gender = excluded.audience_gender, brands_worked_with = excluded.brands_worked_with,
        activated_at = COALESCE(excluded.activated_at, activated_at), updated_at = excluded.updated_at
    `);
    this.getActivationStmt = this.db.prepare(`
      SELECT address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
             whatsapp, tiktok, facebook, linkedin, twitter, websites,
             gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
             audience_gender, brands_worked_with,
             activated_at, updated_at
      FROM profile_activation WHERE profile_handle = ?
    `);
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS post; DROP TABLE IF EXISTS profiles; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        client_name TEXT,
        budget_min REAL,
        budget_max REAL,
        category TEXT,
        requirements TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS project_application (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id),
        profile_handle TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, profile_handle)
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_activation (
        profile_handle TEXT PRIMARY KEY,
        address TEXT,
        zip_code TEXT,
        city TEXT,
        state TEXT,
        neighborhood TEXT,
        country TEXT,
        allow_gifts TEXT,
        whatsapp TEXT,
        tiktok TEXT,
        facebook TEXT,
        linkedin TEXT,
        twitter TEXT,
        websites TEXT,
        gender TEXT,
        description TEXT,
        about_topics TEXT,
        pricing TEXT,
        content_type TEXT,
        activated_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS direct_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_handle TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        /** Momento a partir do qual o worker pode enviar (ISO). */
        scheduled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_direct_queue_status ON direct_queue(status);
      CREATE TABLE IF NOT EXISTS user_favorite (
        user_id INTEGER NOT NULL,
        profile_handle TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, profile_handle)
      );
      CREATE INDEX IF NOT EXISTS idx_user_favorite_user ON user_favorite(user_id);
      CREATE TABLE IF NOT EXISTS user_favorite_post (
        user_id INTEGER NOT NULL,
        post_key TEXT NOT NULL,
        profile_handle TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, post_key)
      );
      CREATE INDEX IF NOT EXISTS idx_user_favorite_post_user ON user_favorite_post(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_favorite_post_handle ON user_favorite_post(user_id, profile_handle);
    `);
    this.migrateActivationColumns();
    this.migrateMessageTemplatesRejectHashes();
    this.migrateMessageTemplatesSendDelay();
    this.migrateDirectQueueColumns();
    this.migrateUserFavoriteCampaignId();
    this.ensureProfileSearchIndexTables();
  }

  /** FTS5 + metadados para busca textual sem carregar todos os posts no heap do Node. */
  private ensureProfileSearchIndexTables(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS profile_search_fts USING fts5(
        handle UNINDEXED,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS profile_search_aux (
        handle TEXT PRIMARY KEY,
        engagement_json TEXT NOT NULL,
        hashtags_json TEXT NOT NULL,
        search_blob TEXT NOT NULL
      );
    `);
    this.migrateProfileSearchAuxMetrics();
  }

  /**
   * Colunas denormalizadas (seguidores, engajamento, etc.) para filtros/índices sem parsear JSON em toda linha.
   * Backfill a partir de `engagement_json` para linhas antigas.
   */
  private migrateProfileSearchAuxMetrics(): void {
    const tryAdd = (sql: string): void => {
      try {
        this.db.exec(sql);
      } catch {
        /* coluna já existe */
      }
    };
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN engagement_rate REAL NOT NULL DEFAULT 0');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN avg_likes INTEGER NOT NULL DEFAULT 0');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN posts_count INTEGER NOT NULL DEFAULT 0');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN account_type INTEGER');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN categories_json TEXT NOT NULL DEFAULT \'[]\'');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN cost_tier TEXT');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN llm_qualification_json TEXT');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN llm_brand_level TEXT');
    tryAdd('ALTER TABLE profile_search_aux ADD COLUMN llm_post_sentiment TEXT');
    tryAdd("ALTER TABLE profile_search_aux ADD COLUMN identity_blob TEXT NOT NULL DEFAULT ''");
    try {
      this.db.exec(`
        UPDATE profile_search_aux SET
          engagement_rate = COALESCE(CAST(json_extract(engagement_json, '$.engagement_rate') AS REAL), engagement_rate, 0),
          avg_likes = COALESCE(CAST(json_extract(engagement_json, '$.avg_likes') AS INTEGER), avg_likes, 0),
          posts_count = COALESCE(CAST(json_extract(engagement_json, '$.posts_count') AS INTEGER), posts_count, 0)
        WHERE engagement_json IS NOT NULL AND trim(engagement_json) != '' AND engagement_json != '{}'
      `);
    } catch (e) {
      console.warn('[sqlite] profile_search_aux backfill métricas:', e instanceof Error ? e.message : e);
    }
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_followers ON profile_search_aux(followers_count);
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_engagement ON profile_search_aux(engagement_rate);
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_avg_likes ON profile_search_aux(avg_likes);
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_posts ON profile_search_aux(posts_count);
      `);
    } catch (e) {
      console.warn('[sqlite] profile_search_aux índices:', e instanceof Error ? e.message : e);
    }
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_cost_tier ON profile_search_aux(cost_tier);
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_llm_brand ON profile_search_aux(llm_brand_level);
        CREATE INDEX IF NOT EXISTS idx_profile_search_aux_private ON profile_search_aux(is_private);
      `);
    } catch (e) {
      console.warn('[sqlite] profile_search_aux índices estendidos:', e instanceof Error ? e.message : e);
    }
  }

  /** Substitui documento FTS + linha auxiliar (transação). */
  upsertProfileSearchIndex(
    handle: string,
    ftsContent: string,
    engagementJson: string,
    hashtagsJson: string,
    searchBlob: string,
    identityBlob: string,
    metrics?: {
      followersCount: number;
      engagementRate: number;
      avgLikes: number;
      postsCount: number;
      accountType: number | null;
      isPrivate?: boolean;
      categoriesJson?: string;
      costTier?: string | null;
      llmQualificationJson?: string | null;
      llmBrandLevel?: string | null;
      llmPostSentiment?: string | null;
    }
  ): void {
    const h = handle.toLowerCase().replace(/^@/, '');
    const fc = Math.max(0, Math.floor(metrics?.followersCount ?? 0));
    const er = Number.isFinite(metrics?.engagementRate) ? Number(metrics!.engagementRate) : 0;
    const al = Math.max(0, Math.floor(metrics?.avgLikes ?? 0));
    const pc = Math.max(0, Math.floor(metrics?.postsCount ?? 0));
    const at =
      metrics?.accountType != null && [1, 2, 3].includes(metrics.accountType) ? metrics.accountType : null;
    const isPrivate = metrics?.isPrivate === true ? 1 : 0;
    const categoriesJson =
      typeof metrics?.categoriesJson === 'string' && metrics.categoriesJson.trim() ? metrics.categoriesJson : '[]';
    const costTier =
      metrics?.costTier != null && typeof metrics.costTier === 'string' && metrics.costTier.trim()
        ? metrics.costTier.trim().toLowerCase()
        : null;
    const llmQ = metrics?.llmQualificationJson?.trim() ? metrics.llmQualificationJson : null;
    const llmBrand =
      metrics?.llmBrandLevel != null && typeof metrics.llmBrandLevel === 'string' && metrics.llmBrandLevel.trim()
        ? metrics.llmBrandLevel.trim().toLowerCase()
        : null;
    const llmPostSent =
      metrics?.llmPostSentiment != null && typeof metrics.llmPostSentiment === 'string' && metrics.llmPostSentiment.trim()
        ? metrics.llmPostSentiment.trim().toLowerCase()
        : null;
    const delFts = this.db.prepare('DELETE FROM profile_search_fts WHERE handle = ?');
    const insFts = this.db.prepare('INSERT INTO profile_search_fts (handle, content) VALUES (?, ?)');
    const upsertAux = this.db.prepare(`
      INSERT INTO profile_search_aux (
        handle, engagement_json, hashtags_json, search_blob, identity_blob,
        followers_count, engagement_rate, avg_likes, posts_count, account_type,
        is_private, categories_json, cost_tier, llm_qualification_json, llm_brand_level, llm_post_sentiment
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(handle) DO UPDATE SET
        engagement_json = excluded.engagement_json,
        hashtags_json = excluded.hashtags_json,
        search_blob = excluded.search_blob,
        identity_blob = excluded.identity_blob,
        followers_count = excluded.followers_count,
        engagement_rate = excluded.engagement_rate,
        avg_likes = excluded.avg_likes,
        posts_count = excluded.posts_count,
        account_type = excluded.account_type,
        is_private = excluded.is_private,
        categories_json = excluded.categories_json,
        cost_tier = excluded.cost_tier,
        llm_qualification_json = excluded.llm_qualification_json,
        llm_brand_level = excluded.llm_brand_level,
        llm_post_sentiment = excluded.llm_post_sentiment
    `);
    const trx = this.db.transaction(() => {
      delFts.run(h);
      insFts.run(h, ftsContent);
      upsertAux.run(
        h,
        engagementJson,
        hashtagsJson,
        searchBlob,
        identityBlob,
        fc,
        er,
        al,
        pc,
        at,
        isPrivate,
        categoriesJson,
        costTier,
        llmQ,
        llmBrand,
        llmPostSent
      );
    });
    trx();
  }

  deleteProfileSearchIndex(handle: string): void {
    const h = handle.toLowerCase().replace(/^@/, '');
    this.db.prepare('DELETE FROM profile_search_fts WHERE handle = ?').run(h);
    this.db.prepare('DELETE FROM profile_search_aux WHERE handle = ?').run(h);
  }

  /**
   * Busca por FTS na coluna `content`. bm25 menor = mais relevante.
   * MATCH inválido retorna lista vazia (não propaga erro).
   */
  searchProfileHandlesFts(matchExpr: string, limit: number): { handle: string; bm25: number }[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 100000);
    try {
      const rows = this.db
        .prepare(
          `SELECT handle, bm25(profile_search_fts) AS b
           FROM profile_search_fts
           WHERE profile_search_fts MATCH ?
           ORDER BY b ASC
           LIMIT ?`
        )
        .all(matchExpr, lim) as { handle: string; b: number }[];
      return rows.map((r) => ({ handle: String(r.handle ?? '').toLowerCase().replace(/^@/, ''), bm25: r.b }));
    } catch {
      return [];
    }
  }

  /** Todas as linhas auxiliares (para listagem / facets sem ler o bucket post inteiro). */
  getAllProfileSearchAuxRows(): {
    handle: string;
    engagement_json: string;
    hashtags_json: string;
    search_blob: string;
    followers_count: number;
    engagement_rate: number;
    avg_likes: number;
    posts_count: number;
    account_type: number | null;
    llm_post_sentiment: string | null;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT handle, engagement_json, hashtags_json, search_blob,
                followers_count, engagement_rate, avg_likes, posts_count, account_type, llm_post_sentiment
         FROM profile_search_aux`
      )
      .all() as {
      handle: string;
      engagement_json: string;
      hashtags_json: string;
      search_blob: string;
      followers_count: number | null;
      engagement_rate: number | null;
      avg_likes: number | null;
      posts_count: number | null;
      account_type: number | null;
      llm_post_sentiment: string | null;
    }[];
    return rows.map((r) => ({
      handle: String(r.handle ?? '').toLowerCase().replace(/^@/, ''),
      engagement_json: r.engagement_json ?? '{}',
      hashtags_json: r.hashtags_json ?? '[]',
      search_blob: r.search_blob ?? '',
      followers_count: Math.max(0, Math.floor(Number(r.followers_count) || 0)),
      engagement_rate: Number.isFinite(Number(r.engagement_rate)) ? Number(r.engagement_rate) : 0,
      avg_likes: Math.max(0, Math.floor(Number(r.avg_likes) || 0)),
      posts_count: Math.max(0, Math.floor(Number(r.posts_count) || 0)),
      account_type:
        r.account_type != null && [1, 2, 3].includes(Number(r.account_type)) ? Number(r.account_type) : null,
      llm_post_sentiment:
        r.llm_post_sentiment != null && String(r.llm_post_sentiment).trim()
          ? String(r.llm_post_sentiment).trim().toLowerCase()
          : null,
    }));
  }

  countProfileSearchAuxRows(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM profile_search_aux').get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /** Limite de handles retornados pelo atalho SQL (alinhado ao FTS). */
  static readonly GLOBAL_AUX_SQL_HANDLE_CAP = 50_000;

  /**
   * Filtros na busca global: `profile_search_aux` + opcional `profile_activation` + FTS.
   */
  globalAuxSearchHandles(filter: GlobalAuxSqlFilter): { handles: string[]; total: number } {
    const cap = SqliteSync.GLOBAL_AUX_SQL_HANDLE_CAP;
    const whereParts: string[] = ['1=1'];
    const params: unknown[] = [];

    const needsPa =
      filter.activationMode != null ||
      (filter.citiesLower != null && filter.citiesLower.length > 0) ||
      (filter.statesLower != null && filter.statesLower.length > 0) ||
      (filter.neighborhoodsLower != null && filter.neighborhoodsLower.length > 0) ||
      (filter.socialNetworksLower != null && filter.socialNetworksLower.length > 0) ||
      (filter.contentTypesLower != null && filter.contentTypesLower.length > 0) ||
      (filter.pricingFeedValues?.length ?? 0) > 0 ||
      (filter.pricingReelsValues?.length ?? 0) > 0 ||
      (filter.pricingStoryValues?.length ?? 0) > 0 ||
      (filter.pricingDestaqueValues?.length ?? 0) > 0;
    const joinPa = needsPa ? ' LEFT JOIN profile_activation pa ON pa.profile_handle = a.handle' : '';

    if (filter.restrictHandles != null && filter.restrictHandles.length > 0) {
      const uniq = [
        ...new Set(
          filter.restrictHandles.map((h) => String(h).toLowerCase().replace(/^@/, '')).filter(Boolean)
        ),
      ];
      if (uniq.length > 0) {
        const ph = uniq.map(() => '?').join(', ');
        whereParts.push(`a.handle IN (${ph})`);
        for (const h of uniq) params.push(h);
      }
    }

    if (filter.excludePrivate === true) {
      whereParts.push('a.is_private = 0');
    }

    if (filter.requireIndexedLlm === true) {
      whereParts.push(
        "json_valid(a.llm_qualification_json) AND a.llm_qualification_json IS NOT NULL AND length(trim(a.llm_qualification_json)) > 2"
      );
    }

    if (filter.categoriesAny != null && filter.categoriesAny.length > 0) {
      const ph = filter.categoriesAny.map(() => '?').join(', ');
      whereParts.push(
        `EXISTS (SELECT 1 FROM json_each(a.categories_json) jc WHERE lower(trim(jc.value)) IN (${ph}))`
      );
      for (const c of filter.categoriesAny) params.push(String(c).toLowerCase().trim());
    }

    if (filter.costTiers != null && filter.costTiers.length > 0) {
      const ph = filter.costTiers.map(() => '?').join(', ');
      whereParts.push(`a.cost_tier IN (${ph})`);
      for (const t of filter.costTiers) params.push(String(t).toLowerCase().trim());
    }

    if (filter.activationMode === 'activated') {
      whereParts.push('pa.profile_handle IS NOT NULL');
    } else if (filter.activationMode === 'not') {
      whereParts.push('pa.profile_handle IS NULL');
    }

    if (filter.citiesLower != null && filter.citiesLower.length > 0) {
      const ph = filter.citiesLower.map(() => '?').join(', ');
      whereParts.push(
        `pa.city IS NOT NULL AND trim(pa.city) != '' AND lower(trim(pa.city)) IN (${ph})`
      );
      for (const c of filter.citiesLower) params.push(c);
    }
    if (filter.statesLower != null && filter.statesLower.length > 0) {
      const ph = filter.statesLower.map(() => '?').join(', ');
      whereParts.push(
        `pa.state IS NOT NULL AND trim(pa.state) != '' AND lower(trim(pa.state)) IN (${ph})`
      );
      for (const s of filter.statesLower) params.push(s);
    }
    if (filter.neighborhoodsLower != null && filter.neighborhoodsLower.length > 0) {
      const nhParts: string[] = [];
      for (const nb of filter.neighborhoodsLower) {
        nhParts.push(
          `(pa.neighborhood IS NOT NULL AND instr(',' || lower(replace(replace(trim(pa.neighborhood), ', ', ','), ' ', '')) || ',', ',' || ? || ',') > 0)`
        );
        params.push(nb.replace(/\s+/g, '').toLowerCase());
      }
      whereParts.push(`(${nhParts.join(' OR ')})`);
    }

    if (filter.socialNetworksLower != null && filter.socialNetworksLower.length > 0) {
      const snParts: string[] = [];
      for (const net of filter.socialNetworksLower) {
        const n = net.toLowerCase();
        if (n === 'whatsapp') snParts.push("(pa.whatsapp IS NOT NULL AND trim(pa.whatsapp) != '')");
        else if (n === 'tiktok') snParts.push("(pa.tiktok IS NOT NULL AND trim(pa.tiktok) != '')");
        else if (n === 'facebook') snParts.push("(pa.facebook IS NOT NULL AND trim(pa.facebook) != '')");
        else if (n === 'linkedin') snParts.push("(pa.linkedin IS NOT NULL AND trim(pa.linkedin) != '')");
        else if (n === 'twitter') snParts.push("(pa.twitter IS NOT NULL AND trim(pa.twitter) != '')");
      }
      if (snParts.length > 0) whereParts.push(`(${snParts.join(' OR ')})`);
    }

    if (filter.contentTypesLower != null && filter.contentTypesLower.length > 0) {
      const ph = filter.contentTypesLower.map(() => '?').join(', ');
      whereParts.push(
        `(json_valid(pa.content_type) AND EXISTS (SELECT 1 FROM json_each(pa.content_type) jct WHERE lower(trim(jct.value)) IN (${ph})))`
      );
      for (const c of filter.contentTypesLower) params.push(c);
    }

    const addPricingCol = (vals: number[] | null | undefined, jsonKey: string): void => {
      if (vals == null || vals.length === 0) return;
      const ph = vals.map(() => '?').join(', ');
      whereParts.push(
        `(json_valid(pa.pricing) AND CAST(json_extract(pa.pricing, '$.${jsonKey}') AS REAL) IN (${ph}))`
      );
      for (const v of vals) params.push(v);
    };
    addPricingCol(filter.pricingFeedValues, 'feed');
    addPricingCol(filter.pricingReelsValues, 'reels');
    addPricingCol(filter.pricingStoryValues, 'story');
    addPricingCol(filter.pricingDestaqueValues, 'destaque');

    const L = filter.llm;
    if (L) {
      whereParts.push(
        'json_valid(a.llm_qualification_json) AND a.llm_qualification_json IS NOT NULL'
      );
      if (L.profileTypes.length > 0) {
        const ph = L.profileTypes.map(() => '?').join(', ');
        whereParts.push(`lower(trim(json_extract(a.llm_qualification_json, '$.profileType'))) IN (${ph})`);
        for (const p of L.profileTypes) params.push(p);
      }
      if (L.mainCategoriesCanonical.length > 0) {
        const ph = L.mainCategoriesCanonical.map(() => '?').join(', ');
        whereParts.push(
          `lower(trim(json_extract(a.llm_qualification_json, '$.mainCategoryCanonical'))) IN (${ph})`
        );
        for (const p of L.mainCategoriesCanonical) params.push(p);
      }
      if (L.genders.length > 0) {
        const ph = L.genders.map(() => '?').join(', ');
        whereParts.push(`lower(trim(json_extract(a.llm_qualification_json, '$.gender'))) IN (${ph})`);
        for (const p of L.genders) params.push(p);
      }
      if (L.languages.length > 0) {
        const ph = L.languages.map(() => '?').join(', ');
        whereParts.push(`lower(trim(json_extract(a.llm_qualification_json, '$.language'))) IN (${ph})`);
        for (const p of L.languages) params.push(p);
      }
      const addLlmArr = (jsonPath: string, selected: string[]): void => {
        if (selected.length === 0) return;
        const ph = selected.map(() => '?').join(', ');
        whereParts.push(
          `EXISTS (SELECT 1 FROM json_each(json_extract(a.llm_qualification_json, '${jsonPath}')) je WHERE lower(trim(je.value)) IN (${ph}))`
        );
        for (const p of selected) params.push(p);
      };
      addLlmArr('$.audienceType', L.audienceTypes);
      addLlmArr('$.toneOfVoice', L.toneOfVoices);
      if (L.brandSafetyLevels.length > 0) {
        const ph = L.brandSafetyLevels.map(() => '?').join(', ');
        whereParts.push(`a.llm_brand_level IN (${ph})`);
        for (const p of L.brandSafetyLevels) params.push(p);
      }
      if (L.isFamilySafe === true) whereParts.push(`a.llm_brand_level = 'familia'`);
      else if (L.isFamilySafe === false) whereParts.push(`(a.llm_brand_level IN ('sensivel', 'adulto'))`);
      if (L.isAdultContent === true) whereParts.push(`a.llm_brand_level = 'adulto'`);
      else if (L.isAdultContent === false) whereParts.push(`(a.llm_brand_level IN ('familia', 'sensivel'))`);
    }

    if (filter.postSentiments != null && filter.postSentiments.length > 0) {
      const ph = filter.postSentiments.map(() => '?').join(', ');
      whereParts.push(`a.llm_post_sentiment IN (${ph})`);
      for (const p of filter.postSentiments) params.push(p);
    }

    if (filter.minFollowers != null) {
      whereParts.push('a.followers_count >= ?');
      params.push(Math.floor(filter.minFollowers));
    }
    if (filter.maxFollowers != null) {
      whereParts.push('a.followers_count <= ?');
      params.push(Math.floor(filter.maxFollowers));
    }

    if (filter.engagementRateBuckets.length > 0) {
      const erOr: string[] = [];
      for (const b of filter.engagementRateBuckets) {
        if (b === 0) erOr.push('(a.engagement_rate < 1)');
        else if (b === 1) erOr.push('(a.engagement_rate >= 1 AND a.engagement_rate < 5)');
        else if (b === 5) erOr.push('(a.engagement_rate >= 5)');
      }
      if (erOr.length > 0) whereParts.push(`(${erOr.join(' OR ')})`);
    } else if (filter.minEngagementRate != null) {
      whereParts.push('a.engagement_rate >= ?');
      params.push(Number(filter.minEngagementRate));
    }

    if (filter.avgLikesBuckets.length > 0) {
      const alOr: string[] = [];
      for (const b of filter.avgLikesBuckets) {
        if (b === 0) alOr.push('(a.avg_likes < 500)');
        else if (b === 500) alOr.push('(a.avg_likes >= 500 AND a.avg_likes < 5000)');
        else if (b === 5000) alOr.push('(a.avg_likes >= 5000)');
      }
      if (alOr.length > 0) whereParts.push(`(${alOr.join(' OR ')})`);
    } else if (filter.minAvgLikes != null) {
      whereParts.push('a.avg_likes >= ?');
      params.push(Math.floor(filter.minAvgLikes));
    }

    if (filter.postsCountBuckets.length > 0) {
      const pcOr: string[] = [];
      for (const b of filter.postsCountBuckets) {
        if (b === 0) pcOr.push('(a.posts_count < 25)');
        else if (b === 25) pcOr.push('(a.posts_count >= 25 AND a.posts_count < 50)');
        else if (b === 50) pcOr.push('(a.posts_count >= 50)');
      }
      if (pcOr.length > 0) whereParts.push(`(${pcOr.join(' OR ')})`);
    } else if (filter.minPostsCount != null) {
      whereParts.push('a.posts_count >= ?');
      params.push(Math.floor(filter.minPostsCount));
    }

    if (filter.accountTypeFilter.length > 0) {
      const ph = filter.accountTypeFilter.map(() => '?').join(', ');
      whereParts.push(`a.account_type IN (${ph})`);
      for (const at of filter.accountTypeFilter) params.push(at);
    }

    if (filter.followerRanges != null && filter.followerRanges.length > 0) {
      const frOr: string[] = [];
      for (const r of filter.followerRanges) {
        if (r.maxExclusive == null) {
          frOr.push('(a.followers_count >= ?)');
          params.push(r.min);
        } else {
          frOr.push('(a.followers_count >= ? AND a.followers_count < ?)');
          params.push(r.min, r.maxExclusive);
        }
      }
      if (frOr.length > 0) whereParts.push(`(${frOr.join(' OR ')})`);
    }

    const whereSql = whereParts.join(' AND ');
    const sort = (filter.sort || 'engagement_desc').toLowerCase();
    const hasFts = Boolean(filter.ftsMatchExpr?.trim());

    const orderBy = ((): string => {
      if (hasFts && sort === 'relevance_desc') {
        return 'n.rnk ASC, a.engagement_rate DESC, a.followers_count DESC';
      }
      if (sort === 'engagement_asc') return 'a.engagement_rate ASC, a.followers_count DESC';
      if (sort === 'followers_desc') return 'a.followers_count DESC, a.engagement_rate DESC';
      if (sort === 'followers_asc') return 'a.followers_count ASC, a.engagement_rate DESC';
      if (sort === 'avg_likes_desc') return 'a.avg_likes DESC, a.engagement_rate DESC';
      if (sort === 'avg_likes_asc') return 'a.avg_likes ASC, a.engagement_rate DESC';
      if (sort === 'total_likes_desc') {
        return 'COALESCE(CAST(json_extract(a.engagement_json, \'$.total_likes\') AS INTEGER), 0) DESC, a.engagement_rate DESC';
      }
      if (sort === 'total_likes_asc') {
        return 'COALESCE(CAST(json_extract(a.engagement_json, \'$.total_likes\') AS INTEGER), 0) ASC, a.engagement_rate DESC';
      }
      return 'a.engagement_rate DESC, a.followers_count DESC';
    })();

    let countSql: string;
    let listSql: string;
    const countParams = [...params];
    const listParams = [...params];

    if (hasFts) {
      countSql = `
        WITH fts_n AS (
          SELECT handle, bm25(profile_search_fts) AS rnk
          FROM profile_search_fts
          WHERE profile_search_fts MATCH ?
          ORDER BY rnk ASC
          LIMIT ${cap}
        )
        SELECT COUNT(*) AS c FROM profile_search_aux a
        INNER JOIN fts_n n ON n.handle = a.handle${joinPa}
        WHERE ${whereSql}`;
      countParams.unshift(filter.ftsMatchExpr!);

      listSql = `
        WITH fts_n AS (
          SELECT handle, bm25(profile_search_fts) AS rnk
          FROM profile_search_fts
          WHERE profile_search_fts MATCH ?
          ORDER BY rnk ASC
          LIMIT ${cap}
        )
        SELECT a.handle FROM profile_search_aux a
        INNER JOIN fts_n n ON n.handle = a.handle${joinPa}
        WHERE ${whereSql}
        ORDER BY ${orderBy}`;
      listParams.unshift(filter.ftsMatchExpr!);
    } else {
      countSql = `SELECT COUNT(*) AS c FROM profile_search_aux a${joinPa} WHERE ${whereSql}`;
      listSql = `SELECT a.handle FROM profile_search_aux a${joinPa} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${cap}`;
    }

    try {
      const totalRow = this.db.prepare(countSql).get(...countParams) as { c: number } | undefined;
      const total = Math.max(0, Math.floor(Number(totalRow?.c ?? 0)));
      const rows = this.db.prepare(listSql).all(...listParams) as { handle: string }[];
      const handles = rows
        .map((r) => String(r.handle ?? '').toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
      return { handles, total };
    } catch (e) {
      console.warn('[sqlite] globalAuxSearchHandles:', e instanceof Error ? e.message : e);
      return { handles: [], total: 0 };
    }
  }

  /** Linhas auxiliares só para os handles informados (evita `SELECT *` em toda a tabela). */
  getProfileSearchAuxRowsForHandles(handles: string[]): {
    handle: string;
    engagement_json: string;
    hashtags_json: string;
    search_blob: string;
    followers_count: number;
    engagement_rate: number;
    avg_likes: number;
    posts_count: number;
    account_type: number | null;
    llm_post_sentiment: string | null;
  }[] {
    if (handles.length === 0) return [];
    const out: {
      handle: string;
      engagement_json: string;
      hashtags_json: string;
      search_blob: string;
      followers_count: number;
      engagement_rate: number;
      avg_likes: number;
      posts_count: number;
      account_type: number | null;
      llm_post_sentiment: string | null;
    }[] = [];
    const chunk = 400;
    const selectSql = `SELECT handle, engagement_json, hashtags_json, search_blob,
        followers_count, engagement_rate, avg_likes, posts_count, account_type, llm_post_sentiment
      FROM profile_search_aux WHERE handle IN (`;
    for (let i = 0; i < handles.length; i += chunk) {
      const slice = handles.slice(i, i + chunk).map((h) => h.toLowerCase().replace(/^@/, ''));
      const ph = slice.map(() => '?').join(', ');
      const sql = `${selectSql}${ph})`;
      const rows = this.db.prepare(sql).all(...slice) as {
        handle: string;
        engagement_json: string;
        hashtags_json: string;
        search_blob: string;
        followers_count: number | null;
        engagement_rate: number | null;
        avg_likes: number | null;
        posts_count: number | null;
        account_type: number | null;
        llm_post_sentiment: string | null;
      }[];
      for (const r of rows) {
        out.push({
          handle: String(r.handle ?? '').toLowerCase().replace(/^@/, ''),
          engagement_json: r.engagement_json ?? '{}',
          hashtags_json: r.hashtags_json ?? '[]',
          search_blob: r.search_blob ?? '',
          followers_count: Math.max(0, Math.floor(Number(r.followers_count) || 0)),
          engagement_rate: Number.isFinite(Number(r.engagement_rate)) ? Number(r.engagement_rate) : 0,
          avg_likes: Math.max(0, Math.floor(Number(r.avg_likes) || 0)),
          posts_count: Math.max(0, Math.floor(Number(r.posts_count) || 0)),
          account_type:
            r.account_type != null && [1, 2, 3].includes(Number(r.account_type)) ? Number(r.account_type) : null,
          llm_post_sentiment:
            r.llm_post_sentiment != null && String(r.llm_post_sentiment).trim()
              ? String(r.llm_post_sentiment).trim().toLowerCase()
              : null,
        });
      }
    }
    return out;
  }

  /** `posts_per_week` denormalizado em `engagement_json` — evita reler bucket de posts no enrich. */
  getProfilePostsPerWeekForHandles(handles: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (handles.length === 0) return out;
    const chunk = 500;
    for (let i = 0; i < handles.length; i += chunk) {
      const slice = handles.slice(i, i + chunk).map((h) => h.toLowerCase().replace(/^@/, ''));
      const ph = slice.map(() => '?').join(', ');
      const sql = `SELECT handle, engagement_json FROM profile_search_aux WHERE handle IN (${ph})`;
      const rows = this.db.prepare(sql).all(...slice) as { handle: string; engagement_json: string }[];
      for (const r of rows) {
        const h = String(r.handle ?? '').toLowerCase().replace(/^@/, '');
        if (!h) continue;
        try {
          const eng = JSON.parse(r.engagement_json ?? '{}') as { posts_per_week?: unknown };
          const ppw = eng.posts_per_week;
          if (typeof ppw === 'number' && Number.isFinite(ppw) && ppw >= 0) out.set(h, ppw);
        } catch {
          /* ignora JSON inválido */
        }
      }
    }
    return out;
  }

  /** Texto de identidade (handle, nome, bio) para match em post-matches sem ler RocksDB. */
  getProfileIdentityBlobsForHandles(handles: string[]): { handle: string; identity_blob: string }[] {
    if (handles.length === 0) return [];
    const out: { handle: string; identity_blob: string }[] = [];
    const chunk = 500;
    for (let i = 0; i < handles.length; i += chunk) {
      const slice = handles.slice(i, i + chunk).map((h) => h.toLowerCase().replace(/^@/, ''));
      const ph = slice.map(() => '?').join(', ');
      const sql = `SELECT handle, COALESCE(identity_blob, '') AS identity_blob FROM profile_search_aux WHERE handle IN (${ph})`;
      const rows = this.db.prepare(sql).all(...slice) as { handle: string; identity_blob: string }[];
      for (const r of rows) {
        out.push({
          handle: String(r.handle ?? '').toLowerCase().replace(/^@/, ''),
          identity_blob: String(r.identity_blob ?? ''),
        });
      }
    }
    return out;
  }

  /**
   * Soma facetas numéricas (engajamento, likes, posts, porte, tipo de conta) para um conjunto de handles,
   * lendo só `profile_search_aux` — alinhado aos mesmos patamares do loop em `profilesSearch`.
   */
  aggregateAuxNumericFacetsForHandles(handles: string[]): AuxNumericFacetAggregate | null {
    const uniq = [...new Set(handles.map((h) => String(h).toLowerCase().replace(/^@/, '')).filter(Boolean))];
    if (uniq.length === 0) return null;
    const empty = (): AuxNumericFacetSums => ({
      engagement_baixa: 0,
      engagement_media: 0,
      engagement_alta: 0,
      avg_likes_baixa: 0,
      avg_likes_media: 0,
      avg_likes_alta: 0,
      posts_baixa: 0,
      posts_media: 0,
      posts_alta: 0,
      followers_nano: 0,
      followers_micro: 0,
      followers_medio: 0,
      followers_macro: 0,
      followers_elite: 0,
      followers_celebridade: 0,
      account_pessoal: 0,
      account_criador: 0,
      account_empresa: 0,
    });
    const acc = empty();
    let auxRowCount = 0;
    const chunk = 500;
    const sumSql = `
      SELECT
        COUNT(*) AS aux_matched,
        SUM(CASE WHEN COALESCE(engagement_rate, 0) < 1 THEN 1 ELSE 0 END) AS engagement_baixa,
        SUM(CASE WHEN COALESCE(engagement_rate, 0) >= 1 AND COALESCE(engagement_rate, 0) < 5 THEN 1 ELSE 0 END) AS engagement_media,
        SUM(CASE WHEN COALESCE(engagement_rate, 0) >= 5 THEN 1 ELSE 0 END) AS engagement_alta,
        SUM(CASE WHEN COALESCE(avg_likes, 0) < 500 THEN 1 ELSE 0 END) AS avg_likes_baixa,
        SUM(CASE WHEN COALESCE(avg_likes, 0) >= 500 AND COALESCE(avg_likes, 0) < 5000 THEN 1 ELSE 0 END) AS avg_likes_media,
        SUM(CASE WHEN COALESCE(avg_likes, 0) >= 5000 THEN 1 ELSE 0 END) AS avg_likes_alta,
        SUM(CASE WHEN COALESCE(posts_count, 0) < 25 THEN 1 ELSE 0 END) AS posts_baixa,
        SUM(CASE WHEN COALESCE(posts_count, 0) >= 25 AND COALESCE(posts_count, 0) < 50 THEN 1 ELSE 0 END) AS posts_media,
        SUM(CASE WHEN COALESCE(posts_count, 0) >= 50 THEN 1 ELSE 0 END) AS posts_alta,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 0 AND COALESCE(followers_count, 0) < 30000 THEN 1 ELSE 0 END) AS followers_nano,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 30000 AND COALESCE(followers_count, 0) < 100000 THEN 1 ELSE 0 END) AS followers_micro,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 100000 AND COALESCE(followers_count, 0) < 250000 THEN 1 ELSE 0 END) AS followers_medio,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 250000 AND COALESCE(followers_count, 0) < 500000 THEN 1 ELSE 0 END) AS followers_macro,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 500000 AND COALESCE(followers_count, 0) < 1000000 THEN 1 ELSE 0 END) AS followers_elite,
        SUM(CASE WHEN COALESCE(followers_count, 0) >= 1000000 THEN 1 ELSE 0 END) AS followers_celebridade,
        SUM(CASE WHEN account_type = 1 THEN 1 ELSE 0 END) AS account_pessoal,
        SUM(CASE WHEN account_type = 2 THEN 1 ELSE 0 END) AS account_criador,
        SUM(CASE WHEN account_type = 3 THEN 1 ELSE 0 END) AS account_empresa
      FROM profile_search_aux WHERE handle IN (`;
    for (let i = 0; i < uniq.length; i += chunk) {
      const slice = uniq.slice(i, i + chunk);
      const ph = slice.map(() => '?').join(', ');
      try {
        const row = this.db.prepare(`${sumSql}${ph})`).get(...slice) as Record<string, number | null> | undefined;
        if (!row) continue;
        auxRowCount += Math.max(0, Math.floor(Number(row.aux_matched) || 0));
        for (const k of Object.keys(acc) as (keyof AuxNumericFacetSums)[]) {
          const v = row[k];
          acc[k] += Math.max(0, Math.floor(Number(v) || 0));
        }
      } catch (e) {
        console.warn('[sqlite] aggregateAuxNumericFacetsForHandles:', e instanceof Error ? e.message : e);
        return null;
      }
    }
    return { sums: acc, auxRowCount };
  }

  private migrateUserFavoriteCampaignId(): void {
    try {
      this.db.exec('ALTER TABLE user_favorite ADD COLUMN campaign_id TEXT');
    } catch (_) {
      // Coluna já existe
    }
    this.migrateUserFavoriteMultipleCampaigns();
  }

  /** Permite o mesmo influencer em mais de uma campanha: PK (user_id, profile_handle, campaign_id). */
  private migrateUserFavoriteMultipleCampaigns(): void {
    const tableInfo = this.db.prepare("PRAGMA table_info(user_favorite)").all() as { name: string }[];
    const hasCampaignId = tableInfo.some((c) => c.name === 'campaign_id');
    const pkInfo = this.db.prepare("PRAGMA table_info(user_favorite)").all() as { name: string; pk: number }[];
    const pkCols = pkInfo.filter((c) => c.pk > 0).map((c) => c.name).sort();
    if (pkCols.length === 3 && pkCols.includes('campaign_id')) return;
    if (!hasCampaignId) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_favorite_new (
        user_id INTEGER NOT NULL,
        profile_handle TEXT NOT NULL,
        campaign_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, profile_handle, campaign_id)
      );
      INSERT OR IGNORE INTO user_favorite_new (user_id, profile_handle, campaign_id, created_at)
      SELECT user_id, profile_handle, COALESCE(NULLIF(trim(campaign_id), ''), ''), created_at FROM user_favorite;
      DROP TABLE user_favorite;
      ALTER TABLE user_favorite_new RENAME TO user_favorite;
      CREATE INDEX IF NOT EXISTS idx_user_favorite_user ON user_favorite(user_id);
    `);
  }

  private migrateMessageTemplatesRejectHashes(): void {
    try {
      this.db.exec('ALTER TABLE message_templates ADD COLUMN reject_hashes TEXT DEFAULT \'[]\'');
    } catch (_) {
      // Coluna já existe
    }
  }

  private migrateMessageTemplatesSendDelay(): void {
    try {
      this.db.exec('ALTER TABLE message_templates ADD COLUMN send_delay_minutes INTEGER DEFAULT 1');
    } catch (_) {
      // Coluna já existe
    }
  }

  /** Migrações específicas da fila direct_queue (novas colunas). */
  private migrateDirectQueueColumns(): void {
    try {
      this.db.exec('ALTER TABLE direct_queue ADD COLUMN scheduled_at TEXT');
    } catch (_) {
      // Coluna já existe
    }
  }

  private migrateActivationColumns(): void {
    const columns = ['gender', 'description', 'about_topics', 'pricing', 'content_type', 'zip_code', 'allow_gifts', 'address_number', 'influence_audience', 'influence_age_range', 'audience_gender', 'brands_worked_with'] as const;
    for (const col of columns) {
      try {
        this.db.exec(`ALTER TABLE profile_activation ADD COLUMN ${col} TEXT`);
      } catch (_) {
        // Coluna já existe
      }
    }
  }

  private rowToActivation(row: Record<string, unknown>): ProfileActivationData {
    const updated_at = row.updated_at as string;
    let pricing: PricingData | undefined;
    const pricingRaw = row.pricing;
    if (typeof pricingRaw === 'string' && pricingRaw) {
      try {
        pricing = JSON.parse(pricingRaw) as PricingData;
      } catch (_) {
        pricing = undefined;
      }
    }
    let content_type: string[] | undefined;
    const ctRaw = row.content_type;
    if (typeof ctRaw === 'string' && ctRaw) {
      try {
        const arr = JSON.parse(ctRaw);
        content_type = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        content_type = undefined;
      }
    }
    let influence_audience: string[] | undefined;
    const audRaw = row.influence_audience;
    if (typeof audRaw === 'string' && audRaw) {
      try {
        const arr = JSON.parse(audRaw);
        influence_audience = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        influence_audience = undefined;
      }
    }
    let influence_age_range: string[] | undefined;
    const ageRaw = row.influence_age_range;
    if (typeof ageRaw === 'string' && ageRaw) {
      try {
        const arr = JSON.parse(ageRaw);
        influence_age_range = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        influence_age_range = undefined;
      }
    }
    return {
      address: row.address as string | undefined,
      address_number: row.address_number as string | undefined,
      zip_code: row.zip_code as string | undefined,
      city: row.city as string | undefined,
      state: row.state as string | undefined,
      neighborhood: row.neighborhood as string | undefined,
      country: row.country as string | undefined,
      allow_gifts: row.allow_gifts === '1' || row.allow_gifts === 'true',
      whatsapp: row.whatsapp as string | undefined,
      tiktok: row.tiktok as string | undefined,
      facebook: row.facebook as string | undefined,
      linkedin: row.linkedin as string | undefined,
      twitter: row.twitter as string | undefined,
      websites: row.websites as string | undefined,
      gender: row.gender as string | undefined,
      description: row.description as string | undefined,
      about_topics: row.about_topics as string | undefined,
      pricing,
      content_type,
      influence_audience,
      influence_age_range,
      audience_gender: row.audience_gender as string | undefined,
      brands_worked_with: row.brands_worked_with as string | undefined,
      activated_at: row.activated_at as string | undefined,
      updated_at: typeof updated_at === 'string' ? updated_at : new Date().toISOString(),
    };
  }

  getActivation(profileHandle: string): ProfileActivationData | null {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.getActivationStmt.get(handle) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToActivation(row);
  }

  /** Remove os dados de ativação do perfil (LGPD: exclusão de conta). */
  deleteActivation(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    this.db.prepare('DELETE FROM profile_activation WHERE profile_handle = ?').run(handle);
  }

  /** Lista handles favoritados pelo usuário (distintos; um handle pode estar em várias campanhas). */
  getFavoriteHandles(userId: number): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT profile_handle FROM user_favorite WHERE user_id = ?'
    ).all(userId) as { profile_handle: string }[];
    return rows.map((r) => r.profile_handle);
  }

  /** Lista favoritos: um mesmo handle pode aparecer várias vezes (uma por campanha). */
  getFavorites(userId: number): { profile_handle: string; campaign_id: string | null }[] {
    const rows = this.db.prepare(
      'SELECT profile_handle, campaign_id FROM user_favorite WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as { profile_handle: string; campaign_id: string }[];
    return rows.map((r) => ({
      profile_handle: r.profile_handle,
      campaign_id: r.campaign_id && r.campaign_id.trim() !== '' ? r.campaign_id : null,
    }));
  }

  /** Adiciona favorito (idempotente por user+handle+campaign). O mesmo influencer pode estar em várias campanhas. */
  addFavorite(userId: number, profileHandle: string, campaignId?: string | null): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    const cid = campaignId?.trim() ? campaignId.trim() : '';
    this.db.prepare(
      `INSERT INTO user_favorite (user_id, profile_handle, campaign_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, profile_handle, campaign_id) DO NOTHING`
    ).run(userId, handle, cid);
  }

  /** Remove favorito. Se campaignId for informado, remove só essa (handle, campanha); senão remove todas as entradas do handle. */
  removeFavorite(userId: number, profileHandle: string, campaignId?: string | null): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    const cid = campaignId?.trim() ? campaignId.trim() : null;
    if (cid !== null) {
      this.db.prepare('DELETE FROM user_favorite WHERE user_id = ? AND profile_handle = ? AND campaign_id = ?').run(userId, handle, cid);
    } else {
      this.db.prepare('DELETE FROM user_favorite WHERE user_id = ? AND profile_handle = ?').run(userId, handle);
    }
  }

  /** Verifica se o usuário favoritou o handle (em qualquer campanha). */
  isFavorite(userId: number, profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    const row = this.db.prepare(
      'SELECT 1 FROM user_favorite WHERE user_id = ? AND profile_handle = ? LIMIT 1'
    ).get(userId, handle);
    return !!row;
  }

  /** LGPD: remove todos os favoritos do usuário antes de excluir auth_user. */
  deleteAllFavoritesByUserId(userId: number): void {
    this.db.prepare('DELETE FROM user_favorite WHERE user_id = ?').run(userId);
  }

  /** Admin: remove o perfil das listas de favoritos de todos os usuários. */
  deleteAllFavoritesByProfileHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    this.db.prepare('DELETE FROM user_favorite WHERE profile_handle = ?').run(handle);
    this.db.prepare('DELETE FROM user_favorite_post WHERE profile_handle = ?').run(handle);
  }

  /** Lista post_keys favoritados pelo usuário (mais recentes primeiro). */
  getFavoritePosts(userId: number): { post_key: string; profile_handle: string; created_at: string }[] {
    return this.db
      .prepare(
        'SELECT post_key, profile_handle, created_at FROM user_favorite_post WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(userId) as { post_key: string; profile_handle: string; created_at: string }[];
  }

  getFavoritePostKeys(userId: number): string[] {
    const rows = this.db
      .prepare('SELECT post_key FROM user_favorite_post WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as { post_key: string }[];
    return rows.map((r) => r.post_key);
  }

  getFavoritePostCount(userId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM user_favorite_post WHERE user_id = ?')
      .get(userId) as { c: number };
    return row?.c ?? 0;
  }

  /** Quantidade de posts favoritados por perfil (handle normalizado). */
  getFavoritePostCountByProfileHandle(userId: number, profileHandle: string): number {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return 0;
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS c FROM user_favorite_post WHERE user_id = ? AND profile_handle = ?'
      )
      .get(userId, handle) as { c: number };
    return row?.c ?? 0;
  }

  addFavoritePost(userId: number, postKey: string, profileHandle: string): void {
    const key = postKey.trim();
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!key || !handle) return;
    this.db
      .prepare(
        `INSERT INTO user_favorite_post (user_id, post_key, profile_handle) VALUES (?, ?, ?)
         ON CONFLICT(user_id, post_key) DO NOTHING`
      )
      .run(userId, key, handle);
  }

  removeFavoritePost(userId: number, postKey: string): void {
    const key = postKey.trim();
    if (!key) return;
    this.db.prepare('DELETE FROM user_favorite_post WHERE user_id = ? AND post_key = ?').run(userId, key);
  }

  isFavoritePost(userId: number, postKey: string): boolean {
    const key = postKey.trim();
    if (!key) return false;
    const row = this.db
      .prepare('SELECT 1 FROM user_favorite_post WHERE user_id = ? AND post_key = ? LIMIT 1')
      .get(userId, key);
    return !!row;
  }

  deleteAllFavoritePostsByUserId(userId: number): void {
    this.db.prepare('DELETE FROM user_favorite_post WHERE user_id = ?').run(userId);
  }

  /** Remove candidaturas do perfil em projetos (LGPD: exclusão de conta). */
  deleteProjectApplicationsByHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    this.db.prepare('DELETE FROM project_application WHERE profile_handle = ?').run(handle);
  }

  /** Tamanho máximo do IN () por query (evita statement gigante e lentidão no SQLite). */
  private static readonly BATCH_SIZE = 500;

  /** Retorna ativações para vários handles em uma única query (bem mais rápido que N×getActivation). Em lotes para não sobrecarregar o SQLite. */
  getActivationsBatch(handles: string[]): Map<string, ProfileActivationData> {
    const out = new Map<string, ProfileActivationData>();
    if (handles.length === 0) return out;
    const normalized = [...new Set(handles.map((h) => h.toLowerCase().replace(/^@/, '')))];
    for (let i = 0; i < normalized.length; i += SqliteSync.BATCH_SIZE) {
      const chunk = normalized.slice(i, i + SqliteSync.BATCH_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT profile_handle, address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
               whatsapp, tiktok, facebook, linkedin, twitter, websites,
               gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
               audience_gender, brands_worked_with,
               activated_at, updated_at
        FROM profile_activation WHERE profile_handle IN (${placeholders})
      `);
      const rows = stmt.all(...chunk) as Array<Record<string, unknown> & { profile_handle: string }>;
      for (const row of rows) {
        const handle = String(row.profile_handle ?? '').toLowerCase().replace(/^@/, '');
        if (handle) out.set(handle, this.rowToActivation(row));
      }
    }
    return out;
  }

  saveActivation(profileHandle: string, data: Omit<ProfileActivationData, 'updated_at' | 'activated_at'> & { activated_at?: string }): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const updated_at = new Date().toISOString();
    const existing = this.getActivation(handle);
    const activated_at = existing ? (data.activated_at ?? existing.activated_at) : (data.activated_at ?? updated_at);
    const pricingStr = data.pricing != null ? JSON.stringify(data.pricing) : null;
    const contentTypeStr = data.content_type?.length ? JSON.stringify(data.content_type) : null;
    const influenceAudienceStr = data.influence_audience?.length ? JSON.stringify(data.influence_audience) : null;
    const influenceAgeRangeStr = data.influence_age_range?.length ? JSON.stringify(data.influence_age_range) : null;
    this.upsertActivation.run(
      handle,
      data.address ?? null,
      data.address_number ?? null,
      data.zip_code ?? null,
      data.city ?? null,
      data.state ?? null,
      data.neighborhood ?? null,
      data.country ?? null,
      data.allow_gifts === true ? '1' : (data.allow_gifts === false ? '0' : null),
      data.whatsapp ?? null,
      data.tiktok ?? null,
      data.facebook ?? null,
      data.linkedin ?? null,
      data.twitter ?? null,
      data.websites ?? null,
      data.gender ?? null,
      data.description ?? null,
      data.about_topics ?? null,
      pricingStr,
      contentTypeStr,
      influenceAudienceStr,
      influenceAgeRangeStr,
      data.audience_gender ?? null,
      data.brands_worked_with ?? null,
      activated_at ?? null,
      updated_at
    );
  }

  clearAll(): void {
    this.db.exec('DELETE FROM profile_activation;');
    this.db.exec('DELETE FROM project_application;');
    this.db.exec('DELETE FROM project;');
    try {
      this.db.exec('DELETE FROM profile_search_fts;');
    } catch {
      // FTS pode não existir em DB legado
    }
    try {
      this.db.exec('DELETE FROM profile_search_aux;');
    } catch {
      // tabela pode não existir
    }
  }

  /** Projetos para influenciadores (estilo Workana). */
  listProjects(opts?: { status?: string; category?: string; limit?: number; offset?: number }): { total: number; items: ProjectRow[] } {
    const status = opts?.status ?? 'open';
    const category = opts?.category?.trim();
    const limit = Math.min(Math.max(1, opts?.limit ?? 50), 100);
    const offset = Math.max(0, opts?.offset ?? 0);
    let where = 'WHERE status = ?';
    const params: (string | number)[] = [status];
    if (category) {
      where += ' AND (category = ? OR category LIKE ?)';
      params.push(category, `%${category}%`);
    }
    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM project ${where}`).get(...params) as { c: number };
    const total = countRow?.c ?? 0;
    const rows = this.db.prepare(
      `SELECT id, title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at
       FROM project ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as ProjectRow[];
    return { total, items: rows };
  }

  getProjectById(id: number): ProjectRow | null {
    const row = this.db.prepare(
      'SELECT id, title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at FROM project WHERE id = ?'
    ).get(id) as ProjectRow | undefined;
    return row ?? null;
  }

  createProject(data: Omit<ProjectRow, 'id' | 'created_at' | 'updated_at'>): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO project (title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.title,
      data.description,
      data.client_name ?? null,
      data.budget_min ?? null,
      data.budget_max ?? null,
      data.category ?? null,
      data.requirements ?? null,
      data.status ?? 'open',
      now,
      now
    );
    return info.lastInsertRowid as number;
  }

  applyToProject(projectId: number, profileHandle: string, message?: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const now = new Date().toISOString();
    try {
      this.db.prepare(
        'INSERT INTO project_application (project_id, profile_handle, message, created_at) VALUES (?, ?, ?, ?)'
      ).run(projectId, handle, message ?? null, now);
      return true;
    } catch (e) {
      return false; // duplicate or FK
    }
  }

  getProjectApplicationsCount(projectId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM project_application WHERE project_id = ?').get(projectId) as { c: number };
    return row?.c ?? 0;
  }

  hasApplied(projectId: number, profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare('SELECT 1 FROM project_application WHERE project_id = ? AND profile_handle = ?').get(projectId, handle);
    return !!row;
  }

  // ——— Direct em massa: templates e fila ———
  listMessageTemplates(): { id: number; hash: string; body: string; reject_hashes: string[]; created_at: string; send_delay_minutes: number }[] {
    const rows = this.db.prepare(
      'SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, created_at, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates ORDER BY created_at DESC'
    ).all() as { id: number; hash: string; body: string; reject_hashes: string; created_at: string; send_delay_minutes: number }[];
    return rows.map((r) => {
      let arr: string[] = [];
      try {
        arr = JSON.parse(r.reject_hashes || '[]');
        if (!Array.isArray(arr)) arr = [];
      } catch {
        arr = [];
      }
      return { ...r, reject_hashes: arr, send_delay_minutes: r.send_delay_minutes ?? 1 };
    });
  }

  getMessageTemplateByHash(hash: string): { id: number; hash: string; body: string; reject_hashes: string[]; send_delay_minutes: number } | null {
    const row = this.db.prepare('SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates WHERE hash = ?').get(hash.trim()) as { id: number; hash: string; body: string; reject_hashes: string; send_delay_minutes: number } | undefined;
    if (!row) return null;
    let arr: string[] = [];
    try {
      arr = JSON.parse(row.reject_hashes || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    return { ...row, reject_hashes: arr, send_delay_minutes: row.send_delay_minutes ?? 1 };
  }

  getMessageTemplateById(id: number): { id: number; hash: string; body: string; reject_hashes: string[]; send_delay_minutes: number } | null {
    const row = this.db.prepare('SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates WHERE id = ?').get(id) as { id: number; hash: string; body: string; reject_hashes: string; send_delay_minutes: number } | undefined;
    if (!row) return null;
    let arr: string[] = [];
    try {
      arr = JSON.parse(row.reject_hashes || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    return { ...row, reject_hashes: arr, send_delay_minutes: row.send_delay_minutes ?? 1 };
  }

  createMessageTemplate(hash: string, body: string, rejectHashes: string[] = [], sendDelayMinutes: number = 1): number {
    const now = new Date().toISOString();
    const rejectJson = JSON.stringify(rejectHashes.filter(Boolean).map((h) => h.trim()).filter(Boolean));
    const delay = Math.max(1, Math.min(999, Math.floor(sendDelayMinutes)));
    const info = this.db.prepare(
      'INSERT INTO message_templates (hash, body, reject_hashes, created_at, send_delay_minutes) VALUES (?, ?, ?, ?, ?)'
    ).run(hash.trim(), body.trim(), rejectJson, now, delay);
    return info.lastInsertRowid as number;
  }

  updateMessageTemplate(id: number, opts: { body?: string; rejectHashes?: string[]; send_delay_minutes?: number }): boolean {
    const current = this.getMessageTemplateById(id);
    if (!current) return false;
    const body = opts.body !== undefined ? opts.body.trim() : current.body;
    const rejectHashes = opts.rejectHashes !== undefined ? opts.rejectHashes.filter(Boolean).map((h) => h.trim()).filter(Boolean) : current.reject_hashes;
    const rejectJson = JSON.stringify(rejectHashes);
    const delay = opts.send_delay_minutes !== undefined ? Math.max(1, Math.min(999, Math.floor(opts.send_delay_minutes))) : (current.send_delay_minutes ?? 1);
    const info = this.db.prepare('UPDATE message_templates SET body = ?, reject_hashes = ?, send_delay_minutes = ? WHERE id = ?').run(body, rejectJson, delay, id);
    return info.changes > 0;
  }

  /** True se este perfil já recebeu a mensagem com esse hash (status = sent). Não adicionar de novo. */
  hasAlreadyReceivedMessage(profileHandle: string, messageHash: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND message_hash = ? AND status = ? LIMIT 1'
    ).get(handle, messageHash.trim(), 'sent');
    return !!row;
  }

  /** True se já existe QUALQUER item pendente para este perfil (independente do template). */
  private hasPendingForHandle(profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND status = ? LIMIT 1'
    ).get(handle, 'pending');
    return !!row;
  }

  /** True se já existe item pendente para este perfil E este hash (evita duplicar o mesmo template). */
  private hasPendingForHandleAndHash(profileHandle: string, messageHash: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND message_hash = ? AND status = ? LIMIT 1'
    ).get(handle, messageHash.trim(), 'pending');
    return !!row;
  }

  addToDirectQueue(profileHandle: string, messageHash: string, scheduledAt?: string): number {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    // Já recebeu esse hash com sucesso? Não adicionar de novo.
    if (this.hasAlreadyReceivedMessage(handle, messageHash.trim())) return 0;
    // Já existe item pendente para este perfil com ESTE hash? Não duplicar.
    if (this.hasPendingForHandleAndHash(handle, messageHash.trim())) return 0;
    const now = new Date().toISOString();
    const scheduled =
      scheduledAt && typeof scheduledAt === 'string'
        ? new Date(scheduledAt).toISOString()
        : null;
    const info = this.db.prepare(
      'INSERT INTO direct_queue (profile_handle, message_hash, status, created_at, scheduled_at) VALUES (?, ?, ?, ?, ?)'
    ).run(handle, messageHash.trim(), 'pending', now, scheduled);
    return info.lastInsertRowid as number;
  }

  getDirectQueueItemById(id: number): { id: number; profile_handle: string; message_hash: string; status: string; scheduled_at: string | null } | null {
    const row = this.db.prepare(
      'SELECT id, profile_handle, message_hash, status, scheduled_at FROM direct_queue WHERE id = ?'
    ).get(id) as { id: number; profile_handle: string; message_hash: string; status: string; scheduled_at: string | null } | undefined;
    return row ?? null;
  }

  getNextPendingDirectQueueItem(): { id: number; profile_handle: string; message_hash: string; scheduled_at: string | null } | null {
    const nowIso = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT id, profile_handle, message_hash, scheduled_at
       FROM direct_queue
       WHERE status = ?
         AND (scheduled_at IS NULL OR scheduled_at <= ?)
       ORDER BY
         CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END,
         scheduled_at ASC,
         id ASC
       LIMIT 1`
    ).get('pending', nowIso) as { id: number; profile_handle: string; message_hash: string; scheduled_at: string | null } | undefined;
    return row ?? null;
  }

  updateDirectQueueItem(id: number, status: 'sent' | 'failed', error?: string): void {
    const sent_at = new Date().toISOString();
    this.db.prepare(
      'UPDATE direct_queue SET status = ?, sent_at = ?, error = ? WHERE id = ?'
    ).run(status, sent_at, error ?? null, id);
  }

  /** Atualiza um item da fila (message_hash, scheduled_at e/ou status). Se status for enviado, permite editar qualquer item; senão apenas pendentes. Retorna true se atualizou. */
  updatePendingDirectQueueItem(
    id: number,
    opts: { message_hash?: string; scheduled_at?: string | null; status?: 'pending' | 'sent' | 'failed' }
  ): boolean {
    const item = this.getDirectQueueItemById(id);
    if (!item) return false;
    const onlyPending = opts.status === undefined;
    if (onlyPending && item.status !== 'pending') return false;
    const updates: string[] = [];
    const values: unknown[] = [];
    if (opts.message_hash !== undefined && opts.message_hash.trim()) {
      updates.push('message_hash = ?');
      values.push(opts.message_hash.trim());
    }
    if (opts.scheduled_at !== undefined) {
      updates.push('scheduled_at = ?');
      values.push(
        opts.scheduled_at && opts.scheduled_at.trim()
          ? new Date(opts.scheduled_at.trim()).toISOString()
          : null
      );
    }
    if (opts.status !== undefined) {
      updates.push('status = ?');
      values.push(opts.status);
      if (opts.status === 'pending') {
        updates.push('sent_at = ?', 'error = ?');
        values.push(null, null);
      } else if (opts.status === 'sent') {
        updates.push('sent_at = COALESCE(sent_at, ?)', 'error = ?');
        values.push(new Date().toISOString(), null);
      } else if (opts.status === 'failed') {
        updates.push('sent_at = COALESCE(sent_at, ?)');
        values.push(new Date().toISOString());
      }
    }
    if (updates.length === 0) return true;
    values.push(id);
    const whereClause = onlyPending ? ' WHERE id = ? AND status = \'pending\'' : ' WHERE id = ?';
    this.db.prepare(
      `UPDATE direct_queue SET ${updates.join(', ')}${whereClause}`
    ).run(...values);
    return true;
  }

  /** Handles que já receberam a mensagem com o hash (status = sent). Para filtro incluir/excluir no disparo. */
  getHandlesByMessageHash(messageHash: string): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT profile_handle FROM direct_queue WHERE message_hash = ? AND status = ? ORDER BY profile_handle'
    ).all(messageHash.trim(), 'sent') as { profile_handle: string }[];
    return rows.map((r) => r.profile_handle);
  }

  listDirectQueue(opts?: { status?: string; limit?: number; offset?: number }): { total: number; items: DirectQueueRow[] } {
    const status = opts?.status?.trim();
    const limit = Math.min(Math.max(1, opts?.limit ?? 200), 500);
    const offset = Math.max(0, opts?.offset ?? 0);
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM direct_queue ${where}`).get(...params) as { c: number };
    const total = countRow?.c ?? 0;
    const items = this.db.prepare(
      `SELECT id, profile_handle, message_hash, status, sent_at, error, created_at, scheduled_at
       FROM direct_queue ${where}
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END,
         CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END,
         scheduled_at ASC,
         id ASC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as DirectQueueRow[];
    return { total, items };
  }

  /** Remove todos os itens da fila de disparo. Retorna quantidade removida. */
  deleteAllDirectQueue(): number {
    const info = this.db.prepare('DELETE FROM direct_queue').run();
    return info.changes;
  }

  /** LGPD: remove todas as entradas da fila de DM associadas ao handle (exclusão de conta). */
  deleteDirectQueueByHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    if (!handle) return;
    this.db.prepare('DELETE FROM direct_queue WHERE profile_handle = ?').run(handle);
  }

  /** Remove um item da fila por id. Retorna true se removeu. */
  deleteDirectQueueItem(id: number): boolean {
    const info = this.db.prepare('DELETE FROM direct_queue WHERE id = ?').run(id);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export interface DirectQueueRow {
  id: number;
  profile_handle: string;
  message_hash: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  scheduled_at: string | null;
}

export interface ProjectRow {
  id: number;
  title: string;
  description: string;
  client_name: string | null;
  budget_min: number | null;
  budget_max: number | null;
  category: string | null;
  requirements: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
