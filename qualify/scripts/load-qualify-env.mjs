import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const qualifyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(qualifyRoot, '.env'), override: true });
