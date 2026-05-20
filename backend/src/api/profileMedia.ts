/**
 * Streaming de avatar/capas sem expor handle em URLs (path usa profile_ref UUID).
 */

import type { Response } from 'express';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { CompositeStorage } from '../storage/compositeStorage.js';
import type { ProfileRefDb } from '../storage/profileRefDb.js';
import { isProfileRef } from '../storage/profileRefDb.js';
import { influencerS3Prefix, sanitizeHandleForS3Key } from '../s3/influencerProfileStorage.js';
import { getProfilePicUrlFromRecord } from './profileMediaHelpers.js';

const PROXY_IMAGE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.instagram.com/',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

function getS3Env(name: string, ...alts: string[]): string | undefined {
  const v = process.env[name];
  if (v && String(v).trim()) return String(v).trim();
  for (const a of alts) {
    const x = process.env[a];
    if (x && String(x).trim()) return String(x).trim();
  }
  return undefined;
}

function isS3Configured(): boolean {
  return Boolean(getS3Env('AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY') && getS3Env('AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY'));
}

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: getS3Env('AWS_REGION') || 'sa-east-1',
      credentials: {
        accessKeyId: getS3Env('AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY')!,
        secretAccessKey: getS3Env('AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY')!,
      },
    });
  }
  return s3Client;
}

function getBucket(): string {
  return getS3Env('AWS_S3_BUCKET', 'AWS_BUCKET_NAME') || 'influencer';
}

async function streamBytes(res: Response, body: Buffer, contentType: string): Promise<void> {
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'public, max-age=86400');
  res.end(body);
}

async function tryStreamS3Key(res: Response, key: string): Promise<boolean> {
  if (!isS3Configured()) return false;
  try {
    const out = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    const chunks: Buffer[] = [];
    const stream = out.Body;
    if (!stream || typeof stream !== 'object' || !('on' in stream)) return false;
    await new Promise<void>((resolve, reject) => {
      (stream as NodeJS.ReadableStream)
        .on('data', (c: Buffer) => chunks.push(c))
        .on('end', () => resolve())
        .on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) return false;
    const ct = out.ContentType || 'image/webp';
    await streamBytes(res, buf, ct);
    return true;
  } catch {
    return false;
  }
}

async function fetchImageUrl(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const r = await fetch(url, { headers: PROXY_IMAGE_HEADERS });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!ct.toLowerCase().includes('image/')) return null;
    const ab = await r.arrayBuffer();
    if (!ab.byteLength) return null;
    return { body: Buffer.from(ab), contentType: ct.split(';')[0].trim() || 'image/jpeg' };
  } catch {
    return null;
  }
}

async function resolveHandle(profileRefDb: ProfileRefDb, profileRef: string): Promise<string | null> {
  if (!isProfileRef(profileRef)) return null;
  return profileRefDb.getHandleByRef(profileRef);
}

export async function streamProfileAvatarMedia(
  profileRefDb: ProfileRefDb,
  db: CompositeStorage,
  profileRef: string,
  res: Response
): Promise<void> {
  const handle = await resolveHandle(profileRefDb, profileRef);
  if (!handle) {
    res.status(404).json({ error: 'Perfil não encontrado' });
    return;
  }
  const h = sanitizeHandleForS3Key(handle);
  const prefix = influencerS3Prefix(handle);
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    const key = `${prefix}avatar.${ext}`;
    if (await tryStreamS3Key(res, key)) return;
  }

  const summary = await db.loadByHandle(handle);
  const profile = summary as Record<string, unknown> | null;
  if (!profile) {
    res.status(404).json({ error: 'Imagem não disponível' });
    return;
  }
  const picUrl = getProfilePicUrlFromRecord(profile);
  if (!picUrl) {
    res.status(404).json({ error: 'Imagem não disponível' });
    return;
  }
  const got = await fetchImageUrl(picUrl);
  if (!got) {
    res.status(404).json({ error: 'Imagem não disponível' });
    return;
  }
  await streamBytes(res, got.body, got.contentType);
}

export async function streamProfileCoverMedia(
  profileRefDb: ProfileRefDb,
  db: CompositeStorage,
  profileRef: string,
  mediaKey: string,
  res: Response
): Promise<void> {
  const handle = await resolveHandle(profileRefDb, profileRef);
  if (!handle) {
    res.status(404).json({ error: 'Perfil não encontrado' });
    return;
  }
  const safeKey = String(mediaKey || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeKey) {
    res.status(400).json({ error: 'mediaKey inválida' });
    return;
  }
  const prefix = influencerS3Prefix(handle);
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    const key = `${prefix}posts/${safeKey}.${ext}`;
    if (await tryStreamS3Key(res, key)) return;
  }

  const posts = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
  const match = posts.find(({ value, key }) => {
    const post = value.post as Record<string, unknown> | undefined;
    const id = String(post?.id ?? post?.media_pk ?? post?.shortcode ?? '');
    const short = String(post?.shortcode ?? '');
    return id === safeKey || short === safeKey || key.endsWith(`:${safeKey}`);
  });
  const item = match?.value;
  if (!item) {
    res.status(404).json({ error: 'Capa não disponível' });
    return;
  }
  const media = item.media as Record<string, unknown> | undefined;
  const stable = media?.stable_cover_url as string | undefined;
  const cover = (media?.cover_images as Array<{ url?: string }> | undefined)?.[0]?.url;
  const video = (media?.video_versions as Array<{ url?: string }> | undefined)?.[0]?.url;
  const raw = (typeof stable === 'string' && stable.startsWith('http') ? stable : undefined) || cover || video || (item.image_url as string | undefined);
  if (!raw || typeof raw !== 'string') {
    res.status(404).json({ error: 'Capa não disponível' });
    return;
  }
  const got = await fetchImageUrl(raw);
  if (!got) {
    res.status(404).json({ error: 'Capa não disponível' });
    return;
  }
  await streamBytes(res, got.body, got.contentType);
}
