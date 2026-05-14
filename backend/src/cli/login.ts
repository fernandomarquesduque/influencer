import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do projeto crawl (mesmo que server.ts). */
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_AUTH_PATH = path.join(BACKEND_ROOT, 'data', 'instagram-auth.json');

async function main(): Promise<void> {
  const user = process.env.INSTAGRAM_USER;
  const password = process.env.INSTAGRAM_PASSWORD;
  if (!user || !password) {
    console.error('Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env');
    process.exit(1);
  }

  const authPath = process.env.AUTH_STATE_PATH
    ? path.isAbsolute(process.env.AUTH_STATE_PATH)
      ? process.env.AUTH_STATE_PATH
      : path.resolve(BACKEND_ROOT, process.env.AUTH_STATE_PATH)
    : DEFAULT_AUTH_PATH;

  const client = new InstagramClient({
    headless: process.env.HEADFUL !== 'true',
    authStatePath: authPath,
  });

  try {
    await client.clearAuthStateFile();
    console.log('Sessão anterior removida; iniciando login...');
    const ok = await loginWithCredentials(client, user, password);
    if (ok) {
      console.log('Login OK. Sessão salva em', client.getAuthStatePath());
    } else {
      console.error('Login falhou (verifique usuário/senha ou desafio do Instagram).');
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
