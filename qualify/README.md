# qualify

Projeto para qualificar influencers com LLM (Ollama) e salvar o resultado no mesmo JSON do perfil no RocksDB via API da nuvem (`backend`), no campo `llm`.

## Como funciona

- Lê pendentes pela API `GET /api/crawl/collector-llm-pending`.
- Filtra perfis que ainda nao possuem `llm.status = "done"`.
- Chama o Ollama (`llama3.1:8b` por padrao).
- Salva no perfil via `POST /api/crawl/collector-ingest-llm`:

```json
{
  "llm": {
    "qualifiedAt": "2026-03-26T12:00:00.000Z",
    "model": "llama3.1:8b",
    "version": 1,
    "status": "done"
  }
}
```

## Setup

```bash
cd qualify
npm install
cp .env.example .env
```

## Executar

```bash
npm run qualify
```

Painel web (checkboxes, fila, logs):

```bash
npm run qualify -- ui
```

## Variaveis de ambiente

- `OLLAMA_HOST` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `llama3.1:8b`)
- `QUALIFY_API_BASE` (ex.: `https://buscainfluencer.com.br/api`)
- `QUALIFY_INGEST_KEY` (mesmo valor de `COLLECTOR_INGEST_SECRET` no servidor)
- `QUALIFY_BATCH_SIZE` (default: `20`)
- `QUALIFY_MAX_REASONING` (default: `3`)
- `QUALIFY_API_TIMEOUT_MS` (default: `30000`)
- `QUALIFY_MEDIA_CONTEXT_LIMIT` (legendas na 2a fase LLM quando personaSummary falha validacao)
