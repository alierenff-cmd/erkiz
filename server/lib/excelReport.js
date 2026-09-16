/**
 * Erkiz Isci Takip - Giriş-Çıkış ve Çalışma Saatleri Excel (.xlsx) Raporlama Modülü
 *
 * SAP fazla mesai ve maaş hesaplamalarını kendi HCM/Bordro modülünde yaptığı için,
 * bu rapor doğrudan işçilerin giriş-çıkış zamanlarını ve net çalışma saatlerini sunar:
 *
 * 1. Aylık Çalışma Saatleri İcmali (İşçi bazlı toplam gün, toplam saat, ortalama)
 * 2. Aylık Puantaj Matrisi (1 - 31 Gün bazında günlük çalışılan net saatler)
 * 3. Günlük Giriş - Çıkış Kayıtları (Tüm vardiya hareketleri, giriş/çıkış saatleri)
 */

'use strict';

const ExcelJS = require('exceljs');

const TURKISH_DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts'];
const TURKISH_MONTHS = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

function parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateTR(dateObj) {
    if (!dateObj) return '';
    const d = parseDate(dateObj);
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function formatTimeTR(dateObj) {
    if (!dateObj) return '';
    const d = parseDate(dateObj);
    if (!d) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function getDateKey(dateObj) {
    if (!dateObj) return '';
    const d = parseDate(dateObj);
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getDaysInMonth(year, monthIndexZeroBased) {
    return new Date(year, monthIndexZeroBased + 1, 0).getDate();
}

function getExcelColName(colIndex) {
    let colName = '';
    let dividend = colIndex;
    let modulo;

    while (dividend > 0) {
        modulo = (dividend - 1) % 26;
        colName = String.fromCharCode(65 + modulo) + colName;
        dividend = Math.floor((dividend - modulo) / 26);
    }
    return colName;
}

/**
 * Giriş-çıkış ve çalışma saatlerini içeren çok sayfalı bir Excel (.xlsx) çalışma kitabı oluşturur.
 *
 * @param {Array} records - attendance_logs satırları (çözülmüş TC ile)
 * @param {Object} options - { periodMonth: '2026-09', projectName: '' }
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function generateAttendanceWorkbook(records, options = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Erkiz İşçi Takip Sistemi';
    workbook.created = new Date();
    workbook.properties.date1904 = false;

    let periodYear, periodMonthIndex;
    if (options.periodMonth && /^\d{4}-\d{2}$/.test(options.periodMonth)) {
        const parts = options.periodMonth.split('-');
        periodYear = parseInt(parts[0], 10);
        periodMonthIndex = parseInt(parts[1], 10) - 1;
    } else {
        const now = new Date();
        periodYear = now.getFullYear();
        periodMonthIndex = now.getMonth();
    }

    const monthNameTR = TURKISH_MONTHS[periodMonthIndex] || '';
    const periodLabel = `${monthNameTR} ${periodYear}`;
    const daysInTargetMonth = getDaysInMonth(periodYear, periodMonthIndex);

    // Kurumsal Renk ve Stil Sabitleri
    const THEME_HEADER_BG = '1F497D'; // Lacivert
    const THEME_HEADER_FG = 'FFFFFF'; // Beyaz
    const ACCENT_BG = 'D9E1F2';       // Açık Mavi
    const WEEKEND_BG = 'F2F2F2';      // Hafta sonu açık gri
    const TOTAL_BG = 'E2EFDA';        // Genel toplam açık yeşil

    const BORDER_THIN = {
        top: { style: 'thin', color: { argb: 'D9D9D9' } },
        left: { style: 'thin', color: { argb: 'D9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'D9D9D9' } },
        right: { style: 'thin', color: { argb: 'D9D9D9' } }
    };

    const BORDER_HEADER = {
        top: { style: 'thin', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'medium', color: { argb: '000000' } },
        right: { style: 'thin', color: { argb: '000000' } }
    };

    const BORDER_TOTAL = {
        top: { style: 'thin', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'double', color: { argb: '000000' } },
        right: { style: 'thin', color: { argb: '000000' } }
    };

    /* ------------------------------------------------------------------ */
    /* 1. Veri Analizi ve İşçi Bazlı Günlük/Aylık Toplama                 */
    /* ------------------------------------------------------------------ */
    const workerMap = new Map();

    records.forEach(r => {
        const tc = String(r.tc_no || '').trim();
        if (!tc) return;

        if (!workerMap.has(tc)) {
            workerMap.set(tc, {
                tc_no: tc,
                first_name: r.first_name || '',
                last_name: r.last_name || '',
                fullName: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                project: r.project || r.qr_data || '',
                daysMap: {}, // 'YYYY-MM-DD' -> totalMinutes
                totalMinutes: 0,
                autoClosedCount: 0
            });
        }

        const worker = workerMap.get(tc);
        if (!worker.project && (r.project || r.qr_data)) {
            worker.project = r.project || r.qr_data;
        }

        const checkIn = parseDate(r.check_in_time);
        if (checkIn) {
            const dateKey = getDateKey(checkIn);
            let mins = Number(r.duration_minutes);
            if (isNaN(mins) || mins < 0) {
                const checkOut = parseDate(r.check_out_time);
                mins = checkOut ? Math.max(0, Math.round((checkOut - checkIn) / 60000)) : 0;
            }

            worker.daysMap[dateKey] = (worker.daysMap[dateKey] || 0) + mins;
            worker.totalMinutes += mins;

            if (r.auto_closed) {
                worker.autoClosedCount++;
            }
        }
    });

    const workersList = Array.from(workerMap.values()).sort((a, b) =>
        a.fullName.localeCompare(b.fullName, 'tr')
    );

    /* ================================================================== */
    /* SAYFA 1: Aylık Çalışma Saatleri İcmali                             */
    /* ================================================================== */
    const wsSummary = workbook.addWorksheet('Aylık Çalışma Saatleri İcmali', {
        views: [{ showGridLines: true }]
    });

    wsSummary.mergeCells('A1:K1');
    const titleCell1 = wsSummary.getCell('A1');
    titleCell1.value = 'ERKİZ MÜHENDİSLİK - AYLIK ÇALIŞMA SAATLERİ İCMALİ';
    titleCell1.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: '1F497D' } };
    titleCell1.alignment = { vertical: 'middle', horizontal: 'left' };
    wsSummary.getRow(1).height = 26;

    wsSummary.mergeCells('A2:K2');
    const subTitleCell1 = wsSummary.getCell('A2');
    subTitleCell1.value = `Dönem: ${periodLabel} | Rapor Tarihi: ${formatDateTR(new Date())} ${formatTimeTR(new Date())} | (SAP Fazla Mesai & Bordro Aktarımı İçin Hazırlanmıştır)`;
    subTitleCell1.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: '595959' } };
    subTitleCell1.alignment = { vertical: 'middle', horizontal: 'left' };
    wsSummary.getRow(2).height = 18;

    const summaryHeaders = [
        'Sıra',                        // A (Col 1)
        'T.C. Kimlik No',              // B (Col 2)
        'Adı Soyadı',                  // C (Col 3)
        'Proje / Şantiye',             // D (Col 4)
        'Dönem',                       // E (Col 5)
        'Çalışılan Gün Sayısı',        // F (Col 6)
        'Toplam Çalışma (Saat)',       // G (Col 7)
        'Toplam Çalışma (Dakika)',     // H (Col 8)
        'Günlük Ortalama (Saat)',      // I (Col 9)
        'Oto Kapanan Vardiya',         // J (Col 10)
        'Açıklama / Durum'             // K (Col 11)
    ];

    const headerRow1 = wsSummary.getRow(4);
    headerRow1.values = summaryHeaders;
    headerRow1.height = 28;
    headerRow1.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME_HEADER_BG } };
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: THEME_HEADER_FG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER_HEADER;
    });

    let sRowIdx = 5;
    workersList.forEach((w, idx) => {
        let daysWorked = 0;
        let totalMonthMinutes = 0;

        Object.keys(w.daysMap).forEach(dKey => {
            const [yStr, mStr] = dKey.split('-');
            if (parseInt(yStr, 10) === periodYear && parseInt(mStr, 10) === (periodMonthIndex + 1)) {
                const dayMins = w.daysMap[dKey];
                if (dayMins > 0) {
                    daysWorked++;
                    totalMonthMinutes += dayMins;
                }
            }
        });

        if (daysWorked === 0 && Object.keys(w.daysMap).length > 0) {
            Object.keys(w.daysMap).forEach(dKey => {
                const dayMins = w.daysMap[dKey];
                if (dayMins > 0) {
                    daysWorked++;
                    totalMonthMinutes += dayMins;
                }
            });
        }

        const totalMonthHours = Math.round((totalMonthMinutes / 60) * 100) / 100;

        const row = wsSummary.getRow(sRowIdx);
        row.height = 20;

        row.getCell(1).value = idx + 1;
        row.getCell(2).value = String(w.tc_no);
        row.getCell(2).numFmt = '@';
        row.getCell(3).value = w.fullName;
        row.getCell(4).value = w.project;
        row.getCell(5).value = periodLabel;
        row.getCell(6).value = daysWorked;
        row.getCell(7).value = totalMonthHours;
        row.getCell(8).value = totalMonthMinutes;

        // Günlük Ortalama Formülü: =IF(F{row}>0, ROUND(G{row}/F{row}, 2), 0)
        row.getCell(9).value = { formula: `IF(F${sRowIdx}>0, ROUND(G${sRowIdx}/F${sRowIdx}, 2), 0)` };
        row.getCell(10).value = w.autoClosedCount;
        row.getCell(11).value = w.autoClosedCount > 0 ? `${w.autoClosedCount} vardiya akşam otomatik kapatıldı` : 'Eksiksiz';

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'left' };
        row.getCell(4).alignment = { horizontal: 'left' };
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).alignment = { horizontal: 'right' };
        row.getCell(6).numFmt = '#,##0';
        row.getCell(7).alignment = { horizontal: 'right' };
        row.getCell(7).numFmt = '#,##0.00';
        row.getCell(7).font = { bold: true };
        row.getCell(8).alignment = { horizontal: 'right' };
        row.getCell(8).numFmt = '#,##0';
        row.getCell(9).alignment = { horizontal: 'right' };
        row.getCell(9).numFmt = '#,##0.00';
        row.getCell(10).alignment = { horizontal: 'center' };
        row.getCell(10).numFmt = '#,##0';
        row.getCell(11).alignment = { horizontal: 'left' };

        const isEven = (idx % 2 === 1);
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = BORDER_THIN;
            if (isEven) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
            }
        });

        sRowIdx++;
    });

    // GENEL TOPLAM SATIRI
    const totalRowIdx1 = sRowIdx;
    const totalRow1 = wsSummary.getRow(totalRowIdx1);
    totalRow1.height = 24;

    totalRow1.getCell(1).value = '';
    totalRow1.getCell(2).value = '';
    totalRow1.getCell(3).value = 'GENEL TOPLAM';
    totalRow1.getCell(4).value = '';
    totalRow1.getCell(5).value = '';

    if (workersList.length > 0) {
        totalRow1.getCell(6).value = { formula: `SUM(F5:F${totalRowIdx1 - 1})` };
        totalRow1.getCell(7).value = { formula: `SUM(G5:G${totalRowIdx1 - 1})` };
        totalRow1.getCell(8).value = { formula: `SUM(H5:H${totalRowIdx1 - 1})` };
        totalRow1.getCell(9).value = { formula: `IF(F${totalRowIdx1}>0, ROUND(G${totalRowIdx1}/F${totalRowIdx1}, 2), 0)` };
        totalRow1.getCell(10).value = { formula: `SUM(J5:J${totalRowIdx1 - 1})` };
    }

    totalRow1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Segoe UI', size: 10, bold: true };
        cell.border = BORDER_TOTAL;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };

        if ([6, 8, 10].includes(colNumber)) {
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right' };
        } else if ([7, 9].includes(colNumber)) {
            cell.numFmt = '#,##0.00';
            cell.alignment = { horizontal: 'right' };
        }
    });

    const colWidths1 = [6, 16, 26, 22, 16, 18, 22, 22, 20, 20, 30];
    colWidths1.forEach((w, i) => {
        wsSummary.getColumn(i + 1).width = w;
    });

    /* ================================================================== */
    /* SAYFA 2: Aylık Puantaj Matrisi (1 - 31 Gün)                         */
    /* ================================================================== */
    const wsMatrix = workbook.addWorksheet('Aylık Puantaj Matrisi', {
        views: [{ showGridLines: true }]
    });

    const totalColsMatrix = 4 + daysInTargetMonth + 2;
    const lastColLetterMatrix = getExcelColName(totalColsMatrix);

    wsMatrix.mergeCells(`A1:${lastColLetterMatrix}1`);
    const titleCell2 = wsMatrix.getCell('A1');
    titleCell2.value = `ERKİZ MÜHENDİSLİK - GÜNLÜK ÇALIŞMA SAATLERİ PUANTAJ MATRİSİ (${periodLabel.toUpperCase()})`;
    titleCell2.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: '1F497D' } };
    titleCell2.alignment = { vertical: 'middle', horizontal: 'left' };
    wsMatrix.getRow(1).height = 24;

    wsMatrix.mergeCells(`A2:${lastColLetterMatrix}2`);
    const subTitleCell2 = wsMatrix.getCell('A2');
    subTitleCell2.value = `Hücrelerdeki değerler saat cinsindedir. Gri sütunlar hafta sonunu (Cumartesi / Pazar) belirtir.`;
    subTitleCell2.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: '595959' } };
    wsMatrix.getRow(2).height = 16;

    const matrixHeader1 = ['Sıra', 'T.C. Kimlik No', 'Adı Soyadı', 'Proje'];
    const weekendColIndices = new Set();

    for (let day = 1; day <= daysInTargetMonth; day++) {
        const dateObj = new Date(periodYear, periodMonthIndex, day);
        const dayOfWeek = dateObj.getDay();
        const dayName = TURKISH_DAYS_SHORT[dayOfWeek];
        const dayLabel = `${String(day).padStart(2, '0')} ${dayName}`;
        matrixHeader1.push(dayLabel);

        const colIndex = 4 + day;
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekendColIndices.add(colIndex);
        }
    }
    matrixHeader1.push('Toplam Gün');
    matrixHeader1.push('Toplam Saat');

    const mHeaderRow = wsMatrix.getRow(4);
    mHeaderRow.values = matrixHeader1;
    mHeaderRow.height = 26;

    mHeaderRow.eachCell((cell, colNumber) => {
        const isWeekend = weekendColIndices.has(colNumber);
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isWeekend ? '2F5597' : THEME_HEADER_BG }
        };
        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: THEME_HEADER_FG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = BORDER_HEADER;
    });

    let mRowIdx = 5;
    workersList.forEach((w, idx) => {
        const row = wsMatrix.getRow(mRowIdx);
        row.height = 19;

        row.getCell(1).value = idx + 1;
        row.getCell(2).value = String(w.tc_no);
        row.getCell(2).numFmt = '@';
        row.getCell(3).value = w.fullName;
        row.getCell(4).value = w.project;

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'left' };
        row.getCell(4).alignment = { horizontal: 'left' };

        for (let day = 1; day <= daysInTargetMonth; day++) {
            const colNum = 4 + day;
            const dayStr = String(day).padStart(2, '0');
            const mStr = String(periodMonthIndex + 1).padStart(2, '0');
            const dKey = `${periodYear}-${mStr}-${dayStr}`;

            const mins = w.daysMap[dKey] || 0;
            const cell = row.getCell(colNum);

            if (mins > 0) {
                const hours = Math.round((mins / 60) * 100) / 100;
                cell.value = hours;
                cell.numFmt = '0.00';
            } else {
                cell.value = null;
            }

            cell.alignment = { horizontal: 'center' };
            if (weekendColIndices.has(colNum)) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKEND_BG } };
            }
        }

        const startDayColLetter = 'E';
        const endDayColLetter = getExcelColName(4 + daysInTargetMonth);
        const totDaysColNum = 5 + daysInTargetMonth;
        const totHoursColNum = 6 + daysInTargetMonth;

        const totDaysCell = row.getCell(totDaysColNum);
        totDaysCell.value = { formula: `COUNTIF(${startDayColLetter}${mRowIdx}:${endDayColLetter}${mRowIdx}, ">0")` };
        totDaysCell.alignment = { horizontal: 'right' };
        totDaysCell.numFmt = '#,##0';
        totDaysCell.font = { bold: true };
        totDaysCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_BG } };

        const totHoursCell = row.getCell(totHoursColNum);
        totHoursCell.value = { formula: `SUM(${startDayColLetter}${mRowIdx}:${endDayColLetter}${mRowIdx})` };
        totHoursCell.alignment = { horizontal: 'right' };
        totHoursCell.numFmt = '#,##0.00';
        totHoursCell.font = { bold: true };
        totHoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_BG } };

        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = BORDER_THIN;
        });

        mRowIdx++;
    });

    // GENEL TOPLAM SATIRI (Matris)
    const mTotalRowIdx = mRowIdx;
    const mTotalRow = wsMatrix.getRow(mTotalRowIdx);
    mTotalRow.height = 22;

    mTotalRow.getCell(1).value = '';
    mTotalRow.getCell(2).value = '';
    mTotalRow.getCell(3).value = 'GÜNLÜK TOPLAM (SAAT)';
    mTotalRow.getCell(4).value = '';

    for (let day = 1; day <= daysInTargetMonth; day++) {
        const colNum = 4 + day;
        const colLetter = getExcelColName(colNum);
        const cell = mTotalRow.getCell(colNum);
        if (workersList.length > 0) {
            cell.value = { formula: `SUM(${colLetter}5:${colLetter}${mTotalRowIdx - 1})` };
        }
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'center' };
    }

    if (workersList.length > 0) {
        const totDaysLetter = getExcelColName(5 + daysInTargetMonth);
        const totHoursLetter = getExcelColName(6 + daysInTargetMonth);
        mTotalRow.getCell(5 + daysInTargetMonth).value = { formula: `SUM(${totDaysLetter}5:${totDaysLetter}${mTotalRowIdx - 1})` };
        mTotalRow.getCell(6 + daysInTargetMonth).value = { formula: `SUM(${totHoursLetter}5:${totHoursLetter}${mTotalRowIdx - 1})` };
    }

    mTotalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Segoe UI', size: 9, bold: true };
        cell.border = BORDER_TOTAL;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
    });

    wsMatrix.getColumn(1).width = 5;
    wsMatrix.getColumn(2).width = 15;
    wsMatrix.getColumn(3).width = 22;
    wsMatrix.getColumn(4).width = 18;
    for (let day = 1; day <= daysInTargetMonth; day++) {
        wsMatrix.getColumn(4 + day).width = 7.5;
    }
    wsMatrix.getColumn(5 + daysInTargetMonth).width = 14;
    wsMatrix.getColumn(6 + daysInTargetMonth).width = 15;

    /* ================================================================== */
    /* SAYFA 3: Günlük Giriş - Çıkış ve Vardiya Kayıtları                 */
    /* ================================================================== */
    const wsDetail = workbook.addWorksheet('Giriş - Çıkış Kayıtları', {
        views: [{ showGridLines: true }]
    });

    wsDetail.mergeCells('A1:N1');
    const titleCell3 = wsDetail.getCell('A1');
    titleCell3.value = 'ERKİZ MÜHENDİSLİK - GÜNLÜK DETAYLI GİRİŞ VE ÇIKIŞ KAYITLARI';
    titleCell3.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: '1F497D' } };
    titleCell3.alignment = { vertical: 'middle', horizontal: 'left' };
    wsDetail.getRow(1).height = 26;

    wsDetail.mergeCells('A2:N2');
    const subTitleCell3 = wsDetail.getCell('A2');
    subTitleCell3.value = `Tüm işçilerin giriş saatleri, çıkış saatleri, süreleri ve durumları kronolojik sırayla listelenmiştir.`;
    subTitleCell3.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: '595959' } };
    wsDetail.getRow(2).height = 18;

    const detailHeaders = [
        'Kayıt No',            // A
        'Tarih',               // B
        'T.C. Kimlik No',      // C
        'Adı Soyadı',          // D
        'Proje',               // E
        'Saha (QR Kodu)',      // F
        'Aktivite / Görev',    // G
        'Giriş Saati',         // H
        'Çıkış Saati',         // I
        'Çalışma Süresi (Saat)', // J (Ondalık saat, SAP/CATS formatına uygun)
        'Çalışma Süresi (Dk)', // K
        'Konum / GPS Durumu',  // L
        'Kapanış Durumu',      // M
        'Cihaz Kodu'           // N
    ];

    const headerRow3 = wsDetail.getRow(4);
    headerRow3.values = detailHeaders;
    headerRow3.height = 26;
    headerRow3.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME_HEADER_BG } };
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: THEME_HEADER_FG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = BORDER_HEADER;
    });

    let dRowIdx = 5;
    records.forEach((r, idx) => {
        const row = wsDetail.getRow(dRowIdx);
        row.height = 19;

        const checkIn = parseDate(r.check_in_time);
        const checkOut = parseDate(r.check_out_time);

        let durationMins = Number(r.duration_minutes);
        if (isNaN(durationMins) || durationMins < 0) {
            durationMins = checkIn && checkOut ? Math.max(0, Math.round((checkOut - checkIn) / 60000)) : 0;
        }
        const durationHours = Math.round((durationMins / 60) * 100) / 100;

        let locationStatus = 'Belirtilmedi';
        if (r.is_out_of_bounds) {
            locationStatus = '⚠️ Saha Dışı';
        } else if (r.latitude != null || r.in_latitude != null) {
            locationStatus = '✅ Saha İçi (Doğrulandı)';
        }

        let closeStatus = 'Sürüyor';
        if (r.auto_closed) {
            closeStatus = '🌙 Akşam 18:00 Oto Kapatıldı';
        } else if (r.check_out_time) {
            closeStatus = r.auto_close_reason ? r.auto_close_reason : '✅ Normal Çıkış';
        }

        row.getCell(1).value = r.id || idx + 1;
        row.getCell(2).value = formatDateTR(checkIn);
        row.getCell(3).value = String(r.tc_no || '');
        row.getCell(3).numFmt = '@';
        row.getCell(4).value = `${r.first_name || ''} ${r.last_name || ''}`.trim();
        row.getCell(5).value = r.project || '';
        row.getCell(6).value = r.qr_data || '';
        row.getCell(7).value = r.activity || '';
        row.getCell(8).value = formatTimeTR(checkIn);
        row.getCell(9).value = checkOut ? formatTimeTR(checkOut) : 'Devam Ediyor';
        row.getCell(10).value = durationHours;
        row.getCell(10).numFmt = '#,##0.00';
        row.getCell(11).value = durationMins;
        row.getCell(11).numFmt = '#,##0';
        row.getCell(12).value = locationStatus;
        row.getCell(13).value = closeStatus;
        row.getCell(14).value = r.device_id || '';

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'left' };
        row.getCell(5).alignment = { horizontal: 'left' };
        row.getCell(6).alignment = { horizontal: 'left' };
        row.getCell(7).alignment = { horizontal: 'left' };
        row.getCell(8).alignment = { horizontal: 'center' };
        row.getCell(9).alignment = { horizontal: 'center' };
        row.getCell(10).alignment = { horizontal: 'right' };
        row.getCell(10).font = { bold: true };
        row.getCell(11).alignment = { horizontal: 'right' };
        row.getCell(12).alignment = { horizontal: 'center' };
        row.getCell(13).alignment = { horizontal: 'left' };
        row.getCell(14).alignment = { horizontal: 'center' };

        const isEven = (idx % 2 === 1);
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = BORDER_THIN;
            if (isEven) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
            }
        });

        dRowIdx++;
    });

    // Detay Toplam Satırı
    const dTotalRowIdx = dRowIdx;
    const dTotalRow = wsDetail.getRow(dTotalRowIdx);
    dTotalRow.height = 22;

    dTotalRow.getCell(1).value = '';
    dTotalRow.getCell(2).value = '';
    dTotalRow.getCell(3).value = '';
    dTotalRow.getCell(4).value = 'TOPLAM';
    if (records.length > 0) {
        dTotalRow.getCell(10).value = { formula: `SUM(J5:J${dTotalRowIdx - 1})` };
        dTotalRow.getCell(11).value = { formula: `SUM(K5:K${dTotalRowIdx - 1})` };
    }

    dTotalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Segoe UI', size: 10, bold: true };
        cell.border = BORDER_TOTAL;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
        if (colNumber === 10) {
            cell.numFmt = '#,##0.00';
            cell.alignment = { horizontal: 'right' };
        } else if (colNumber === 11) {
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right' };
        }
    });

    const colWidths3 = [10, 14, 16, 22, 18, 18, 18, 14, 14, 20, 16, 22, 24, 20];
    colWidths3.forEach((w, i) => {
        wsDetail.getColumn(i + 1).width = w;
    });

    return workbook;
}

module.exports = {
    generateAttendanceWorkbook,
    formatDateTR,
    formatTimeTR
};
