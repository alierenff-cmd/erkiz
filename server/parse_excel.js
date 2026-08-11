const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const file = 'C:\\Users\\ali_e\\OneDrive\\Documents\\T.C PERSONEL DOĞUM TARİHİ.xlsx';
const tempZip = path.join(__dirname, 'temp_excel.zip');
const tmpDir = path.join(__dirname, 'scratch_xlsx');

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
console.log('Shared Strings count:', sharedStrings.length);

const sheetPath = path.join(tmpDir, 'xl', 'worksheets', 'sheet1.xml');
if (fs.existsSync(sheetPath)) {
    const xml = fs.readFileSync(sheetPath, 'utf8');
    const rows = xml.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || [];
    console.log('Row count:', rows.length);
    rows.forEach((r, idx) => {
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
        console.log(`ROW ${idx + 1}:`, vals.join(' | '));
    });
}
