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
    apiBase: 'http://10.15.2.64:3000'
};
