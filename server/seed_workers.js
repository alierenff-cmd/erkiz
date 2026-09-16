/**
 * DEVRE DISI - bu betik KULLANILMAMALIDIR.
 *
 * Eski surum TC hash'ini sunucudan (server.js) FARKLI bir yontemle uretiyordu
 * (ayri "pepper" + ham anahtar). Bu betikle eklenen isciler giris yapamiyordu.
 *
 * Isci listesini veritabanina aktarmak icin:
 *     node reseed_workers.js
 * veya Yonetici Paneli > Isci & Dogum Gunu Yonetimi > CSV ice aktar.
 */
'use strict';

console.error('[DEVRE DISI] seed_workers.js kullanilmiyor. Bunun yerine: node reseed_workers.js');
process.exit(1);
