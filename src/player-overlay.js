const root = document.getElementById('player-overlay');
const title = document.getElementById('title');
const transport = document.getElementById('transport');
const qualityBadge = document.getElementById('quality-badge');
const enhancementBadge = document.getElementById('enhancement-badge');
const message = document.getElementById('message');
const notice = document.getElementById('notice');
const trackMenu = document.getElementById('track-menu');
const seek = document.getElementById('seek');
const volume = document.getElementById('volume');
const time = document.getElementById('time');
let state = { paused: false, position: 0, duration: 0, volume: 100, muted: false, tracks: [], enhancement: 'balanced' };
let hideTimer;
let seeking = false;

function clock(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function button(action) { return document.querySelector(`[data-action="${action}"]`); }

function showControls(sticky = false) {
  root.classList.remove('controls-hidden');
  clearTimeout(hideTimer);
  if (!sticky && !state.paused && !trackMenu.hidden) return;
  if (!sticky && !state.paused) hideTimer = setTimeout(() => root.classList.add('controls-hidden'), 3200);
}

function focusDirectional(key) {
  const active = document.activeElement;
  if (!active || active === document.body || !active.matches('button, input')) return false;
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!direction) return false;
  const candidates = [...document.querySelectorAll('button:not([hidden]), input:not([hidden])')]
    .filter((node) => node.offsetParent !== null && node !== active && !node.disabled);
  const origin = active.getBoundingClientRect();
  const ox = origin.left + origin.width / 2, oy = origin.top + origin.height / 2;
  const ranked = candidates.map((node) => {
    const rect = node.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - ox, dy = rect.top + rect.height / 2 - oy;
    const primary = dx * direction[0] + dy * direction[1];
    if (primary <= 3) return null;
    const cross = Math.abs(dx * direction[1] - dy * direction[0]);
    return { node, score: primary + cross * 2.2 };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  if (!ranked.length) return false;
  ranked[0].node.focus();
  showControls(true);
  return true;
}

function render(next) {
  state = { ...state, ...next };
  title.textContent = state.title || 'Minova Cinema';
  transport.textContent = state.directPlay === false ? 'Plex optimized playback' : 'Direct Play';
  qualityBadge.textContent = state.directPlay === false ? 'PLEX TRANSCODE' : 'DIRECT PLAY';
  enhancementBadge.textContent = state.enhancementLabel || 'GPU Balanced';
  button('enhancement').textContent = ({ off: 'Upscale Off', balanced: 'GPU Balanced', high: 'ArtCNN High', ultra: 'ArtCNN Ultra' })[state.enhancement] || 'GPU Balanced';
  button('play').textContent = state.paused ? '▶' : '❚❚';
  button('play').setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
  button('mute').textContent = state.muted || state.volume <= 0 ? '🔇' : state.volume < 50 ? '🔉' : '🔊';
  if (!seeking) {
    seek.max = Math.max(1, Number(state.duration) || 1);
    seek.value = Math.min(Number(state.position) || 0, Number(seek.max));
  }
  volume.value = state.muted ? 0 : Number(state.volume) || 0;
  time.textContent = `${clock(state.position)} / ${clock(state.duration)}`;
  const audio = (state.tracks || []).find((track) => track.type === 'audio' && String(track.id) === String(state.audioId));
  const subtitle = (state.tracks || []).find((track) => track.type === 'sub' && String(track.id) === String(state.subtitleId));
  button('audio').textContent = audio ? `Audio: ${audio.title}` : 'Audio';
  button('subtitles').textContent = subtitle ? `Subtitles: ${subtitle.title}` : 'Subtitles: Off';
  root.classList.toggle('loading', Boolean(state.loading));
  root.classList.toggle('error', Boolean(state.error));
  message.querySelector('strong').textContent = state.error || 'Preparing playback…';
  if (state.paused) showControls(true);
}

async function command(action, value) {
  try { render(await window.nativePlayer.command(action, value)); }
  catch (error) { render({ loading: false, error: error.message || String(error) }); }
}

function showTracks(kind) {
  const isAudio = kind === 'audio';
  const tracks = (state.tracks || []).filter((track) => track.type === (isAudio ? 'audio' : 'sub'));
  const current = isAudio ? state.audioId : state.subtitleId;
  trackMenu.innerHTML = `<h3>${isAudio ? 'Audio tracks' : 'Subtitle tracks'}</h3>`;
  if (!isAudio) {
    const off = document.createElement('button');
    off.textContent = 'Off'; off.className = current == null || current === false ? 'selected' : '';
    off.addEventListener('click', () => { trackMenu.hidden = true; command('subtitle', 'no'); });
    trackMenu.appendChild(off);
  }
  for (const track of tracks) {
    const item = document.createElement('button');
    item.textContent = [track.title, track.language, track.codec].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ');
    item.className = String(track.id) === String(current) ? 'selected' : '';
    item.addEventListener('click', () => { trackMenu.hidden = true; command(isAudio ? 'audio' : 'subtitle', track.id); });
    trackMenu.appendChild(item);
  }
  if (!tracks.length) {
    const empty = document.createElement('h3'); empty.textContent = `No ${kind} tracks reported by this stream`; trackMenu.appendChild(empty);
  }
  trackMenu.hidden = false;
  trackMenu.querySelector('button')?.focus();
  showControls(true);
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) {
    if (!event.target.closest('#track-menu')) command('toggle-pause');
    return;
  }
  const action = control.dataset.action;
  if (action === 'back') window.nativePlayer.close();
  else if (action === 'play') command('toggle-pause');
  else if (action === 'rewind') command('seek-relative', -10);
  else if (action === 'forward') command('seek-relative', 10);
  else if (action === 'mute') command('mute');
  else if (action === 'audio') showTracks('audio');
  else if (action === 'subtitles') showTracks('subtitle');
  else if (action === 'resync') command('resync');
  else if (action === 'fullscreen') window.nativePlayer.fullscreen();
  else if (action === 'enhancement') {
    const modes = ['off', 'balanced', 'high', 'ultra'];
    command('enhancement', modes[(modes.indexOf(state.enhancement) + 1) % modes.length]);
  }
  showControls();
});

seek.addEventListener('pointerdown', () => { seeking = true; showControls(true); });
seek.addEventListener('input', () => { time.textContent = `${clock(seek.value)} / ${clock(state.duration)}`; });
seek.addEventListener('change', () => { seeking = false; command('seek-absolute', Number(seek.value)); });
volume.addEventListener('input', () => command('volume', Number(volume.value)));

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input[type="range"]') && !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); window.nativePlayer.close(); }
  else if (event.key === ' ' || event.key === 'Enter' && event.target === document.body) { event.preventDefault(); command('toggle-pause'); }
  else if (event.key.startsWith('Arrow') && focusDirectional(event.key)) { event.preventDefault(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); command('seek-relative', -10); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); command('seek-relative', 10); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); command('volume', Math.min(100, state.volume + 5)); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); command('volume', Math.max(0, state.volume - 5)); }
  else if (event.key.toLowerCase() === 'm') command('mute');
  else if (event.key.toLowerCase() === 'f' || event.key === 'F11') { event.preventDefault(); window.nativePlayer.fullscreen(); }
});

for (const eventName of ['mousemove', 'pointerdown']) document.addEventListener(eventName, () => showControls());
window.nativePlayer.onState(render);
window.nativePlayer.onNotice((text) => {
  notice.textContent = text; notice.hidden = false; showControls();
  setTimeout(() => { notice.hidden = true; }, 3200);
});
window.nativePlayer.state().then((initial) => {
  render(initial || {});
  button('play')?.focus();
}).catch((error) => render({ loading: false, error: error.message }));
