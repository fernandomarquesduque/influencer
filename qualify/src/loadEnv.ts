import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `.env` do qualify tem prioridade sobre variaveis do shell (ex.: OLLAMA_MODEL global). */
const qualifyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(qualifyRoot, '.env'), override: true });
