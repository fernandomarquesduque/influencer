/**
 * Deve ser importado antes de qualquer módulo que leia process.env no topo (ex.: PORT em server.ts).
 * Em ESM, imports são avaliados antes do corpo de index.ts — dotenv só no corpo chegava tarde demais.
 */
import { resolve } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const root = resolve(process.cwd());
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
