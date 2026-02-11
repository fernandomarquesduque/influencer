import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const LOG_PATH = process.env.CRAWL_LOG ?? '';

function timestamp(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function writeToFile(line: string): void {
  if (!LOG_PATH) return;
  try {
    const dir = dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf-8');
  } catch {
    // ignore
  }
}

/**
 * Log que grava em arquivo (quando CRAWL_LOG está definido) e opcionalmente no console.
 * Use para debug do crawl/descovery.
 */
export function crawlLog(msg: string, alsoConsole = true): void {
  const line = `[${timestamp()}] ${msg}`;
  writeToFile(line);
  if (alsoConsole && process.env.CRAWL_LOG_QUIET !== '1') {
    console.log(line);
  }
}

export function crawlLogDiscovery(msg: string): void {
  const line = `[${timestamp()}] [discovery] ${msg}`;
  writeToFile(line);
  if (process.env.CRAWL_LOG_QUIET !== '1') {
    console.log(line);
  }
}

export function crawlLogExtract(msg: string): void {
  const line = `[${timestamp()}] [extract] ${msg}`;
  writeToFile(line);
  if (process.env.CRAWL_LOG_QUIET !== '1') {
    console.log(line);
  }
}

export function isCrawlLogEnabled(): boolean {
  return LOG_PATH.length > 0;
}
