/**
 * Admin sifresi icin scrypt hash uretir.
 *
 *   node tools/hash-password.js "sifreniz"          -> aciklamali cikti
 *   node tools/hash-password.js "sifreniz" --raw    -> sadece hash (script icin)
 */
'use strict';

const password = require('../lib/password');

const pass = process.argv[2];
const raw = process.argv.includes('--raw');

if (!pass || pass.length < 12) {
    if (!raw) {
        console.error('\n[HATA] En az 12 karakterlik bir sifre verin.\n');
        console.error('Kullanim: node tools/hash-password.js "sifreniz"\n');
    }
    process.exit(1);
}

password.hash(pass).then(hash => {
    if (raw) {
        // Kurulum.bat bu ciktiyi dogrudan okur - baska hicbir sey yazdirma.
        process.stdout.write(hash);
    } else {
        console.log('\n.env dosyasina su satiri ekleyin:\n');
        console.log('ADMIN_PASSWORD_HASH=' + hash + '\n');
    }
}).catch(err => {
    if (!raw) console.error('[HATA]', err.message);
    process.exit(1);
});
