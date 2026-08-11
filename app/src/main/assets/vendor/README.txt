html5-qrcode.min.js dosyasini buraya yerlestirin.

Onceki surumde bu kutuphane CDN'den (unpkg.com) cekiliyordu. Bu:
  - internet olmadan uygulamayi calismaz hale getiriyordu,
  - CDN ele gecirilirse kamera erisimi olan bir sayfaya rastgele kod enjekte
    edilmesine acik birakiyordu.

Indirme:
  npm pack html5-qrcode
  tar -xzf html5-qrcode-*.tgz
  cp package/html5-qrcode.min.js app/src/main/assets/vendor/

Surumu sabitleyin ve SHA-256 ozetini kaydedin.
