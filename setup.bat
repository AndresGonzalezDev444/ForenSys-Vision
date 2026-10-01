@echo off
title Configurar Entorno - ForenSys Vision V2
echo =============================================
echo   Preparando Entorno de ForenSys Vision V2
echo =============================================
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install fastapi "uvicorn[standard]" sqlalchemy opencv-contrib-python scikit-learn websockets jinja2 python-multipart numpy bcrypt
pip install easyocr httpx pygrabber
echo.
echo =============================================
echo   Entorno configurado correctamente.
echo =============================================
pause
