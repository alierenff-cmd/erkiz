-- Erkiz Isci Takip - veritabani semasi (server.js ile birebir uyumlu)
-- KVKK: TC No asla duz metin saklanmaz. Arama icin HMAC hash, gerektiginde
-- geri okuma icin AES-256-GCM sifreli kolon tutulur.

CREATE DATABASE IF NOT EXISTS erkiz_takip
  CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci;
USE erkiz_takip;

CREATE TABLE IF NOT EXISTS devices (
    device_id          VARCHAR(32)  NOT NULL PRIMARY KEY,
    first_seen         DATETIME     NOT NULL,
    last_seen          DATETIME     NOT NULL,
    consent_version    SMALLINT     NOT NULL DEFAULT 1,
    blocked            BOOLEAN      NOT NULL DEFAULT FALSE,
    bound_tc_hash      CHAR(64)     NULL,
    bound_worker_name  VARCHAR(100) NULL,
    note               VARCHAR(255) NULL,
    INDEX idx_bound_tc (bound_tc_hash)
) ENGINE=InnoDB;

-- IK tarafindan kaydedilen aktif isciler (kayitsiz TC giris yapamaz)
CREATE TABLE IF NOT EXISTS workers (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    tc_hash      CHAR(64)       NOT NULL UNIQUE,
    tc_encrypted VARBINARY(255) NOT NULL,
    first_name   VARCHAR(50)    NOT NULL,
    last_name    VARCHAR(50)    NOT NULL,
    birth_date   DATE           NOT NULL,
    created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    project_code VARCHAR(50)  NOT NULL UNIQUE,
    project_name VARCHAR(150) NOT NULL,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Saha QR kodlari ve geofence (konum siniri)
CREATE TABLE IF NOT EXISTS qr_codes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    site_name   VARCHAR(150)  NOT NULL UNIQUE,
    center_lat  DECIMAL(10,8) NULL,
    center_lng  DECIMAL(11,8) NULL,
    radius_m    INT           NULL DEFAULT 500,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_logs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,

    -- Kimlik (sifreli / hashli)
    tc_hash             CHAR(64)       NOT NULL,   -- HMAC-SHA256, arama icin
    tc_encrypted        VARBINARY(255) NOT NULL,   -- AES-256-GCM, geri okuma icin
    first_name          VARCHAR(50)    NOT NULL,
    last_name           VARCHAR(50)    NOT NULL,

    -- Islem
    qr_data             VARCHAR(200)   NOT NULL,
    device_id           VARCHAR(32)    NOT NULL,
    activity            VARCHAR(100)   NULL,
    project             VARCHAR(150)   NULL,
    check_in_time       DATETIME       NOT NULL,
    check_out_time      DATETIME       NULL,
    duration_minutes    INT            NULL,
    is_out_of_bounds    BOOLEAN        NOT NULL DEFAULT FALSE,
    auto_closed         BOOLEAN        NOT NULL DEFAULT FALSE,
    auto_close_reason   VARCHAR(100)   NULL,

    -- Konum (riza varsa dolar, 90 gun sonra NULL'lanir)
    in_latitude         DECIMAL(10,8)  NULL,
    in_longitude        DECIMAL(11,8)  NULL,
    in_accuracy_m       FLOAT          NULL,
    out_latitude        DECIMAL(10,8)  NULL,
    out_longitude       DECIMAL(11,8)  NULL,
    out_accuracy_m      FLOAT          NULL,

    -- Riza kaniti (KVKK ispat yukumlulugu)
    location_consent    BOOLEAN        NOT NULL DEFAULT FALSE,
    consent_version     SMALLINT       NOT NULL DEFAULT 1,
    consent_granted_at  DATETIME       NULL,

    -- SAP Entegrasyonu durumu
    sap_synced          TINYINT(1)     NOT NULL DEFAULT 0,
    sap_synced_at       DATETIME       NULL,

    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_tc_open (tc_hash, check_out_time),
    INDEX idx_device_open (device_id, check_out_time),
    INDEX idx_checkin (check_in_time),
    INDEX idx_site (qr_data),
    INDEX idx_sap_synced (sap_synced, check_out_time),
    CONSTRAINT fk_device FOREIGN KEY (device_id)
        REFERENCES devices(device_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Mesai sirasinda 15 dakikalik konum sinyalleri (riza varsa, 18:00'e kadar; 90 gun sonra silinir)
CREATE TABLE IF NOT EXISTS worker_location_history (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    tc_hash     CHAR(64)      NOT NULL,
    device_id   VARCHAR(32)   NOT NULL,
    latitude    DECIMAL(10,8) NULL,
    longitude   DECIMAL(11,8) NULL,
    accuracy_m  FLOAT         NULL,
    recorded_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tc_time (tc_hash, recorded_at)
) ENGINE=InnoDB;

-- KVKK hesap verebilirlik: kisisel veriye kim, ne zaman erismis
CREATE TABLE IF NOT EXISTS admin_access_log (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    admin_user    VARCHAR(50)  NOT NULL,
    action        VARCHAR(100) NOT NULL,
    record_count  INT          NOT NULL DEFAULT 0,
    ip            VARCHAR(45)  NULL,
    created_at    DATETIME     NOT NULL,
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Yonetici manuel giris kayitlari icin sabit cihaz
INSERT IGNORE INTO devices (device_id, first_seen, last_seen, consent_version, blocked, note)
VALUES ('DEV-ADMIN-MANUAL', NOW(), NOW(), 1, FALSE, 'Yönetici Manuel Giriş Cihazı');

-- Uygulama kullanicisi: sadece gerekli yetkiler (root KULLANMAYIN)
-- CREATE USER 'erkiz_app'@'localhost' IDENTIFIED BY 'GUCLU_BIR_SIFRE';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON erkiz_takip.* TO 'erkiz_app'@'localhost';
-- FLUSH PRIVILEGES;
