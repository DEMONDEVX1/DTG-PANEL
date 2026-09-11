const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const relayProtocol = require('./tunnel-protocol');
const { TUNNEL_MESSAGE_TYPES: TMT } = relayProtocol;

class TunnelAgent {
  constructor(opts = {}) {
    this.panelUrl = opts.panelUrl || 'ws://127.0.0.1:2224';
    this.nodeId = opts.nodeId || null;
    this.nodeName = opts.nodeName || 'unknown';
    this.nodeSecret = opts.nodeSecret || '';
    this.serverDir = opts.serverDir || path.join(process.cwd(), 'servers');
    this.reconnectBaseDelay = opts.reconnectBaseDelay || 1000;
    this.reconnectMaxDelay = opts.reconnectMaxDelay || 60000;
    this.heartbeatInterval = opts.heartbeatInterval || 30000;
    this.dialTimeout = opts.dialTimeout || 10000;

    this.ws = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._reconnectAttempt = 0;
    this._closing = false;
    this._handles = new Map();
    this._pendingAuth = null;
  }

  async connect() {
    if (this._closing) return;
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    const wsUrl = this.panelUrl.endsWith('/')
      ? this.panelUrl.slice(0, -1)
      : this.panelUrl;

    return new Promise((resolve, reject) => {
      this._pendingAuth = { resolve, reject };

      try {
        this.ws = new WebSocket(wsUrl, {
          rejectUnauthorized: false,
          handshakeTimeout: this.dialTimeout
        });
      } catch (err) {
        this._pendingAuth = null;
        reject(err);
        return;
      }

      const dialTimeout = setTimeout(() => {
        if (!this.isAuthenticated && this._pendingAuth) {
          const p = this._pendingAuth;
          this._pendingAuth = null;
          p.reject(new Error('Tunnel agent connection timeout'));
          this.ws.close();
        }
      }, this.dialTimeout + 5000);

      this.ws.on('open', () => {
        this.isConnected = true;
        this._reconnectAttempt = 0;
        const authMsg = {
          type: TMT.AGENT_AUTH,
          nodeId: this.nodeId,
          secret: this.nodeSecret,
          nodeName: this.nodeName
        };
        this.ws.send(JSON.stringify(authMsg));
      });

      this.ws.on('message', (data) => {
        this._handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(dialTimeout);
        this.isConnected = false;
        this.isAuthenticated = false;
        if (this._heartbeatTimer) {
          clearInterval(this._heartbeatTimer);
          this._heartbeatTimer = null;
        }
        if (!this._closing) {
          this._scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(dialTimeout);
        if (this._pendingAuth) {
          const p = this._pendingAuth;
          this._pendingAuth = null;
          p.reject(err);
        }
        this.isConnected = false;
        this.isAuthenticated = false;
      });
    });
  }

  _handleMessage(data) {
    const msg = relayProtocol.parseMessage(data);
    if (!msg) return;

    switch (msg.type) {
      case TMT.AGENT_AUTH_RESULT:
        if (this._pendingAuth) {
          const p = this._pendingAuth;
          this._pendingAuth = null;
          if (msg.success) {
            this.isAuthenticated = true;
            this._startHeartbeat();
            p.resolve(this);
          } else {
            p.reject(new Error(msg.error || 'Authentication failed'));
          }
        }
        break;

      case TMT.FS_REQUEST:
        this._handleFsRequest(msg);
        break;

      case TMT.HEARTBEAT:
        this._send({ type: TMT.HEARTBEAT_ACK });
        break;

      case TMT.HEARTBEAT_ACK:
        break;

      case TMT.ERROR:
        console.log(`[Tunnel Agent] Server error: ${msg.error}`);
        break;
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _sendResponse(reqId, data, error) {
    this._send({
      type: TMT.FS_RESPONSE,
      reqId,
      data: data !== undefined ? data : null,
      error: error || null
    });
  }

  async _handleFsRequest(msg) {
    const { reqId, operation, serverId, path: filePath } = msg;

    try {
      let data;
      switch (operation) {
        case 'open':
          data = await this._handleOpen(serverId, filePath, msg.flags);
          break;
        case 'read':
          data = await this._handleRead(msg.handle, msg.offset, msg.length);
          break;
        case 'write':
          data = await this._handleWrite(msg.handle, msg.offset, msg.data);
          break;
        case 'close':
          data = await this._handleClose(msg.handle, serverId);
          break;
        case 'opendir':
          data = await this._handleOpendir(serverId, filePath);
          break;
        case 'readdir':
          data = await this._handleReaddir(msg.handle);
          break;
        case 'mkdir':
          data = await this._handleMkdir(serverId, filePath);
          break;
        case 'rmdir':
          data = await this._handleRmdir(serverId, filePath);
          break;
        case 'unlink':
          data = await this._handleUnlink(serverId, filePath);
          break;
        case 'rename':
          data = await this._handleRename(serverId, msg.oldPath, msg.newPath);
          break;
        case 'stat':
        case 'lstat':
          data = await this._handleStat(serverId, filePath, operation === 'lstat');
          break;
        case 'realpath':
          data = await this._handleRealpath(serverId, filePath);
          break;
        default:
          return this._sendResponse(reqId, null, `Unknown operation: ${operation}`);
      }
      this._sendResponse(reqId, data);
    } catch (err) {
      this._sendResponse(reqId, null, err.message);
    }
  }

  _resolveNodePath(serverId, relativePath) {
    const baseDir = path.resolve(this.serverDir, String(serverId));
    const resolved = path.resolve(baseDir, '.' + (relativePath || '/'));
    if (!resolved.startsWith(baseDir)) {
      throw new Error('Permission denied: path traversal detected');
    }
    return resolved;
  }

  _handleOpen(serverId, filePath, flags) {
    const fullPath = this._resolveNodePath(serverId, filePath);

    const O_RDONLY = 0x00000001;
    const O_WRONLY = 0x00000002;
    const O_APPEND = 0x00000004;
    const O_CREAT = 0x00000008;
    const O_TRUNC = 0x00000010;
    const O_EXCL = 0x00000020;

    let openFlags = 'r';
    const read = !!(flags & O_RDONLY);
    const write = !!(flags & O_WRONLY);
    const creat = !!(flags & O_CREAT);
    const trunc = !!(flags & O_TRUNC);
    const excl = !!(flags & O_EXCL);
    const append = !!(flags & O_APPEND);

    if (append) {
      openFlags = 'a';
      if (read) openFlags = 'a+';
    } else if (read && write && creat && trunc) {
      openFlags = 'w+';
    } else if (write && creat && trunc) {
      openFlags = 'w';
    } else if (read && write && creat) {
      openFlags = excl ? 'wx+' : 'w+';
    } else if (write && creat) {
      openFlags = excl ? 'wx' : 'w';
    } else if (read && write) {
      openFlags = 'r+';
    } else if (write) {
      openFlags = 'w';
    }

    try {
      const fd = fs.openSync(fullPath, openFlags);
      const handle = crypto.randomBytes(16).toString('hex');
      this._handles.set(handle, { fd, filePath, serverId });
      return { handle };
    } catch (err) {
      if (err.code === 'ENOENT' && creat) {
        fs.writeFileSync(fullPath, '');
        const fd = fs.openSync(fullPath, openFlags);
        const handle = crypto.randomBytes(16).toString('hex');
        this._handles.set(handle, { fd, filePath, serverId });
        return { handle };
      }
      throw err;
    }
  }

  _handleRead(handle, offset, length) {
    const entry = this._handles.get(handle);
    if (!entry) throw new Error('Invalid handle');
    const buf = Buffer.alloc(length || 65536);
    const bytesRead = fs.readSync(entry.fd, buf, 0, buf.length, offset || 0);
    return buf.slice(0, bytesRead).toString('base64');
  }

  _handleWrite(handle, offset, data) {
    const entry = this._handles.get(handle);
    if (!entry) throw new Error('Invalid handle');
    const buf = Buffer.from(data, 'base64');
    const bytesWritten = fs.writeSync(entry.fd, buf, 0, buf.length, offset || 0);
    return bytesWritten;
  }

  _handleClose(handle, serverId) {
    const entry = this._handles.get(handle);
    if (entry) {
      try { fs.closeSync(entry.fd); } catch (e) {}
      this._handles.delete(handle);
    }
    return true;
  }

  _handleOpendir(serverId, dirPath) {
    const fullPath = this._resolveNodePath(serverId, dirPath);
    if (!fs.existsSync(fullPath)) throw new Error('ENOENT: directory not found');
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) throw new Error('Not a directory');
    const handle = crypto.randomBytes(16).toString('hex');
    this._handles.set(handle, { type: 'dir', dirPath: fullPath, serverId });
    return { handle };
  }

  _handleReaddir(handle) {
    const entry = this._handles.get(handle);
    if (!entry || entry.type !== 'dir') throw new Error('Invalid directory handle');
    const entries = fs.readdirSync(entry.dirPath, { withFileTypes: true });
    return entries.map(e => {
      let st;
      try {
        st = fs.statSync(path.join(entry.dirPath, e.name));
      } catch (ex) {
        st = { size: 0, mtime: new Date(), atime: new Date() };
      }
      return {
        filename: e.name,
        longname: '',
        attrs: {
          mode: e.isDirectory() ? 0o40755 : 0o100644,
          size: st.size,
          atime: Math.floor((st.atime || new Date()).getTime() / 1000),
          mtime: Math.floor((st.mtime || new Date()).getTime() / 1000)
        }
      };
    });
  }

  _handleMkdir(serverId, dirPath) {
    const fullPath = this._resolveNodePath(serverId, dirPath);
    const baseDir = path.resolve(this.serverDir, String(serverId));
    if (!fullPath.startsWith(baseDir)) {
      throw new Error('Permission denied');
    }
    fs.mkdirSync(fullPath, { recursive: true });
    return true;
  }

  _handleRmdir(serverId, dirPath) {
    const fullPath = this._resolveNodePath(serverId, dirPath);
    fs.rmdirSync(fullPath);
    return true;
  }

  _handleUnlink(serverId, filePath) {
    const fullPath = this._resolveNodePath(serverId, filePath);
    fs.unlinkSync(fullPath);
    return true;
  }

  _handleRename(serverId, oldPath, newPath) {
    const baseDir = path.resolve(this.serverDir, String(serverId));
    const fullOldPath = path.resolve(baseDir, '.' + (oldPath || ''));
    const fullNewPath = path.resolve(baseDir, '.' + (newPath || ''));
    if (!fullOldPath.startsWith(baseDir) || !fullNewPath.startsWith(baseDir)) {
      throw new Error('Permission denied');
    }
    fs.renameSync(fullOldPath, fullNewPath);
    return true;
  }

  _handleStat(serverId, filePath, followSymlink) {
    const fullPath = this._resolveNodePath(serverId, filePath);
    try {
      const stats = followSymlink ? fs.statSync(fullPath) : fs.lstatSync(fullPath);
      return {
        mode: stats.isDirectory() ? 0o40755 : stats.isFile() ? 0o100644 : 0o120777,
        size: stats.size,
        uid: 0,
        gid: 0,
        atime: Math.floor(stats.atimeMs / 1000),
        mtime: Math.floor(stats.mtimeMs / 1000)
      };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  _handleRealpath(serverId, filePath) {
    const fullPath = this._resolveNodePath(serverId, filePath);
    const baseDir = path.resolve(this.serverDir, String(serverId));
    const real = path.resolve(fullPath);
    const rel = real.replace(baseDir, '');
    return rel || '/';
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
  }

  _scheduleReconnect() {
    if (this._closing) return;

    this._reconnectAttempt++;
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, Math.min(this._reconnectAttempt - 1, 6)),
      this.reconnectMaxDelay
    );
    const jitter = Math.random() * 1000;
    const totalDelay = delay + jitter;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    this._reconnectTimer = setTimeout(() => {
      if (this._closing) return;
      console.log(`[Tunnel Agent] Reconnecting (attempt ${this._reconnectAttempt})...`);
      this.connect().catch((err) => {
        console.log(`[Tunnel Agent] Reconnect failed: ${err.message}`);
      });
    }, totalDelay);
  }

  disconnect() {
    this._closing = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    for (const [, entry] of this._handles) {
      if (entry.fd) try { fs.closeSync(entry.fd); } catch (e) {}
    }
    this._handles.clear();
    if (this.ws) {
      try { this.ws.close(1000, 'Agent shutdown'); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isAuthenticated = false;
  }
}

module.exports = { TunnelAgent };
