const { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, protocol, safeStorage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { PlexClient, isPlexOwnedHost, isTrustedExternalArtworkUrl, normalizeServer, plexHeaders, rewritePlaylist } = require('./plex.cjs');
const { awaitPlexAuthorization, createPlexPin, discoverPlexServers } = require('./plex-auth.cjs');
const { NativeMpvPlayer, mediaUrl } = require('./native-player.cjs');
const { ensureClientIdentifier, migrateLegacySettings, readSettings, selectConnectionToken, writeSettings } = require('./settings.cjs');
const { miniPlayerBounds } = require('./window-modes.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'minova-plex', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let mainWindow;
let playerOverlay;
let nativePlayer;
let closingPlayerOverlay = false;
let miniPlayerRestoreState = null;
let miniPlayerPinned = false;
let activeClient;
let pendingPlexSignIn;
let updateTimer;
let updateAccepted = false;
let updateState = {
  status: 'idle', currentVersion: app.getVersion(), availableVersion: null,
  progress: 0, message: 'Automatic update checks are enabled.',
};
const demoMode = process.argv.includes('--demo');
const captureArgument = process.argv.find((value) => value.startsWith('--capture='));
const captureView = process.argv.find((value) => value.startsWith('--capture-view='))?.slice('--capture-view='.length);
const qaReportArgument = process.argv.find((value) => value.startsWith('--qa-report='));
const qaPersistenceSaveArgument = process.argv.find((value) => value.startsWith('--qa-persistence-save='));
const qaPersistenceCheckArgument = process.argv.find((value) => value.startsWith('--qa-persistence-check='));
const qaProfileArgument = process.argv.find((value) => value.startsWith('--qa-profile='));
const qaServerArgument = process.argv.find((value) => value.startsWith('--qa-server='));
const qaTokenArgument = process.argv.find((value) => value.startsWith('--qa-token='));
const nativeQaReportArgument = process.argv.find((value) => value.startsWith('--native-qa-report='));
const nativeQaMediaArgument = process.argv.find((value) => value.startsWith('--native-qa-media='));
const nativeQaCaptureArgument = process.argv.find((value) => value.startsWith('--native-qa-capture='));
const qaMode = Boolean(qaReportArgument || qaPersistenceSaveArgument || qaPersistenceCheckArgument || nativeQaReportArgument);

if (qaProfileArgument) {
  app.setPath('userData', path.resolve(qaProfileArgument.slice('--qa-profile='.length)));
} else if (demoMode) {
  app.setPath('userData', path.join(app.getPath('temp'), `minova-cinema-demo-${process.pid}`));
}

function configPath() { return path.join(app.getPath('userData'), 'settings.json'); }

function readStored() { return readSettings(configPath()); }

function writeStored(settings) { writeSettings(configPath(), settings); }

function migratePreviousDesktopProfile() {
  if (demoMode || qaProfileArgument) return { migrated: false };
  const appData = app.getPath('appData');
  return migrateLegacySettings(configPath(), [
    path.join(appData, 'minova-cinema-desktop', 'settings.json'),
    path.join(appData, 'Minova Cinema Desktop', 'settings.json'),
  ]);
}

function getClientIdentifier() { return ensureClientIdentifier(configPath()); }

function publishUpdateState(patch = {}) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('update:state', updateState);
  }
  return updateState;
}

async function checkForAppUpdates() {
  if (!app.isPackaged || demoMode || qaMode) {
    return publishUpdateState({ status: 'disabled', message: 'Update checks run in installed production builds.' });
  }
  if (['checking', 'available', 'downloading', 'downloaded'].includes(updateState.status)) return updateState;
  publishUpdateState({ status: 'checking', progress: 0, message: 'Checking GitHub for updates…' });
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    publishUpdateState({ status: 'error', message: 'The update service could not be reached. Try again later.' });
  }
  return updateState;
}

function setupAutoUpdater() {
  if (!app.isPackaged || demoMode || qaMode) {
    publishUpdateState({ status: 'disabled', message: 'Update checks run in installed production builds.' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking', progress: 0, message: 'Checking GitHub for updates…' }));
  autoUpdater.on('update-available', (info) => {
    updateAccepted = false;
    publishUpdateState({
      status: 'available', availableVersion: info.version, progress: 0,
      message: `Minova Cinema ${info.version} is available.`,
    });
  });
  autoUpdater.on('download-progress', (progress) => publishUpdateState({
    status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
    message: `Downloading update… ${Math.round(progress.percent || 0)}%`,
  }));
  autoUpdater.on('update-not-available', () => publishUpdateState({
    status: 'up-to-date', availableVersion: null, progress: 0,
    message: `Minova Cinema ${app.getVersion()} is up to date.`,
  }));
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateState({
      status: 'downloaded', availableVersion: info.version, progress: 100,
      message: updateAccepted ? `Installing Minova Cinema ${info.version}…` : `Minova Cinema ${info.version} is ready to install.`,
    });
    if (updateAccepted) setTimeout(() => autoUpdater.quitAndInstall(false, true), 900);
  });
  autoUpdater.on('error', () => publishUpdateState({
    status: 'error', progress: 0, message: 'The update service could not be reached. Try again later.',
  }));
  setTimeout(() => checkForAppUpdates(), 5000);
  updateTimer = setInterval(() => checkForAppUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref?.();
}

async function acceptAppUpdate() {
  if (!app.isPackaged || demoMode || qaMode) throw new Error('Updates can only be installed from a production build.');
  if (updateState.status === 'available') {
    updateAccepted = true;
    publishUpdateState({ status: 'downloading', progress: 0, message: `Downloading Minova Cinema ${updateState.availableVersion}…` });
    await autoUpdater.downloadUpdate();
    return updateState;
  }
  if (updateState.status === 'downloaded') {
    updateAccepted = true;
    publishUpdateState({ message: `Installing Minova Cinema ${updateState.availableVersion}…` });
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return updateState;
  }
  if (updateState.status === 'downloading') return updateState;
  throw new Error('No update is ready to install.');
}

function removeObsoleteStandalonePlayer() {
  if (!app.isPackaged) return;
  const obsoleteFiles = [
    path.join(process.resourcesPath, 'vendor', 'mpv', 'mpv.exe'),
    path.join(process.resourcesPath, 'vendor', 'native-host', 'MinovaCinema.WindowBridge.exe'),
  ];
  for (const file of obsoleteFiles) {
    try { fs.unlinkSync(file); } catch {}
  }
  try { fs.rmdirSync(path.join(process.resourcesPath, 'vendor', 'mpv')); } catch {}
}

function getConnection() {
  const stored = readStored();
  if (!stored.server || !stored.encryptedToken) return null;
  try {
    const token = safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
    return {
      server: stored.server,
      token,
      quality: stored.quality || 'original',
      clientIdentifier: stored.clientIdentifier || getClientIdentifier(),
    };
  } catch { return null; }
}

function saveConnection(server, token, quality = 'original', clientIdentifier = getClientIdentifier()) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential storage is not available.');
  const normalized = normalizeServer(server);
  const stored = readStored();
  writeStored({
    ...stored,
    server: normalized,
    encryptedToken: safeStorage.encryptString(token).toString('base64'),
    quality,
    clientIdentifier,
  });
  activeClient = new PlexClient(normalized, token, clientIdentifier);
  return normalized;
}

function requireClient() {
  if (activeClient) return activeClient;
  const connection = getConnection();
  if (!connection) throw new Error('Connect a Plex server first.');
  activeClient = new PlexClient(connection.server, connection.token, connection.clientIdentifier);
  return activeClient;
}

function cancelPlexSignIn() {
  pendingPlexSignIn?.controller?.abort();
  pendingPlexSignIn = null;
}

async function connectDiscoveredServer(server) {
  if (!server) throw new Error('That Plex server is no longer available. Sign in again.');
  const clientIdentifier = getClientIdentifier();
  let lastError;
  for (const connection of server.connections) {
    try {
      const candidate = new PlexClient(connection.uri, server.accessToken, clientIdentifier);
      const serverName = await candidate.test();
      const normalized = saveConnection(
        connection.uri,
        server.accessToken,
        readStored().quality || 'original',
        clientIdentifier,
      );
      pendingPlexSignIn = null;
      return { status: 'connected', server: normalized, serverName };
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || `${server.name} was found, but none of its addresses could be reached.`);
}

function proxyUrl(target) {
  return `minova-plex://media/${Buffer.from(target).toString('base64url')}`;
}

function demoCatalog() {
  const make = (id, title, kind, year, progress = 0) => ({
    ratingKey: `demo-${id}`, title, kind, year, summary: 'A cinematic selection from your personal Plex library.',
    contentRating: 'PG-13', durationMs: 6600000, viewOffsetMs: 6600000 * progress, progress,
    posterPath: null, backdropPath: null, genres: ['Drama', 'Adventure'], isWatched: false,
    credits: [
      { name: 'Ava Stone', role: 'Lead cast', imagePath: 'asset:minova-symbol-color.svg' },
      { name: 'Noah Vale', role: 'Cast', imagePath: 'asset:minova-cinema-wordmark.png' },
      { name: 'Maya North', role: 'Director', imagePath: null },
    ],
  });
  const movies = [
    make(1, 'The Last Horizon', 'movie', 2026), make(2, 'Northern Lights', 'movie', 2025),
    make(3, 'Parallel', 'movie', 2024), make(4, 'Midnight Signal', 'movie', 2026),
    make(5, 'The Long Road Home', 'movie', 2023), make(11, 'Silent Orbit', 'movie', 2025),
    make(12, 'The Crossing', 'movie', 2024), make(13, 'Glass River', 'movie', 2026),
    make(14, 'After Midnight', 'movie', 2023), make(15, 'The Signal', 'movie', 2025),
  ];
  const shows = [make(6, 'Atlas Station', 'show', 2026), make(7, 'After the Rain', 'show', 2025), make(8, 'The Archive', 'show', 2024)];
  return {
    serverName: 'Minova Demo', movies, shows,
    continueWatching: [make(9, 'City of Glass', 'movie', 2025, .34), make(10, 'Edge of Winter', 'movie', 2024, .72)],
    watchlist: [movies[1], shows[0]],
    collections: [
      { ratingKey: 'collection-1', title: 'Cinema Essentials', childCount: 5, libraryTitle: 'Movies' },
      { ratingKey: 'collection-2', title: 'Science Fiction', childCount: 8, libraryTitle: 'Movies' },
      { ratingKey: 'collection-3', title: 'Weekend Adventures', childCount: 4, libraryTitle: 'Movies' },
      { ratingKey: 'collection-4', title: 'Limited Series', childCount: 3, libraryTitle: 'Series' },
      { ratingKey: 'collection-5', title: 'Family Night', childCount: 6, libraryTitle: 'Movies' },
    ],
  };
}

async function installMediaProtocol() {
  protocol.handle('minova-plex', async (request) => {
    try {
      const encoded = new URL(request.url).pathname.replace(/^\//, '');
      const requested = Buffer.from(encoded, 'base64url').toString('utf8');
      const connection = getConnection();
      if (!connection) return new Response('Not connected', { status: 401 });
      const target = /^https?:\/\//i.test(requested) ? new URL(requested) : new URL(requested.replace(/^\//, ''), `${connection.server}/`);
      const serverOrigin = new URL(connection.server).origin;
      if (['127.0.0.1', 'localhost'].includes(target.hostname) && target.origin !== serverOrigin) {
        const serverUrl = new URL(connection.server);
        target.protocol = serverUrl.protocol;
        target.hostname = serverUrl.hostname;
        target.port = serverUrl.port;
      }
      const isServerMedia = target.origin === serverOrigin;
      if (!isServerMedia && !isTrustedExternalArtworkUrl(target.toString())) return new Response('Blocked media origin', { status: 403 });
      const headers = isServerMedia || isPlexOwnedHost(target.hostname)
        ? plexHeaders(connection.token, {}, connection.clientIdentifier)
        : { Accept: 'image/*' };
      const range = request.headers.get('range');
      if (range) headers.Range = range;
      const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(120000) });
      const type = upstream.headers.get('content-type') || '';
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      if (type.includes('mpegurl') || target.pathname.endsWith('.m3u8')) {
        responseHeaders.delete('content-length');
        const playlist = rewritePlaylist(await upstream.text(), target, proxyUrl);
        return new Response(playlist, { status: upstream.status, headers: responseHeaders });
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return new Response(error.message || 'Media proxy failed', { status: 502 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('update:get-state', () => updateState);
  ipcMain.handle('update:check', () => checkForAppUpdates());
  ipcMain.handle('update:install', () => acceptAppUpdate());
  ipcMain.handle('config:get', () => {
    const connection = getConnection();
    const stored = readStored();
    return {
      connected: Boolean(connection), server: connection?.server || '', quality: connection?.quality || 'original',
      enhancement: stored.enhancement || 'balanced', volume: Number.isFinite(stored.volume) ? stored.volume : 100,
      demoMode, captureView,
    };
  });
  ipcMain.handle('config:connect', async (_event, { server, token }) => {
    cancelPlexSignIn();
    const remembered = getConnection();
    const effectiveToken = selectConnectionToken(token, remembered?.token);
    if (!effectiveToken) throw new Error('Enter your Plex token.');
    const clientIdentifier = getClientIdentifier();
    const candidate = new PlexClient(server, effectiveToken, clientIdentifier);
    const serverName = await candidate.test();
    const normalized = saveConnection(server, effectiveToken, readStored().quality || 'original', clientIdentifier);
    return { server: normalized, serverName };
  });
  ipcMain.handle('plex-auth:start', async () => {
    cancelPlexSignIn();
    const controller = new AbortController();
    const clientIdentifier = getClientIdentifier();
    const challenge = await createPlexPin({ clientIdentifier, signal: controller.signal });
    pendingPlexSignIn = { controller, clientIdentifier, challenge, servers: [] };
    await shell.openExternal(challenge.authorizationUrl);
    return challenge;
  });
  ipcMain.handle('plex-auth:await', async () => {
    const pending = pendingPlexSignIn;
    if (!pending) throw new Error('Start Plex sign-in again to request a new code.');
    const accountToken = await awaitPlexAuthorization({
      pinId: pending.challenge.id,
      clientIdentifier: pending.clientIdentifier,
      signal: pending.controller.signal,
    });
    const servers = await discoverPlexServers({
      accountToken,
      clientIdentifier: pending.clientIdentifier,
      signal: pending.controller.signal,
    });
    if (!servers.length) throw new Error('Plex sign-in succeeded, but this account has no available Plex Media Server.');
    pending.servers = servers;
    if (servers.length === 1) return connectDiscoveredServer(servers[0]);
    return {
      status: 'select-server',
      servers: servers.map(({ id, name, owned }) => ({ id, name, owned })),
    };
  });
  ipcMain.handle('plex-auth:select-server', (_event, serverId) => {
    const server = pendingPlexSignIn?.servers?.find((candidate) => candidate.id === serverId);
    return connectDiscoveredServer(server);
  });
  ipcMain.handle('plex-auth:cancel', () => {
    cancelPlexSignIn();
    return true;
  });
  ipcMain.handle('config:save-preferences', (_event, preferences) => {
    const stored = readStored();
    writeStored({
      ...stored,
      quality: preferences.quality || stored.quality || 'original',
      enhancement: preferences.enhancement || stored.enhancement || 'balanced',
      volume: Number.isFinite(preferences.volume) ? preferences.volume : (Number.isFinite(stored.volume) ? stored.volume : 100),
    });
    return true;
  });
  ipcMain.handle('config:disconnect', () => {
    activeClient = null;
    cancelPlexSignIn();
    const stored = readStored();
    delete stored.server;
    delete stored.encryptedToken;
    writeStored({ ...stored, clientIdentifier: stored.clientIdentifier || getClientIdentifier() });
    return true;
  });
  ipcMain.handle('catalog:load', () => demoMode ? demoCatalog() : requireClient().loadCatalog());
  ipcMain.handle('media:details', (_event, key) => demoMode ? demoCatalog().movies.find((item) => item.ratingKey === key) || demoCatalog().shows[0] : requireClient().details(key));
  ipcMain.handle('media:children', (_event, key) => demoMode ? demoCatalog().shows : requireClient().children(key));
  ipcMain.handle('media:collection', (_event, key) => demoMode ? demoCatalog().movies : requireClient().collection(key));
  ipcMain.handle('media:set-watched', (_event, { key, watched }) => demoMode || requireClient().setWatched(key, watched));
  ipcMain.handle('media:set-watchlisted', (_event, { providerRatingKey, watchlisted }) => demoMode || requireClient().setWatchlisted(providerRatingKey, watchlisted));
  ipcMain.handle('media:timeline', (_event, { item, state, timeMs }) => demoMode || requireClient().timeline(item, state, timeMs));
  ipcMain.handle('playback:resolve', async (_event, { key, quality }) => {
    if (demoMode) throw new Error('Playback is disabled in visual demo mode.');
    const item = await requireClient().details(key);
    if (!item?.playback?.directPath) throw new Error('Plex did not provide a playable media part.');
    return { item, directUrl: proxyUrl(item.playback.directPath), hlsUrl: proxyUrl(requireClient().transcodePath(key, quality === 'original' ? '1080' : quality)) };
  });
  ipcMain.handle('native-player:start', async (_event, { key, quality }) => startNativePlayback(key, quality));
  ipcMain.handle('native-player:command', async (_event, { action, value }) => {
    if (!nativePlayer) throw new Error('The native player is not active.');
    const state = await nativePlayer.execute(action, value);
    if (action === 'enhancement' || action === 'volume') {
      const stored = readStored();
      writeStored({ ...stored, enhancement: state.enhancement, volume: state.volume });
    }
    return state;
  });
  ipcMain.handle('native-player:state', () => ({
    ...(nativePlayer?.snapshot() || {}),
    miniPlayer: Boolean(miniPlayerRestoreState),
    miniPlayerPinned,
  }));
  ipcMain.handle('native-player:handoff', async () => {
    const player = nativePlayer;
    if (!player) throw new Error('The native player is not active.');
    const state = await player.handoff();
    await closeNativePlayback(true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('native-player:handoff-complete', {
        position: state.position,
        title: state.title,
      });
    }
    return true;
  });
  ipcMain.handle('native-player:close', () => closeNativePlayback(true));
  ipcMain.handle('window:mini-player', (_event, enabled) => setMiniPlayer(Boolean(enabled)));
  ipcMain.handle('window:mini-player-pin', (_event, enabled) => setMiniPlayerPinned(Boolean(enabled)));
  ipcMain.handle('window:mini-player-state', () => windowModeState());
  ipcMain.handle('window:mini-player-resize', (_event, size) => resizeMiniPlayer(size));
  ipcMain.handle('window:mini-player-move', (_event, position) => moveMiniPlayer(position));
  ipcMain.handle('window:fullscreen', async () => {
    if (!mainWindow) return false;
    if (miniPlayerRestoreState) await setMiniPlayer(false);
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); return true; });
  ipcMain.handle('window:maximize-toggle', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => { mainWindow?.close(); return true; });
  ipcMain.handle('window:state', () => ({ maximized: Boolean(mainWindow?.isMaximized()), fullScreen: Boolean(mainWindow?.isFullScreen()) }));
  ipcMain.handle('external:open', (_event, url) => /^https:\/\//i.test(url) && shell.openExternal(url));
}

function publishWindowMode() {
  if (playerOverlay && !playerOverlay.isDestroyed() && !playerOverlay.webContents.isDestroyed()) {
    playerOverlay.webContents.send('native-player:window-mode', windowModeState());
  }
}

function windowModeState() {
  return {
    miniPlayer: Boolean(miniPlayerRestoreState),
    miniPlayerPinned,
    bounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
  };
}

function setMiniPlayerPinned(enabled) {
  if (!mainWindow || mainWindow.isDestroyed() || !miniPlayerRestoreState) return false;
  miniPlayerPinned = enabled;
  mainWindow.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: enabled });
  mainWindow.setAlwaysOnTop(enabled, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
  publishWindowMode();
  return miniPlayerPinned;
}

function resizeMiniPlayer(size = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !miniPlayerRestoreState) return windowModeState();
  const current = mainWindow.getBounds();
  const display = screen.getDisplayMatching(current);
  const width = Math.round(Math.max(360, Math.min(Number(size.width) || current.width, display.workArea.width)));
  const height = Math.round(Math.max(220, Math.min(Number(size.height) || current.height, display.workArea.height)));
  mainWindow.setBounds({ ...current, width, height }, false);
  syncPlayerOverlay();
  return windowModeState();
}

function moveMiniPlayer(position = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !miniPlayerRestoreState) return windowModeState();
  const current = mainWindow.getBounds();
  const requested = {
    x: Math.round(Number(position.x) || current.x),
    y: Math.round(Number(position.y) || current.y),
  };
  const display = screen.getDisplayNearestPoint({ x: requested.x + Math.round(current.width / 2), y: requested.y + 30 });
  const x = Math.max(display.workArea.x, Math.min(requested.x, display.workArea.x + display.workArea.width - current.width));
  const y = Math.max(display.workArea.y, Math.min(requested.y, display.workArea.y + display.workArea.height - current.height));
  mainWindow.setBounds({ ...current, x, y }, false);
  syncPlayerOverlay();
  return windowModeState();
}

async function setMiniPlayer(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (enabled === Boolean(miniPlayerRestoreState)) return enabled;
  if (enabled) {
    if (!nativePlayer) return false;
    miniPlayerRestoreState = {
      bounds: mainWindow.getNormalBounds(),
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
      alwaysOnTop: mainWindow.isAlwaysOnTop(),
      resizable: mainWindow.isResizable(),
    };
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setMinimumSize(360, 220);
    mainWindow.setResizable(true);
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    mainWindow.setBounds(miniPlayerBounds(display.workArea), true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    miniPlayerPinned = true;
    mainWindow.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
  } else {
    const restore = miniPlayerRestoreState;
    miniPlayerRestoreState = null;
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setAlwaysOnTop(restore.alwaysOnTop);
    mainWindow.setMinimumSize(1100, 650);
    mainWindow.setResizable(restore.resizable);
    mainWindow.setBounds(restore.bounds, true);
    if (restore.maximized) mainWindow.maximize();
    if (restore.fullScreen) mainWindow.setFullScreen(true);
    miniPlayerPinned = false;
  }
  publishWindowMode();
  setImmediate(syncPlayerOverlay);
  return Boolean(miniPlayerRestoreState);
}

function syncPlayerOverlay() {
  if (!mainWindow) return;
  const hidden = mainWindow.isMinimized() || !mainWindow.isVisible();
  const bounds = mainWindow.getBounds();
  nativePlayer?.syncVideoBounds(mainWindow.getContentBounds(), !hidden);
  if (!playerOverlay || playerOverlay.isDestroyed()) return;
  if (hidden) playerOverlay.hide();
  else {
    playerOverlay.setBounds(bounds, false);
    if (!playerOverlay.isVisible()) playerOverlay.show();
    playerOverlay.moveTop();
  }
}

function createPlayerOverlay() {
  if (playerOverlay && !playerOverlay.isDestroyed()) return playerOverlay;
  playerOverlay = new BrowserWindow({
    parent: mainWindow,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'player-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  playerOverlay.removeMenu();
  playerOverlay.loadFile(path.join(__dirname, 'player-overlay.html'));
  playerOverlay.once('ready-to-show', () => { syncPlayerOverlay(); publishWindowMode(); playerOverlay.focus(); });
  playerOverlay.on('close', (event) => {
    if (closingPlayerOverlay || !nativePlayer) return;
    event.preventDefault();
    closeNativePlayback(true).catch(() => {});
  });
  playerOverlay.on('closed', () => { playerOverlay = null; });
  return playerOverlay;
}

async function startNativePlayback(key, quality = 'original') {
  if (demoMode) throw new Error('Playback is disabled in visual demo mode.');
  await closeNativePlayback(false);
  const client = requireClient();
  const item = await client.details(key);
  if (!item?.playback?.directPath) throw new Error('Plex did not provide a playable media part.');
  const stored = readStored();
  const direct = mediaUrl(client.server, item.playback.directPath);
  const transcode = mediaUrl(client.server, client.transcodePath(key, quality === 'original' ? '1080' : quality));
  const preferDirect = quality === 'original';
  nativePlayer = new NativeMpvPlayer({
    window: mainWindow,
    client,
    item,
    directUrl: preferDirect ? direct : transcode,
    hlsUrl: preferDirect ? transcode : null,
    directPlay: preferDirect,
    enhancement: stored.enhancement || 'balanced',
    volume: Number.isFinite(stored.volume) ? stored.volume : 100,
  });
  const overlay = createPlayerOverlay();
  const sendState = (state) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('native-player:state', state);
  };
  nativePlayer.on('state', sendState);
  nativePlayer.on('notice', (message) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('native-player:notice', message);
  });
  nativePlayer.on('ended', () => closeNativePlayback(true).catch(() => {}));
  await nativePlayer.start();
  syncPlayerOverlay();
  return { native: true, ratingKey: item.ratingKey, title: item.title, kind: item.kind };
}

async function closeNativePlayback(notifyRenderer) {
  if (miniPlayerRestoreState && mainWindow && !mainWindow.isDestroyed()) await setMiniPlayer(false);
  const player = nativePlayer;
  nativePlayer = null;
  if (player) await player.close().catch(() => {});
  if (playerOverlay && !playerOverlay.isDestroyed()) {
    closingPlayerOverlay = true;
    playerOverlay.destroy();
    closingPlayerOverlay = false;
    playerOverlay = null;
  }
  if (notifyRenderer && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('native-player:closed');
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1100, minHeight: 650, show: false,
    backgroundColor: '#080c12', title: 'Minova Cinema',
    icon: path.join(__dirname, '..', 'assets', 'minova-cinema.ico'),
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  for (const event of ['move', 'resize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, () => setImmediate(syncPlayerOverlay));
  }
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, () => mainWindow?.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(), fullScreen: mainWindow.isFullScreen(),
    }));
  }
  mainWindow.on('minimize', syncPlayerOverlay);
  mainWindow.on('close', () => { closeNativePlayback(false).catch(() => {}); });
  if (nativeQaReportArgument && nativeQaMediaArgument) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(runNativePlayerQa, 700));
  }
  if (qaReportArgument) {
    const reportPath = path.resolve(qaReportArgument.slice('--qa-report='.length));
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      let report;
      try {
        const beforeWindowState = {
          bounds: mainWindow.getBounds(), fullScreen: mainWindow.isFullScreen(),
          maximized: mainWindow.isMaximized(), minimized: mainWindow.isMinimized(),
        };
        report = await mainWindow.webContents.executeJavaScript('window.__runMinovaQa()');
        const afterWindowState = {
          bounds: mainWindow.getBounds(), fullScreen: mainWindow.isFullScreen(),
          maximized: mainWindow.isMaximized(), minimized: mainWindow.isMinimized(),
        };
        const windowStateStable = JSON.stringify(beforeWindowState) === JSON.stringify(afterWindowState);
        report.results.push({
          name: 'Grid controls do not resize, minimize, maximize, or fullscreen the window',
          passed: windowStateStable,
          detail: { before: beforeWindowState, after: afterWindowState },
        });
        report.total += 1;
        if (!windowStateStable) report.failed += 1;
        report.passed = report.failed === 0;
      } catch (error) {
        report = { passed: false, fatal: error.stack || error.message };
      }
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      app.quit();
    }, 1800));
  }
  if (qaPersistenceSaveArgument || qaPersistenceCheckArgument) {
    const reportArgument = qaPersistenceSaveArgument || qaPersistenceCheckArgument;
    const reportPath = path.resolve(reportArgument.slice(reportArgument.indexOf('=') + 1));
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      let renderer;
      try {
        if (qaPersistenceSaveArgument) {
          const server = qaServerArgument?.slice('--qa-server='.length) || '';
          const token = qaTokenArgument?.slice('--qa-token='.length) || '';
          renderer = await mainWindow.webContents.executeJavaScript(
            `window.__runMinovaPersistenceSave(${JSON.stringify(server)}, ${JSON.stringify(token)})`,
          );
        } else {
          renderer = await mainWindow.webContents.executeJavaScript('window.__runMinovaPersistenceCheck()');
        }
        const connection = getConnection();
        const rawSettings = fs.existsSync(configPath()) ? fs.readFileSync(configPath(), 'utf8') : '';
        const testToken = qaTokenArgument?.slice('--qa-token='.length) || '';
        const report = {
          passed: Boolean(
            renderer?.connected && renderer?.browse && !renderer?.onboarding && connection &&
            (!qaPersistenceSaveArgument || renderer?.focusChecksPassed) &&
            (!qaPersistenceSaveArgument || connection.token === testToken) &&
            (!testToken || !rawSettings.includes(testToken))
          ),
          phase: qaPersistenceSaveArgument ? 'save' : 'reopen',
          renderer,
          stored: Boolean(connection),
          encryptedTokenPresent: rawSettings.includes('encryptedToken'),
          plaintextTokenAbsent: !testToken || !rawSettings.includes(testToken),
        };
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      } catch (error) {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, fatal: error.stack || error.message }, null, 2), 'utf8');
      }
      app.quit();
    }, 1000));
  }
  if (captureArgument) {
    const capturePath = path.resolve(captureArgument.slice('--capture='.length));
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (captureView === 'grid-click') {
        await mainWindow.webContents.executeJavaScript("document.querySelector('[data-action=\"layout\"]')?.click()");
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else if (captureView === 'plex-signin-waiting') {
        await mainWindow.webContents.executeJavaScript("window.__showPlexSignInPreview?.('waiting')");
        await new Promise((resolve) => setTimeout(resolve, 120));
      } else if (captureView === 'plex-server-picker') {
        await mainWindow.webContents.executeJavaScript("window.__showPlexSignInPreview?.('select-server')");
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const image = await mainWindow.capturePage();
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      fs.writeFileSync(capturePath, image.toPNG());
      app.quit();
    }, 2800));
  }
}

async function runNativePlayerQa() {
  const reportPath = path.resolve(nativeQaReportArgument.slice('--native-qa-report='.length));
  const mediaPath = path.resolve(nativeQaMediaArgument.slice('--native-qa-media='.length));
  let report;
  try {
    await mainWindow.webContents.executeJavaScript("document.body.innerHTML = '<div style=\"position:fixed;inset:0;background:#ff00ff\"></div>'");
    const client = {
      token: '',
      timeline: async () => true,
      setWatched: async () => true,
    };
    const item = {
      ratingKey: 'native-qa', title: 'Native libmpv QA', kind: 'movie',
      durationMs: 0, viewOffsetMs: 0, technical: {}, playback: { directPath: mediaPath },
    };
    nativePlayer = new NativeMpvPlayer({
      window: mainWindow, client, item, directUrl: new URL(`file:///${mediaPath.replace(/\\/g, '/')}`).toString(),
      hlsUrl: null, enhancement: 'balanced', volume: 80,
    });
    const overlay = createPlayerOverlay();
    nativePlayer.on('state', (state) => { if (!overlay.isDestroyed()) overlay.webContents.send('native-player:state', state); });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native playback did not become ready within 12 seconds.')), 12000);
      nativePlayer.on('state', (state) => {
        if (state.error) { clearTimeout(timeout); reject(new Error(state.error)); }
        else if (state.ready) { clearTimeout(timeout); resolve(state); }
      });
    });
    await nativePlayer.start();
    await ready;
    await nativePlayer.execute('seek-absolute', 5);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const windowSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 900 } });
    const separateVideoWindow = windowSources.some((source) =>
      source.name === 'Minova Cinema Native Video' || source.name === 'Minova Cinema Embedded Video');
    const temporaryCapture = !nativeQaCaptureArgument;
    const capturePath = nativeQaCaptureArgument
      ? path.resolve(nativeQaCaptureArgument.slice('--native-qa-capture='.length))
      : path.join(app.getPath('temp'), `minova-embedded-player-${process.pid}.png`);
    fs.mkdirSync(path.dirname(capturePath), { recursive: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    overlay.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.moveTop();
    syncPlayerOverlay();
    overlay.moveTop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await nativePlayer.captureComposedWindow(capturePath);
    } finally {
      overlay.setAlwaysOnTop(false);
      mainWindow.setAlwaysOnTop(false);
    }
    let videoLumaRange = 0;
    let magentaRatio = 1;
    const playerCapture = nativeImage.createFromPath(capturePath);
    if (!playerCapture.isEmpty()) {
      const captureSize = playerCapture.getSize();
      const center = playerCapture.crop({
        x: Math.round(captureSize.width * 0.1), y: Math.round(captureSize.height * 0.2),
        width: Math.max(1, Math.round(captureSize.width * 0.8)), height: Math.max(1, Math.round(captureSize.height * 0.6)),
      });
      const bitmap = center.toBitmap();
      let minimum = 255;
      let maximum = 0;
      let sampled = 0;
      let magenta = 0;
      for (let offset = 0; offset + 3 < bitmap.length; offset += 92) {
        sampled += 1;
        if (bitmap[offset] > 220 && bitmap[offset + 1] < 35 && bitmap[offset + 2] > 220) magenta += 1;
        const luma = (bitmap[offset] + bitmap[offset + 1] + bitmap[offset + 2]) / 3;
        minimum = Math.min(minimum, luma);
        maximum = Math.max(maximum, luma);
      }
      videoLumaRange = maximum - minimum;
      magentaRatio = sampled ? magenta / sampled : 1;
    }
    if (temporaryCapture) { try { fs.unlinkSync(capturePath); } catch {} }
    await nativePlayer.execute('volume', 63);
    await nativePlayer.execute('enhancement', 'high');
    await nativePlayer.execute('toggle-pause');
    const state = nativePlayer.snapshot();
    const normalBounds = mainWindow.getNormalBounds();
    const miniEnabled = await setMiniPlayer(true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const miniBounds = mainWindow.getBounds();
    const miniAlwaysOnTop = mainWindow.isAlwaysOnTop();
    const miniPlayerWindow = miniEnabled && miniAlwaysOnTop && mainWindow.isResizable()
      && miniBounds.width <= 560 && miniBounds.height <= 340
      && miniBounds.width >= 360 && miniBounds.height >= 220;
    const miniPlayerUnpins = !setMiniPlayerPinned(false) && !mainWindow.isAlwaysOnTop();
    const miniPlayerRepins = setMiniPlayerPinned(true) && mainWindow.isAlwaysOnTop();
    resizeMiniPlayer({ width: 700, height: 440 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const resizedMiniBounds = mainWindow.getBounds();
    const miniPlayerResizes = resizedMiniBounds.width === 700 && resizedMiniBounds.height === 440;
    const miniDisplay = screen.getDisplayMatching(resizedMiniBounds);
    const moveTarget = { x: miniDisplay.workArea.x + 48, y: miniDisplay.workArea.y + 52 };
    moveMiniPlayer(moveTarget);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const movedMiniBounds = mainWindow.getBounds();
    const miniPlayerMoves = movedMiniBounds.x === moveTarget.x && movedMiniBounds.y === moveTarget.y;
    const miniOverlayMatches = !overlay.isDestroyed()
      && JSON.stringify(overlay.getBounds()) === JSON.stringify(mainWindow.getBounds());
    let miniCapturePath = null;
    if (nativeQaCaptureArgument && miniPlayerWindow && miniOverlayMatches) {
      miniCapturePath = capturePath.replace(/(\.[^.]+)?$/, '-mini$1');
      await overlay.webContents.executeJavaScript("document.getElementById('player-overlay')?.classList.remove('controls-hidden')");
      await new Promise((resolve) => setTimeout(resolve, 80));
      await nativePlayer.captureComposedWindow(miniCapturePath);
    }
    const miniDisabled = !(await setMiniPlayer(false));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const restoredBounds = mainWindow.getNormalBounds();
    const miniPlayerRestores = miniDisabled && !mainWindow.isAlwaysOnTop()
      && JSON.stringify(restoredBounds) === JSON.stringify(normalBounds);
    report = {
      passed: state.ready && state.videoSurfaceReady && !separateVideoWindow && videoLumaRange > 18 && magentaRatio < 0.2 && state.paused && Math.abs(state.volume - 63) < 1 && state.enhancement === 'high' && state.enhancementActive && miniPlayerWindow && miniPlayerUnpins && miniPlayerRepins && miniPlayerResizes && miniPlayerMoves && miniOverlayMatches && miniPlayerRestores,
      state,
      checks: {
        embeddedNativeProcess: Boolean(nativePlayer.process && !nativePlayer.process.killed),
        nativeVideoSurface: state.videoSurfaceReady,
        noSeparateVideoWindow: !separateVideoWindow,
        composedPlayerCaptured: Boolean(playerCapture),
        visiblePicture: videoLumaRange > 18 && magentaRatio < 0.2,
        videoLumaRange,
        hiddenUnderlayRatio: magentaRatio,
        mediaLoaded: state.ready,
        pauseControl: state.paused,
        volumeControl: Math.abs(state.volume - 63) < 1,
        shaderMode: state.enhancement === 'high' && state.enhancementActive,
        trackDiscovery: Array.isArray(state.tracks),
        miniPlayerWindow,
        miniPlayerEnabled: miniEnabled,
        miniPlayerAlwaysOnTop: miniAlwaysOnTop,
        miniPlayerBounds: miniBounds,
        miniPlayerUnpins,
        miniPlayerRepins,
        miniPlayerResizes,
        resizedMiniBounds,
        miniPlayerMoves,
        movedMiniBounds,
        miniOverlayMatches,
        miniPlayerCapture: miniCapturePath,
        miniPlayerRestores,
      },
    };
  } catch (error) {
    report = { passed: false, fatal: error.stack || error.message };
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await closeNativePlayback(false);
  app.quit();
}

app.whenReady().then(async () => {
  migratePreviousDesktopProfile();
  removeObsoleteStandalonePlayer();
  await installMediaProtocol();
  registerIpc();
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (updateTimer) clearInterval(updateTimer); });
