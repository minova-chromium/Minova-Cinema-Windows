const PLEX_ACCOUNT_URL = 'https://plex.tv/';
const PRODUCT_VERSION = require('../package.json').version;

function accountHeaders(clientIdentifier, token = null) {
  const headers = {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Product': 'Minova Cinema',
    'X-Plex-Version': PRODUCT_VERSION,
    'X-Plex-Platform': 'Windows',
    'X-Plex-Device': 'PC',
    'X-Plex-Device-Name': 'Minova Cinema Desktop',
    'X-Plex-Provides': 'player,controller',
  };
  if (token) headers['X-Plex-Token'] = token;
  return headers;
}

function buildPlexLinkUrl(code) {
  return `https://plex.tv/link/?pin=${encodeURIComponent(String(code || '').trim())}`;
}

function requestSignal(signal, timeoutMs = 20000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchJson(path, { method = 'GET', clientIdentifier, token = null, signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL(path, PLEX_ACCOUNT_URL), {
    method,
    headers: accountHeaders(clientIdentifier, token),
    signal: requestSignal(signal),
  });
  if (!response.ok) throw new Error(`Plex sign-in returned ${response.status} ${response.statusText}.`);
  return response.json();
}

async function createPlexPin({ clientIdentifier, signal, fetchImpl } = {}) {
  const pin = await fetchJson('/api/v2/pins?strong=false', {
    method: 'POST', clientIdentifier, signal, fetchImpl,
  });
  if (!Number(pin?.id) || !String(pin?.code || '').trim()) {
    throw new Error('Plex did not create a sign-in code. Try again.');
  }
  const code = String(pin.code).trim().toUpperCase();
  return {
    id: Number(pin.id),
    code,
    authorizationUrl: buildPlexLinkUrl(code),
  };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (!signal) return;
    function cancel() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(Object.assign(new Error('Plex sign-in was cancelled.'), { name: 'AbortError' }));
    }
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

async function awaitPlexAuthorization({
  pinId, clientIdentifier, signal, fetchImpl, pollIntervalMs = 1000, timeoutMs = 5 * 60 * 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollIntervalMs, signal);
    const pin = await fetchJson(`/api/v2/pins/${encodeURIComponent(pinId)}`, {
      clientIdentifier, signal, fetchImpl,
    });
    const token = String(pin?.authToken || '').trim();
    if (token) return token;
  }
  throw new Error('That Plex sign-in code expired. Select Sign in with Plex to request a new one.');
}

function rankPlexConnections(connections = []) {
  return connections
    .filter((connection) => String(connection?.uri || '').trim())
    .filter((connection, index, values) => values.findIndex((candidate) =>
      String(candidate.uri).replace(/\/$/, '') === String(connection.uri).replace(/\/$/, '')) === index)
    .sort((left, right) => {
      const tier = (connection) => connection.local === true ? 0 : connection.relay !== true ? 1 : 2;
      return tier(left) - tier(right)
        || Number(!String(left.uri).startsWith('https://')) - Number(!String(right.uri).startsWith('https://'));
    });
}

async function discoverPlexServers({ accountToken, clientIdentifier, signal, fetchImpl } = {}) {
  const resources = await fetchJson('/api/v2/resources?includeHttps=1&includeRelay=1', {
    clientIdentifier, token: accountToken, signal, fetchImpl,
  });
  return (Array.isArray(resources) ? resources : [])
    .filter((resource) => String(resource?.provides || '').split(',').some((value) => value.trim() === 'server'))
    .filter((resource) => rankPlexConnections(resource.connections).length > 0)
    .map((resource, index) => ({
      id: String(resource.clientIdentifier || `server-${index}`),
      name: String(resource.name || 'Plex Media Server'),
      owned: resource.owned === true,
      accountToken,
      accessToken: String(resource.accessToken || accountToken),
      connections: rankPlexConnections(resource.connections),
    }));
}

module.exports = {
  accountHeaders,
  awaitPlexAuthorization,
  buildPlexLinkUrl,
  createPlexPin,
  discoverPlexServers,
  rankPlexConnections,
};
