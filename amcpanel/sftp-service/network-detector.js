const net = require('net');
const axios = require('axios');
const auth = require('./auth');
const { getTunnelServer, connectedAgents } = require('./tunnel-server');

const CONNECTION_METHODS = {
  LOCAL: 'local',
  TUNNEL: 'tunnel',
  OFFLINE: 'offline'
};

let cachedPublicIp = null;
let cachedPublicIpv6 = null;
let lastPublicIpCheck = 0;
const PUBLIC_IP_CACHE_TTL = 300000;

async function detectPublicIPs() {
  const now = Date.now();
  if (cachedPublicIp && cachedPublicIpv6 && now - lastPublicIpCheck < PUBLIC_IP_CACHE_TTL) {
    return { ipv4: cachedPublicIp, ipv6: cachedPublicIpv6 };
  }

  try {
    const [v4Response, v6Response] = await Promise.allSettled([
      axios.get('https://api.ipify.org?format=json', { timeout: 5000 }).catch(() =>
        axios.get('https://api.my-ip.io/ip.json', { timeout: 5000 })
      ),
      axios.get('https://api6.ipify.org?format=json', { timeout: 5000 }).catch(() =>
        axios.get('https://ipv6.icanhazip.com/', { timeout: 5000 }).then(r => ({ data: { ip: r.data.trim() } }))
      )
    ]);

    if (v4Response.status === 'fulfilled' && v4Response.value.data && v4Response.value.data.ip) {
      if (net.isIPv4(v4Response.value.data.ip)) cachedPublicIp = v4Response.value.data.ip;
    }

    if (v6Response.status === 'fulfilled' && v6Response.value.data) {
      const ip = typeof v6Response.value.data === 'string' ? v6Response.value.data.trim() : v6Response.value.data.ip;
      if (net.isIPv6(ip)) cachedPublicIpv6 = ip;
    }

    lastPublicIpCheck = now;
  } catch (err) {
  }

  return { ipv4: cachedPublicIp, ipv6: cachedPublicIpv6 };
}

function isPrivateIP(ip) {
  if (!ip) return true;
  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase();
    return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') ||
           v6 === '::1' || v6 === '::';
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;

  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

function checkCGNAT(ip) {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

async function detectNodeNetworkCapabilities(nodeId) {
  const node = await auth.getNodeInfo(nodeId);
  if (!node) return { error: 'Node not found' };

  const { ipv4: panelPublicIpv4, ipv6: panelPublicIpv6 } = await detectPublicIPs();

  const nodeIp = node.public_ip && node.public_ip.trim() ? node.public_ip.trim() : node.ip;
  const isPrivate = isPrivateIP(nodeIp);
  const isCGNAT = checkCGNAT(nodeIp);
  const isLocalNode = nodeIp === '127.0.0.1' || nodeIp === 'localhost' || nodeIp === '::1';

  const tunnel = getTunnelServer();
  const isTunnelConnected = tunnel ? tunnel.isNodeConnected(nodeId) : false;
  const tunnelAgent = connectedAgents.get(nodeId);

  let recommendedMethod;
  const methods = [];

  if (isLocalNode) {
    recommendedMethod = CONNECTION_METHODS.LOCAL;
    methods.push({ method: CONNECTION_METHODS.LOCAL, label: 'Local Filesystem', priority: 1, secure: true, description: 'Node is on the same machine as the panel' });
  }

  if (isTunnelConnected) {
    recommendedMethod = recommendedMethod || CONNECTION_METHODS.TUNNEL;
    methods.push({
      method: CONNECTION_METHODS.TUNNEL,
      label: 'Secure Tunnel',
      priority: isLocalNode ? 2 : 1,
      secure: true,
      description: 'Node connected via persistent outbound tunnel',
      tunnelInfo: {
        connectedAt: tunnelAgent ? tunnelAgent.connectedAt : null,
        lastHeartbeat: tunnelAgent ? tunnelAgent.lastHeartbeat : null,
        clientIp: tunnelAgent ? tunnelAgent.clientIp : null,
        status: tunnelAgent ? tunnelAgent.status : 'connected'
      }
    });
  }

  if (!isLocalNode && !isTunnelConnected) {
    recommendedMethod = CONNECTION_METHODS.OFFLINE;
    methods.push({
      method: CONNECTION_METHODS.OFFLINE,
      label: 'Offline',
      priority: 99,
      secure: false,
      description: 'Node has no active tunnel connection. The node agent (amcdaemon.js) must be running on the node.'
    });
  }

  methods.sort((a, b) => a.priority - b.priority);

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeIp,
    publicIp: node.public_ip,
    panelPublicIpv4,
    panelPublicIpv6,
    isLocalNode,
    isPrivate,
    isCGNAT,
    isTunnelConnected,
    recommendedMethod,
    methods,
    connectable: isLocalNode || isTunnelConnected,
    tunnelRequired: !isLocalNode,
    message: isLocalNode
      ? 'Local node: files are accessed directly from the panel filesystem'
      : isTunnelConnected
        ? 'Remote node: files are accessed through the secure outbound tunnel'
        : 'Remote node: OFFLINE. Run amcdaemon.js --run on the node to establish the tunnel.'
  };
}

async function detectAllNodesNetwork() {
  const db = auth.getDb();

  return new Promise((resolve) => {
    db.all('SELECT id FROM nodes', async (err, rows) => {
      if (err || !rows) return resolve([]);
      const results = [];
      for (const row of rows) {
        const detection = await detectNodeNetworkCapabilities(row.id);
        results.push(detection);
      }
      resolve(results);
    });
  });
}

module.exports = {
  CONNECTION_METHODS,
  detectPublicIPs,
  isPrivateIP,
  checkCGNAT,
  detectNodeNetworkCapabilities,
  detectAllNodesNetwork
};
