# Landing em HTML puro (SEO)

Esta pasta contém as landings em **HTML estático** para indexação por buscadores.

- **URL local (dev):** `http://localhost:5174/landing/` ou `http://localhost:5174/landing/index.html`
- **URL em produção:** configure o servidor para servir `/landing/index.html` em `/landing/`.

## Funil de aquisição

```
Google → artigos educativos → relatório → cadastro → ativação → vitrine
```

## Arquivos

- **index.html** — Landing principal (“Descubra seu potencial”). Estilos inline; não depende de CSS externo.
- **Blog (pasta irmã):** artigos e guia ficam em `../blog/`, cada um em sua pasta (ex.: `blog/como-ganhar-dinheiro-influenciador/pilar.html`). Link do menu: `/blog/artigos.html` (lista de todos os artigos).

Cada artigo ataca uma intenção de busca específica, com título em pergunta, conteúdo escaneável (H2, listas, parágrafos curtos), tom jovem/direto e CTA alinhado ao tema.

## Conteúdo

- Mesmo layout e cores da Landing React (`Landing.tsx` + tema light).
- Formulários enviam para `/app/create?u=NICKNAME`; o app React lê o parâmetro `u` na página de criação.
- Links: Entrar → `/login`, Cadastrar → `/app/create`, Logo → `/`.

## SEO

- Meta title, description, keywords e robots.
- Open Graph e Twitter Cards.
- Canonical e `lang="pt-BR"`.
- No `index.html`: Schema.org `WebSite` com `SearchAction` para o fluxo de análise.

## Ajustes em produção

Nos HTMLs, altere se necessário:

- `canonical` e `og:url` para o domínio final (landing: `https://buscainfluencer.com.br/landing/`; artigos do blog: `https://buscainfluencer.com.br/blog/slug.html`).
- `og:image` para a URL absoluta da imagem de compartilhamento.
