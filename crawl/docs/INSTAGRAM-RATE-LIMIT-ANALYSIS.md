# Análise: rate limit e bloqueios no Instagram (crawler vs API)

## Resumo (com base no código)

- **runCrawl/discovery**: já opera perto do ideal: 1 client + 1 page reutilizada por execução, usa `humanDelay()`, trata 429/challenge via `rateLimit429` e pode abortar/esperar.
- **API (`extractSingleProfile`)**: é o ponto fraco: cada request cria um `InstagramClient` novo (browser + context + page), sem delay explícito e sem controle de paralelismo. Se o frontend/script disparar várias chamadas, você viola “1 browser/context por vez” e aumenta muito o risco de 429/challenge.

**O problema principal não é o crawler por hashtag; é a API permitir N extrações paralelas, cada uma subindo um Chromium novo.**

---

## O que já existe

- `HEADFUL` suportado via env.
- `humanDelay()` usado no fluxo de discovery.
- Tratamento de 429/challenge no extractor + backoff em `rateLimit429`.

---

## O que falta (principalmente na API)

1. **Reutilizar o context no `InstagramClient`**  
   Cache de `this.context` e só recriar em relogin/limpeza. Hoje `getContext()` não cacheia; então toda chamada que passa por `getContext()` pode recriar contexto.

2. **Fila global na API com concorrência 1**  
   Um único worker para evitar extrações paralelas.

3. **Delay/cooldown no fluxo “extrair perfil”**  
   Antes/depois do `extractProfile` e pausa maior a cada N perfis.

4. **Política de backoff/abort na camada orquestradora da API**  
   Quando retornar 429/challenge, aplicar backoff e não deixar o caller “tentar de novo na hora”. A API hoje devolve erro e o caller pode insistir → você queima conta/IP (bug de arquitetura).

---

## Alertas técnicos

- **Vários browsers/contextos = fingerprint e risco de challenge**  
  Mesmo sem 429, criar browser/context em sequência aumenta “suspicious automation”. Melhor manter 1 browser/context quente e só alternar a page.

- **Backoff existe, mas não é aplicado na API**  
  O backoff está no runCrawl/discovery; na API não. Quem chama a API pode receber erro e insistir → queima de conta/IP.

---

## Ações recomendadas (ordem)

1. Reutilizar context no `InstagramClient` (cache + reset só em relogin).
2. Cadastrar fila global na API com concorrência 1 (um worker).
3. Adicionar delay/cooldown no fluxo da API (ou no worker).
4. Propagar política de 429/challenge para o worker (backoff + abort).
5. Opcional: headful por default em produção do crawler.

---

## Conclusão

O crawler por hashtag já segue boa parte das recomendações; o bloqueio tende a vir do uso via API (sessão nova por perfil + paralelismo + sem delay/backoff). Reuso de context + fila com concorrência 1 + delays/cooldown na API deve reduzir drasticamente bloqueios.
