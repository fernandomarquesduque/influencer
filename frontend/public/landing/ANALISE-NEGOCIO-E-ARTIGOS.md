# Análise do negócio Busca Influencer e melhorias para os artigos

## Resumo do negócio

**Busca Influencer** é uma plataforma de dois lados:

1. **Lado influenciador (criador)**  
   - Entra pelo site (landing ou artigos do blog).  
   - **Cadastra** o Instagram em `/app/create`: informa o @, recebe um código via DM do Instagram (precisa seguir o perfil do programa), perfil é extraído e analisado.  
   - Passa a ver um **relatório grátis** com: nota do perfil (score 0–100), taxa de engajamento (ER), valor estimado (post, reels, stories, destaque), tier (Nano/Micro/Mid/Macro), selos (Comunidade Forte, Alta Consistência, etc.), métricas (posts/semana, conversação), melhores horários.  
   - Pode **gerar Media Kit em PDF** (métricas + melhores posts) na página do perfil.  
   - Pode **ativar o cadastro** na página `/activate/:handle`: preenche cidade, estado, contato, tipo de conteúdo, faixas de preço. **Só com ativação completa (ex.: cidade preenchida) o perfil entra na vitrine** para buscas por localização e outros filtros.

2. **Lado marca/agência (B2B)**  
   - Acessa a **vitrine** em `/app`: lista de criadores com métricas.  
   - Filtra por: texto livre, cidade, estado, bairro, nicho/categorias, tipo de conteúdo, faixas de preço (post único, stories, pacote mensal, etc.), engajamento, seguidores, “só ativados” etc.  
   - Vê cards com dados do perfil e pode abrir detalhe (relatório) e contato.  
   - Valor da plataforma para a marca: “métricas reais”, “criadores já analisados e com Media Kit”, “filtros por nicho, alcance e valor”.

**Fluxo do influenciador (resumido):**  
Cadastrar (@ + código) → Ver relatório (score, ER, valor estimado, Media Kit) → **Ativar cadastro** (cidade, contato, preços) → Perfil aparece na vitrine para marcas.

---

## Diferença importante: “cadastrar” x “ativar”

- **Cadastrar** = colocar o @ e concluir a verificação (código no Instagram). O criador passa a ter relatório e pode gerar Media Kit. O perfil pode até aparecer na lista em alguns contextos, mas **sem ativação não entra nos filtros por cidade/estado/região**.  
- **Ativar (cadastro)** = preencher o formulário de ativação (cidade obrigatória, contato, preços, tipo de conteúdo). Só então o perfil fica **“activated”** e passa a ser encontrado quando marcas filtram por localização, nicho, preço etc.

Nos artigos, vale deixar isso claro para não criar expectativa de “só cadastrei e já apareço para todo mundo”. A mensagem pode ser: **“Cadastre seu Instagram para ver seu relatório e métricas. Depois, ative seu cadastro (cidade e contato) para aparecer na vitrine e ser encontrado por marcas na sua região.”**

---

## O que a plataforma realmente oferece (para alinhar os artigos)

| Recurso | Onde está | Como descrever nos artigos |
|--------|-----------|----------------------------|
| Relatório grátis | Após cadastro em /app/create | Score (nota 0–100), ER, valor estimado (post, reels, stories, destaque), selos, métricas, melhores horários. |
| Media Kit PDF | /app/influencer/:handle/media-kit (após login) | PDF com métricas e melhores posts; pronto para enviar a marcas. |
| Vitrine para marcas | /app (lista com filtros) | Marcas filtram por cidade, estado, bairro, nicho, tipo de conteúdo, faixa de preço, engajamento. |
| “Ativar cadastro” | /activate/:handle | Preencher cidade, contato, preços e tipo de conteúdo para entrar na vitrine e aparecer nas buscas por região. |
| Valor estimado | No relatório (reportInsights) | Faixa em R$ para post no feed, reels, stories e destaque; considera seguidores, verificado, audiência que comenta. |

Copy usada no app e que pode ecoar nos artigos:  
- “Marcas perto de você procuram criadores agora.”  
- “Ativando, você entra na busca e marcas da sua região te encontram.”  
- Botão: “Ativar cadastro”.

---

## Melhorias recomendadas por artigo

### 1. Como marcas encontram influenciadores

- **Esclarecer cadastro x ativação:** Explicar que primeiro o criador cadastra o Instagram (e vê o relatório) e, em seguida, **ativa o cadastro** com cidade e contato para **aparecer na vitrine** quando marcas buscarem por região.  
- **Filtros reais:** Mencionar que as marcas filtram por **cidade, estado, nicho, tipo de conteúdo e faixa de preço** — e que quem não ativa não aparece nos filtros por local.  
- **“Como a plataforma ajuda”:** Reforçar que, após ativar, o perfil entra na vitrine com métricas já analisadas (ER, valor estimado) e que isso facilita a decisão da marca.  
- **CTA:** Incluir algo como: “Cadastre seu Instagram para ver seu relatório. Depois, ative seu cadastro para aparecer para marcas na sua região.”

### 2. Engagement Rate

- **Relatório:** Dizer que, ao cadastrar, o criador vê no relatório o ER, a comparação com a faixa (ex.: top 90%) e os melhores horários — e que isso é o mesmo tipo de dado que marcas veem na vitrine.  
- **“Como a plataforma ajuda”:** Ferramentas que calculam e mostram ER (e organizam métricas) ajudam o criador a se preparar e ajudam a marca quando ela acessa o perfil na vitrine.  
- Manter CTA para cadastro + menção a “aparecer para marcas” (vitrine após ativar).

### 3. Media Kit

- **Alinhar com o produto:** Media Kit em PDF, gerado a partir do perfil, com métricas e melhores posts; pode ser baixado após acessar a plataforma.  
- **“Como a plataforma ajuda”:** Gerar o PDF em poucos cliques, com dados já calculados (ER, valor estimado, etc.), sem precisar montar manualmente.  
- Reforçar que o mesmo perfil que gera o Media Kit pode estar na vitrine (se ativado) com dados consistentes para a marca.

### 4. Quanto cobrar por publi

- **Valor estimado no relatório:** A plataforma mostra faixas para **post no feed, reels, stories e destaque** (e um “porquê” resumido: seguidores, verificado, audiência que comenta). Os artigos podem citar “estimativa por formato” (post, reels, stories) sem entrar em fórmula.  
- **“Como a plataforma ajuda”:** Ver essa estimativa no relatório dá base para negociar; ao ativar, a marca pode ver faixas de preço na vitrine.  
- CTA: cadastrar para ver a estimativa + ativar para aparecer para marcas.

### 5. Receber presentes de marcas

- **Ativação e vitrine:** Deixar claro que **organizar o perfil e deixar contato visível** ajuda, e que **ativar o cadastro (cidade, contato)** faz o criador aparecer quando marcas buscam por região e nicho na vitrine.  
- **“Como a plataforma ajuda”:** Vitrine onde marcas filtram por local e nicho; quem está ativado tem mais chance de ser encontrado.  
- CTA pode lembrar: cadastre → veja seu perfil e métricas → ative para aparecer para marcas.

---

## Tom e consistência

- Usar no blog os mesmos termos do produto: **“ativar cadastro”**, **“entrar na vitrine”**, **“marcas da sua região”**, **“relatório com suas métricas e valor estimado”**.  
- Manter tom direto, descolado e educativo, sem propaganda pesada.  
- Em todos os artigos, quando falar de “aparecer para marcas”, deixar implícito ou explícito que isso acontece **depois de ativar o cadastro** (não só de cadastrar o @).

---

## Landing index.html (opcional)

- Na seção “Como funciona”, incluir um passo do tipo: **“Ative seu cadastro (cidade e contato) para aparecer na vitrine.”** Assim fica claro que há dois momentos: (1) ver o relatório (cadastro) e (2) aparecer para marcas (ativar).  
- Isso reduz frustração de quem acha que “só cadastrar” já basta para ser encontrado por qualquer marca.

---

## Checklist rápido para revisão de artigos

- [ ] Diferença “cadastrar” vs “ativar” está clara onde fala de “aparecer para marcas”?  
- [ ] Filtros da vitrine (cidade, estado, nicho, preço) estão mencionados quando relevante?  
- [ ] Recursos reais do produto (score, ER, valor estimado por formato, Media Kit PDF) estão corretos?  
- [ ] CTAs incentivam cadastro e, quando fizer sentido, ativação para aparecer na vitrine?  
- [ ] Tom alinhado com o app (“ativar cadastro”, “marcas da sua região”, “vitrine”)?
