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

2. **Instalar browsers do Playwright (obrigatório para a API)**
   - A API (crawl) usa Playwright (Chromium) para extração. No servidor, **na pasta da API** (ex. `C:\inetpub\wwwroot\influencer\crawl`), abra um terminal **como o mesmo usuário que o Application Pool usa** (ex. Administrator ou a identidade do pool).
   - Execute (recomendado no Windows Server: instalar dependências do sistema evita "spawn UNKNOWN"):
     ```powershell
     cd C:\inetpub\wwwroot\influencer\crawl
     npx playwright install --with-deps chromium
     ```
     Se não tiver permissão para `--with-deps`, use só `npx playwright install chromium` e instale manualmente o [Visual C++ Redistributable x64](https://aka.ms/vs/17/release/vc_redist.x64.exe).
   - Os binários são instalados em `%LOCALAPPDATA%\ms-playwright` desse usuário. Se o pool rodar com outra conta, rode o comando uma vez como essa conta (ou configure o pool para usar a conta que já executou o install).

3. **Criar o site no IIS**
   - **IIS Manager** → Sites → **Add Website**.
   - **Site name**: ex. `Influencer`.
   - **Physical path**: pasta que contém o **frontend** (raiz do publish), ex. `C:\inetpub\wwwroot\influencer`.
   - **Binding**: host name (ex. `influencer.creait.com.br`) e/ou porta.
   - **Application pool**: .NET CLR version = **No Managed Code**.

4. **Adicionar a Application da API**
   - No site que você criou, clique com o botão direito → **Add Application**.
   - **Alias:** `api`
   - **Physical path:** pasta **crawl** (ex. `C:\inetpub\wwwroot\influencer\crawl`).
   - **Application pool:** pode usar o mesmo do site (ou um pool dedicado com No Managed Code).
   - OK.

5. **Reiniciar**
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
   - **Playwright "Executable doesn't exist"**: os browsers do Playwright não foram instalados no servidor. Na pasta **crawl**, como o usuário do Application Pool, rode `npx playwright install chromium` (veja o passo 2 da seção "Publicar no IIS").
   - **Playwright "spawn UNKNOWN" (ou "spawn EPERM")**:
     - **Rodando no terminal (CMD/PowerShell)**: instale as dependências e reinicie o servidor: `npx playwright install --with-deps chromium` → **reinicie o Windows** e teste de novo. Se ainda falhar, instale o [Visual C++ Redistributable x64](https://aka.ms/vs/17/release/vc_redist.x64.exe). Em **Windows Server 2012 R2** (versão 6.3.9600), o Chromium atual **não é compatível**; use a seção 4.0 abaixo.
     - **Rodando sob iisnode**: o processo Node pode não conseguir criar o processo filho do Chromium (restrições de conta/sessão). Solução: **rodar a API em processo standalone** (seção 4.1 abaixo).

---

## 4.0. Windows Server 2012 R2 (versão 6.3.9600)

O Chrome/Chromium **109** foi a última versão que roda no Windows Server 2012 R2. O Playwright atual usa Chromium 145+, que **não inicia** nesse sistema (erro "spawn UNKNOWN" mesmo após `--with-deps` e reinício).

**Opções:**

1. **Usar Chrome 109 na pasta do projeto (recomendado se ficar no 2012 R2)**  
   - Siga **"Como instalar o Chrome 109 (offline, 64-bit)"** abaixo.  
   - No **`.env`** da pasta **crawl**, defina o caminho completo para o `chrome.exe` (instalado em Program Files ou copiado para a pasta do projeto):
     ```env
     PLAYWRIGHT_CHROMIUM_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
     ```
     Se tiver copiado o Chrome para a pasta do projeto (ex.: `crawl\browser\Chrome109\chrome.exe`), use esse caminho.  
   - Rode de novo `npm run login` (ou a API). O código usa apenas esse executável e não o Chromium do Playwright.

### Como instalar o Chrome 109 (offline, 64-bit)

O Google não distribui mais o Chrome 109 na página oficial. Use um instalador offline preservado em arquivo:

1. **Baixar o MSI (64-bit)**  
   - No servidor (ou em outro PC e depois copie o arquivo), abra no navegador:  
     **https://archive.org/download/chrome-109-Win7-8**  
   - Baixe o arquivo **`Chrome 109 x64.msi`** (cerca de 92 MB).  
   - Link direto (pode precisar de confirmação no archive.org):  
     `https://archive.org/download/chrome-109-Win7-8/Chrome%20109%20x64.msi`

2. **Instalar no Windows Server 2012 R2**  
   - Abra um CMD ou PowerShell **como Administrador**.  
   - Navegue até a pasta onde está o `Chrome 109 x64.msi` e execute:
     ```bat
     msiexec /i "Chrome 109 x64.msi" /qn
     ```
     O `/qn` instala em modo silencioso (sem janelas). Para ver a interface do instalador, use só:
     ```bat
     msiexec /i "Chrome 109 x64.msi"
     ```
   - O Chrome 109 será instalado em:  
     **`C:\Program Files\Google\Chrome\Application\chrome.exe`**

3. **Configurar o projeto**  
   - No **`.env`** da pasta **crawl** (ex.: `C:\inetpub\wwwroot\influencer\crawl\.env`), adicione:
     ```env
     PLAYWRIGHT_CHROMIUM_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
     ```
   - Salve e teste com `npm run login`.  
   - Se aparecer **`net::ERR_HTTP_RESPONSE_CODE_FAILURE`** ou você **não conseguir logar nem com o Chrome aberto** no servidor: faça o login no seu PC e copie a sessão (veja **4.0.1** abaixo).

2. **Subir o servidor para Windows Server 2016 ou superior**

### 4.0.1. Login no seu PC e copiar sessão para o servidor (quando não dá para logar no servidor)

Use um **PC com Windows 10 ou 11** e **Chrome atual** (não use o servidor para esse login).

1. **No seu PC**, tenha o projeto (ou pelo menos a pasta **crawl** com o código atual).
2. Na pasta **crawl**, crie ou edite o **`.env`** com o **mesmo** usuário e senha que você usa no servidor:
   ```env
   INSTAGRAM_USER=seu_usuario
   INSTAGRAM_PASSWORD=sua_senha
   ```
   Não precisa de `PLAYWRIGHT_CHROMIUM_EXECUTABLE` no PC.
3. Instale dependências e Chromium do Playwright (só na primeira vez):
   ```bat
   cd crawl
   npm install
   npx playwright install chromium
   ```
4. Rode o login **com navegador visível** (para você conseguir completar captcha/2FA se o Instagram pedir):
   ```bat
   set HEADFUL=true
   npm run login
   ```
5. Uma janela do Chrome vai abrir na página de login do Instagram. **Digite usuário e senha e conclua o login** (e qualquer verificação que o Instagram pedir). Quando o script avisar "Login OK. Sessão salva em .auth/instagram.json", feche a janela se ainda estiver aberta.
6. Copie o arquivo **`.auth/instagram.json`** do seu PC para o servidor:
   - No PC: `crawl\.auth\instagram.json`
   - No servidor: `C:\inetpub\wwwroot\influencer\crawl\.auth\`
   Crie a pasta **`.auth`** no servidor se não existir. O arquivo pode ser enviado por e-mail (para você mesmo), OneDrive, pendrive, etc.
7. No servidor, a API (ou `npm run login`) **não precisa abrir a página de login**; ela usa esse arquivo até a sessão expirar. Quando expirar, repita o processo (login no PC e copiar de novo o `.auth/instagram.json`).

**Dicas:** Use o mesmo usuário/senha no .env do PC e do servidor. Se o Instagram pedir código de celular ou e-mail, digite no navegador durante o `npm run login`. Se bloquear por “atividade suspeita”, tente de outra rede ou espere algumas horas.  
   Aí o `npx playwright install --with-deps chromium` (e, se pedido, reinício) costuma ser suficiente.

---

## 4.1. Rodar a API em processo standalone (recomendado para extração de perfil)

Se a extração de perfil (Playwright/Chromium) falhar com **spawn UNKNOWN** ou **spawn EPERM** quando a API está no IIS (iisnode), rode a API **fora do IIS**, como processo Node normal (com o usuário que tem os browsers do Playwright instalados).

1. **No servidor**, abra um terminal como **Administrator** (ou o usuário que rodou `npx playwright install chromium`).
2. Vá até a pasta da API e inicie o servidor:
   ```powershell
   cd C:\inetpub\wwwroot\influencer\crawl
   node run.mjs
   ```
   A API sobe na porta definida em `PORT` (ex. 3000). Mantenha essa janela aberta ou use um gerenciador de processos (ex. **PM2** ou **NSSM** como Serviço Windows).
3. **Fazer o IIS encaminhar `/api` para esse processo** (opcional):
   - Instale **Application Request Routing (ARR)** no IIS e configure um **reverse proxy** da URL do site `/api` para `http://localhost:3000` (ou a porta que a API usa).
   - Ou deixe o frontend apontando para outra URL da API (ex. `https://api.influencer.creait.com.br`) em um site IIS que faz proxy para `localhost:3000`.

Assim o Chromium é iniciado pelo processo Node “normal”, sem as restrições do Application Pool, e a extração de perfil passa a funcionar.

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
