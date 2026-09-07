# Erkiz Mühendislik — İşçi Takip Sistemi v2.0

QR kod tabanlı saha giriş-çıkış takibi. Android (WebView) istemci + Node.js/MySQL sunucu.

---

## v1'e göre neler değişti

### Güvenlik

| Sorun (v1) | Çözüm (v2) |
|---|---|
| `X-API-KEY` APK içinde açık metin | Kaldırıldı. Cihaz kaydı + 15 dk ömürlü JWT |
| `allowUniversalAccessFromFileURLs = true` | Kapatıldı. `WebViewAssetLoader` ile `https://` origin |
| `usesCleartextTraffic="true"` | Kapatıldı + `network_security_config` ile HTTPS zorunlu |
| `MIXED_CONTENT_ALWAYS_ALLOW` | `MIXED_CONTENT_NEVER_ALLOW` |
| `onPermissionRequest` koşulsuz `grant()` | Origin + kaynak türü kontrolü, runtime izin akışı |
| admin.js `innerHTML` → XSS | Tüm hücreler `createElement` + `textContent` |
| Sabit `loca.lt` tünel adresi | `BuildConfig` üzerinden yapılandırılabilir domain |
| CDN'den `html5-qrcode` | Yerel `vendor/` klasörü |
| TC No düz metin | HMAC hash (arama) + AES-256-GCM (saklama), panelde maskeli |
| Rate limit yok | Login 8/15dk, işlem 10/dk, cihaz kaydı 20/saat |
| Admin şifresi belirsiz | scrypt (Node çekirdeği), `.env`'den |
| `allowBackup="true"` | Kapatıldı, yedek kuralları kişisel veriyi dışlıyor |

### Yeni: Konum bilgisi

- Giriş/çıkış anında **tek seferlik** koordinat alınır. Arka plan takibi **yok**.
- Yalnızca açık rıza varsa istenir; rıza yoksa `navigator.geolocation` hiç çağrılmaz.
- Konum alınamazsa işlem **durmaz**, kayıt konumsuz oluşur.
- 6 ondalık basamağa yuvarlanır (veri minimizasyonu).
- Sunucu, rıza olmadan gelen konumu **kaydetmez** (istemci gönderse bile).
- Koordinatlar 90 gün sonra otomatik `NULL`'lanır; puantaj kaydı kalır.

### Yeni: KVKK açık rıza akışı

- İlk açılışta aydınlatma metni + iki ayrı onay kutusu:
  - **Zorunlu:** kimlik ve giriş-çıkış verisi (bilgilendirme onayı)
  - **İsteğe bağlı:** konum verisi (ayrı, granüler açık rıza)
- Rıza kaydı zaman damgası + metin sürümüyle saklanır ve her istekte sunucuya
  kanıt olarak gönderilir (KVKK ispat yükümlülüğü).
- Aydınlatma metni değişirse `CONSENT_VERSION` artırılır → rıza yeniden alınır.
- Kullanıcı istediği zaman konum rızasını kapatabilir veya tüm rızasını geri alabilir.
- Admin erişimleri `admin_access_log` tablosuna yazılır.

### Temizlik

Kullanılmayan Compose, Firebase AI ve "Baking with Gemini" şablon kodu tamamen
kaldırıldı. Bağımlılıklar 15+ artifact'tan 3'e indi (`core-ktx`, `activity-ktx`, `webkit`).

---

## Kurulum

### Windows (kolay yol)

```
1. Kurulum.bat        <- sadece ilk seferde
2. SistemiBaslat.bat  <- her acilista
```

`Kurulum.bat` güvenlik anahtarlarını üretir, admin şifresini oluşturur,
veritabanını kurar ve QR kütüphanelerini indirir.
`SistemiBaslat.bat` MySQL'i başlatır, yapılandırmayı doğrular, sunucuyu
çalıştırır ve tarayıcıyı açar.

Batch dosyaları hakkında iki not:

- Şifre girişi bilinçli olarak Node tarafında (`tools/setup-env.js`) yapılıyor.
  Batch'te `EnableDelayedExpansion` açıkken içinde `!` geçen şifreler sessizce
  bozulur — kullanıcı doğru girdiğini sanır, giriş çalışmaz. Bu tuzağa
  düşmemek için şifreye dokunan hiçbir iş batch'te yapılmıyor.
- v1'deki `localtunnel` adımı **kaldırıldı**. Gerekçe aşağıda.

### Manuel kurulum (Linux / macOS)

```bash
cd server
npm install
npm run setup                    # .env üretir
mysql -u root -p < schema.sql

# Uygulama kullanıcısı
mysql -u root -p -e "CREATE USER 'erkiz_app'@'localhost' IDENTIFIED BY '<şifre>'; \
  GRANT SELECT,INSERT,UPDATE,DELETE ON erkiz_takip.* TO 'erkiz_app'@'localhost'; \
  FLUSH PRIVILEGES;"

npm start
```

### Amazon VPS (AWS Lightsail / EC2 - Ubuntu) Tek Tıkla Kurulum

AWS Lightsail veya EC2 üzerinde bir **Ubuntu 22.04 / 24.04** örneği açtıktan sonra:

1. **AWS Güvenlik Grubu (Security Group) Ayarları:**
   * Port `22` (SSH): Sizin IP'niz
   * Port `80` (HTTP): `0.0.0.0/0`
   * Port `443` (HTTPS): `0.0.0.0/0`
   *(Port 3000 ve 3306'yı dışarıya AÇMAYIN; Nginx içeriden güvenle yönlendirir).*

2. **Sunucuda Kurulum Betiğini Çalıştırın:**
```bash
git clone https://github.com/alierenff-cmd/erkiz.git
cd erkiz/server
sudo bash setup-amazon-vps.sh
```
Bu betik Node.js 20, MySQL, Nginx, UFW ve PM2'yi otomatik kurar, veritabanını oluşturur ve uygulamayı 7/24 çalışır hale getirir.

3. **Ücretsiz SSL (HTTPS) Kurulumu:**
```bash
sudo certbot --nginx -d takip.erkizmuhendislik.com
```

4. **Docker İle Dağıtım (Alternatif):**
```bash
docker compose up -d
```


### Android

```bash
echo "ERKIZ_API_BASE=https://takip.erkizmuhendislik.com" >> gradle.properties
./gradlew assembleRelease
```

QR kütüphaneleri (`html5-qrcode`, `qrcodejs`) zip içinde hazır geliyor.
Güncellemek isterseniz:

```bash
cd server
npm run fetch-vendor html5-qrcode html5-qrcode.min.js ../app/src/main/assets/vendor
```

Her indirmede yanına `.sha256` dosyası yazılır; sürüm değişikliğini böyle fark edersiniz.

---

## Sorun giderme

**`npm install` EPERM hatası veriyor**
Proje OneDrive klasöründe. OneDrive dosyaları senkronize ederken kilitler.
Projeyi `C:\ErkizIsciTakip` gibi senkronize edilmeyen bir klasöre taşıyın.

**Kurulum "Python bulunamadı" diyor**
v2'de bu sorun giderildi. Şifre hashleme artık Node'un dahili `crypto.scrypt`
fonksiyonuyla yapılıyor; `bcrypt` bağımlılığı kaldırıldı. Projede **hiç native
modül yok**, dolayısıyla Python veya C++ derleyicisi gerekmiyor.

Eski bir `node_modules` klasörü duruyorsa silin ve tekrar deneyin:
```
rmdir /S /Q server\node_modules
del server\package-lock.json
```

**MySQL başlatılamıyor**
`SistemiBaslat.bat` dosyasını yönetici olarak çalıştırın veya MySQL'i
Hizmetler (services.msc) üzerinden elle başlatın.

**Admin girişi çalışmıyor**
`.env` içindeki `ADMIN_PASSWORD_HASH` değeri `scrypt$` ile başlamalı.
Şifreyi sıfırlamak için:
```
cd server
npm run hash-password "yeni-sifreniz"
```
Çıkan satırı `.env` dosyasındaki eski satırla değiştirin.

---

## Yapmanız gerekenler

Bu kod güvenlik açıklarını kapatır ama şunlar sizin sorumluluğunuzda:

1. **Gerçek domain + TLS sertifikası.** `loca.lt` üretimde kullanılamaz — subdomain'i
   başkası kapabilir ve TC kimlik numaraları yabancı bir sunucuya akar.
   Let's Encrypt ücretsiz, Caddy veya nginx ile 10 dakikada kurulur.

2. **VERBİS kaydı.** Çalışan sayınıza ve ciroya göre Veri Sorumluları Sicili'ne
   kayıt zorunlu olabilir.

3. **Aydınlatma metnini avukatınıza onaylatın.** `index.html` içindeki metin bir
   taslaktır, hukuki görüş değildir. Şirketinizin gerçek saklama süreleri,
   veri sorumlusu bilgileri ve başvuru kanalıyla güncellenmelidir.

4. **Konumun hukuki dayanağını gözden geçirin.** İş hukukunda çalışandan alınan
   rızanın "özgür irade" sayılıp sayılmayacağı tartışmalıdır (astlık-üstlük ilişkisi).
   Konum takibi için rıza yerine meşru menfaat dayanağı ve bir
   **denge testi** dokümanı hazırlamak daha sağlam olabilir. Bu noktada
   KVKK konusunda uzman bir hukukçuya danışın.

5. **Cihaz onay akışı.** Şu an herhangi bir cihaz kaydolabiliyor. Gerçek koruma için
   yeni cihazların admin tarafından onaylanması (`devices.blocked` kolonu hazır)
   veya işçiye tek kullanımlık kod gönderilmesi önerilir.

6. **QR kod sahteciliği.** Saha QR'ı statik bir metin; fotoğrafını çeken biri
   sahada olmadan giriş yapabilir. Konum doğrulaması bunu kısmen azaltır —
   sunucuda "koordinat saha sınırları içinde mi" kontrolü eklemeyi düşünün.

7. **Yedekleme ve olay müdahale planı.** Kişisel veri ihlali durumunda KVKK'ya
   72 saat içinde bildirim zorunludur.

---

## Dosya yapısı

```
ErkizIsciTakip/
├── app/src/main/
│   ├── java/com/erkiz/iscitakip/
│   │   ├── MainActivity.kt      WebView barındırma, izin akışı
│   │   └── NativeBridge.kt      JS'e açılan dar yüzey
│   ├── assets/
│   │   ├── index.html           Rıza + form + tarayıcı ekranları
│   │   ├── consent.js           Rıza durumu yönetimi
│   │   ├── api.js               Token'lı API istemcisi
│   │   ├── app.js               Doğrulama, tarama, konum
│   │   ├── config.js            Sunucu adresi
│   │   └── vendor/              html5-qrcode (yerel)
│   └── res/xml/                 Ağ güvenliği, yedek kuralları
├── server/
│   ├── server.js                API + kimlik doğrulama + saklama görevi
│   ├── schema.sql               Şifreli TC, konum, erişim logu
│   ├── lib/password.js          scrypt hashleme (native modül yok)
│   ├── tools/
│   │   ├── setup-env.js         .env üretimi (şifre girişi burada)
│   │   ├── hash-password.js     scrypt hash üretici
│   │   └── fetch-vendor.js      Kütüphane indirici + SHA-256
│   └── public/                  Admin paneli (XSS-güvenli)
├── Kurulum.bat                  İlk kurulum (bir kez)
└── SistemiBaslat.bat            Günlük başlatma
```
