@echo off
echo ====================================
echo  YOLOv8 Detection Microservice
echo ====================================
echo.
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Starting detector service on port 8001...
uvicorn main:app --host 0.0.0.0 --port 8001
pause
