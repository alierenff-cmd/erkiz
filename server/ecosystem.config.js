/**
 * Erkiz İşçi Takip Sistemi - PM2 Üretim Yapılandırması
 * Amazon VPS (AWS EC2 / Lightsail) üzerinde 7/24 kesintisiz çalışma için.
 */
module.exports = {
  apps: [
    {
      name: 'erkiz-takip',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ: 'Europe/Istanbul'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 2000
    }
  ]
};
