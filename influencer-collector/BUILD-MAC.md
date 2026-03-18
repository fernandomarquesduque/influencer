# Mac — pacote por e-mail (zip gerado no Windows)

O **influencer-collector** usa **Playwright** (Chromium por SO). A forma de distribuir para quem usa **Mac** é gerar o zip **no PC Windows** e enviar por e-mail; no Mac, na primeira execução, instalam-se dependências e o Chromium **para macOS**.

## Quem gera o zip (Windows)

Na pasta do projeto:

```powershell
npm run package:mac-share
```

Saída em `release/`: **`InfluencerCollector-Mac-*.zip`** (`dist/`, `package.json`, `package-lock.json`, **`.env`** se existir no projeto, scripts e `LEIA-ME-MAC.txt`).

**Sem incluir seu `.env` real** (só exemplo):

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/package-mac-share.ps1 -UseExampleEnvOnly
```

## Quem recebe no Mac

1. Instalar [Node.js 18+](https://nodejs.org/).
2. Descompactar o zip.
3. No Terminal, na pasta descompactada:

   ```bash
   bash run.sh
   ```

   Na **primeira vez** rodam `npm ci` e `playwright install chromium` (pode demorar).

4. Abrir no navegador: `http://localhost:3967` (ou a porta definida no `.env`).

Detalhes extras estão no **`LEIA-ME-MAC.txt`** dentro do zip.
