/**
 * API istemcisi.
 *
 * Cihaz ilk kullanimda sunucuya kaydolur, sunucu kisa omurlu bir token
 * dondurur. Token sadece bellekte tutulur (localStorage'a yazilmaz), suresi
 * dolunca otomatik yenilenir.
 */
const Api = (function () {
    'use strict';

    // Eğer web tarayıcısı üzerinden HTTP/HTTPS ile erişiliyorsa (localhost, yerel ağ IP'si veya domain),
    // her zaman doğrudan mevcut origin'i kullan (örn: http://localhost:3000).
    // Yalnızca Android WebView yerel paketinde (appassets.androidplatform.net veya file://) config IP'sine başvur.
    let BASE = '';
    const locOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const isLocalWeb = locOrigin && (locOrigin.startsWith('http://') || locOrigin.startsWith('https://')) && !locOrigin.includes('appassets.androidplatform.net');

    if (isLocalWeb) {
        BASE = locOrigin;
    } else if (window.ErkizConfig && window.ErkizConfig.apiBase && window.ErkizConfig.apiBase.length > 5) {
        BASE = window.ErkizConfig.apiBase;
    } else {
        BASE = 'http://10.15.2.64:3000';
    }

    let token = null;
    let tokenExpiry = 0;

    async function ensureToken() {
        if (token && Date.now() < tokenExpiry - 30000) return token;

        let res;
        try {
            res = await fetch(BASE + '/api/device/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: Consent.deviceId(),
                    platform: 'android',
                    consent_version: Consent.VERSION
                })
            });
        } catch (netErr) {
            throw new Error('Sunucuya erişilemedi (' + BASE + '). İnternet/Wi-Fi bağlantınızı veya sunucuyu kontrol edin.');
        }

        if (!res.ok) {
            let serverMsg = 'Cihaz kaydı başarısız (Kod: ' + res.status + ')';
            try {
                const b = await res.json();
                if (b.error || b.message) serverMsg = b.error || b.message;
            } catch (e) {}
            throw new Error(serverMsg);
        }

        const data = await res.json();
        token = data.token;
        tokenExpiry = Date.now() + ((data.expires_in || 900) * 1000);
        return token;
    }

    async function sendRequest(path, payload, authToken) {
        return await fetch(BASE + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify(payload)
        });
    }

    async function post(path, payload) {
        const t = await ensureToken();

        let res = await sendRequest(path, payload, t);

        // Token suresi dolduysa bir kez yenile ve tekrar dene.
        if (res.status === 401) {
            token = null;
            const fresh = await ensureToken();
            res = await sendRequest(path, payload, fresh);
        }

        let body = {};
        try { body = await res.json(); } catch (e) { /* bos govde */ }
        return { ok: res.ok, status: res.status, body: body };
    }

    async function get(path) {
        try {
            const res = await fetch(BASE + path, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            let body = [];
            try { body = await res.json(); } catch (e) {}
            return { ok: res.ok, status: res.status, body: body };
        } catch (e) {
            return { ok: false, status: 0, body: null };
        }
    }

    return { post: post, get: get, base: BASE };
})();
