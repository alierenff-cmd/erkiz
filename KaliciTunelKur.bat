@echo off
setlocal
chcp 65001 >nul
title Erkiz - Kalici Cloudflare Tuneli Kurulumu

:: Yonetici haklari gerekli (Windows hizmeti kurulacak)
net session >nul 2>&1
if errorlevel 1 (
    echo Yonetici izni isteniyor...
    powershell -Command "Start-Process cmd -ArgumentList '/k \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
set "SRC=%~dp0tools\cloudflared\cloudflared.exe"
set "DST_DIR=%ProgramFiles%\cloudflared"
set "DST=%DST_DIR%\cloudflared.exe"

echo ======================================================
echo   ERKIZ - KALICI CLOUDFLARE TUNELI (WINDOWS HIZMETI)
echo ======================================================
echo.

if not exist "%SRC%" (
    echo [HATA] %SRC% bulunamadi. Once TunelTest.bat'i bir kez calistirin.
    pause
    exit /b 1
)

if not exist "%DST_DIR%" mkdir "%DST_DIR%"
copy /y "%SRC%" "%DST%" >nul
echo [OK] cloudflared: %DST%
echo.
echo Cloudflare panelinde tuneli olusturunca verilen komuttaki
echo uzun TOKEN degerini (eyJ... ile baslar) asagiya yapistirin.
echo (Sag tik = yapistir). Token'i kimseyle paylasmayin.
echo.
set "TOKEN="
set /p TOKEN="Token: "
if "%TOKEN%"=="" (
    echo [HATA] Token bos.
    pause
    exit /b 1
)

:: Varsa eski hizmeti kaldir
sc query cloudflared >nul 2>&1
if not errorlevel 1 (
    echo Eski cloudflared hizmeti kaldiriliyor...
    "%DST%" service uninstall >nul 2>&1
    timeout /t 3 >nul
)

"%DST%" service install %TOKEN%
if errorlevel 1 (
    echo [HATA] Hizmet kurulamadi.
    pause
    exit /b 1
)

sc config cloudflared start= delayed-auto >nul
sc failure cloudflared reset= 60 actions= restart/5000/restart/5000/restart/30000 >nul
timeout /t 5 >nul
sc query cloudflared | findstr /i "RUNNING" >nul
if errorlevel 1 (
    echo [UYARI] Hizmet kuruldu ama henuz calismiyor. Hizmetler ^(services.msc^) icinden "cloudflared" durumuna bakin.
) else (
    echo [OK] cloudflared hizmeti calisiyor. Bilgisayar acildiginda otomatik baslar.
)
echo.
echo Artik TunelTest.bat'a gerek yok. Sunucunun ^(SistemiBaslat.bat^) acik olmasi yeterli.
pause
endlocal
