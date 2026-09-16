/**
 * Yonetici paneli.
 *
 * Her hucre createElement + textContent ile olusturuluyor (XSS korumasi).
 */
(function () {
    'use strict';

    const ADMIN_JS_VERSION = '20260810-v3';
    const apiBase = window.location.origin;
    const el = id => document.getElementById(id);

    /** innerHTML'e giden her dinamik deger buradan gecmeli (XSS korumasi). */
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    console.log('[Erkiz Admin] admin.js version:', ADMIN_JS_VERSION);

    let logsCache = [];
    let workersCache = [];
    let projectsCache = [];
    let qrCodesCache = [];
    let selectedLogForCheckout = null;
    let selectedCsvText = '';

    let selectedSiteForGeofence = null;
    let geofenceMap = null;
    let geofenceMarker = null;
    let geofenceCircle = null;

    /* ---------------- QR Üretimi ve Çalışma Alanı Yönetimi ---------------- */

    async function loadAdminQRCodes() {
        try {
            const res = await fetch(apiBase + '/api/admin/qr-codes', { credentials: 'include' });
            console.log('[Erkiz] QR codes response:', res.status);
            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) { console.error('[Erkiz] QR codes error:', res.status); return; }
            const qrCodes = await res.json();
            renderQRList(qrCodes);
        } catch (e) { console.error('[Erkiz] QR codes exception:', e); }
    }

    function renderQRList(qrCodes) {
        qrCodesCache = qrCodes || [];
        if (typeof updateSiteDropdowns === 'function') updateSiteDropdowns();
        const list = el('qr-list');
        if (!list) return;
        list.innerHTML = '';
        if (!qrCodes.length) {
            list.innerHTML = '<li style="color: var(--ios-gray); font-style: italic;">Henüz kayıtlı Saha QR Kodu yok.</li>';
            return;
        }

        qrCodes.forEach(q => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 0.5px solid #eee;';

            const nameSpan = document.createElement('span');
            const gfBadge = q.center_lat ? ` <span style="font-size:0.75rem; color:#34C759;">(🗺️ Boundary: ${esc(q.radius_m || 500)}m)</span>` : '';
            nameSpan.innerHTML = `📍 <strong>${esc(q.site_name)}</strong>${gfBadge}`;

            const btnWrap = document.createElement('div');
            btnWrap.style.cssText = 'display:flex; gap:6px;';

            const mapBtn = document.createElement('button');
            mapBtn.className = 'btn btn-primary';
            mapBtn.textContent = '🗺️ Çalışma Alanı';
            mapBtn.style.padding = '4px 10px';
            mapBtn.style.fontSize = '0.8rem';
            mapBtn.style.backgroundColor = '#FF9500';
            mapBtn.addEventListener('click', () => openGeofenceModal(q));

            const showBtn = document.createElement('button');
            showBtn.className = 'btn btn-primary';
            showBtn.textContent = 'Göster';
            showBtn.style.padding = '4px 10px';
            showBtn.style.fontSize = '0.8rem';
            showBtn.addEventListener('click', () => renderQRForSite(q.site_name));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete';
            delBtn.textContent = 'Sil';
            delBtn.style.padding = '4px 8px';
            delBtn.addEventListener('click', () => deleteQRCode(q.id));

            btnWrap.appendChild(mapBtn);
            btnWrap.appendChild(showBtn);
            btnWrap.appendChild(delBtn);

            li.appendChild(nameSpan);
            li.appendChild(btnWrap);
            list.appendChild(li);
        });
    }

    function openGeofenceModal(site) {
        selectedSiteForGeofence = site;
        const title = el('geofence-site-title');
        if (title) title.textContent = `Saha: ${site.site_name}`;

        const latInput = el('gf-lat');
        const lngInput = el('gf-lng');
        const radiusInput = el('gf-radius');

        const initialLat = site.center_lat ? Number(site.center_lat) : 39.9207;
        const initialLng = site.center_lng ? Number(site.center_lng) : 32.8541;
        const initialRadius = site.radius_m ? Number(site.radius_m) : 500;

        if (latInput) latInput.value = site.center_lat || '';
        if (lngInput) lngInput.value = site.center_lng || '';
        if (radiusInput) radiusInput.value = initialRadius;

        const modal = el('modal-geofence');
        if (modal) modal.hidden = false;

        setTimeout(() => {
            if (!geofenceMap) {
                geofenceMap = L.map('geofence-map').setView([initialLat, initialLng], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '© OpenStreetMap'
                }).addTo(geofenceMap);

                geofenceMap.on('click', function(e) {
                    updateGeofenceMapPin(e.latlng.lat, e.latlng.lng);
                });
            } else {
                geofenceMap.invalidateSize();
                geofenceMap.setView([initialLat, initialLng], 14);
            }

            updateGeofenceMapPin(initialLat, initialLng);
        }, 200);
    }

    function updateGeofenceMapPin(lat, lng) {
        const radiusInput = el('gf-radius');
        const radius = radiusInput ? Number(radiusInput.value) || 500 : 500;

        if (el('gf-lat')) el('gf-lat').value = Number(lat).toFixed(6);
        if (el('gf-lng')) el('gf-lng').value = Number(lng).toFixed(6);

        if (geofenceMarker) geofenceMap.removeLayer(geofenceMarker);
        if (geofenceCircle) geofenceMap.removeLayer(geofenceCircle);

        geofenceMarker = L.marker([lat, lng], { draggable: true }).addTo(geofenceMap);
        geofenceCircle = L.circle([lat, lng], {
            color: '#FF3B30',
            fillColor: '#FF3B30',
            fillOpacity: 0.2,
            radius: radius
        }).addTo(geofenceMap);

        geofenceMarker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            updateGeofenceMapPin(pos.lat, pos.lng);
        });
    }

    function closeGeofenceModal() {
        selectedSiteForGeofence = null;
        const modal = el('modal-geofence');
        if (modal) modal.hidden = true;
    }

    async function saveGeofence() {
        if (!selectedSiteForGeofence) return;
        const latVal = parseFloat(el('gf-lat').value);
        const lngVal = parseFloat(el('gf-lng').value);
        const radiusVal = parseInt(el('gf-radius').value, 10);

        if (isNaN(latVal) || isNaN(lngVal)) {
            alert('Lütfen haritadan geçerli bir merkez noktası seçiniz.');
            return;
        }

        try {
            const res = await fetch(`${apiBase}/api/admin/qr-codes/${selectedSiteForGeofence.id}/geofence`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    center_lat: latVal,
                    center_lng: lngVal,
                    radius_m: radiusVal || 500
                })
            });

            if (res.ok) {
                alert(`BAŞARILI!\n"${selectedSiteForGeofence.site_name}" sahası için ${radiusVal || 500} metre yarıçaplı çalışma alanı sınırı kaydedildi.`);
                closeGeofenceModal();
                loadAdminQRCodes();
            } else {
                alert('Çalışma alanı kaydedilemedi.');
            }
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    async function generateQR() {
        const saha = el('saha-adi').value.trim();
        if (!saha) {
            alert('Lütfen bir saha adı giriniz.');
            return;
        }

        try {
            await fetch(apiBase + '/api/admin/qr-codes', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ site_name: saha })
            });
            el('saha-adi').value = '';
            renderQRForSite(saha);
            loadAdminQRCodes();
        } catch (e) {
            renderQRForSite(saha);
        }
    }

    function renderQRForSite(saha) {
        const container = el('qrcode-display');
        container.textContent = '';
        container.hidden = false;

        new QRCode(container, {
            text: saha,
            width: 220,
            height: 220,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        const caption = document.createElement('div');
        caption.className = 'qr-caption';
        caption.textContent = saha;
        container.appendChild(caption);

        if (el('qr-actions')) el('qr-actions').hidden = false;
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function deleteQRCode(id) {
        if (!confirm('Bu Saha QR kodunu silmek istediğinize emin misiniz?')) return;
        try {
            const res = await fetch(apiBase + '/api/admin/qr-codes/' + id, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });
            if (res.ok) {
                closeQR();
                loadAdminQRCodes();
            } else {
                alert('Saha QR kodu silinemedi.');
            }
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    function closeQR() {
        const container = el('qrcode-display');
        if (container) {
            container.textContent = '';
            container.hidden = true;
        }
        if (el('qr-actions')) el('qr-actions').hidden = true;
    }

    /* ---------------- Tablo ve Puantaj Logları ---------------- */

    function cell(text) {
        const td = document.createElement('td');
        td.textContent = text == null ? '-' : String(text);
        return td;
    }

    function fmtDate(value) {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    }

    function maskTc(tc) {
        const s = String(tc || '');
        if (s.length !== 11) return s;
        return s.slice(0, 3) + '*****' + s.slice(-3);
    }

    function locationCell(log) {
        const td = document.createElement('td');

        if (log.location_consent === false) {
            td.textContent = 'Rıza yok';
            td.className = 'muted';
            return td;
        }
        if (log.latitude == null || log.longitude == null) {
            td.textContent = 'Alınamadı';
            td.className = 'muted';
            return td;
        }

        const lat = Number(log.latitude).toFixed(5);
        const lng = Number(log.longitude).toFixed(5);

        const link = document.createElement('a');
        link.href = 'https://www.openstreetmap.org/?mlat=' +
                    encodeURIComponent(lat) + '&mlon=' + encodeURIComponent(lng) +
                    '#map=17/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lng);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = lat + ', ' + lng;

        td.appendChild(link);
        return td;
    }

    function renderRows(logs) {
        const tbody = el('logs-body');
        tbody.textContent = '';

        if (!logs || logs.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 11;
            td.textContent = 'Henüz puantaj kaydı bulunmuyor.';
            td.className = 'empty-msg';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');

            tr.appendChild(cell(maskTc(log.tc_no)));
            tr.appendChild(cell((log.first_name || '') + ' ' + (log.last_name || '')));
            tr.appendChild(cell(log.qr_data));
            tr.appendChild(cell(log.project || '-'));
            tr.appendChild(cell(log.activity));
            tr.appendChild(cell(fmtDate(log.check_in_time)));
            tr.appendChild(cell(fmtDate(log.check_out_time) || 'Sürüyor'));

            const durTd = document.createElement('td');
            if (log.duration_minutes != null) {
                const hrs = Math.floor(log.duration_minutes / 60);
                const mins = log.duration_minutes % 60;
                durTd.textContent = hrs > 0 ? `${hrs} saat ${mins} dk` : `${mins} dk`;
            } else {
                durTd.textContent = 'Devam Ediyor';
                durTd.className = 'ongoing';
            }
            tr.appendChild(durTd);

            tr.appendChild(locationCell(log));

            // Saha Durumu (Geofence Alert Badge)
            const boundsTd = document.createElement('td');
            if (log.is_out_of_bounds) {
                boundsTd.innerHTML = '<span style="background:#FF3B30; color:#fff; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:0.75rem; white-space:nowrap;">🚨 SAHA DIŞINDA!</span>';
            } else if (log.latitude != null) {
                boundsTd.innerHTML = '<span style="background:#34C759; color:#fff; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:0.75rem; white-space:nowrap;">🟩 Saha İçinde</span>';
            } else {
                boundsTd.textContent = '-';
            }
            tr.appendChild(boundsTd);

            const actionTd = document.createElement('td');

            if (!log.check_out_time) {
                const btnCheckout = document.createElement('button');
                btnCheckout.className = 'btn-manual-checkout';
                btnCheckout.textContent = 'Çıkış Yap';
                btnCheckout.title = 'İşçi için manuel çıkış kaydı oluştur';
                btnCheckout.addEventListener('click', () => openManualCheckoutModal(log));
                actionTd.appendChild(btnCheckout);
            }

            const btn = document.createElement('button');
            btn.className = 'btn-delete';
            btn.textContent = 'Sil';
            btn.addEventListener('click', () => deleteLog(log.id));
            actionTd.appendChild(btn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        });
    }

    /* ---------------- Sunucu İstekleri ---------------- */

    async function loadLogs() {
        try {
            const res = await fetch(apiBase + '/api/logs', { credentials: 'include' });

            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) throw new Error('http_' + res.status);

            logsCache = await res.json();
            renderRows(logsCache);
            el('record-count').textContent = logsCache.length + ' kayıt';
        } catch (err) {
            alert('Sunucuya bağlanılamadı. Sunucunun çalıştığından emin olun.');
        }
    }

    async function deleteLog(id) {
        if (!confirm('Bu puantaj kaydını silmek istediğinize emin misiniz?')) return;

        try {
            const res = await fetch(apiBase + '/api/logs/' + id, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });

            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }

            if (!res.ok) {
                alert('Silme işlemi başarısız.');
                return;
            }

            loadLogs();
        } catch (err) {
            alert('Bağlantı hatası.');
        }
    }

    function formatNowForInput() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    function openManualCheckoutModal(log) {
        selectedLogForCheckout = log;
        const infoEl = el('modal-checkout-worker-info');
        if (infoEl) {
            infoEl.textContent = `${(log.first_name || '')} ${(log.last_name || '')} (${maskTc(log.tc_no)}) - Saha: ${log.qr_data || '-'}`;
        }
        const datetimeInput = el('checkout-datetime');
        if (datetimeInput) {
            datetimeInput.value = formatNowForInput();
        }
        const modal = el('modal-checkout');
        if (modal) modal.hidden = false;
    }

    function closeManualCheckoutModal() {
        selectedLogForCheckout = null;
        const modal = el('modal-checkout');
        if (modal) modal.hidden = true;
    }

    async function submitManualCheckout() {
        if (!selectedLogForCheckout) return;
        const datetimeVal = el('checkout-datetime').value;
        if (!datetimeVal) {
            alert('Lütfen geçerli bir tarih ve saat seçiniz.');
            return;
        }

        try {
            const res = await fetch(apiBase + '/api/admin/checkout', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    id: selectedLogForCheckout.id,
                    check_out_time: datetimeVal
                })
            });

            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert('Hata: ' + (body.error || 'Çıkış işlemi yapılamadı.'));
                return;
            }

            closeManualCheckoutModal();
            loadLogs();
        } catch (err) {
            alert('Bağlantı hatası.');
        }
    }

    /* ---------------- Proje Yönetimi ---------------- */

    async function loadAdminProjects() {
        try {
            console.log('[Erkiz] Loading projects...');
            const res = await fetch(apiBase + '/api/admin/projects', { credentials: 'include' });
            console.log('[Erkiz] Projects response status:', res.status);
            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) {
                console.error('[Erkiz] Projects error:', res.status);
                alert('Projeler yüklenemedi: Sunucu hatası ' + res.status);
                return;
            }
            const projects = await res.json();
            console.log('[Erkiz] Projects loaded:', projects.length, 'adet');
            renderProjectsList(projects);
        } catch (e) {
            console.error('[Erkiz] Projects exception:', e);
            alert('Projeler yüklenirken hata: ' + e.message);
        }
    }

    function renderProjectsList(projects) {
        projectsCache = projects || [];
        if (typeof updateProjectDropdowns === 'function') updateProjectDropdowns();
        const list = el('projects-list');
        if (!list) return;
        list.innerHTML = '';
        if (!projects.length) {
            list.innerHTML = '<li style="color: var(--ios-gray); font-style: italic;">Henüz proje eklenmemiş.</li>';
            return;
        }

        projects.forEach(p => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 0.5px solid #eee;';
            
            const info = document.createElement('span');
            info.innerHTML = `<strong>${esc(p.project_code)}</strong> - ${esc(p.project_name)}`;
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete';
            delBtn.textContent = 'Sil';
            delBtn.style.padding = '4px 8px';
            delBtn.addEventListener('click', () => deleteProject(p.id));

            li.appendChild(info);
            li.appendChild(delBtn);
            list.appendChild(li);
        });
    }

    async function addProject() {
        const codeInput = el('new-project-code');
        const nameInput = el('new-project-name');
        if (!codeInput || !nameInput) return;

        const code = codeInput.value.trim();
        const name = nameInput.value.trim();

        if (!code || !name) {
            alert('Lütfen Proje Kodu ve Proje Adını giriniz.');
            return;
        }

        try {
            const res = await fetch(apiBase + '/api/admin/projects', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ project_code: code, project_name: name })
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
                alert('Hata: ' + (body.error || 'Proje eklenemedi.'));
                return;
            }

            codeInput.value = '';
            nameInput.value = '';
            loadAdminProjects();
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    async function deleteProject(id) {
        if (!confirm('Bu projeyi silmek istediğinize emin misiniz?')) return;
        try {
            const res = await fetch(apiBase + '/api/admin/projects/' + id, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });
            if (res.ok) {
                loadAdminProjects();
            } else {
                alert('Proje silinemedi.');
            }
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    /* ---------------- Cihaz Kilitleri (1 Telefon = 1 İşçi) ---------------- */

    let devicesCache = [];

    async function loadAdminDevices() {
        const list = el('devices-list');
        if (!list) return;
        try {
            const res = await fetch(apiBase + '/api/admin/devices', { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            devicesCache = (await res.json()).filter(d => d.device_id !== 'DEV-ADMIN-MANUAL');
            renderDevicesList(devicesCache);
        } catch (e) {
            list.textContent = 'Cihazlar yüklenemedi: ' + e.message;
        }
    }

    function renderDevicesList(devices) {
        const list = el('devices-list');
        if (!list) return;
        const q = el('search-devices') ? el('search-devices').value.trim().toLowerCase() : '';
        list.textContent = '';
        const filtered = devices.filter(d =>
            !q || `${d.bound_worker_name || ''} ${d.device_id}`.toLowerCase().includes(q));
        if (el('devices-count-badge')) {
            el('devices-count-badge').textContent = `${filtered.length} / ${devices.length} cihaz`;
        }
        if (!filtered.length) {
            const li = document.createElement('li');
            li.style.cssText = 'color: var(--ios-gray); font-style: italic;';
            li.textContent = 'Kayıtlı cihaz bulunamadı.';
            list.appendChild(li);
            return;
        }
        filtered.forEach(d => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding: 6px 0; border-bottom: 0.5px solid #eee;';

            const info = document.createElement('span');
            const name = document.createElement('strong');
            name.textContent = d.bound_worker_name || '(Henüz işçiye bağlı değil)';
            const meta = document.createElement('small');
            meta.style.cssText = 'display:block; color: var(--ios-gray);';
            const last = d.last_seen ? new Date(d.last_seen).toLocaleString('tr-TR') : '-';
            meta.textContent = `${d.device_id} · Son görülme: ${last}` + (d.blocked ? ' · ENGELLİ' : '');
            info.appendChild(name);
            info.appendChild(meta);

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';

            if (d.bound_worker_name) {
                const unbindBtn = document.createElement('button');
                unbindBtn.className = 'btn btn-primary';
                unbindBtn.style.cssText = 'padding:4px 10px; font-size:0.8rem; width:auto;';
                unbindBtn.textContent = 'Kilidi Kaldır';
                unbindBtn.addEventListener('click', () => deviceAction(d, 'unbind'));
                btns.appendChild(unbindBtn);
            }

            const blockBtn = document.createElement('button');
            blockBtn.className = d.blocked ? 'btn btn-primary' : 'btn-delete';
            blockBtn.style.cssText = 'padding:4px 10px; font-size:0.8rem; width:auto;';
            blockBtn.textContent = d.blocked ? 'Engeli Kaldır' : 'Engelle';
            blockBtn.addEventListener('click', () => deviceAction(d, d.blocked ? 'unblock' : 'block'));
            btns.appendChild(blockBtn);

            li.appendChild(info);
            li.appendChild(btns);
            list.appendChild(li);
        });
    }

    async function deviceAction(d, action) {
        const who = d.bound_worker_name || d.device_id;
        const texts = {
            unbind: `${who} adına kilitli telefonun kilidi kaldırılsın mı? (İşçi yeni telefonundan giriş yapabilir.)`,
            block: `${d.device_id} cihazı engellensin mi? Bu cihazdan yeni oturum açılamaz.`,
            unblock: `${d.device_id} cihazının engeli kaldırılsın mı?`
        };
        if (!confirm(texts[action])) return;
        const id = encodeURIComponent(d.device_id);
        const url = action === 'unbind'
            ? `${apiBase}/api/admin/devices/${id}/unbind`
            : `${apiBase}/api/admin/devices/${id}/block`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
                body: JSON.stringify({ blocked: action === 'block' })
            });
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                alert(b.error || 'İşlem başarısız.');
            }
            loadAdminDevices();
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    /* ---------------- İşçi & Doğum Günü Yönetimi ---------------- */

    async function loadAdminWorkers() {
        try {
            console.log('[Erkiz] Loading workers...');
            const res = await fetch(apiBase + '/api/admin/workers', { credentials: 'include' });
            console.log('[Erkiz] Workers response status:', res.status);
            if (res.status === 401 || res.status === 403) {
                console.warn('[Erkiz] Workers 401/403, redirecting to login');
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) {
                const errText = await res.text().catch(() => 'unknown');
                console.error('[Erkiz] Workers error:', res.status, errText);
                alert('İşçiler yüklenemedi: Sunucu hatası ' + res.status);
                return;
            }
            workersCache = await res.json();
            console.log('[Erkiz] Workers loaded:', workersCache.length, 'adet');
            filterAndRenderWorkers();
        } catch (e) {
            console.error('[Erkiz] Workers exception:', e);
            alert('İşçiler yüklenirken hata: ' + e.message);
        }
    }

    function filterAndRenderWorkers() {
        const query = el('search-workers') ? el('search-workers').value.trim().toLowerCase() : '';
        const filterMode = el('filter-workers') ? el('filter-workers').value : 'all';

        const filtered = workersCache.filter(w => {
            if (filterMode === 'bday' && !w.is_birthday_today && !w.is_birthday_this_week) {
                return false;
            }
            if (!query) return true;
            const full = `${w.first_name} ${w.last_name} ${w.tc_no}`.toLowerCase();
            return full.includes(query);
        });
        renderWorkersList(filtered, filterMode);
    }

    function renderWorkersList(workers, filterMode) {
        const list = el('workers-list');
        const badge = el('workers-count-badge');

        const filterSelect = el('filter-workers');
        if (filterSelect && filterSelect.options && filterSelect.options[0]) {
            filterSelect.options[0].textContent = `👥 Tüm Kayıtlı İşçiler (${workersCache.length} İşçi)`;
        }

        const bdayCount = workersCache.filter(w => w.is_birthday_today || w.is_birthday_this_week).length;
        if (badge) {
            if (filterMode === 'bday') {
                badge.textContent = `${bdayCount} işçinin bu hafta doğum günü var (Toplam: ${workersCache.length} kayıt)`;
            } else {
                badge.textContent = `${workers.length} / ${workersCache.length} kayıtlı işçi`;
            }
        }

        if (!list) return;
        list.innerHTML = '';
        if (!workers.length) {
            const msg = filterMode === 'bday' ? 'Bu hafta doğum günü olan işçi bulunmuyor.' : 'Kayıtlı işçi bulunamadı.';
            list.innerHTML = `<li style="color: var(--ios-gray); font-style: italic;">${msg}</li>`;
            return;
        }

        workers.forEach(w => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 0.5px solid #eee;';
            
            let bdayTag = '';
            if (w.is_birthday_today) {
                bdayTag = ' <span style="background:#FF9500; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🎂 BUGÜN DOĞUM GÜNÜ!</span>';
            } else if (w.is_birthday_this_week) {
                if (w.is_weekend_bday) {
                    bdayTag = ` <span style="background:#34C759; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🎈 BU HAFTA (${esc(w.bday_day_name)} -> Cuma Kutlanacak)</span>`;
                } else {
                    bdayTag = ` <span style="background:#007AFF; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🎈 BU HAFTA (${esc(w.bday_day_name)})</span>`;
                }
            }

            const info = document.createElement('span');
            info.innerHTML = `<strong>${esc(w.first_name)} ${esc(w.last_name)}</strong> (${esc(maskTc(w.tc_no))}) - Doğum Tarihi: <strong>${esc(w.birth_date_str)}</strong>${bdayTag}`;
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete';
            delBtn.textContent = 'Sil';
            delBtn.style.padding = '4px 8px';
            delBtn.addEventListener('click', () => deleteWorker(w.id));

            li.appendChild(info);
            li.appendChild(delBtn);
            list.appendChild(li);
        });
    }

    async function addWorker() {
        const tcInput = el('worker-tc');
        const firstInput = el('worker-first');
        const lastInput = el('worker-last');
        const bdateInput = el('worker-bdate');

        if (!tcInput || !firstInput || !lastInput || !bdateInput) return;

        const tc = tcInput.value.trim();
        const first = firstInput.value.trim();
        const last = lastInput.value.trim();
        const bdate = bdateInput.value;

        if (!tc || !first || !last || !bdate) {
            alert('Lütfen T.C. No, Ad, Soyad ve Doğum Tarihi alanlarını doldurunuz.');
            return;
        }

        try {
            const res = await fetch(apiBase + '/api/admin/workers', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ tc_no: tc, first_name: first, last_name: last, birth_date: bdate })
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert('Hata: ' + (body.error || 'İşçi eklenemedi.'));
                return;
            }

            tcInput.value = '';
            firstInput.value = '';
            lastInput.value = '';
            bdateInput.value = '';
            loadAdminWorkers();
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    async function deleteWorker(id) {
        if (!confirm('Bu işçi kaydını silmek istediğinize emin misiniz?')) return;
        try {
            const res = await fetch(apiBase + '/api/admin/workers/' + id, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });
            if (res.ok) {
                loadAdminWorkers();
            } else {
                alert('Silinemedi.');
            }
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    /* ---------------- Proje Yönetimi ---------------- */

    async function loadAdminProjects() {
        try {
            console.log('[Erkiz] Loading projects...');
            const res = await fetch(apiBase + '/api/admin/projects', { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }
            if (!res.ok) {
                console.error('[Erkiz] Projects error:', res.status);
                return;
            }
            projectsCache = await res.json();
            console.log('[Erkiz] Projects loaded:', projectsCache.length, 'adet');
            renderProjectsList(projectsCache);
        } catch (e) {
            console.error('[Erkiz] Projects exception:', e);
        }
    }

    function renderProjectsList(projects) {
        projectsCache = projects || [];
        if (typeof updateProjectDropdowns === 'function') updateProjectDropdowns();
        const list = el('projects-list');
        if (!list) return;
        list.innerHTML = '';
        if (!projects || !projects.length) {
            list.innerHTML = '<li style="color: var(--ios-gray); font-style: italic;">Henüz kayıtlı proje yok.</li>';
            return;
        }

        projects.forEach(p => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 0.5px solid #eee;';

            const info = document.createElement('span');
            info.innerHTML = `🏗️ <strong>${esc(p.project_code)}</strong> - ${esc(p.project_name)}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete';
            delBtn.textContent = 'Sil';
            delBtn.style.padding = '4px 8px';
            delBtn.addEventListener('click', () => deleteProject(p.id));

            li.appendChild(info);
            li.appendChild(delBtn);
            list.appendChild(li);
        });
    }

    async function addProject() {
        const codeInput = el('new-project-code');
        const nameInput = el('new-project-name');
        if (!codeInput || !nameInput) return;

        const code = codeInput.value.trim();
        const name = nameInput.value.trim();

        if (!code || !name) {
            alert('Lütfen Proje Kodu ve Proje Adı alanlarını doldurunuz.');
            return;
        }

        try {
            const res = await fetch(apiBase + '/api/admin/projects', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ project_code: code, project_name: name })
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
                alert('Hata: ' + (body.error || 'Proje eklenemedi.'));
                return;
            }

            codeInput.value = '';
            nameInput.value = '';
            loadAdminProjects();
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    async function deleteProject(id) {
        if (!confirm('Bu projeyi silmek istediğinize emin misiniz?')) return;
        try {
            const res = await fetch(apiBase + '/api/admin/projects/' + id, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });
            if (res.ok) {
                loadAdminProjects();
            } else {
                alert('Proje silinemedi.');
            }
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    function handleWorkerFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const nameSpan = el('selected-file-name');
        const btnImport = el('btn-import-csv');
        if (nameSpan) nameSpan.textContent = file.name;

        const reader = new FileReader();
        reader.onload = function(evt) {
            selectedCsvText = evt.target.result;
            if (btnImport) btnImport.disabled = false;
        };
        reader.readAsText(file, 'UTF-8');
    }

    async function importWorkerCSV() {
        if (!selectedCsvText) {
            alert('Lütfen öncelikle bir CSV/Excel dosyası seçiniz.');
            return;
        }

        try {
            const res = await fetch(apiBase + '/api/admin/workers/import-csv', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ csv_text: selectedCsvText })
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
                alert('Hata: ' + (body.error || 'Aktarım başarısız.'));
                return;
            }

            alert(`BAŞARILI!\nToplam ${body.success_count} adet işçi/doğum günü kaydı sisteme aktarıldı.${body.fail_count > 0 ? `\n(${body.fail_count} hatalı/atlanan satır)` : ''}`);
            selectedCsvText = '';
            if (el('file-import-workers')) el('file-import-workers').value = '';
            if (el('selected-file-name')) el('selected-file-name').textContent = 'Henüz dosya seçilmedi';
            if (el('btn-import-csv')) el('btn-import-csv').disabled = true;
            loadAdminWorkers();
        } catch (e) {
            alert('Bağlantı hatası.');
        }
    }

    /* ---------------- Dışa / İçe Aktarım ---------------- */

    function downloadCSV() {
        if (!logsCache.length) {
            alert('İndirilecek veri yok.');
            return;
        }

        const lines = [
            ['TC No', 'Ad', 'Soyad', 'Saha (QR)', 'Proje', 'Aktivite', 'Giris Zamanı', 'Cikis Zamanı', 'Süre (Dk)', 'Enlem', 'Boylam', 'Konum Izni']
        ];

        logsCache.forEach(log => {
            lines.push([
                log.tc_no,
                log.first_name,
                log.last_name,
                log.qr_data,
                log.project || '',
                log.activity,
                fmtDate(log.check_in_time),
                fmtDate(log.check_out_time) || 'Sürüyor',
                log.duration_minutes != null ? log.duration_minutes : 0,
                log.latitude != null ? log.latitude : '',
                log.longitude != null ? log.longitude : '',
                log.location_consent ? 'Evet' : 'Hayir'
            ].map(csvSafe).join(';'));
        });

        const blob = new Blob(['\uFEFF' + lines.join('\r\n')],
                              { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Erkiz_Isci_Rapor_' +
                        new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function csvSafe(val) {
        const s = String(val == null ? '' : val).trim();
        if (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@')) {
            return "'" + s;
        }
        return s;
    }

    /* ---------------- Excel (.xlsx) Puantaj ve Maaş İndirme ---------------- */

    function downloadAttendanceExcel() {
        const month = el('excel-month') ? el('excel-month').value : '';
        const project = el('excel-project') ? el('excel-project').value : 'all';

        let url = `${apiBase}/api/admin/reports/excel?month=${encodeURIComponent(month)}`;
        if (project && project !== 'all') {
            url += `&project=${encodeURIComponent(project)}`;
        }

        window.location.href = url;
    }

    function setupExcelReportControls() {
        const monthInput = el('excel-month');
        if (monthInput && !monthInput.value) {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            monthInput.value = `${yyyy}-${mm}`;
        }

        if (el('btn-download-excel')) {
            el('btn-download-excel').addEventListener('click', downloadAttendanceExcel);
        }

        if (el('btn-quick-this-month')) {
            el('btn-quick-this-month').addEventListener('click', () => {
                const now = new Date();
                const yyyy = now.getFullYear();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                if (el('excel-month')) el('excel-month').value = `${yyyy}-${mm}`;
            });
        }

        if (el('btn-quick-last-month')) {
            el('btn-quick-last-month').addEventListener('click', () => {
                const d = new Date();
                d.setMonth(d.getMonth() - 1);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                if (el('excel-month')) el('excel-month').value = `${yyyy}-${mm}`;
            });
        }

        if (el('btn-quick-all')) {
            el('btn-quick-all').addEventListener('click', () => {
                if (el('excel-month')) el('excel-month').value = '';
            });
        }
    }

    function updateProjectDropdowns() {
        const filterSel = el('excel-project');
        if (filterSel) {
            const cur = filterSel.value;
            filterSel.innerHTML = '<option value="all">Tüm Projeler</option>';
            if (projectsCache && projectsCache.length) {
                projectsCache.forEach(p => {
                    const opt = document.createElement('option');
                    const val = p.project_code || p.project_name;
                    opt.value = val;
                    opt.textContent = `${p.project_code} - ${p.project_name}`;
                    filterSel.appendChild(opt);
                });
            }
            if (cur) filterSel.value = cur;
        }

        const manualSel = el('manual-att-project');
        if (manualSel) {
            const cur = manualSel.value;
            manualSel.innerHTML = '';
            if (projectsCache && projectsCache.length) {
                projectsCache.forEach(p => {
                    const opt = document.createElement('option');
                    const val = p.project_code || p.project_name;
                    opt.value = val;
                    opt.textContent = `${p.project_code} - ${p.project_name}`;
                    manualSel.appendChild(opt);
                });
            } else {
                const opt = document.createElement('option');
                opt.value = 'ŞÖLEN';
                opt.textContent = 'ŞÖLEN';
                manualSel.appendChild(opt);
            }
            if (cur) manualSel.value = cur;
        }
    }

    function updateSiteDropdowns() {
        const manualSiteSel = el('manual-att-site');
        if (manualSiteSel) {
            const cur = manualSiteSel.value;
            manualSiteSel.innerHTML = '';
            if (qrCodesCache && qrCodesCache.length) {
                qrCodesCache.forEach(q => {
                    const opt = document.createElement('option');
                    opt.value = q.site_name;
                    opt.textContent = q.site_name;
                    manualSiteSel.appendChild(opt);
                });
            } else {
                const opt = document.createElement('option');
                opt.value = 'Merkez Saha';
                opt.textContent = 'Merkez Saha';
                manualSiteSel.appendChild(opt);
            }
            if (cur) manualSiteSel.value = cur;
        }
    }

    /* ---------------- Manuel Günlük Puantaj / Vardiya Ekleme ---------------- */

    function openManualAttendanceModal() {
        const modal = el('modal-manual-attendance');
        if (!modal) return;

        const workerSelect = el('manual-att-worker');
        if (workerSelect) {
            workerSelect.innerHTML = '<option value="">-- İşçi Seçin (TC - Ad Soyad) --</option>';
            if (workersCache && workersCache.length) {
                workersCache.forEach(w => {
                    const opt = document.createElement('option');
                    opt.value = w.tc_no;
                    opt.textContent = `${w.tc_no} - ${w.first_name} ${w.last_name}`;
                    workerSelect.appendChild(opt);
                });
            }
        }

        const dateInput = el('manual-att-date');
        if (dateInput && !dateInput.value) {
            const today = new Date().toISOString().slice(0, 10);
            dateInput.value = today;
        }

        updateProjectDropdowns();
        updateSiteDropdowns();

        const alertBox = el('manual-att-alert');
        if (alertBox) {
            alertBox.style.display = 'none';
            alertBox.textContent = '';
        }

        modal.hidden = false;
    }

    function closeManualAttendanceModal() {
        const modal = el('modal-manual-attendance');
        if (modal) modal.hidden = true;
    }

    async function submitManualAttendance() {
        const tc = el('manual-att-worker') ? el('manual-att-worker').value : '';
        const date = el('manual-att-date') ? el('manual-att-date').value : '';
        const checkIn = el('manual-att-in-time') ? el('manual-att-in-time').value : '';
        const checkOut = el('manual-att-out-time') ? el('manual-att-out-time').value : '';
        const project = el('manual-att-project') ? el('manual-att-project').value : '';
        const site = el('manual-att-site') ? el('manual-att-site').value : '';
        const activity = el('manual-att-activity') ? el('manual-att-activity').value : '';
        const note = el('manual-att-note') ? el('manual-att-note').value : '';

        if (!tc) {
            showManualAttAlert('Lütfen bir işçi seçiniz.', 'error');
            return;
        }
        if (!date) {
            showManualAttAlert('Lütfen çalışma tarihini seçiniz.', 'error');
            return;
        }
        if (!checkIn || !checkOut) {
            showManualAttAlert('Giriş ve çıkış saatlerini giriniz.', 'error');
            return;
        }

        const btn = el('btn-save-manual-attendance');
        if (btn) btn.disabled = true;

        try {
            const res = await fetch(`${apiBase}/api/admin/attendance/manual`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({
                    tc_no: tc,
                    date: date,
                    check_in_time: checkIn,
                    check_out_time: checkOut,
                    project: project,
                    qr_data: site,
                    activity: activity,
                    note: note
                })
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showManualAttAlert(data.error || 'Kayıt eklenemedi.', 'error');
                if (btn) btn.disabled = false;
                return;
            }

            showManualAttAlert(data.message || 'Puantaj kaydı başarıyla eklendi.', 'success');
            setTimeout(() => {
                closeManualAttendanceModal();
                if (btn) btn.disabled = false;
                loadLogs();
            }, 1200);

        } catch (e) {
            showManualAttAlert('Bağlantı hatası: ' + e.message, 'error');
            if (btn) btn.disabled = false;
        }
    }

    function showManualAttAlert(msg, type) {
        const alertBox = el('manual-att-alert');
        if (!alertBox) return;
        alertBox.style.display = 'block';
        alertBox.textContent = msg;
        if (type === 'success') {
            alertBox.style.backgroundColor = '#dcfce7';
            alertBox.style.color = '#15803d';
            alertBox.style.border = '1px solid #86efac';
        } else {
            alertBox.style.backgroundColor = '#fee2e2';
            alertBox.style.color = '#b91c1c';
            alertBox.style.border = '1px solid #fca5a5';
        }
    }

    function downloadSAPCSV() {
        window.location.href = apiBase + '/api/sap/export?format=csv';
    }

    async function exportToSAPAL11() {
        try {
            const res = await fetch(apiBase + '/api/sap/al11-export', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ unsynced_only: true })
            });

            if (res.status === 401 || res.status === 403) {
                window.location.replace('login.html');
                return;
            }

            const data = await res.json();
            if (!res.ok || !data.ok) {
                alert('SAP AL11 Aktarım Hatası: ' + (data.error || 'Bilinmeyen hata'));
                return;
            }

            if (data.record_count === 0) {
                alert('Aktarılacak yeni (senkronize edilmemiş) puantaj kaydı bulunamadı.');
                return;
            }

            alert(`BAŞARILI!\n${data.record_count} adet kayıt SAP AL11 dizinine yazıldı.\nDosya: ${data.filename}\nYol: ${data.filepath}`);
            loadLogs();

        } catch (err) {
            alert('Sunucuya bağlanılamadı.');
        }
    }

    async function logout() {
        try {
            await fetch(apiBase + '/api/admin/logout', {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() }
            });
        } finally {
            window.location.replace('login.html');
        }
    }

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : '';
    }

    /* ---------------- Sayfa Yüklendiğinde ---------------- */

    document.addEventListener('DOMContentLoaded', function () {
        if (el('btn-generate-qr')) el('btn-generate-qr').addEventListener('click', generateQR);
        if (el('btn-close-qr')) el('btn-close-qr').addEventListener('click', closeQR);
        if (el('btn-print')) el('btn-print').addEventListener('click', () => window.print());
        if (el('btn-refresh')) el('btn-refresh').addEventListener('click', loadLogs);
        if (el('btn-csv')) el('btn-csv').addEventListener('click', downloadCSV);
        if (el('btn-sap-csv')) el('btn-sap-csv').addEventListener('click', downloadSAPCSV);
        if (el('btn-sap-al11')) el('btn-sap-al11').addEventListener('click', exportToSAPAL11);
        if (el('search-workers')) el('search-workers').addEventListener('input', filterAndRenderWorkers);
        if (el('filter-workers')) el('filter-workers').addEventListener('change', filterAndRenderWorkers);
        if (el('btn-add-worker')) el('btn-add-worker').addEventListener('click', addWorker);
        if (el('file-import-workers')) el('file-import-workers').addEventListener('change', handleWorkerFileSelect);
        if (el('btn-import-csv')) el('btn-import-csv').addEventListener('click', importWorkerCSV);
        if (el('btn-add-project')) el('btn-add-project').addEventListener('click', addProject);
        if (el('btn-confirm-checkout')) el('btn-confirm-checkout').addEventListener('click', submitManualCheckout);
        if (el('btn-cancel-checkout')) el('btn-cancel-checkout').addEventListener('click', closeManualCheckoutModal);
        if (el('btn-cancel-geofence')) el('btn-cancel-geofence').addEventListener('click', closeGeofenceModal);
        if (el('btn-save-geofence')) el('btn-save-geofence').addEventListener('click', saveGeofence);
        if (el('gf-radius')) el('gf-radius').addEventListener('input', () => {
            const lat = parseFloat(el('gf-lat').value);
            const lng = parseFloat(el('gf-lng').value);
            if (!isNaN(lat) && !isNaN(lng)) updateGeofenceMapPin(lat, lng);
        });
        if (el('btn-logout')) el('btn-logout').addEventListener('click', logout);
        if (el('btn-open-manual-attendance')) el('btn-open-manual-attendance').addEventListener('click', openManualAttendanceModal);
        if (el('btn-cancel-manual-attendance')) el('btn-cancel-manual-attendance').addEventListener('click', closeManualAttendanceModal);
        if (el('btn-save-manual-attendance')) el('btn-save-manual-attendance').addEventListener('click', submitManualAttendance);

        if (el('btn-refresh-devices')) el('btn-refresh-devices').addEventListener('click', loadAdminDevices);
        if (el('search-devices')) el('search-devices').addEventListener('input', () => renderDevicesList(devicesCache));

        setupExcelReportControls();
        loadAdminDevices();
        loadAdminWorkers();
        loadAdminProjects();
        loadAdminQRCodes();
        loadLogs();
    });
})();
