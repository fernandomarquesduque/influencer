/**
 * Log unificado da coleta (terminal).
 */
export function coletaLog(msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[coleta ${t}] ${msg}`);
}
