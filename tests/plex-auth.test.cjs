const test = require('node:test');
const assert = require('node:assert/strict');
const {
  awaitPlexAuthorization,
  buildPlexLinkUrl,
  createPlexPin,
  discoverPlexServers,
  rankPlexConnections,
} = require('../src/plex-auth.cjs');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}

test('creates a short Plex PIN and uses the prefilled link page', async () => {
  let captured;
  const challenge = await createPlexPin({
    clientIdentifier: 'desktop-test',
    fetchImpl: async (url, options) => {
      captured = { url: url.toString(), options };
      return jsonResponse({ id: 42, code: 'a1b2' });
    },
  });
  assert.equal(captured.url, 'https://plex.tv/api/v2/pins?strong=false');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['X-Plex-Client-Identifier'], 'desktop-test');
  assert.equal(challenge.code, 'A1B2');
  assert.equal(challenge.authorizationUrl, 'https://plex.tv/link/?pin=A1B2');
  assert.equal(buildPlexLinkUrl('A1 B'), 'https://plex.tv/link/?pin=A1%20B');
});

test('polls until Plex supplies the account token', async () => {
  let calls = 0;
  const token = await awaitPlexAuthorization({
    pinId: 42,
    clientIdentifier: 'desktop-test',
    pollIntervalMs: 1,
    timeoutMs: 100,
    fetchImpl: async () => jsonResponse(++calls === 1 ? { authToken: null } : { authToken: 'account-token' }),
  });
  assert.equal(token, 'account-token');
  assert.equal(calls, 2);
});

test('discovers server resources and prefers local, direct, then relay connections', async () => {
  const servers = await discoverPlexServers({
    accountToken: 'account-token',
    clientIdentifier: 'desktop-test',
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['X-Plex-Token'], 'account-token');
      return jsonResponse([
        { name: 'Player only', provides: 'player', connections: [{ uri: 'https://ignored.example' }] },
        {
          name: 'Living Room', provides: 'server', owned: true, clientIdentifier: 'server-id', accessToken: 'server-token',
          connections: [
            { uri: 'https://relay.example', relay: true, local: false },
            { uri: 'http://remote.example:32400', relay: false, local: false },
            { uri: 'http://local.example:32400', relay: false, local: true },
          ],
        },
      ]);
    },
  });
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].connections.map((connection) => connection.uri), [
    'http://local.example:32400',
    'http://remote.example:32400',
    'https://relay.example',
  ]);
  assert.equal(servers[0].accessToken, 'server-token');
});

test('deduplicates Plex connection addresses', () => {
  assert.equal(rankPlexConnections([
    { uri: 'https://plex.example/' },
    { uri: 'https://plex.example' },
  ]).length, 1);
});
