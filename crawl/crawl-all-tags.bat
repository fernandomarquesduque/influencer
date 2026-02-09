@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "LIMIT=%~1"
if "%LIMIT%"=="" set "LIMIT=200"

set "DELAY_EXTRA=%~2"
if not "%DELAY_EXTRA%"=="" (
  set "DELAY_ARG=--delay-extra %DELAY_EXTRA%"
) else (
  set "DELAY_ARG="
)

echo Iniciando fila de crawl (PT-BR): %LIMIT% perfis por hashtag.
echo Uso: crawl-all-tags.bat [limite] [delay-extra-ms]   ex: crawl-all-tags.bat 500 2000
echo.

REM =====================================================
REM 1) PUBLICIDADE / PARCERIA (SINAIS COMERCIAIS)
REM =====================================================
set "TAGS=publi publicidade parceria parcerias publipost postpago recebidos recebidospelamarca recebidospubli marcaparceira conteudopago acaopublicitaria resenha resenhas avaliacao avaliandoproduto testando testei unboxing achadinhos achadinhosdodia achadinhosonline cupom cupomdesconto desconto descontos promocao sorteio"

REM =====================================================
REM 2) FAMILIA / MAE / PAI / CRIANCAS
REM =====================================================
set "TAGS=%TAGS% mae maedemenino maedemenina maternidade rotinamae vidademae maeempreendedora pai paidefamilia paternidade familia vidadefamilia bebe gestante gravidez crianca infancia"

REM =====================================================
REM 3) IDENTIDADE DE INFLUENCIADOR
REM =====================================================
set "TAGS=%TAGS% influenciador influenciadora criadoresdeconteudo criadoradeconteudo microinfluenciador nanoinfluenciador blogueira blogueirinha criadorconteudo criadoradigital"

REM =====================================================
REM 4) BELEZA / MODA / CORPO
REM =====================================================
set "TAGS=%TAGS% beleza autocuidado maquiagem skincare cabelo unhas moda lookdodia estilo biquini praia"

REM =====================================================
REM 5) FITNESS / SAUDE
REM =====================================================
set "TAGS=%TAGS% fitness vidasaudavel academia treino musculacao crossfit corrida yoga pilates"

REM =====================================================
REM 6) COMIDA / GASTRONOMIA
REM =====================================================
set "TAGS=%TAGS% comida receitas culinaria cozinhando gastronomia restaurante cafe doces"

REM =====================================================
REM 7) VIAGEM / LIFESTYLE
REM =====================================================
set "TAGS=%TAGS% viagem turismo viajando lifestyle natureza"

REM =====================================================
REM 8) NEGOCIOS / SERVICOS
REM =====================================================
set "TAGS=%TAGS% empreendedorismo negocios marketingdigital negociolocal barbearia salaodebeleza estetica manicure"

REM =====================================================
REM Embaralha as tags para cada execucao ser diferente
REM =====================================================
set "TAGS_TMP=%TEMP%\crawl-tags-%RANDOM%.txt"
echo %TAGS%> "%TAGS_TMP%"
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "$t = (Get-Content -Raw '%TAGS_TMP%').Trim().Split(); $shuffled = $t | Sort-Object { Get-Random }; $shuffled -join ' '"`) do set "TAGS=%%L"
del /q "%TAGS_TMP%" 2>nul
echo Ordem desta execucao (embaralhada): %TAGS%
echo.

REM =====================================================
REM EXECUCAO (delay varia por hashtag para parecer mais humano)
REM =====================================================
for %%T in (%TAGS%) do (
  set "TAG_DELAY=%DELAY_EXTRA%"
  if not "!TAG_DELAY!"=="" (
    set /a "RAND=!RANDOM! * 1500 / 32768"
    set /a "TAG_DELAY=!TAG_DELAY!+!RAND!"
    echo === Crawling hashtag: %%T - limit %LIMIT% - delay-extra !TAG_DELAY!ms ===
    npx tsx src/cli/crawl-hashtag.ts --tag "%%T" --limit %LIMIT% --delay-extra !TAG_DELAY!
  ) else (
    echo === Crawling hashtag: %%T - limit %LIMIT% ===
    npx tsx src/cli/crawl-hashtag.ts --tag "%%T" --limit %LIMIT%
  )
  if errorlevel 1 (
    echo [ERRO] Falha ao processar %%T. Continuando...
  )
  echo.
)

echo Fila concluida.
pause
