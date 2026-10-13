const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { prepareUpdateRelease } = require('../scripts/Prepare-UpdateRelease.cjs');

test('release metadata sends automatic updates through the branded setup UI', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'minova-update-release-'));
  try {
    fs.mkdirSync(path.join(fixture, 'dist'));
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    const setup = Buffer.from('custom Minova updater fixture');
    fs.writeFileSync(path.join(fixture, 'dist', 'Minova-Cinema-Desktop-2.3.4-Setup.exe'), setup);
    fs.writeFileSync(path.join(fixture, 'dist', 'latest.yml'), [
      'version: 2.3.4',
      'files:',
      '  - url: Minova-Cinema-Desktop-2.3.4-Update.exe',
      '    sha512: old',
      '    size: 1',
      'path: Minova-Cinema-Desktop-2.3.4-Update.exe',
      'sha512: old',
      "releaseDate: '2026-10-13T12:00:00.000Z'",
      '',
    ].join('\n'));

    prepareUpdateRelease(fixture);

    const metadata = fs.readFileSync(path.join(fixture, 'dist', 'latest.yml'), 'utf8');
    const expectedHash = crypto.createHash('sha512').update(setup).digest('base64');
    assert.match(metadata, /url: Minova-Cinema-Desktop-2\.3\.4-Setup\.exe/);
    assert.match(metadata, /path: Minova-Cinema-Desktop-2\.3\.4-Setup\.exe/);
    assert.doesNotMatch(metadata, /Update\.exe|blockmap/);
    assert.equal((metadata.match(new RegExp(expectedHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 2);
    assert.match(metadata, new RegExp(`size: ${setup.length}`));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('desktop updater and custom bootstrapper agree on the branded update contract', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
  const bootstrapper = fs.readFileSync(path.join(root, 'installer', 'MinovaCinemaBootstrapper.cs'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.match(main, /disableDifferentialDownload\s*=\s*true/);
  assert.match(main, /quitAndInstall\(false, true\)/);
  assert.match(bootstrapper, /"--updated"/);
  assert.match(packageJson.scripts.dist, /installer:custom.*installer:metadata/);
});
