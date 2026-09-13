const crypto = require('crypto');

// In-memory token store
const tokenStore = new Map();

// Active SFTP sessions per user+server (survives token expiry for display purposes)
// key: `${userId}:${serverId}` → { host, port, path, connectedAt }
const activeSessions = new Map();

// Rate limiting map per userId (max 10 token generations per 5 minutes)
const rateLimits = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const userLogs = rateLimits.get(userId) || [];
  const validLogs = userLogs.filter(ts => now - ts < 5 * 60 * 1000);
  rateLimits.set(userId, validLogs);
  if (validLogs.length >= 10) return true;
  validLogs.push(now);
  return false;
}

function isTailscaleIp(ip) {
  if (!ip) return false;
  const cleanIp = ip.replace(/^::ffff:/, '').trim();
  // Tailscale CGNAT range: 100.64.0.0 to 100.127.255.255
  if (cleanIp.startsWith('100.')) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
      return true;
    }
  }
  return false;
}

function generateToken(userId, serverId, ttlMinutes = 15) {
  if (isRateLimited(userId)) {
    throw new Error('Rate limit exceeded. Please wait a few minutes before generating a new link.');
  }

  // Revoke any existing pending tokens for this user & server
  for (const [t, data] of tokenStore.entries()) {
    if (data.userId === userId && data.serverId == serverId && data.status === 'pending') {
      data.status = 'revoked';
    }
  }

  // Generate 32-char hex token (128 bits entropy)
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + ttlMinutes * 60 * 1000;

  const tokenData = {
    token,
    userId,
    serverId: parseInt(serverId, 10),
    createdAt: now,
    expiresAt,
    status: 'pending',  // 'pending' | 'connected' | 'expired' | 'revoked'
    clientIp: null,
    tailscaleIp: null,   // the user device's Tailscale IP if detected
    sftpHost: null,      // the SFTP host to use (node's IP or Tailscale IP)
    sftpPort: 2222,
    verifiedAt: null
  };

  tokenStore.set(token, tokenData);
  console.log(`[Tailscale Audit] Token generated for user ${userId}, server ${serverId} (Token: ${token.substring(0, 8)}...)`);
  return tokenData;
}

function getToken(token) {
  if (!tokenStore.has(token)) return null;
  const data = tokenStore.get(token);
  if (data.status === 'pending' && Date.now() > data.expiresAt) {
    data.status = 'expired';
  }
  return data;
}

// Called when user opens the link and clicks "Verify" — or auto-verified if IP is Tailscale
// nodeIp is passed from the backend so we know what SFTP host to advertise
function verifyAndConnectDevice(token, requestIp, nodeIp = null) {
  const data = getToken(token);
  if (!data) {
    return { success: false, error: 'Invalid connection token' };
  }

  if (data.status === 'expired' || Date.now() > data.expiresAt) {
    data.status = 'expired';
    return { success: false, error: 'Connection token has expired. Please generate a new link from the server dashboard.' };
  }

  if (data.status === 'revoked') {
    return { success: false, error: 'Connection token was revoked.' };
  }

  const cleanIp = (requestIp || '').replace(/^::ffff:/, '').trim();
  const deviceIsTailscale = isTailscaleIp(cleanIp);

  // Determine the SFTP host to use:
  // Priority: client's Tailscale IP (if device is on Tailscale) → nodeIp → cleanIp
  const sftpHost = nodeIp || cleanIp || '127.0.0.1';

  // Mark as connected
  data.status = 'connected';
  data.clientIp = cleanIp;
  data.tailscaleIp = deviceIsTailscale ? cleanIp : null;
  data.sftpHost = sftpHost;
  data.verifiedAt = Date.now();

  // Store as active session so dashboard can show it even without Tailscale CLI
  const sessionKey = `${data.userId}:${data.serverId}`;
  activeSessions.set(sessionKey, {
    host: sftpHost,
    port: 2222,
    path: `/${data.serverId}/`,
    connectedAt: Date.now(),
    clientIp: cleanIp,
    deviceIsTailscale
  });

  console.log(`[Tailscale Audit] Device verified & connected for token ${token.substring(0, 8)}... (ClientIP: ${cleanIp}, SFTPHost: ${sftpHost}, TailscaleDevice: ${deviceIsTailscale})`);
  return { success: true, tokenData: data, sftpHost, sftpPort: 2222, isTailscaleIp: deviceIsTailscale };
}

// Check if there's an active session for user+server
function getActiveSession(userId, serverId) {
  const sessionKey = `${userId}:${serverId}`;
  return activeSessions.get(sessionKey) || null;
}

// Clear active session when user disconnects
function clearActiveSession(userId, serverId) {
  const sessionKey = `${userId}:${serverId}`;
  activeSessions.delete(sessionKey);
  console.log(`[Tailscale Audit] Session cleared for user ${userId}, server ${serverId}`);
}

function revokeToken(token, userId) {
  const data = getToken(token);
  if (!data) return false;
  if (data.userId !== userId) {
    throw new Error('Unauthorized to revoke this token');
  }
  data.status = 'revoked';
  clearActiveSession(userId, data.serverId);
  console.log(`[Tailscale Audit] Token revoked by user ${userId} (Token: ${token.substring(0, 8)}...)`);
  return true;
}

function revokeServerTokens(userId, serverId) {
  let count = 0;
  for (const [t, data] of tokenStore.entries()) {
    if (data.userId === userId && data.serverId == serverId) {
      data.status = 'revoked';
      count++;
    }
  }
  clearActiveSession(userId, serverId);
  return count;
}

// Cleanup expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [t, data] of tokenStore.entries()) {
    if (data.expiresAt < now - 60 * 60 * 1000) {
      tokenStore.delete(t);
    }
  }
  // Clear stale sessions older than 4 hours
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.connectedAt > 4 * 60 * 60 * 1000) {
      activeSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  generateToken,
  getToken,
  verifyAndConnectDevice,
  getActiveSession,
  clearActiveSession,
  revokeToken,
  revokeServerTokens,
  isTailscaleIp
};
