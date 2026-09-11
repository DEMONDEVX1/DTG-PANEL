#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const readline = require('readline');
const { TunnelAgent } = require('./sftp-service/tunnel-agent');

const CONFIG_DIR = path.join(require('os').homedir(), '.amc-daemon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const DAEMON_VERSION = '1.0.0';

const BANNER = `
╔══════════════════════════════════════════════╗
║          AMC Panel Node Agent v${DAEMON_VERSION}          ║
║      Minecraft Server Node Daemon            ║
╚══════════════════════════════════════════════╝
`;

const HELP = `
AMC Panel Node Agent v${DAEMON_VERSION}

Usage: node amcdaemon.js [option] [args...]

Options:
  --install                      Interactive setup wizard
  --install <panel_url> <secret> Quick install with panel URL and node secret
  --run                          Start the node agent daemon
  --status                       Show config and connection info
  --help                         Show this help message

Examples:
  node amcdaemon.js --install                              # Interactive setup
  node amcdaemon.js --install http://panel:3000 ABC123     # Quick install
  node amcdaemon.js --run                                  # Start the agent
  node amcdaemon.js --status                               # Show config & status
`;

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0) return 'menu';
    const arg = args[0].replace(/^-+/, '');
    return arg;
}

function createRl() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return null;
}

function saveConfig(config) {
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save config:', e.message);
    }
}

function log(level, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${msg}`;
    console.log(line);
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(path.join(LOG_DIR, 'daemon.log'), line + '\n');
    } catch (e) {}
}

function panelRequest(path, method, data) {
    const config = loadConfig();
    if (!config || !config.node_secret) return Promise.resolve(null);
    const url = new URL(config.panel_url.replace(/\/+$/, '') + path);
    const postData = data ? JSON.stringify(data) : null;
    return new Promise((resolve) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-Node-Secret': config.node_secret,
                'X-Node-Name': config.node_name,
                ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
            },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        if (postData) req.write(postData);
        req.end();
    });
}

function registerWithPanel(config) {
    panelRequest('/api/daemon/register', 'POST', {
        node_name: config.node_name,
        node_ip: config.node_ip,
        daemon_port: config.daemon_port,
        ram: config.node_ram,
        cpu: config.node_cpu,
        disk: config.node_disk,
        location: config.node_location
    }).then(r => {
        if (r && r.success) log('INFO', 'Registered with panel');
        else log('WARN', 'Panel registration failed: ' + (r ? r.error : 'unreachable'));
    });
}

function sendHeartbeat() {
    const os = require('os');
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const cpus = os.cpus();
    const cpuPercent = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
    panelRequest('/api/daemon/heartbeat', 'POST', {
        status: 'online',
        ram_total: totalMem,
        ram_used: totalMem - freeMem,
        cpu_percent: cpuPercent,
        load_avg: os.loadavg().map(l => Math.round(l * 100) / 100)
    });
}

function showMenu() {
    console.log(BANNER);
    console.log('Quick Start:\n');
    console.log('  1. Install (first time):');
    console.log('     node amcdaemon.js --install\n');
    console.log('  2. Start the daemon:');
    console.log('     node amcdaemon.js --run\n');
    console.log('  3. Check status:');
    console.log('     node amcdaemon.js --status\n');
    console.log('  4. View logs:');
    console.log('     tail -f ~/.amc-daemon/logs/daemon.log\n');
    console.log(HELP);
}

async function runInstall() {
    console.log(BANNER);
    console.log('=== AMC Node Agent Setup Wizard ===\n');

    const rl = createRl();

    try {
        const existing = loadConfig();
        if (existing) {
            console.log('Existing configuration found:');
            console.log(`  Panel URL:  ${existing.panel_url}`);
            console.log(`  Node Name:  ${existing.node_name}`);
            console.log(`  Listen Port: ${existing.daemon_port}\n`);
            const overwrite = await ask(rl, 'Overwrite existing config? (y/N): ');
            if (overwrite.toLowerCase() !== 'y') {
                console.log('Setup cancelled.');
                rl.close();
                return;
            }
        }

        const nodeType = await ask(rl, 'Node type - Local or Remote? (local/remote): ');
        const isLocal = !nodeType || nodeType.toLowerCase() !== 'remote';

        let panelUrl, nodeIp, daemonPort;

        if (isLocal) {
            panelUrl = await ask(rl, 'Panel URL (default: http://127.0.0.1:3000): ');
            panelUrl = panelUrl.trim() || 'http://127.0.0.1:3000';
            nodeIp = '127.0.0.1';
            daemonPort = '8080';
        } else {
            panelUrl = await ask(rl, 'Panel URL (e.g., http://YOUR_PANEL_IP:3000): ');
            nodeIp = await ask(rl, 'Node IP Address (public IP of this machine): ');
            daemonPort = await ask(rl, 'Daemon listen port (default: 8080): ');
            nodeIp = nodeIp.trim() || '127.0.0.1';
            daemonPort = daemonPort.trim() || '8080';
        }

        const nodeName = await ask(rl, 'Node name (e.g., US-East-1): ');
        const nodeLocation = await ask(rl, 'Location (e.g., New York, USA): ');
        const nodeRam = await ask(rl, 'Total RAM in MB (default: 16384): ');
        const nodeCpu = await ask(rl, 'Total CPU cores (default: 4): ');
        const nodeDisk = await ask(rl, 'Total Disk in MB (default: 102400): ');
        const panelKey = await ask(rl, 'Panel API Key (from Admin → Nodes): ');

        const config = {
            panel_url: (panelUrl || '').trim() || 'http://127.0.0.1:3000',
            node_name: (nodeName || '').trim() || 'Local-Node',
            node_ip: nodeIp,
            node_location: (nodeLocation || '').trim() || '',
            daemon_port: parseInt(daemonPort) || 8080,
            node_ram: parseInt(nodeRam) || 16384,
            node_cpu: parseInt(nodeCpu) || 4,
            node_disk: parseInt(nodeDisk) || 102400,
            node_secret: (panelKey || '').trim() || '',
            base_dir: path.join(CONFIG_DIR, 'servers'),
            created_at: new Date().toISOString()
        };

        saveConfig(config);
        fs.mkdirSync(config.base_dir, { recursive: true });
        fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n✅ Configuration saved to:', CONFIG_FILE);
        console.log('\nNext steps:');
        console.log('  1. Create this node in Admin → Nodes in the panel');
        console.log('  2. Copy the API key from the node into this config');
        console.log(`  3. Run: node amcdaemon.js --run\n`);

    } catch (err) {
        console.error('Setup error:', err.message);
    } finally {
        rl.close();
    }
}

function showStatus() {
    console.log(BANNER);

    const config = loadConfig();
    if (!config) {
        console.log('❌ No configuration found. Run --install first.\n');
        return;
    }

    console.log('=== Configuration ===');
    console.log(`  Panel URL:     ${config.panel_url}`);
    console.log(`  Node Name:     ${config.node_name}`);
    console.log(`  Node IP:       ${config.node_ip}`);
    console.log(`  Location:      ${config.node_location || '(not set)'}`);
    console.log(`  Daemon Port:   ${config.daemon_port}`);
    console.log(`  RAM:           ${config.node_ram} MB`);
    console.log(`  CPU:           ${config.node_cpu} cores`);
    console.log(`  Disk:          ${config.node_disk} MB`);
    console.log(`  Base Dir:      ${config.base_dir}`);
    console.log(`  Node Secret:   ${config.node_secret ? '***' + config.node_secret.slice(-4) : '(not set)'}`);
    console.log(`  Created:       ${config.created_at}`);
    console.log('');

    console.log('=== Connection Test ===');
    const url = config.panel_url.replace(/\/+$/, '') + '/api/nodes';
    const parsed = new URL(url);

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'GET',
        headers: {
            'X-Node-Secret': config.node_secret || '',
            'X-Node-Name': config.node_name || ''
        },
        timeout: 5000
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log(`  Panel reachable: ✅ Yes (${res.statusCode})`);
            console.log('');
        });
    });

    req.on('error', (err) => {
        console.log(`  Panel reachable: ❌ No (${err.message})`);
        console.log('');
    });

    req.on('timeout', () => {
        console.log('  Panel reachable: ❌ No (timeout)');
        req.destroy();
    });

    req.end();
}

function runDaemon() {
    console.log(BANNER);

    const config = loadConfig();
    if (!config) {
        console.log('❌ No configuration found. Run --install first.\n');
        return;
    }

    log('INFO', `Starting AMC Node Agent v${DAEMON_VERSION}`);
    log('INFO', `Node: ${config.node_name} | Port: ${config.daemon_port}`);
    log('INFO', `Panel: ${config.panel_url}`);

    fs.mkdirSync(config.base_dir, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });

    // Register with panel
        if (config.node_secret && config.node_secret.length >= 32) {
        registerWithPanel(config);
        } else {
            log('ERROR', 'Node secret is missing or too short; refusing to register securely');
    }

    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');

        // Check node_secret on all requests
        const authHeader = req.headers['x-node-secret'];
        if (!config.node_secret || config.node_secret.length < 32 || authHeader !== config.node_secret) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        if (req.method === 'GET' && req.url === '/api/status') {
            const os = require('os');
            const { execSync } = require('child_process');
            const totalMem = Math.round(os.totalmem() / (1024 * 1024));
            const freeMem = Math.round(os.freemem() / (1024 * 1024));
            const usedMem = totalMem - freeMem;
            const cpus = os.cpus();
            const loadAvg = os.loadavg();
            const cpuPercent = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100));
            let diskUsed = 0;
            try {
                if (process.platform === 'win32') {
                    const out = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv', { encoding: 'utf8', timeout: 5000 });
                    const lines = out.trim().split('\n').filter(l => l.includes(','));
                    if (lines.length > 0) {
                        const parts = lines[lines.length - 1].split(',');
                        const freeBytes = parseInt(parts[1]) || 0;
                        const totalBytes = parseInt(parts[2]) || 0;
                        diskUsed = totalBytes > 0 ? Math.round((totalBytes - freeBytes) / (1024 * 1024)) : 0;
                    }
                } else {
                    const out = execSync("df -BM / | tail -1 | awk '{print $3}' | tr -d 'M'", { encoding: 'utf8', timeout: 5000 });
                    diskUsed = parseInt(out.trim()) || 0;
                }
            } catch (e) {
                diskUsed = config.node_disk > 0 ? Math.round(config.node_disk * 0.05) : 0;
            }
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                node: config.node_name,
                version: DAEMON_VERSION,
                uptime: Math.round(process.uptime()),
                status: 'online',
                ram_total: totalMem,
                ram_used: usedMem,
                ram_percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
                cpu_count: cpus.length,
                cpu_percent: cpuPercent,
                disk_total: config.node_disk,
                disk_used: diskUsed,
                disk_percent: config.node_disk > 0 ? Math.round((diskUsed / config.node_disk) * 100) : 0,
                load_avg: loadAvg.map(l => Math.round(l * 100) / 100)
            }));
        } else if (req.method === 'GET' && req.url === '/api/config') {
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                name: config.node_name,
                ip: config.node_ip,
                location: config.node_location,
                port: config.daemon_port,
                ram: config.node_ram,
                cpu: config.node_cpu,
                disk: config.node_disk
            }));
        } else if (req.method === 'POST' && req.url === '/api/server/create') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const serverId = String(data.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');
                    if (!serverId) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Invalid server ID' }));
                        return;
                    }
                    log('INFO', `Server create requested: ${data.name}`);
                    const serverDir = path.join(config.base_dir, serverId);
                    fs.mkdirSync(serverDir, { recursive: true });
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, path: serverDir }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    let tunnelAgent = null;

    async function connectTunnel() {
        if (!config.node_secret) return;
        try {
            const panelUrl = config.panel_url.replace(/\/+$/, '');
            const parsedUrl = new url.URL(panelUrl);
            const tunnelHost = parsedUrl.hostname;
            const tunnelPort = process.env.SFTP_TUNNEL_PORT || 2224;
            const useTls = process.env.SFTP_TLS_KEY && process.env.SFTP_TLS_CERT;
            const protocol = useTls ? 'wss' : 'ws';
            const tunnelUrl = `${protocol}://${tunnelHost}:${tunnelPort}/agent`;

            log('INFO', `Connecting to panel tunnel at ${tunnelUrl}`);

            tunnelAgent = new TunnelAgent({
                panelUrl: tunnelUrl,
                nodeName: config.node_name,
                nodeSecret: config.node_secret,
                nodeId: config.node_name,
                serverDir: config.base_dir,
                reconnectBaseDelay: 1000,
                reconnectMaxDelay: 60000,
                heartbeatInterval: 30000,
                dialTimeout: 10000
            });

            tunnelAgent.connect().then(() => {
                log('INFO', 'Tunnel connection established and authenticated');
            }).catch((err) => {
                log('ERROR', `Tunnel connection failed: ${err.message}`);
            });
        } catch (err) {
            log('ERROR', `Tunnel setup failed: ${err.message}`);
        }
    }

    const relayHandles = new Map();

    server.listen(parseInt(config.daemon_port), '0.0.0.0', () => {
        log('INFO', `Daemon listening on port ${config.daemon_port}`);
        console.log(`\n🟢 AMC Node Agent is running`);
        console.log(`   Node: ${config.node_name}`);
        console.log(`   Port: ${config.daemon_port}`);
        console.log(`   Press Ctrl+C to stop\n`);
        // Start heartbeat every 30 seconds
        if (config.node_secret) {
            heartbeatInterval = setInterval(sendHeartbeat, 30000);
            sendHeartbeat();
        }
        // Connect to panel tunnel for SFTP
        connectTunnel();
    });

    server.on('error', (err) => {
        log('ERROR', `Server error: ${err.message}`);
        if (err.code === 'EADDRINUSE') {
            console.log(`\n❌ Port ${config.daemon_port} is already in use.`);
            console.log('   Stop the other process or change the port in config.\n');
        }
        process.exit(1);
    });

    process.on('SIGINT', () => {
        log('INFO', 'Daemon shutting down');
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (tunnelAgent) { tunnelAgent.disconnect(); tunnelAgent = null; }
        for (const [, entry] of relayHandles) {
            if (entry.fd) try { fs.closeSync(entry.fd); } catch (e) {}
        }
        relayHandles.clear();
        console.log('\nDaemon stopped.');
        server.close();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        log('INFO', 'Daemon received SIGTERM');
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (tunnelAgent) { tunnelAgent.disconnect(); tunnelAgent = null; }
        for (const [, entry] of relayHandles) {
            if (entry.fd) try { fs.closeSync(entry.fd); } catch (e) {}
        }
        relayHandles.clear();
        server.close();
        process.exit(0);
    });

    process.on('unhandledRejection', (reason) => {
        log('ERROR', `Unhandled rejection: ${reason}`);
    });

    process.on('uncaughtException', (err) => {
        log('ERROR', `Uncaught exception: ${err.message}`);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (tunnelAgent) { tunnelAgent.disconnect(); tunnelAgent = null; }
        process.exit(1);
    });
}

async function quickInstall(panelUrl, secret) {
    console.log(BANNER);
    console.log('=== Quick Install ===\n');
    console.log(`  Panel URL: ${panelUrl}`);
    console.log(`  Verifying secret...`);

    // Verify with panel
    let url;
    try {
        url = new URL(panelUrl.replace(/\/+$/, '') + '/api/daemon/auth');
    } catch (e) {
        console.error('\n❌ Invalid panel URL:', panelUrl);
        return;
    }
    const postData = JSON.stringify({ node_name: 'quick-install', node_secret: secret });

    return new Promise((resolve) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.success) {
                        const config = {
                            panel_url: panelUrl.trim(),
                            node_name: result.node_name || 'Remote-Node',
                            node_ip: '0.0.0.0',
                            node_location: '',
                            daemon_port: 8080,
                            node_ram: 16384,
                            node_cpu: 4,
                            node_disk: 102400,
                            node_secret: secret,
                            base_dir: path.join(CONFIG_DIR, 'servers'),
                            created_at: new Date().toISOString()
                        };
                        saveConfig(config);
                        fs.mkdirSync(config.base_dir, { recursive: true });
                        fs.mkdirSync(LOG_DIR, { recursive: true });
                        console.log('\n✅ Secret verified and config saved!');
                        console.log(`\n   Config: ${CONFIG_FILE}`);
                        console.log(`\n   Next: edit config.json to set your node name, IP, RAM, CPU, disk`);
                        console.log(`   Then run: node amcdaemon.js --run\n`);
                    } else {
                        console.log('\n❌ Secret rejected by panel:', result.error || 'Unknown error');
                    }
                } catch (e) {
                    console.log('\n❌ Invalid response from panel');
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            console.log('\n❌ Cannot reach panel:', err.message);
            resolve();
        });

        req.on('timeout', () => {
            console.log('\n❌ Connection timed out');
            req.destroy();
            resolve();
        });

        req.write(postData);
        req.end();
    });
}

const cmd = parseArgs();
const allArgs = process.argv.slice(2);

if (cmd === 'install' && allArgs.length >= 3) {
    // Quick install: --install <panel_url> <secret>
    const panelUrl = allArgs[1];
    const secret = allArgs[2];
    quickInstall(panelUrl, secret).catch(e => {
        console.error('Quick install failed:', e.message);
        process.exit(1);
    });
} else {
    switch (cmd) {
        case 'install':
            runInstall();
            break;
        case 'run':
            runDaemon();
            break;
        case 'status':
            showStatus();
            break;
        case 'help':
            console.log(BANNER);
            console.log(HELP);
            break;
        default:
            showMenu();
            break;
    }
}
