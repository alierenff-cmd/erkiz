/**
 * Erkiz Isci Takip - Backend referans uygulamasi.
 *
 * Onceki surumde backend zip icinde yoktu; bu dosya istemcinin bekledigi
 * sozlesmeyi karsilayan calisir bir iskelet sunar.
 *
 * Guvenlik notlari:
 *  - Sabit API anahtari yok. Cihaz kaydi + kisa omurlu JWT.
 *  - Admin sifreleri scrypt ile hashlenir (Node cekirdegi, derleme gerektirmez).
 *  - Oturum httpOnly + secure + sameSite cookie.
 *  - Tum girdiler sunucuda yeniden dogrulanir (istemci dogrulamasi guvenilmez).
 *  - TC No veritabaninda hem hashli hem sifreli tutulur (bkz. schema.sql).
 */
'use strict';

process.env.TZ = 'Europe/Istanbul';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const password = require('./lib/password');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const sapIntegration = require('./lib/sapIntegration');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------- Zorunlu yapilandirma ---------------- */

const REQUIRED = ['JWT_SECRET', 'SESSION_SECRET',
                  'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'TC_ENCRYPTION_KEY'];

for (const key of REQUIRED) {
    if (!process.env[key]) {
        console.error(`[HATA] Eksik ortam degiskeni: ${key}. .env dosyasini kontrol edin.`);
        process.exit(1);
    }
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'erkiz_app',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'erkiz_takip',
    waitForConnections: true,
    connectionLimit: 10,
    timezone: '+03:00'
});

/* ---------------- Middleware ---------------- */

app.set('trust proxy', 1);

// CORS Desteği (Android WebView ve mobil cihazlar için)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Strict-Transport-Security', 'max-age=0');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(helmet({
    contentSecurityPolicy: false,
    hsts: { maxAge: 0 },
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    originAgentCluster: false
}));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser(process.env.SESSION_SECRET));

/* ---------------- Yardimcilar ---------------- */

/** TC No dogrulama - istemci tarafi atlatılabilir, burada tekrar edilir. */
function isValidTC(value) {
    if (!/^[1-9][0-9]{10}$/.test(value)) return false;
    const d = String(value).split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    if (((odd * 7) - even) % 10 !== d[9]) return false;
    return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/** Arama/eslestirme icin deterministik hash (pepper ile). */
function hashTC(tc) {
    return crypto.createHmac('sha256', process.env.TC_ENCRYPTION_KEY)
                 .update(String(tc)).digest('hex');
}

/** Gerektiginde geri okunabilmesi icin AES-256-GCM ile sifreleme. */
function encryptTC(tc) {
    const key = crypto.createHash('sha256')
                      .update(process.env.TC_ENCRYPTION_KEY).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(tc), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function sanitizeName(value) {
    return String(value || '').trim().replace(/[<>"'`\\]/g, '').slice(0, 50);
}

function formatMysqlDateTime(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).replace('T', ' ');
}

/** Koordinat dogrulama - uydurma degerleri reddet. */
function validateLocation(loc) {
    if (!loc || typeof loc !== 'object') return null;
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return {
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        accuracy_m: loc.accuracy_m != null ? Math.min(Number(loc.accuracy_m) || 0, 99999) : null
    };
}

function getBirthdayStatus(bdate) {
    if (!bdate) return { isToday: false, isThisWeek: false, isWeekendBday: false, shouldCelebrateToday: false, bdayDayName: '' };
    
    try {
        const now = new Date();
        const turkeyNowStr = now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
        const today = new Date(turkeyNowStr);
        
        const currentYear = today.getFullYear();
        const todayMonth = today.getMonth();
        const todayDate = today.getDate();
        const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon, ... 5 = Fri, 6 = Sat

        const bdateObj = new Date(bdate);
        if (isNaN(bdateObj.getTime())) {
            return { isToday: false, isThisWeek: false, isWeekendBday: false, shouldCelebrateToday: false, bdayDayName: '' };
        }
        const bMonth = bdateObj.getMonth();
        const bDate = bdateObj.getDate();

        const isToday = (bMonth === todayMonth && bDate === todayDate);

        // Calculate Monday and Sunday of current week
        const monday = new Date(today);
        const distToMonday = (dayOfWeek + 6) % 7;
        monday.setDate(today.getDate() - distToMonday);
        monday.setHours(0, 0, 0, 0);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        const bdayThisYear = new Date(currentYear, bMonth, bDate);
        const isThisWeek = (bdayThisYear >= monday && bdayThisYear <= sunday);

        const bdayDayOfWeek = bdayThisYear.getDay(); // 0 = Sun, 6 = Sat
        const isWeekendBday = (bdayDayOfWeek === 0 || bdayDayOfWeek === 6);
        
        // Rule:
        // 1) If today is exact birthday -> Celebrate!
        // 2) If today is Friday (dayOfWeek === 5) and birthday is Saturday or Sunday of this week -> Celebrate on Friday!
        const shouldCelebrateToday = isToday || (dayOfWeek === 5 && isThisWeek && isWeekendBday);

        const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        const bdayDayName = days[bdayDayOfWeek];

        return {
            isToday,
            isThisWeek,
            isWeekendBday,
            shouldCelebrateToday,
            bdayDayName
        };
    } catch (e) {
        return { isToday: false, isThisWeek: false, isWeekendBday: false, shouldCelebrateToday: false, bdayDayName: '' };
    }
}

/* ---------------- Cihaz kimlik dogrulama ---------------- */

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
const actionLimiter   = rateLimit({ windowMs: 60 * 1000, max: 10 });
const loginLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 100,
                                    skipSuccessfulRequests: true });

app.post('/api/device/register', registerLimiter, async (req, res) => {
    const deviceId = String(req.body.device_id || '');
    if (!/^DEV-[A-F0-9]{18}$/.test(deviceId)) {
        return res.status(400).json({ error: 'Geçersiz cihaz kimliği.' });
    }

    await pool.execute(
        `INSERT INTO devices (device_id, first_seen, last_seen, consent_version)
         VALUES (?, NOW(), NOW(), ?)
         ON DUPLICATE KEY UPDATE last_seen = NOW(), consent_version = VALUES(consent_version)`,
        [deviceId, Number(req.body.consent_version) || 1]
    );

    const [rows] = await pool.execute(
        'SELECT blocked FROM devices WHERE device_id = ?', [deviceId]);
    if (rows[0] && rows[0].blocked) {
        return res.status(403).json({ error: 'Bu cihaz engellenmiş.' });
    }

    const token = jwt.sign({ did: deviceId }, process.env.JWT_SECRET,
                           { expiresIn: '15m' });
    res.json({ token, expires_in: 900 });
});

function requireDevice(req, res, next) {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Yetkisiz.' });
    try {
        req.device = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Oturum süresi doldu.' });
    }
}

/* ---------------- Giris / Cikis ---------------- */

async function handleAction(req, res, mode) {
    const { tc_no, first_name, last_name, qr_data, consent, activity, project } = req.body;

    if (!isValidTC(tc_no)) {
        return res.status(400).json({ message: 'Geçersiz T.C. kimlik numarası.' });
    }
    const first = sanitizeName(first_name);
    const last = sanitizeName(last_name);
    if (first.length < 2 || last.length < 2) {
        return res.status(400).json({ message: 'Ad ve soyad zorunludur.' });
    }
    const site = String(qr_data || '').trim().slice(0, 200);
    if (!site) {
        return res.status(400).json({ message: 'Geçersiz QR kodu.' });
    }
    
    let activityVal = null;
    let projectVal = null;
    if (mode === 'in') {
        activityVal = String(activity || '').trim().slice(0, 100);
        if (!activityVal) {
            return res.status(400).json({ message: 'Lütfen bir aktivite seçiniz.' });
        }
        projectVal = String(project || '').trim().slice(0, 150);
        if (!projectVal) {
            return res.status(400).json({ message: 'Lütfen bir proje seçiniz.' });
        }
    }

    // KVKK: cekirdek riza yoksa islem yapilmaz.
    if (!consent || consent.version == null) {
        return res.status(400).json({ message: 'Rıza kaydı eksik.' });
    }

    // Konum yalnizca riza varsa saklanir - istemci gonderse bile riza yoksa atilir.
    const locationAllowed = consent.location_granted === true;
    const loc = locationAllowed ? validateLocation(req.body.location) : null;

    const tcHash = hashTC(tc_no);
    const tcEnc = encryptTC(tc_no);

    // 0. İşçi T.C. Kimlik No Sistemde Kayıtlı mı Kontrolü (Kayıtsız T.C. engelleme)
    const [registeredWorker] = await pool.execute(
        `SELECT birth_date FROM workers WHERE tc_hash = ?`,
        [tcHash]
    );

    if (!registeredWorker || registeredWorker.length === 0) {
        return res.status(403).json({
            message: 'Girdiğiniz T.C. Kimlik No sistemde kayıtlı aktif bir işçiye ait değildir. Lütfen İnsan Kaynakları / Yönetici ile iletişime geçiniz.'
        });
    }

    if (mode === 'in') {
        // 1. Kullanıcının zaten açık bir giriş kaydı var mı?
        const [open] = await pool.execute(
            `SELECT id, activity, project FROM attendance_logs
             WHERE tc_hash = ? AND check_out_time IS NULL LIMIT 1`, [tcHash]);

        if (open.length) {
            const currentAct = open[0].activity;
            const currentProj = open[0].project;
            if (currentAct !== activityVal || currentProj !== projectVal) {
                await pool.execute(
                    `UPDATE attendance_logs SET activity = ?, project = ? WHERE id = ?`,
                    [activityVal, projectVal, open[0].id]
                );
                return res.json({
                    message: `Girişiniz Proje: '${projectVal}', Aktivite: '${activityVal}' olarak güncellendi.`
                });
            } else {
                return res.status(409).json({
                    message: `Zaten '${projectVal}' projesinde '${activityVal}' aktivitesi ile açık bir giriş kaydınız var.`
                });
            }
        }

        // 2. Bu cihazda başka birinin açık giriş kaydı var mı? (1 cihazda 2 kişi engeli)
        const [deviceOpen] = await pool.execute(
            `SELECT id, first_name, last_name FROM attendance_logs
             WHERE device_id = ? AND check_out_time IS NULL LIMIT 1`, [req.device.did]);

        if (deviceOpen.length) {
            return res.status(409).json({
                message: `Bu cihazda ${deviceOpen[0].first_name} ${deviceOpen[0].last_name} adına açık giriş kaydı var. Önce çıkış yapılmalıdır.`
            });
        }

        function getDistanceMeters(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        async function isWorkerOutOfBounds(siteName, lat, lng) {
            if (!siteName || lat == null || lng == null) return false;
            try {
                const [sites] = await pool.execute('SELECT center_lat, center_lng, radius_m FROM qr_codes WHERE site_name = ?', [siteName]);
                if (!sites || !sites.length || sites[0].center_lat == null || sites[0].center_lng == null) return false;
                const dist = getDistanceMeters(lat, lng, Number(sites[0].center_lat), Number(sites[0].center_lng));
                return dist > Number(sites[0].radius_m || 500);
            } catch (e) {
                return false;
            }
        }

        const outOfBounds = loc ? await isWorkerOutOfBounds(site, loc.latitude, loc.longitude) : false;

        // 3. Yeni giriş kaydı oluştur
        await pool.execute(
            `INSERT INTO attendance_logs
             (tc_hash, tc_encrypted, first_name, last_name, qr_data, device_id, activity, project,
              check_in_time, in_latitude, in_longitude, in_accuracy_m,
              location_consent, consent_version, consent_granted_at, is_out_of_bounds)
             VALUES (?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?)`,
            [tcHash, tcEnc, first, last, site, req.device.did, activityVal, projectVal,
             loc ? loc.latitude : null, loc ? loc.longitude : null,
             loc ? loc.accuracy_m : null, locationAllowed,
             Number(consent.version), formatMysqlDateTime(consent.core_granted_at), outOfBounds]
        );

        // 4. Doğum Günü Kontrolü (Hafta bazlı: Cumartesi/Pazar doğum günleri Cuma günü kutlanır)
        let birthdayMessage = null;
        try {
            if (registeredWorker[0] && registeredWorker[0].birth_date) {
                const bStatus = getBirthdayStatus(registeredWorker[0].birth_date);
                if (bStatus.shouldCelebrateToday) {
                    birthdayMessage = `🎂 Doğum gününüz kutlu olsun ${first} ${last}, Erkiz Mühendislik ailesi olarak kutlarız. Lütfen İnsan Kaynaklarına uğrayınız. 🎁`;
                }
            }
        } catch (e) {}

        return res.json({
            message: 'Giriş kaydedildi. İyi çalışmalar.',
            birthday_message: birthdayMessage
        });
    }

    // Cikis
    const [open] = await pool.execute(
        `SELECT id, check_in_time FROM attendance_logs
         WHERE tc_hash = ? AND check_out_time IS NULL
         ORDER BY check_in_time DESC LIMIT 1`, [tcHash]);

    if (!open.length) {
        return res.status(409).json({ message: 'Açık bir giriş kaydı bulunamadı.' });
    }

    await pool.execute(
        `UPDATE attendance_logs
         SET check_out_time = NOW(),
             duration_minutes = TIMESTAMPDIFF(MINUTE, check_in_time, NOW()),
             out_latitude = ?, out_longitude = ?, out_accuracy_m = ?
         WHERE id = ?`,
        [loc ? loc.latitude : null, loc ? loc.longitude : null,
         loc ? loc.accuracy_m : null, open[0].id]
    );

    res.json({
        message: 'Çıkış kaydedildi. Güle güle.',
        birthday_message: null
    });
}

app.post('/api/check-in', actionLimiter, requireDevice,
         (req, res) => handleAction(req, res, 'in').catch(err => {
             console.error(err); res.status(500).json({ message: 'Sunucu hatası.' });
         }));

app.post('/api/check-out', actionLimiter, requireDevice,
         (req, res) => handleAction(req, res, 'out').catch(err => {
             console.error(err); res.status(500).json({ message: 'Sunucu hatası.' });
         }));

/* ---------------- 15 Dakikalık Konum Takip Sinyali (18:00 Koruması) ---------------- */

app.post('/api/location-ping', actionLimiter, requireDevice, async (req, res) => {
    try {
        // Saat 18:00 ve sonrasında gelen konum pinglemesini sunucu seviyesinde reddet (KVKK Koruması)
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 18) {
            return res.json({ ok: false, message: 'Saat 18:00 sonrasında konum takibi otomatik olarak kapatılmıştır.' });
        }

        const { tc_no, location } = req.body;
        if (!tc_no || !location) {
            return res.status(400).json({ error: 'Eksik veri.' });
        }

        const tcHash = hashTC(tc_no);

        // İşçi şu an açık mesaide mi?
        const [open] = await pool.execute(
            `SELECT id, qr_data FROM attendance_logs WHERE tc_hash = ? AND check_out_time IS NULL LIMIT 1`,
            [tcHash]
        );

        if (!open.length) {
            return res.json({ ok: false, message: 'Açık mesai kaydı bulunmadığından konum kaydedilmedi.' });
        }

        const loc = validateLocation(location);
        if (!loc) {
            return res.status(400).json({ error: 'Geçersiz konum.' });
        }

        const outOfBounds = await isWorkerOutOfBounds(open[0].qr_data, loc.latitude, loc.longitude);

        if (outOfBounds) {
            await pool.execute(
                `UPDATE attendance_logs SET is_out_of_bounds = TRUE WHERE id = ?`,
                [open[0].id]
            );
        }

        await pool.execute(
            `INSERT INTO worker_location_history (tc_hash, device_id, latitude, longitude, accuracy_m, recorded_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [tcHash, req.device.did, loc.latitude, loc.longitude, loc.accuracy_m]
        );

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- Yonetici ---------------- */

app.post('/api/admin/login', loginLimiter, async (req, res) => {
    // NOT: `password` degiskeni modul adiyla cakismasin diye bilincli
    // olarak farkli isimlendirildi.
    const username = String(req.body.username || '');
    const plainPassword = String(req.body.password || '');

    const userOk = username === process.env.ADMIN_USERNAME;
    const passOk = await password.compare(
        plainPassword, process.env.ADMIN_PASSWORD_HASH);

    // Hangisinin yanlis oldugunu sizdirmiyoruz.
    if (!userOk || !passOk) {
        return res.status(401).json({ error: 'Giriş bilgileri hatalı.' });
    }

    const session = jwt.sign({ role: 'admin', user: username },
                             process.env.SESSION_SECRET, { expiresIn: '2h' });

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('erkiz_session', session, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 2 * 60 * 60 * 1000
    });
    res.json({ ok: true });
});

function requireAdmin(req, res, next) {
    const token = req.cookies && req.cookies.erkiz_session;
    if (!token) return res.status(401).json({ error: 'Oturum yok.' });
    try {
        req.admin = jwt.verify(token, process.env.SESSION_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Oturum geçersiz.' });
    }
}

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('erkiz_session', { path: '/' });
    res.json({ ok: true });
});

/* ---------------- İşçi & Doğum Günü Yönetimi ---------------- */

app.get('/api/admin/workers', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, tc_encrypted, first_name, last_name, birth_date
             FROM workers
             ORDER BY first_name ASC, last_name ASC`
        );
        res.json(rows.map(r => {
            const bStatus = getBirthdayStatus(r.birth_date);
            return {
                ...r,
                tc_no: decryptTC(r.tc_encrypted),
                tc_encrypted: undefined,
                birth_date_str: r.birth_date ? new Date(r.birth_date).toISOString().split('T')[0] : '',
                is_birthday_today: bStatus.isToday,
                is_birthday_this_week: bStatus.isThisWeek,
                is_weekend_bday: bStatus.isWeekendBday,
                bday_day_name: bStatus.bdayDayName,
                should_celebrate_today: bStatus.shouldCelebrateToday
            };
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/workers', requireAdmin, async (req, res) => {
    try {
        const { tc_no, first_name, last_name, birth_date } = req.body;
        if (!isValidTC(tc_no)) {
            return res.status(400).json({ error: 'Geçersiz T.C. Kimlik No.' });
        }
        const first = sanitizeName(first_name);
        const last = sanitizeName(last_name);
        if (first.length < 2 || last.length < 2) {
            return res.status(400).json({ error: 'Ad ve soyad zorunludur.' });
        }
        if (!birth_date || isNaN(new Date(birth_date).getTime())) {
            return res.status(400).json({ error: 'Geçersiz doğum tarihi.' });
        }

        const tcHash = hashTC(tc_no);
        const tcEnc = encryptTC(tc_no);
        const bdate = new Date(birth_date).toISOString().split('T')[0];

        await pool.execute(
            `INSERT INTO workers (tc_hash, tc_encrypted, first_name, last_name, birth_date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date)`,
            [tcHash, tcEnc, first, last, bdate]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/workers/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        await pool.execute('DELETE FROM workers WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/workers/import-csv', requireAdmin, async (req, res) => {
    try {
        const { csv_text } = req.body;
        if (!csv_text || typeof csv_text !== 'string') {
            return res.status(400).json({ error: 'Geçersiz CSV içeriği.' });
        }

        const lines = csv_text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 1) {
            return res.status(400).json({ error: 'CSV dosyasında aktarılacak veri satırı bulunamadı.' });
        }

        const delimiter = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(delimiter).map(h => h.trim().toUpperCase().replace(/^["']|["']$/g, ''));

        let tcIdx = headers.findIndex(h => h.includes('TC') || h.includes('KIMLIK'));
        let nameIdx = headers.findIndex(h => h === 'AD' || h.includes('FIRST') || h.includes('NAME'));
        let surnameIdx = headers.findIndex(h => h === 'SOYAD' || h.includes('LAST') || h.includes('SURNAME'));
        let bdateIdx = headers.findIndex(h => h.includes('DOGUM') || h.includes('BIRTH') || h.includes('TARIH'));

        if (tcIdx === -1) tcIdx = 0;
        if (nameIdx === -1) nameIdx = 1;
        if (surnameIdx === -1) surnameIdx = 2;

        let successCount = 0;
        let failCount = 0;

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
            const tc = cols[tcIdx] || '';
            const first = sanitizeName(cols[nameIdx] || '');
            const last = sanitizeName(cols[surnameIdx] || '');
            const rawBdate = bdateIdx !== -1 ? cols[bdateIdx] : null;

            if (!isValidTC(tc) || first.length < 2 || last.length < 2) {
                failCount++;
                continue;
            }

            let bdateStr = '2000-01-01';
            if (rawBdate) {
                let clean = String(rawBdate).trim();
                if (clean.includes('.') || clean.includes('/') || clean.includes('-')) {
                    let parts = clean.split(/[./-]/);
                    if (parts.length >= 2) {
                        let day = String(parts[0]).padStart(2, '0');
                        let month = String(parts[1]).padStart(2, '0');
                        let year = parts.length >= 3 && parts[2].length === 4 ? parts[2] : '2000';
                        if (parts[0].length === 4) {
                            year = parts[0];
                            month = String(parts[1]).padStart(2, '0');
                            day = String(parts[2]).padStart(2, '0');
                        }
                        bdateStr = `${year}-${month}-${day}`;
                    }
                } else if (!isNaN(Number(clean)) && Number(clean) > 0) {
                    const base = new Date(1899, 11, 30);
                    base.setDate(base.getDate() + Math.round(Number(clean)));
                    const year = base.getFullYear();
                    const month = String(base.getMonth() + 1).padStart(2, '0');
                    const day = String(base.getDate()).padStart(2, '0');
                    bdateStr = `${year}-${month}-${day}`;
                }
            }

            const tcHash = hashTC(tc);
            const tcEnc = encryptTC(tc);

            await pool.execute(
                `INSERT INTO workers (tc_hash, tc_encrypted, first_name, last_name, birth_date)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date)`,
                [tcHash, tcEnc, first, last, bdateStr]
            );
            successCount++;
        }

        res.json({
            ok: true,
            total_rows: lines.length - 1,
            success_count: successCount,
            fail_count: failCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, project_code, project_name FROM projects WHERE is_active = TRUE ORDER BY project_name ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Projeler alınamadı.' });
    }
});

app.get('/api/admin/projects', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/projects', requireAdmin, async (req, res) => {
    try {
        const code = String(req.body.project_code || '').trim();
        const name = String(req.body.project_name || '').trim();

        if (!code || !name) {
            return res.status(400).json({ error: 'Proje Kodu ve Proje Adı zorunludur.' });
        }

        await pool.execute(
            'INSERT INTO projects (project_code, project_name) VALUES (?, ?)',
            [code, name]
        );
        res.json({ ok: true });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Bu proje kodu zaten mevcut.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/projects/:id', requireAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM projects WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- Saha QR Kod Yönetimi ---------------- */

app.get('/api/admin/qr-codes', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM qr_codes ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/qr-codes', requireAdmin, async (req, res) => {
    try {
        const siteName = String(req.body.site_name || '').trim();
        if (!siteName) {
            return res.status(400).json({ error: 'Saha Adı zorunludur.' });
        }
        await pool.execute(
            'INSERT INTO qr_codes (site_name) VALUES (?) ON DUPLICATE KEY UPDATE site_name=VALUES(site_name)',
            [siteName]
        );
        res.json({ ok: true, site_name: siteName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/qr-codes/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Geçersiz ID.' });
        }
        await pool.execute('DELETE FROM qr_codes WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/qr-codes/:id/geofence', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { center_lat, center_lng, radius_m } = req.body;

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Geçersiz ID.' });
        }

        await pool.execute(
            `UPDATE qr_codes
             SET center_lat = ?, center_lng = ?, radius_m = ?
             WHERE id = ?`,
            [center_lat, center_lng, radius_m || 500, id]
        );

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs', requireAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 500, 2000);

    const [rows] = await pool.execute(
        `SELECT id, tc_encrypted, first_name, last_name, qr_data, project, activity,
                check_in_time, check_out_time, duration_minutes,
                in_latitude AS latitude, in_longitude AS longitude,
                in_accuracy_m AS accuracy_m, location_consent, is_out_of_bounds
         FROM attendance_logs
         ORDER BY check_in_time DESC
         LIMIT ?`, [String(limit)]);

    // Erisim loglanir (KVKK hesap verebilirlik).
    await pool.execute(
        `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
         VALUES (?,?,?,?,NOW())`,
        [req.admin.user, 'list_logs', rows.length, req.ip]);

    // Panelde maskeli gosterildigi icin TC'yi coz ama son 3 + ilk 3 hane yeter.
    res.json(rows.map(r => ({ ...r, tc_no: decryptTC(r.tc_encrypted), tc_encrypted: undefined })));
});

function decryptTC(payload) {
    try {
        const raw = Buffer.from(payload, 'base64');
        const key = crypto.createHash('sha256')
                          .update(process.env.TC_ENCRYPTION_KEY).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
                     .toString('utf8');
    } catch (e) {
        return '';
    }
}

app.delete('/api/logs/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Geçersiz kayıt.' });
    }
    await pool.execute('DELETE FROM attendance_logs WHERE id = ?', [id]);
    await pool.execute(
        `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
         VALUES (?,?,?,?,NOW())`, [req.admin.user, 'delete_log:' + id, 1, req.ip]);
    res.json({ ok: true });
});

app.post('/api/admin/checkout', requireAdmin, async (req, res) => {
    const id = Number(req.body.id);
    const customTimeStr = req.body.check_out_time ? String(req.body.check_out_time).trim() : null;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Geçersiz kayıt ID.' });
    }

    const [rows] = await pool.execute('SELECT * FROM attendance_logs WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Kayıt bulunamadı.' });
    }

    let checkOutTime;
    if (customTimeStr) {
        checkOutTime = formatMysqlDateTime(customTimeStr);
    } else {
        checkOutTime = formatMysqlDateTime(new Date().toISOString());
    }

    if (!checkOutTime) {
        return res.status(400).json({ error: 'Geçersiz çıkış tarihi/saati.' });
    }

    await pool.execute(
        `UPDATE attendance_logs
         SET check_out_time = ?,
             duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, check_in_time, ?))
         WHERE id = ?`,
        [checkOutTime, checkOutTime, id]
    );

    await pool.execute(
        `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
         VALUES (?,?,?,?,NOW())`, [req.admin.user, 'manual_checkout:' + id, 1, req.ip]);

    res.json({ ok: true, message: 'İşçi çıkışı manuel olarak kaydedildi.' });
});

/* ---------------- SAP Entegrasyonu Servisleri ---------------- */

/**
 * SAP API isteklerini ya yetkili Admin cookie oturumu ile
 * ya da X-SAP-API-KEY başlığı ile doğrular.
 */
function requireSAPOrAdmin(req, res, next) {
    const sapApiKeyHeader = req.get('X-SAP-API-KEY') || req.get('x-sap-api-key');
    const configuredApiKey = process.env.SAP_API_KEY;

    if (configuredApiKey && sapApiKeyHeader === configuredApiKey) {
        req.sapUser = 'sap_system';
        return next();
    }

    const token = req.cookies && req.cookies.erkiz_session;
    if (token) {
        try {
            req.admin = jwt.verify(token, process.env.SESSION_SECRET);
            req.sapUser = req.admin.user;
            return next();
        } catch (e) {}
    }

    return res.status(401).json({ error: 'Yetkisiz SAP erişimi.' });
}

/**
 * GET /api/sap/export
 * SAP HCM / CATS için puantaj kayıtlarını JSON veya CSV olarak dışa aktarır.
 * Filtreler: format (csv|json), start_date, end_date, unsynced_only (1|0)
 */
app.get('/api/sap/export', requireSAPOrAdmin, async (req, res) => {
    try {
        const format = String(req.query.format || 'csv').toLowerCase();
        const limit = Math.min(Number(req.query.limit) || 1000, 5000);
        const unsyncedOnly = req.query.unsynced_only === '1' || req.query.unsynced_only === 'true';

        let sql = `SELECT id, tc_encrypted, first_name, last_name, qr_data, device_id,
                          check_in_time, check_out_time, duration_minutes,
                          sap_synced, sap_synced_at
                   FROM attendance_logs WHERE 1=1`;
        const params = [];

        if (unsyncedOnly) {
            sql += ` AND sap_synced = 0`;
        }
        if (req.query.start_date) {
            sql += ` AND check_in_time >= ?`;
            params.push(req.query.start_date + ' 00:00:00');
        }
        if (req.query.end_date) {
            sql += ` AND check_in_time <= ?`;
            params.push(req.query.end_date + ' 23:59:59');
        }

        sql += ` ORDER BY check_in_time ASC LIMIT ?`;
        params.push(String(limit));

        const [rows] = await pool.execute(sql, params);

        // KVKK loglama
        await pool.execute(
            `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
             VALUES (?,?,?,?,NOW())`,
            [req.sapUser || 'sap_user', 'sap_export_' + format, rows.length, req.ip]
        );

        const formatted = rows.map(r =>
            sapIntegration.formatRecordForSAP(r, decryptTC(r.tc_encrypted))
        );

        if (format === 'json') {
            return res.json({
                count: formatted.length,
                records: formatted
            });
        }

        // CSV indir
        const csvString = sapIntegration.generateSAPCSV(formatted);
        const filename = `SAP_Puantaj_${new Date().toISOString().slice(0,10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvString);

    } catch (err) {
        console.error('[SAP Export Hata]:', err);
        res.status(500).json({ error: 'SAP dışa aktarım hatası.' });
    }
});

/**
 * POST /api/sap/sync
 * SAP tarafına başarıyla aktarılan kayıtları 'sap_synced = 1' olarak işaretler.
 * Gövde: { ids: [1, 2, 3] }
 */
app.post('/api/sap/sync', requireSAPOrAdmin, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
        if (ids.length === 0) {
            return res.status(400).json({ error: 'İşaretlenecek kayıt ID listesi boş.' });
        }

        const placeholders = ids.map(() => '?').join(',');
        const [result] = await pool.execute(
            `UPDATE attendance_logs
             SET sap_synced = 1, sap_synced_at = NOW()
             WHERE id IN (${placeholders})`,
            ids
        );

        await pool.execute(
            `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
             VALUES (?,?,?,?,NOW())`,
            [req.sapUser || 'sap_user', 'sap_sync_mark', result.affectedRows, req.ip]
        );

        res.json({ ok: true, updated_count: result.affectedRows });
    } catch (err) {
        console.error('[SAP Sync Hata]:', err);
        res.status(500).json({ error: 'SAP senkronizasyon güncelleme hatası.' });
    }
});

/**
 * POST /api/sap/al11-export
 * Puantaj verilerini doğrudan SAP AL11 uygulama sunucusu dizinine (.txt / .csv) yazar
 * ve aktarılan kayıtları 'sap_synced = 1' olarak işaretler.
 */
app.post('/api/sap/al11-export', requireSAPOrAdmin, async (req, res) => {
    try {
        const targetDir = process.env.SAP_AL11_DIR || req.body.target_dir || path.join(process.cwd(), 'sap_al11_export');
        const delimiter = req.body.delimiter || '\t';
        const limit = Math.min(Number(req.body.limit) || 2000, 10000);
        const unsyncedOnly = req.body.unsynced_only !== false; // Varsayılan: sadece henüz aktarılmamışlar

        let sql = `SELECT id, tc_encrypted, first_name, last_name, qr_data, device_id,
                          check_in_time, check_out_time, duration_minutes,
                          sap_synced, sap_synced_at
                   FROM attendance_logs WHERE check_out_time IS NOT NULL`;
        const params = [];

        if (unsyncedOnly) {
            sql += ` AND sap_synced = 0`;
        }
        if (req.body.start_date) {
            sql += ` AND check_in_time >= ?`;
            params.push(req.body.start_date + ' 00:00:00');
        }
        if (req.body.end_date) {
            sql += ` AND check_in_time <= ?`;
            params.push(req.body.end_date + ' 23:59:59');
        }

        sql += ` ORDER BY check_in_time ASC LIMIT ?`;
        params.push(String(limit));

        const [rows] = await pool.execute(sql, params);

        if (rows.length === 0) {
            return res.json({ ok: true, record_count: 0, message: 'Aktarılacak yeni puantaj kaydı bulunamadı.' });
        }

        const formatted = rows.map(r =>
            sapIntegration.formatRecordForSAP(r, decryptTC(r.tc_encrypted))
        );

        const result = sapIntegration.exportToAL11Directory(formatted, targetDir, { delimiter });

        // İşaretle: sap_synced = 1
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        await pool.execute(
            `UPDATE attendance_logs
             SET sap_synced = 1, sap_synced_at = NOW()
             WHERE id IN (${placeholders})`,
            ids
        );

        // KVKK loglama
        await pool.execute(
            `INSERT INTO admin_access_log (admin_user, action, record_count, ip, created_at)
             VALUES (?,?,?,?,NOW())`,
            [req.sapUser || 'sap_user', 'sap_al11_export', rows.length, req.ip]
        );

        res.json({
            ok: true,
            message: `${rows.length} kayıt SAP AL11 dizinine başarıyla aktarıldı.`,
            filename: result.filename,
            filepath: result.filepath,
            record_count: result.record_count,
            target_dir: targetDir
        });

    } catch (err) {
        console.error('[SAP AL11 Export Hata]:', err);
        res.status(500).json({ error: 'SAP AL11 aktarım hatası: ' + err.message });
    }
});

/* ---------------- KVKK: otomatik silme ---------------- */

/**
 * Saklama suresi dolan kayitlari siler.
 * Puantaj kayitlari icin 10 yil; konum verisi icin cok daha kisa (90 gun),
 * cunku konumun puantaj sonrasi saklanmasi icin mesru bir sebep yok.
 */
async function enforceRetention() {
    try {
        const [locResult] = await pool.execute(
            `UPDATE attendance_logs
             SET in_latitude = NULL, in_longitude = NULL, in_accuracy_m = NULL,
                 out_latitude = NULL, out_longitude = NULL, out_accuracy_m = NULL
             WHERE check_in_time < DATE_SUB(NOW(), INTERVAL 90 DAY)
               AND in_latitude IS NOT NULL`);

        const [delResult] = await pool.execute(
            `DELETE FROM attendance_logs
             WHERE check_in_time < DATE_SUB(NOW(), INTERVAL 10 YEAR)`);

        console.log(`[KVKK] Konum temizlendi: ${locResult.affectedRows}, ` +
                    `kayit silindi: ${delResult.affectedRows}`);
    } catch (err) {
        console.error('[KVKK] Saklama gorevi hatasi:', err.message);
    }
}

setInterval(enforceRetention, 24 * 60 * 60 * 1000);

/* ---------------- Statik dosyalar ---------------- */

// İşçi Mobil Web Uygulaması (Mobil Cihazlar / Safari / Android İçin)
app.use('/app', express.static(path.join(__dirname, '../app/src/main/assets'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
}));

// Yönetici Paneli
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));

app.get('/app', (req, res) => res.sendFile(path.join(__dirname, '../app/src/main/assets/index.html')));
app.get('/admin', (req, res) => res.redirect('/login.html'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../app/src/main/assets/index.html')));

async function initDb() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS devices (
                device_id        VARCHAR(32)  NOT NULL PRIMARY KEY,
                first_seen       DATETIME     NOT NULL,
                last_seen        DATETIME     NOT NULL,
                consent_version  SMALLINT     NOT NULL DEFAULT 1,
                blocked          BOOLEAN      NOT NULL DEFAULT FALSE,
                note             VARCHAR(255) NULL
            ) ENGINE=InnoDB;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
                tc_hash             CHAR(64)     NOT NULL,
                tc_encrypted        VARBINARY(255) NOT NULL,
                first_name          VARCHAR(50)  NOT NULL,
                last_name           VARCHAR(50)  NOT NULL,
                qr_data             VARCHAR(200) NOT NULL,
                device_id           VARCHAR(32)  NOT NULL,
                activity            VARCHAR(100) NULL,
                check_in_time       DATETIME     NOT NULL,
                check_out_time      DATETIME     NULL,
                duration_minutes    INT          NULL,
                in_latitude         DECIMAL(10,8) NULL,
                in_longitude        DECIMAL(11,8) NULL,
                in_accuracy_m       FLOAT        NULL,
                out_latitude        DECIMAL(10,8) NULL,
                out_longitude       DECIMAL(11,8) NULL,
                out_accuracy_m      FLOAT        NULL,
                location_consent    BOOLEAN      NOT NULL DEFAULT FALSE,
                consent_version     SMALLINT     NOT NULL,
                consent_granted_at  DATETIME     NOT NULL,
                created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tc (tc_hash),
                INDEX idx_in_time (check_in_time)
            ) ENGINE=InnoDB;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS worker_location_history (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                tc_hash     CHAR(64)     NOT NULL,
                device_id   VARCHAR(32)  NOT NULL,
                latitude    DECIMAL(10, 8) NULL,
                longitude   DECIMAL(11, 8) NULL,
                accuracy_m  FLOAT NULL,
                recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tc_time (tc_hash, recorded_at)
            ) ENGINE=InnoDB;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS projects (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                project_code VARCHAR(50)  NOT NULL UNIQUE,
                project_name VARCHAR(150) NOT NULL,
                is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
                created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS qr_codes (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                site_name   VARCHAR(150) NOT NULL UNIQUE,
                center_lat  DECIMAL(10,8) NULL,
                center_lng  DECIMAL(11,8) NULL,
                radius_m    INT NULL DEFAULT 500,
                created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);

        // Otomatik Sütun Eklemeleri (Migration)
        const [boundCols] = await pool.execute("SHOW COLUMNS FROM attendance_logs LIKE 'is_out_of_bounds'");
        if (!boundCols || boundCols.length === 0) {
            await pool.execute("ALTER TABLE attendance_logs ADD COLUMN is_out_of_bounds BOOLEAN NOT NULL DEFAULT FALSE");
        }

        const [qrLatCols] = await pool.execute("SHOW COLUMNS FROM qr_codes LIKE 'center_lat'");
        if (!qrLatCols || qrLatCols.length === 0) {
            await pool.execute("ALTER TABLE qr_codes ADD COLUMN center_lat DECIMAL(10,8) NULL, ADD COLUMN center_lng DECIMAL(11,8) NULL, ADD COLUMN radius_m INT NULL DEFAULT 500");
        }

        const [projCols] = await pool.execute("SHOW COLUMNS FROM attendance_logs LIKE 'project'");
        if (!projCols || projCols.length === 0) {
            await pool.execute("ALTER TABLE attendance_logs ADD COLUMN project VARCHAR(150) NULL AFTER activity");
            console.log("[DB] 'project' sütunu veritabanına otomatik eklendi.");
        }

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS workers (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                tc_hash      CHAR(64)       NOT NULL UNIQUE,
                tc_encrypted VARBINARY(255) NOT NULL,
                first_name   VARCHAR(50)    NOT NULL,
                last_name    VARCHAR(50)    NOT NULL,
                birth_date   DATE           NOT NULL,
                created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);
    } catch (err) {
        console.error("[DB] Veritabanı güncelleme hatası:", err.message);
    }
}

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Erkiz Takip sunucusu :${PORT} portunda çalışıyor`);
    await initDb();
    enforceRetention();
});
