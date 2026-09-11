# DTG PANEL
DTG Panel is a modern Minecraft server management panel built for speed, reliability, and simplicity. Designed for server owners and hosting providers, it delivers a clean, responsive, and secure experience. Made by Rehan.

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
git clone https://github.com/AyushTheWarriorOfficial/AMC-PANEL
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
cp .env.example .env
# Set a random SESSION_SECRET (32+ characters) before publishing
npm install
npm start
```

## Production security

Set `NODE_ENV=production`, a random `SESSION_SECRET`, and `TRUST_PROXY=true` only when the panel is behind one trusted reverse proxy. Serve the panel over HTTPS, keep `.env`, `database.db`, `sessions.db`, node secrets, and server data out of public uploads, and never publish the bundled development database or credentials.

## Credits

This project is proudly developed and maintained by **Rehan**.

