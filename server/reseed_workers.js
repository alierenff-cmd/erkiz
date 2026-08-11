const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
require('dotenv').config();

const pepper = process.env.TC_PEPPER || 'erkiz_takip_tc_pepper_2026_secure';
const keyHex = process.env.TC_ENCRYPTION_KEY;

if (!keyHex || keyHex.length !== 64) {
    console.error('TC_ENCRYPTION_KEY missing or invalid in .env!');
    process.exit(1);
}

const encKey = Buffer.from(keyHex, 'hex');

function hashTC(tc) {
    return crypto.createHmac('sha256', pepper).update(String(tc).trim()).digest('hex');
}

function encryptTC(tc) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(tc).trim(), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
}

function excelSerialToYYYYMMDD(serial) {
    const s = Number(serial);
    if (isNaN(s) || s <= 0) return '2000-01-01';
    
    // Excel epoch base: Dec 30 1899 (taking 1900 leap year bug into account)
    const base = new Date(1899, 11, 30);
    base.setDate(base.getDate() + Math.round(s));
    
    const year = base.getFullYear();
    const month = String(base.getMonth() + 1).padStart(2, '0');
    const day = String(base.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function reseed() {
    const file = 'C:\\Users\\ali_e\\OneDrive\\Documents\\T.C PERSONEL DOĞUM TARİHİ.xlsx';
    if (!fs.existsSync(file)) {
        console.error('Excel file not found at:', file);
        return;
    }

    const tempZip = path.join(__dirname, 'temp_reseed.zip');
    const tmpDir = path.join(__dirname, 'scratch_reseed');

    fs.copyFileSync(file, tempZip);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    child_process.execSync(`powershell -Command "Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${tmpDir}' -Force"`);

    let sharedStrings = [];
    const sharedPath = path.join(tmpDir, 'xl', 'sharedStrings.xml');
    if (fs.existsSync(sharedPath)) {
        const xml = fs.readFileSync(sharedPath, 'utf8');
        const matches = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        sharedStrings = matches.map(m => m.replace(/<[^>]+>/g, ''));
    }

    const sheetPath = path.join(tmpDir, 'xl', 'worksheets', 'sheet1.xml');
    if (!fs.existsSync(sheetPath)) {
        console.error('Sheet1.xml not found.');
        return;
    }

    const xml = fs.readFileSync(sheetPath, 'utf8');
    const rows = xml.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || [];

    const workersToInsert = [];

    rows.forEach((r, idx) => {
        if (idx === 0) return; // Header row
        const cells = r.match(/<c[^>]*>([\s\S]*?)<\/c>/g) || [];
        const vals = cells.map(c => {
            const isShared = c.includes('t="s"');
            const vMatch = c.match(/<v>(.*?)<\/v>/);
            if (!vMatch) return '';
            const val = vMatch[1];
            if (isShared) {
                return sharedStrings[parseInt(val)] || val;
            }
            return val;
        });

        const tc = (vals[0] || '').trim();
        const fullName = (vals[1] || '').trim();
        const rawDate = (vals[2] || '').trim();

        if (!/^[1-9][0-9]{10}$/.test(tc) || !fullName) return;

        const nameParts = fullName.split(/\s+/);
        let lastName = nameParts.pop() || '';
        let firstName = nameParts.join(' ') || lastName;
        if (!firstName) firstName = lastName;

        let bdateStr = '2000-01-01';
        if (rawDate.includes('.') || rawDate.includes('/') || rawDate.includes('-')) {
            const parts = rawDate.split(/[./-]/);
            if (parts.length >= 2) {
                const day = String(parts[0]).padStart(2, '0');
                const month = String(parts[1]).padStart(2, '0');
                const year = parts.length >= 3 && parts[2].length === 4 ? parts[2] : '2000';
                bdateStr = `${year}-${month}-${day}`;
            }
        } else {
            bdateStr = excelSerialToYYYYMMDD(rawDate);
        }

        workersToInsert.push({
            tc,
            firstName,
            lastName,
            bdateStr
        });
    });

    console.log(`Extracted ${workersToInsert.length} worker records from Excel.`);

    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'erkiz_app',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'erkiz_takip',
        waitForConnections: true,
        connectionLimit: 10
    });

    let updated = 0;
    for (const w of workersToInsert) {
        const tcHash = hashTC(w.tc);
        const tcEnc = encryptTC(w.tc);
        await pool.execute(
            `INSERT INTO workers (tc_hash, tc_encrypted, first_name, last_name, birth_date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date)`,
            [tcHash, tcEnc, w.firstName, w.lastName, w.bdateStr]
        );
        updated++;
    }

    console.log(`SUCCESS! All ${updated} worker birth dates successfully updated in MySQL database!`);
    await pool.end();
}

reseed().catch(err => {
    console.error('Reseed Error:', err);
    process.exit(1);
});
