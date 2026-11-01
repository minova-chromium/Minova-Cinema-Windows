const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ArtworkCache } = require('../src/artwork-cache.cjs');

async function fixture(options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minova-artwork-cache-'));
  return { root, cache: new ArtworkCache(root, options) };
}

test('stores artwork without putting its Plex path in the filesystem', async (t) => {
  const { root, cache } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identifier = '/library/metadata/42/thumb/123?X-Plex-Token=secret';
  await cache.put(identifier, Buffer.from('poster'), 'image/jpeg');
  assert.deepEqual(await cache.get(identifier), { body: Buffer.from('poster'), contentType: 'image/jpeg' });
  const names = await fs.readdir(root);
  assert.equal(names.some((name) => name.includes('42') || name.includes('secret')), false);
  assert.deepEqual(await cache.stats(), { entries: 1, bytes: 6, maxBytes: 512 * 1024 * 1024 });
});

test('ignores non-image responses and clears only its own directory', async (t) => {
  const { root, cache } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await cache.put('/video', Buffer.from('stream'), 'video/mp4'), false);
  await cache.put('/poster', Buffer.from('image'), 'image/png');
  assert.deepEqual(await cache.clear(), { entries: 0, bytes: 0, maxBytes: 512 * 1024 * 1024 });
});

test('evicts the oldest artwork when the configured limit is exceeded', async (t) => {
  const { root, cache } = await fixture({ maxBytes: 1024 * 1024 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await cache.put('old', Buffer.alloc(700 * 1024, 1), 'image/jpeg');
  await new Promise((resolve) => setTimeout(resolve, 15));
  await cache.put('new', Buffer.alloc(700 * 1024, 2), 'image/jpeg');
  assert.equal(await cache.get('old'), null);
  assert.ok(await cache.get('new'));
  assert.equal((await cache.stats()).entries, 1);
});
