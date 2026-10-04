const test = require('node:test');
const assert = require('node:assert/strict');
const { miniPlayerBounds, resizePlaybackBounds } = require('../src/window-modes.cjs');

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

test('resizes normal playback from every edge while respecting the work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const start = { x: 160, y: 90, width: 1400, height: 820 };
  const minimum = { width: 900, height: 560 };

  assert.deepEqual(
    resizePlaybackBounds(start, 'se', { x: 180, y: 90 }, workArea, minimum),
    { x: 160, y: 90, width: 1580, height: 910 },
  );
  assert.deepEqual(
    resizePlaybackBounds(start, 'nw', { x: -80, y: -40 }, workArea, minimum),
    { x: 80, y: 50, width: 1480, height: 860 },
  );
});

test('clamps playback resizing to minimum size and screen boundaries', () => {
  const workArea = { x: 100, y: 40, width: 1280, height: 760 };
  const start = { x: 180, y: 100, width: 1000, height: 620 };
  const minimum = { width: 900, height: 560 };

  assert.deepEqual(
    resizePlaybackBounds(start, 'w', { x: 600, y: 0 }, workArea, minimum),
    { x: 280, y: 100, width: 900, height: 620 },
  );
  assert.deepEqual(
    resizePlaybackBounds(start, 'se', { x: 900, y: 900 }, workArea, minimum),
    { x: 180, y: 100, width: 1200, height: 700 },
  );
});
