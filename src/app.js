const appRoot = document.getElementById('app');
const toastNode = document.getElementById('toast');

const state = {
  config: null,
  catalog: null,
  loading: true,
  error: null,
  tab: 'home',
  layout: 'rows',
  genre: null,
  hero: null,
  route: { type: 'browse' },
  routeStack: [],
  search: '',
  hls: null,
  timelineTimer: null,
  catalogSyncedAt: 0,
  syncing: false,
  manualSetup: false,
  plexSignIn: { status: 'idle', code: '', authorizationUrl: '', servers: [], error: null },
  update: { status: 'idle', currentVersion: '', availableVersion: null, progress: 0, message: 'Automatic update checks are enabled.' },
};
let dismissedUpdateVersion = null;

const tabs = [
  ['home', 'Home'], ['movies', 'Movies'], ['series', 'Series'],
  ['collections', 'Collections'], ['watchlist', 'Watchlist'], ['search', '⌕'],
];

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function art(path) {
  const builtInAssets = {
    'asset:minova-symbol-color.svg': '../assets/minova-symbol-color.svg',
    'asset:minova-cinema-wordmark.png': '../assets/minova-cinema-wordmark.png',
  };
  return builtInAssets[path] || (path ? `minova-plex://media/${base64Url(path)}` : '');
}

function formatTime(ms) {
  if (!ms) return '';
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim() : `${minutes} min`;
}

function formatClock(secondsValue) {
  const seconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function metadata(item) {
  return [item?.year, item?.contentRating, item?.durationMs ? formatTime(item.durationMs) : null].filter(Boolean).join('  •  ');
}

function timeLeft(item) {
  const remaining = Math.max(0, (item.durationMs || 0) - (item.viewOffsetMs || 0));
  return remaining ? `${formatTime(remaining)} left` : item.secondaryTitle || metadata(item);
}

function showToast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastNode.classList.remove('show'), 2600);
}

function errorMessage(error) {
  return (error?.message || String(error || 'Something went wrong.'))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:Error|TypeError):\s*/i, '');
}

function updateButtonLabel() {
  if (state.update?.status === 'checking') return 'Checking…';
  if (state.update?.status === 'downloading') return `Downloading… ${state.update.progress || 0}%`;
  return 'Check for updates';
}

function refreshUpdateDialog() {
  const dialog = document.getElementById('update-dialog');
  if (!dialog) return;
  const status = state.update || {};
  const shouldShow = ['available', 'downloading', 'downloaded'].includes(status.status)
    && (status.status === 'downloading' || status.availableVersion !== dismissedUpdateVersion);
  const wasHidden = dialog.hidden;
  dialog.hidden = !shouldShow;
  if (!shouldShow) return;
  const title = document.getElementById('update-dialog-title');
  const message = document.getElementById('update-dialog-message');
  const version = document.getElementById('update-dialog-version');
  const progress = dialog.querySelector('.update-dialog-progress');
  const progressBar = progress.querySelector('span');
  const dismiss = dialog.querySelector('[data-action="dismiss-update"]');
  const install = dialog.querySelector('[data-action="install-update"]');
  if (status.status === 'available') {
    title.textContent = 'A new version is available';
    message.textContent = 'Update directly from the official Minova Cinema GitHub release. Your Plex connection and preferences stay in place.';
    install.textContent = 'Update'; install.disabled = false; dismiss.hidden = false; progress.hidden = true;
  } else if (status.status === 'downloading') {
    title.textContent = 'Updating Minova Cinema';
    message.textContent = 'The update is downloading securely. The app will restart automatically when it is ready.';
    install.textContent = `Downloading ${status.progress || 0}%`; install.disabled = true; dismiss.hidden = true; progress.hidden = false;
    progressBar.style.width = `${status.progress || 0}%`;
  } else {
    title.textContent = 'Update ready to install';
    message.textContent = 'Restart Minova Cinema to finish installing the update.';
    install.textContent = 'Update & restart'; install.disabled = false; dismiss.hidden = false; progress.hidden = true;
  }
  version.textContent = `Version ${status.availableVersion || '—'} · currently ${status.currentVersion || '—'}`;
  if (wasHidden) setTimeout(() => install.focus(), 0);
}

function refreshUpdateCard() {
  const card = document.querySelector('.update-card');
  if (!card) return;
  const status = state.update || {};
  const message = card.querySelector('[data-update-message]');
  const version = card.querySelector('[data-update-version]');
  const progress = card.querySelector('.update-progress');
  const progressBar = card.querySelector('.update-progress span');
  const check = card.querySelector('[data-action="check-update"]');
  const install = card.querySelector('[data-action="install-update"]');
  if (message) message.textContent = status.message || 'Automatic update checks are enabled.';
  if (version) version.textContent = `Installed version ${status.currentVersion || '—'} · Updates from GitHub Releases`;
  if (progress) progress.hidden = status.status !== 'downloading';
  if (progressBar) progressBar.style.width = `${status.progress || 0}%`;
  if (check) {
    check.textContent = updateButtonLabel();
    check.disabled = ['checking', 'downloading'].includes(status.status);
  }
  if (install) {
    install.hidden = !['available', 'downloaded'].includes(status.status);
    install.textContent = status.status === 'available' ? 'Update now' : 'Install and restart';
  }
}

function logoMarkup(size = 'full') {
  return `<div class="brand-lockup ${size}"><img class="symbol" src="../assets/minova-symbol-color.svg" alt=""><span class="wordpair"><img src="../assets/minova-wordmark.png" alt="Minova"><img src="../assets/cinema-wordmark.png" alt="Cinema"></span></div>`;
}

function placeholderArt() {
  return `<span class="placeholder-art"><img src="../assets/minova-symbol-color.svg" alt=""></span>`;
}

function card(item, { landscape = false, collection = false } = {}) {
  if (collection) return collectionCard(item);
  const imagePath = landscape ? item.backdropPath || item.posterPath : item.posterPath || item.backdropPath;
  const subtitle = item.progress > 0 ? timeLeft(item) : item.secondaryTitle || metadata(item);
  return `<button class="media-card${landscape ? ' landscape' : ''}" data-action="open" data-key="${esc(item.ratingKey)}" data-focus-key="${esc(item.ratingKey)}" aria-label="${esc(item.title)}">
    ${imagePath ? `<img src="${art(imagePath)}" alt="" loading="lazy">` : placeholderArt()}
    ${item.isWatched ? '<span class="badge">✓</span>' : ''}
    <span class="card-overlay"><span class="card-title">${esc(item.title)}</span><span class="card-subtitle">${esc(subtitle)}</span></span>
    ${item.progress > 0 && item.progress < .98 ? `<span class="progress"><span style="width:${Math.round(item.progress * 100)}%"></span></span>` : ''}
  </button>`;
}

function collectionCard(item) {
  const subtitle = `${item.childCount ?? 0} ${item.childCount === 1 ? 'title' : 'titles'}${item.libraryTitle ? `  •  ${item.libraryTitle}` : ''}`;
  return `<button class="media-card collection-card" data-action="collection" data-key="${esc(item.ratingKey)}" data-focus-key="${esc(item.ratingKey)}" aria-label="${esc(item.title)}">
    <span class="collection-art">${item.posterPath ? `<img src="${art(item.posterPath)}" alt="${esc(item.title)} collection poster" loading="lazy">` : placeholderArt()}</span>
    <span class="collection-meta"><span class="collection-title">${esc(item.title)}</span><span class="collection-subtitle">${esc(subtitle)}</span></span>
  </button>`;
}

function header() {
  const showLayout = state.route.type === 'browse' && ['movies', 'series', 'watchlist'].includes(state.tab);
  const layoutLabel = state.layout === 'rows' ? 'Switch to grid view' : 'Switch to row view';
  const primaryTabs = tabs.filter(([id]) => id !== 'search');
  return `<header class="topbar">
    <div class="top-brand">${logoMarkup('compact')}</div>
    <nav class="nav" aria-label="Main navigation">
      <div class="nav-primary">${primaryTabs.map(([id, label]) => `<button class="nav-button ${state.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}" aria-label="${label}">${label}</button>`).join('')}</div>
      <div class="nav-tools" aria-label="View and application tools">
        <button class="nav-button nav-icon ${state.tab === 'search' ? 'active' : ''}" data-action="tab" data-tab="search" aria-label="Search" title="Search (Ctrl+F)">⌕</button>
        ${showLayout ? `<button class="nav-button nav-icon layout-button" data-action="layout" aria-label="${layoutLabel}" title="${layoutLabel}">${state.layout === 'rows' ? '▦' : '☰'}</button>` : ''}
        <button class="nav-button nav-icon ${state.route.type === 'settings' ? 'active' : ''}" data-action="settings" aria-label="Settings">⚙</button>
      </div>
    </nav>
  </header>`;
}

function heroMarkup(item, index = 0, count = 0) {
  if (!item) return '<div class="hero"></div>';
  return `<section class="hero"><div class="hero-copy">
    <div class="carousel-kicker">${Array.from({ length: Math.min(count, 10) }, (_, i) => `<span class="dot ${i === index ? 'active' : ''}"></span>`).join('')}<span class="keyboard-hint">← → Browse  ·  ↓ Shelves</span></div>
    <h1 id="hero-title">${esc(item.title)}</h1>
    <p class="meta" id="hero-meta">${esc(metadata(item))}</p>
    <p class="summary" id="hero-summary">${esc(item.summary || item.tagline || '')}</p>
    <div class="actions">
      ${item.kind !== 'show' ? `<button class="primary" data-action="play" data-key="${esc(item.ratingKey)}">▶ &nbsp;${item.progress > 0 ? 'Resume' : 'Play'}</button>` : ''}
      <button class="secondary" data-action="open" data-key="${esc(item.ratingKey)}">More info</button>
    </div>
  </div></section>`;
}

function shelf(title, items, landscape = false) {
  if (!items?.length) return '';
  const visibleItems = items.slice(0, 80);
  return `<section class="section"><div class="section-heading"><h2 class="section-title">${esc(title)}</h2><span>${visibleItems.length} ${visibleItems.length === 1 ? 'title' : 'titles'}</span></div><div class="rail-shell">
    <button class="rail-arrow rail-arrow-left is-hidden" type="button" data-action="rail-scroll" data-direction="-1" tabindex="-1" aria-label="Scroll ${esc(title)} left">‹</button>
    <div class="rail">${visibleItems.map((item) => card(item, { landscape })).join('')}</div>
    <button class="rail-arrow rail-arrow-right" type="button" data-action="rail-scroll" data-direction="1" tabindex="-1" aria-label="Scroll ${esc(title)} right">›</button>
  </div></section>`;
}

function homeShelves() {
  const { movies, shows, continueWatching, watchlist } = state.catalog;
  const recentlyAdded = [...movies, ...shows].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const picks = [...movies.filter((item) => !item.isWatched), ...shows.filter((item) => !item.isWatched)];
  return [
    shelf('Continue Watching', continueWatching, true),
    shelf('Top Picks for You', picks),
    shelf('Recently Added', recentlyAdded),
    shelf('Your Watchlist', watchlist),
    shelf('Movies', movies),
    shelf('Series', shows),
  ].join('');
}

function genresFor(items) {
  return [...new Set(items.flatMap((item) => item.genres || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sortAlphabetically(items) {
  return [...items].sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  }));
}

function alphabetLetter(item) {
  const first = String(item?.title || '').trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

function alphabeticalGrid(items) {
  const groups = new Map();
  for (const item of sortAlphabetically(items)) {
    const letter = alphabetLetter(item);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(item);
  }
  const letters = [...groups.keys()].sort((left, right) => left === '#' ? 1 : right === '#' ? -1 : left.localeCompare(right));
  const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `<button type="button" data-action="alpha-jump" data-letter="${letter}" ${groups.has(letter) ? '' : 'disabled'} aria-label="Jump to ${letter}">${letter}</button>`).join('');
  return `<div class="alphabetical-layout"><div class="alphabetical-groups">${letters.map((letter) => {
    const group = groups.get(letter);
    return `<section class="alpha-group" data-alpha-group="${letter}"><div class="alpha-heading"><h2>${letter}</h2><span>${group.length} ${group.length === 1 ? 'title' : 'titles'}</span></div><div class="grid">${group.map((item) => card(item)).join('')}</div></section>`;
  }).join('')}</div><aside class="alpha-index" aria-label="Alphabetical jump">${index}</aside></div>`;
}

function rowsFor(items) {
  const genres = genresFor(items);
  if (state.genre) return shelf(state.genre, sortAlphabetically(items.filter((item) => item.genres?.includes(state.genre))));
  const result = [shelf('All titles', sortAlphabetically(items))];
  for (const genre of genres) {
    const matching = items.filter((item) => item.genres?.includes(genre));
    if (matching.length) result.push(shelf(genre, sortAlphabetically(matching)));
  }
  return result.join('');
}

function toolbar(title, items) {
  const genres = genresFor(items);
  const filteredCount = state.genre ? items.filter((item) => item.genres?.includes(state.genre)).length : items.length;
  const countLabel = state.genre ? `${filteredCount} of ${items.length} titles` : `${items.length} ${items.length === 1 ? 'title' : 'titles'}`;
  return `<div class="toolbar"><div class="toolbar-title"><h1>${esc(title)}</h1><span>${countLabel} · ${state.layout === 'grid' ? 'A–Z grid' : 'genre rows'}</span></div>
    <label class="genre-filter"><span>Genre</span><select id="genre-filter" aria-label="Filter by genre"><option value="">All genres</option>${genres.map((genre) => `<option value="${esc(genre)}" ${state.genre === genre ? 'selected' : ''}>${esc(genre)}</option>`).join('')}</select></label>
  </div>`;
}

function collectionPage() {
  const collections = state.catalog.collections || [];
  return `<div class="collections-page"><h1 class="page-heading">Collections</h1><p class="page-subheading">Movie and series collections from Plex</p>
    <div class="grid collection-grid">${collections.map((item) => card(item, { collection: true })).join('')}</div>
    ${collections.length ? '' : '<div class="empty">No collections were found.</div>'}
  </div>`;
}

function searchPage() {
  const query = state.search.trim().toLowerCase();
  const all = [...state.catalog.movies, ...state.catalog.shows];
  const results = query ? all.filter((item) => [item.title, item.summary, ...(item.genres || [])].some((value) => String(value || '').toLowerCase().includes(query))) : [];
  return `<div class="search-page"><h1 class="page-heading">Search</h1><p class="page-subheading">Search your complete Plex library</p>
    <input id="search-input" class="search-box" value="${esc(state.search)}" placeholder="Movies, series, genres…" autocomplete="off" autofocus>
    <div id="search-results" class="grid">${results.map((item) => card(item)).join('')}</div>
    ${query && !results.length ? '<div class="empty">No matching titles.</div>' : ''}
  </div>`;
}

function browsePage() {
  let body;
  let items = [];
  if (state.tab === 'home') body = `<div class="browse-scroll home-shelves">${homeShelves()}</div>`;
  else if (state.tab === 'collections') body = collectionPage();
  else if (state.tab === 'search') body = searchPage();
  else {
    items = state.tab === 'movies' ? state.catalog.movies : state.tab === 'series' ? state.catalog.shows : state.catalog.watchlist;
    const filtered = state.genre ? items.filter((item) => item.genres?.includes(state.genre)) : items;
    const title = state.tab === 'movies' ? 'Movies' : state.tab === 'series' ? 'Series' : 'Watchlist';
    body = `<div class="browse-scroll">${toolbar(title, items)}${state.layout === 'grid'
      ? (['movies', 'series'].includes(state.tab) ? alphabeticalGrid(filtered) : `<div class="grid">${sortAlphabetically(filtered).map((item) => card(item)).join('')}</div>`) : rowsFor(items)}
      ${filtered.length ? '' : `<div class="empty">No ${title.toLowerCase()} were found.</div>`}</div>`;
  }
  return `<div class="screen app-shell">${header()}<div class="content">${body}</div></div>`;
}

function onboarding() {
  const remembered = Boolean(state.config?.connected);
  const signIn = state.plexSignIn || { status: 'idle' };
  const statusMarkup = (() => {
    if (signIn.status === 'starting') return `<div class="plex-auth-panel"><span class="auth-spinner"></span><div><strong>Opening Plex sign-in…</strong><small>Requesting a secure link code.</small></div></div>`;
    if (signIn.status === 'waiting') return `<div class="plex-auth-panel waiting"><span class="auth-code">${esc(signIn.code)}</span><div><strong>Finish signing in through Plex</strong><small>Your browser has opened. Approve Minova there, or enter code <b>${esc(signIn.code)}</b> at plex.tv/link.</small><div class="auth-actions"><button class="secondary" type="button" data-action="plex-open">Open Plex website</button><button class="secondary" type="button" data-action="plex-cancel">Cancel</button></div></div></div>`;
    if (signIn.status === 'discovering') return `<div class="plex-auth-panel"><span class="auth-spinner"></span><div><strong>Finding your Plex servers…</strong><small>Sign-in was approved. Minova is checking the available connections.</small></div></div>`;
    if (signIn.status === 'connecting') return `<div class="plex-auth-panel"><span class="auth-spinner"></span><div><strong>Connecting to ${esc(signIn.serverName)}…</strong><small>Testing the fastest available server address.</small></div></div>`;
    if (signIn.status === 'select-server') return `<div class="plex-server-picker"><strong>Choose a Plex server</strong><small>Local connections are preferred automatically.</small>${signIn.servers.map((server) => `<button class="secondary plex-server-button" type="button" data-action="plex-select-server" data-server-id="${esc(server.id)}"><span>${esc(server.name)}</span><small>${server.owned ? 'Owned' : 'Shared'}</small></button>`).join('')}<button class="secondary" type="button" data-action="plex-cancel">Cancel</button></div>`;
    return `<button class="primary plex-sign-in-button" type="button" data-action="plex-sign-in" autofocus>${signIn.status === 'error' ? 'Try Plex sign-in again' : 'Sign in with Plex'}</button>
      <span class="plex-sign-in-note">Opens the official Plex website in your default browser. No Plex app or copied token required.</span>`;
  })();
  return `<div class="screen onboarding"><div class="connect-card">${logoMarkup()}
    <h1>Connect your Plex library</h1>
    <p>Authorize Minova securely with Plex, then choose from the servers available to your account. Your selected connection is encrypted by Windows and restored automatically.</p>
    ${statusMarkup}
    ${signIn.status === 'error' ? `<p class="error">${esc(signIn.error)}</p>` : ''}
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    <button class="manual-setup-toggle" type="button" data-action="toggle-manual">${state.manualSetup ? 'Hide advanced manual setup' : 'Advanced manual setup'}</button>
    ${state.manualSetup ? `<form id="connect-form" class="manual-connect-form">
      <p>For reverse proxies, Tailscale, or custom server addresses.</p>
      <label class="field"><span>Plex server</span><input id="server" value="${esc(state.config?.server || '')}" placeholder="192.168.1.10:32400" autocomplete="url" required></label>
      <label class="field"><span>X-Plex-Token</span><span class="token-row"><input id="token" type="password" placeholder="${remembered ? 'Saved securely — leave blank to reuse it' : 'Paste your Plex token'}" autocomplete="off" ${remembered ? '' : 'required'}><button class="secondary token-toggle" type="button" data-action="toggle-token" aria-label="Show Plex token">Show</button></span></label>
      <div class="connect-footer"><span class="connection-note">Windows encrypted &nbsp;•&nbsp; Auto reconnect &nbsp;•&nbsp; Direct Play</span><button class="primary connect-button" type="submit">Connect manually</button></div>
    </form>` : ''}
  </div></div>`;
}

function loading(message = 'Loading your cinema…') {
  return `<div class="screen loading-screen"><div class="loader"><img src="../assets/minova-symbol-color.svg" alt=""><strong>${esc(message)}</strong><span>Connecting directly to Plex</span></div></div>`;
}

function settingsPage() {
  const serverLabel = state.config.server || 'Visual demo';
  const connectionLabel = state.config.demoMode ? 'Demo mode' : 'Connected';
  const securityLabel = state.config.demoMode ? 'Preview catalog' : 'Windows encrypted';
  return `<div class="screen app-shell">${header()}<div class="content"><div class="settings-page">
    <div class="settings-heading"><div><h1 class="page-heading">Settings</h1><p class="page-subheading">Playback, connection, and desktop controls</p></div><div class="settings-status"><span class="status-dot"></span>${connectionLabel}<small>${securityLabel}</small></div></div>
    <div class="settings-grid">
      <section class="settings-card playback-card"><div class="settings-card-head"><span class="settings-icon">▶</span><div><span class="settings-kicker">Native playback</span><h2>libmpv picture</h2></div></div>
        <p>Original uses Direct Play whenever possible. Video is decoded and rendered by native mpv rather than Chromium.</p>
        <label class="field"><span>Preferred quality</span><select id="quality">
          ${[['original','Original / Direct Play'],['4k','4K · 40 Mbps'],['1080','1080p · 12 Mbps'],['720','720p · 4 Mbps'],['480','480p · 2 Mbps']].map(([value,label]) => `<option value="${value}" ${state.config.quality === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="field"><span>GPU enhancement</span><select id="enhancement">
          ${[['off','Off'],['balanced','Balanced GPU scaling'],['high','ArtCNN High'],['ultra','ArtCNN Ultra']].map(([value,label]) => `<option value="${value}" ${state.config.enhancement === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label><button class="primary settings-button" data-action="save-settings">Save playback quality</button>
      </section>
      <section class="settings-card connection-card"><div class="settings-card-head"><span class="settings-icon">●</span><div><span class="settings-kicker">Plex</span><h2>Media Server</h2></div></div>
        <div class="connection-details"><span>Connection</span><strong>${connectionLabel}</strong><span>Server</span><strong class="server-value">${esc(serverLabel)}</strong></div>
        <div class="secure-note"><span>✓</span><div><strong>Remembered securely</strong><small>Your token is encrypted by Windows and restored automatically.</small></div></div>
        <div class="settings-actions"><button class="secondary settings-button" data-action="sync">Sync Plex now</button>${state.config.demoMode ? '' : '<button class="danger settings-button" data-action="disconnect">Disconnect</button>'}</div>
      </section>
      <section class="settings-card window-card"><div class="settings-card-head"><span class="settings-icon">⛶</span><div><span class="settings-kicker">Display</span><h2>Window mode</h2></div></div>
        <p>Use the normal resizable window or switch to a distraction-free cinema view.</p>
        <button class="secondary settings-button" data-action="fullscreen">Toggle full screen <span class="button-hint">F11</span></button>
      </section>
      <section class="settings-card update-card"><div class="settings-card-head"><span class="settings-icon">↻</span><div><span class="settings-kicker">Application</span><h2>Automatic updates</h2></div></div>
        <p data-update-message>${esc(state.update?.message || 'Automatic update checks are enabled.')}</p>
        <div class="update-progress" ${state.update?.status === 'downloading' ? '' : 'hidden'}><span style="width:${Number(state.update?.progress || 0)}%"></span></div>
        <div class="settings-actions"><button class="secondary settings-button" data-action="check-update" ${['checking','downloading'].includes(state.update?.status) ? 'disabled' : ''}>${esc(updateButtonLabel())}</button><button class="primary settings-button" data-action="install-update" ${state.update?.status === 'downloaded' ? '' : 'hidden'}>Install and restart</button></div>
        <small class="update-version" data-update-version>Installed version ${esc(state.update?.currentVersion || '—')} · Updates from GitHub Releases</small>
      </section>
      <section class="settings-card controls-card"><div class="settings-card-head"><span class="settings-icon">⌨</span><div><span class="settings-kicker">Navigation</span><h2>Desktop controls</h2></div></div>
        <div class="shortcut-grid"><div><kbd>← ↑ ↓ →</kbd><span>Move</span></div><div><kbd>Enter</kbd><span>Select</span></div><div><kbd>A–Z</kbd><span>Jump in grid</span></div><div><kbd>Ctrl + F</kbd><span>Search</span></div><div><kbd>Esc</kbd><span>Back</span></div><div><kbd>F11</kbd><span>Full screen</span></div></div>
      </section>
    </div>
    <p class="settings-footer">Minova Cinema Desktop · Your library stays between this PC and Plex.</p>
  </div></div></div>`;
}

function detailPage(item, children = []) {
  const inWatchlist = state.catalog.watchlist.some((entry) => entry.ratingKey === item.ratingKey);
  const bg = item.backdropPath || item.posterPath;
  return `<div class="screen detail-page">
    <div class="detail-bg">${bg ? `<img src="${art(bg)}" alt="" aria-hidden="true">` : ''}</div>
    <button class="back-button" data-action="back" aria-label="Back">←</button>
    <section class="detail-copy">
      <div class="eyebrow">${esc(item.kind === 'show' ? 'Series' : item.kind === 'episode' ? item.secondaryTitle || 'Episode' : 'Movie')}</div>
      <h1>${esc(item.title)}</h1><p class="meta">${esc(metadata(item))}</p>
      ${item.genres?.length ? `<p class="genres">${esc(item.genres.join('  •  '))}</p>` : ''}
      ${item.tagline ? `<p class="tagline">${esc(item.tagline)}</p>` : ''}
      <p class="detail-summary">${esc(item.summary || 'No summary is available from Plex.')}</p>
      <div class="actions">
        ${item.kind !== 'show' && item.kind !== 'season' ? `<button class="primary" data-action="play" data-key="${esc(item.ratingKey)}">▶ &nbsp;${item.progress > 0 ? 'Resume' : 'Play'}</button>` : ''}
        <button class="secondary" data-action="watchlist" data-key="${esc(item.ratingKey)}" data-provider="${esc(item.providerRatingKey || '')}" data-value="${inWatchlist ? 'false' : 'true'}">${inWatchlist ? 'Remove from Plex Watchlist' : 'Add to Plex Watchlist'}</button>
        <button class="secondary" data-action="watched" data-key="${esc(item.ratingKey)}" data-value="${item.isWatched ? 'false' : 'true'}">${item.isWatched ? 'Mark unwatched' : 'Mark watched'}</button>
      </div>
    </section>
    ${children.length ? `<section class="detail-section">${shelf(item.kind === 'show' ? 'Seasons' : 'Episodes', children)}</section>` : ''}
    ${item.credits?.length ? `<section class="detail-section cast-section"><h2 class="section-title">Cast & Crew</h2><div class="rail">${item.credits.slice(0,30).map((person) => `<div class="credit-card" tabindex="0" aria-label="${esc(`${person.name}, ${person.role}`)}"><span class="credit-avatar">${person.imagePath ? `<img src="${art(person.imagePath)}" alt="${esc(person.name)}" loading="lazy">` : `<span class="credit-initial">${esc(person.name?.[0]?.toUpperCase() || '?')}</span>`}</span><strong>${esc(person.name)}</strong><span class="credit-role">${esc(person.role)}</span></div>`).join('')}</div></section>` : ''}
  </div>`;
}

function collectionDetailPage(collection, members) {
  return `<div class="screen app-shell">${header()}<div class="content"><div class="collections-page"><button class="back-button" data-action="back" aria-label="Back">←</button>
    <h1 class="page-heading">${esc(collection.title)}</h1><p class="page-subheading">${members.length} titles in this Plex collection</p>
    <div class="grid">${members.map((item) => card(item)).join('')}</div></div></div></div>`;
}

function playerPage(payload) {
  return `<div class="screen player-page native-player-page" aria-label="Native libmpv playback">
    <div class="native-player-underlay"><img src="../assets/minova-symbol-color.svg" alt=""><span>Native libmpv playback</span></div>
  </div>`;
}

function render() {
  if (!state.config) { appRoot.innerHTML = loading('Starting Minova Cinema…'); refreshUpdateDialog(); return; }
  if (!state.config.connected && !state.config.demoMode) { appRoot.innerHTML = onboarding(); bindPage(); refreshUpdateDialog(); return; }
  if (state.loading) { appRoot.innerHTML = loading(); refreshUpdateDialog(); return; }
  if (state.route.type === 'settings') appRoot.innerHTML = settingsPage();
  else if (state.route.type === 'detail') appRoot.innerHTML = detailPage(state.route.item, state.route.children || []);
  else if (state.route.type === 'collection') appRoot.innerHTML = collectionDetailPage(state.route.collection, state.route.members);
  else if (state.route.type === 'player') appRoot.innerHTML = playerPage(state.route.payload);
  else appRoot.innerHTML = browsePage();
  bindPage();
  refreshUpdateDialog();
}

function bindPage() {
  document.getElementById('connect-form')?.addEventListener('submit', connect);
  document.getElementById('genre-filter')?.addEventListener('change', (event) => {
    state.genre = event.target.value || null;
    render();
    requestAnimationFrame(() => document.getElementById('genre-filter')?.focus({ preventScroll: true }));
  });
  document.getElementById('search-input')?.addEventListener('input', (event) => {
    state.search = event.target.value;
    const all = [...state.catalog.movies, ...state.catalog.shows];
    const query = state.search.trim().toLowerCase();
    const results = query ? all.filter((item) => [item.title, item.summary, ...(item.genres || [])].some((value) => String(value || '').toLowerCase().includes(query))) : [];
    document.getElementById('search-results').innerHTML = results.map((item) => card(item)).join('');
  });
  document.querySelectorAll('.media-card').forEach((node) => node.addEventListener('focus', () => {
    const key = node.dataset.key;
    const item = [...state.catalog.movies, ...state.catalog.shows, ...state.catalog.continueWatching].find((entry) => entry.ratingKey === key);
    if (state.tab === 'home' && item) updateHero(item);
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }));
  document.querySelectorAll('.rail-shell').forEach((shell) => {
    const rail = shell.querySelector('.rail');
    if (!rail) return;
    const refresh = () => updateRailArrows(shell);
    rail.addEventListener('scroll', refresh, { passive: true });
    rail.addEventListener('wheel', (event) => {
      if (rail.scrollWidth <= rail.clientWidth + 2 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      rail.scrollBy({ left: event.deltaY, behavior: 'auto' });
    }, { passive: false });
    requestAnimationFrame(refresh);
  });
  const autofocus = document.querySelector('[autofocus]');
  if (autofocus) autofocus.focus();
  else if (document.activeElement === document.body) initialFocus()?.focus();
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) initialFocus()?.focus();
  });
}

function updateRailArrows(shell) {
  const rail = shell?.querySelector('.rail');
  if (!rail) return;
  const left = shell.querySelector('.rail-arrow-left');
  const right = shell.querySelector('.rail-arrow-right');
  const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const canGoLeft = rail.scrollLeft > 6;
  const canGoRight = maximum - rail.scrollLeft > 6;
  left?.classList.toggle('is-hidden', !canGoLeft);
  right?.classList.toggle('is-hidden', !canGoRight);
  if (left) left.disabled = !canGoLeft;
  if (right) right.disabled = !canGoRight;
}

function scrollRail(button) {
  const shell = button.closest('.rail-shell');
  const rail = shell?.querySelector('.rail');
  if (!rail) return;
  const direction = Number(button.dataset.direction) || 1;
  rail.scrollBy({ left: direction * Math.max(280, rail.clientWidth * .82), behavior: 'smooth' });
  setTimeout(() => updateRailArrows(shell), 360);
}

function jumpToLetter(letter) {
  const normalized = String(letter || '').toUpperCase();
  const group = [...document.querySelectorAll('[data-alpha-group]')].find((node) => node.dataset.alphaGroup === normalized);
  if (!group) {
    showToast(`No ${state.tab === 'series' ? 'series' : 'movies'} beginning with ${normalized}.`);
    return false;
  }
  group.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const first = group.querySelector('.media-card');
  setTimeout(() => first?.focus({ preventScroll: true }), 180);
  return true;
}

function visibleElements(selector, root = document) {
  return [...root.querySelectorAll(selector)].filter((node) => node.offsetParent !== null && !node.disabled);
}

function initialFocus() {
  if (state.route.type === 'detail') return document.querySelector('.detail-copy .primary') || document.querySelector('.detail-copy .secondary') || document.querySelector('.back-button');
  if (state.route.type === 'collection') return document.querySelector('.collections-page .back-button, .collections-page .media-card');
  if (state.route.type === 'settings') return document.querySelector('.topbar [data-action="settings"], #quality');
  if (state.route.type === 'player') return null;
  return document.querySelector(`.topbar [data-tab="${state.tab}"]`) || document.querySelector('.topbar button');
}

function focusNode(node) {
  if (!node) return false;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

function closestHorizontal(nodes, source) {
  if (!nodes.length) return null;
  const rect = source.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  return [...nodes].sort((a, b) => {
    const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
    return Math.abs(ar.left + ar.width / 2 - x) - Math.abs(br.left + br.width / 2 - x);
  })[0];
}

function focusHeaderFor(active) {
  const currentTab = active?.dataset?.tab || state.tab;
  return focusNode(document.querySelector(`.topbar [data-tab="${currentTab}"]`) || document.querySelector(`.topbar [data-tab="${state.tab}"]`) || document.querySelector('.topbar button'));
}

function navigateRail(active, key) {
  const rail = active.closest('.rail');
  if (!rail) return false;
  const cards = visibleElements('.media-card, .credit-card[tabindex="0"]', rail);
  const index = cards.indexOf(active);
  if (key === 'ArrowLeft') return focusNode(cards[index - 1]);
  if (key === 'ArrowRight') return focusNode(cards[index + 1]);
  const rails = visibleElements('.rail');
  const railIndex = rails.indexOf(rail);
  if (key === 'ArrowUp') {
    if (railIndex > 0) {
      const previousCards = visibleElements('.media-card, .credit-card[tabindex="0"]', rails[railIndex - 1]);
      return focusNode(closestHorizontal(previousCards, active));
    }
    return focusNode(document.querySelector('.hero .primary, .hero .secondary, #genre-filter')) || focusHeaderFor(active);
  }
  if (key === 'ArrowDown' && railIndex >= 0 && railIndex < rails.length - 1) {
    const nextCards = visibleElements('.media-card, .credit-card[tabindex="0"]', rails[railIndex + 1]);
    return focusNode(closestHorizontal(nextCards, active));
  }
  return false;
}

function navigateGrid(active, key) {
  const grid = active.closest('.grid');
  if (!grid) return false;
  const cards = visibleElements('.media-card', grid);
  const index = cards.indexOf(active);
  if (index < 0) return false;
  const group = active.closest('.alpha-group');
  const groups = group ? visibleElements('.alpha-group') : [];
  const groupIndex = groups.indexOf(group);
  if (key === 'ArrowLeft') {
    if (index > 0) return focusNode(cards[index - 1]);
    if (groupIndex > 0) return focusNode(visibleElements('.media-card', groups[groupIndex - 1]).at(-1));
    return false;
  }
  if (key === 'ArrowRight') {
    if (index < cards.length - 1) return focusNode(cards[index + 1]);
    if (groupIndex >= 0 && groupIndex < groups.length - 1) return focusNode(visibleElements('.media-card', groups[groupIndex + 1])[0]);
    return false;
  }
  const activeRect = active.getBoundingClientRect();
  const rows = [];
  for (const cardNode of cards) {
    const rect = cardNode.getBoundingClientRect();
    let row = rows.find((candidate) => Math.abs(candidate.top - rect.top) < 8);
    if (!row) { row = { top: rect.top, nodes: [] }; rows.push(row); }
    row.nodes.push(cardNode);
  }
  rows.sort((a, b) => a.top - b.top);
  const rowIndex = rows.findIndex((row) => row.nodes.includes(active));
  if (key === 'ArrowUp') {
    if (rowIndex > 0) return focusNode(closestHorizontal(rows[rowIndex - 1].nodes, active));
    if (groupIndex > 0) {
      const previous = visibleElements('.media-card', groups[groupIndex - 1]);
      return focusNode(closestHorizontal(previous.slice(-Math.max(1, rows[0]?.nodes.length || 1)), active));
    }
    if (grid.id === 'search-results') return focusNode(document.getElementById('search-input'));
    return focusNode(document.getElementById('genre-filter')) || focusHeaderFor(active);
  }
  if (key === 'ArrowDown' && rowIndex < rows.length - 1) {
    return focusNode(closestHorizontal(rows[rowIndex + 1].nodes, active));
  }
  if (key === 'ArrowDown' && groupIndex >= 0 && groupIndex < groups.length - 1) {
    return focusNode(closestHorizontal(visibleElements('.media-card', groups[groupIndex + 1]), active));
  }
  return false;
}

function navigateDpad(key) {
  const active = document.activeElement;
  if (!active || active === document.body) return focusNode(initialFocus());

  if (active.matches('#server')) {
    if (key === 'ArrowDown') return focusNode(document.getElementById('token'));
    return false;
  }
  if (active.matches('#token')) {
    if (key === 'ArrowUp') return focusNode(document.getElementById('server'));
    if (key === 'ArrowRight') return focusNode(document.querySelector('.token-toggle'));
    if (key === 'ArrowDown') return focusNode(document.querySelector('.connect-button'));
    return false;
  }
  if (active.matches('.token-toggle')) {
    if (key === 'ArrowLeft') return focusNode(document.getElementById('token'));
    if (key === 'ArrowDown') return focusNode(document.querySelector('.connect-button'));
    if (key === 'ArrowUp') return focusNode(document.getElementById('server'));
  }
  if (active.matches('.connect-button') && key === 'ArrowUp') return focusNode(document.getElementById('token'));

  if (active.matches('#search-input')) {
    if (key === 'ArrowDown') return focusNode(document.querySelector('#search-results .media-card'));
    if (key === 'ArrowUp') return focusHeaderFor(active);
    return false;
  }
  if (active.matches('select')) {
    if (key === 'ArrowUp') {
      if (active.id === 'enhancement') return focusNode(document.getElementById('quality'));
      return focusHeaderFor(active);
    }
    if (key === 'ArrowDown') {
      if (active.id === 'quality') return focusNode(document.getElementById('enhancement'));
      if (active.id === 'genre-filter') return focusNode(document.querySelector('.grid .media-card, .rail .media-card'));
      return focusNode(document.querySelector('.settings-page button'));
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const delta = key === 'ArrowLeft' ? -1 : 1;
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + delta));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  if (active.matches('video')) return false;

  const navButtons = visibleElements('.topbar button');
  if (active.closest('.topbar')) {
    const index = navButtons.indexOf(active);
    if (key === 'ArrowLeft') return focusNode(navButtons[index - 1]);
    if (key === 'ArrowRight') return focusNode(navButtons[index + 1]);
    if (key === 'ArrowDown') {
      if (state.route.type === 'settings') return focusNode(document.getElementById('quality'));
      if (state.tab === 'home') return focusNode(document.querySelector('.home-shelves .media-card'));
      if (state.tab === 'search') return focusNode(document.getElementById('search-input'));
      if (state.tab === 'collections') return focusNode(document.querySelector('.collections-page .media-card'));
      return focusNode(document.querySelector('#genre-filter, .grid .media-card, .rail .media-card'));
    }
    return false;
  }

  const actionRow = active.closest('.actions');
  if (actionRow) {
    const actions = visibleElements('button', actionRow); const index = actions.indexOf(active);
    if (key === 'ArrowLeft') return focusNode(actions[index - 1]);
    if (key === 'ArrowRight') return focusNode(actions[index + 1]);
    if (key === 'ArrowUp') return state.route.type === 'detail' ? focusNode(document.querySelector('.back-button')) : focusHeaderFor(active);
    if (key === 'ArrowDown') return focusNode(document.querySelector('.section .media-card, .detail-section .media-card, .detail-section .credit-card'));
  }

  const toolbar = active.closest('.toolbar');
  if (toolbar) {
    const controls = visibleElements('button', toolbar); const index = controls.indexOf(active);
    if (key === 'ArrowLeft') return focusNode(controls[index - 1]);
    if (key === 'ArrowRight') return focusNode(controls[index + 1]);
    if (key === 'ArrowUp') return focusHeaderFor(active);
    if (key === 'ArrowDown') return focusNode(document.querySelector('.grid .media-card, .rail .media-card'));
  }

  if (active.closest('.grid')) return navigateGrid(active, key);
  if (active.closest('.rail')) return navigateRail(active, key);

  if (state.route.type === 'settings') {
    const controls = visibleElements('.settings-page select, .settings-page button');
    const index = controls.indexOf(active);
    if (key === 'ArrowDown' || key === 'ArrowRight') return focusNode(controls[index + 1]);
    if (key === 'ArrowUp' || key === 'ArrowLeft') return index > 0 ? focusNode(controls[index - 1]) : focusHeaderFor(active);
  }
  return focusSpatial(key);
}

function updateHero(item) {
  state.hero = item;
  const bg = document.querySelector('.hero-bg');
  if (bg && (item.backdropPath || item.posterPath)) bg.style.backgroundImage = `url('${art(item.backdropPath || item.posterPath)}')`;
  const title = document.getElementById('hero-title');
  const meta = document.getElementById('hero-meta');
  const summary = document.getElementById('hero-summary');
  if (title) title.textContent = item.title;
  if (meta) meta.textContent = metadata(item);
  if (summary) summary.textContent = item.summary || item.tagline || '';
}

async function connect(event) {
  event.preventDefault();
  const server = document.getElementById('server').value;
  const token = document.getElementById('token').value;
  state.error = null; state.loading = true; render();
  try {
    await window.minova.connect(server, token);
    state.config = await window.minova.config();
    await loadCatalog();
  } catch (error) {
    state.loading = false; state.error = errorMessage(error); render();
  }
}

async function startPlexSignIn() {
  state.error = null;
  state.plexSignIn = { status: 'starting', code: '', authorizationUrl: '', servers: [], error: null };
  render();
  try {
    const challenge = await window.minova.plexSignIn.start();
    state.plexSignIn = {
      status: 'waiting',
      code: challenge.code,
      authorizationUrl: challenge.authorizationUrl,
      servers: [],
      error: null,
    };
    render();
    const result = await window.minova.plexSignIn.awaitAuthorization();
    if (result.status === 'select-server') {
      state.plexSignIn = { ...state.plexSignIn, status: 'select-server', servers: result.servers };
      render();
      return;
    }
    state.plexSignIn = { ...state.plexSignIn, status: 'connecting', serverName: result.serverName || 'Plex' };
    state.config = await window.minova.config();
    await loadCatalog();
  } catch (error) {
    if (state.plexSignIn.status === 'idle') return;
    state.plexSignIn = { ...state.plexSignIn, status: 'error', error: errorMessage(error) };
    render();
  }
}

async function selectPlexServer(serverId) {
  const choice = state.plexSignIn.servers.find((server) => server.id === serverId);
  state.plexSignIn = { ...state.plexSignIn, status: 'connecting', serverName: choice?.name || 'Plex' };
  render();
  try {
    await window.minova.plexSignIn.selectServer(serverId);
    state.config = await window.minova.config();
    await loadCatalog();
  } catch (error) {
    state.plexSignIn = { ...state.plexSignIn, status: 'error', error: errorMessage(error) };
    render();
  }
}

async function cancelPlexSignIn() {
  await window.minova.plexSignIn.cancel().catch(() => {});
  state.plexSignIn = { status: 'idle', code: '', authorizationUrl: '', servers: [], error: null };
  render();
}

async function loadCatalog() {
  state.loading = true; render();
  try {
    state.catalog = await window.minova.loadCatalog();
    state.catalogSyncedAt = Date.now();
    state.hero = state.catalog.continueWatching[0] || state.catalog.movies[0] || state.catalog.shows[0] || null;
    state.loading = false; state.error = null; state.route = { type: 'browse' };
    if (['movies', 'grid-click'].includes(state.config.captureView)) state.tab = 'movies';
    else if (state.config.captureView === 'collections') state.tab = 'collections';
    else if (['settings', 'update-dialog'].includes(state.config.captureView)) state.route = { type: 'settings' };
    else if (state.config.captureView === 'detail') state.route = { type: 'detail', item: state.catalog.movies[0] || state.catalog.shows[0], children: [] };
    if (state.config.demoMode && state.config.captureView === 'update-dialog') {
      state.update = { status: 'available', currentVersion: '1.0.3', availableVersion: '1.0.4', progress: 0, message: 'Minova Cinema 1.0.4 is available.' };
    }
    render();
  } catch (error) {
    state.loading = false; state.error = errorMessage(error);
    appRoot.innerHTML = `<div class="screen onboarding"><div class="connect-card">${logoMarkup()}<h1>Couldn’t load Plex</h1><p class="error">${esc(state.error)}</p><div class="actions"><button class="primary" data-action="retry">Try again</button><button class="secondary" data-action="settings">Connection settings</button></div></div></div>`;
  }
}

async function syncCatalog(button = null, { silent = false } = {}) {
  if (state.syncing || (!state.config?.connected && !state.config?.demoMode)) return false;
  state.syncing = true;
  const previousLabel = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Syncing…'; }
  try {
    const catalog = await window.minova.loadCatalog();
    state.catalog = catalog;
    state.hero = catalog.continueWatching[0] || catalog.movies[0] || catalog.shows[0] || null;
    state.catalogSyncedAt = Date.now();
    if (!silent) showToast('Plex library synced.');
    return true;
  } catch (error) {
    if (!silent) showToast(`Could not sync Plex: ${errorMessage(error)}`);
    return false;
  } finally {
    state.syncing = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = previousLabel; }
  }
}

function pushRoute(route) { state.routeStack.push(state.route); state.route = route; render(); }

function goBack() {
  stopPlayback();
  state.route = state.routeStack.pop() || { type: 'browse' };
  render();
}

function findItem(key) {
  return [...state.catalog.movies, ...state.catalog.shows, ...state.catalog.continueWatching, ...state.catalog.watchlist].find((item) => item.ratingKey === key);
}

async function openDetails(key) {
  pushRoute({ type: 'detail', item: findItem(key) || { ratingKey: key, title: 'Loading…' }, children: [] });
  try {
    const item = await window.minova.details(key);
    const children = item?.kind === 'show' || item?.kind === 'season' ? await window.minova.children(key) : [];
    state.route = { type: 'detail', item: item || findItem(key), children }; render();
  } catch (error) { showToast(errorMessage(error)); goBack(); }
}

async function openCollection(key) {
  const collection = state.catalog.collections.find((item) => item.ratingKey === key);
  try {
    const members = await window.minova.collection(key);
    pushRoute({ type: 'collection', collection, members });
  } catch (error) { showToast(errorMessage(error)); }
}

async function play(key) {
  const previousRoute = state.route;
  state.routeStack.push(previousRoute);
  state.route = { type: 'player', payload: null };
  render();
  try {
    const payload = await window.minova.nativePlayer.start(key, state.config.quality || 'original');
    state.route = { type: 'player', payload };
    render();
  } catch (error) {
    state.routeStack.pop();
    state.route = previousRoute;
    render();
    showToast(errorMessage(error));
  }
}

function stopPlayback() {
  if (state.route.type === 'player') window.minova.nativePlayer.stop().catch(() => {});
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, key } = target.dataset;
  if (action === 'tab') { state.tab = target.dataset.tab; state.genre = null; state.route = { type: 'browse' }; render(); }
  else if (action === 'open') openDetails(key);
  else if (action === 'collection') openCollection(key);
  else if (action === 'play') play(key);
  else if (action === 'back') goBack();
  else if (action === 'settings') pushRoute({ type: 'settings' });
  else if (action === 'fullscreen') window.minova.fullscreen();
  else if (action === 'plex-sign-in') startPlexSignIn();
  else if (action === 'plex-open') window.minova.openExternal(state.plexSignIn.authorizationUrl);
  else if (action === 'plex-cancel') cancelPlexSignIn();
  else if (action === 'plex-select-server') selectPlexServer(target.dataset.serverId);
  else if (action === 'toggle-manual') { state.manualSetup = !state.manualSetup; render(); }
  else if (action === 'rail-scroll') scrollRail(target);
  else if (action === 'alpha-jump') jumpToLetter(target.dataset.letter);
  else if (action === 'sync') await syncCatalog(target);
  else if (action === 'check-update') {
    try {
      state.update = await window.minova.updates.check();
      refreshUpdateCard();
    } catch (error) { showToast(errorMessage(error)); }
  }
  else if (action === 'install-update') {
    dismissedUpdateVersion = null;
    try {
      const update = await window.minova.updates.install();
      if (update) state.update = update;
      refreshUpdateCard(); refreshUpdateDialog();
    }
    catch (error) { showToast(errorMessage(error)); }
  }
  else if (action === 'dismiss-update') {
    dismissedUpdateVersion = state.update?.availableVersion || null;
    refreshUpdateDialog();
  }
  else if (action === 'toggle-token') {
    const token = document.getElementById('token');
    const showing = token?.type === 'text';
    if (token) token.type = showing ? 'password' : 'text';
    target.textContent = showing ? 'Show' : 'Hide';
    target.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} Plex token`);
  }
  else if (action === 'layout') { state.layout = state.layout === 'rows' ? 'grid' : 'rows'; render(); }
  else if (action === 'genre') { state.genre = target.dataset.genre || null; render(); }
  else if (action === 'retry') loadCatalog();
  else if (action === 'save-settings') {
    state.config.quality = document.getElementById('quality').value;
    state.config.enhancement = document.getElementById('enhancement').value;
    await window.minova.savePreferences({ quality: state.config.quality, enhancement: state.config.enhancement }); showToast('Native playback settings saved.');
  } else if (action === 'disconnect') {
    await window.minova.disconnect(); state.config = await window.minova.config(); state.catalog = null; state.routeStack = []; state.route = { type: 'browse' }; state.plexSignIn = { status: 'idle', code: '', authorizationUrl: '', servers: [], error: null }; render();
  } else if (action === 'watched') {
    try { await window.minova.setWatched(key, target.dataset.value === 'true'); showToast('Plex watched state updated.'); await loadCatalog(); }
    catch (error) { showToast(errorMessage(error)); }
  } else if (action === 'watchlist') {
    try { await window.minova.setWatchlisted(target.dataset.provider, target.dataset.value === 'true'); showToast('Plex Watchlist updated.'); await loadCatalog(); }
    catch (error) { showToast(errorMessage(error)); }
  }
});

function focusSpatial(direction) {
  const active = document.activeElement;
  if (!active || ['INPUT', 'SELECT', 'VIDEO'].includes(active.tagName)) return false;
  const candidates = [...document.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter((node) => node.offsetParent !== null && node !== active);
  const origin = active.getBoundingClientRect();
  const ox = origin.left + origin.width / 2, oy = origin.top + origin.height / 2;
  const vector = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[direction];
  const ranked = candidates.map((node) => {
    const rect = node.getBoundingClientRect(); const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const dx = x - ox, dy = y - oy; const primary = dx * vector[0] + dy * vector[1];
    if (primary <= 3) return null;
    const cross = Math.abs(dx * vector[1] - dy * vector[0]);
    return { node, score: primary + cross * 2.6 };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  if (!ranked.length) return false;
  ranked[0].node.focus(); ranked[0].node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return true;
}

document.addEventListener('keydown', (event) => {
  const updateDialog = document.getElementById('update-dialog');
  if (updateDialog && !updateDialog.hidden) {
    const controls = [...updateDialog.querySelectorAll('button:not([hidden]):not([disabled])')];
    const index = controls.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault(); updateDialog.querySelector('[data-action="dismiss-update"]:not([hidden])')?.click(); return;
    }
    if (['ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); controls[Math.max(0, index - 1)]?.focus(); return; }
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); controls[Math.min(controls.length - 1, Math.max(0, index + 1))]?.focus(); return; }
  }
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (!editing && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' || (!event.ctrlKey && !event.metaKey && event.key === '/'))) {
    event.preventDefault();
    state.tab = 'search'; state.genre = null; state.route = { type: 'browse' }; render();
    return;
  }
  if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(event.key)
    && state.route.type === 'browse' && state.layout === 'grid' && ['movies', 'series'].includes(state.tab)) {
    event.preventDefault();
    jumpToLetter(event.key);
    return;
  }
  if (event.key === 'F11') { event.preventDefault(); window.minova.fullscreen(); return; }
  if ((event.key === 'Escape' || event.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    if (state.route.type !== 'browse') { event.preventDefault(); goBack(); }
    return;
  }
  if (event.key.startsWith('Arrow') && navigateDpad(event.key)) event.preventDefault();
});

window.addEventListener('resize', () => {
  document.querySelectorAll('.rail-shell').forEach((shell) => updateRailArrows(shell));
});

function renderWindowState(windowState = {}) {
  const maximize = document.querySelector('[data-window-action="maximize"]');
  maximize?.classList.toggle('is-maximized', Boolean(windowState.maximized));
  maximize?.setAttribute('aria-label', windowState.maximized ? 'Restore window' : 'Maximize');
  document.body.classList.toggle('fullscreen', Boolean(windowState.fullScreen));
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-window-action]');
  if (!control) return;
  const action = control.dataset.windowAction;
  if (action === 'minimize') window.minova.windowControls.minimize();
  else if (action === 'maximize') window.minova.windowControls.toggleMaximize().then((maximized) => renderWindowState({ maximized }));
  else if (action === 'close') window.minova.windowControls.close();
});

window.minova.windowControls.onState(renderWindowState);
window.minova.windowControls.state().then(renderWindowState);

window.minova.nativePlayer.onClosed(() => {
  if (state.route.type !== 'player') return;
  state.route = state.routeStack.pop() || { type: 'browse' };
  render();
});

window.minova.nativePlayer.onHandoffCompleted((payload) => {
  const position = Math.max(0, Number(payload?.position) || 0);
  showToast(`Position saved at ${formatClock(position)}. Continue from Plex on your other device.`);
  syncCatalog(null, { silent: true }).then(() => render());
});

window.minova.updates.onState((update) => {
  const previousStatus = state.update?.status;
  state.update = update;
  refreshUpdateCard();
  refreshUpdateDialog();
  if (update.status === 'downloaded' && previousStatus !== 'downloaded') {
    showToast(`Minova Cinema ${update.availableVersion} is ready to install.`);
  }
});

async function boot() {
  try {
    [state.config, state.update] = await Promise.all([window.minova.config(), window.minova.updates.getState()]);
    if (state.config.connected || state.config.demoMode) await loadCatalog();
    else { state.loading = false; render(); }
  } catch (error) { state.config = { connected: false, server: '', quality: 'original' }; state.loading = false; state.error = errorMessage(error); render(); }
}

window.__runMinovaQa = async function runMinovaQa() {
  const results = [];
  const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (name, passed, detail = '') => results.push({ name, passed: Boolean(passed), detail });
  const press = async (key) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await wait();
  };
  const activeLabel = () => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || document.activeElement?.id || '';

  await wait(120);
  check('Custom Minova title bar exposes all three window controls', document.querySelectorAll('.window-controls [data-window-action]').length === 3, document.querySelectorAll('.window-controls [data-window-action]').length);
  check('Initial D-pad focus lands on selected Home tab', document.activeElement?.dataset?.tab === 'home', activeLabel());
  await press('ArrowRight');
  check('Right moves Home to Movies', document.activeElement?.dataset?.tab === 'movies', activeLabel());
  document.activeElement?.click(); await wait(120);
  check('Enter/click opens Movies', state.tab === 'movies' && Boolean(document.querySelector('.toolbar')), state.tab);
  const desktopTools = document.querySelector('.nav-tools');
  check('Search, layout, and Settings are grouped on the right', Boolean(desktopTools?.querySelector('[data-tab="search"]')) && Boolean(desktopTools?.querySelector('[data-action="layout"]')) && Boolean(desktopTools?.querySelector('[data-action="settings"]')), desktopTools?.textContent.trim() || 'missing');
  check('Genre selector exposes every available genre', document.querySelectorAll('#genre-filter option').length === genresFor(state.catalog.movies).length + 1, document.querySelectorAll('#genre-filter option').length);
  const headerLayout = document.querySelector('.topbar [data-action="layout"]');
  check('Movies header exposes the real Rows/Grid toggle', Boolean(headerLayout), headerLayout?.getAttribute('aria-label') || 'missing');
  headerLayout?.click(); await wait(140);
  check('Header Grid toggle creates the alphabetical catalog grid', state.layout === 'grid' && Boolean(document.querySelector('.alpha-index')) && Boolean(document.querySelector('.grid .media-card')), `${state.layout}:${document.querySelectorAll('.grid .media-card').length}`);
  await press('ArrowDown');
  check('Down from header enters the genre selector after grid render', document.activeElement?.id === 'genre-filter', activeLabel());
  await press('ArrowDown');
  const firstGridKey = document.activeElement?.dataset?.key;
  check('Down from toolbar enters first grid card', Boolean(firstGridKey), activeLabel());
  await press('g'); await wait(180);
  const letterJumpItem = findItem(document.activeElement?.dataset?.key);
  check('Typing G jumps to the first G title', letterJumpItem?.title?.toUpperCase().startsWith('G'), letterJumpItem?.title || activeLabel());
  await press('ArrowRight');
  check('Right moves across alphabetical grid groups', Boolean(document.activeElement?.dataset?.key) && document.activeElement.dataset.key !== letterJumpItem?.ratingKey, activeLabel());
  const beforeDown = document.activeElement?.dataset?.key;
  await press('ArrowDown');
  check('Down moves to the next grid row', Boolean(document.activeElement?.dataset?.key) && document.activeElement.dataset.key !== beforeDown, activeLabel());

  document.activeElement.click(); await wait(180);
  check('Grid card opens details', state.route.type === 'detail' && Boolean(document.querySelector('.detail-copy')), state.route.type);
  check('Details receives an action focus target', Boolean(document.activeElement?.closest('.detail-copy .actions')), activeLabel());
  check('Details reserves a cinematic artwork layer', Boolean(document.querySelector('.detail-bg')), document.querySelector('.detail-bg')?.className);
  check('Movie Cast & Crew uses actor portrait cards', Boolean(document.querySelector('.credit-card .credit-avatar img')), document.querySelectorAll('.credit-card .credit-avatar img').length);
  const firstCreditRole = document.querySelector('.credit-card .credit-role');
  check('Cast names and roles stay visible without initial scrolling', Boolean(firstCreditRole) && firstCreditRole.getBoundingClientRect().bottom <= innerHeight, firstCreditRole?.getBoundingClientRect().bottom);
  await press('ArrowRight');
  check('Right moves across detail actions', Boolean(document.activeElement?.closest('.detail-copy .actions')), activeLabel());
  await press('Backspace');
  check('Back returns to the grid without losing layout', state.route.type === 'browse' && state.layout === 'grid' && Boolean(document.querySelector('.grid')), `${state.route.type}:${state.layout}`);

  const returnToRows = document.querySelector('.topbar [data-action="layout"]');
  returnToRows?.click(); await wait(140);
  check('Header layout toggle returns to Rows', state.layout === 'rows' && Boolean(document.querySelector('.section .rail')), state.layout);
  check('Rows include a shelf for every available genre', genresFor(state.catalog.movies).every((genre) => [...document.querySelectorAll('.section-title')].some((title) => title.textContent === genre)), [...document.querySelectorAll('.section-title')].map((title) => title.textContent).join(', '));

  document.querySelector('[data-tab="home"]').click(); await wait(140);
  check('Home returns focus to selected header tab', document.activeElement?.dataset?.tab === 'home', activeLabel());
  check('Desktop Home no longer renders the large hero', !document.querySelector('.hero, .hero-bg'), document.querySelector('.hero, .hero-bg') ? 'present' : 'removed');
  const scrollableShelf = [...document.querySelectorAll('.home-shelves .rail-shell')].find((shell) => !shell.querySelector('.rail-arrow-right')?.disabled);
  check('Scrollable shelves show a right-edge arrow', Boolean(scrollableShelf) && !scrollableShelf.querySelector('.rail-arrow-right')?.classList.contains('is-hidden'), scrollableShelf ? 'visible' : 'missing');
  check('Shelf left arrow stays hidden before moving right', scrollableShelf?.querySelector('.rail-arrow-left')?.classList.contains('is-hidden'), scrollableShelf?.querySelector('.rail-arrow-left')?.className || 'missing');
  scrollableShelf?.querySelector('.rail-arrow-right')?.click(); await wait(460);
  check('Shelf left arrow appears after moving right', Number(scrollableShelf?.querySelector('.rail')?.scrollLeft) > 6 && !scrollableShelf?.querySelector('.rail-arrow-left')?.classList.contains('is-hidden'), scrollableShelf?.querySelector('.rail')?.scrollLeft || 0);
  await press('ArrowDown');
  const firstShelfKey = document.activeElement?.dataset?.key;
  check('Down from Home enters the first shelf directly', Boolean(firstShelfKey), activeLabel());
  await press('ArrowRight');
  check('Right moves within a shelf', Boolean(document.activeElement?.dataset?.key) && document.activeElement.dataset.key !== firstShelfKey, activeLabel());
  const upperShelfKey = document.activeElement?.dataset?.key;
  await press('ArrowDown');
  check('Down moves between shelves', Boolean(document.activeElement?.dataset?.key) && document.activeElement.dataset.key !== upperShelfKey, activeLabel());

  document.querySelector('[data-tab="search"]').click(); await wait(140);
  await press('ArrowDown');
  check('Down from Search tab focuses search field', document.activeElement?.id === 'search-input', activeLabel());
  const search = document.getElementById('search-input');
  search.value = 'horizon'; search.dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
  await press('ArrowDown');
  check('Down from search field enters results', document.activeElement?.dataset?.key === 'demo-1', activeLabel());

  document.querySelector('[data-tab="collections"]').click(); await wait(140);
  check('Collection artwork keeps a portrait 2:3 frame', (() => {
    const frame = document.querySelector('.collection-card .collection-art');
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    return Math.abs(rect.width / rect.height - (2 / 3)) < 0.03;
  })(), document.querySelector('.collection-card .collection-art')?.getBoundingClientRect().toJSON?.() || 'missing');
  await press('ArrowDown');
  check('Down from Collections enters collection grid', document.activeElement?.dataset?.action === 'collection', activeLabel());
  document.activeElement?.click(); await wait(160);
  check('Collection opens its member grid', state.route.type === 'collection' && document.querySelectorAll('.collections-page .media-card').length > 0, state.route.type);
  await press('Backspace');
  check('Back returns from a collection', state.route.type === 'browse' && state.tab === 'collections', `${state.route.type}:${state.tab}`);

  document.querySelector('[data-tab="series"]').click(); await wait(140);
  document.querySelector('.rail .media-card')?.click(); await wait(180);
  check('Series opens its detail screen', state.route.type === 'detail' && state.route.item?.kind === 'show', `${state.route.type}:${state.route.item?.kind}`);
  check('Series Cast & Crew includes actor pictures', Boolean(document.querySelector('.cast-section .credit-avatar img')), document.querySelectorAll('.cast-section .credit-avatar img').length);
  await press('Backspace');

  document.querySelector('[data-action="settings"]').click(); await wait(140);
  check('Settings receives focus on its header control', document.activeElement?.dataset?.action === 'settings', activeLabel());
  check('Settings includes the five-card dashboard with automatic updates', document.querySelectorAll('.settings-grid .settings-card').length === 5 && Boolean(document.querySelector('[data-action="check-update"]')), document.querySelectorAll('.settings-grid .settings-card').length);
  check('Settings dashboard uses two columns', getComputedStyle(document.querySelector('.settings-grid')).gridTemplateColumns.split(' ').length === 2, getComputedStyle(document.querySelector('.settings-grid')).gridTemplateColumns);
  const previousUpdate = state.update;
  dismissedUpdateVersion = null;
  state.update = { status: 'available', currentVersion: '1.0.3', availableVersion: '1.0.4', progress: 0, message: 'Minova Cinema 1.0.4 is available.' };
  refreshUpdateDialog();
  check('GitHub update opens the branded in-app dialog', !document.getElementById('update-dialog').hidden, document.getElementById('update-dialog-title').textContent);
  check('Update dialog offers Update and Not now', Boolean(document.querySelector('#update-dialog [data-action="install-update"]')) && Boolean(document.querySelector('#update-dialog [data-action="dismiss-update"]')), document.querySelector('.update-dialog-actions')?.textContent.trim());
  document.querySelector('#update-dialog [data-action="dismiss-update"]')?.click(); await wait();
  check('Not now dismisses the update without leaving Settings', document.getElementById('update-dialog').hidden && state.route.type === 'settings', state.route.type);
  state.update = previousUpdate; dismissedUpdateVersion = null; refreshUpdateDialog(); refreshUpdateCard();
  await press('ArrowDown');
  check('Down enters playback quality', document.activeElement?.id === 'quality', activeLabel());
  const previousQuality = document.activeElement?.value;
  await press('ArrowRight');
  check('Right changes playback quality', document.activeElement?.value !== previousQuality, document.activeElement?.value);
  await press('ArrowDown');
  check('Down moves from quality to native GPU enhancement', document.activeElement?.id === 'enhancement', activeLabel());
  await press('ArrowDown');
  check('Down leaves enhancement for Save', document.activeElement?.dataset?.action === 'save-settings', activeLabel());
  await press('ArrowDown');
  check('Down reaches Sync Plex now', document.activeElement?.dataset?.action === 'sync', activeLabel());
  const previousSync = state.catalogSyncedAt;
  document.activeElement?.click(); await wait(180);
  check('Sync Plex now refreshes the catalog', state.catalogSyncedAt > previousSync, state.catalogSyncedAt);

  const failed = results.filter((result) => !result.passed);
  return { passed: failed.length === 0, total: results.length, failed: failed.length, results };
};

window.__runMinovaPersistenceSave = async function runMinovaPersistenceSave(server, token) {
  if (!document.getElementById('connect-form')) {
    document.querySelector('[data-action="toggle-manual"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const form = document.getElementById('connect-form');
  if (!form) return { connected: false, browse: false, error: 'Onboarding form was not shown.' };
  const focusSequence = [];
  const press = async (key) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    focusSequence.push(
      document.activeElement?.id || document.activeElement?.dataset?.action ||
      (document.activeElement?.matches('.connect-button') ? 'connect' : 'none'),
    );
  };
  document.getElementById('server').focus();
  document.getElementById('server').value = server;
  await press('ArrowDown');
  document.getElementById('token').value = token;
  await press('ArrowRight');
  await press('ArrowLeft');
  await press('ArrowDown');
  const focusChecksPassed = focusSequence.join(',') === 'token,toggle-token,token,connect';
  document.activeElement?.click();
  for (let attempt = 0; attempt < 100 && !state.catalog && !state.error; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    connected: Boolean(state.config?.connected),
    browse: Boolean(state.catalog && document.querySelector('.app-shell')),
    onboarding: Boolean(document.getElementById('connect-form')),
    focusChecksPassed,
    focusSequence,
    error: state.error,
  };
};

window.__runMinovaPersistenceCheck = async function runMinovaPersistenceCheck() {
  for (let attempt = 0; attempt < 100 && state.loading; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    connected: Boolean(state.config?.connected),
    browse: Boolean(state.catalog && document.querySelector('.app-shell')),
    onboarding: Boolean(document.getElementById('connect-form')),
    error: state.error,
  };
};

window.__showPlexSignInPreview = function showPlexSignInPreview(status) {
  state.plexSignIn = status === 'select-server'
    ? {
      status: 'select-server', code: 'A1B2', authorizationUrl: 'https://plex.tv/link/?pin=A1B2', error: null,
      servers: [
        { id: 'living-room', name: 'Living Room Plex', owned: true },
        { id: 'family', name: 'Family Shared Server', owned: false },
      ],
    }
    : { status: 'waiting', code: 'A1B2', authorizationUrl: 'https://plex.tv/link/?pin=A1B2', servers: [], error: null };
  render();
};

window.addEventListener('focus', () => {
  if (state.config?.connected && state.catalog && Date.now() - state.catalogSyncedAt > 15000) {
    syncCatalog(null, { silent: true }).then((changed) => { if (changed) render(); });
  }
});

boot();
