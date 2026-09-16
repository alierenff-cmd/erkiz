(function () {
    'use strict';
    const el = id => document.getElementById(id);

    function showError(msg) {
        const div = el('error-msg');
        div.textContent = msg;          // textContent -> sunucu mesaji XSS tasiyamaz
        div.hidden = !msg;
    }

    async function login() {
        const btn = el('btn-login');
        const user = el('username').value.trim();
        const pass = el('password').value;
        const pinField = el('pin-field');
        const pin = el('pin') ? el('pin').value.trim() : '';

        if (!user || !pass) {
            showError('Kullanıcı adı ve şifre giriniz.');
            return;
        }
        if (pinField && !pinField.hidden && !pin) {
            showError('Güvenlik PIN kodunu giriniz.');
            return;
        }

        btn.disabled = true;
        showError('');

        try {
            const meta = document.querySelector('meta[name="csrf-token"]');
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': meta ? meta.content : ''
                },
                body: JSON.stringify({ username: user, password: pass, pin: pin })
            });

            if (res.ok) {
                window.location.replace('admin.html');
                return;
            }

            // Kullanici adi mi sifre mi yanlis, bilgi sizdirmiyoruz.
            const body = await res.json().catch(() => ({}));
            showError(body.error || 'Giriş bilgileri hatalı.');
        } catch (err) {
            showError('Sunucuya bağlanılamadı.');
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        el('btn-login').addEventListener('click', login);
        el('password').addEventListener('keydown', e => {
            if (e.key === 'Enter') login();
        });
        if (el('pin')) el('pin').addEventListener('keydown', e => {
            if (e.key === 'Enter') login();
        });

        // Sunucuda PIN tanimliysa PIN alanini goster.
        fetch('/api/admin/login-config', { credentials: 'include' })
            .then(r => r.ok ? r.json() : {})
            .then(cfg => { if (cfg && cfg.pin_required) el('pin-field').hidden = false; })
            .catch(() => {});
    });
})();
