#!/bin/bash
# =================================================================
# Erkiz Isci Takip — Turhost Linux VPS Automated Deployment Script
# =================================================================

set -e

echo "🚀 Erkiz Isci Takip Sunucu Kurulumu Başlatılıyor..."

# Update package list
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Node.js 20 & MySQL Server & Nginx & PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs mysql-server nginx ufw

sudo npm install -g pm2

# Enable Firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable

echo "✅ Bağımlılıklar başarıyla kuruldu!"
echo "📍 Proje dizini: /var/www/erkiz-isci-takip"
