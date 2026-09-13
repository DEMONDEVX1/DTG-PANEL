# DTG Panel 2.0 - Production Deployment Guide

## 📋 Pre-Deployment Checklist

### Code Quality
- [x] No syntax errors
- [x] All features implemented
- [x] Database schema validated
- [x] Error handling implemented
- [x] Input validation added

### Testing
- [ ] Unit tests passed
- [ ] Integration tests passed
- [ ] User acceptance testing completed
- [ ] Performance testing completed (load > 100 users)
- [ ] Security testing completed

### Security
- [ ] Admin password changed from default
- [ ] SESSION_SECRET is strong (32+ chars)
- [ ] COOKIE_SECURE set to true in production
- [ ] TRUST_PROXY configured correctly
- [ ] Database password protected
- [ ] File permissions secured

### Documentation
- [x] Feature documentation complete
- [x] Testing guide created
- [x] API documentation available
- [x] Database schema documented
- [ ] User manual created
- [ ] Admin guide created

---

## 🔧 Production Setup

### 1. Environment Configuration

Create `.env` file in `/workspaces/DTG-PANEL/amcpanel/`:

```bash
# Production Environment
NODE_ENV=production
PORT=3000
TRUST_PROXY=true

# Session & Security
SESSION_SECRET=your-very-long-random-string-here-min-32-chars-required
COOKIE_SECURE=true
ADMIN_PASSWORD=your-very-strong-admin-password

# API Keys (if needed)
CURSEFORGE_API_KEY=your-key-here

# Optional Settings
LOG_LEVEL=info
DEBUG=false
```

**Generate Secure SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Database Backup

```bash
# Backup existing database
cp database.db database.db.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup
sqlite3 database.db.backup.* ".tables"
```

### 3. Dependency Installation

```bash
cd /workspaces/DTG-PANEL/amcpanel
npm install --production
npm audit fix
```

### 4. Start Server

**Option A: Direct Start**
```bash
npm start
```

**Option B: Using PM2 (Recommended for Production)**

Install PM2:
```bash
npm install -g pm2
```

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: "dtg-panel",
    script: "./app.js",
    instances: "max",
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 3000
    },
    max_memory_restart: "1G",
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
```

Start with PM2:
```bash
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

**Option C: Using systemd (Recommended for Linux)**

Create `/etc/systemd/system/dtg-panel.service`:
```ini
[Unit]
Description=DTG Panel - Minecraft Server Control Panel
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/workspaces/DTG-PANEL/amcpanel
ExecStart=/usr/bin/node /workspaces/DTG-PANEL/amcpanel/app.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable dtg-panel
sudo systemctl start dtg-panel
sudo systemctl status dtg-panel
```

---

## 🌐 Reverse Proxy Setup (Nginx)

### Create Nginx Config

File: `/etc/nginx/sites-available/dtg-panel`

```nginx
upstream dtg_panel {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Certificates (using Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;
    
    # Proxy Configuration
    location / {
        proxy_pass http://dtg_panel;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
    
    # WebSocket Support (Socket.io)
    location /socket.io {
        proxy_pass http://dtg_panel/socket.io;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # Static Files (cache them)
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/dtg-panel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔐 SSL/TLS Setup (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --nginx -d your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal
sudo certbot renew --dry-run
```

---

## 📊 Monitoring & Logging

### Application Logs

**Using PM2:**
```bash
pm2 logs dtg-panel
pm2 logs dtg-panel --lines 100
pm2 logs dtg-panel --err
```

**Using Systemd:**
```bash
sudo journalctl -u dtg-panel -f
sudo journalctl -u dtg-panel -n 100
```

### System Monitoring

Install monitoring tools:
```bash
# Memory, CPU, Disk usage
watch -n 1 free -h
watch -n 1 df -h
top

# Monitor specific process
ps aux | grep node
lsof -i :3000
```

### Database Size Monitoring

```bash
# Check database size
ls -lh database.db

# Daily backup script
#!/bin/bash
BACKUP_DIR="/backups/dtg-panel"
DB_PATH="/workspaces/DTG-PANEL/amcpanel/database.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
cp $DB_PATH $BACKUP_DIR/database.db.backup.$TIMESTAMP
gzip $BACKUP_DIR/database.db.backup.$TIMESTAMP

# Keep only last 30 days of backups
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete
```

---

## 🚨 Troubleshooting

### Server Won't Start

1. Check port is not in use:
```bash
lsof -i :3000
```

2. Check logs for errors:
```bash
pm2 logs dtg-panel
# or
journalctl -u dtg-panel -n 50
```

3. Verify database:
```bash
sqlite3 database.db "SELECT COUNT(*) FROM users;"
```

### High Memory Usage

1. Check for memory leaks:
```bash
pm2 monit
```

2. Restart application:
```bash
pm2 restart dtg-panel
# or
sudo systemctl restart dtg-panel
```

3. Check database size:
```bash
sqlite3 database.db "SELECT COUNT(*) FROM billing_transactions;"
```

### Slow Database Queries

Add indexes for frequently queried columns:
```bash
sqlite3 database.db << 'EOF'
CREATE INDEX IF NOT EXISTS idx_user_id ON billing_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_id_credits ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_code_status ON referral_codes(status);
CREATE INDEX IF NOT EXISTS idx_package_status ON server_packages(status);
EOF
```

### Connection Issues

1. Check Nginx configuration:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

2. Test proxy:
```bash
curl -I http://localhost:3000
curl -I https://your-domain.com
```

---

## 📈 Performance Optimization

### 1. Database Optimization

```bash
# Vacuum database
sqlite3 database.db "VACUUM;"

# Analyze indexes
sqlite3 database.db "ANALYZE;"

# Check query plans
sqlite3 database.db ".eqp on"
sqlite3 database.db "SELECT * FROM users WHERE id = 1;"
```

### 2. Node.js Optimization

Increase process memory:
```bash
export NODE_OPTIONS="--max-old-space-size=2048"
npm start
```

### 3. Caching Strategy

For frequently accessed data, add caching:
- Cache server packages list
- Cache active referral codes
- Cache user credit balance

---

## 🔄 Backup & Recovery

### Daily Automated Backup

Create script `/usr/local/bin/backup-dtg-panel.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups/dtg-panel"
DB_PATH="/workspaces/DTG-PANEL/amcpanel/database.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
cp $DB_PATH $BACKUP_DIR/database.db.$TIMESTAMP
gzip $BACKUP_DIR/database.db.$TIMESTAMP

# Backup environment
cp /workspaces/DTG-PANEL/amcpanel/.env $BACKUP_DIR/.env.$TIMESTAMP

# Cleanup old backups (keep 30 days)
find $BACKUP_DIR -mtime +30 -delete

echo "Backup completed: $TIMESTAMP"
```

Make executable and schedule:
```bash
chmod +x /usr/local/bin/backup-dtg-panel.sh

# Add to crontab
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-dtg-panel.sh
```

### Restore from Backup

```bash
# Stop application
sudo systemctl stop dtg-panel

# Restore database
cp /backups/dtg-panel/database.db.20240912_020000 /workspaces/DTG-PANEL/amcpanel/database.db

# Start application
sudo systemctl start dtg-panel
```

---

## ✅ Post-Deployment Verification

1. **Access the Panel**
   ```
   https://your-domain.com
   ```

2. **Test Login**
   - Admin credentials work
   - Regular user can login

3. **Test Features**
   - Create referral code
   - Create server package
   - Claim referral code (as user)
   - Purchase server (as user)

4. **Check Logs**
   ```bash
   pm2 logs dtg-panel
   ```

5. **Verify Database**
   ```bash
   sqlite3 database.db ".tables"
   ```

6. **Monitor Resources**
   ```bash
   free -h
   df -h
   top
   ```

---

## 📞 Maintenance Schedule

### Daily
- [ ] Monitor error logs
- [ ] Check disk space
- [ ] Verify application is running

### Weekly
- [ ] Review transaction history
- [ ] Check database size
- [ ] Test backup restore

### Monthly
- [ ] Update dependencies
- [ ] Security audit
- [ ] Performance analysis
- [ ] User feedback review

### Quarterly
- [ ] Major security updates
- [ ] Database optimization
- [ ] Feature review
- [ ] Scale assessment

---

## 🎯 Success Criteria

Panel is production-ready when:
- [x] No console errors on startup
- [x] All database tables created
- [x] Admin can manage referral codes
- [x] Admin can manage server packages
- [x] Users can claim codes
- [x] Users can purchase servers
- [ ] Load tested with 100+ concurrent users
- [ ] All features documented
- [ ] Backup strategy implemented
- [ ] Monitoring setup

---

**Production Deployment Version**: 2.0.0  
**Last Updated**: September 12, 2026  
**Status**: Ready for Deployment
