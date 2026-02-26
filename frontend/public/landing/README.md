# Landing em HTML puro (SEO)

Esta pasta contém a landing em **HTML estático** para indexação por buscadores.

- **URL local (dev):** `http://localhost:5174/landing/` ou `http://localhost:5174/landing/index.html`
- **URL em produção:** configure o servidor para servir `/landing/index.html` em `/landing/`.

## Conteúdo

- Mesmo layout e cores da Landing React (`Landing.tsx` + tema light).
- Formulários enviam para `/app/create?u=NICKNAME`; o app React lê o parâmetro `u` na página de criação.
- Links: Entrar → `/login`, Criar → `/app/create`, Logo → `/`.

## SEO

- Meta title, description, keywords e robots.
- Open Graph e Twitter Cards.
- Schema.org `WebSite` com `SearchAction` para o fluxo de análise.
- Canonical e `lang="pt-BR"`.

## Ajustes em produção

No `index.html`, altere se necessário:

- `canonical` e `og:url` para o domínio final (ex.: `https://seusite.com/landing/`).
- `og:image` para a URL absoluta da imagem de compartilhamento.
