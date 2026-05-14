# Influencer Extractor (Instagram)

Ferramenta de extração de perfis de microinfluenciadores no Instagram com **foco em endereço** e **baixo uso de memória**. Cada perfil é armazenado como um node/documento normalizado de até **1MB** (na prática, poucos KB).

## Restrições de memória e design

- **Nunca** são salvos: HTML, DOM, screenshots, conteúdo completo de posts, listas grandes (comentários, seguidores).
- Apenas campos finais, limpos e normalizados (JSON).
- **`estimatePayloadSize(obj)`**: utilitário que calcula o tamanho em bytes do payload serializado (UTF-8). Usado antes de salvar para validar o limite do node.
- Se o payload exceder 1MB: **bio** e **address.raw_text** são truncados progressivamente; nunca falha silenciosamente — ou salva dentro do limite ou lança erro.
- Scroll e navegação mínimos; delays randômicos 2–6s; retry leve (máx 2 tentativas por página).

## Pré-requisitos

- Node.js 18+
- Conta Instagram (usuário/senha em variáveis de ambiente)
- **Chromium na pasta do projeto** (não usa Chrome do sistema): no `.env` defina `PLAYWRIGHT_BROWSERS_PATH=./browser` e depois rode `npx playwright install chromium`. O Chromium será instalado em `backend/browser/`.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `INSTAGRAM_USER` e `INSTAGRAM_PASSWORD`.
3. (Opcional) Ajuste `MAX_POSTS_PER_TAG`, `MAX_PROFILES`, `AUTH_STATE_PATH`, `HEADFUL`.

## Uso

**Login (persiste sessão em `data/instagram-auth.json`):**

```bash
npm run login
```

**Descoberta por hashtag (limite de posts por tag e de perfis por execução):**

```bash
npm run crawl:hashtag -- --tag barbearia --limit 50
```

A sessão é reutilizada: não é necessário logar a cada execução.

## Estrutura do código

- **instagramClient**: Playwright, persistência de sessão (`storageState`), URLs (perfil, tag, location).
- **discoveryService**: descoberta por hashtag e por local; retorna apenas `handle` e `profile_url`; deduplicação por handle.
- **profileExtractor**: extrai campos permitidos do perfil (bio, website, followers, etc.) e chama o addressExtractor.
- **addressExtractor**: (1) bio — padrões de endereço BR; (2) modal Contato/Endereço em perfis comerciais; (3) geotag nos últimos 3 posts. Sempre só texto; nunca HTML.
- **normalizers**: normalização de números, strings, boolean e endereço a partir de texto.
- **storage**: por padrão usa **SQLite** (banco local em `./data/influencer.db`). Valida tamanho com `estimatePayloadSize` e `ensureWithinLimit`. Use `STORAGE_BACKEND=json` no `.env` para salvar um JSON por perfil em `data/profiles/`.

## Campos extraídos (exemplo)

- `platform`, `handle`, `profile_url`, `display_name`, `bio` (máx 500 chars), `website`, `followers`, `following`, `posts_count`, `is_verified`, `is_business`, `category`
- **address**: `street`, `number`, `neighborhood`, `city`, `state`, `postal_code`, `country`, `raw_text` (máx 300 chars)
- `public_email`, `public_phone` (somente se explícitos na bio)
- `discovered_by`, `discovered_value`, `collected_at`

## Banco local (SQLite)

Os dados extraídos são salvos por padrão em um banco SQLite em `./data/influencer.db`. Cada perfil vira uma linha na tabela `profiles` (upsert por `handle`). Para usar arquivos JSON em vez do banco, defina no `.env`:

```bash
STORAGE_BACKEND=json
```

Opcionalmente defina o caminho do banco:

```bash
STORAGE_DB_PATH=./data/influencer.db
```

## Anti-bloqueio

- Apenas leitura (não seguir, curtir, comentar, DM).
- User-Agent realista; headless por padrão; `HEADFUL=true` para debug.

## Troubleshooting – Login

Se o login falhar ("Login falhou (verifique usuário/senha ou desafio do Instagram)"):

1. **Confirme usuário e senha** no `.env` (INSTAGRAM_USER, INSTAGRAM_PASSWORD).
2. **Rode com navegador visível** para ver o que acontece (captcha, desafio, mensagem de erro):
   ```bash
   HEADFUL=true npm run login
   ```
3. **Ative logs de debug** do fluxo de login:
   ```bash
   LOGIN_DEBUG=true npm run login
   ```
4. O Instagram pode **bloquear ou desafiar** automação (headless). Se funcionar com `HEADFUL=true` e falhar em headless, use login com navegador visível uma vez para gerar a sessão; depois o crawl pode reutilizar `data/instagram-auth.json`.
5. Se aparecer **"Senha incorreta"** ou similar na página, o script tenta exibir essa mensagem no console quando `LOGIN_DEBUG=true`.

## Índice de busca (API / SQLite)

A busca de influenciadores usa o SQLite (`profile_search_aux` + FTS). O índice é atualizado automaticamente ao gravar perfil ou mídia via `CompositeStorage` (`save`, `savePosts`, `saveMedia`).

Após **importação em massa** ou migração, reconstrua o índice a partir do RocksDB (na pasta `backend`, com os mesmos `STORAGE_DB_PATH` / `SQLITE_DB_PATH` do `.env`):

```bash
npm run rebuild-search-index
```

Perfis com LLM concluída mas sem linha auxiliar **não entram** no resultado da busca até o índice existir ou o script acima ser executado.

### Atalho SQL (busca global com ou sem texto)

Quando a busca **não** usa filtros de ativação/LLM/categorias/preço/custo e a ordenação é compatível (ex.: por engajamento ou seguidores; com texto, também `relevance_desc` quando o Meili **não** devolve hits), o backend **lista handles já filtrados no SQLite** (`profile_search_aux`, e **FTS5 na mesma query** quando há `q` e a query vira expressão FTS válida) e só então carrega os perfis correspondentes no RocksDB — em vez de ler **todos** os perfis do bucket. Com **`MEILISEARCH_SEARCH=1`** e o Meili retornar resultados para `q`, o atalho SQL global com FTS **não** é usado (mantém o estreitamento pelo Meili + caminho legado).

Após o carregamento, o filtro **`matchesQuery`** em cima de `search_blob` continua aplicado quando há `q` (paridade com o legado). O **`total`** da resposta reflete só os itens que passam por esse filtro (e demais filtros em memória), alinhado à paginação.

### Colunas denormalizadas (`profile_search_aux`)

A tabela inclui `followers_count`, `engagement_rate`, `avg_likes`, `posts_count` e `account_type` (preenchidos no sync) para índices SQL e evitar parsear JSON em massa. Na primeira subida após atualizar o código, o SQLite aplica `ALTER TABLE` + backfill a partir de `engagement_json`. Rode `npm run rebuild-search-index` se quiser alinhar seguidores e `account_type` com o Rocks em lote.

### Meilisearch (opcional)

Com **`MEILISEARCH_HOST`** definido (ex.: `http://127.0.0.1:7700`), cada sync de índice envia o documento ao índice `influencer_profiles` (salvo se `MEILISEARCH_SYNC=0`). Com **`MEILISEARCH_SEARCH=1`**, a busca textual (`q`) tenta o Meili primeiro (typo/relevância) e cai no FTS5 do SQLite se não houver hits ou em caso de erro.

- **`MEILISEARCH_API_KEY`**: opcional (chave master ou search no Meili).
- **`MEILISEARCH_SYNC=0`**: não envia atualizações ao Meili.
- **`MEILISEARCH_SEARCH=1`**: ativa uso do Meili na leitura da busca; sem isso permanece só FTS SQLite.

### Debug de performance

`SEARCH_PROFILE_TIMING=1` loga marcas `[search-timing]` ao longo de `searchProfiles` (mapa aux, estreitamento textual, retorno).
