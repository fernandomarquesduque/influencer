# Blog (artigos + guia em HTML)

Pasta no mesmo nível de `landing/`. Cada artigo e o guia ficam em **sua própria subpasta**, com arquivo de nome descritivo para SEO.

## Estrutura

- **landing.css** e **blog-editorial.css** — Na raiz de `blog/`; cada página em subpasta usa `../landing.css` e `../blog-editorial.css`.
- **artigos.html** — Na raiz do blog. Lista todos os artigos agrupados por categoria. URL: `/blog/artigos.html`. É a página de índice do blog (link do menu “Blog” na landing).
- **Artigos (16):** cada um em pasta própria; o **arquivo tem o nome da categoria** (não do slug).
  - **Categoria `pilar`:** `como-ganhar-dinheiro-influenciador/pilar.html`
  - **Categoria `comecando`:** pastas com `comecando.html` (quantos-seguidores-..., ganhar-produtos-..., parcerias-marcas-pequenas, como-comecar-ser-..., crescer-instagram-..., aumentar-engajamento-..., receber-presentes-marcas)
  - **Categoria `metricas`:** pastas com `metricas.html` (engagement-rate-..., calcular-engajamento-..., media-kit-..., quanto-cobrar-..., perfil-profissional-...)
  - **Categoria `parcerias`:** pastas com `parcerias.html` (como-marcas-encontram-..., aparecer-marcas-sua-regiao, fechar-primeira-parceria)

## URLs

- Formato: `/blog/{slug}/{categoria}.html` (ex.: `/blog/como-ganhar-dinheiro-influenciador/pilar.html`). Índice: `/blog/artigos.html`.
- Links internos usam `/blog/xxx/categoria.html`.
- A landing principal (`/landing/`) aponta para `/blog/artigos.html` no menu “Blog”.
