# Publicar o site no IIS (Windows Server)

Este guia descreve como colocar o frontend (SPA) e o backend (API Node) no IIS usando **iisnode**: a API sobe automaticamente com o Application Pool (não é preciso rodar `npm run api` nem serviço separado).

## Visão geral

- **Frontend**: build estático (HTML/JS/CSS) na raiz do site.
- **Backend**: aplicação Node (crawl) exposta como **Application** em `/api`, rodando via **iisnode**. O pool inicia e recicla o processo Node.
- O `web.config` do frontend faz apenas o fallback da SPA; o `/api` é atendido pela Application (crawl) com seu próprio `web.config` (iisnode).

---

## 1. Pré-requisitos no servidor

- **Node.js** (LTS) instalado.
- **IIS** com:
  - **URL Rewrite Module**: [Download](https://www.iis.net/downloads/microsoft/url-rewrite)
  - **iisnode**: [Download](https://github.com/Azure/iisnode/releases) — instale a versão compatível com o seu Node. Após instalar, o handler `iisnode` fica disponível.

---

## 2. Build e conteúdo para publicar

Use o script **`publish.ps1`** na raiz do projeto (recomendado):

```powershell
.\publish.ps1
```

Isso gera **`C:\Publish\influencer`** com:
- **Raiz**: conteúdo de `frontend\dist` (site para IIS).
- **crawl\**: API com `run.mjs`, `web.config` (iisnode), `dist\` (build do TypeScript), `node_modules`, `data\` (se existir).

Se fizer manualmente: na pasta **frontend** rode `npm ci` e `npm run build`; na pasta **crawl** rode `npm ci` e `npm run build` (o build copia `openapi.json` para `dist/api`).

---

## 3. Publicar no IIS

1. **Copiar a pasta de publish para o servidor**
   - Copie todo o conteúdo de **`C:\Publish\influencer`** (ou o equivalente) para uma pasta no servidor (ex.: `C:\inetpub\wwwroot\influencer`). A estrutura deve ser:
     - Raiz do site: `index.html`, `assets\`, `web.config` (frontend).
     - Subpasta `crawl\`: `run.mjs`, `web.config`, `dist\`, `node_modules`, `data\`, etc.

2. **Criar o site no IIS**
   - **IIS Manager** → Sites → **Add Website**.
   - **Site name**: ex. `Influencer`.
   - **Physical path**: pasta que contém o **frontend** (raiz do publish), ex. `C:\inetpub\wwwroot\influencer`.
   - **Binding**: host name (ex. `influencer.creait.com.br`) e/ou porta.
   - **Application pool**: .NET CLR version = **No Managed Code**.

3. **Adicionar a Application da API**
   - No site que você criou, clique com o botão direito → **Add Application**.
   - **Alias:** `api`
   - **Physical path:** pasta **crawl** (ex. `C:\inetpub\wwwroot\influencer\crawl`).
   - **Application pool:** pode usar o mesmo do site (ou um pool dedicado com No Managed Code).
   - OK.

4. **Reiniciar**
   - Reciclé o Application Pool ou reinicie o site. O iisnode sobe o Node ao atender a primeira requisição em `/api` (ou ao iniciar o pool, conforme a configuração).

---

## 4. Conferir se está funcionando

1. **Frontend**
   - Abra no navegador a URL do site (ex. `https://influencer.creait.com.br`). A SPA deve carregar (login, listagem).

2. **API**
   - Acesse `https://influencer.creait.com.br/api/health`. Deve retornar JSON, ex.: `{"status":"ok",...}`.
   - Se o frontend conseguir fazer login e listar perfis, a API está respondendo.

3. **Erros comuns**
   - **502 Bad Gateway** em `/api`: iisnode não instalado; Application `api` não criada ou com physical path errado; ou `npm run build` não foi rodado no crawl (falta `dist/` ou `dist/api/openapi.json`). Veja os logs do iisnode na pasta do crawl.
   - **404** em rotas da SPA (ex. após F5): `web.config` do frontend sem regra de SPA fallback ou não na raiz do site.
   - **500** na API: verifique variáveis de ambiente (`.env` na pasta crawl) e logs do iisnode.

---

## 5. Integrar no mesmo site (ex.: weappi.com)

Se o influencer vai conviver com outra aplicação no mesmo IIS:

### Subdomínio (ex.: influencer.creait.com.br)

- Crie um **novo site** com binding para esse host.
- **Physical path**: raiz do publish (frontend + pasta `crawl` dentro).
- No site, adicione **Application** alias `api`, path `/api`, physical path = pasta **crawl** (como na seção 3).

### Caminho (ex.: weappi.com/influencer)

1. Build do frontend com base path: `VITE_BASE_PATH=/influencer/` e `VITE_API_BASE=/influencer/api`, depois `npm run build`.
2. No site principal, crie **Application** alias `influencer`, path `/influencer`, physical path = pasta que contém o frontend buildado.
3. Dentro dessa pasta de influencer, crie outra **Application** alias `api`, path `/influencer/api`, physical path = pasta **crawl** (a estrutura no disco deve ter a pasta crawl dentro da pasta do influencer).

---

## 6. Resumo rápido

| Etapa | O quê |
|-------|--------|
| Publicar | `.\publish.ps1` → gera `C:\Publish\influencer` (frontend + crawl com build) |
| IIS site | Physical path = raiz do publish (onde está index.html e a pasta crawl) |
| IIS Application | Adicionar Application alias **api**, path **/api**, physical path = pasta **crawl** |
| API | Sobe automaticamente com o Application Pool (iisnode) |

O `web.config` do frontend não faz proxy; o `/api` é atendido pela Application (crawl) com iisnode.
