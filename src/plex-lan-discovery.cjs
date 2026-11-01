const dgram = require('node:dgram');
const os = require('node:os');
const { isLanHost, normalizeUri } = require('./lan-connections.cjs');

const GDM_PORT = 32414;
const GDM_SEARCH = Buffer.from('M-SEARCH * HTTP/1.1\r\n\r\n', 'utf8');

function ipv4ToInt(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((total, part) => ((total << 8) | part) >>> 0, 0);
}

function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function subnetBroadcast(address, netmask) {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (ip === null || mask === null) return null;
  return intToIpv4(((ip & mask) | (~mask >>> 0)) >>> 0);
}

function broadcastDestinations(networkInterfaces = os.networkInterfaces()) {
  const output = new Set(['255.255.255.255']);
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !isLanHost(entry.address)) continue;
      const broadcast = subnetBroadcast(entry.address, entry.netmask);
      if (broadcast) output.add(broadcast);
    }
  }
  return [...output];
}

function parseGdmResponse(message, remote = {}) {
  const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(text.trimStart())) return null;
  const headers = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const address = String(remote.address || '').trim();
  if (!isLanHost(address)) return null;
  const port = Number(headers.port || 32400);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const uri = normalizeUri(`http://${address}:${port}`);
  if (!uri) return null;
  return {
    uri,
    address,
    port,
    name: headers.name || 'Plex Media Server',
    id: headers['resource-identifier'] || '',
  };
}

function discoverLanPlexServers({ timeoutMs = 1400, socketFactory = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }), networkInterfaces } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = socketFactory();
    let timer;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve([...found.values()]);
    };
    socket.on('message', (message, remote) => {
      const server = parseGdmResponse(message, remote);
      if (server) found.set(server.uri, server);
    });
    socket.on('error', finish);
    socket.bind(0, () => {
      try { socket.setBroadcast(true); } catch { finish(); return; }
      for (const destination of broadcastDestinations(networkInterfaces)) {
        try { socket.send(GDM_SEARCH, 0, GDM_SEARCH.length, GDM_PORT, destination, () => {}); } catch {}
      }
      timer = setTimeout(finish, Math.max(250, Number(timeoutMs) || 1400));
    });
  });
}

module.exports = {
  GDM_PORT,
  GDM_SEARCH,
  broadcastDestinations,
  discoverLanPlexServers,
  parseGdmResponse,
  subnetBroadcast,
};
