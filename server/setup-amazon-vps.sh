#!/usr/bin/env bash
# ==============================================================================
# Erkiz İşçi Takip Sistemi - Amazon VPS (AWS EC2 / Lightsail) Otomatik Kurulum
# İşletim Sistemi: Ubuntu 20.04 / 22.04 / 24.04 LTS veya Debian 11/12
# ==============================================================================

set -e

# Renkler
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================================${NC}"
echo -e "${GREEN}   Erkiz İşçi Takip Sistemi - Amazon VPS Otomatik Kurulum Betiği   ${NC}"
echo -e "${BLUE}====================================================================${NC}"
echo ""

# Root kontrolü
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[HATA] Lütfen bu betiği root veya sudo yetkisi ile çalıştırın:${NC}"
  echo "sudo bash setup-amazon-vps.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Zaman Dilimi Ayarı (Türkiye Saati)
echo -e "${YELLOW}[1/8] Sistem saat dilimi Europe/Istanbul olarak ayarlanıyor...${NC}"
timedatectl set-timezone Europe/Istanbul || true

# 2. Sistem Güncellemeleri & Temel Paketler
echo -e "${YELLOW}[2/8] Sistem paketleri güncelleniyor ve temel araçlar kuruluyor...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget git unzip software-properties-common ufw nginx certbot python3-certbot-nginx

# 3. Node.js 20 LTS Kurulumu
echo -e "${YELLOW}[3/8] Node.js 20 LTS kuruluyor...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo -e "${GREEN}[OK] Node.js sürümü: $(node -v)${NC}"
echo -e "${GREEN}[OK] NPM sürümü: $(npm -v)${NC}"

# PM2 Kurulumu
echo -e "${YELLOW}[PM2] Süreç yöneticisi (PM2) kuruluyor...${NC}"
npm install -g pm2

# 4. MySQL Server Kurulumu & Yapılandırması
echo -e "${YELLOW}[4/8] MySQL Server kuruluyor ve yapılandırılıyor...${NC}"
apt-get install -y mysql-server
systemctl enable mysql
systemctl start mysql

# Veritabanı ve Şifre Üretimi
DB_NAME="erkiz_takip"
DB_USER="erkiz_app"
DB_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

echo -e "MySQL üzerinde '${DB_NAME}' veritabanı ve '${DB_USER}' kullanıcısı hazırlanıyor..."
mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# Şema İçe Aktarımı
if [ -f "$SCRIPT_DIR/schema.sql" ]; then
    echo "Veritabanı şeması (schema.sql) yükleniyor..."
    mysql -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" < "$SCRIPT_DIR/schema.sql"
    echo -e "${GREEN}[OK] Veritabanı tabloları oluşturuldu.${NC}"
fi

# 5. Bağımlılıkların Kurulması
echo -e "${YELLOW}[5/8] Proje npm bağımlılıkları yükleniyor...${NC}"
npm install --production

# 6. Ortam Değişkenleri (.env) Dosyası Hazırlığı
echo -e "${YELLOW}[6/8] .env güvenlik dosyası yapılandırılıyor...${NC}"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    JWT_SEC=$(openssl rand -hex 32)
    SES_SEC=$(openssl rand -hex 32)
    TC_KEY=$(openssl rand -hex 32)
    
    # Varsayılan Admin Şifresi ve Hash
    DEFAULT_ADMIN_PASS="ErkizAdmin2026!"
    ADMIN_PIN="123456"
    ADMIN_HASH=$(node -e "const p = require('./lib/password'); p.hash('${DEFAULT_ADMIN_PASS}').then(h => console.log(h));")

    cat > "$SCRIPT_DIR/.env" <<EOF
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}

JWT_SECRET=${JWT_SEC}
SESSION_SECRET=${SES_SEC}
TC_ENCRYPTION_KEY=${TC_KEY}

ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=${ADMIN_HASH}
ADMIN_SECURITY_PIN=${ADMIN_PIN}

SAP_AL11_DIR=/var/data/sap_al11_export
EOF
    chmod 600 "$SCRIPT_DIR/.env"
    echo -e "${GREEN}[OK] Yeni .env dosyası oluşturuldu.${NC}"
else
    echo -e "${BLUE}[BİLGİ] Mevcut .env dosyası korundu.${NC}"
fi

# SAP Dizinini Oluştur
mkdir -p /var/data/sap_al11_export
mkdir -p "$SCRIPT_DIR/logs"

# 7. Nginx ve Güvenlik Duvarı Yapılandırması
echo -e "${YELLOW}[7/8] Nginx ve Güvenlik Duvarı (UFW) yapılandırılıyor...${NC}"

# Nginx varsayılan siteyi devre dışı bırakıp Erkiz proxy yapılandırmasını ekle
cat > /etc/nginx/sites-available/erkiz-takip << 'EOF'
upstream erkiz_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://erkiz_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/erkiz-takip /etc/nginx/sites-enabled/erkiz-takip
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Güvenlik Duvarı: Sadece SSH, HTTP ve HTTPS'e izin ver
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 8. PM2 İle 7/24 Başlatma
echo -e "${YELLOW}[8/8] Uygulama PM2 ile başlatılıyor ve otomatik açılışa kaydediliyor...${NC}"
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root || true

echo ""
echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}   Tebrikler! Erkiz İşçi Takip Sistemi Amazon VPS'te Yayında!       ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo ""
echo -e "Sunucu Yerel Portu : 127.0.0.1:3000"
echo -e "Nginx Web Portu    : 80 (HTTP) -> Dış Dünyaya Açık"
echo -e "Admin Kullanıcı Adı: admin"
echo -e "Admin Varsayılan Şifre: ErkizAdmin2026!  (Lütfen .env'den değiştiriniz)"
echo -e "Admin Güvenlik PIN : 123456"
echo ""
echo -e "${BLUE}Alan Adı (Domain) ve Ücretsiz SSL (HTTPS) Kurmak İçin:${NC}"
echo -e "1. Domaininizi sunucunun AWS Public IP adresine yönlendirin (A kaydı)."
echo -e "2. Şu komutu çalıştırın: ${YELLOW}sudo certbot --nginx -d takip.erkizmuhendislik.com${NC}"
echo ""
echo -e "${BLUE}Servis Kontrolleri:${NC}"
echo -e "- Canlı Durum : ${YELLOW}pm2 status${NC}"
echo -e "- Canlı Loglar: ${YELLOW}pm2 logs erkiz-takip${NC}"
echo -e "- Yeniden Başlatma: ${YELLOW}pm2 restart erkiz-takip${NC}"
echo ""
