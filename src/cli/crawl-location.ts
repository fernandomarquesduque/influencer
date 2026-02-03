import 'dotenv/config';
import { InstagramClient } from '../instagramClient/index.js';
import { ensureLoggedIn } from '../instagramClient/login.js';
import { discoverProfilesByLocation } from '../discoveryService/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import { StorageAdapter } from '../storage/index.js';
import { DEFAULT_CRAWL_CONFIG } from '../types/index.js';
import { randomDelay } from '../utils/delay.js';

const locationArg = process.argv.find((a) => a === '--location')
  ? process.argv[process.argv.indexOf('--location') + 1]
  : null;

const limitArg = process.argv.find((a) => a === '--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : null;

const maxPostsPerTag = limitArg ? parseInt(limitArg, 10) : parseInt(process.env.MAX_POSTS_PER_TAG ?? '30', 10);
const maxProfiles = parseInt(process.env.MAX_PROFILES ?? '100', 10);
const headless = process.env.HEADFUL !== 'true';
const authStatePath = process.env.AUTH_STATE_PATH ?? '.auth/instagram.json';

const config = {
  ...DEFAULT_CRAWL_CONFIG,
  maxPostsPerTag: Number.isNaN(maxPostsPerTag) ? 30 : maxPostsPerTag,
  maxProfiles: Number.isNaN(maxProfiles) ? 100 : maxProfiles,
  headless,
  authStatePath,
};

async function main(): Promise<void> {
  const location = locationArg ?? process.env.CRAWL_LOCATION;
  if (!location) {
    console.error('Uso: npm run crawl:location -- --location <id ou slug> [--limit 50]');
    process.exit(1);
  }

  const user = process.env.INSTAGRAM_USER;
  const password = process.env.INSTAGRAM_PASSWORD;
  if (!user || !password) {
    console.error('Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env');
    process.exit(1);
  }

  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });
  const storage = new StorageAdapter({ config });

  try {
    const loggedIn = await ensureLoggedIn(client, user, password);
    if (!loggedIn) {
      console.error('Falha no login.');
      process.exit(1);
    }
    console.log('Sessão OK. Descobrindo perfis por local:', location);

    const refs = await discoverProfilesByLocation(client, location, config.maxPostsPerTag);
    const existingHandles = await storage.listHandles();
    const toVisit = refs.filter((r) => !existingHandles.has(r.handle.toLowerCase()));
    const capped = toVisit.slice(0, config.maxProfiles);

    console.log(`Encontrados ${refs.length} perfis; ${capped.length} novos (limite ${config.maxProfiles}).`);

    const page = await client.newPage();
    let saved = 0;
    for (const ref of capped) {
      await randomDelay(config.randomDelayMinMs, config.randomDelayMaxMs);
      const profile = await extractProfile(page, ref.handle, 'location', location, config);
      if (profile) {
        const { path, bytes } = await storage.save(profile);
        saved++;
        console.log(`[${saved}] ${ref.handle} -> ${path} (${bytes} bytes)`);
      }
    }
    await page.close();
    console.log(`Concluído. ${saved} perfis salvos.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
