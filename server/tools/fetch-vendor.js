/**
 * Bir npm paketinden tek bir dosyayi cikarip vendor klasorune kopyalar.
 *
 * Kullanim:
 *   node tools/fetch-vendor.js <paket> <dosya> <hedef-klasor>
 *
 * Ornek:
 *   node tools/fetch-vendor.js qrcodejs qrcode.min.js public/vendor
 *
 * Neden CDN degil de bu? CDN'den cekilen script, kamera erisimi olan bir
 * sayfaya calisma aninda kod enjekte edilmesine acik birakir ve internet
 * yoksa uygulama calismaz. Kutuphaneyi yerelde sabitlemek her ikisini de cozer.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const [pkg, fileName, destDir] = process.argv.slice(2);

if (!pkg || !fileName || !destDir) {
    console.error('Kullanim: node tools/fetch-vendor.js <paket> <dosya> <hedef-klasor>');
    process.exit(1);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erkiz-vendor-'));

try {
    execFileSync(npmCmd, ['pack', pkg, '--silent'], {
        cwd: tmp,
        stdio: ['ignore', 'ignore', 'pipe']
    });

    const tarball = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    if (!tarball) throw new Error('Paket indirilemedi.');

    execFileSync('tar', ['-xzf', tarball], { cwd: tmp, stdio: 'ignore' });

    // Paket icinde dosyayi ara (bazi paketler alt klasorde tutar)
    const found = findFile(path.join(tmp, 'package'), fileName);
    if (!found) throw new Error(`${fileName} paket icinde bulunamadi.`);

    const target = path.resolve(destDir);
    fs.mkdirSync(target, { recursive: true });

    const outPath = path.join(target, fileName);
    fs.copyFileSync(found, outPath);

    // Butunluk kaydi: surum degisikligini fark edebilmek icin
    const hash = crypto.createHash('sha256')
                       .update(fs.readFileSync(outPath)).digest('hex');

    fs.writeFileSync(
        path.join(target, fileName + '.sha256'),
        hash + '  ' + fileName + '\n',
        'utf8'
    );

    console.log(`      [OK] ${fileName} indirildi.`);
    console.log(`      SHA-256: ${hash.slice(0, 16)}...`);
} catch (err) {
    console.error('      [HATA] ' + err.message);
    process.exitCode = 1;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

function findFile(dir, name) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const hit = findFile(full, name);
            if (hit) return hit;
        } else if (entry.name === name) {
            return full;
        }
    }
    return null;
}
