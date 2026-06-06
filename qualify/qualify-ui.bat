@echo off
title Qualify LLM Runner

echo ===============================
echo Iniciando Qualify...
echo ===============================

cd /d %~dp0

REM ===== Iniciar UI =====
echo Iniciando servidor UI...
node dist\index.js ui

pause
