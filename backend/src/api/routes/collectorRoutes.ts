import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireCollectorIngestSecret } from '../middleware/collectorIngestAuth.js';
import type { CollectorController } from '../controllers/collectorController.js';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void fn(req, res).catch(next);
  };
}

/**
 * Rotas do fluxo collector → API → RocksDB.
 * Montar em app com: app.use('/api/crawl', createCollectorCrawlRouter(controller))
 */
export function createCollectorCrawlRouter(controller: CollectorController): Router {
  const router = Router();

  router.post(
    '/collector-ingest-profile',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.ingestProfile(req, res))
  );

  router.post(
    '/collector-ingest-full',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.ingestProfileFull(req, res))
  );

  router.get(
    '/collector-llm-pending',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.listLlmPending(req, res))
  );

  router.get(
    '/collector-llm-main-categories',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.listLlmMainCategoryLabels(req, res))
  );

  router.post(
    '/collector-ingest-llm',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.ingestLlm(req, res))
  );

  /** Opcional: verificar se o ingest está habilitado (sem gravar). Útil para health do collector. */
  router.get('/collector-ingest-status', (_req, res) => {
    const enabled = Boolean(process.env.COLLECTOR_INGEST_SECRET?.trim());
    res.status(200).json({
      ingestEnabled: enabled,
      message: enabled
        ? 'POST /api/crawl/collector-ingest-profile aceita perfis com X-Collector-Key.'
        : 'Defina COLLECTOR_INGEST_SECRET para habilitar.',
    });
  });

  router.get(
    '/collector-verify-profile',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.verifyProfile(req, res))
  );
  router.post(
    '/collector-verify-profile',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.verifyProfile(req, res))
  );

  /** Relatório de @ citados sem cadastro — mesma lógica do admin, auth X-Collector-Key. */
  router.get(
    '/collector-unregistered-mentions',
    requireCollectorIngestSecret,
    asyncHandler((req, res) => controller.unregisteredMentions(req, res))
  );

  return router;
}
