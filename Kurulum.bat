@echo off
chcp 65001 >nul
title Erkiz Isci Takip - Ilk Kurulum

:: ===================================================================
::  ILK KURULUM SCRIPTI
::
::  Bu dosyayi SADECE BIR KEZ, ilk kurulumda calistirin.
::  Sirlari uretir, veritabanini kurar, kutuphaneleri indirir.
::
::  NOT: Bu script'te delayed expansion BILINCLI olarak KAPALI.
::  Acik olsaydi, icinde "!" gecen sifreler sessizce bozulurdu.
::  Sifre isleyen kisimlar Node tarafinda calisir.
:: ===================================================================

set "PROJECT_DIR=%~dp0"
set "SERVER_DIR=%PROJECT_DIR%server"

cls
echo ======================================================
echo    ERKIZ ISCI TAKIP - ILK KURULUM
echo ======================================================
echo.
echo Bu script:
echo   - Guvenlik anahtarlarini uretir
echo   - Admin sifresini olusturur
echo   - Veritabani semasini kurar
echo   - Gerekli kutuphaneleri indirir
echo.

choice /C EH /N /M "Devam edilsin mi? (E/H): "
if errorlevel 2 exit /b 0
echo.

:: ---------- On kontroller ----------
if not exist "%SERVER_DIR%\server.js" (
    echo [HATA] server\server.js bulunamadi.
    echo        Bu dosya proje ana klasorunde olmali.
    pause
    exit /b 1
)

echo "%PROJECT_DIR%" | findstr /I "OneDrive" >nul
if not errorlevel 1 (
    echo.
    echo [UYARI] Proje OneDrive klasorunde bulunuyor.
    echo         OneDrive dosyalari senkronize ederken kilitler; bu da
    echo         npm kurulumunda "EPERM" hatalarina yol acar.
    echo         Onerilen: projeyi C:\ErkizIsciTakip gibi bir klasore tasiyin.
    echo.
    choice /C EH /N /M "Yine de devam edilsin mi? (E/H): "
    if errorlevel 2 exit /b 1
    echo.
)

node -v >nul 2>&1
if errorlevel 1 (
    echo [HATA] Node.js kurulu degil. https://nodejs.org adresinden kurun.
    pause
    exit /b 1
)

cd /d "%SERVER_DIR%"

:: ---------- Surum tutarlilik kontrolu ----------
:: Eski v2 dosyalari yeni zip ustune karisirsa anlasilmaz Node hatalari cikar.
:: Yeni surumun imzasi: server\lib\password.js dosyasinin varligi.
if not exist "lib\password.js" (
    echo.
    echo ======================================================
    echo [HATA] Dosyalar eski surumden kalma.
    echo ======================================================
    echo.
    echo server\lib\password.js bulunamadi. Bu, klasorde eski
    echo surum dosyalarinin durdugu anlamina gelir.
    echo.
    echo COZUM:
    echo   1^) Bu klasoru tamamen silin: %PROJECT_DIR%
    echo   2^) Zip dosyasini bos bir klasore yeniden cikarin
    echo   3^) Kurulum.bat dosyasini tekrar calistirin
    echo.
    echo Not: Zip'i mevcut klasorun ustune cikarmak yetmez;
    echo eski dosyalar silinmedigi icin kalmaya devam eder.
    echo.
    pause
    exit /b 1
)


:: ---------- 1. Paketler ----------
echo [1/5] Paketler yukleniyor...

:: Eski surumden kalan bcrypt varsa node_modules bayattir.
:: Sadece klasorun varligina bakmak yeterli DEGIL - icerigi de dogrulanmali.
if exist "node_modules\bcrypt\" (
    echo       [BILGI] Eski surumden kalan bcrypt bulundu, temizleniyor...
    rmdir /S /Q "node_modules" 2>nul
    if exist "package-lock.json" del /Q "package-lock.json" 2>nul
)

:: Gerekli paketler gercekten yerinde mi?
:: NOT: burada "for + set + if %VAR%" kalibi KULLANILMAZ. Batch, blok icindeki
:: %VAR% degerini blok CALISMADAN once genisletir; bu yuzden dongude atanan
:: deger okunamaz ve kontrol her zaman eski sonucu verir. goto ile cozuldu.
for %%M in (express mysql2 helmet jsonwebtoken cookie-parser dotenv express-rate-limit) do (
    if not exist "node_modules\%%M\" goto :do_install
)

echo       [OK] Zaten yuklu.
goto :deps_done

:do_install
(
    echo       Bu birkac dakika surebilir...
    call npm install --no-fund --no-audit
    if errorlevel 1 (
        echo.
        echo ======================================================
        echo [HATA] Paket kurulumu basarisiz.
        echo ======================================================
        echo.
        echo Sik karsilasilan nedenler:
        echo.
        echo  1^) OneDrive klasoru: OneDrive dosyalari kilitler ve
        echo     "EPERM" hatasina yol acar. Projeyi OneDrive DISINA
        echo     tasiyin, ornegin: C:\ErkizIsciTakip
        echo.
        echo  2^) Internet baglantisi koptu ^(ECONNRESET^).
        echo     Tekrar deneyin.
        echo.
        echo  3^) Antivirus veya guvenlik duvari npm'i engelliyor.
        echo.
        pause
        exit /b 1
    )
    echo       [OK]
)

:deps_done
echo.

:: ---------- 2. Yapilandirma ----------
echo [2/5] Yapilandirma dosyasi hazirlaniyor...
call node tools/setup-env.js
if errorlevel 1 (
    echo.
    echo [HATA] Yapilandirma olusturulamadi.
    pause
    exit /b 1
)

:: ---------- 3. Veritabani ----------
echo [3/5] Veritabani semasi kuruluyor...
where mysql >nul 2>&1
if errorlevel 1 (
    echo       [UYARI] mysql komutu PATH'te yok.
    echo       Semayi elle kurun:
    echo         mysql -u root -p ^< server\schema.sql
) else (
    echo       MySQL root sifresi istenecek...
    mysql -u root -p < schema.sql
    if errorlevel 1 (
        echo       [UYARI] Sema kurulumu basarisiz olabilir, elle kontrol edin.
    ) else (
        echo       [OK] Sema kuruldu.
    )
)
echo.
echo       [BILGI] Uygulama kullanicisini henuz olusturmadiysaniz:
echo         mysql -u root -p
echo         CREATE USER 'erkiz_app'@'localhost' IDENTIFIED BY '^<sifreniz^>';
echo         GRANT SELECT,INSERT,UPDATE,DELETE ON erkiz_takip.* TO 'erkiz_app'@'localhost';
echo         FLUSH PRIVILEGES;
echo.

:: ---------- 4. Panel QR kutuphanesi ----------
echo [4/5] Panel QR kutuphanesi indiriliyor...
if not exist "public\vendor" mkdir "public\vendor"
if exist "public\vendor\qrcode.min.js" (
    echo       [OK] Zaten mevcut.
) else (
    call node tools/fetch-vendor.js qrcodejs qrcode.min.js public/vendor
    if errorlevel 1 echo       [UYARI] Indirilemedi, elle kurun.
)
echo.

:: ---------- 5. Android QR kutuphanesi ----------
echo [5/5] Android QR kutuphanesi indiriliyor...
if not exist "%PROJECT_DIR%app\src\main\assets\vendor" (
    mkdir "%PROJECT_DIR%app\src\main\assets\vendor"
)
if exist "%PROJECT_DIR%app\src\main\assets\vendor\html5-qrcode.min.js" (
    echo       [OK] Zaten mevcut.
) else (
    call node tools/fetch-vendor.js html5-qrcode html5-qrcode.min.js "%PROJECT_DIR%app/src/main/assets/vendor"
    if errorlevel 1 echo       [UYARI] Indirilemedi, elle kurun.
)

echo.
echo ======================================================
echo    KURULUM TAMAMLANDI
echo ======================================================
echo.
echo  Sistemi baslatmak icin: SistemiBaslat.bat
echo.
echo  [ONEMLI] server\.env dosyasi gizli anahtarlar icerir.
echo  Yedekleyin ama versiyon kontrolune (git) EKLEMEYIN.
echo.
pause
