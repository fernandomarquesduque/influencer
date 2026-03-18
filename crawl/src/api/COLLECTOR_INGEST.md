# API — ingest do influencer-collector

O collector roda no **localhost** (Playwright + Instagram). Os perfis aprovados são enviados por HTTP para esta API, que grava no **RocksDB** do servidor (mesmo bucket `profile` do crawl).

## Estrutura no código

| Arquivo | Função |
|---------|--------|
| `middleware/collectorIngestAuth.ts` | Valida `X-Collector-Key` × `COLLECTOR_INGEST_SECRET` |
| `controllers/collectorController.ts` | Lógica de merge + `db.save()` |
| `routes/collectorRoutes.ts` | Router montado em `/api/crawl` |

Registro no `server.ts`:

```ts
const collectorController = createCollectorController(db);
app.use('/api/crawl', createCollectorCrawlRouter(collectorController));
```

## Endpoints

| Método | Caminho | Auth |
|--------|---------|------|
| `GET` | `/api/crawl/collector-ingest-status` | Não |
| `POST` | `/api/crawl/collector-ingest-profile` | Só perfil slim |
| `POST` | `/api/crawl/collector-ingest-full` | Perfil + `feedMedia`, `reelMedia`, `taggedMedia` (nós GraphQL) → posts/reels no RocksDB (métricas/ER no site) |
| `GET` ou `POST` | `/api/crawl/collector-verify-profile` | Confirma se o `@` está no RocksDB após ingest. Query `?handle=usuario` ou body `{ "handle": "usuario" }`. Mesmo header `X-Collector-Key`. |

**Resposta quando encontrado (200):** `{ "ok": true, "found": true, "handle", "full_name", "followers_count", "_collected_at", "mediaCounts": { "post", "reel", "tagged" } }`  
**Quando não existe (200):** `{ "ok": true, "found": false, "message": "..." }`

O **influencer-collector**, após cada POST de ingest com sucesso, chama esse GET automaticamente. Se `found=false`, o perfil cai em erros na UI. Use `COLLECTOR_SKIP_VERIFY=true` no collector se a API estiver atrás de vários workers IIS (verificação pode bater em nó sem o dado ainda).

### Ingest completo (`collector-ingest-full`)

Body JSON (até ~80MB):

```json
{
  "profile": { "handle": "...", "_collected_at": "...", ... },
  "feedMedia": [ { /* node GraphQL do feed */ }, ... ],
  "reelMedia": [ { /* node Reels */ }, ... ],
  "taggedMedia": [ ... ]
}
```

O servidor normaliza com `buildNormalizedPost`, apaga posts antigos desse `@` e grava de novo (post / reel / tagged). Ambos os POST exigem header **`X-Collector-Key`**.

### Busca no site (`/api/profiles/search`)

Depois de cada ingest bem-sucedido, a API executa **`warmSearchCache`** (recarrega o cache em memória a partir do RocksDB). Assim o perfil **passa a aparecer na busca** assim que o POST retorna.

**IIS com vários workers:** cada processo tem cache próprio. Se o ingest cair em um worker e a busca em outro, o perfil pode demorar até o reaquecimento daquele worker. Para refletir na hora, use **1 worker** no Application Pool da API ou até o próximo deploy/restart.

## Variáveis de ambiente (servidor)

```env
COLLECTOR_INGEST_SECRET=gerar-uma-chave-longa
```

Sem isso, o **POST** responde **503**; o **GET status** indica `ingestEnabled: false`.

## Collector (`.env` local)

```env
COLLECTOR_API_BASE=https://seu-dominio.com/api
COLLECTOR_INGEST_KEY=<mesmo valor do COLLECTOR_INGEST_SECRET>
```

Documentação OpenAPI: tag **Collector** em `openapi-rocksdb.json`.
