/**
 * .env dosyasini guvenli sekilde olusturur.
 *
 * NEDEN NODE ILE?
 * Windows batch'te `setlocal EnableDelayedExpansion` acikken, iceriginde `!`
 * gecen bir sifre `set /p` ile okundugunda SESSIZCE bozulur. Guclu sifrelerde
 * `!` sik kullanildigi icin bu ciddi bir tuzak: kullanici sifreyi dogru
 * girdigini sanir ama .env'e farkli bir deger yazilir ve girisi calismaz.
 *
 * Ayrica scrypt hash'leri `$` icerir; bunlarin batch echo ile yazilmasi da
 * kirilgandir. Bu yuzden sifre girisi ve dosya yazimi tamamen Node tarafinda.
 *
 * Kullanim: node tools/setup-env.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
let password;
try {
    password = require('../lib/password');
} catch (e) {
    console.error('\n[HATA] server/lib/password.js bulunamadi.\n');
    console.error('Bu dosya v2 surumuyle gelir. Klasorde eski surum');
    console.error('dosyalari duruyor olabilir. Klasoru silip zip\'i');
    console.error('bos bir klasore yeniden cikarin.\n');
    process.exit(1);
}

const ENV_PATH = path.join(__dirname, '..', '.env');

const isTTY = Boolean(process.stdin.isTTY);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: isTTY
});

// Satirlari sirayla tuketmek icin basit bir kuyruk. readline'in 'line'
// olayi, borudan gelen girdide tum satirlari pes pese yayinlar; bunlari
// biriktirmezsek sorular arasinda satir kaybolur.
const pending = [];
const waiting = [];

rl.on('line', line => {
    if (waiting.length) waiting.shift()(line);
    else pending.push(line);
});

let closed = false;
rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
});

function nextLine() {
    if (pending.length) return Promise.resolve(pending.shift());
    if (closed) return Promise.resolve(null);
    return new Promise(resolve => waiting.push(resolve));
}

function ask(question, { silent = false, defaultValue = '' } = {}) {
    process.stdout.write(question);

    // Yildizla maskeleme yalnizca gercek terminalde anlamli.
    let onData = null;
    if (silent && isTTY) {
        onData = chunk => {
            const s = String(chunk);
            if (s === '\n' || s === '\r' || s === '\u0004') return;
            if (s === '\u0003') { process.stdout.write('\n'); process.exit(1); }
            readline.moveCursor(process.stdout, -1, 0);
            process.stdout.write('*');
        };
        process.stdin.on('data', onData);
    }

    return nextLine().then(line => {
        if (onData) {
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
        } else if (!isTTY) {
            process.stdout.write('\n');
        }
        if (line === null) {
            console.error('\n[HATA] Girdi beklenmedik sekilde sona erdi.');
            process.exit(1);
        }
        return line.trim() || defaultValue;
    });
}

function secret() {
    return crypto.randomBytes(32).toString('hex');
}

async function main() {
    if (fs.existsSync(ENV_PATH)) {
        const overwrite = await ask(
            '\n[UYARI] .env dosyasi zaten var. Uzerine yazilsin mi? ' +
            'Mevcut ayarlar SILINIR (e/h): ');
        if (overwrite.toLowerCase() !== 'e') {
            console.log('       Atlaniyor, mevcut .env korundu.');
            rl.close();
            return;
        }
    }

    console.log('');
    const dbPass = await ask('   MySQL sifresi (erkiz_app kullanicisi icin): ',
                             { silent: true });
    if (!dbPass) {
        console.error('\n[HATA] Veritabani sifresi bos olamaz.');
        process.exit(1);
    }

    const adminUser = await ask('   Admin kullanici adi [admin]: ',
                                { defaultValue: 'admin' });

    console.log('   Admin sifresi en az 12 karakter olmali.');
    const adminPass = await ask('   Admin sifresi: ', { silent: true });

    if (!adminPass || adminPass.length < 12) {
        console.error('\n[HATA] Admin sifresi en az 12 karakter olmali.');
        process.exit(1);
    }

    const confirm = await ask('   Admin sifresi (tekrar): ', { silent: true });
    if (confirm !== adminPass) {
        console.error('\n[HATA] Sifreler eslesmiyor.');
        process.exit(1);
    }

    console.log('\n   Anahtarlar uretiliyor...');
    const passHash = await password.hash(adminPass);

    const content = [
        'PORT=3000',
        '',
        'DB_HOST=127.0.0.1',
        'DB_PORT=3306',
        'DB_USER=erkiz_app',
        `DB_PASSWORD=${dbPass}`,
        'DB_NAME=erkiz_takip',
        '',
        `JWT_SECRET=${secret()}`,
        `SESSION_SECRET=${secret()}`,
        `TC_ENCRYPTION_KEY=${secret()}`,
        '',
        `ADMIN_USERNAME=${adminUser}`,
        `ADMIN_PASSWORD_HASH=${passHash}`,
        ''
    ].join('\n');

    // Dosyayi sadece sahibi okuyabilsin (Windows'ta sinirli etkisi var,
    // Linux/Mac'te gercek koruma saglar)
    fs.writeFileSync(ENV_PATH, content, { encoding: 'utf8', mode: 0o600 });

    console.log('       [OK] .env olusturuldu.');
    console.log('');
    console.log('   [ONEMLI] TC_ENCRYPTION_KEY degerini KAYBETMEYIN.');
    console.log('   Bu anahtar degisirse veritabanindaki TC kimlik');
    console.log('   numaralari bir daha COZULEMEZ.');
    console.log('');

    rl.close();
}

main().catch(err => {
    console.error('\n[HATA]', err.message);
    process.exit(1);
});
