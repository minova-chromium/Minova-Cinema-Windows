const DEFAULT_MINI_PLAYER_SIZE = Object.freeze({ width: 560, height: 340 });
const MINI_PLAYER_MARGIN = 18;

function miniPlayerBounds(workArea, size = DEFAULT_MINI_PLAYER_SIZE, margin = MINI_PLAYER_MARGIN) {
  const width = Math.min(size.width, Math.max(360, workArea.width - margin * 2));
  const height = Math.min(size.height, Math.max(220, workArea.height - margin * 2));
  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin,
    width,
    height,
  };
}

module.exports = { DEFAULT_MINI_PLAYER_SIZE, MINI_PLAYER_MARGIN, miniPlayerBounds };
