# Admin Paneli Apple Style ( iOS) Yeniden Tasarım Planı

Bu plan, yönetici panelinin (giriş ve ana panel) görünümünü mobil uygulama ile uyumlu hale getirerek Apple'ın modern (iOS 17+) tasarım diline taşımayı hedefler.

## Tasarım Hedefleri
- **Görsel Bütünlük:** Mobil uygulama ile aynı renk paleti (`#F2F2F7` arka plan) ve tipografinin kullanılması.
- **Modern Tablo Görünümü:** Veri listesinin daha ferah, ayıraçlı ve iOS liste stiline uygun hale getirilmesi.
- **Temiz Giriş Ekranı:** Yönetici girişi için sade ve şık bir kart tasarımı.

## Proposed Changes

### [Admin Paneli - Arayüz]

#### [MODIFY] [style.css](file:///C:/ErkizIsciTakip/server/public/style.css)
- Mobil uygulamadaki iOS 17 değişkenleri ve temel stiller buraya aktarılacak.
- Koyu tema tamamen kaldırılıp açık temaya geçilecek.

#### [MODIFY] [admin.css](file:///C:/ErkizIsciTakip/server/public/admin.css)
- Tablo (`table`) tasarımı iOS "Grouped" liste stiline yaklaştırılacak.
- Başlıklar ve butonlar Apple standartlarına göre (`#007AFF` mavi) güncellenecek.
- "Saha QR Üret" paneli şık bir iOS kartına dönüştürülecek.

#### [MODIFY] [login.html](file:///C:/ErkizIsciTakip/server/public/login.html)
- Giriş formu iOS "Inset Grouped" kart yapısına alınacak.

#### [MODIFY] [admin.html](file:///C:/ErkizIsciTakip/server/public/admin.html)
- Sayfa yapısı iOS 17'nin geniş ekran (iPadOS/macOS) estetiğine uygun olarak revize edilecek.

## User Review Required

> [!NOTE]
> **Tema Uyumu:** Admin paneli de mobil uygulama gibi **Açık Tema** (Light Mode) olarak tasarlanacaktır. Tablo verilerinin okunabilirliği için bu en iyi sonucu verecektir.

## Verification Plan

### Manuel Doğrulama
1.  Giriş ekranının iOS estetiğine uygunluğu (zarif butonlar, temiz inputlar) kontrol edilecek.
2.  Yönetici panelindeki kayıt tablosunun yeni tasarımı (renkler, satır aralıkları) test edilecek.
3.  "QR Üret" bölümünün kart yapısı doğrulanacak.
