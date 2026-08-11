/**
 * Sifre hashleme - Node'un dahili crypto.scrypt fonksiyonu ile.
 *
 * NEDEN bcrypt DEGIL?
 * bcrypt bir "native module"dur: kurulum sirasinda ya hazir derlenmis bir ikili
 * dosya indirmesi ya da C++ derleyicisi + Python ile kaynaktan derlenmesi gerekir.
 * Windows'ta bu ikisi de sik sik basarisiz olur (indirme ECONNRESET, ya da
 * node-gyp Python bulamaz). Kurulumun bu yuzden patlamasi kabul edilemez.
 *
 * scrypt, Node 10'dan beri cekirdekte gelir. Derleme YOK, indirme YOK.
 * Guvenlik acisindan bcrypt ile ayni sinifta: memory-hard, GPU saldirilarina
 * dirençli ve RFC 7914 standardi. OWASP tarafindan onerilen algoritmalardan biri.
 *
 * Hash formati:  scrypt$N$r$p$<salt-base64>$<hash-base64>
 * Parametreler hash'in icinde saklanir, boylece ileride maliyet artirilabilir
 * ve eski hash'ler dogrulanmaya devam eder.
 */
'use strict';

const crypto = require('crypto');

// N=2^15, r=8, p=1 -> ~32 MB bellek, ~150ms. Admin girisi icin dengeli:
// yeterince yavas (kaba kuvvet pahali), yeterince hizli (DoS riski yok).
// Rate limit ile birlikte dusunulmeli - login 15 dakikada 8 deneme ile sinirli.
const PARAMS = {
    N: 1 << 15,
    r: 8,
    p: 1,
    keylen: 64
};

// scrypt varsayilan bellek limiti bu N degeri icin yetersiz kalir.
const MAX_MEM = 256 * 1024 * 1024;

/**
 * Sifreyi hashler.
 * @param {string} password
 * @returns {Promise<string>} scrypt$N$r$p$salt$hash
 */
function hash(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(
            String(password), salt, PARAMS.keylen,
            { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM },
            (err, derived) => {
                if (err) return reject(err);
                resolve([
                    'scrypt',
                    PARAMS.N,
                    PARAMS.r,
                    PARAMS.p,
                    salt.toString('base64'),
                    derived.toString('base64')
                ].join('$'));
            }
        );
    });
}

/**
 * Sifreyi hash ile karsilastirir. Zamanlama saldirilarina karsi
 * sabit sureli karsilastirma kullanir.
 * @returns {Promise<boolean>}
 */
function compare(password, stored) {
    return new Promise(resolve => {
        if (typeof stored !== 'string') return resolve(false);

        const parts = stored.split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);

        const N = Number(parts[1]);
        const r = Number(parts[2]);
        const p = Number(parts[3]);
        if (!N || !r || !p) return resolve(false);

        let salt, expected;
        try {
            salt = Buffer.from(parts[4], 'base64');
            expected = Buffer.from(parts[5], 'base64');
        } catch (e) {
            return resolve(false);
        }

        crypto.scrypt(
            String(password), salt, expected.length,
            { N, r, p, maxmem: MAX_MEM },
            (err, derived) => {
                if (err) return resolve(false);
                try {
                    resolve(crypto.timingSafeEqual(derived, expected));
                } catch (e) {
                    resolve(false);
                }
            }
        );
    });
}

module.exports = { hash, compare };
