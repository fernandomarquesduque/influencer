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
- **Chromium na pasta do projeto** (não usa Chrome do sistema): no `.env` defina `PLAYWRIGHT_BROWSERS_PATH=./browser` e depois rode `npx playwright install chromium`. O Chromium será instalado em `crawl/browser/`.

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
