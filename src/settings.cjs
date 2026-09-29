const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readSettings(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `settings-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

function migrateLegacySettings(currentFile, legacyFiles) {
  const current = readSettings(currentFile);
  if (current.server && current.encryptedToken) return { migrated: false, settings: current };

  for (const legacyFile of legacyFiles) {
    if (path.resolve(legacyFile) === path.resolve(currentFile)) continue;
    const legacy = readSettings(legacyFile);
    if (!legacy.server || !legacy.encryptedToken) continue;
    // Keep any preferences already written by the current build, but recover
    // the encrypted connection from the previous Electron profile directory.
    const merged = {
      ...legacy,
      ...current,
      server: legacy.server,
      encryptedToken: legacy.encryptedToken,
    };
    writeSettings(currentFile, merged);
    return { migrated: true, settings: merged, source: legacyFile };
  }
  return { migrated: false, settings: current };
}

function selectConnectionToken(providedToken, rememberedToken) {
  return String(providedToken || '').trim() || String(rememberedToken || '').trim();
}

function ensureClientIdentifier(file) {
  const settings = readSettings(file);
  const existing = String(settings.clientIdentifier || '').trim();
  if (existing) return existing;
  const clientIdentifier = `MinovaCinemaDesktop-${randomUUID()}`;
  writeSettings(file, { ...settings, clientIdentifier });
  return clientIdentifier;
}

module.exports = { ensureClientIdentifier, migrateLegacySettings, readSettings, selectConnectionToken, writeSettings };
