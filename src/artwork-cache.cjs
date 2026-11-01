const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

class ArtworkCache {
  constructor(directory, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.directory = path.resolve(directory);
    this.maxBytes = Math.max(1024 * 1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
  }

  key(identifier) {
    return crypto.createHash('sha256').update(String(identifier || '')).digest('hex');
  }

  paths(identifier) {
    const key = this.key(identifier);
    return {
      body: path.join(this.directory, `${key}.bin`),
      metadata: path.join(this.directory, `${key}.json`),
    };
  }

  async get(identifier) {
    const files = this.paths(identifier);
    try {
      const [body, metadata] = await Promise.all([
        fs.readFile(files.body),
        fs.readFile(files.metadata, 'utf8').then(JSON.parse),
      ]);
      const now = new Date();
      fs.utimes(files.body, now, now).catch(() => {});
      return {
        body,
        contentType: String(metadata.contentType || 'image/jpeg'),
      };
    } catch { return null; }
  }

  async put(identifier, body, contentType) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
    if (!bytes.length || !String(contentType || '').toLowerCase().startsWith('image/')) return false;
    const files = this.paths(identifier);
    await fs.mkdir(this.directory, { recursive: true });
    try {
      await fs.writeFile(files.body, bytes, { flag: 'wx' });
      await fs.writeFile(files.metadata, JSON.stringify({ contentType: String(contentType) }), { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        await Promise.allSettled([fs.unlink(files.body), fs.unlink(files.metadata)]);
        throw error;
      }
    }
    await this.trim();
    return true;
  }

  async entries() {
    let names;
    try { names = await fs.readdir(this.directory); } catch { return []; }
    const entries = await Promise.all(names.filter((value) => value.endsWith('.bin')).map(async (name) => {
      const file = path.join(this.directory, name);
      try {
        const stat = await fs.stat(file);
        return { file, metadata: file.replace(/\.bin$/, '.json'), size: stat.size, modifiedMs: stat.mtimeMs };
      } catch { return null; }
    }));
    return entries.filter(Boolean);
  }

  async stats() {
    const entries = await this.entries();
    return {
      entries: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0),
      maxBytes: this.maxBytes,
    };
  }

  async trim() {
    const entries = (await this.entries()).sort((left, right) => left.modifiedMs - right.modifiedMs);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= this.maxBytes) break;
      await Promise.allSettled([fs.unlink(entry.file), fs.unlink(entry.metadata)]);
      total -= entry.size;
    }
  }

  async clear() {
    await fs.rm(this.directory, { recursive: true, force: true });
    return this.stats();
  }
}

module.exports = { ArtworkCache, DEFAULT_MAX_BYTES };
