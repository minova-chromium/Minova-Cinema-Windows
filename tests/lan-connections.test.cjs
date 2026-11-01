const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PlexClient } = require('../src/plex.cjs');
const {
  directLanUri,
  expandPlexConnections,
  isLanUri,
  plexDirectLanFallback,
  serverCandidateUris,
  tryServerCandidates,
} = require('../src/lan-connections.cjs');

test('creates an HTTP LAN fallback from a local Plex resource address', () => {
  const connection = {
    uri: 'https://192-168-50-129.example.plex.direct:32400',
    address: '192.168.50.129',
    port: 32400,
    local: true,
    relay: false,
  };
  assert.equal(directLanUri(connection), 'http://192.168.50.129:32400');
  assert.deepEqual(expandPlexConnections([connection]).map((item) => item.uri), [
    'https://192-168-50-129.example.plex.direct:32400',
    'http://192.168.50.129:32400',
  ]);
});

test('derives a LAN IP from a previously saved plex.direct address', () => {
  const secure = 'https://192-168-1-25.abc123.plex.direct:32400';
  assert.equal(plexDirectLanFallback(secure), 'http://192.168.1.25:32400');
  assert.deepEqual(serverCandidateUris(secure), [secure, 'http://192.168.1.25:32400']);
  assert.equal(isLanUri(secure), true);
});

test('does not create a LAN fallback from public or remote resource addresses', () => {
  assert.equal(directLanUri({ address: '8.8.8.8', port: 32400, local: true }), null);
  assert.equal(directLanUri({ address: '192.168.1.25', port: 32400, local: false }), null);
  assert.equal(plexDirectLanFallback('https://relay.example.com'), null);
});

test('moves from an unavailable online hostname to the saved LAN server', async () => {
  const attempts = [];
  const online = 'https://192-168-50-129.example.plex.direct:32400';
  const lan = 'http://192.168.50.129:32400';
  const result = await tryServerCandidates({
    servers: serverCandidateUris(online),
    createClient: (server) => ({ server }),
    operation: async (client) => {
      attempts.push(client.server);
      if (client.server === online) throw new Error('DNS unavailable');
      return 'local catalog';
    },
  });
  assert.deepEqual(attempts, [online, lan]);
  assert.equal(result.server, lan);
  assert.equal(result.value, 'local catalog');
});

test('reaches a real Plex-compatible LAN endpoint after the primary address fails', async (context) => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ MediaContainer: { friendlyName: 'Offline LAN Plex', Directory: [] } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const lan = `http://127.0.0.1:${address.port}`;
  const result = await tryServerCandidates({
    servers: ['http://127.0.0.1:1', lan],
    createClient: (endpoint) => new PlexClient(endpoint, 'test-token', 'offline-test-client'),
    operation: (client) => client.test(),
  });
  assert.equal(result.server, lan);
  assert.equal(result.value, 'Offline LAN Plex');
});
