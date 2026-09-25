const { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, protocol, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { PlexClient, isPlexOwnedHost, isTrustedExternalArtworkUrl, normalizeServer, plexHeaders, rewritePlaylist } = require('./plex.cjs');
const { NativeMpvPlayer, mediaUrl } = require('./native-player.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'minova-plex', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let mainWindow;
let playerOverlay;
let nativePlayer;
let closingPlayerOverlay = false;
let activeClient;
let updateTimer;
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

function readStored() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}

function writeStored(settings) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(settings, null, 2), 'utf8');
}

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
  if (['checking', 'downloading'].includes(updateState.status)) return updateState;
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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking', progress: 0, message: 'Checking GitHub for updates…' }));
  autoUpdater.on('update-available', (info) => publishUpdateState({
    status: 'downloading', availableVersion: info.version, progress: 0,
    message: `Downloading Minova Cinema ${info.version}…`,
  }));
  autoUpdater.on('download-progress', (progress) => publishUpdateState({
    status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
    message: `Downloading update… ${Math.round(progress.percent || 0)}%`,
  }));
  autoUpdater.on('update-not-available', () => publishUpdateState({
    status: 'up-to-date', availableVersion: null, progress: 0,
    message: `Minova Cinema ${app.getVersion()} is up to date.`,
  }));
  autoUpdater.on('update-downloaded', (info) => publishUpdateState({
    status: 'downloaded', availableVersion: info.version, progress: 100,
    message: `Minova Cinema ${info.version} is ready to install.`,
  }));
  autoUpdater.on('error', () => publishUpdateState({
    status: 'error', progress: 0, message: 'The update service could not be reached. Try again later.',
  }));
  setTimeout(() => checkForAppUpdates(), 5000);
  updateTimer = setInterval(() => checkForAppUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref?.();
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
    return { server: stored.server, token, quality: stored.quality || 'original' };
  } catch { return null; }
}

function saveConnection(server, token, quality = 'original') {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential storage is not available.');
  const normalized = normalizeServer(server);
  const stored = readStored();
  writeStored({ ...stored, server: normalized, encryptedToken: safeStorage.encryptString(token).toString('base64'), quality });
  activeClient = new PlexClient(normalized, token);
  return normalized;
}

function requireClient() {
  if (activeClient) return activeClient;
  const connection = getConnection();
  if (!connection) throw new Error('Connect a Plex server first.');
  activeClient = new PlexClient(connection.server, connection.token);
  return activeClient;
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
        ? plexHeaders(connection.token)
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
  ipcMain.handle('update:install', () => {
    if (updateState.status !== 'downloaded') throw new Error('No downloaded update is ready to install.');
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });
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
    const candidate = new PlexClient(server, token);
    const serverName = await candidate.test();
    const normalized = saveConnection(server, token, readStored().quality || 'original');
    return { server: normalized, serverName };
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
    try { fs.unlinkSync(configPath()); } catch {}
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
  ipcMain.handle('native-player:state', () => nativePlayer?.snapshot() || null);
  ipcMain.handle('native-player:close', () => closeNativePlayback(true));
  ipcMain.handle('window:fullscreen', () => { mainWindow?.setFullScreen(!mainWindow.isFullScreen()); return mainWindow?.isFullScreen(); });
  ipcMain.handle('external:open', (_event, url) => /^https:\/\//i.test(url) && shell.openExternal(url));
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
  playerOverlay.once('ready-to-show', () => { syncPlayerOverlay(); playerOverlay.focus(); });
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
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#080c12', symbolColor: '#a7b5c5', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  for (const event of ['move', 'resize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, () => setImmediate(syncPlayerOverlay));
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
    report = {
      passed: state.ready && state.videoSurfaceReady && !separateVideoWindow && videoLumaRange > 18 && magentaRatio < 0.2 && state.paused && Math.abs(state.volume - 63) < 1 && state.enhancement === 'high' && state.enhancementActive,
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
  removeObsoleteStandalonePlayer();
  await installMediaProtocol();
  registerIpc();
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (updateTimer) clearInterval(updateTimer); });
