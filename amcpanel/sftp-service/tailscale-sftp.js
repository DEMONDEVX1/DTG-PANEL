const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CONFIG_FILE = path.join(__dirname, '..', 'tailscale-sftp.json');

let currentStatus = {
  enabled: false,
  running: false,
  ip: null,
  customHost: '',
  authUrl: null,
  needsLogin: false,
  lastCheck: null,
  error: null
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    enabled: true,
    customHost: '',
    authKey: '',
    autoStart: true
  };
}

function saveConfig(cfg) {
  try {
    const current = loadConfig();
    const updated = { ...current, ...cfg };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (e) {
    console.error('[Tailscale SFTP] Failed to save config:', e.message);
    return loadConfig();
  }
}

function getTailscaleCliPath() {
  if (process.platform === 'win32') {
    const defaultWinPath = 'C:\\Program Files\\Tailscale\\tailscale.exe';
    if (fs.existsSync(defaultWinPath)) {
      return `"${defaultWinPath}"`;
    }
  }
  return 'tailscale';
}

function detectTailscaleInfo() {
  return new Promise((resolve) => {
    const cli = getTailscaleCliPath();
    const cfg = loadConfig();

    exec(`${cli} status --json`, (err, stdout, stderr) => {
      if (!err && stdout) {
        try {
          const json = JSON.parse(stdout);
          const self = json.Self || {};
          let tsIp = null;
          if (Array.isArray(self.TailscaleIPs)) {
            tsIp = self.TailscaleIPs.find(ip => ip && ip.includes('.')) || null;
          }
          
          const isOnline = json.BackendState === 'Running' || self.Online === true;
          const needsLogin = json.BackendState === 'NeedsLogin' || json.BackendState === 'Stopped';
          
          currentStatus.running = isOnline && !!tsIp;
          currentStatus.ip = tsIp;
          currentStatus.needsLogin = needsLogin;
          currentStatus.error = null;
          currentStatus.lastCheck = new Date();
          return resolve(currentStatus);
        } catch (e) {}
      }

      // Fallback: try `tailscale ip -4`
      exec(`${cli} ip -4`, (ipErr, ipStdout) => {
        if (!ipErr && ipStdout && ipStdout.trim()) {
          const cleanIp = ipStdout.trim().split('\n')[0].trim();
          if (cleanIp.includes('.')) {
            currentStatus.running = true;
            currentStatus.ip = cleanIp;
            currentStatus.needsLogin = false;
            currentStatus.error = null;
            currentStatus.lastCheck = new Date();
            return resolve(currentStatus);
          }
        }

        currentStatus.running = false;
        currentStatus.ip = null;
        currentStatus.needsLogin = true;
        currentStatus.error = 'Tailscale CLI not connected or needs login';
        currentStatus.lastCheck = new Date();
        return resolve(currentStatus);
      });
    });
  });
}

function runTailscaleUp(authKey = '') {
  return new Promise((resolve) => {
    const cli = getTailscaleCliPath();
    const cmd = authKey && authKey.trim() !== ''
      ? `${cli} up --authkey="${authKey.trim()}"`
      : `${cli} up`;

    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + '\n' + (stderr || '');
      const urlMatch = output.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9_-]+/);
      const authUrl = urlMatch ? urlMatch[0] : null;
      
      if (authUrl) {
        currentStatus.authUrl = authUrl;
        currentStatus.needsLogin = true;
      } else {
        currentStatus.authUrl = null;
      }

      detectTailscaleInfo().then(() => resolve({
        status: currentStatus,
        authUrl: authUrl,
        output: output
      }));
    });
  });
}

async function getStatus() {
  const cfg = loadConfig();
  await detectTailscaleInfo();
  
  // Return ONLY customHost or clean Tailscale IPv4 address (never machine hostnames)
  let host = 'Not Connected';
  if (cfg.customHost && cfg.customHost.trim() !== '') {
    host = cfg.customHost.trim();
  } else if (currentStatus.running && currentStatus.ip) {
    host = currentStatus.ip;
  }

  return {
    enabled: cfg.enabled !== false,
    running: currentStatus.running,
    ip: currentStatus.ip,
    customHost: cfg.customHost || '',
    authKey: cfg.authKey || '',
    authUrl: currentStatus.authUrl,
    needsLogin: currentStatus.needsLogin,
    host: host,
    port: 2222,
    error: currentStatus.error,
    lastCheck: currentStatus.lastCheck
  };
}

async function startTailscale(authKey = '') {
  const cfg = loadConfig();
  cfg.enabled = true;
  if (authKey) cfg.authKey = authKey;
  saveConfig(cfg);

  const res = await runTailscaleUp(authKey || cfg.authKey);
  const st = await getStatus();
  return {
    ...st,
    authUrl: res.authUrl,
    output: res.output
  };
}

async function stopTailscale() {
  const cfg = loadConfig();
  cfg.enabled = false;
  saveConfig(cfg);
  return getStatus();
}

// Auto-initialize
detectTailscaleInfo();

module.exports = {
  getStatus,
  startTailscale,
  stopTailscale,
  saveConfig,
  loadConfig
};
