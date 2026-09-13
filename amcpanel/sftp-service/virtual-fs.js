const path = require('path');
const fs = require('fs');
const config = require('./config');
const auth = require('./auth');
const { getTunnelServer } = require('./tunnel-server');
const { NodeFsProxy } = require('./node-fs-proxy');

const openHandles = new Map();
let handleCounter = 0;

function getNextHandle() {
  handleCounter++;
  return Buffer.from(`handle_${handleCounter}_${Date.now()}`);
}

class VirtualFileSystem {
  constructor(userId, username, userRole) {
    this.userId = userId;
    this.username = username;
    this.userRole = userRole;
    this.serverCache = null;
  }

  async _ensureServersLoaded() {
    if (!this.serverCache) {
      this.serverCache = await auth.getUserServers(this.userId);
    }
    return this.serverCache;
  }

  async _resolvePath(sftpPath) {
    const servers = await this._ensureServersLoaded();
    const normalized = path.normalize('/' + sftpPath.replace(/\\/g, '/')).replace(/\\/g, '/');

    if (normalized === '/' || normalized === '') {
      return { type: 'root', path: '/', servers };
    }

    const parts = normalized.split('/').filter(Boolean);

    if (parts.length === 1) {
      const serverId = parseInt(parts[0]);
      const server = servers.find(s => s.id === serverId);
      if (server) {
        return { type: 'server_root', server, relativePath: '/', serverId: server.id };
      }
      return { type: 'not_found' };
    }

    const serverId = parseInt(parts[0]);
    const server = servers.find(s => s.id === serverId);
    if (!server) return { type: 'not_found' };

    const relativePath = '/' + parts.slice(1).join('/');
    return { type: 'server_file', server, relativePath, serverId: server.id };
  }

  async _getNodeFsProxy(server) {
    if (!server.node_id) return null;

    const tunnel = getTunnelServer();
    if (!tunnel) return null;

    if (tunnel.isNodeConnected(server.node_id)) {
      return new NodeFsProxy(server.node_id, server.id);
    }

    return null;
  }

  _isLocalServer(serverId) {
    const localPath = this._getLocalPath(serverId, '');
    return fs.existsSync(localPath);
  }

  _getLocalPath(serverId, relativePath) {
    return path.join(config.serversDir, String(serverId), relativePath || '');
  }

  _ensurePathSecure(basePath, requestedPath) {
    const resolved = path.resolve(basePath, '.' + requestedPath);
    if (!resolved.startsWith(basePath)) {
      throw new Error('Permission denied: path traversal detected');
    }
    return resolved;
  }

  async open(serverId, filePath, flags) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      return this._openLocal(serverId, filePath, flags);
    }

    const proxy = await this._getNodeFsProxy(server);
    if (proxy) {
      return this._openViaProxy(proxy, filePath, flags);
    }

    throw new Error('Server is not accessible: node is offline or missing');
  }

  _openLocal(serverId, filePath, flags) {
    const basePath = this._getLocalPath(serverId, '');
    const fullPath = this._ensurePathSecure(basePath, filePath || '/');

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
      const handle = getNextHandle();
      openHandles.set(handle.toString('base64'), { type: 'local', fd, serverId, filePath });
      return handle;
    } catch (err) {
      if (err.code === 'ENOENT' && creat) {
        fs.writeFileSync(fullPath, '');
        const fd = fs.openSync(fullPath, openFlags);
        const handle = getNextHandle();
        openHandles.set(handle.toString('base64'), { type: 'local', fd, serverId, filePath });
        return handle;
      }
      throw err;
    }
  }

  async _openViaProxy(proxy, filePath, flags) {
    const handleStr = await proxy.open(filePath, flags);
    const handle = Buffer.from(handleStr);
    openHandles.set(handle.toString('base64'), { type: 'tunnel', proxy, handle: handleStr, filePath });
    return handle;
  }

  async read(handleStr, offset, length) {
    const entry = openHandles.get(handleStr);
    if (!entry) throw new Error('Invalid handle');

    if (entry.type === 'local') {
      const buffer = Buffer.allocUnsafe(length);
      return new Promise((resolve, reject) => {
        fs.read(entry.fd, buffer, 0, length, offset, (err, bytesRead) => {
          if (err) return reject(err);
          resolve(buffer.slice(0, bytesRead));
        });
      });
    }

    if (entry.type === 'tunnel') {
      return entry.proxy.read(entry.handle, offset, length);
    }

    throw new Error('Unknown handle type');
  }

  async write(handleStr, offset, data) {
    const entry = openHandles.get(handleStr);
    if (!entry) throw new Error('Invalid handle');

    if (entry.type === 'local') {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      return new Promise((resolve, reject) => {
        fs.write(entry.fd, buffer, 0, buffer.length, offset, (err, bytesWritten) => {
          if (err) return reject(err);
          resolve(bytesWritten);
        });
      });
    }

    if (entry.type === 'tunnel') {
      return entry.proxy.write(entry.handle, offset, data);
    }

    throw new Error('Unknown handle type');
  }

  async close(handleStr) {
    const entry = openHandles.get(handleStr);
    if (!entry) return;

    if (entry.type === 'local') {
      await new Promise((resolve) => {
        fs.close(entry.fd, (err) => {
          if (err) console.warn('[VFS] close fd error:', err.message);
          resolve();
        });
      });
    } else if (entry.type === 'tunnel') {
      try { await entry.proxy.close(entry.handle); } catch (e) {}
    }

    openHandles.delete(handleStr);
  }

  async stat(serverId, filePath, followSymlink = true) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullPath = this._ensurePathSecure(basePath, filePath || '/');
      try {
        const stats = followSymlink ? fs.statSync(fullPath) : fs.lstatSync(fullPath);
        return {
          mode: stats.isDirectory() ? 0o40755 : stats.isFile() ? 0o100644 : 0o120777,
          size: stats.size,
          uid: 0, gid: 0,
          atime: Math.floor(stats.atimeMs / 1000),
          mtime: Math.floor(stats.mtimeMs / 1000),
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile()
        };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.stat(filePath || '/', followSymlink);
  }

  async readdir(serverId, dirPath) {
    const servers = await this._ensureServersLoaded();

    if (!serverId) {
      return servers.map(s => ({
        filename: String(s.id),
        longname: `d${s.name}`,
        attrs: {
          mode: 0o40755,
          size: 0,
          atime: Math.floor(Date.now() / 1000),
          mtime: Math.floor(Date.now() / 1000)
        },
        _serverName: s.name,
        _serverStatus: s.server_status
      }));
    }

    const server = servers.find(s => s.id === serverId);
    if (!server) {
      return servers.map(s => ({
        filename: String(s.id),
        longname: `d${s.name}`,
        attrs: { mode: 0o40755, size: 0, atime: 0, mtime: 0 },
        _serverName: s.name
      }));
    }

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const dirFullPath = this._ensurePathSecure(basePath, dirPath || '/');
      try {
        const entries = fs.readdirSync(dirFullPath, { withFileTypes: true });
        return entries.map(entry => {
          let stat;
          try {
            stat = fs.statSync(path.join(dirFullPath, entry.name));
          } catch (e) {
            stat = { size: 0, mode: 0o644, mtime: new Date(), isDirectory: () => entry.isDirectory() };
          }
          return {
            filename: entry.name,
            longname: '',
            attrs: {
              mode: entry.isDirectory() ? 0o40755 : 0o100644,
              size: stat.size,
              atime: Math.floor((stat.atime || new Date()).getTime() / 1000),
              mtime: Math.floor((stat.mtime || new Date()).getTime() / 1000)
            }
          };
        });
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    const dirHandle = await proxy.opendir(dirPath || '/');
    const entries = await proxy.readdir(dirHandle);
    await proxy.close(dirHandle);
    return entries;
  }

  async mkdir(serverId, dirPath) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullPath = this._ensurePathSecure(basePath, dirPath || '');
      fs.mkdirSync(fullPath, { recursive: true });
      return true;
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.mkdir(dirPath || '/');
  }

  async rmdir(serverId, dirPath) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullPath = this._ensurePathSecure(basePath, dirPath || '');
      fs.rmdirSync(fullPath);
      return true;
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.rmdir(dirPath || '/');
  }

  async unlink(serverId, filePath) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullPath = this._ensurePathSecure(basePath, filePath || '');
      fs.unlinkSync(fullPath);
      return true;
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.unlink(filePath || '/');
  }

  async rename(serverId, oldPath, newPath) {
    const servers = await this._ensureServersLoaded();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullOldPath = this._ensurePathSecure(basePath, oldPath || '');
      const fullNewPath = this._ensurePathSecure(basePath, newPath || '');
      fs.renameSync(fullOldPath, fullNewPath);
      return true;
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.rename(oldPath || '/', newPath || '/');
  }

  async realpath(serverId, filePath) {
    const servers = await this._ensureServersLoaded();

    if (!serverId) {
      const match = filePath.match(/^\/(\d+)/);
      if (match) {
        const sid = parseInt(match[1]);
        if (servers.find(s => s.id === sid)) {
          return `/${sid}`;
        }
      }
      return '/';
    }

    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    if (this._isLocalServer(serverId)) {
      const basePath = this._getLocalPath(serverId, '');
      const fullPath = this._ensurePathSecure(basePath, filePath || '/');
      const real = path.resolve(fullPath);
      return real.replace(basePath, '') || '/';
    }

    const proxy = await this._getNodeFsProxy(server);
    if (!proxy) throw new Error('Server is not accessible: node is offline or missing');
    return proxy.realpath(filePath || '/');
  }
}

function cleanupStaleHandles() {
  for (const [key, entry] of openHandles) {
    if (entry.type === 'local') {
      try { fs.closeSync(entry.fd); } catch (e) {}
    }
    openHandles.delete(key);
  }
}

setInterval(cleanupStaleHandles, 300000);

module.exports = { VirtualFileSystem, cleanupStaleHandles };
