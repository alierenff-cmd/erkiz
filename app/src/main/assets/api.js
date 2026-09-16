/**
 * API istemcisi.
 *
 * Cihaz ilk kullanimda sunucuya kaydolur, sunucu kisa omurlu bir token
 * dondurur. Token sadece bellekte tutulur (localStorage'a yazilmaz), suresi
 * dolunca otomatik yenilenir.
 */
const Api = (function () {
    'use strict';

    /**
     * Sifresiz (http://) sunucuya yalnizca DEBUG APK'da izin verilir.
     * Uretim APK'sinda TC numaralari asla sifresiz baglantidan gonderilmez.
     */
    function insecureAllowed() {
        try {
            return !!(window.AndroidBridge && typeof AndroidBridge.isDebugBuild === 'function' &&
                      AndroidBridge.isDebugBuild());
        } catch (e) {
            return false;
        }
    }

    function isAcceptableUrl(url) {
        if (!url) return false;
        if (url.startsWith('https://')) return true;
        return url.startsWith('http://') && insecureAllowed();
    }

    function getBaseUrl() {
        const locOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
        const isLocalWeb = locOrigin && (locOrigin.startsWith('http://') || locOrigin.startsWith('https://')) && !locOrigin.includes('appassets.androidplatform.net');

        // Tarayicidan acilan web surumu her zaman kendi sunucusuyla konusur.
        if (isLocalWeb) {
            return locOrigin;
        }

        try {
            const custom = (localStorage.getItem('erkiz_server_url') || '').trim();
            if (isAcceptableUrl(custom)) {
                return custom.replace(/\/+$/, '');
            }
        } catch(e) {}

        if (window.ErkizConfig && window.ErkizConfig.apiBase && window.ErkizConfig.apiBase.length > 5) {
            return window.ErkizConfig.apiBase.trim().replace(/\/+$/, '');
        }

        return 'https://www.erkiztakip.com';
    }

    /** @returns {{ok:boolean, error?:string}} */
    function setServerUrl(newUrl) {
        try {
            if (!newUrl || !newUrl.trim()) {
                localStorage.removeItem('erkiz_server_url');
            } else {
                let clean = newUrl.trim().replace(/\/+$/, '');
                if (!/^https?:\/\//.test(clean)) {
                    clean = (insecureAllowed() ? 'http://' : 'https://') + clean;
                }
                if (!isAcceptableUrl(clean)) {
                    return { ok: false, error: 'Güvenlik nedeniyle yalnızca https:// ile başlayan sunucu adresleri kabul edilir.' };
                }
                localStorage.setItem('erkiz_server_url', clean);
            }
        } catch(e) {}
        token = null;
        tokenExpiry = 0;
        return { ok: true };
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
        if (typeof AbortController === 'undefined') {
            return await fetch(url, options);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            return res;
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error('Bağlantı zaman aşımı: Sunucuya ulaşılamadı (' + url + ')');
            }
            throw err;
        }
    }

    let token = null;
    let tokenExpiry = 0;

    async function ensureToken() {
        if (token && Date.now() < tokenExpiry - 30000) return token;

        const base = getBaseUrl();
        let res;
        try {
            res = await fetchWithTimeout(base + '/api/device/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: Consent.deviceId(),
                    platform: 'android',
                    consent_version: Consent.VERSION
                })
            }, 6000);
        } catch (netErr) {
            throw new Error('Sunucuya erişilemedi (' + base + '). İnternet/Wi-Fi bağlantınızı veya sunucuyu kontrol edin.');
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
        const base = getBaseUrl();
        return await fetchWithTimeout(base + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify(payload)
        }, 8000);
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
        const base = getBaseUrl();
        try {
            const res = await fetchWithTimeout(base + path, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            }, 6000);
            let body = [];
            try { body = await res.json(); } catch (e) {}
            return { ok: res.ok, status: res.status, body: body };
        } catch (e) {
            return { ok: false, status: 0, body: null, error: e.message };
        }
    }

    return { post, get, base: getBaseUrl, setServerUrl, getBaseUrl };
})();
