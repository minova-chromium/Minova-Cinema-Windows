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

function resizePlaybackBounds(start, edge, delta, workArea, minimumSize) {
  const minWidth = Math.min(Math.max(1, minimumSize.width), workArea.width);
  const minHeight = Math.min(Math.max(1, minimumSize.height), workArea.height);
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let left = start.x;
  let right = startRight;
  let top = start.y;
  let bottom = startBottom;
  const dx = Number(delta?.x) || 0;
  const dy = Number(delta?.y) || 0;

  if (edge.includes('w')) left = Math.max(workArea.x, Math.min(start.x + dx, startRight - minWidth));
  if (edge.includes('e')) right = Math.min(workRight, Math.max(startRight + dx, start.x + minWidth));
  if (edge.includes('n')) top = Math.max(workArea.y, Math.min(start.y + dy, startBottom - minHeight));
  if (edge.includes('s')) bottom = Math.min(workBottom, Math.max(startBottom + dy, start.y + minHeight));

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

module.exports = { DEFAULT_MINI_PLAYER_SIZE, MINI_PLAYER_MARGIN, miniPlayerBounds, resizePlaybackBounds };
