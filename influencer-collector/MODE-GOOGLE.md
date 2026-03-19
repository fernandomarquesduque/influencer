# Modo Google (`site:instagram.com`)

1. Na UI, escolha **Modo → Google (site:instagram.com…)**.
2. Cole a consulta, por exemplo:
   - `site:instagram.com ("pai" OR "mãe") mario`
   - `site:instagram.com mãe "mario bros"`
3. **Iniciar coleta**.

Fluxo:

- A **aba principal** do browser abre o Google (resultados da busca).
- Cada perfil do Instagram encontrado na SERP abre em **aba nova**; a extração é a mesma do modo hashtag (pré-filtros + timeline/Reels/marcados se a API estiver configurada).
- Ao terminar (ou Parar), a aba principal volta para o **feed do Instagram**.

**Captcha / cookies:** se o Google pedir verificação ou consentimento de cookies, resolva manualmente na janela do Playwright. O Instagram continua logado nas outras abas (mesmo contexto).

**API:** `POST /api/start` com `{ "mode": "google", "googleQuery": "site:instagram.com ...", "googleQdr": "h|d|w|m|y", "limit": 10, ... }` (o `googleQdr` é opcional; default costuma ser `w`).
