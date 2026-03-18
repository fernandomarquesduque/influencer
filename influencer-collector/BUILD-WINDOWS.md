# Build / executável no Windows

O projeto `influencer-collector` usa **Playwright** (Chromium nativo). Por isso, o empacotamento precisa ser feito **no Windows** (ou em CI com runner Windows).

## Opção recomendada — pasta pronta para distribuir

No **Windows** (PowerShell), na pasta do projeto:

```powershell
cd influencer-collector
pwsh -ExecutionPolicy Bypass -File scripts/package-win.ps1
# ou:
npm run package:windows
```

Isso gera `release/influencer-collector-windows/` com:

- `dist/`
- `node_modules/` (produção)
- Chromium do Playwright
- `run.bat` (para rodar / duplo clique)

### Uso no Windows que receberá a pasta

```powershell
cd release/influencer-collector-windows
Copy-Item .env.example .env
# edite .env com suas configs
.\run.bat
```

Compacte em `.zip` para enviar (vai ficar grande por causa do Chromium).

## Observações importantes

1. `data/` é gerado em runtime (session do Instagram). Não precisa existir para o primeiro boot.
2. Se você rodar com conta logada, a sessão é salva em `data/instagram-auth.json` via `AUTH_STATE_PATH`.

