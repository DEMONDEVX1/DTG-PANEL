const { getTunnelServer } = require('./tunnel-server');

class NodeFsProxy {
  constructor(nodeId, serverId) {
    this.nodeId = nodeId;
    this.serverId = serverId;
  }

  async _send(operation, params = {}) {
    const tunnel = getTunnelServer();
    if (!tunnel) {
      throw new Error('Tunnel server not running');
    }
    return tunnel.sendRequest(this.nodeId, operation, { serverId: this.serverId, ...params });
  }

  async open(filePath, flags) {
    const result = await this._send('open', { path: filePath, flags });
    return result.handle;
  }

  async read(handle, offset, length) {
    const result = await this._send('read', { handle, offset, length });
    return Buffer.from(result, 'base64');
  }

  async write(handle, offset, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = await this._send('write', {
      handle,
      offset,
      data: buf.toString('base64')
    });
    return result;
  }

  async close(handle) {
    await this._send('close', { handle });
  }

  async opendir(dirPath) {
    const result = await this._send('opendir', { path: dirPath });
    return result.handle;
  }

  async readdir(handle) {
    return this._send('readdir', { handle });
  }

  async mkdir(dirPath) {
    return this._send('mkdir', { path: dirPath });
  }

  async rmdir(dirPath) {
    return this._send('rmdir', { path: dirPath });
  }

  async unlink(filePath) {
    return this._send('unlink', { path: filePath });
  }

  async rename(oldPath, newPath) {
    return this._send('rename', { oldPath, newPath });
  }

  async stat(filePath, followSymlink = true) {
    return this._send(followSymlink ? 'stat' : 'lstat', { path: filePath });
  }

  async realpath(filePath) {
    return this._send('realpath', { path: filePath });
  }
}

module.exports = { NodeFsProxy };
