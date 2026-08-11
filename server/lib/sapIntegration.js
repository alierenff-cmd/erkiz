/**
 * Erkiz Isci Takip - SAP HCM / CATS / AL11 Entegrasyon Modülü
 *
 * Puantaj verilerini SAP standartlarina (YYYYMMDD tarih, HHMMSS saat,
 * CATS/LSMW veri formati, SAP AL11 dosya yapisi) donusturur ve CSV / JSON / AL11 ciktilari uretir.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function formatDateSAP(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function formatTimeSAP(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}${mm}${ss}`;
}

function formatISO(dateObj) {
    if (!dateObj) return null;
    const d = new Date(dateObj);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Tek bir puantaj kaydini SAP formatina donusturur.
 */
function formatRecordForSAP(record, decryptedTC) {
    const checkIn = record.check_in_time ? new Date(record.check_in_time) : null;
    const checkOut = record.check_out_time ? new Date(record.check_out_time) : null;

    const durationMinutes = record.duration_minutes || (checkIn && checkOut ? Math.round((checkOut - checkIn) / 60000) : 0);
    const durationHours = (durationMinutes / 60).toFixed(2);

    return {
        id: record.id,
        pernr_or_tc: decryptedTC || '',
        first_name: record.first_name || '',
        last_name: record.last_name || '',
        site_code: record.qr_data || '',
        device_id: record.device_id || '',
        check_in_date: formatDateSAP(checkIn),
        check_in_time: formatTimeSAP(checkIn),
        check_in_iso: formatISO(checkIn),
        check_out_date: formatDateSAP(checkOut),
        check_out_time: formatTimeSAP(checkOut),
        check_out_iso: formatISO(checkOut),
        duration_minutes: durationMinutes,
        duration_hours: Number(durationHours),
        sap_synced: Boolean(record.sap_synced),
        sap_synced_at: formatISO(record.sap_synced_at)
    };
}

/**
 * SAP CATS / LSMW uyumlu CSV metni uretir (noktali virgul veya virgul ayracli).
 */
function generateSAPCSV(sapRecords, delimiter = ';') {
    const headers = [
        'ID',
        'TC_KIMLIK_NO',
        'AD',
        'SOYAD',
        'SANTIYE_QR',
        'GIRIS_TARIHI',
        'GIRIS_SAATI',
        'CIKIS_TARIHI',
        'CIKIS_SAATI',
        'SURE_DAKIKA',
        'SURE_SAAT',
        'GIRIS_ISO',
        'CIKIS_ISO',
        'SENKRONIZE_DURUMU'
    ];

    const rows = sapRecords.map(r => [
        r.id,
        `"${r.pernr_or_tc}"`,
        `"${r.first_name.replace(/"/g, '""')}"`,
        `"${r.last_name.replace(/"/g, '""')}"`,
        `"${r.site_code.replace(/"/g, '""')}"`,
        r.check_in_date,
        r.check_in_time,
        r.check_out_date,
        r.check_out_time,
        r.duration_minutes,
        r.duration_hours,
        r.check_in_iso || '',
        r.check_out_iso || '',
        r.sap_synced ? 'S' : 'P'
    ]);

    // UTF-8 BOM eklenerek Excel / SAP CSV okuma Turkce karakter destegi saglanir
    const csvContent = [headers.join(delimiter)]
        .concat(rows.map(row => row.join(delimiter)))
        .join('\r\n');

    return '\uFEFF' + csvContent;
}

/**
 * SAP AL11 (SAP Application Server Filesystem) protokolune uygun
 * tab veya noktali virgul ayracli duz metin / CSV ciktisi uretir.
 * SAP ABAP OPEN DATASET yapisina tam uyumludur.
 */
function generateSAPAL11Text(sapRecords, delimiter = '\t') {
    const headers = [
        'PERNR_OR_TC',
        'FIRST_NAME',
        'LAST_NAME',
        'SITE_CODE',
        'CHECK_IN_DATE',
        'CHECK_IN_TIME',
        'CHECK_OUT_DATE',
        'CHECK_OUT_TIME',
        'DURATION_HOURS',
        'RECORD_ID'
    ];

    const rows = sapRecords.map(r => [
        r.pernr_or_tc,
        r.first_name,
        r.last_name,
        r.site_code,
        r.check_in_date,
        r.check_in_time,
        r.check_out_date,
        r.check_out_time,
        r.duration_hours,
        r.id
    ]);

    return [headers.join(delimiter)]
        .concat(rows.map(row => row.join(delimiter)))
        .join('\r\n');
}

/**
 * SAP AL11 Hedef Dizinine dosya yazar.
 */
function exportToAL11Directory(sapRecords, targetDir, options = {}) {
    const dir = targetDir || process.env.SAP_AL11_DIR || path.join(process.cwd(), 'sap_al11_export');

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const now = new Date();
    const timestamp = formatDateSAP(now) + '_' + formatTimeSAP(now);
    const filename = `PUANTAJ_AL11_${timestamp}.txt`;
    const filepath = path.join(dir, filename);

    const delimiter = options.delimiter || '\t';
    const content = generateSAPAL11Text(sapRecords, delimiter);

    // SAP ABAP varsayilan UTF-8 okumasi icin BOM olmadan veya BOM'lu yazilabilir
    fs.writeFileSync(filepath, '\uFEFF' + content, 'utf8');

    return {
        filepath,
        filename,
        record_count: sapRecords.length,
        created_at: now.toISOString()
    };
}

module.exports = {
    formatDateSAP,
    formatTimeSAP,
    formatRecordForSAP,
    generateSAPCSV,
    generateSAPAL11Text,
    exportToAL11Directory
};
