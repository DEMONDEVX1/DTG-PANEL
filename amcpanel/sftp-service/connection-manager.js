const { getTunnelServer } = require('./tunnel-server');

async function getConnectionForNode(nodeId) {
  const tunnel = getTunnelServer();
  if (!tunnel) {
    throw new Error('Tunnel server is not running');
  }

  const agent = tunnel.getNodeConnection(nodeId);
  if (!agent) {
    return null;
  }

  return {
    nodeId,
    isAlive: agent.ws.readyState === require('ws').OPEN,
    type: 'tunnel'
  };
}

function closeAllConnections() {
  const tunnel = getTunnelServer();
  if (tunnel) {
    tunnel.stop();
  }
}

async function getTunnelNodeIds() {
  const tunnel = getTunnelServer();
  if (!tunnel) return [];
  return tunnel.getConnectedNodeIds();
}

module.exports = {
  getConnectionForNode,
  closeAllConnections,
  getTunnelNodeIds
};
