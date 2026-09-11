const net = require('net');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function getTailscaleCliPath() {
  if (process.platform === 'win32') {
    const defaultWinPath = 'C:\\Program Files\\Tailscale\\tailscale.exe';
    if (fs.existsSync(defaultWinPath)) {
      return `"${defaultWinPath}"`;
    }
  }
  return 'tailscale';
}

function getTailscaleNodeIp() {
  return new Promise((resolve) => {
    const cli = getTailscaleCliPath();
    exec(`${cli} ip -4`, { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const ip = stdout.trim().split('\n')[0].trim();
        if (ip.startsWith('100.')) {
          return resolve(ip);
        }
      }

      // Check status json as fallback
      exec(`${cli} status --json`, { timeout: 3000 }, (jsonErr, jsonStdout) => {
        if (!jsonErr && jsonStdout) {
          try {
            const data = JSON.parse(jsonStdout);
            const self = data.Self || {};
            if (Array.isArray(self.TailscaleIPs)) {
              const tsIp = self.TailscaleIPs.find(i => i && i.startsWith('100.'));
              if (tsIp) return resolve(tsIp);
            }
          } catch (e) {}
        }
        resolve(null);
      });
    });
  });
}

function testPortReachability(host, port = 2222, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const targetHost = host || '127.0.0.1';
    const socket = net.createConnection({ host: targetHost, port: port, timeout: timeoutMs });
    
    socket.on('connect', () => {
      socket.destroy();
      resolve({ reachable: true, error: null });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ reachable: false, error: `Connection to ${targetHost}:${port} timed out` });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ reachable: false, error: err.message || `Failed to connect to ${targetHost}:${port}` });
    });
  });
}

async function verifyTailscaleNetwork(nodeIpCandidate = null) {
  const nodeTsIp = await getTailscaleNodeIp();
  const activeIp = nodeTsIp || nodeIpCandidate || '127.0.0.1';
  const portTest = await testPortReachability(activeIp, 2222);

  const isTailscaleOnline = !!nodeTsIp || (nodeIpCandidate && nodeIpCandidate.startsWith('100.'));

  return {
    tailscaleOnline: isTailscaleOnline,
    tailscaleIp: nodeTsIp || (isTailscaleOnline ? nodeIpCandidate : null),
    sftpReachable: portTest.reachable,
    sftpPort: 2222,
    error: !isTailscaleOnline
      ? 'Tailscale network interface offline on node'
      : (!portTest.reachable ? `SFTP Gateway port 2222 unavailable (${portTest.error})` : null)
  };
}

module.exports = {
  getTailscaleNodeIp,
  testPortReachability,
  verifyTailscaleNetwork
};
