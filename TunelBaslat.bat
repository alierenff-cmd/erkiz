@echo off
setlocal
chcp 65001 >nul
title Erkiz İşçi Takip - Tünel Başlatıcı

echo ======================================================
echo    ERKIZ İŞÇİ TAKİP - DIŞ ERİŞİM TÜNELİ
echo ======================================================
echo.
echo [DİKKAT] Tünel servisleri (localtunnel, ngrok vb.) verilerinizi
echo          ara sunucular üzerinden geçirir. Hassas veriler için
echo          bu yöntemi SADECE TEST amaçlı kullanın.
echo.

echo [1/2] localtunnel kontrol ediliyor...
:: npx.cmd kullanarak PowerShell kısıtlamalarını aşmayı dene
call npx.cmd localtunnel --version >nul 2>&1
if errorlevel 1 (
    echo [HATA] localtunnel yüklü değil veya npx çalışmıyor.
    echo        Lütfen "npm install -g localtunnel" komutunu çalıştırın.
    pause
    exit /b 1
)

echo.
echo [BİLGİ] Tünel başlatılıyor... (Port 3000)
echo.

:: npx.cmd ile tüneli başlat
call npx.cmd localtunnel --port 3000

echo.
echo Tünel kapandı.
pause
endlocal
