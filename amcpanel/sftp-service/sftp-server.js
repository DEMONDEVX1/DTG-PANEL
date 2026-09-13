const { Server, utils } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const auth = require('./auth');
const networkDetector = require('./network-detector');
const { VirtualFileSystem } = require('./virtual-fs');

const STATUS_CODE = utils.sftp.STATUS_CODE;

const activeSessions = new Map();
let sessionCounter = 0;

class SftpServer {
  constructor() {
    this.server = null;
    this.hostKey = null;
  }

  async _ensureHostKey() {
    if (this.hostKey) {
      try {
        const { parseKey } = require('ssh2').utils;
        const result = parseKey(this.hostKey);
        if (!(result instanceof Error)) return this.hostKey;
      } catch (e) {}
    }

    const keyPath = config.hostKeyPath;
    if (fs.existsSync(keyPath)) {
      const existingKey = fs.readFileSync(keyPath, 'utf8');
      try {
        const { parseKey } = require('ssh2').utils;
        const result = parseKey(existingKey);
        if (!(result instanceof Error)) {
          this.hostKey = existingKey;
          return existingKey;
        }
        console.log(`[SFTP] Existing key at ${keyPath} is invalid, regenerating...`);
      } catch (e) {
        console.log(`[SFTP] Could not parse existing key, regenerating...`);
      }
    }

    const os = require('os');

    const { privateKey } = (() => {
      const { generateKeyPairSync } = require('crypto');
      return generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
      });
    })();

    fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    console.log(`[SFTP] Generated RSA host key at ${keyPath}`);
    this.hostKey = privateKey;
    return privateKey;
  }

  async start() {
    await this._ensureHostKey();

    return new Promise((resolve) => {
      this.server = new Server({
        hostKeys: [this.hostKey],
        identString: 'SSH-2.0-AMC_SFTP',
        banner: 'AMC PANEL SFTP Gateway',
        keepaliveInterval: config.keepaliveInterval,
        keepaliveCountMax: 10,
        maxConnections: config.maxConnections,
        // Increase internal SSH2 read/write window for large file transfers
        readStreamOptions: { highWaterMark: config.readHighWaterMark || 262144 },
        writeStreamOptions: { highWaterMark: config.writeHighWaterMark || 262144 }
      }, (client) => {
        // Tune underlying TCP socket for large file transfers
        const sock = client._sock || (client._conn && client._conn._sshstream && client._conn._sshstream.stream);
        if (sock && typeof sock.setNoDelay === 'function') {
          sock.setNoDelay(true);          // disable Nagle - reduce latency
          sock.setKeepAlive(true, 30000); // detect dead connections
        }
        this._handleClient(client);
      });

      // Listen on '::' with ipv6Only:false = dual-stack (IPv4 + IPv6 on all VPS types)
      const listenOpts = {
        port: config.port,
        host: config.host || '::',
        ipv6Only: false  // accept IPv4-mapped addresses too (e.g. ::ffff:1.2.3.4)
      };
      this.server.listen(listenOpts, () => {
        console.log(`[SFTP Server] Listening on :::${config.port} (IPv4 + IPv6 dual-stack)`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error(`[SFTP Server] Error: ${err.message}`);
        // Fallback: try IPv4-only if dual-stack fails (some VPS don't support IPv6)
        if (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') {
          console.log('[SFTP Server] Dual-stack failed, falling back to 0.0.0.0 (IPv4 only)...');
          this.server.listen({ port: config.port, host: '0.0.0.0' }, () => {
            console.log(`[SFTP Server] Listening on 0.0.0.0:${config.port} (IPv4 only fallback)`);
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  _handleClient(client) {
    const clientIp = client._conn && client._conn.remoteAddress ? client._conn.remoteAddress : 'unknown';
    let sessionData = null;
    let authAttempts = 0;

    const disconnectTimer = setTimeout(() => {
      if (!sessionData) {
        client.end();
      }
    }, config.idleTimeout);

    client.on('authentication', (ctx) => {
      authAttempts++;

      if (authAttempts > config.rateLimit.maxAuthAttempts) {
        ctx.reject(['password', 'publickey']);
        setTimeout(() => client.end(), 1000);
        return;
      }

      if (ctx.method === 'password') {
        const username = ctx.username;
        const password = ctx.password;

        auth.authenticateUser(username, password, clientIp).then(result => {
          if (result.success) {
            sessionData = {
              userId: result.user.id,
              username: result.user.username,
              role: result.user.role,
              authenticatedAt: Date.now(),
              vfs: null
            };
            ctx.accept();
          } else {
            ctx.reject(['password', 'publickey']);
          }
        }).catch(() => {
          ctx.reject(['password', 'publickey']);
        });
        return;
      }

      if (ctx.method === 'publickey') {
        const keyAlgo = ctx.key.algo;
        const keyBlob = ctx.key.data;
        const keyBlobB64 = keyBlob.toString('base64');

        if (!ctx.signature) {
          auth.findUserByPublicKey(keyAlgo, keyBlobB64).then(result => {
            if (result) {
              ctx.accept();
            } else {
              ctx.reject(['password', 'publickey']);
            }
        }).catch(() => {
          ctx.reject(['password', 'publickey']);
          });
          return;
        }

        auth.findUserByPublicKey(keyAlgo, keyBlobB64).then(async (result) => {
          if (!result) {
            return ctx.reject(['password', 'publickey']);
          }

          try {
            const { utils } = require('ssh2');
            const parsedKey = utils.parseKey(ctx.key.data);
            if (parsedKey instanceof Error) {
              return ctx.reject(['password', 'publickey']);
            }
            const verified = parsedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo);
            if (verified) {
              const userInfo = await auth.getUserServers(result.userId);
              sessionData = {
                userId: result.userId,
                username: ctx.username,
                role: 'user',
                authenticatedAt: Date.now(),
                vfs: null
              };
              ctx.accept();
            } else {
              ctx.reject(['password', 'publickey']);
            }
          } catch (e) {
            ctx.reject(['password', 'publickey']);
          }
        }).catch(() => {
          ctx.reject(['password', 'publickey']);
        });
        return;
      }

      ctx.reject(['password', 'publickey']);
    });

    client.on('ready', () => {
      if (!sessionData) {
        client.end();
        return;
      }

      clearTimeout(disconnectTimer);

      sessionData.vfs = new VirtualFileSystem(
        sessionData.userId,
        sessionData.username,
        sessionData.role
      );

      const sessionId = ++sessionCounter;
      activeSessions.set(sessionId, sessionData);

      console.log(`[SFTP] Session ${sessionId}: User "${sessionData.username}" connected from ${clientIp}`);

      client.on('session', (accept, reject) => {
        const session = accept();

        session.on('sftp', (accept, reject) => {
          const sftp = accept();
          if (!sftp) {
            reject && reject();
            return;
          }
          this._setupSftpHandlers(sftp, sessionData);
        });

        session.on('subsystem', (accept, reject, info) => {
          if (info.name !== 'sftp') {
            reject && reject();
          }
        });

        session.on('exec', (accept, reject, info) => {
          const stream = accept();
          stream.stderr.write('This SFTP service does not support shell access.\r\n');
          stream.exit(1);
          stream.end();
        });

        session.on('shell', (accept, reject) => {
          const stream = accept();
          stream.write('This is an SFTP-only gateway. Use an SFTP client to connect.\r\n');
          stream.exit(0);
          stream.end();
        });
      });

      client.on('close', () => {
        console.log(`[SFTP] Session ${sessionId}: User "${sessionData.username}" disconnected`);
        activeSessions.delete(sessionId);
      });

      client.on('error', (err) => {
        console.error(`[SFTP] Session ${sessionId} error: ${err.message}`);
      });
    });

    client.on('end', () => {
      clearTimeout(disconnectTimer);
    });
  }

  _setupSftpHandlers(sftp, sessionData) {
    const vfs = sessionData.vfs;
    let currentServerId = null;
    let realPathCache = '/';

    sftp.on('OPEN', async (reqid, filename, flags, attrs) => {
      try {
        const resolved = await vfs._resolvePath(filename);
        if (resolved.type === 'not_found') {
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }

        if (resolved.type === 'root' || resolved.type === 'server_root') {
          return sftp.status(reqid, STATUS_CODE.FAILURE, 'Cannot open directory as file');
        }

        const serverId = resolved.serverId;
        const relativePath = resolved.relativePath;

        const handle = await vfs.open(serverId, relativePath, flags);
        sftp.handle(reqid, handle);
      } catch (err) {
        if (err.code === 'ENOENT') {
          sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        } else {
          sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
        }
      }
    });

    sftp.on('READ', async (reqid, handle, offset, length) => {
      try {
        const handleStr = handle.toString('base64');
        const data = await vfs.read(handleStr, offset, length);
        sftp.data(reqid, data);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('WRITE', async (reqid, handle, offset, data) => {
      try {
        const handleStr = handle.toString('base64');
        await vfs.write(handleStr, offset, data);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    const dirReadState = new Map();

    sftp.on('OPENDIR', async (reqid, filename) => {
      try {
        const normalized = filename.replace(/\\/g, '/');
        const servers = await vfs._ensureServersLoaded();

        let handleStr;
        if (normalized === '/' || normalized === '') {
          currentServerId = null;
          realPathCache = '/';
          handleStr = 'dir_root_' + crypto.randomBytes(16).toString('hex');
        } else {
          const parts = normalized.split('/').filter(Boolean);
          const serverId = parseInt(parts[0]);
          const server = servers.find(s => s.id === serverId);
          if (!server) {
            return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          }
          currentServerId = serverId;
          realPathCache = normalized;
          handleStr = `dir_${serverId}_${crypto.randomBytes(16).toString('hex')}`;
        }

        dirReadState.set(handleStr, { read: false });
        sftp.handle(reqid, Buffer.from(handleStr));
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('READDIR', async (reqid, handle) => {
      try {
        const handleStr = handle.toString('utf8');
        const state = dirReadState.get(handleStr);

        if (!state) {
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }

        if (state.read) {
          dirReadState.delete(handleStr);
          return sftp.status(reqid, STATUS_CODE.EOF);
        }

        state.read = true;

        if (handleStr.startsWith('dir_root_')) {
          const entries = await vfs.readdir(null, '/');
          const sftpEntries = entries.map(e => ({
            filename: e.filename,
            longname: e._serverName ? `d${e._serverName}` : '',
            attrs: e.attrs
          }));
          sftp.name(reqid, sftpEntries);
          return;
        }

        const match = handleStr.match(/^dir_(\d+)_/);
        if (match) {
          const serverId = parseInt(match[1]);
          const entries = await vfs.readdir(serverId, '/');
          const sftpEntries = entries.map(e => ({
            filename: e.filename,
            longname: e.longname,
            attrs: e.attrs
          }));
          sftp.name(reqid, sftpEntries);
          return;
        }

        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('CLOSE', async (reqid, handle) => {
      try {
        const handleStr = handle.toString('utf8');
        if (handleStr.startsWith('dir_')) {
          dirReadState.delete(handleStr);
        }
        const realHandle = handle.toString('base64');
        await vfs.close(realHandle);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('MKDIR', async (reqid, path, attrs) => {
      try {
        const resolved = await vfs._resolvePath(path);
        if (resolved.type === 'not_found') {
          return sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid path');
        }
        await vfs.mkdir(resolved.serverId, resolved.relativePath);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('RMDIR', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);
        if (resolved.type === 'not_found') {
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }
        await vfs.rmdir(resolved.serverId, resolved.relativePath);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('REMOVE', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);
        if (resolved.type === 'not_found') {
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }
        await vfs.unlink(resolved.serverId, resolved.relativePath);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('RENAME', async (reqid, oldPath, newPath) => {
      try {
        const oldResolved = await vfs._resolvePath(oldPath);
        const newResolved = await vfs._resolvePath(newPath);

        if (oldResolved.type === 'not_found' || newResolved.type === 'not_found') {
          return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }

        if (oldResolved.serverId !== newResolved.serverId) {
          return sftp.status(reqid, STATUS_CODE.FAILURE, 'Cannot rename across servers');
        }

        await vfs.rename(oldResolved.serverId, oldResolved.relativePath, newResolved.relativePath);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('STAT', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);

        if (resolved.type === 'root') {
          sftp.attrs(reqid, {
            mode: 0o40755,
            size: 0,
            uid: 0,
            gid: 0,
            atime: Math.floor(Date.now() / 1000),
            mtime: Math.floor(Date.now() / 1000)
          });
          return;
        }

        if (resolved.type === 'server_root') {
          sftp.attrs(reqid, {
            mode: 0o40755,
            size: 0,
            uid: 0,
            gid: 0,
            atime: Math.floor(Date.now() / 1000),
            mtime: Math.floor(Date.now() / 1000)
          });
          return;
        }

        if (resolved.type === 'server_file') {
          const attrs = await vfs.stat(resolved.serverId, resolved.relativePath);
          if (!attrs) {
            return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          }
          sftp.attrs(reqid, attrs);
          return;
        }

        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      } catch (err) {
        if (err.code === 'ENOENT') {
          sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        } else {
          sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
        }
      }
    });

    sftp.on('LSTAT', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);

        if (resolved.type === 'root' || resolved.type === 'server_root') {
          sftp.attrs(reqid, {
            mode: 0o40755, size: 0, uid: 0, gid: 0,
            atime: Math.floor(Date.now() / 1000),
            mtime: Math.floor(Date.now() / 1000)
          });
          return;
        }

        if (resolved.type === 'server_file') {
          const attrs = await vfs.stat(resolved.serverId, resolved.relativePath, false);
          if (!attrs) {
            return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          }
          sftp.attrs(reqid, attrs);
          return;
        }

        sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      } catch (err) {
        if (err.code === 'ENOENT') {
          sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        } else {
          sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
        }
      }
    });

    sftp.on('REALPATH', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);

        if (resolved.type === 'root') {
          return sftp.name(reqid, [{ filename: '/', longname: 'root', attrs: {} }]);
        }

        if (resolved.type === 'server_root') {
          return sftp.name(reqid, [{ filename: `/${resolved.serverId}`, longname: '', attrs: {} }]);
        }

        if (resolved.type === 'server_file') {
          const rel = path.replace(/^\/(\d+)/, '');
          const real = await vfs.realpath(resolved.serverId, rel || '/');
          return sftp.name(reqid, [{ filename: `/${resolved.serverId}${real}`, longname: '', attrs: {} }]);
        }

        sftp.name(reqid, [{ filename: path, longname: '', attrs: {} }]);
      } catch (err) {
        sftp.name(reqid, [{ filename: path, longname: '', attrs: {} }]);
      }
    });

    sftp.on('FSETSTAT', async (reqid, handle, attrs) => {
      sftp.status(reqid, STATUS_CODE.OK);
    });

    sftp.on('SETSTAT', async (reqid, path, attrs) => {
      sftp.status(reqid, STATUS_CODE.OK);
    });

    sftp.on('READLINK', async (reqid, path) => {
      try {
        const resolved = await vfs._resolvePath(path);
        if (resolved.type === 'server_file') {
          const basePath = path.join(config.serversDir, String(resolved.serverId));
          const fullPath = path.resolve(basePath, '.' + resolved.relativePath);
          const linkTarget = fs.readlinkSync(fullPath);
          sftp.name(reqid, [{ filename: linkTarget, longname: '', attrs: {} }]);
        } else {
          sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        }
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });

    sftp.on('SYMLINK', async (reqid, linkPath, targetPath) => {
      try {
        const resolved = await vfs._resolvePath(linkPath);
        if (resolved.type === 'server_file') {
          const basePath = path.join(config.serversDir, String(resolved.serverId));
          const fullLinkPath = path.resolve(basePath, '.' + resolved.relativePath);
          fs.symlinkSync(targetPath, fullLinkPath);
          sftp.status(reqid, STATUS_CODE.OK);
        } else {
          sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid path');
        }
      } catch (err) {
        sftp.status(reqid, STATUS_CODE.FAILURE, err.message);
      }
    });
  }

  getStatus() {
    return {
      running: this.server !== null && this.server !== undefined,
      listening: this.server ? this.server.listening : false,
      port: config.port,
      host: config.host,
      activeSessions: activeSessions.size,
      maxConnections: config.maxConnections,
      sessions: Array.from(activeSessions.entries()).map(([id, data]) => ({
        id,
        username: data.username,
        connectedAt: data.authenticatedAt,
        uptime: Math.floor((Date.now() - data.authenticatedAt) / 1000)
      }))
    };
  }

  stop() {
    for (const [, data] of activeSessions) {
      try { /* cleanup */ } catch (e) {}
    }
    activeSessions.clear();

    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { SftpServer, activeSessions };
