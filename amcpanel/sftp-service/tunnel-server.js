const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const fs = require('fs');
const config = require('./config');
const auth = require('./auth');
const relayProtocol = require('./tunnel-protocol');

const { TUNNEL_MESSAGE_TYPES: TMT, FS_OPERATIONS } = relayProtocol;

const connectedAgents = new Map();
const pendingRequests = new Map();
const agentStatus = new Map();
let reqIdCounter = 0;
let tunnelServerInstance = null;

class TunnelServer {
  constructor() {
    this.server = null;
    this.wss = null;
    this.isRunning = false;
    this._cleanupTimer = null;
  }

  async start() {
    if (this.isRunning) return;

    return new Promise((resolve) => {
      const useTls = config.tunnelTlsKey && config.tunnelTlsCert &&
        fs.existsSync(config.tunnelTlsKey) && fs.existsSync(config.tunnelTlsCert);

      let httpServer;
      if (useTls) {
        const tlsOpts = {
          key: fs.readFileSync(config.tunnelTlsKey, 'utf8'),
          cert: fs.readFileSync(config.tunnelTlsCert, 'utf8')
        };
        httpServer = https.createServer(tlsOpts, (req, res) => this._handleHttp(req, res));
      } else {
        httpServer = http.createServer((req, res) => this._handleHttp(req, res));
      }

      this.wss = new WebSocket.Server({
        server: httpServer,
        path: config.tunnelPath
      });

      this.wss.on('connection', (ws, req) => {
        this._handleConnection(ws, req);
      });

      httpServer.listen(config.tunnelPort, config.tunnelHost, () => {
        const proto = useTls ? 'WSS (TLS)' : 'WS';
        console.log(`[Tunnel Server] Listening on ${config.tunnelHost}:${config.tunnelPort}${config.tunnelPath} (${proto})`);
        this.isRunning = true;
        this.server = httpServer;
        tunnelServerInstance = this;
        resolve();
      });

      httpServer.on('error', (err) => {
        console.error(`[Tunnel Server] Failed to start: ${err.message}`);
        resolve();
      });

      this._cleanupTimer = setInterval(() => this._cleanupStaleRequests(), 60000);
    });
  }

  _handleHttp(req, res) {
    if (req.url === '/agent/health' || req.url === '/api/agent/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        connectedAgents: connectedAgents.size,
        pendingRequests: pendingRequests.size,
        agents: Array.from(connectedAgents.entries()).map(([id, info]) => ({
          nodeId: id,
          nodeName: info.nodeName,
          connectedAt: info.connectedAt,
          clientIp: info.clientIp,
          lastHeartbeat: info.lastHeartbeat,
          status: info.status
        }))
      }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }

  _handleConnection(ws, req) {
    const clientIp = req.socket.remoteAddress || 'unknown';
    let nodeId = null;
    let nodeInfo = null;
    let authenticated = false;
    let heartbeatInterval = null;
    let heartbeatMisses = 0;
    const MAX_HEARTBEAT_MISSES = 3;

    const hbTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(hbTimer);
        return;
      }
      heartbeatMisses++;
      if (heartbeatMisses > MAX_HEARTBEAT_MISSES) {
        console.log(`[Tunnel Server] Node ${nodeId || 'unknown'} heartbeat timeout, disconnecting`);
        ws.close(4000, 'Heartbeat timeout');
        return;
      }
      ws.send(relayProtocol.createMessage(TMT.HEARTBEAT));
    }, config.agentHeartbeatInterval);

    ws.on('message', (data) => {
      const msg = relayProtocol.parseMessage(data);
      if (!msg) return;

      switch (msg.type) {
        case TMT.AGENT_AUTH:
          this._handleAuth(ws, msg, clientIp, (success, id, info) => {
            if (success) {
              nodeId = id;
              nodeInfo = info;
              authenticated = true;
              ws.send(relayProtocol.createMessage(TMT.AGENT_AUTH_RESULT, { success: true }));
              console.log(`[Tunnel Server] Node "${info.nodeName}" (ID: ${id}) authenticated from ${clientIp}`);
            } else {
              ws.send(relayProtocol.createMessage(TMT.AGENT_AUTH_RESULT, { success: false, error: 'Authentication failed' }));
            }
          });
          break;

        case TMT.FS_RESPONSE:
          if (!authenticated) return;
          this._handleResponse(msg);
          break;

        case TMT.HEARTBEAT_ACK:
          heartbeatMisses = 0;
          if (nodeId && connectedAgents.has(nodeId)) {
            const agent = connectedAgents.get(nodeId);
            agent.lastHeartbeat = Date.now();
            agent.status = 'online';
            connectedAgents.set(nodeId, agent);
          }
          break;

        case TMT.HEARTBEAT:
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(relayProtocol.createMessage(TMT.HEARTBEAT_ACK));
          }
          break;

        case TMT.ERROR:
          console.log(`[Tunnel Server] Error from node ${nodeId || 'unknown'}: ${msg.error}`);
          break;
      }
    });

    ws.on('close', (code, reason) => {
      clearInterval(hbTimer);
      if (nodeId) {
        const agent = connectedAgents.get(nodeId);
        if (agent) {
          agent.status = 'offline';
          agent.disconnectedAt = Date.now();
          agentStatus.set(nodeId, {
            nodeName: agent.nodeName,
            status: 'offline',
            lastSeen: agent.lastHeartbeat || agent.connectedAt,
            uptime: Math.floor((Date.now() - agent.connectedAt) / 1000)
          });
          connectedAgents.delete(nodeId);
        }
        this._rejectPendingForNode(nodeId, 'Node disconnected');
        console.log(`[Tunnel Server] Node "${nodeId}" disconnected: ${reason || 'unknown'}`);
      }
    });

    ws.on('error', (err) => {
      clearInterval(hbTimer);
      if (nodeId) {
        connectedAgents.delete(nodeId);
        this._rejectPendingForNode(nodeId, `Node connection error: ${err.message}`);
      }
    });
  }

  async _handleAuth(ws, msg, clientIp, callback) {
    try {
      const nodeId = parseInt(msg.nodeId);
      const lookupById = !isNaN(nodeId) && nodeId > 0;

      let node;
      if (lookupById) {
        node = await auth.getNodeInfo(nodeId);
      } else {
        const db = auth.getDb();
        node = await new Promise((resolve) => {
          db.get('SELECT id, name, node_secret FROM nodes WHERE name = ?', [msg.nodeId], (err, row) => {
            resolve(err ? null : row);
          });
        });
      }

      if (!node || node.node_secret !== msg.secret) {
        return callback(false, null, null);
      }

      if (connectedAgents.has(node.id)) {
        const existing = connectedAgents.get(node.id);
        try { existing.ws.close(4001, 'New connection replacing old'); } catch (e) {}
        connectedAgents.delete(node.id);
      }

      const agentInfo = {
        ws,
        nodeName: node.name,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        clientIp,
        status: 'online'
      };
      connectedAgents.set(node.id, agentInfo);
      agentStatus.delete(node.id);
      callback(true, node.id, agentInfo);
    } catch (err) {
      console.error(`[Tunnel Server] Auth error: ${err.message}`);
      callback(false, null, null);
    }
  }

  _handleResponse(msg) {
    const pending = pendingRequests.get(msg.reqId);
    if (!pending) return;

    pendingRequests.delete(msg.reqId);
    clearTimeout(pending.timeout);

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.data);
    }
  }

  _rejectPendingForNode(nodeId, reason) {
    for (const [reqId, pending] of pendingRequests) {
      if (pending.nodeId === nodeId) {
        pendingRequests.delete(reqId);
        clearTimeout(pending.timeout);
        pending.reject(new Error(reason));
      }
    }
  }

  _cleanupStaleRequests() {
    const now = Date.now();
    for (const [reqId, pending] of pendingRequests) {
      if (now > pending.deadline) {
        pendingRequests.delete(reqId);
        clearTimeout(pending.timeout);
        pending.reject(new Error('Request timed out'));
      }
    }
  }

  async sendRequest(nodeId, operation, params = {}) {
    const agent = connectedAgents.get(nodeId);
    if (!agent) {
      const status = agentStatus.get(nodeId);
      if (status) {
        throw new Error(`Node is offline (last seen ${Math.floor((Date.now() - status.lastSeen) / 1000)}s ago)`);
      }
      throw new Error('Node not connected to tunnel');
    }

    const ws = agent.ws;
    if (ws.readyState !== WebSocket.OPEN) {
      connectedAgents.delete(nodeId);
      throw new Error('Node tunnel connection is closed');
    }

    return new Promise((resolve, reject) => {
      const reqId = ++reqIdCounter;
      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.delete(reqId);
          reject(new Error(`Tunnel request timed out for operation: ${operation}`));
        }
      }, 60000);

      pendingRequests.set(reqId, {
        nodeId,
        resolve,
        reject,
        timeout,
        deadline: Date.now() + 60000
      });

      const msg = relayProtocol.createMessage(TMT.FS_REQUEST, {
        reqId,
        operation,
        ...params
      });

      try {
        ws.send(msg);
      } catch (err) {
        clearTimeout(timeout);
        pendingRequests.delete(reqId);
        reject(err);
      }
    });
  }

  async broadcastRequest(operation, params = {}) {
    const results = [];
    for (const [nodeId] of connectedAgents) {
      try {
        const result = await this.sendRequest(nodeId, operation, params);
        results.push({ nodeId, success: true, data: result });
      } catch (err) {
        results.push({ nodeId, success: false, error: err.message });
      }
    }
    return results;
  }

  getConnectedNodeIds() {
    return Array.from(connectedAgents.keys());
  }

  getNodeConnection(nodeId) {
    return connectedAgents.get(nodeId) || null;
  }

  isNodeConnected(nodeId) {
    const agent = connectedAgents.get(nodeId);
    return agent && agent.ws.readyState === WebSocket.OPEN;
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: config.tunnelPort,
      host: config.tunnelHost,
      path: config.tunnelPath,
      useTls: !!(config.tunnelTlsKey && config.tunnelTlsCert),
      connectedAgents: connectedAgents.size,
      agents: Array.from(connectedAgents.entries()).map(([id, info]) => ({
        nodeId: id,
        nodeName: info.nodeName,
        connectedAt: info.connectedAt,
        clientIp: info.clientIp,
        lastHeartbeat: info.lastHeartbeat,
        status: info.status,
        uptime: Math.floor((Date.now() - info.connectedAt) / 1000)
      })),
      recentOffline: Array.from(agentStatus.entries()).map(([id, info]) => ({
        nodeId: id,
        nodeName: info.nodeName,
        status: info.status,
        lastSeen: info.lastSeen,
        previousUptime: info.uptime
      }))
    };
  }

  stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    for (const [reqId, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Tunnel server shutting down'));
    }
    pendingRequests.clear();

    for (const [, agent] of connectedAgents) {
      try { agent.ws.close(4001, 'Server shutdown'); } catch (e) {}
    }
    connectedAgents.clear();
    agentStatus.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isRunning = false;
    tunnelServerInstance = null;
  }
}

function getTunnelServer() {
  return tunnelServerInstance;
}

module.exports = { TunnelServer, getTunnelServer, connectedAgents };
