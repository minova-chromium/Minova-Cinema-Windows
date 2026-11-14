const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NativeMpvPlayer, MAX_VOLUME, SHADOW_DETAIL_MODES, playbackPreferenceKey } = require('../src/native-player.cjs');

test('native playback follows the audio clock without interpolation drift', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native-host', 'LibMpvHost.cs'), 'utf8');
  assert.match(source, /\{ "video-sync", "audio" \}/);
  assert.match(source, /\{ "interpolation", "no" \}/);
  assert.match(source, /\{ "volume-max", "250" \}/);
  assert.doesNotMatch(source, /\{ "tscale",/);
});

test('failed native startup closes the loading overlay before returning the error', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(source, /try\s*\{\s*await nativePlayer\.start\(\);[\s\S]*?catch \(error\) \{\s*if \(nativePlayer === playbackPlayer\) await closeNativePlayback\(false\)/);
});

test('handoff pauses and commits the exact position without overwriting it on close', async () => {
  const commands = [];
  const timeline = [];
  const player = new NativeMpvPlayer({
    window: {},
    client: {
      timeline: async (_item, state, timeMs) => timeline.push({ state, timeMs }),
    },
    item: {
      ratingKey: '42',
      title: 'Handoff test',
      durationMs: 7_200_000,
      viewOffsetMs: 0,
      technical: {},
    },
    directUrl: 'file:///handoff-test.mkv',
    hlsUrl: null,
  });
  player.state.position = 1_234.567;
  player.command = async (command) => {
    commands.push(command);
    return command[0] === 'get_property' && command[1] === 'time-pos' ? player.state.position : true;
  };

  await player.handoff();
  await player.close();

  assert.deepEqual(commands, [
    ['set_property', 'pause', true],
    ['get_property', 'time-pos'],
  ]);
  assert.deepEqual(timeline, [{ state: 'paused', timeMs: 1_234_567 }]);
  assert.equal(player.handoffCommitted, true);
});

test('playback controls update immediately without a full property refresh', async () => {
  const commands = [];
  const player = new NativeMpvPlayer({
    window: {},
    client: { timeline: async () => {} },
    item: { ratingKey: '7', title: 'Responsive controls', durationMs: 3_600_000, viewOffsetMs: 600_000, technical: {} },
    directUrl: 'file:///responsive-controls.mkv',
    hlsUrl: null,
  });
  player.command = async (command) => { commands.push(command); return true; };
  player.refreshProperties = async () => { throw new Error('control actions must not synchronously refresh every property'); };

  const pauseState = await player.execute('toggle-pause');
  const seekState = await player.execute('seek-relative', 10);
  const volumeState = await player.execute('volume', 63);

  assert.equal(pauseState.paused, true);
  assert.equal(seekState.position, 610);
  assert.equal(volumeState.volume, 63);
  assert.deepEqual(commands, [
    ['cycle', 'pause'],
    ['seek', 10, 'relative+keyframes'],
    ['set_property', 'volume', 63],
  ]);
});

test('native playback exposes Plex markers and supports amplified volume up to 250 percent', async () => {
  const commands = [];
  const markers = [
    { type: 'intro', startTimeMs: 20000, endTimeMs: 70000, final: false },
    { type: 'credits', startTimeMs: 3500000, endTimeMs: 3590000, final: true },
  ];
  const player = new NativeMpvPlayer({
    window: {},
    client: { timeline: async () => {} },
    item: { ratingKey: '8', title: 'Boost test', durationMs: 3_600_000, viewOffsetMs: 0, technical: {}, markers },
    directUrl: 'file:///boost-test.mkv',
    hlsUrl: null,
    volume: 175,
  });
  player.command = async (command) => { commands.push(command); return true; };

  assert.equal(MAX_VOLUME, 250);
  assert.equal(player.snapshot().volume, 175);
  assert.deepEqual(player.snapshot().markers, markers);
  assert.equal((await player.execute('volume', 225)).volume, 225);
  assert.equal((await player.execute('volume', 999)).volume, 250);
  assert.deepEqual(commands, [
    ['set_property', 'volume', 225],
    ['set_property', 'volume', 250],
  ]);
});

test('player overlay offers marker skip controls and labels amplified volume', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'player-overlay.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'player-overlay.js'), 'utf8');
  assert.match(html, /id="skip-marker"[^>]+data-action="skip-marker"/);
  assert.match(html, /id="volume"[^>]+max="250"/);
  assert.match(html, /id="volume-value"/);
  assert.match(script, /marker\?\.type === 'credits' \? 'Skip credits' : 'Skip intro'/);
  assert.match(script, /command\('seek-absolute', Number\(skipMarker\.dataset\.endTime\)\)/);
  assert.match(script, /classList\.toggle\('boosted', level > 100\)/);
});

test('shadow detail preferences follow a show across episodes but remain title-specific for movies', () => {
  assert.equal(playbackPreferenceKey({ kind: 'episode', ratingKey: '101', grandparentRatingKey: '42' }), 'show:42');
  assert.equal(playbackPreferenceKey({ kind: 'episode', ratingKey: '102', grandparentRatingKey: '42' }), 'show:42');
  assert.equal(playbackPreferenceKey({ kind: 'movie', ratingKey: '77' }), 'movie:77');
});

test('native playback composes shadow detail with existing GPU enhancement shaders', async () => {
  const commands = [];
  const player = new NativeMpvPlayer({
    window: {},
    client: { timeline: async () => {} },
    item: { ratingKey: '101', grandparentRatingKey: '42', kind: 'episode', title: 'Dark scene', durationMs: 1000, viewOffsetMs: 0, technical: {} },
    directUrl: 'file:///dark-scene.mkv',
    hlsUrl: null,
    enhancement: 'high',
  });
  player.command = async (command) => { commands.push(command); return true; };

  const state = await player.execute('shadow-detail', 'medium');
  assert.deepEqual(SHADOW_DETAIL_MODES, ['off', 'low', 'medium', 'high']);
  assert.equal(state.shadowDetail, 'medium');
  assert.equal(state.shadowDetailScope, 'show');
  assert.equal(player.shadowDetailKey, 'show:42');
  assert.equal(commands[0][0], 'change-list');
  assert.match(commands[1][3], /ArtCNN_C4F16\.glsl$/);
  assert.match(commands[2][3], /ShadowDetail_medium\.glsl$/);
});

test('shadow detail shaders preserve true black and use progressively stronger toe lifts', () => {
  const strengths = ['low', 'medium', 'high'].map((mode) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'shaders', `ShadowDetail_${mode}.glsl`), 'utf8');
    assert.match(source, /\/\/!HOOK MAIN/);
    assert.match(source, /black_guard = smoothstep\(0\.003, 0\.025, luma\)/);
    return Number(source.match(/luma \+ ([0-9.]+) \* black_guard/)?.[1]);
  });
  assert.deepEqual(strengths, [0.018, 0.035, 0.055]);
});

test('player overlay exposes a per-title shadow detail cycle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'player-overlay.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'player-overlay.js'), 'utf8');
  assert.match(html, /data-action="shadow-detail"/);
  assert.match(script, /const modes = \['off', 'low', 'medium', 'high'\]/);
  assert.match(script, /Shadow detail for this \$\{state\.shadowDetailScope === 'show' \? 'show' : 'title'\}/);
});

test('main process persists shadow detail by the active show or title key', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(source, /shadowDetail: stored\.shadowDetailByMedia\?\.\[playbackPreferenceKey\(item\)\] \|\| 'off'/);
  assert.match(source, /preferences\[player\.shadowDetailKey\] = state\.shadowDetail/);
  assert.match(source, /delete preferences\[player\.shadowDetailKey\]/);
});
