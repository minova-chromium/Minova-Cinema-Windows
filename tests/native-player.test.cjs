const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeMpvPlayer } = require('../src/native-player.cjs');

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
  player.command = async (command) => { commands.push(command); return true; };
  player.refreshProperties = async () => {};

  await player.handoff();
  await player.close();

  assert.deepEqual(commands[0], ['set_property', 'pause', true]);
  assert.deepEqual(timeline, [{ state: 'paused', timeMs: 1_234_567 }]);
  assert.equal(player.handoffCommitted, true);
});
