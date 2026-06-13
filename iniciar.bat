@echo off
title ForenSys Vision V1
cd /d "%~dp0"
echo.
echo  =============================================
echo      ForenSys Vision V1 - Iniciando...
echo  =============================================
echo.
call venv\Scripts\python main.py
pause