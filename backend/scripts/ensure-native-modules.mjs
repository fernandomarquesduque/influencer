/**
 * Garante better-sqlite3 compilado para o mesmo Node que executa npm/node (ex.: 20.x no VS Code).
 * Evita ERR_DLOPEN_FAILED quando o binário foi buildado com outro Node (ex.: 22 do Cursor).
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const require = createRequire(path.join(backendRoot, 'package.json'));

function canLoadBetterSqlite3() {
  try {
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

if (canLoadBetterSqlite3()) {
  console.log(`[native] better-sqlite3 OK (${process.version})`);
  process.exit(0);
}

console.log(`[native] Recompilando better-sqlite3 para ${process.version} …`);
execSync('npm rebuild better-sqlite3 --build-from-source', {
  cwd: backendRoot,
  stdio: 'inherit',
  env: { ...process.env, npm_config_build_from_source: 'true' },
});

if (!canLoadBetterSqlite3()) {
  console.error('[native] Falha: better-sqlite3 não carrega após rebuild.');
  console.error('[native] Use o mesmo Node do launch (C:\\Program Files\\nodejs) e rode: npm run rebuild:native');
  process.exit(1);
}

console.log(`[native] better-sqlite3 recompilado (${process.version})`);
