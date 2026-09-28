const test = require('node:test');
const assert = require('node:assert/strict');
const { miniPlayerBounds } = require('../src/window-modes.cjs');

test('places the mini-player inside the bottom-right of the active display', () => {
  assert.deepEqual(
    miniPlayerBounds({ x: 1920, y: 0, width: 1920, height: 1040 }),
    { x: 3262, y: 682, width: 560, height: 340 },
  );
});

test('keeps the mini-player usable on a small work area', () => {
  assert.deepEqual(
    miniPlayerBounds({ x: 0, y: 0, width: 390, height: 260 }),
    { x: 12, y: 18, width: 360, height: 224 },
  );
});
