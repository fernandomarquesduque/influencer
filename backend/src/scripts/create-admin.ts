/**
 * Cria ou atualiza o usuário administrador.
 * Uso: ADMIN_USERNAME=admin ADMIN_PASSWORD=suasenha npm run create-admin
 * Ou (só desenvolvimento): npm run create-admin  → admin / admin123
 * Se o usuário já existir, a senha é forçada para a informada (reset).
 */
import 'dotenv/config';
import { AuthDb } from '../auth/authDb.js';
import { hashPassword } from '../auth/password.js';

const username = process.env.ADMIN_USERNAME ?? 'admin';
const password = process.env.ADMIN_PASSWORD ?? 'admin123';
const dbPath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

const authDb = new AuthDb(dbPath);
const existing = authDb.getByUsername(username);
const hash = hashPassword(password);

if (existing) {
  authDb.updateUser(existing.id, { password_hash: hash, scope: 'adm' });
  console.log(`Usuário ${username} (id=${existing.id}): senha atualizada e scope definido como adm.`);
  console.log('Faça login na aplicação com esse usuário e a nova senha.');
} else {
  const id = authDb.createUser(username, hash, 'adm', null);
  console.log(`Admin criado: id=${id}, username=${username}`);
  console.log('Faça login na aplicação com esse usuário e a senha informada.');
}
authDb.close();
