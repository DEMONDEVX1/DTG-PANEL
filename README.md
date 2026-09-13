# DTG-PANEL v2.0
🎮 DTG Panel is a modern Minecraft Server Management Panel built for speed, reliability, and simplicity. 🚀 Designed for server owners and hosting providers, it delivers a clean, responsive, and secure experience with high performance and an intuitive interface. ❤️ Made by AyushTheWarrior & DemonDevx/Rehan ✨

## ✨ Version 2.0 Features (NEW!)

### 🎟️ Referral Code System
- Create and manage referral codes from admin panel
- Users can claim codes to earn credits
- Configurable credit rewards and max claim limits
- Expiry date support
- Transaction logging

### 💳 Billing & Server Packages System
- Create customizable server packages
- Users purchase servers using credits only
- Support for free and paid packages
- Auto-renewal options
- Credit balance tracking
- Transaction history
- Real-time credit deduction

### 📊 User Credit Management
- Automatic wallet creation
- Precision credit tracking (DECIMAL 10,2)
- Multi-transaction logging
- Support for future payment integrations

**For detailed feature information, see [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)**

# Hosting panel: **DTG PANEL**

**How to Install**

# Installations Cmds
```
sudo su
apt update && apt upgrade
apt install git
apt install unzip
apt install docker.io
curl -sL https://deb.nodesource.com/setup_23.x | sudo bash -

apt-get install nodejs git
```
# Clone Repo
```
git clone https://github.com/DEMONDEVX1/DTG-PANEL
```
# Unzip & cd directory
```
cd DTG-PANEL
unzip dtgpanel.zip
cd dtgpanel
```
# How To Setup Domain
```
bash <(curl -s https://ptero.jishnu.site) 

5 than 1 
```
# Add  Domain
```
Open https://dash.cloudflare.com
Then Go to ZeroTrust
Then Networks 
Then Tunnel & Mesh
Create Tunnel then select cloudflared
name of your tunnel
Then Install and run connectors
Set Your Subdomain then set your domain
Then Service Type - Http
Url - localhost:3000
```
# How to Start Panel
```
npm install && npm update && npm upgrade
npm start
```

## Production security

Set `NODE_ENV=production`, a random `SESSION_SECRET`, and `TRUST_PROXY=true` only when the panel is behind one trusted reverse proxy. Serve the panel over HTTPS, keep `.env`, `database.db`, `sessions.db`, node secrets, and server data out of public uploads, and never publish the bundled development database or credentials.

## 🙌 Credits

This project is proudly developed and maintained by **[DemonDevx/Rehan & AyushTheWarrior](Soon)**.  

⚠️ **Note:** If you make any modifications, forks, or redistributions of this repository, please provide proper credit to **AyushTheWarrior & DemonDevx/Rehan** by including the link above in your project. Respecting credits helps keep the community fair and supports further development.  
