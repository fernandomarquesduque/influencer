const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'influencer.db');
const handle = (process.argv[2]).toLowerCase().replace(/^@/, '');

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  console.error('Erro ao abrir banco:', dbPath, e.message);
  process.exit(1);
}

const row = db.prepare(
  'SELECT profile_handle, activated_at, updated_at, city, state, description FROM profile_activation WHERE LOWER(profile_handle) = ?'
).get(handle);

if (!row) {
  console.log('Perfil "%s": NAO encontrado na tabela profile_activation (sem cadastro de ativacao).', handle);
} else {
  console.log('Perfil "%s": ENCONTRADO (cadastro de ativacao existe).', handle);
  console.log('  activated_at:', row.activated_at ?? '(null)');
  console.log('  updated_at:', row.updated_at);
  console.log('  city:', row.city ?? '(vazio)');
  console.log('  state:', row.state ?? '(vazio)');
  console.log('  Ativo?', row.activated_at ? 'SIM' : 'NAO (activated_at vazio)');
}

db.close();
