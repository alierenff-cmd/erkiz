@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Erkiz Mühendislik - İşçi Takip Sistemi v2.0

:: =====================================================================
::  Erkiz Mühendislik - İşçi Takip Sistemi v2.0 Başlatıcı
:: =====================================================================

:: Script'in bulunduğu klasör = proje kökü
set "PROJECT_DIR=%~dp0"
set "SERVER_DIR=%PROJECT_DIR%server"

:: ---------- 0. Yönetici Hakları Kontrolü ----------
net session >nul 2>&1
if errorlevel 1 (
    echo [BİLGİ] MySQL servisini başlatabilmek için yönetici hakları isteniyor...
    :: Scripti yönetici olarak yeni bir pencerede aç ve hata durumunda pencereyi kapatma (/k)
    powershell -Command "Start-Process cmd -ArgumentList '/k \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

cls
echo ======================================================
echo    ERKIZ MÜHENDİSLİK - İŞÇİ TAKİP SİSTEMİ v2.0
echo ======================================================
echo.

:: ---------- 1. Klasör kontrolü ----------
echo [1/6] Dosya kontrolü...
if not exist "%SERVER_DIR%\server.js" (
    echo [HATA] server\server.js bulunamadı!
    echo        Şu anki konum: %SERVER_DIR%
    pause
    exit /b 1
)
echo       [OK] Dosyalar mevcut.

:: ---------- 2. Node.js kontrolü ----------
echo [2/6] Node.js kontrol ediliyor...
node -v >nul 2>&1
if errorlevel 1 (
    echo [HATA] Node.js kurulu değil.
    echo        Lütfen https://nodejs.org adresinden LTS sürümünü kurun.
    pause
    exit /b 1
)
echo       [OK] Node.js mevcut.

:: ---------- 3. MySQL Başlatma ----------
echo [3/6] MySQL kontrol ediliyor...
netstat -ano | findstr :3306 >nul
if not errorlevel 1 (
    echo       [OK] MySQL 3306 portunda zaten çalışıyor.
) else (
    echo       [BİLGİ] MySQL çalışmıyor, servisler deneniyor...
    set "STARTED="
    for %%S in (MySQL84 MySQL80 MySQL81 MySQL82 MySQL83 MySQL MariaDB wampmysqld64 xamppmysql) do (
        if not defined STARTED (
            net start %%S >nul 2>&1
            if not errorlevel 1 (
                echo       [OK] %%S servisi başlatıldı.
                set "STARTED=1"
            )
        )
    )

    if not defined STARTED (
        if exist "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" (
            echo       [BİLGİ] mysqld.exe doğrudan başlatılıyor...
            start /b "" "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --datadir="C:\MySQLData" --console
            timeout /t 5 >nul
            netstat -ano | findstr :3306 >nul
            if not errorlevel 1 (
                echo       [OK] MySQL başarıyla başlatıldı.
                set "STARTED=1"
            )
        )
    )

    if not defined STARTED (
        echo [UYARI] MySQL başlatılamadı. Lütfen MySQL / XAMPP servisini ELLE başlatın.
        echo         Eğer MySQL zaten açıksa bu uyarıyı dikkate almayıp devam edebilirsiniz.
        pause
    )
)

:: ---------- 4. Güvenlik Duvarı ve Port 3000 Kontrolü ----------
echo [4/6] Güvenlik duvarı ve Port 3000 kontrol ediliyor...
netsh advfirewall firewall add rule name="Erkiz Port 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
netstat -ano | findstr /C:":3000 " | findstr /I "LISTENING" >nul
if not errorlevel 1 (
    echo [HATA] Port 3000 şu an başka bir uygulama tarafından kullanılıyor!
    echo        Lütfen diğer Node.js pencerelerini kapatıp tekrar deneyin.
    pause
    exit /b 1
)
echo       [OK] Port 3000 ve Güvenlik Duvarı izinleri hazır.

:: ---------- 5. Bağımlılıklar ----------
echo [5/6] Paketler kontrol ediliyor...
cd /d "%SERVER_DIR%"
if not exist "node_modules\" (
    echo       [BİLGİ] Paketler eksik, yükleniyor. Bu birkac dakika sürebilir...
    call npm.cmd install --no-fund --no-audit
    if errorlevel 1 (
        echo [UYARI] npm install sırasında sorun çıktı.
        pause
    )
)
echo       [OK] Paketler hazır.

:: ---------- 6. Sunucu Başlatma ----------
echo [6/6] Sunucu başlatılıyor...
echo.

:: Yerel ağ IP adresini bul
set "LAN_IP="
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /C:"IPv4"') do (
    if not defined LAN_IP (
        for /f "tokens=* delims= " %%j in ("%%i") do set "LAN_IP=%%j"
    )
)

echo ======================================================
echo  ERİŞİM ADRESLERİ
echo ======================================================
echo  Bu bilgisayardan: http://localhost:3000/login.html
if defined LAN_IP (
    echo  Aynı ağdaki cihazlardan: http://!LAN_IP!:3000/login.html
)
echo ======================================================
echo.

:: Tarayıcıyı aç
start "" "http://localhost:3000/login.html"

:: Sunucuyu başlat
node server.js

echo.
echo [BİLGİ] Sunucu durduruldu.
pause
endlocal
