const TUNNEL_MESSAGE_TYPES = {
  AGENT_AUTH: 'agent_auth',
  AGENT_AUTH_RESULT: 'agent_auth_result',
  FS_REQUEST: 'fs_request',
  FS_RESPONSE: 'fs_response',
  HEARTBEAT: 'heartbeat',
  HEARTBEAT_ACK: 'heartbeat_ack',
  ERROR: 'error'
};

const FS_OPERATIONS = [
  'open', 'read', 'write', 'close',
  'opendir', 'readdir',
  'mkdir', 'rmdir', 'unlink', 'rename',
  'stat', 'lstat', 'realpath'
];

function createMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function parseMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch (e) {
    return null;
  }
}

module.exports = {
  TUNNEL_MESSAGE_TYPES,
  FS_OPERATIONS,
  createMessage,
  parseMessage
};
