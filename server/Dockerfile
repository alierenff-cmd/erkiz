# Erkiz İşçi Takip Sistemi - Dockerfile
FROM node:20-alpine

# Zaman dilimi ayarı
RUN apk add --no-cache tzdata
ENV TZ=Europe/Istanbul

WORKDIR /usr/src/app

# Bağımlılık dosyalarını kopyala
COPY package*.json ./

# Sadece üretim bağımlılıklarını kur
RUN npm ci --only=production

# Proje dosyalarını kopyala
COPY . .

# Log ve SAP çıktı dizinleri
RUN mkdir -p logs /var/data/sap_al11_export

EXPOSE 3000

CMD ["node", "server.js"]
