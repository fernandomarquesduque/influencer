/**
 * Mostra o código de 2FA ativo no SQLite para um @handle (suporte local).
 * Uso: node scripts/check-verification-code.cjs marquesduque
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'influencer.db');
const handle = (process.argv[2] || '').toLowerCase().replace(/^@/, '');

if (!handle) {
  console.error('Uso: node scripts/check-verification-code.cjs <handle>');
  process.exit(1);
}

const NOT_EXPIRED = `(
  (expires_at NOT LIKE '%T%' AND expires_at > datetime('now'))
  OR (
    expires_at LIKE '%T%'
    AND datetime(replace(substr(replace(replace(expires_at, 'Z', ''), '.000', ''), 1, 19), 'T', ' ')) > datetime('now')
  )
)`;

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  console.error('Erro ao abrir banco:', dbPath, e.message);
  process.exit(1);
}

const row = db
  .prepare(
    `SELECT code, expires_at, user_id FROM auth_profile_verification WHERE handle = ? AND ${NOT_EXPIRED}`
  )
  .get(handle);

console.log('Banco:', dbPath);
if (!row) {
  console.log('@%s: nenhum código ativo (expirado ou nunca solicitado).', handle);
} else {
  console.log('@%s: código ativo = %s (expira %s, user_id=%s)', handle, row.code, row.expires_at, row.user_id ?? 'null');
}

db.close();
