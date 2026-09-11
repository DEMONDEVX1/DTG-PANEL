const { SftpServer } = require('./sftp-server');
const { TunnelServer } = require('./tunnel-server');
const networkDetector = require('./network-detector');
const { getTunnelNodeIds } = require('./connection-manager');
const config = require('./config');

const tailscaleSftp = require('./tailscale-sftp');

let sftpServer = null;
let tunnelServer = null;
let serviceStarted = false;

async function startSftpService() {
  if (serviceStarted) {
    console.log('[SFTP] Service already running');
    return true;
  }

  console.log('[SFTP] Starting Universal SFTP Gateway...');
  console.log(`[SFTP] Configuration:
    SFTP Port: ${config.port}
    Tunnel Port: ${config.tunnelPort}
    Max Connections: ${config.maxConnections}
    Idle Timeout: ${config.idleTimeout}ms
    Debug: ${config.debug}`);

  try {
    sftpServer = new SftpServer();
    await sftpServer.start();

    tunnelServer = new TunnelServer();
    await tunnelServer.start();

    serviceStarted = true;
    console.log('[SFTP] Universal SFTP Gateway started successfully');
    console.log(`[SFTP] Connect using: sftp://<panel-host>:${config.port}`);
    console.log(`[SFTP] Agent tunnel listening on port ${config.tunnelPort}`);

    return true;
  } catch (err) {
    console.error('[SFTP] Failed to start:', err.message);
    return false;
  }
}

async function stopSftpService() {
  if (!serviceStarted) return;

  console.log('[SFTP] Stopping Universal SFTP Gateway...');

  if (sftpServer) {
    sftpServer.stop();
    sftpServer = null;
  }

  if (tunnelServer) {
    tunnelServer.stop();
    tunnelServer = null;
  }

  serviceStarted = false;
  console.log('[SFTP] Service stopped');
}

function getServiceStatus() {
  return {
    running: serviceStarted,
    sftp: sftpServer ? sftpServer.getStatus() : null,
    tunnel: tunnelServer ? tunnelServer.getStatus() : null,
    tailscale: tailscaleSftp.getStatus()
  };
}

async function getNodeNetworkStatus(nodeId) {
  try {
    return await networkDetector.detectNodeNetworkCapabilities(nodeId);
  } catch (err) {
    return { error: err.message };
  }
}

async function getAllNodesNetworkStatus() {
  try {
    return await networkDetector.detectAllNodesNetwork();
  } catch (err) {
    return { error: err.message };
  }
}

process.on('SIGINT', () => {
  stopSftpService().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stopSftpService().then(() => process.exit(0));
});

module.exports = {
  startSftpService,
  stopSftpService,
  getServiceStatus,
  getNodeNetworkStatus,
  getAllNodesNetworkStatus,
  tailscaleSftp
};

