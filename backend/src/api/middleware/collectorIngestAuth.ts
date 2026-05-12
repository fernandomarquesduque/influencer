import type { Request, Response, NextFunction } from 'express';

/**
 * Exige header X-Collector-Key igual a COLLECTOR_INGEST_SECRET.
 * Usado pelo influencer-collector (localhost) para gravar perfis no RocksDB do servidor.
 */
export function requireCollectorIngestSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.COLLECTOR_INGEST_SECRET?.trim();
  if (!secret) {
    res.status(503).json({
      error: 'Endpoint desabilitado. Defina COLLECTOR_INGEST_SECRET no servidor para aceitar ingest do collector.',
      code: 'COLLECTOR_INGEST_DISABLED',
    });
    return;
  }
  const key = String(req.headers['x-collector-key'] ?? '').trim();
  if (key !== secret) {
    res.status(401).json({
      error: 'Chave inválida ou ausente. Envie o header X-Collector-Key.',
      code: 'COLLECTOR_INGEST_UNAUTHORIZED',
    });
    return;
  }
  next();
}
