# DTG-PANEL
🎮 DTG Panel is a modern Minecraft Server Management Panel built for speed, reliability, and simplicity. 🚀 Designed for server owners and hosting providers, it delivers a clean, responsive, and secure experience with high performance and an intuitive interface. ❤️ Made by AyushTheWarrior & DemonDevx/Rehan ✨

# Hosting panel: **DTG PANEL**

**How to Install**

# Installations Cmds
```
apt update
apt install git
apt install unzip
apt install docker.io
curl -sL https://deb.nodesource.com/setup_23.x | sudo bash -

apt-get install nodejs git
```
# Clone Repo
```
git clone https://github.com/DemonDevxx/DTG-PANEL
```
# Unzip & cd directory
```
cd AMC-PANEL
unzip amcpanel.zip
cd amcpanel
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
npm install
Type nano .env And Change The Trust Proxy To True
npm start
```

## Production security

Set `NODE_ENV=production`, a random `SESSION_SECRET`, and `TRUST_PROXY=true` only when the panel is behind one trusted reverse proxy. Serve the panel over HTTPS, keep `.env`, `database.db`, `sessions.db`, node secrets, and server data out of public uploads, and never publish the bundled development database or credentials.

## 🙌 Credits

This project is proudly developed and maintained by **[DemonDevx/Rehan & AyushTheWarrior](Soon)**.  

⚠️ **Note:** If you make any modifications, forks, or redistributions of this repository, please provide proper credit to **AyushTheWarrior & DemonDevx/Rehan** by including the link above in your project. Respecting credits helps keep the community fair and supports further development.  
