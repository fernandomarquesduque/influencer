# Influencer Collector

Projeto **standalone** em Node.js para coletar influenciadores do Instagram e armazená-los **em memória**. Pensado para instalação em várias máquinas (Mac e Windows).

## Fluxo

1. **Ao iniciar**: abre uma **janela do browser** no Instagram. Se já existir sessão salva em `data/instagram-auth.json` (ou `AUTH_STATE_PATH`), você entra **já logado**.
2. **Você navega** à vontade (feed, hashtags, explore).
3. **Quando quiser**: abra a interface em `http://localhost:3967` e clique em **Iniciar coleta**.
4. A coleta roda até você clicar em **Parar coleta** ou até atingir o limite de perfis.

A lista na interface é atualizada a cada 5 segundos. Use **Excluir** na linha para remover alguém capturado por engano (só em memória).

## Regras de filtro

- Mínimo de seguidores (env: `MIN_FOLLOWERS`, padrão 5000).
- Mínimo de curtidas por post e quantidade de posts com essa curtida (`MIN_POST_LIKES`, `MIN_POSTS_WITH_MIN_LIKES`).
- Exclusão de perfis de empresa/estabelecimento (`EXCLUDE_BUSINESS_PROFILES=true`).
- Blocklist e palavras rejeitadas (reimplementadas neste projeto).

## Teste rápido (sem Instagram)

Confere TypeScript, módulos e APIs HTTP da interface:

```bash
npm test
```

## Instalação (Mac e Windows)

```bash
cd influencer-collector
npm install
npx playwright install chromium
```

Opcional: copie `.env.example` para `.env` e ajuste (sessão Instagram, regras, porta da UI).

## Uso

```bash
npm start
# ou
npm run collect
```

1. Abre o browser no Instagram.
2. Se aparecer login/challenge, faça login manualmente no browser.
3. No terminal aparece o link da interface: **http://localhost:3967**
4. Abra esse link no navegador.
5. Ajuste **regras da coleta** na interface (mín. seguidores, curtidas, posts, limite de perfis, excluir empresas) — os valores iniciais vêm do `.env`.
6. Modo **Hashtag**: informe **várias tags** (uma por linha ou separadas por vírgula). O **limite de perfis** vale para a rodada inteira (distribuído entre as tags). Feed/Explore ignoram o campo de tags.
7. Clique em **Iniciar coleta**. A coleta roda até **Parar coleta** ou até o limite.

Os influenciadores coletados ficam **só em memória** (não há banco nem arquivo). Ao fechar o processo, a lista é perdida.

### Sessão do Instagram (não deslogar)

O login é gravado automaticamente no arquivo indicado por `AUTH_STATE_PATH` (padrão `data/instagram-auth.json`, já ignorado pelo Git):

- **Depois que você logar**, a sessão é salva ao navegar no Instagram (com pequeno atraso), **a cada ~3 minutos** enquanto o app rodar, e ao sair com **Ctrl+C** no terminal.
- Na próxima execução de `npm start`, o browser reabre **com a mesma sessão**.
- **Prefira Ctrl+C** para encerrar; fechar o terminal “no X” pode não dar tempo de gravar — nesse caso, espere alguns minutos após o login para o salvamento automático.
- O Instagram pode pedir login de novo por política deles (novo dispositivo, tempo, etc.); aí basta logar outra vez e a sessão é atualizada.

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `AUTH_STATE_PATH` | Caminho do arquivo de sessão Instagram (ex.: `data/instagram-auth.json`) |
| `MIN_FOLLOWERS` | Mínimo de seguidores para salvar (padrão 5000) |
| `MIN_POST_LIKES` | Mínimo de curtidas por post (padrão 200) |
| `MIN_POSTS_WITH_MIN_LIKES` | Quantidade mínima de posts com essa curtida (padrão 4) |
| `EXCLUDE_BUSINESS_PROFILES` | Excluir empresas (padrão true) |
| `COLLECTOR_REQUIRE_BIO_PT_BR` | Exigir bio em português brasileiro com `franc` + heurísticas (padrão: ligado; `false` desliga) |
| `HEADLESS` | `true` para rodar sem mostrar o browser (padrão: janela visível) |
| `COLLECTOR_UI_PORT` | Porta da interface (padrão 3967) |

## Estrutura do projeto

Todo o código está dentro de `influencer-collector` (projeto autocontido):

- `config.ts` — configuração a partir do env
- `instagram.ts` — browser Playwright e URLs do Instagram
- `entityRules.ts` — regras (blocklist, empresa, qualificação, curtidas)
- `bioLanguageBr.ts` — validação de bio em pt-BR (biblioteca `franc`)
- `profileExtractor.ts` — extração de perfil e posts via API
- `slimProfile.ts` — perfil enxuto para exibição
- `discovery.ts` — descoberta por hashtag, feed e explore
- `memoryStorage.ts` — armazenamento em memória
- `runner.ts` — controle Iniciar/Parar da coleta
- `server.ts` — interface HTTP (lista + botões)
- `index.ts` — entrada: browser no Instagram + servidor

Compatível com **Mac e Windows** (paths e env via `dotenv`).
