@echo off
setlocal
chcp 65001 >nul
title Erkiz - Git Gizli Veri Temizligi

:: =====================================================================
::  Git deposundan kisisel veri (TC listeleri) ve gizli anahtarlari temizler.
::  ADIM 1: Dosyalari git takibinden cikarir, yerel gecici kopyalari siler, commit atar.
::  ADIM 2 (istege bagli): Dosyalari TUM GIT GECMISINDEN siler ve GitHub'a zorla gonderir.
:: =====================================================================

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
    echo [HATA] git bulunamadi. Git for Windows kurulu olmali.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [HATA] Bu klasor bir git deposu degil: %cd%
    pause
    exit /b 1
)

echo ======================================================
echo   ADIM 1 - Takipten cikarma ve yerel temizlik
echo ======================================================
echo.
echo Asagidaki dosyalar git takibinden cikarilacak:
echo   - server\scratch_seed\   (143 personelin TC + dogum tarihi, acilmis Excel)
echo   - server\scratch_xlsx\   (ayni Excel'in kopyasi)
echo   - server\temp_excel.zip, server\temp_seed.zip
echo   - server\certs\          (TLS ozel anahtari)
echo   - .artifacts\, server\err.log, server\out.log
echo.
echo Ayrica TC iceren gecici kopyalar (scratch_seed, scratch_xlsx, temp_*.zip)
echo bilgisayardan SILINECEK. Asil Excel dosyaniz (OneDrive) etkilenmez.
echo.
set /p ONAY1="Devam edilsin mi? (E/H): "
if /i not "%ONAY1%"=="E" (
    echo Iptal edildi.
    pause
    exit /b 0
)

git rm -r --cached --ignore-unmatch --quiet server/scratch_seed server/scratch_xlsx server/temp_excel.zip server/temp_seed.zip server/certs .artifacts server/err.log server/out.log

if exist "server\scratch_seed" rmdir /S /Q "server\scratch_seed"
if exist "server\scratch_xlsx" rmdir /S /Q "server\scratch_xlsx"
if exist "server\temp_excel.zip" del /Q "server\temp_excel.zip"
if exist "server\temp_seed.zip" del /Q "server\temp_seed.zip"

git add -A
git commit -m "security: kisisel veri ve gizli anahtarlari depodan cikar, guvenlik duzeltmeleri (v2.3)"
if errorlevel 1 (
    echo [BILGI] Commit atilmadi ^(degisiklik yok ya da git kullanici adi/e-posta ayarli degil^).
)

echo.
echo [OK] Adim 1 tamamlandi. Dosyalar artik yeni commit'lerde yok,
echo      ANCAK eski commit'lerde ve GitHub gecmisinde hala duruyorlar.
echo.

echo ======================================================
echo   ADIM 2 - Git GECMISINDEN kalici silme (onerilir)
echo ======================================================
echo.
echo Bu adim:
echo   - git-filter-repo aracini kurar (Python gerekir),
echo   - yukaridaki dosyalari TUM commit gecmisinden siler,
echo   - GitHub'a --force ile gonderir (gecmis yeniden yazilir).
echo.
echo Baska bilgisayarlarda bu deponun kopyasi varsa, o kopyalar silinip
echo yeniden clone edilmelidir. Oncesinde klasorun yedegini almaniz onerilir.
echo.
set /p ONAY2="Gecmis temizligi yapilsin mi? (E/H): "
if /i not "%ONAY2%"=="E" (
    echo Adim 2 atlandi.
    goto :son
)

for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set "ORIGIN_URL=%%u"
if not defined ORIGIN_URL (
    echo [HATA] origin adresi okunamadi.
    goto :son
)

python -m pip install --user --quiet git-filter-repo
if errorlevel 1 (
    echo [HATA] git-filter-repo kurulamadi. Python yuklu mu? ^(python --version^)
    goto :son
)

python -m git_filter_repo --force --invert-paths --path server/scratch_seed --path server/scratch_xlsx --path server/temp_excel.zip --path server/temp_seed.zip --path server/certs --path .artifacts
if errorlevel 1 (
    echo [HATA] Gecmis temizligi basarisiz oldu.
    goto :son
)

:: filter-repo guvenlik icin origin'i kaldirir; geri ekle.
git remote add origin "%ORIGIN_URL%" 2>nul
git push origin --force --all
git push origin --force --tags

echo.
echo [OK] Gecmis temizlendi ve GitHub'a gonderildi.

:son
echo.
echo ======================================================
echo   ELLE YAPMANIZ GEREKENLER
echo ======================================================
echo  1. GitHub'da depo ayarlarindan depoyu PRIVATE yapin (acik ise).
echo  2. Depo herkese acik kaldiysa: GitHub Support'a basvurup onbellekteki
echo     eski commit gorunumlerinin silinmesini isteyin.
echo  3. Sunucuda kullandiginiz MySQL sifreleri eski docker-compose.yml'deki
echo     ornek sifrelerle ayniysa DEGISTIRIN.
echo  4. server\certs\server.key kullaniliyorsa yeni sertifika uretin.
echo  5. TC verisi herkese acik bir depoda bulunduysa KVKK acisindan
echo     hukuk danismaninizla degerlendirin (72 saat bildirim yukumlulugu).
echo.
pause
endlocal
