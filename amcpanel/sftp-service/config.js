const path = require('path');
const os = require('os');

const SFTP_CONFIG = {
  port: parseInt(process.env.SFTP_PORT) || 2222,
  host: process.env.SFTP_HOST || '::', // '::' = dual-stack: accepts both IPv4 and IPv6
  ipv6Only: false, // allow IPv4-mapped IPv6 addresses (i.e., accept both)
  maxConnections: parseInt(process.env.SFTP_MAX_CONNECTIONS) || 200,
  idleTimeout: parseInt(process.env.SFTP_IDLE_TIMEOUT) || 3600000, // 1 hour
  keepaliveInterval: parseInt(process.env.SFTP_KEEPALIVE) || 30000,
  hostKeyPath: path.join(__dirname, '..', '.sftp_host_key'),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'database.db'),
  serversDir: process.env.SERVERS_DIR || path.join(__dirname, '..', 'servers'),
  debug: process.env.SFTP_DEBUG === 'true',
  // Large file support: 256KB chunks per SFTP packet
  transferChunkSize: parseInt(process.env.SFTP_CHUNK_SIZE) || 262144,
  // Per-file write buffer: 8MB to prevent I/O thrashing on large uploads
  writeHighWaterMark: parseInt(process.env.SFTP_WRITE_HWM) || 8 * 1024 * 1024,
  readHighWaterMark: parseInt(process.env.SFTP_READ_HWM) || 8 * 1024 * 1024,
  rateLimit: {
    connectionsPerMinute: parseInt(process.env.SFTP_RATE_LIMIT) || 120,
    maxAuthAttempts: parseInt(process.env.SFTP_MAX_AUTH) || 5,
    authBanTime: parseInt(process.env.SFTP_AUTH_BAN) || 300000
  },
  tunnelPort: parseInt(process.env.SFTP_TUNNEL_PORT) || 2224,
  tunnelHost: process.env.SFTP_TUNNEL_HOST || '::',
  tunnelPath: process.env.SFTP_TUNNEL_PATH || '/agent',
  tunnelTlsKey: process.env.SFTP_TLS_KEY || null,
  tunnelTlsCert: process.env.SFTP_TLS_CERT || null,
  tunnelRequireTls: process.env.SFTP_REQUIRE_TLS === 'true',
  agentDialTimeout: parseInt(process.env.SFTP_AGENT_DIAL_TIMEOUT) || 10000,
  agentHeartbeatInterval: parseInt(process.env.SFTP_AGENT_HEARTBEAT) || 30000,
  agentReconnectBaseDelay: parseInt(process.env.SFTP_AGENT_RECONNECT_BASE) || 1000,
  agentReconnectMaxDelay: parseInt(process.env.SFTP_AGENT_RECONNECT_MAX) || 60000
};

module.exports = SFTP_CONFIG;
