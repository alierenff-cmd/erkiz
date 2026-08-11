/**
 * Riza yonetimi.
 *
 * KVKK acisindan onemli nokta: riza "ispatlanabilir" olmali. Bu yuzden sadece
 * true/false degil; hangi metin surumune, ne zaman, hangi cihazdan riza verildigi
 * de saklaniyor ve her istekle birlikte sunucuya gonderiliyor.
 *
 * Aydinlatma metni degisirse CONSENT_VERSION artirilir -> kullaniciya tekrar sorulur.
 */
const Consent = (function () {
    'use strict';

    const CONSENT_VERSION = 2;
    const KEY = 'erkiz_consent_v' + CONSENT_VERSION;
    const DEVICE_KEY = 'erkiz_device_id';

    /** @returns {{core:boolean, location:boolean, version:number, grantedAt:string}|null} */
    function read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            // Surum uyusmuyorsa gecersiz say, yeniden sor.
            if (parsed.version !== CONSENT_VERSION) return null;
            if (parsed.core !== true) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function save(core, location) {
        const record = {
            core: !!core,
            location: !!location,
            version: CONSENT_VERSION,
            grantedAt: new Date().toISOString(),
            deviceId: deviceId()
        };
        localStorage.setItem(KEY, JSON.stringify(record));
        return record;
    }

    /** Sadece konum tercihini gunceller, cekirdek rizayi korur. */
    function setLocation(allowed) {
        const current = read();
        if (!current) return null;
        current.location = !!allowed;
        current.locationUpdatedAt = new Date().toISOString();
        localStorage.setItem(KEY, JSON.stringify(current));
        return current;
    }

    function revokeAll() {
        localStorage.removeItem(KEY);
        localStorage.removeItem(DEVICE_KEY);
    }

    function hasCore() {
        return read() !== null;
    }

    function allowsLocation() {
        const c = read();
        return c !== null && c.location === true;
    }

    /** Kalici cihaz kimligi. Kisisel veri degil; ayni cihazdan tekrar kaydi tespit icin. */
    function deviceId() {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            const bytes = new Uint8Array(9);
            (self.crypto || self.msCrypto).getRandomValues(bytes);
            id = 'DEV-' + Array.from(bytes)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase();
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    }

    /** Sunucuya gonderilecek riza kaniti. */
    function proof() {
        const c = read();
        if (!c) return null;
        return {
            version: c.version,
            core_granted_at: c.grantedAt,
            location_granted: c.location,
            location_updated_at: c.locationUpdatedAt || c.grantedAt
        };
    }

    return {
        VERSION: CONSENT_VERSION,
        read, save, setLocation, revokeAll,
        hasCore, allowsLocation, deviceId, proof
    };
})();
