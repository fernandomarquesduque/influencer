/** Retorna timestamp no formato ddMMyyyyHHmmss para logs (ex.: 19022025143022). */
export function logTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return pad(d.getDate()) + pad(d.getMonth() + 1) + d.getFullYear() + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
