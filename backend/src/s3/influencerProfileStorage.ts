/**
 * Upload da foto de perfil do influencer para S3 (URL estável).
 * Estrutura: `influencers/<handle>/avatar.<ext>` (prefixo exclusivo por influenciador).
 * Credenciais só via env — nunca commitar chaves.
 *
 * Env:
 * - AWS_ACCESS_KEY_ID ou AWS_ACCESS_KEY
 * - AWS_SECRET_ACCESS_KEY ou AWS_SECRET_KEY
 * - AWS_REGION (default sa-east-1)
 * - AWS_S3_BUCKET ou AWS_BUCKET_NAME (default: influencer)
 * - AWS_S3_PUBLIC_BASE_URL (opcional CDN, sem barra final)
 * - AWS_S3_OBJECT_ACL (opcional, ex. public-read — só se o bucket permitir ACL)
 *
 * Otimização antes do upload (Sharp):
 * - S3_AVATAR_RAW=true — desliga otimização (envia bytes como baixados)
 * - S3_AVATAR_MAX_EDGE — maior lado em px (default 384, min 64, max 2048)
 * - S3_AVATAR_FORMAT — webp (default) | jpeg
 * - S3_AVATAR_WEBP_QUALITY — 40–100 (default 78)
 * - S3_AVATAR_JPEG_QUALITY — 50–100 (default 80)
 *
 * Capas de post: `influencers/<handle>/posts/<id>.webp`
 * - S3_POST_COVER_DISABLE=true — não faz upload de capas (wipe do prefixo influencer continua se habilitado)
 * - S3_INFLUENCER_WIPE_DISABLE=true — não apaga objetos sob `influencers/<handle>/` antes do novo lote
 * - S3_POST_RAW=true — capa sem recompressão Sharp
 * - S3_POST_MAX_EDGE (default 720), S3_POST_FORMAT, S3_POST_WEBP_QUALITY (default 76), S3_POST_JPEG_QUALITY (default 78)
 */

import { existsSync } from 'node:fs';
import { imageSize } from 'image-size';
import sharp from 'sharp';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type BucketLocationConstraint,
  type ObjectCannedACL,
} from '@aws-sdk/client-s3';
import type { Entity } from '../types/index.js';
import type { SlimProfile } from '../utils/slimProfile.js';
import { logMemorySnapshot, memoryDiagS3CoverEvery } from '../utils/memoryDiag.js';

const MIN_BYTES = 2000;
const MIN_SIDE = 64;

const LOG = '[s3:avatar]';
const LOG_POST = '[s3:post]';

const MIN_POST_FETCH_BYTES = 400;

function logInfo(msg: string, extra?: Record<string, unknown>): void {
  if (extra && Object.keys(extra).length > 0) {
    console.log(`${LOG} ${msg}`, extra);
  } else {
    console.log(`${LOG} ${msg}`);
  }
}

function logPost(msg: string, extra?: Record<string, unknown>): void {
  if (extra && Object.keys(extra).length > 0) {
    console.log(`${LOG_POST} ${msg}`, extra);
  } else {
    console.log(`${LOG_POST} ${msg}`);
  }
}

function getEnv(name: string, ...alts: string[]): string | undefined {
  const v = process.env[name];
  if (v && String(v).trim()) return String(v).trim();
  for (const a of alts) {
    const x = process.env[a];
    if (x && String(x).trim()) return String(x).trim();
  }
  return undefined;
}

function isS3Configured(): boolean {
  const key = getEnv('AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY');
  const secret = getEnv('AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY');
  return Boolean(key && secret);
}

/** Uma linha ao subir a API: confirma se o .env do crawl carregou as credenciais. */
export function logS3StartupStatus(opts: { envPath: string; backendRoot: string }): void {
  if (isS3Configured()) {
    const bucket = getBucket();
    logInfo('S3 habilitado nesta API', {
      bucket,
      region: getRegion(),
      envCarregadoDe: opts.envPath,
    });
    if (bucket === 'influencer') {
      console.warn(
        `${LOG} O bucket padrão "influencer" é um nome global raramente disponível. Se o upload falhar com BucketAlreadyExists, defina AWS_S3_BUCKET (ou AWS_BUCKET_NAME) com o nome do SEU bucket (ex.: creait).`,
      );
    }
    return;
  }
  console.warn(
    `${LOG} S3 desligado: sem AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (ou AWS_ACCESS_KEY + AWS_SECRET_KEY).`,
  );
  console.warn(
    `${LOG} Coloque as chaves em: ${opts.envPath} (${existsSync(opts.envPath) ? 'arquivo existe' : 'arquivo não existe'}) · backendRoot=${opts.backendRoot}`,
  );
  console.warn(`${LOG} Dica: o depurador pode usar cwd diferente; o servidor agora lê o .env pela pasta backend, não pelo cwd.`);
}

function getBucket(): string {
  return getEnv('AWS_S3_BUCKET', 'AWS_BUCKET_NAME') || 'influencer';
}

function getRegion(): string {
  return getEnv('AWS_REGION') || 'sa-east-1';
}

function getPublicBaseUrl(): string | undefined {
  const u = getEnv('AWS_S3_PUBLIC_BASE_URL');
  if (!u) return undefined;
  return u.replace(/\/+$/, '');
}

function getOptionalObjectAcl(): ObjectCannedACL | undefined {
  const raw = getEnv('AWS_S3_OBJECT_ACL');
  if (!raw) return undefined;
  const v = raw.toLowerCase().replace(/-/g, '_');
  if (v === 'public_read' || v === 'public-read') return 'public-read';
  if (v === 'private') return 'private';
  return raw as ObjectCannedACL;
}

/** Depois do 1º AccessControlListNotSupported, deixamos de enviar ACL (evita log/retry em todo PutObject). */
let s3BucketAclUnsupported = false;
let loggedS3AclUnsupportedHint = false;

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    const accessKeyId = getEnv('AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY')!;
    const secretAccessKey = getEnv('AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY')!;
    s3Client = new S3Client({
      region: getRegion(),
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3Client;
}

function awsErrorMeta(err: unknown): { name: string; httpStatusCode?: number } {
  if (err == null || typeof err !== 'object') return { name: '' };
  const o = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return {
    name: typeof o.name === 'string' ? o.name : '',
    httpStatusCode: o.$metadata?.httpStatusCode,
  };
}

/**
 * Garante que o bucket existe. Só tenta criar se HeadBucket indicar ausência (404).
 * Nomes como "influencer" costumam já existir na AWS para outra conta — use AWS_S3_BUCKET com nome único (ex.: creait-seuprojeto).
 */
async function ensureBucketExists(bucket: string): Promise<void> {
  const client = getClient();
  const region = getRegion();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (headErr: unknown) {
    const { name, httpStatusCode } = awsErrorMeta(headErr);
    const looksMissing = name === 'NotFound' || httpStatusCode === 404;

    if (!looksMissing) {
      logInfo('HeadBucket falhou — não vamos criar bucket automaticamente', {
        bucket,
        region,
        errorName: name || '(sem name)',
        httpStatusCode: httpStatusCode ?? null,
      });
      const hint =
        name === 'Forbidden' || httpStatusCode === 403
          ? 'Possível nome já usado em outra conta, região errada ou IAM sem s3:ListBucket/s3:GetBucketLocation. Ajuste AWS_S3_BUCKET (nome único) e AWS_REGION.'
          : 'Confira AWS_S3_BUCKET, AWS_REGION e permissões IAM (s3:HeadBucket, s3:PutObject).';
      throw new Error(`${LOG} Sem acesso ao bucket "${bucket}" (${region}). ${hint}`);
    }

    logInfo(`bucket inexistente nesta conta (404), tentando criar…`, { bucket, region });
    try {
      if (region === 'us-east-1') {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } else {
        await client.send(
          new CreateBucketCommand({
            Bucket: bucket,
            CreateBucketConfiguration: {
              LocationConstraint: region as BucketLocationConstraint,
            },
          }),
        );
      }
      logInfo(`bucket criado`, { bucket, region });
    } catch (createErr: unknown) {
      const cn = awsErrorMeta(createErr).name;
      if (cn === 'BucketAlreadyExists') {
        throw new Error(
          `${LOG} O nome "${bucket}" já está registrado na AWS por outra conta (bucket é global). ` +
            `Crie um bucket com nome único no console S3 e defina no backend/.env: AWS_S3_BUCKET=meu-nome-unico (ou AWS_BUCKET_NAME). ` +
            `O padrão "influencer" quase sempre está indisponível.`,
        );
      }
      throw createErr;
    }
  }
}

function publicUrlForKey(key: string): string {
  const base = getPublicBaseUrl();
  const bucket = getBucket();
  const region = getRegion();
  return base ? `${base}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function isInfluencerS3WipeDisabled(): boolean {
  const v = getEnv('S3_INFLUENCER_WIPE_DISABLE');
  return v === '1' || v?.toLowerCase() === 'true';
}

function isPostCoverUploadDisabled(): boolean {
  const v = getEnv('S3_POST_COVER_DISABLE');
  return v === '1' || v?.toLowerCase() === 'true';
}

/** Apaga todos os objetos sob `influencers/<handle>/` (avatar + posts/…). */
export async function wipeInfluencerS3Prefix(handle: string): Promise<number> {
  if (!isS3Configured()) return 0;
  if (isInfluencerS3WipeDisabled()) {
    logPost('wipe do prefixo influencer ignorado (S3_INFLUENCER_WIPE_DISABLE)', { handle });
    return 0;
  }
  const h = sanitizeHandleForS3Key(handle);
  if (!h) return 0;
  const prefix = influencerS3Prefix(h);
  const bucket = getBucket();
  const client = getClient();
  let deleted = 0;
  let continuationToken: string | undefined;
  try {
    do {
      const out = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (out.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
      if (keys.length === 0) {
        continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
        if (!continuationToken) break;
        continue;
      }
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += chunk.length;
      }
      continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (continuationToken);
    if (deleted > 0) {
      logPost(`prefixo influencer apagado`, { handle: h, prefix, objetos: deleted });
    }
  } catch (e) {
    console.warn(`${LOG_POST} wipe falhou @${h}:`, e);
  }
  return deleted;
}

async function putPublicObject(opts: { key: string; body: Buffer; contentType: string }): Promise<void> {
  const bucket = getBucket();
  await ensureBucketExists(bucket);
  const client = getClient();
  const acl = s3BucketAclUnsupported ? undefined : getOptionalObjectAcl();
  const putBase = {
    Bucket: bucket,
    Key: opts.key,
    Body: opts.body,
    ContentType: opts.contentType,
    CacheControl: 'public, max-age=31536000',
  } as const;

  if (acl) {
    try {
      await client.send(new PutObjectCommand({ ...putBase, ACL: acl }));
    } catch (putErr: unknown) {
      const code =
        putErr && typeof putErr === 'object' && 'Code' in putErr
          ? String((putErr as { Code?: string }).Code)
          : awsErrorMeta(putErr).name;
      if (
        code === 'AccessControlListNotSupported' ||
        awsErrorMeta(putErr).name === 'AccessControlListNotSupported'
      ) {
        s3BucketAclUnsupported = true;
        if (!loggedS3AclUnsupportedHint) {
          loggedS3AclUnsupportedHint = true;
          logInfo(
            'Bucket sem ACLs (Object Ownership enforced). Próximos uploads sem ACL — remova AWS_S3_OBJECT_ACL do backend/.env ou use política de bucket para leitura pública.',
          );
        }
        await client.send(new PutObjectCommand({ ...putBase }));
      } else {
        throw putErr;
      }
    }
  } else {
    await client.send(new PutObjectCommand({ ...putBase }));
  }
}

function sanitizePostMediaFileKey(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 220);
  return s.length > 0 ? s : '';
}

function shouldSkipPostSharpOptimization(): boolean {
  const v = getEnv('S3_POST_RAW');
  return v === '1' || v?.toLowerCase() === 'true';
}

async function optimizePostCoverForUpload(buf: Buffer): Promise<{
  body: Buffer;
  contentType: string;
  ext: string;
  maxEdge: number;
  width?: number;
  height?: number;
} | null> {
  if (shouldSkipPostSharpOptimization()) return null;

  const maxEdgeRaw = parseInt(getEnv('S3_POST_MAX_EDGE') ?? '720', 10);
  const maxEdge = Number.isFinite(maxEdgeRaw) ? Math.min(2048, Math.max(64, maxEdgeRaw)) : 720;

  const fmt = (getEnv('S3_POST_FORMAT') ?? 'webp').toLowerCase();
  const useJpeg = fmt === 'jpeg' || fmt === 'jpg';

  try {
    const pipeline = sharp(buf).rotate().resize(maxEdge, maxEdge, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (useJpeg) {
      const qRaw = parseInt(getEnv('S3_POST_JPEG_QUALITY') ?? '78', 10);
      const quality = Number.isFinite(qRaw) ? Math.min(100, Math.max(50, qRaw)) : 78;
      const { data, info } = await pipeline
        .jpeg({ quality, mozjpeg: true, progressive: true })
        .toBuffer({ resolveWithObject: true });
      return {
        body: data,
        contentType: 'image/jpeg',
        ext: 'jpg',
        maxEdge,
        width: info.width,
        height: info.height,
      };
    }

    const qRaw = parseInt(getEnv('S3_POST_WEBP_QUALITY') ?? '76', 10);
    const quality = Number.isFinite(qRaw) ? Math.min(100, Math.max(40, qRaw)) : 76;
    const { data, info } = await pipeline.webp({ quality, effort: 5 }).toBuffer({ resolveWithObject: true });
    return {
      body: data,
      contentType: 'image/webp',
      ext: 'webp',
      maxEdge,
      width: info.width,
      height: info.height,
    };
  } catch (e) {
    logPost('Sharp: falha na capa do post, usando bytes originais', {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Faz upload da primeira capa de cada mídia (feed, reels, marcados, destaques) para S3.
 * Define `media.stable_cover_url` quando bem-sucedido.
 */
export async function attachStablePostCoversToMedia(handle: string, ...batches: Entity[][]): Promise<void> {
  if (!isS3Configured()) return;
  if (isPostCoverUploadDisabled()) {
    logPost('upload de capas desligado (S3_POST_COVER_DISABLE)');
    return;
  }
  const h = sanitizeHandleForS3Key(handle);
  if (!h) return;

  const itensMedia = batches.reduce((n, b) => n + (Array.isArray(b) ? b.length : 0), 0);
  logMemorySnapshot(`S3 capas: início @${h}`, { itens_media_lote: itensMedia });
  const coverEvery = memoryDiagS3CoverEvery();

  let ok = 0;
  let skipped = 0;

  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const entity of batch) {
      try {
        const rec = entity as {
          post?: { id?: string; media_pk?: string; shortcode?: string };
          media?: {
            cover_images?: Array<{ url?: string }>;
            stable_cover_url?: string;
          };
        };
        const media = rec.media;
        const post = rec.post;
        if (!media || !post) {
          skipped += 1;
          continue;
        }
        const url = media.cover_images?.[0]?.url;
        if (!url || typeof url !== 'string') {
          skipped += 1;
          continue;
        }
        const idRaw = post.id ?? post.media_pk ?? post.shortcode ?? '';
        const fileKey = sanitizePostMediaFileKey(String(idRaw));
        if (!fileKey) {
          skipped += 1;
          continue;
        }

        const got = await fetchImageBytes(url);
        if (!got || got.body.length < MIN_POST_FETCH_BYTES) {
          logPost(`capa ignorada (download curto ou falhou) ${fileKey}`, { bytes: got?.body.length ?? 0 });
          skipped += 1;
          continue;
        }

        let uploadBody = got.body;
        let uploadContentType = got.contentType;
        let ext = extFromContentType(got.contentType);

        const optimized = await optimizePostCoverForUpload(got.body);
        if (optimized) {
          uploadBody = optimized.body;
          uploadContentType = optimized.contentType;
          ext = optimized.ext;
        } else if (shouldSkipPostSharpOptimization()) {
          logPost(`capa ${fileKey} S3_POST_RAW (sem Sharp)`);
        }

        const key = `${influencerS3Prefix(h)}posts/${fileKey}.${ext}`;
        await putPublicObject({ key, body: uploadBody, contentType: uploadContentType });
        media.stable_cover_url = publicUrlForKey(key);
        ok += 1;
        if (coverEvery > 0 && ok % coverEvery === 0) {
          logMemorySnapshot(`S3 capas: após ${ok} uploads @${h}`, { ultima_key: fileKey });
        }
      } catch (e) {
        logPost('erro numa capa (continuando)', { message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  logPost(`capas estáveis: ${ok} ok, ${skipped} sem URL/id`, { handle: h });
  logMemorySnapshot(`S3 capas: fim @${h}`, { ok, skipped });
}

/**
 * Apaga todo o prefixo S3 do influencer, reenvia avatar + injeta URL no slim/mídias + envia capas dos posts.
 * Chamar após `deletePostsByHandle` e antes de `save` do perfil + `savePosts`.
 */
export async function resyncInfluencerS3AfterDbMediaReset(
  slim: Pick<SlimProfile, 'handle'> &
    Partial<Pick<SlimProfile, 'hd_profile_pic_url' | 'profile_pic_url'>> & { stable_profile_pic_url?: string },
  batches: { posts: Entity[]; reels: Entity[]; tagged: Entity[]; highlights: Entity[] },
): Promise<void> {
  if (!isS3Configured()) return;

  logMemorySnapshot(`resync S3: início @${slim.handle}`, {
    posts: batches.posts.length,
    reels: batches.reels.length,
    tagged: batches.tagged.length,
    highlights: batches.highlights.length,
  });
  await wipeInfluencerS3Prefix(slim.handle);
  delete slim.stable_profile_pic_url;
  logMemorySnapshot(`resync S3: pós-wipe @${slim.handle}`);

  await attachStableProfilePicToSlim(slim);
  injectStableProfilePicIntoMediaItems(
    slim.stable_profile_pic_url,
    batches.posts,
    batches.reels,
    batches.tagged,
    batches.highlights,
  );
  logMemorySnapshot(`resync S3: pós-avatar @${slim.handle}`);

  await attachStablePostCoversToMedia(
    slim.handle,
    batches.posts,
    batches.reels,
    batches.tagged,
    batches.highlights,
  );
  logMemorySnapshot(`resync S3: fim @${slim.handle}`);
}

/** Baixa imagem da URL e retorna buffer + content-type (ou null). */
async function fetchImageBytes(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const ab = await res.arrayBuffer();
  if (!ab.byteLength) return null;
  return { body: Buffer.from(ab), contentType: ct.split(';')[0].trim() || 'image/jpeg' };
}

function extFromContentType(ct: string): string {
  const c = ct.toLowerCase();
  if (c.includes('png')) return 'png';
  if (c.includes('webp')) return 'webp';
  if (c.includes('gif')) return 'gif';
  return 'jpg';
}

type ImageCandidate = { body: Buffer; contentType: string; w?: number; h?: number };

function measureImage(buf: Buffer): { w?: number; h?: number } {
  try {
    const r = imageSize(buf);
    if (r.width != null && r.height != null) return { w: r.width, h: r.height };
  } catch {
    /* formato não suportado ou buffer incompleto */
  }
  return {};
}

function scoreCandidate(c: ImageCandidate): number {
  const w = c.w ?? 0;
  const h = c.h ?? 0;
  const area = w * h;
  const meetsDim = w >= MIN_SIDE && h >= MIN_SIDE;
  if (meetsDim) return 1_000_000_000 + area * 10_000 + c.body.length;
  return area + c.body.length;
}

async function fetchImageCandidate(url: string): Promise<ImageCandidate | null> {
  const got = await fetchImageBytes(url);
  if (!got || got.body.length < MIN_BYTES) return null;
  const { w, h } = measureImage(got.body);
  return { body: got.body, contentType: got.contentType, w, h };
}

function shouldSkipSharpOptimization(): boolean {
  const v = getEnv('S3_AVATAR_RAW');
  return v === '1' || v?.toLowerCase() === 'true';
}

/**
 * Redimensiona (fit inside) e reencode em WebP ou JPEG para menor peso na internet.
 * Retorna null para usar o buffer original (raw ou falha do Sharp).
 */
async function optimizeAvatarForUpload(buf: Buffer): Promise<{
  body: Buffer;
  contentType: string;
  ext: string;
  maxEdge: number;
  width?: number;
  height?: number;
} | null> {
  if (shouldSkipSharpOptimization()) return null;

  const maxEdgeRaw = parseInt(getEnv('S3_AVATAR_MAX_EDGE') ?? '384', 10);
  const maxEdge = Number.isFinite(maxEdgeRaw) ? Math.min(2048, Math.max(64, maxEdgeRaw)) : 384;

  const fmt = (getEnv('S3_AVATAR_FORMAT') ?? 'webp').toLowerCase();
  const useJpeg = fmt === 'jpeg' || fmt === 'jpg';

  try {
    const pipeline = sharp(buf).rotate().resize(maxEdge, maxEdge, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (useJpeg) {
      const qRaw = parseInt(getEnv('S3_AVATAR_JPEG_QUALITY') ?? '80', 10);
      const quality = Number.isFinite(qRaw) ? Math.min(100, Math.max(50, qRaw)) : 80;
      const { data, info } = await pipeline
        .jpeg({ quality, mozjpeg: true, progressive: true })
        .toBuffer({ resolveWithObject: true });
      return {
        body: data,
        contentType: 'image/jpeg',
        ext: 'jpg',
        maxEdge,
        width: info.width,
        height: info.height,
      };
    }

    const qRaw = parseInt(getEnv('S3_AVATAR_WEBP_QUALITY') ?? '78', 10);
    const quality = Number.isFinite(qRaw) ? Math.min(100, Math.max(40, qRaw)) : 78;
    const { data, info } = await pipeline.webp({ quality, effort: 5 }).toBuffer({ resolveWithObject: true });
    return {
      body: data,
      contentType: 'image/webp',
      ext: 'webp',
      maxEdge,
      width: info.width,
      height: info.height,
    };
  } catch (e) {
    logInfo('Sharp: falha ao otimizar avatar, usando imagem original', {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Normaliza handle para uso seguro em chaves S3 (uma “pasta” por influenciador). */
export function sanitizeHandleForS3Key(raw: string): string {
  return String(raw || '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_');
}

/**
 * Prefixo S3 exclusivo do influenciador.
 * Ex.: `influencers/meuuser/` → `influencers/meuuser/avatar.webp` (ou .jpg se S3_AVATAR_FORMAT=jpeg).
 */
export function influencerS3Prefix(handle: string): string {
  const h = sanitizeHandleForS3Key(handle);
  if (!h) return 'influencers/_invalid/';
  return `influencers/${h}/`;
}

/**
 * Faz upload da melhor URL (HD e/ou padrão): critério de qualidade mínima (tamanho do arquivo + dimensões).
 * Retorna URL pública virtual-hosted ou AWS_S3_PUBLIC_BASE_URL + key.
 */
export async function uploadInfluencerProfileImageToS3(opts: {
  handle: string;
  hdUrl?: string | null;
  standardUrl?: string | null;
}): Promise<string | null> {
  if (!isS3Configured()) {
    logInfo('upload abortado: credenciais AWS ausentes');
    return null;
  }

  const handle = sanitizeHandleForS3Key(opts.handle);
  if (!handle) {
    logInfo('upload abortado: handle inválido após sanitize', { raw: opts.handle });
    return null;
  }

  const hasHd = Boolean(opts.hdUrl);
  const hasStd = Boolean(opts.standardUrl);
  const urls = [...new Set([opts.hdUrl, opts.standardUrl].filter(Boolean) as string[])];
  if (urls.length === 0) {
    logInfo(`@${handle} sem URLs de foto (hd_profile_pic / profile_pic vazias)`);
    return null;
  }

  logInfo(`@${handle} baixando candidatos…`, {
    bucket: getBucket(),
    region: getRegion(),
    fontes: urls.length,
    temHdUrl: hasHd,
    temProfilePicUrl: hasStd,
  });

  const candidates: ImageCandidate[] = [];
  for (const u of urls) {
    const c = await fetchImageCandidate(u);
    if (c) candidates.push(c);
  }
  if (candidates.length === 0) {
    logInfo(`@${handle} nenhuma imagem passou no mínimo (${MIN_BYTES} bytes / dimensões)`, {
      urlsTentadas: urls.length,
    });
    return null;
  }
  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const best = candidates[0]!;

  let uploadBody = best.body;
  let uploadContentType = best.contentType;
  let ext = extFromContentType(best.contentType);

  const optimized = await optimizeAvatarForUpload(best.body);
  if (optimized) {
    uploadBody = optimized.body;
    uploadContentType = optimized.contentType;
    ext = optimized.ext;
    logInfo(`@${handle} avatar otimizado (Sharp)`, {
      bytesAntes: best.body.length,
      bytesDepois: uploadBody.length,
      maxEdge: optimized.maxEdge,
      formato: ext,
      width: optimized.width ?? null,
      height: optimized.height ?? null,
    });
  } else if (shouldSkipSharpOptimization()) {
    logInfo(`@${handle} S3_AVATAR_RAW: upload sem recompressão`, {
      bytes: best.body.length,
      contentType: best.contentType,
    });
  } else {
    logInfo(`@${handle} usando imagem original (Sharp não otimizou)`, {
      bytes: best.body.length,
      contentType: best.contentType,
    });
  }

  const key = `${influencerS3Prefix(handle)}avatar.${ext}`;

  logInfo(`@${handle} enviando PutObject…`, {
    key,
    bytes: uploadBody.length,
    contentType: uploadContentType,
    width: best.w ?? null,
    height: best.h ?? null,
  });

  await putPublicObject({ key, body: uploadBody, contentType: uploadContentType });

  const publicUrl = publicUrlForKey(key);
  const aclLog = getOptionalObjectAcl();
  logInfo(`@${handle} imagem salva no S3`, {
    bucket: getBucket(),
    key,
    publicUrl,
    acl: aclLog ? `${aclLog} (ou sem ACL se o bucket não suporta)` : '(não enviado)',
  });
  return publicUrl;
}

/** Anexa stable_profile_pic_url ao slim após upload (não falha o fluxo se S3 falhar). */
export async function attachStableProfilePicToSlim(
  slim: Pick<SlimProfile, 'handle'> & Partial<Pick<SlimProfile, 'hd_profile_pic_url' | 'profile_pic_url'>>,
): Promise<void> {
  const h = String(slim.handle ?? '').replace(/^@/, '');
  if (!isS3Configured()) {
    logInfo(`attachStable @${h || '?'} ignorado: credenciais AWS ausentes`);
    return;
  }
  logInfo(`attachStable iniciado @${h}`);
  try {
    const url = await uploadInfluencerProfileImageToS3({
      handle: slim.handle,
      hdUrl: slim.hd_profile_pic_url,
      standardUrl: slim.profile_pic_url,
    });
    if (url) {
      (slim as SlimProfile & { stable_profile_pic_url?: string }).stable_profile_pic_url = url;
      logInfo(`attachStable @${h} concluído: stable_profile_pic_url definida`);
    } else {
      logInfo(`attachStable @${h} terminou sem URL estável (upload retornou null)`);
    }
  } catch (e) {
    console.warn(`${LOG} attachStable @${h} erro:`, e);
  }
}

/**
 * Replica a URL estável do avatar em cada item de mídia normalizado (feed, reels, marcados, destaques)
 * para o frontend usar como fundo quando a thumb do post expirar.
 */
export function injectStableProfilePicIntoMediaItems(stableUrl: string | undefined, ...batches: Entity[][]): void {
  if (!stableUrl || typeof stableUrl !== 'string') {
    logInfo('injectStable em mídias: sem URL estável, nada a replicar');
    return;
  }
  let n = 0;
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const item of batch) {
      const rec = item as { influencer?: Record<string, unknown> };
      if (rec.influencer && typeof rec.influencer === 'object') {
        rec.influencer.stable_profile_pic_url = stableUrl;
        n += 1;
      }
    }
  }
  logInfo(`stable_url replicada em ${n} item(ns) de mídia (posts/reels/marcados/destaques)`);
}
