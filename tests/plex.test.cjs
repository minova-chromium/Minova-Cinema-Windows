const test = require('node:test');
const assert = require('node:assert/strict');
const { connectionErrorMessage, episodeOrder, isPlexOwnedHost, isTrustedExternalArtworkUrl, mapMetadata, normalizeServer, personIdentifier, rewritePlaylist } = require('../src/plex.cjs');

test('normalizes a LAN Plex address and supplies the default port', () => {
  assert.equal(normalizeServer('192.168.1.25'), 'http://192.168.1.25:32400');
  assert.equal(normalizeServer('https://plex.local:443/'), 'https://plex.local');
  assert.equal(normalizeServer('https://plex.example/'), 'https://plex.example');
  assert.equal(normalizeServer('https://plex.example:32400/'), 'https://plex.example:32400');
});

test('maps Plex metadata without exposing an authenticated URL', () => {
  const item = mapMetadata({
    ratingKey: '42', type: 'movie', title: 'Example', year: 2026, duration: 600000,
    viewOffset: 150000, lastViewedAt: 1790000000, viewCount: 1,
    thumb: '/library/metadata/42/thumb/1', art: '/library/metadata/42/art/1',
    Genre: [{ tag: 'Drama' }], Role: [{ id: 9, tagKey: 'plex-person-9', tag: 'Ava Stone', role: 'Lead', thumb: '/library/people/9/thumb' }],
    Producer: [{ id: 10, tag: 'Maya North', thumb: '/library/people/10/thumb' }],
    Media: [{ container: 'mkv', videoCodec: 'hevc', Part: [{ id: 7, key: '/library/parts/7/file.mkv' }] }],
  });
  assert.equal(item.title, 'Example');
  assert.equal(item.progress, 0.25);
  assert.equal(item.lastViewedAt, 1790000000);
  assert.equal(item.viewedCount, 1);
  assert.equal(item.posterPath, '/library/metadata/42/thumb/1');
  assert.equal(item.backdropPath, '/library/metadata/42/art/1');
  assert.deepEqual(item.credits[0], { name: 'Ava Stone', role: 'Lead', imagePath: '/library/people/9/thumb', personId: 'plex-person-9' });
  assert.deepEqual(item.credits[1], { name: 'Maya North', role: 'Producer', imagePath: '/library/people/10/thumb', personId: '10' });
  assert.equal(item.playback.directPath, '/library/parts/7/file.mkv');
  assert.equal(JSON.stringify(item).includes('X-Plex-Token'), false);
});

test('resolves Plex person identities and orders episodes across seasons', () => {
  assert.equal(personIdentifier({ tagKey: 'abc123', id: 42 }), 'abc123');
  assert.equal(personIdentifier({ filter: 'actor=53374' }), '53374');
  assert.equal(personIdentifier({}), null);
  const episodes = [
    { seasonNumber: 2, episodeNumber: 1 },
    { seasonNumber: 1, episodeNumber: 5 },
    { seasonNumber: 0, episodeNumber: 1 },
  ].sort(episodeOrder);
  assert.deepEqual(episodes.map((item) => [item.seasonNumber, item.episodeNumber]), [[1, 5], [2, 1], [0, 1]]);
});

test('uses the parent show artwork behind episode details', () => {
  const episode = mapMetadata({
    ratingKey: '84', type: 'episode', title: 'A New Chapter', grandparentTitle: 'Example Series',
    parentIndex: 2, index: 4, grandparentArt: '/library/metadata/series/art/9',
    grandparentThumb: '/library/metadata/series/thumb/9',
  });
  assert.equal(episode.backdropPath, '/library/metadata/series/art/9');
  assert.equal(episode.secondaryTitle, 'Example Series  •  S2 E4');
});

test('rewrites HLS playlists through the private media protocol', () => {
  const source = 'http://plex.local:32400/video/master.m3u8';
  const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nsegment-1.ts\n';
  const output = rewritePlaylist(playlist, source, (url) => `proxy:${url}`);
  assert.match(output, /URI="proxy:http:\/\/plex\.local:32400\/video\/init\.mp4"/);
  assert.match(output, /proxy:http:\/\/plex\.local:32400\/video\/segment-1\.ts/);
});

test('allows trusted Plex artwork without opening the media proxy to arbitrary hosts', () => {
  assert.equal(isTrustedExternalArtworkUrl('https://metadata-static.plex.tv/people/1.jpg'), true);
  assert.equal(isTrustedExternalArtworkUrl('https://image.tmdb.org/t/p/w500/person.jpg'), true);
  assert.equal(isTrustedExternalArtworkUrl('https://example.com/person.jpg'), false);
  assert.equal(isTrustedExternalArtworkUrl('http://metadata-static.plex.tv/people/1.jpg'), false);
  assert.equal(isPlexOwnedHost('metadata.provider.plex.tv'), true);
  assert.equal(isPlexOwnedHost('plex.tv.example.com'), false);
});

test('turns low-level network failures into useful Plex connection guidance', () => {
  const tailscale = connectionErrorMessage({ cause: { code: 'ENOTFOUND' } }, new URL('https://plex.example.ts.net/library/sections'));
  assert.match(tailscale, /could not resolve plex\.example\.ts\.net/i);
  assert.match(tailscale, /Start Tailscale/i);
  assert.doesNotMatch(tailscale, /fetch failed/i);
  assert.match(
    connectionErrorMessage({ cause: { code: 'ECONNREFUSED' } }, new URL('http://192.168.1.10:32400/library/sections')),
    /connection.*refused.*Plex Media Server/i,
  );
  assert.match(
    connectionErrorMessage({ name: 'TimeoutError' }, new URL('https://plex.example/library/sections')),
    /timed out/i,
  );
});
