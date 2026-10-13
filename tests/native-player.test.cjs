const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NativeMpvPlayer } = require('../src/native-player.cjs');

test('native playback follows the display clock and smooths refresh-rate mismatch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native-host', 'LibMpvHost.cs'), 'utf8');
  assert.match(source, /\{ "video-sync", "display-resample" \}/);
  assert.match(source, /\{ "interpolation", "yes" \}/);
  assert.match(source, /\{ "tscale", "oversample" \}/);
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
