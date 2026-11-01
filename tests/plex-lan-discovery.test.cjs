const test = require('node:test');
const assert = require('node:assert/strict');
const {
  broadcastDestinations,
  parseGdmResponse,
  subnetBroadcast,
} = require('../src/plex-lan-discovery.cjs');

test('calculates an IPv4 subnet broadcast address', () => {
  assert.equal(subnetBroadcast('192.168.50.22', '255.255.255.0'), '192.168.50.255');
  assert.equal(subnetBroadcast('invalid', '255.255.255.0'), null);
});

test('broadcasts to both the global and active private subnet addresses', () => {
  const destinations = broadcastDestinations({
    Ethernet: [{ family: 'IPv4', address: '192.168.50.22', netmask: '255.255.255.0', internal: false }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
  });
  assert.deepEqual(destinations, ['255.255.255.255', '192.168.50.255']);
});

test('parses a Plex GDM response into a direct LAN endpoint', () => {
  const response = Buffer.from([
    'HTTP/1.0 200 OK',
    'Name: Living Room Plex',
    'Port: 32400',
    'Resource-Identifier: server-id',
    '',
    '',
  ].join('\r\n'));
  assert.deepEqual(parseGdmResponse(response, { address: '192.168.50.129' }), {
    uri: 'http://192.168.50.129:32400',
    address: '192.168.50.129',
    port: 32400,
    name: 'Living Room Plex',
    id: 'server-id',
  });
});

test('rejects invalid or non-LAN Plex discovery replies', () => {
  const response = 'HTTP/1.0 200 OK\r\nPort: 32400\r\n\r\n';
  assert.equal(parseGdmResponse(response, { address: '203.0.113.5' }), null);
  assert.equal(parseGdmResponse('HTTP/1.0 500 Error\r\n\r\n', { address: '192.168.1.5' }), null);
  assert.equal(parseGdmResponse('HTTP/1.0 200 OK\r\nPort: 99999\r\n\r\n', { address: '192.168.1.5' }), null);
});
