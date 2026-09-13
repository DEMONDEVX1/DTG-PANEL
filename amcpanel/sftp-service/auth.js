const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config');

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(config.dbPath);
  }
  return db;
}

const authAttempts = new Map();

function recordAuthAttempt(username, ip, success) {
  const key = `${username}:${ip}`;
  const now = Date.now();
  const attempts = authAttempts.get(key) || { count: 0, firstAttempt: now, banned: false, banTime: 0 };

  if (success) {
    authAttempts.delete(key);
    return;
  }

  attempts.count++;
  if (attempts.count === 1) attempts.firstAttempt = now;

  if (attempts.count >= config.rateLimit.maxAuthAttempts) {
    attempts.banned = true;
    attempts.banTime = now;
  }

  authAttempts.set(key, attempts);
}

function isBanned(username, ip) {
  const key = `${username}:${ip}`;
  const record = authAttempts.get(key);
  if (!record || !record.banned) return false;
  if (Date.now() - record.banTime > config.rateLimit.authBanTime) {
    authAttempts.delete(key);
    return false;
  }
  return true;
}

function cleanupOldAttempts() {
  const now = Date.now();
  for (const [key, record] of authAttempts) {
    if (now - record.firstAttempt > 600000) {
      authAttempts.delete(key);
    }
  }
}

setInterval(cleanupOldAttempts, 300000);

async function authenticateUser(username, password, ip) {
  const db = getDb();

  if (isBanned(username, ip)) {
    return { success: false, error: 'Too many failed attempts. Try again later.' };
  }

  return new Promise((resolve) => {
    db.get(
      'SELECT id, username, password, role, status FROM users WHERE username = ? OR email = ?',
      [username, username],
      (err, user) => {
        if (err || !user) {
          recordAuthAttempt(username, ip, false);
          return resolve({ success: false, error: 'Invalid credentials' });
        }

        if (user.status !== 'active') {
          return resolve({ success: false, error: 'Account is suspended' });
        }

        bcrypt.compare(password, user.password, (err, match) => {
          if (err || !match) {
            recordAuthAttempt(username, ip, false);
            return resolve({ success: false, error: 'Invalid credentials' });
          }

          recordAuthAttempt(username, ip, true);
          resolve({
            success: true,
            user: {
              id: user.id,
              username: user.username,
              role: user.role
            }
          });
        });
      }
    );
  });
}

async function getUserServers(userId) {
  const db = getDb();
  return new Promise((resolve) => {
    db.all(
      `SELECT s.id, s.name, s.node_id, n.name as node_name, n.ip as node_ip, 
              n.public_ip, n.status as node_status, s.status as server_status
       FROM servers s
       LEFT JOIN nodes n ON s.node_id = n.id
       WHERE s.owner_id = ? OR s.id IN (
         SELECT server_id FROM subusers WHERE user_id = ?
       )`,
      [userId, userId],
      (err, rows) => {
        if (err) {
          db.all(
            'SELECT s.id, s.name, s.node_id, s.status as server_status FROM servers s WHERE s.owner_id = ?',
            [userId],
            (err2, rows2) => resolve(rows2 || [])
          );
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

async function isServerAccessible(userId, serverId) {
  const db = getDb();
  return new Promise((resolve) => {
    db.get(
      `SELECT id FROM servers WHERE id = ? AND (owner_id = ? OR id IN (
        SELECT server_id FROM subusers WHERE user_id = ?
      ))`,
      [serverId, userId, userId],
      (err, row) => resolve(!!row)
    );
  });
}

async function getNodeInfo(nodeId) {
  const db = getDb();
  return new Promise((resolve) => {
    db.get(
      'SELECT * FROM nodes WHERE id = ?',
      [nodeId],
      (err, row) => resolve(row || null)
    );
  });
}

function generateSessionToken(userId, username) {
  const payload = `${userId}:${username}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function getUserPublicKeys(userId) {
  const db = getDb();
  return new Promise((resolve) => {
    db.all(
      'SELECT id, key_type, public_key, fingerprint, comment, created_at FROM user_ssh_keys WHERE user_id = ?',
      [userId],
      (err, rows) => resolve(rows || [])
    );
  });
}

async function findUserByPublicKey(keyAlgo, keyBlobB64) {
  const db = getDb();
  return new Promise((resolve) => {
    db.all('SELECT user_id, public_key FROM user_ssh_keys', [], (err, rows) => {
      if (err || !rows) return resolve(null);
      for (const row of rows) {
        try {
          const storedParts = row.public_key.split(' ');
          const storedB64 = storedParts.length >= 2 ? storedParts[1] : row.public_key;
          if (storedB64 === keyBlobB64) {
            return resolve({ userId: row.user_id });
          }
        } catch (e) {}
      }
      resolve(null);
    });
  });
}

async function addUserPublicKey(userId, keyType, publicKey, comment) {
  const db = getDb();

  let fingerprint;
  try {
    const crypto = require('crypto');
    const rawKey = Buffer.from(publicKey.split(' ')[1] || publicKey, 'base64');
    const hash = crypto.createHash('sha256').update(rawKey).digest('base64');
    fingerprint = `SHA256:${hash}`;
  } catch (e) {
    fingerprint = 'unknown';
  }

  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO user_ssh_keys (user_id, key_type, public_key, fingerprint, comment) VALUES (?, ?, ?, ?, ?)',
      [userId, keyType, publicKey, fingerprint, comment || ''],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, fingerprint });
      }
    );
  });
}

async function removeUserPublicKey(keyId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM user_ssh_keys WHERE id = ?', [keyId], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

module.exports = {
  authenticateUser,
  getUserServers,
  isServerAccessible,
  getNodeInfo,
  generateSessionToken,
  getDb,
  getUserPublicKeys,
  findUserByPublicKey,
  addUserPublicKey,
  removeUserPublicKey
};
