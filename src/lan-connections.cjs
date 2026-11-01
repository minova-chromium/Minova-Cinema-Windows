function normalizeUri(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

function isPrivateIpv4(hostname) {
  const octets = String(hostname || '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLanHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost'
    || host.endsWith('.local')
    || host.endsWith('.lan')
    || isPrivateIpv4(host)
    || host === '::1'
    || host.startsWith('fe80:')
    || host.startsWith('fc')
    || host.startsWith('fd');
}

function isLanUri(value) {
  try {
    const url = new URL(value);
    return isLanHost(url.hostname) || Boolean(plexDirectLanFallback(value));
  } catch { return false; }
}

function isDirectLanUri(value) {
  try { return isLanHost(new URL(value).hostname); } catch { return false; }
}

function formatHost(address) {
  const value = String(address || '').trim().replace(/^\[|\]$/g, '');
  if (!value) return '';
  return value.includes(':') ? `[${value}]` : value;
}

function directLanUri(connection = {}) {
  if (connection.local !== true || !isLanHost(connection.address)) return null;
  const host = formatHost(connection.address);
  const port = Number(connection.port) > 0 && Number(connection.port) <= 65535 ? Number(connection.port) : 32400;
  return normalizeUri(`http://${host}:${port}`);
}

function plexDirectLanFallback(value) {
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\..+\.plex\.direct$/i);
    if (!match) return null;
    const address = match.slice(1).map(Number);
    if (address.some((part) => part < 0 || part > 255)) return null;
    const host = address.join('.');
    if (!isPrivateIpv4(host)) return null;
    return normalizeUri(`http://${host}:${url.port || 32400}`);
  } catch { return null; }
}

function expandPlexConnections(connections = []) {
  const expanded = [];
  for (const connection of connections) {
    const uri = normalizeUri(connection?.uri);
    if (uri) expanded.push({ ...connection, uri });
    const direct = directLanUri(connection);
    if (direct && direct !== uri) {
      expanded.push({
        uri: direct,
        address: String(connection.address || ''),
        port: Number(connection.port) || 32400,
        local: true,
        relay: false,
        offlineFallback: true,
      });
    }
  }
  return expanded.filter((connection, index, values) =>
    values.findIndex((candidate) => candidate.uri === connection.uri) === index);
}

function serverCandidateUris(primary, candidates = []) {
  const output = [];
  const add = (value) => {
    const normalized = normalizeUri(value);
    if (normalized && !output.includes(normalized)) output.push(normalized);
    const fallback = plexDirectLanFallback(normalized);
    if (fallback && !output.includes(fallback)) output.push(fallback);
  };
  add(primary);
  for (const candidate of candidates) add(typeof candidate === 'string' ? candidate : candidate?.uri);
  return output;
}

async function tryServerCandidates({ servers = [], currentClient = null, createClient, operation } = {}) {
  if (typeof createClient !== 'function' || typeof operation !== 'function') {
    throw new TypeError('A client factory and operation are required.');
  }
  let lastError;
  for (const server of serverCandidateUris(servers[0], servers.slice(1))) {
    const client = currentClient?.server === server ? currentClient : createClient(server);
    try {
      return { value: await operation(client), client, server };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('No Plex server addresses are available.');
}

module.exports = {
  directLanUri,
  expandPlexConnections,
  isDirectLanUri,
  isLanHost,
  isLanUri,
  isPrivateIpv4,
  normalizeUri,
  plexDirectLanFallback,
  serverCandidateUris,
  tryServerCandidates,
};
