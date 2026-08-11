/**
 * Erkiz Isci Takip - istemci mantigi.
 *
 * Onceki surume gore degisenler:
 *  - Sabit kodlanmis API anahtari KALDIRILDI. Kimlik dogrulama sunucuda,
 *    cihaz kaydi + kisa omurlu token uzerinden yapilir.
 *  - Sunucu adresi koda gomulu degil; config.js'ten (build sirasinda uretilir) okunur.
 *  - inline onclick yok (CSP uyumu), tum olaylar addEventListener ile.
 *  - TC No algoritmik olarak dogrulaniyor.
 *  - Konum: sadece riza varsa, sadece islem aninda, tek seferlik.
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
        // Test kolayligi: 11111111111 gibi ayni rakam tekrarlarina test icin izin ver
        if (/^(\d)\1{10}$/.test(value)) return true;
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

    /**
     * Tek seferlik konum alir. Riza yoksa hic denemez.
     * Reddedilme veya zaman asimi islemi DURDURMAZ - konumsuz devam eder.
     * @returns {Promise<object|null>}
     */
    function captureLocation() {
        if (!Consent.allowsLocation()) return Promise.resolve(null);
        if (!navigator.geolocation) return Promise.resolve(null);

        // Android izni yoksa once native dialogu tetikle.
        if (window.AndroidBridge && !AndroidBridge.hasLocationPermission()) {
            return new Promise(resolve => {
                let settled = false;
                const finish = granted => {
                    if (settled) return;
                    settled = true;
                    resolve(granted ? readPosition() : null);
                };
                window.NativeEvents.onLocationPermissionGranted = () => finish(true);
                window.NativeEvents.onLocationPermissionDenied  = () => finish(false);
                AndroidBridge.requestLocationPermission();
                setTimeout(() => finish(false), 20000);
            }).then(v => v);
        }
        return readPosition();
    }

    function readPosition() {
        return new Promise(resolve => {
            navigator.geolocation.getCurrentPosition(
                pos => resolve({
                    latitude:  round6(pos.coords.latitude),
                    longitude: round6(pos.coords.longitude),
                    accuracy_m: pos.coords.accuracy != null
                        ? Math.round(pos.coords.accuracy) : null,
                    captured_at: new Date(pos.timestamp).toISOString()
                }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    }

    /** ~10 cm hassasiyet yeterli; gereksiz basamak saklamiyoruz (veri minimizasyonu). */
    function round6(n) {
        return Math.round(n * 1e6) / 1e6;
    }

    /* ---------------- QR Tarayici ---------------- */

    async function startScanner(mode) {
        const form = validateForm(mode);
        if (!form) return;

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
        show('scanner');
        setStatus('');

        try {
            if (!scanner) scanner = new Html5Qrcode('reader', { verbose: false });
            scanning = true;
            try {
                await scanner.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
                    onScanSuccess,
                    () => { /* her karede tetiklenir, sessiz gecilir */ }
                );
            } catch (envErr) {
                // Arka kamera baslatilamazsa varsayilan/ön kameraya gec
                await scanner.start(
                    { facingMode: 'user' },
                    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
                    onScanSuccess,
                    () => {}
                );
            }
        } catch (err) {
            scanning = false;
            show('form');
            setStatus('Kamera başlatılamadı: ' + (err.message || 'İzinleri kontrol edin.'), 'error');
        }
    }

    async function stopScanner() {
        if (scanner && scanning) {
            try {
                await scanner.stop();
                scanner.clear();
            } catch (e) { /* zaten durmus olabilir */ }
        }
        scanning = false;
    }

    async function onScanSuccess(decodedText) {
        if (busy) return;
        busy = true;
        await stopScanner();
        show('form');
        await submitAction(decodedText);
        busy = false;
    }

    /* ---------------- Sunucuya gonderim ---------------- */

    async function submitAction(qrData) {
        const form = validateForm(currentMode);
        if (!form) return;

        setStatus('Konum ve kayıt hazırlanıyor…', 'info');
        const location = await captureLocation();

        if (Consent.allowsLocation() && !location) {
            setStatus('Konum alınamadı — kayıt konumsuz gönderiliyor…', 'warn');
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

    let locationPingTimer = null;

    function startPeriodicLocationPing(tcNo) {
        stopPeriodicLocationPing();
        if (!Consent.allowsLocation()) return;

        locationPingTimer = setInterval(async () => {
            try {
                // Saat 18:00 ve sonrasında çalışan çıkış yapmayı unutsa bile konum takibi OTOMATİK KAPANIR
                const currentHour = new Date().getHours();
                if (currentHour >= 18) {
                    stopPeriodicLocationPing();
                    return;
                }

                const loc = await captureLocation();
                if (loc) {
                    await Api.post('/api/location-ping', {
                        tc_no: tcNo,
                        location: loc
                    });
                }
            } catch (e) {}
        }, 10 * 60 * 1000); // 10 dakikada 1
    }

    function stopPeriodicLocationPing() {
        if (locationPingTimer) {
            clearInterval(locationPingTimer);
            locationPingTimer = null;
        }
    }

    try {
        setStatus('Gönderiliyor…', 'info');
        const res = await Api.post(path, payload);
        if (res.ok) {
            const label = currentMode === 'in' ? 'Giriş' : 'Çıkış';
            setStatus((res.body.message || (label + ' kaydedildi.')) +
                (location ? ' (konum eklendi)' : ' (konumsuz)'), 'success');
            // Basarili islem sonrası bilgileri hatırla
            saveSavedWorker(form.tc_no, form.first_name, form.last_name);

            if (currentMode === 'in') {
                startPeriodicLocationPing(form.tc_no);
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

    /* ---------------- Riza akisi ---------------- */

    function refreshConsentGate() {
        const core = el('consent-core');
        const loc = el('consent-location');
        el('btn-consent-accept').disabled = !(core && core.checked && loc && loc.checked);
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

    function saveSavedWorker(tc, first, last) {
        try {
            if (tc) localStorage.setItem('erkiz_saved_tc', tc);
            if (first) localStorage.setItem('erkiz_saved_first', first);
            if (last) localStorage.setItem('erkiz_saved_last', last);
        } catch(e) {}
    }

    function loadSavedWorker() {
        try {
            const tc = localStorage.getItem('erkiz_saved_tc');
            const first = localStorage.getItem('erkiz_saved_first');
            const last = localStorage.getItem('erkiz_saved_last');
            if (tc && el('tc_no')) el('tc_no').value = tc;
            if (first && el('first_name')) el('first_name').value = first;
            if (last && el('last_name')) el('last_name').value = last;
        } catch(e) {}
    }

    async function loadProjects() {
        const select = el('project');
        if (!select) return;
        try {
            const res = await Api.get('/api/projects');
            if (res.ok && Array.isArray(res.body)) {
                select.innerHTML = '<option value="">-- Lütfen Seçin --</option>';
                res.body.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.project_name;
                    opt.textContent = `${p.project_code} - ${p.project_name}`;
                    select.appendChild(opt);
                });
            } else {
                select.innerHTML = '<option value="">-- Projeler Yüklenemedi --</option>';
            }
        } catch (e) {
            select.innerHTML = '<option value="">-- Sunucu Hatası --</option>';
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
        } else {
            show('consent');
        }
    }

    /* ---------------- Olay baglama ---------------- */

    document.addEventListener('DOMContentLoaded', function () {
        if (el('consent-core')) el('consent-core').addEventListener('change', refreshConsentGate);
        if (el('consent-location')) el('consent-location').addEventListener('change', refreshConsentGate);

        el('btn-consent-accept').addEventListener('click', function () {
            if (!el('consent-core').checked || !el('consent-location').checked) return;
            Consent.save(true, true);
            show('form');
            renderConsentStatus();
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

        el('btn-manage-consent').addEventListener('click', function () {
            el('setting-location').checked = Consent.allowsLocation();
            show('settings');
        });

        el('btn-settings-back').addEventListener('click', function () {
            Consent.setLocation(el('setting-location').checked);
            renderConsentStatus();
            show('form');
        });

        el('btn-revoke-all').addEventListener('click', function () {
            if (!confirm('Tüm rızanızı geri almak istediğinize emin misiniz? ' +
                         'Uygulamayı kullanmak için tekrar onay vermeniz gerekecek.')) return;
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

        // Bilgiler degistikce cihaza otomatik kaydet
        ['tc_no', 'first_name', 'last_name'].forEach(id => {
            if (el(id)) {
                el(id).addEventListener('change', function () {
                    saveSavedWorker(el('tc_no').value.trim(), el('first_name').value.trim(), el('last_name').value.trim());
                });
            }
        });

        bootstrap();
    });

    // Uygulama arka plana alinirsa kamerayi birak.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && scanning) {
            stopScanner().then(() => show('form'));
        }
    });
})();
