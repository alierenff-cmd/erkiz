/**
 * Sunucu adresi. Bu dosya build sirasinda gradle tarafindan uretilmeli
 * (bkz. app/build.gradle.kts -> ERKIZ_API_BASE).
 *
 * Sabit tunel adresi (loca.lt) BILINCLI olarak kaldirildi:
 * localtunnel subdomainleri herkese acik ve baskasi tarafindan kapilabilir;
 * bu durumda TC kimlik numaralari yabanci bir sunucuya akar.
 * Kendi domaininizi ve gecerli TLS sertifikanizi kullanin.
 */
window.ErkizConfig = {
    // Uretim sunucusu. Yerel agda test icin DEBUG APK'da Ayarlar > Sunucu Adresi
    // alanina http://<bilgisayar-ip>:3000 girilebilir (release APK http kabul etmez).
    apiBase: 'https://www.erkiztakip.com'
};
