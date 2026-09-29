const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ENHANCEMENT_MODES = ['off', 'balanced', 'high', 'ultra'];

function resourcePath(...segments) {
  const root = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'vendor'))
    ? process.resourcesPath
    : path.join(__dirname, '..');
  return path.join(root, ...segments);
}

function nativeWindowId(window) {
  const handle = window.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
}

function mediaUrl(server, mediaPath) {
  return /^https?:\/\//i.test(mediaPath)
    ? mediaPath
    : new URL(String(mediaPath).replace(/^\//, ''), `${server.replace(/\/$/, '')}/`).toString();
}

function safeTrack(track, index) {
  return {
    id: track.id,
    type: track.type,
    index,
    title: track.title || track.lang || `${track.type === 'audio' ? 'Audio' : track.type === 'sub' ? 'Subtitle' : 'Video'} ${index + 1}`,
    language: track.lang || '',
    codec: track.codec || '',
    selected: Boolean(track.selected),
    external: Boolean(track.external),
  };
}

class NativeMpvPlayer extends EventEmitter {
  constructor({ window, client, item, directUrl, hlsUrl, directPlay = true, enhancement = 'balanced', volume = 100 }) {
    super();
    this.window = window;
    this.client = client;
    this.item = item;
    this.directUrl = directUrl;
    this.hlsUrl = hlsUrl;
    this.enhancement = ENHANCEMENT_MODES.includes(enhancement) ? enhancement : 'balanced';
    this.volume = Math.max(0, Math.min(100, Number(volume) || 100));
    this.process = null;
    this.windowBridge = null;
    this.socket = null;
    this.buffer = '';
    this.requestId = 1;
    this.pending = new Map();
    this.fallbackUsed = false;
    this.closed = false;
    this.handoffCommitted = false;
    this.timelineTimer = null;
    this.resumeApplied = false;
    this.state = {
      ready: false,
      videoSurfaceReady: false,
      loading: true,
      paused: false,
      position: Math.max(0, Number(item.viewOffsetMs || 0) / 1000),
      duration: Math.max(0, Number(item.durationMs || 0) / 1000),
      volume: this.volume,
      muted: false,
      title: item.secondaryTitle ? `${item.title}  •  ${item.secondaryTitle}` : item.title,
      tracks: [],
      audioId: null,
      subtitleId: null,
      sourceWidth: item.technical?.width || 0,
      sourceHeight: item.technical?.height || 0,
      videoOutputConfigured: false,
      videoOutput: '',
      hardwareDecoder: '',
      enhancement: this.enhancement,
      enhancementActive: false,
      enhancementLabel: 'Starting native player…',
      directPlay: Boolean(directPlay),
      error: null,
    };
  }

  async start() {
    const libMpv = resourcePath('vendor', 'native-host', 'libmpv-2.dll');
    if (!fs.existsSync(libMpv)) throw new Error('The bundled libmpv runtime is missing. Rebuild Minova Cinema Desktop.');
    const pipeName = `\\\\.\\pipe\\minova-cinema-mpv-${randomUUID()}`;
    const shaderCache = path.join(os.tmpdir(), 'MinovaCinema', 'mpv-shader-cache');
    fs.mkdirSync(shaderCache, { recursive: true });
    await this.startWindowBridge(pipeName, shaderCache);
    await this.connect(pipeName);
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk) => this.consume(chunk));
    this.socket.on('error', (error) => { if (!this.closed) this.fail(error.message); });
    this.socket.on('close', () => { if (!this.closed) this.fail('The native player connection closed unexpectedly.'); });

    await this.command(['set_property', 'http-header-fields', `X-Plex-Token: ${this.client.token},X-Plex-Client-Identifier: ${this.client.clientIdentifier || 'MinovaCinemaDesktop'},X-Plex-Product: Minova Cinema`]);
    await this.command(['set_property', 'volume', this.volume]);
    await this.observe();
    await this.applyEnhancement(this.enhancement);
    await this.command(['loadfile', this.directUrl, 'replace']);
    this.timelineTimer = setInterval(() => this.reportTimeline().catch(() => {}), 10000);
    this.emitState();
    return this.snapshot();
  }

  startWindowBridge(pipeName, shaderCache) {
    const helper = resourcePath('vendor', 'native-host', 'MinovaCinema.LibMpvHost.exe');
    if (!fs.existsSync(helper)) throw new Error('The embedded libmpv host is missing. Rebuild Minova Cinema Desktop.');
    const bounds = this.window.getContentBounds();
    this.process = spawn(helper, [
      nativeWindowId(this.window), String(bounds.width), String(bounds.height), pipeName, shaderCache,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.windowBridge = this.process;
    this.windowBridge.stdin.on('error', () => {});
    this.windowBridge.stdout.setEncoding('utf8');
    this.windowBridge.stderr.setEncoding('utf8');
    return new Promise((resolve, reject) => {
      let settled = false;
      let output = '';
      let errors = '';
      const timer = setTimeout(() => finish(new Error('The native video surface did not appear within 15 seconds.')), 16000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      this.windowBridge.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.split(/\r?\n/).some((line) => line.startsWith('READY\t'))) {
          this.state.videoSurfaceReady = true;
          this.emitState();
          finish();
        }
      });
      this.windowBridge.stderr.on('data', (chunk) => { errors = `${errors}${chunk}`.slice(-2000); });
      this.windowBridge.once('error', (error) => finish(error));
      this.windowBridge.once('exit', (code) => {
        const detail = errors.trim() ? `: ${errors.trim()}` : '.';
        if (!settled) finish(new Error(`Embedded libmpv host exited (${code})${detail}`));
        else if (!this.closed) this.fail(`Embedded libmpv host exited unexpectedly (${code})${detail}`);
      });
    });
  }

  writeWindowBridge(command) {
    const input = this.windowBridge?.stdin;
    if (!input || input.destroyed || input.writableEnded || !input.writable) return;
    try { input.write(`${command}\n`, () => {}); } catch {}
  }

  syncVideoBounds(bounds, visible = true) {
    if (!bounds) return;
    if (visible) this.writeWindowBridge(`bounds\t0\t0\t${bounds.width}\t${bounds.height}`);
    else this.writeWindowBridge('hide');
  }

  async captureComposedWindow(outputPath) {
    try { fs.unlinkSync(outputPath); } catch {}
    this.writeWindowBridge(`capture\t${outputPath}`);
    let previousSize = -1;
    let stableChecks = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      if (size > 0 && size === previousSize) stableChecks += 1;
      else stableChecks = 0;
      if (stableChecks >= 3) return outputPath;
      previousSize = size;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The embedded player screenshot did not complete.');
  }

  connect(pipeName) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        if (this.closed) return reject(new Error('Native player startup was cancelled.'));
        const socket = net.createConnection(pipeName);
        socket.once('connect', () => { this.socket = socket; resolve(); });
        socket.once('error', (error) => {
          socket.destroy();
          attempts += 1;
          if (attempts >= 100) reject(new Error(`Could not connect to native mpv: ${error.message}`));
          else setTimeout(attempt, 50);
        });
      };
      attempt();
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try { this.handleMessage(JSON.parse(line)); } catch {}
    }
  }

  handleMessage(message) {
    if (message.request_id != null && this.pending.has(message.request_id)) {
      const pending = this.pending.get(message.request_id);
      this.pending.delete(message.request_id);
      if (message.error && message.error !== 'success') pending.reject(new Error(`mpv: ${message.error}`));
      else pending.resolve(message.data);
      return;
    }
    if (message.event === 'property-change') this.propertyChanged(message.name, message.data);
    else if (message.event === 'file-loaded') this.fileLoaded().catch((error) => this.fail(error.message));
    else if (message.event === 'end-file') this.endFile(message).catch((error) => this.fail(error.message));
  }

  propertyChanged(name, value) {
    if (name === 'time-pos') this.state.position = Number(value) || 0;
    else if (name === 'duration') this.state.duration = Number(value) || this.state.duration;
    else if (name === 'pause') this.state.paused = Boolean(value);
    else if (name === 'volume') this.state.volume = Number(value) || 0;
    else if (name === 'mute') this.state.muted = Boolean(value);
    else if (name === 'aid') this.state.audioId = value === false ? null : value;
    else if (name === 'sid') this.state.subtitleId = value === false ? null : value;
    else if (name === 'track-list') this.state.tracks = (value || []).map(safeTrack);
    else if (name === 'vo-configured') this.state.videoOutputConfigured = Boolean(value);
    else if (name === 'current-vo') this.state.videoOutput = value || '';
    else if (name === 'hwdec-current') this.state.hardwareDecoder = value || '';
    else if (name === 'video-params' && value) {
      this.state.sourceWidth = Number(value.w || value.dw) || this.state.sourceWidth;
      this.state.sourceHeight = Number(value.h || value.dh) || this.state.sourceHeight;
      this.refreshEnhancementLabel();
    }
    this.emitState();
  }

  async fileLoaded() {
    this.state.ready = true;
    this.state.loading = false;
    this.state.error = null;
    if (!this.resumeApplied && this.item.viewOffsetMs > 0) {
      this.resumeApplied = true;
      await this.command(['seek', this.item.viewOffsetMs / 1000, 'absolute+exact']);
    }
    await this.command(['set_property', 'pause', false]);
    this.syncVideoBounds(this.window.getContentBounds(), true);
    await this.refreshProperties();
    await this.reportTimeline('playing');
    this.emitState();
  }

  async endFile(message) {
    if (this.closed) return;
    if (message.reason === 'error' && !this.fallbackUsed && this.hlsUrl) {
      this.fallbackUsed = true;
      this.state.directPlay = false;
      this.state.loading = true;
      this.state.error = null;
      this.emit('notice', 'Direct Play unavailable — Plex conversion started.');
      await this.command(['loadfile', this.hlsUrl, 'replace']);
      return;
    }
    if (message.reason === 'eof') {
      await this.client.setWatched(this.item.ratingKey, true).catch(() => {});
      await this.reportTimeline('stopped').catch(() => {});
      this.emit('ended');
      return;
    }
    if (message.reason === 'error') this.fail(`mpv could not play this item${message.file_error ? `: ${message.file_error}` : '.'}`);
  }

  observe() {
    const names = ['time-pos', 'duration', 'pause', 'volume', 'mute', 'aid', 'sid', 'track-list', 'video-params', 'vo-configured', 'current-vo', 'hwdec-current'];
    return Promise.all(names.map((name, index) => this.command(['observe_property', index + 1, name])));
  }

  async refreshProperties() {
    const names = ['time-pos', 'duration', 'pause', 'volume', 'mute', 'aid', 'sid', 'track-list', 'video-params', 'vo-configured', 'current-vo', 'hwdec-current'];
    for (const name of names) {
      try { this.propertyChanged(name, await this.command(['get_property', name])); } catch {}
    }
  }

  command(command) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('Native player is not connected.'));
    const requestId = this.requestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`mpv command timed out: ${command[0]}`));
      }, 5000);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`);
    });
  }

  async execute(action, value) {
    if (action === 'toggle-pause') await this.command(['cycle', 'pause']);
    else if (action === 'seek-relative') await this.command(['seek', Number(value) || 0, 'relative+exact']);
    else if (action === 'seek-absolute') await this.command(['seek', Math.max(0, Number(value) || 0), 'absolute+exact']);
    else if (action === 'volume') await this.command(['set_property', 'volume', Math.max(0, Math.min(100, Number(value) || 0))]);
    else if (action === 'mute') await this.command(['cycle', 'mute']);
    else if (action === 'audio') await this.command(['set_property', 'aid', value]);
    else if (action === 'subtitle') await this.command(['set_property', 'sid', value == null || value === 'no' ? 'no' : value]);
    else if (action === 'enhancement') await this.applyEnhancement(String(value));
    else if (action === 'resync') await this.command(['seek', 0, 'relative+exact']);
    await this.refreshProperties();
    return this.snapshot();
  }

  async applyEnhancement(mode) {
    this.enhancement = ENHANCEMENT_MODES.includes(mode) ? mode : 'balanced';
    this.state.enhancement = this.enhancement;
    await this.command(['change-list', 'glsl-shaders', 'clr', '']);
    const neural = this.enhancement === 'high' || this.enhancement === 'ultra';
    const shader = this.enhancement === 'ultra' ? 'ArtCNN_C4F32.glsl' : neural ? 'ArtCNN_C4F16.glsl' : null;
    if (shader) {
      const shaderPath = resourcePath('vendor', 'shaders', shader);
      if (fs.existsSync(shaderPath)) await this.command(['change-list', 'glsl-shaders', 'append', shaderPath]);
      else this.enhancement = 'balanced';
    }
    const enabled = this.enhancement !== 'off' && (!this.state.sourceHeight || this.state.sourceHeight <= 1080);
    await this.command(['set_property', 'scale', enabled ? 'ewa_lanczossharp' : 'bilinear']);
    await this.command(['set_property', 'cscale', enabled ? 'ewa_lanczossharp' : 'bilinear']);
    await this.command(['set_property', 'dscale', neural ? 'ewa_lanczossharp' : enabled ? 'mitchell' : 'bilinear']);
    await this.command(['set_property', 'sigmoid-upscaling', enabled ? 'yes' : 'no']);
    await this.command(['set_property', 'deband', enabled ? 'yes' : 'no']);
    this.refreshEnhancementLabel();
    this.emitState();
  }

  refreshEnhancementLabel() {
    const height = this.state.sourceHeight;
    const active = this.enhancement !== 'off' && (!height || height <= 1080);
    this.state.enhancementActive = active;
    const label = { off: 'Off', balanced: 'GPU Balanced', high: 'ArtCNN High', ultra: 'ArtCNN Ultra' }[this.enhancement];
    this.state.enhancementLabel = !active && height > 1080
      ? `Native ${height}p · enhancement bypassed`
      : `${label}${height ? ` · ${height}p source` : ''}`;
  }

  async reportTimeline(state) {
    const playbackState = state || (this.state.paused ? 'paused' : 'playing');
    await this.client.timeline(this.item, playbackState, this.state.position * 1000);
  }

  async handoff() {
    await this.command(['set_property', 'pause', true]);
    await this.refreshProperties();
    await this.reportTimeline('paused');
    this.handoffCommitted = true;
    return this.snapshot();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  emitState() {
    this.emit('state', this.snapshot());
  }

  fail(message) {
    this.state.loading = false;
    this.state.error = message || 'Native playback failed.';
    this.emitState();
    this.emit('error-state', this.state.error);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timelineTimer);
    const bridge = this.windowBridge;
    if (bridge?.stdin && !bridge.stdin.destroyed && !bridge.stdin.writableEnded) {
      try { bridge.stdin.end('hide\nquit\n', () => {}); } catch {}
    }
    if (!this.handoffCommitted) await this.reportTimeline('stopped').catch(() => {});
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.write(`${JSON.stringify({ command: ['quit'] })}\n`); } catch {}
      this.socket.destroy();
    }
    if (bridge && bridge.exitCode == null) {
      const forceClose = setTimeout(() => { if (bridge.exitCode == null) bridge.kill(); }, 1000);
      forceClose.unref();
    }
    for (const pending of this.pending.values()) pending.reject(new Error('Native player closed.'));
    this.pending.clear();
  }
}

module.exports = { NativeMpvPlayer, ENHANCEMENT_MODES, mediaUrl, nativeWindowId, resourcePath };
