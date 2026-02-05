import 'dotenv/config';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';

async function main(): Promise<void> {
  const user = process.env.INSTAGRAM_USER;
  const password = process.env.INSTAGRAM_PASSWORD;
  if (!user || !password) {
    console.error('Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env');
    process.exit(1);
  }

  const client = new InstagramClient({
    headless: process.env.HEADFUL !== 'true',
    authStatePath: process.env.AUTH_STATE_PATH ?? '.auth/instagram.json',
  });

  try {
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
