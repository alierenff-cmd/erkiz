/**
 * Erkiz Isci Takip - istemci mantigi.
 *
 * Onceki surume gore degisenler:
 *  - Sabit kodlanmis API anahtari KALDIRILDI. Kimlik dogrulama sunucuda,
 *    cihaz kaydi + kisa omurlu token uzerinden yapilir.
 *  - Sunucu adresi koda gomulu degil; config.js'ten (build sirasinda uretilir) okunur.
 *  - inline onclick yok (CSP uyumu), tum olaylar addEventListener ile.
 *  - TC No algoritmik olarak dogrulaniyor.
 *  - Konum: sadece riza varsa; giris/cikis aninda ve acik mesai boyunca
 *    (18:00'e kadar) 15 dakikada bir. Riza yoksa konum hic istenmez.
 *  - TC No cihazda SAKLANMAZ (yalnizca ad-soyad hatirlanir).
 */
(function () {
    'use strict';

    /* ---------------- Durum ---------------- */
    let scanner = null;
    let scanning = false;
    let currentMode = null;
    let busy = false;

    const el = id => document.getElementById(id);

    const views = {
        consent:  el('view-consent'),
        form:     el('view-form'),
        scanner:  el('view-scanner'),
        settings: el('view-settings')
    };

    function show(name) {
        Object.keys(views).forEach(k => { views[k].hidden = (k !== name); });
    }

    /* ---------------- Yardimcilar ---------------- */

    function setStatus(text, kind) {
        const div = el('status-message');
        div.textContent = text || '';
        div.className = 'status' + (kind ? ' status-' + kind : '');
        div.hidden = !text;
    }

    function fieldError(errId, message) {
        const span = el(errId);
        span.textContent = message || '';
        span.hidden = !message;
    }

    function clearErrors() {
        ['err-tc', 'err-first', 'err-last', 'err-activity'].forEach(id => fieldError(id, ''));
    }

    /**
     * T.C. Kimlik No dogrulama (resmi algoritma).
     * Yanlis veri girisini kaynaginda engeller - sunucu tarafinda da tekrarlanmali.
     */
    function isValidTC(value) {
        if (!/^[1-9][0-9]{10}$/.test(value)) return false;
        const d = value.split('').map(Number);
        const oddSum  = d[0] + d[2] + d[4] + d[6] + d[8];
        const evenSum = d[1] + d[3] + d[5] + d[7];
        const digit10 = ((oddSum * 7) - evenSum) % 10;
        if (digit10 !== d[9]) return false;
        const total = d.slice(0, 10).reduce((a, b) => a + b, 0);
        return (total % 10) === d[10];
    }

    function validateForm(mode) {
        clearErrors();
        let ok = true;

        const tc = el('tc_no').value.trim();
        const first = el('first_name').value.trim();
        const last = el('last_name').value.trim();
        const project = el('project') ? el('project').value.trim() : '';
        const activity = el('activity') ? el('activity').value.trim() : '';

        if (!isValidTC(tc)) {
            fieldError('err-tc', 'Geçerli bir T.C. kimlik numarası giriniz.');
            ok = false;
        }
        if (first.length < 2) {
            fieldError('err-first', 'Adınızı giriniz.');
            ok = false;
        }
        if (last.length < 2) {
            fieldError('err-last', 'Soyadınızı giriniz.');
            ok = false;
        }
        if (mode === 'in' && !project) {
            fieldError('err-project', 'Lütfen bir proje seçiniz.');
            ok = false;
        }
        if (mode === 'in' && !activity) {
            fieldError('err-activity', 'Lütfen bir aktivite seçiniz.');
            ok = false;
        }
        if (!ok) {
            setStatus('Lütfen kırmızı renkli hataları kontrol ediniz.', 'error');
        } else {
            setStatus('');
        }
        return ok ? { tc_no: tc, first_name: first, last_name: last, project: project, activity: activity } : null;
    }

    /* ---------------- Konum ---------------- */

    // Android WebView Mojo BarcodeDetector NPE çökmesini önlemek için devre dışı bırak
    try {
        if ('BarcodeDetector' in window) {
            delete window.BarcodeDetector;
        }
    } catch (e) {}

    /* ---------------- Konum ---------------- */

    let cachedLocation = null;
    let cachedLocationTime = 0;
    let locationWatchId = null;
    let lastLocationError = null;

    function formatPosition(pos) {
        if (!pos || !pos.coords) return null;
        return {
            latitude: round6(pos.coords.latitude),
            longitude: round6(pos.coords.longitude),
            accuracy_m: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
            captured_at: new Date(pos.timestamp || Date.now()).toISOString()
        };
    }

    /**
     * watchPosition ile cihazın konum servisini sürekli sıcak tutar.
     * Cihaz şebeke, Wi-Fi veya GPS üzerinden bir konum yakaladığında anında cachedLocation'a yazar.
     */
    function startLocationWatcher() {
        if (!Consent.allowsLocation() || !navigator.geolocation) return;
        if (locationWatchId !== null) return;

        try {
            locationWatchId = navigator.geolocation.watchPosition(
                pos => {
                    const formatted = formatPosition(pos);
                    if (formatted) {
                        cachedLocation = formatted;
                        cachedLocationTime = Date.now();
                        lastLocationError = null;
                        console.log('watchPosition güncel konum aldı:', formatted);
                    }
                },
                err => {
                    lastLocationError = err;
                    console.warn('watchPosition bildirimi:', err.message || err.code);
                },
                { enableHighAccuracy: false, maximumAge: 300000, timeout: 20000 }
            );
        } catch(e) {
            console.warn('watchPosition başlatılamadı:', e);
        }
    }

    /**
     * Uygulama açılır açılmaz veya rıza verildiğinde konumu arka planda hazırlamaya başlar.
     */
    function warmupLocation() {
        if (!Consent.allowsLocation()) return;
        startLocationWatcher();

        // Ayrıca hemen bir hızlı sorgu atarak önbelleği doldur
        if (navigator.geolocation && (!cachedLocation || (Date.now() - cachedLocationTime > 300000))) {
            try {
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        const formatted = formatPosition(pos);
                        if (formatted) {
                            cachedLocation = formatted;
                            cachedLocationTime = Date.now();
                            lastLocationError = null;
                        }
                    },
                    () => {},
                    { enableHighAccuracy: false, maximumAge: 900000, timeout: 4000 }
                );
            } catch(e) {}
        }
    }

    let backgroundLocationPromise = null;

    /**
     * Kullanıcı Giriş/Çıkış butonuna bastığı an veya formdayken arka planda konumu paralel sorgulamaya başlar.
     * Böylece QR okutulduğunda konum çoktan hazır olur!
     */
    function startLocationCaptureInBackground() {
        if (!Consent.allowsLocation() || !navigator.geolocation) return;
        if (cachedLocation && (Date.now() - cachedLocationTime < 300000)) return;

        backgroundLocationPromise = new Promise(resolve => {
            let done = false;
            const timer = setTimeout(() => {
                if (!done) {
                    done = true;
                    resolve(cachedLocation || null);
                }
            }, 10000);

            const onLoc = pos => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const formatted = formatPosition(pos);
                if (formatted) {
                    cachedLocation = formatted;
                    cachedLocationTime = Date.now();
                    lastLocationError = null;
                    console.log('Arka plan konum hazır:', formatted);
                }
                resolve(formatted || cachedLocation || null);
            };

            const onErr = err => {
                lastLocationError = err;
                console.warn('Arka plan konum denemesi hatası:', err.message || err.code);
            };

            // 1. Ağ / Wi-Fi / Önbellek konumu (hızlı)
            try {
                navigator.geolocation.getCurrentPosition(
                    onLoc,
                    onErr,
                    { enableHighAccuracy: false, timeout: 6000, maximumAge: 900000 }
                );
            } catch(e) {}

            // 2. GPS Hassas konum (paralel)
            try {
                navigator.geolocation.getCurrentPosition(
                    onLoc,
                    onErr,
                    { enableHighAccuracy: true, timeout: 9500, maximumAge: 60000 }
                );
            } catch(e) {}
        });
    }

    /**
     * Tek seferlik konum alir.
     * 1. Son 10 dakika içindeki önbellek varsa ANINDA (0 ms) döner.
     * 2. Arka planda devam eden sorgu varsa sonucunu bekler.
     * 3. Hem Şebeke/Wi-Fi hem de GPS uydularını PARALEL olarak sorgular; hangisi önce gelirse alır.
     * @returns {Promise<object|null>}
     */
    async function captureLocation() {
        if (!Consent.allowsLocation()) return null;

        // 1. Son 10 dakika içinde alınmış geçerli konum varsa hiç bekleme, anında döndür!
        if (cachedLocation && (Date.now() - cachedLocationTime < 600000)) {
            console.log('Önbellekteki güncel konum kullanıldı:', cachedLocation);
            return cachedLocation;
        }

        // Android native izni henüz verilmemişse, kullanıcıdan izni iste ve yanıtı bekle
        if (window.AndroidBridge && !AndroidBridge.hasLocationPermission()) {
            setStatus('Lütfen ekranda açılan konum iznini onaylayın…', 'info');
            const granted = await new Promise(resolve => {
                let done = false;
                window.NativeEvents = window.NativeEvents || {};
                window.NativeEvents.onLocationPermissionGranted = () => {
                    if (!done) { done = true; resolve(true); }
                };
                window.NativeEvents.onLocationPermissionDenied = () => {
                    if (!done) { done = true; resolve(false); }
                };
                AndroidBridge.requestLocationPermission();
                setTimeout(() => { if (!done) { done = true; resolve(false); } }, 10000);
            });
            if (!granted) {
                lastLocationError = { code: 1, message: 'İzin reddedildi' };
                console.warn('Konum izni kullanıcı tarafından verilmedi');
                return null;
            }
        }

        if (!navigator.geolocation) return null;

        // Arka planda devam eden bir sorgu varsa önce onu bekle
        if (backgroundLocationPromise) {
            const bgRes = await Promise.race([
                backgroundLocationPromise,
                new Promise(r => setTimeout(() => r(null), 5000))
            ]);
            if (bgRes) return bgRes;
        }

        return new Promise(resolve => {
            let done = false;
            const timer = setTimeout(() => {
                if (!done) {
                    done = true;
                    if (cachedLocation) {
                        resolve(cachedLocation);
                    } else {
                        lastLocationError = lastLocationError || { code: 3, message: 'Zaman aşımı (Konum servisi yanıt vermedi)' };
                        console.warn('Konum alma zaman aşımına uğradı');
                        resolve(null);
                    }
                }
            }, 10000);

            const finish = loc => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (loc) {
                    cachedLocation = loc;
                    cachedLocationTime = Date.now();
                    lastLocationError = null;
                }
                resolve(loc || cachedLocation || null);
            };

            const onErr = err => {
                lastLocationError = err;
                console.warn('Konum alma hatası:', err.message || err.code);
            };

            // PARALEL SORGULAMA: Ağ ve GPS aynı anda çalışır, hangisi önce biterse o kazanır!
            try {
                navigator.geolocation.getCurrentPosition(
                    pos => finish(formatPosition(pos)),
                    onErr,
                    { enableHighAccuracy: false, timeout: 6000, maximumAge: 900000 }
                );
            } catch(e) {}

            try {
                navigator.geolocation.getCurrentPosition(
                    pos => finish(formatPosition(pos)),
                    onErr,
                    { enableHighAccuracy: true, timeout: 9500, maximumAge: 60000 }
                );
            } catch(e) {}
        });
    }

    function readPosition() {
        return captureLocation();
    }

    /** ~10 cm hassasiyet yeterli; gereksiz basamak saklamiyoruz (veri minimizasyonu). */
    function round6(n) {
        return Math.round(n * 1e6) / 1e6;
    }

    /* ---------------- QR Tarayici ---------------- */

    async function startScanner(mode) {
        const form = validateForm(mode);
        if (!form) return;

        // Kamera açıldığı andan itibaren arka planda konum almaya başla
        startLocationCaptureInBackground();

        if (window.AndroidBridge && !AndroidBridge.hasCameraPermission()) {
            setStatus('Kamera izni isteniyor…', 'info');
        }

        currentMode = mode;
        const titleEl = el('scanner-title');
        if (titleEl) {
            titleEl.textContent =
                mode === 'in' ? 'Giriş — saha QR kodunu okutun'
                              : 'Çıkış — saha QR kodunu okutun';
        }
        el('scanner-hint').textContent = 'QR kodu kameraya gösterin (tüm ekran taranır)';
        el('scanner-hint').style.color = '#fff';
        show('scanner');
        setStatus('');

        try {
            await stopScanner();

            // DOM'un render edilmesi ve boyutların kesinleşmesi için kısa bekleme
            await new Promise(r => setTimeout(r, 150));

            scanner = new Html5Qrcode('reader', {
                formatsToSupport: [ 0 ], // 0 = QR_CODE (Html5QrcodeSupportedFormats.QR_CODE). Sadece QR tarayarak 10 kat hızlandırır!
                verbose: false,
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: false // Mojo çökmesini önlemek için kesinlikle false
                }
            });

            // qrbox kaldırıldı: Kamera tüm kadrajı tarayacak, böylece QR kod kadrajın neresinde olursa olsun anında yakalanır!
            const qrConfig = {
                fps: 15,
                disableFlip: false
            };

            scanning = true;

            try {
                await scanner.start(
                    { facingMode: "environment" },
                    qrConfig,
                    onScanSuccess,
                    () => { /* her karede tetiklenir, sessiz gecilir */ }
                );
            } catch (envErr) {
                console.warn('Arka kamera açılamadı, alternatif ön kamera deneniyor:', envErr);
                await scanner.start(
                    { facingMode: "user" },
                    qrConfig,
                    onScanSuccess,
                    () => {}
                );
            }

            // Sürekli otomatik odaklama (continuous autofocus) kısıtlamasını uygula
            try {
                const videoEl = document.querySelector('#reader video');
                if (videoEl && videoEl.srcObject && typeof videoEl.srcObject.getVideoTracks === 'function') {
                    const tracks = videoEl.srcObject.getVideoTracks();
                    if (tracks.length > 0) {
                        const track = tracks[0];
                        const caps = track.getCapabilities ? track.getCapabilities() : {};
                        if (caps.focusMode && caps.focusMode.includes('continuous')) {
                            track.applyConstraints({
                                advanced: [{ focusMode: 'continuous' }]
                            }).catch(() => {});
                        }
                    }
                }
            } catch(afErr) {}
        } catch (err) {
            console.error('Kamera baslatma hatasi:', err);
            scanning = false;
            if (el('scanner-hint')) {
                el('scanner-hint').textContent = '⚠️ Kamera açılamadı: ' + (err.message || err) + ' — Aşağıdaki "Kodu Elle Gir" butonunu kullanabilirsiniz.';
                el('scanner-hint').style.color = '#ffbaba';
            }
        }
    }

    async function stopScanner() {
        scanning = false;
        if (scanner) {
            try {
                scanner.shouldScan = false;
                if (scanner.foreverScanTimeout) {
                    clearTimeout(scanner.foreverScanTimeout);
                    scanner.foreverScanTimeout = null;
                }
            } catch (e) {}

            try {
                const videos = document.querySelectorAll('#reader video');
                videos.forEach(v => {
                    try {
                        if (v.srcObject && typeof v.srcObject.getTracks === 'function') {
                            v.srcObject.getTracks().forEach(t => {
                                try { t.stop(); } catch(te) {}
                            });
                        }
                        v.pause();
                        v.srcObject = null;
                    } catch(ve) {}
                });
            } catch (e) {}

            try {
                if (scanner.renderedCamera) {
                    if (scanner.renderedCamera.mediaStream) {
                        scanner.renderedCamera.mediaStream.getTracks().forEach(t => {
                            try { t.stop(); } catch(te) {}
                        });
                    }
                    scanner.renderedCamera.close().catch(() => {});
                    scanner.renderedCamera = null;
                }
            } catch (e) {}

            try {
                if (typeof scanner.stop === 'function') {
                    await scanner.stop().catch(() => {});
                }
            } catch (e) {}

            try {
                const r = el('reader');
                if (r) r.innerHTML = '';
            } catch (e) {}

            scanner = null;
        }
    }

    async function onScanSuccess(decodedText) {
        if (busy) return;
        busy = true;

        try {
            console.log('QR kod basariyla okundu:', decodedText);

            // Legacy Shift-JIS kurtarma
            let cleanText = String(decodedText || '').trim();
            if (cleanText.includes('ｿﾅ淌') || cleanText.includes('ﾅ淌ｶ') || cleanText.includes('淌ｶ')) {
                cleanText = 'şölen';
            }

            // 1. Oncelikle kamerayi ve tarama dongusunu tamamen temiz durdur
            await stopScanner();

            // 2. Ekranı hemen form görünümüne al
            show('form');
            setStatus('QR kod okundu, kayıt gönderiliyor…', 'info');

            // 3. Sunucuya gönderimi tamamla
            await submitAction(cleanText);
        } catch (err) {
            console.error('Scan success error:', err);
            setStatus('İşlem hatası: ' + (err.message || err), 'error');
        } finally {
            busy = false;
        }
    }

    /* ---------------- Sunucuya gonderim ---------------- */

    async function submitAction(qrData) {
        const form = validateForm(currentMode);
        if (!form) return;

        setStatus('Konum alınıyor, lütfen bekleyin…', 'info');
        let location = null;
        try {
            location = await captureLocation();
        } catch (locErr) {
            console.warn('Konum alma atlandı:', locErr);
        }

        if (location) {
            setStatus('Konum alındı, kayıt gönderiliyor…', 'info');
        } else if (Consent.allowsLocation()) {
            const errDetail = lastLocationError ? (' (' + (lastLocationError.message || ('Hata ' + lastLocationError.code)) + ')') : '';
            const proceed = confirm(
                '⚠️ Cihaz Konumu Alınamadı' + errDetail + '!\n\n' +
                'Telefonunuzun üst bildirim menüsünden "Konum" (GPS) servisinin AÇIK olduğundan emin olunuz.\n\n' +
                '• TAMAM: Konum eklemeden işleme devam et\n' +
                '• İPTAL: Geri dön, telefonun konumunu açıp tekrar dene'
            );
            if (!proceed) {
                setStatus('Lütfen telefonunuzun Konum servisini açıp işlemi tekrarlayın.', 'warn');
                return;
            }
            setStatus('Kayıt konumsuz gönderiliyor…', 'warn');
        }

        const payload = {
            tc_no: form.tc_no,
            first_name: form.first_name,
            last_name: form.last_name,
            project: form.project,
            activity: form.activity,
            qr_data: String(qrData).slice(0, 200),
            device_id: Consent.deviceId(),
            client_time: new Date().toISOString(),
            consent: Consent.proof(),
            location: location            // null olabilir - sunucu bunu kabul etmeli
        };

        const path = currentMode === 'in' ? '/api/check-in' : '/api/check-out';

        try {
            setStatus('Gönderiliyor…', 'info');
            const res = await Api.post(path, payload);
            if (res.ok) {
                const label = currentMode === 'in' ? 'Giriş' : 'Çıkış';
                setStatus((res.body.message || (label + ' kaydedildi.')) +
                    (location ? ' (konum eklendi)' : ' (konumsuz)'), 'success');
                // Basarili islem sonrası bilgileri hatırla
                saveSavedWorker(form.first_name, form.last_name);

                if (currentMode === 'in') {
                    startPeriodicLocationPing();
                } else {
                    stopPeriodicLocationPing();
                }

                if (res.body.birthday_message) {
                    showBirthdayModal(res.body.birthday_message);
                }
            } else {
                setStatus(res.body.message || res.body.error || 'İşlem reddedildi.', 'error');
            }
        } catch (err) {
            const errMsg = (err && err.message) ? err.message : String(err);
            setStatus('İşlem Hatası: ' + errMsg, 'error');
        }
    }

    /* ---------------- Mesai ici periyodik konum ---------------- */

    // Modul seviyesinde tutulur: onceden submitAction icinde tanimli oldugu icin
    // cikis yapildiginda onceki zamanlayici durdurulamiyor, konum alinmaya devam ediyordu.
    let locationPingTimer = null;

    function startPeriodicLocationPing() {
        stopPeriodicLocationPing();
        if (!Consent.allowsLocation()) return;

        locationPingTimer = setInterval(async () => {
            try {
                // Rıza sonradan kapatıldıysa veya saat 18:00 olduysa takip durur.
                if (!Consent.allowsLocation() || new Date().getHours() >= 18) {
                    stopPeriodicLocationPing();
                    return;
                }

                const loc = await captureLocation();
                if (loc) {
                    // Kimlik gonderilmez; sunucu cihazin bagli oldugu isciyi kullanir.
                    const res = await Api.post('/api/location-ping', {
                        location: loc,
                        consent: Consent.proof()
                    });
                    if (res.ok && res.body && res.body.ok === false) {
                        stopPeriodicLocationPing(); // acik mesai yok / riza yok
                    }
                }
            } catch (e) {}
        }, 15 * 60 * 1000); // 15 dakikada 1
    }

    function stopPeriodicLocationPing() {
        if (locationPingTimer) {
            clearInterval(locationPingTimer);
            locationPingTimer = null;
        }
    }

    /* ---------------- Riza akisi ---------------- */

    function refreshConsentGate() {
        const core = el('consent-core');
        const loc = el('consent-location');
        // Konum rizasi ISTEGE BAGLIDIR; yalnizca aydinlatma onayi zorunlu.
        el('btn-consent-accept').disabled = !(core && core.checked);
    }

    function renderConsentStatus() {
        const c = Consent.read();
        if (!c) return;
        const statusEl = el('consent-status');
        if (statusEl) {
            statusEl.textContent = c.location
                ? 'Konum paylaşımı: açık'
                : 'Konum paylaşımı: kapalı';
        }
    }

    function saveSavedWorker(first, last) {
        try {
            // KVKK: TC No cihazda duz metin olarak saklanmaz.
            localStorage.removeItem('erkiz_saved_tc');
            if (first) localStorage.setItem('erkiz_saved_first', first);
            if (last) localStorage.setItem('erkiz_saved_last', last);
        } catch(e) {}
    }

    function loadSavedWorker() {
        try {
            // Eski surumlerden kalan kayitli TC'yi temizle.
            localStorage.removeItem('erkiz_saved_tc');
            const first = localStorage.getItem('erkiz_saved_first');
            const last = localStorage.getItem('erkiz_saved_last');
            if (first && el('first_name')) el('first_name').value = first;
            if (last && el('last_name')) el('last_name').value = last;
        } catch(e) {}
    }

    async function loadProjects() {
        const select = el('project');
        if (!select) return;
        select.innerHTML = '<option value="">-- Yükleniyor... --</option>';

        let errBanner = el('project-network-banner');
        if (errBanner) errBanner.remove();

        try {
            const res = await Api.get('/api/projects');
            if (res.ok && Array.isArray(res.body) && res.body.length > 0) {
                select.innerHTML = '<option value="">-- Lütfen Seçin --</option>';
                res.body.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.project_name;
                    opt.textContent = `${p.project_code} - ${p.project_name}`;
                    select.appendChild(opt);
                });
            } else if (res.ok && Array.isArray(res.body) && res.body.length === 0) {
                select.innerHTML = '<option value="">-- Kayıtlı Proje Bulunamadı --</option>';
            } else {
                showProjectError(select, res.error);
            }
        } catch (e) {
            showProjectError(select, e.message);
        }
    }

    function showProjectError(select, detail) {
        select.innerHTML = '<option value="">-- Bağlantı Hatası (Dokunun) --</option>';

        const parent = select.parentElement;
        if (parent && !el('project-network-banner')) {
            const banner = document.createElement('div');
            banner.id = 'project-network-banner';
            banner.style.cssText = 'font-size:0.78rem; color:#d9534f; margin-top:5px; line-height:1.4; background:rgba(217,83,79,0.08); padding:6px 8px; border-radius:6px; border:1px solid rgba(217,83,79,0.2);';
            const currentBase = String(Api.base()).replace(/[<>&"']/g, '');
            banner.innerHTML = `⚠️ Sunucuya bağlanılamadı: <strong>${currentBase}</strong><br>` +
                `<div style="margin-top:4px; display:flex; gap:10px;">` +
                `<a href="#" id="link-retry-projects" style="color:#007AFF; font-weight:600; text-decoration:underline;">🔄 Tekrar Dene</a>` +
                `<a href="#" id="link-change-server" style="color:#007AFF; font-weight:600; text-decoration:underline;">⚙️ Sunucu IP Değiştir</a>` +
                `</div>`;
            parent.appendChild(banner);

            const retryLink = el('link-retry-projects');
            if (retryLink) retryLink.addEventListener('click', (e) => { e.preventDefault(); loadProjects(); });

            const changeLink = el('link-change-server');
            if (changeLink) changeLink.addEventListener('click', (e) => {
                e.preventDefault();
                promptChangeServer();
            });
        }
    }

    function promptChangeServer() {
        const current = Api.base();
        const entered = prompt('Sunucu Adresini Giriniz\n(Örn: https://www.erkiztakip.com):', current);
        if (entered !== null && entered.trim()) {
            const r = Api.setServerUrl(entered.trim());
            if (!r.ok) { alert(r.error); return; }
            alert('Sunucu adresi güncellendi: ' + Api.base());
            loadProjects();
        }
    }

    function showBirthdayModal(msg) {
        const textEl = el('birthday-modal-text');
        if (textEl) textEl.textContent = msg;
        const modal = el('modal-birthday');
        if (modal) modal.hidden = false;
    }

    function bootstrap() {
        window.NativeEvents = window.NativeEvents || {};

        if (window.AndroidBridge) {
            el('version-label').textContent = 'Sürüm ' + AndroidBridge.appVersion();
        }

        if (el('modal-birthday')) el('modal-birthday').hidden = true;

        loadSavedWorker();
        loadProjects();

        if (Consent.hasCore()) {
            show('form');
            renderConsentStatus();
            if (Consent.allowsLocation()) {
                if (window.AndroidBridge && !AndroidBridge.hasLocationPermission()) {
                    setTimeout(() => {
                        try { AndroidBridge.requestLocationPermission(); } catch(e) {}
                    }, 500);
                }
                warmupLocation();
            }
        } else {
            show('consent');
        }
    }

    /* ---------------- Olay baglama ---------------- */

    document.addEventListener('DOMContentLoaded', function () {
        if (el('consent-core')) el('consent-core').addEventListener('change', refreshConsentGate);
        if (el('consent-location')) el('consent-location').addEventListener('change', refreshConsentGate);

        el('btn-consent-accept').addEventListener('click', function () {
            if (!el('consent-core').checked) return;
            const locationOk = !!el('consent-location').checked;
            Consent.save(true, locationOk);
            show('form');
            renderConsentStatus();
            loadProjects();
            if (locationOk) {
                if (window.AndroidBridge && !AndroidBridge.hasLocationPermission()) {
                    setTimeout(() => {
                        try { AndroidBridge.requestLocationPermission(); } catch(e) {}
                    }, 300);
                }
                warmupLocation();
            }
        });

        el('btn-checkin').addEventListener('click', () => startScanner('in'));
        el('btn-checkout').addEventListener('click', () => startScanner('out'));

        if (el('btn-close-birthday')) {
            el('btn-close-birthday').addEventListener('click', function () {
                const modal = el('modal-birthday');
                if (modal) modal.hidden = true;
            });
        }

        el('btn-cancel-scan').addEventListener('click', async function () {
            await stopScanner();
            show('form');
        });

        if (el('btn-manual-qr')) {
            el('btn-manual-qr').addEventListener('click', async function () {
                const code = prompt('Saha QR kodunu giriniz (örnek: PRJ-156 veya ERKIZ):');
                if (code && code.trim()) {
                    await onScanSuccess(code.trim());
                }
            });
        }

        el('btn-manage-consent').addEventListener('click', function () {
            el('setting-location').checked = Consent.allowsLocation();
            if (el('setting-server-url')) el('setting-server-url').value = Api.base();
            show('settings');
        });

        el('btn-settings-back').addEventListener('click', function () {
            Consent.setLocation(el('setting-location').checked);
            if (!Consent.allowsLocation()) {
                stopPeriodicLocationPing();
                if (locationWatchId !== null && navigator.geolocation) {
                    try { navigator.geolocation.clearWatch(locationWatchId); } catch (e) {}
                    locationWatchId = null;
                }
                cachedLocation = null;
            }
            renderConsentStatus();
            show('form');
        });

        el('btn-revoke-all').addEventListener('click', function () {
            if (!confirm('Tüm rızanızı geri almak istediğinize emin misiniz? ' +
                         'Uygulamayı kullanmak için tekrar onay vermeniz gerekecek. ' +
                         'Cihaz kimliğiniz de silineceği için tekrar giriş yapabilmeniz için ' +
                         'yöneticinizin telefon kilidini kaldırması gerekecektir.')) return;
            stopPeriodicLocationPing();
            try { localStorage.removeItem('erkiz_saved_first'); localStorage.removeItem('erkiz_saved_last'); } catch (e) {}
            Consent.revokeAll();
            el('consent-core').checked = false;
            el('consent-location').checked = false;
            refreshConsentGate();
            show('consent');
        });

        // TC alanina sadece rakam
        el('tc_no').addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
        });

        // Ad-soyad degistikce cihaza otomatik kaydet (TC kaydedilmez)
        ['first_name', 'last_name'].forEach(id => {
            if (el(id)) {
                el(id).addEventListener('change', function () {
                    saveSavedWorker(el('first_name').value.trim(), el('last_name').value.trim());
                });
            }
        });

        if (el('project')) {
            el('project').addEventListener('click', function () {
                if (el('project').options.length <= 1 && !el('project').value) {
                    loadProjects();
                }
            });
        }

        if (el('btn-save-server')) {
            el('btn-save-server').addEventListener('click', function () {
                const input = el('setting-server-url');
                if (input && input.value.trim()) {
                    const r = Api.setServerUrl(input.value.trim());
                    if (!r.ok) { alert(r.error); return; }
                    alert('Sunucu adresi kaydedildi: ' + Api.base());
                    loadProjects();
                }
            });
        }

        bootstrap();
    });

    // Uygulama arka plana alinirsa kamerayi birak.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && scanning) {
            stopScanner().then(() => show('form'));
        }
    });
})();
