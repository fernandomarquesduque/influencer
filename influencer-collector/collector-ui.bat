@echo off

title Influencer Collector



echo ===============================

echo Iniciando Influencer Collector...

echo ===============================



cd /d %~dp0



REM Node do sistema (Program Files) — nao usar o Node do Cursor no PATH (better-sqlite3 e por versao)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"



REM ===== Iniciar coletor (browser + UI) =====

echo Abrindo Instagram e interface em http://localhost:3967/ ...

"%NODE_EXE%" --max-old-space-size=8192 ./node_modules/tsx/dist/cli.mjs src/index.ts



pause

