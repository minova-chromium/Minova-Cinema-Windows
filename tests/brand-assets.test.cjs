const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function pngSize(file) {
  const data = fs.readFileSync(file);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('desktop surfaces use the supplied high-resolution Minova brand', () => {
  const wordmark = pngSize(path.join(root, 'assets', 'minova-wordmark.png'));
  const cinema = pngSize(path.join(root, 'assets', 'minova-cinema-wordmark.png'));
  const symbol = pngSize(path.join(root, 'assets', 'minova-symbol-color.png'));

  assert.ok(wordmark.width >= 6000 && wordmark.height >= 1000);
  assert.ok(cinema.width >= 6000 && cinema.height >= 2000);
  assert.deepEqual(symbol, { width: 1024, height: 1024 });

  const renderer = [
    fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8'),
  ].join('\n');
  assert.match(renderer, /minova-cinema-wordmark\.png/);
  assert.match(renderer, /minova-symbol-color\.png/);
  assert.doesNotMatch(renderer, /minova-symbol-color\.svg|assets\/cinema-wordmark\.png/);
});

test('Windows icon contains the generated multi-size Minova symbol', () => {
  const icon = fs.readFileSync(path.join(root, 'assets', 'minova-cinema.ico'));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 9);
  assert.ok(icon.length > 10_000);
});

test('custom installer embeds the real Minova PNG instead of converting the ICO', () => {
  const builder = fs.readFileSync(path.join(root, 'scripts', 'Build-CustomInstaller.ps1'), 'utf8');
  const bootstrapper = fs.readFileSync(path.join(root, 'installer', 'MinovaCinemaBootstrapper.cs'), 'utf8');

  assert.match(builder, /assets\\minova-symbol-color\.png/);
  assert.doesNotMatch(builder, /ToBitmap\(\)/);
  assert.match(bootstrapper, /Image titleLogo = LoadLogo\(\)/);
});
