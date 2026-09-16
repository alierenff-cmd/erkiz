@echo off
setlocal
chcp 65001 >nul
title Erkiz - Cloudflare Hizli Tunel TESTI
cd /d "%~dp0"
set "LOG=%~dp0tunel_test.log"
echo [%date% %time%] Test basladi > "%LOG%"

echo ======================================================
echo   ERKIZ - CLOUDFLARE HIZLI TUNEL TESTI (GECICI)
echo   Bu pencere acik kaldigi surece sunucu internetten erisilebilir.
echo   Testi bitirmek icin bu pencereyi kapatin.
echo ======================================================
echo.

:: ---------- 1. cloudflared var mi? ----------
set "CF="
where cloudflared >nul 2>&1 && set "CF=cloudflared"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"

:: Parcali indirilmis kopya (GitHub indirmesi FortiGate'te zaman asimina ugrayabildigi icin)
set "CFDIR=%~dp0tools\cloudflared"
if not defined CF if exist "%CFDIR%\cloudflared.exe" set "CF=%CFDIR%\cloudflared.exe"
if not defined CF if exist "%CFDIR%\cloudflared.exe.part0" (
    echo [1/3] cloudflared parcalari birlestiriliyor...
    copy /b "%CFDIR%\cloudflared.exe.part0"+"%CFDIR%\cloudflared.exe.part1"+"%CFDIR%\cloudflared.exe.part2" "%CFDIR%\cloudflared.exe" >nul
    certutil -hashfile "%CFDIR%\cloudflared.exe" SHA256 | findstr /i "2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712" >nul
    if errorlevel 1 (
        echo [HATA] cloudflared.exe dogrulama ^(SHA256^) basarisiz, siliniyor.
        echo [HATA] SHA256 uyusmadi >> "%LOG%"
        del /q "%CFDIR%\cloudflared.exe"
    ) else (
        echo       [OK] SHA256 dogrulandi.
        echo [1/3] parcalar birlestirildi, SHA256 OK >> "%LOG%"
        set "CF=%CFDIR%\cloudflared.exe"
    )
)

if not defined CF (
    echo [1/3] cloudflared kuruluyor ^(Cloudflare resmi paketi, winget^)...
    echo [1/3] winget install Cloudflare.cloudflared >> "%LOG%"
    winget install --id Cloudflare.cloudflared -e --source winget --accept-source-agreements --accept-package-agreements >> "%LOG%" 2>&1
    if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
    if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
)
if not defined CF (
    echo [HATA] cloudflared kurulamadi. Ayrintilar: tunel_test.log
    echo [HATA] cloudflared bulunamadi >> "%LOG%"
    pause
    exit /b 1
)
echo       [OK] cloudflared: %CF%
"%CF%" --version >> "%LOG%" 2>&1

:: ---------- 2. Sunucu calisiyor mu? ----------
echo [2/3] Sunucu ^(localhost:3000^) kontrol ediliyor...
powershell -NoProfile -Command "exit [int](-not (Test-NetConnection 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue))"
if errorlevel 1 (
    echo       Sunucu kapali, SistemiBaslat.bat ayri pencerede aciliyor...
    echo       ^(Yonetici izni ^(UAC^) penceresi cikarsa EVET deyin.^)
    echo [2/3] SistemiBaslat.bat baslatildi >> "%LOG%"
    start "" "%~dp0SistemiBaslat.bat"
    powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ if(Test-NetConnection 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue){exit 0}; Start-Sleep 2 }; exit 1"
    if errorlevel 1 (
        echo [HATA] Sunucu 3 dakika icinde acilmadi. SistemiBaslat penceresine bakin.
        echo [HATA] port 3000 acilmadi >> "%LOG%"
        pause
        exit /b 1
    )
)
echo       [OK] Sunucu calisiyor.
echo [2/3] sunucu OK >> "%LOG%"

:: ---------- 3. Gecici tunel ----------
echo [3/3] Gecici tunel aciliyor... Adres birkac saniye icinde asagida
echo       "https://....trycloudflare.com" seklinde gorunecek.
echo.
echo [3/3] tunel baslatiliyor >> "%LOG%"
"%CF%" tunnel --no-autoupdate --url http://localhost:3000 --logfile "%LOG%" --loglevel info

echo.
echo Tunel kapandi.
echo [%date% %time%] Tunel kapandi >> "%LOG%"
pause
endlocal
