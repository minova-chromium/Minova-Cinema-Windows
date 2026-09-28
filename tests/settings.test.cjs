const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacySettings, readSettings, selectConnectionToken, writeSettings } = require('../src/settings.cjs');

test('migrates a remembered encrypted login from the old Electron profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minova-settings-'));
  try {
    const current = path.join(root, 'Minova Cinema', 'settings.json');
    const legacy = path.join(root, 'minova-cinema-desktop', 'settings.json');
    writeSettings(current, { enhancement: 'high', volume: 63 });
    writeSettings(legacy, { server: 'https://plex.example', encryptedToken: 'encrypted-value', quality: '720', volume: 20 });
    const result = migrateLegacySettings(current, [legacy]);
    const restored = readSettings(current);
    assert.equal(result.migrated, true);
    assert.equal(restored.server, 'https://plex.example');
    assert.equal(restored.encryptedToken, 'encrypted-value');
    assert.equal(restored.quality, '720');
    assert.equal(restored.enhancement, 'high');
    assert.equal(restored.volume, 63);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('never replaces a connection already saved by the current profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minova-settings-'));
  try {
    const current = path.join(root, 'current', 'settings.json');
    const legacy = path.join(root, 'legacy', 'settings.json');
    writeSettings(current, { server: 'https://current.example', encryptedToken: 'current-token', quality: 'original' });
    writeSettings(legacy, { server: 'https://legacy.example', encryptedToken: 'legacy-token', quality: '480' });
    const result = migrateLegacySettings(current, [legacy]);
    assert.equal(result.migrated, false);
    assert.equal(readSettings(current).server, 'https://current.example');
    assert.equal(readSettings(current).encryptedToken, 'current-token');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reuses an encrypted remembered token when only the server address changes', () => {
  assert.equal(selectConnectionToken('', 'remembered-token'), 'remembered-token');
  assert.equal(selectConnectionToken('  new-token  ', 'remembered-token'), 'new-token');
  assert.equal(selectConnectionToken('', ''), '');
});
