const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha512Base64(file) {
  const digest = crypto.createHash('sha512');
  digest.update(fs.readFileSync(file));
  return digest.digest('base64');
}

function yamlValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*(?:'([^']*)'|"([^"]*)"|([^\\r\\n]+))\\s*$`, 'm'));
  return match ? (match[1] || match[2] || match[3] || '').trim() : '';
}

function prepareUpdateRelease(root = path.join(__dirname, '..')) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = String(packageJson.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version || '(missing)'}`);
  }

  const dist = path.join(root, 'dist');
  const metadataPath = path.join(dist, 'latest.yml');
  const setupName = `Minova-Cinema-Desktop-${version}-Setup.exe`;
  const setupPath = path.join(dist, setupName);
  if (!fs.existsSync(metadataPath)) throw new Error(`Missing electron-builder metadata: ${metadataPath}`);
  if (!fs.existsSync(setupPath)) throw new Error(`Missing custom Minova updater: ${setupPath}`);

  const previous = fs.readFileSync(metadataPath, 'utf8');
  const metadataVersion = yamlValue(previous, 'version');
  if (metadataVersion && metadataVersion !== version) {
    throw new Error(`latest.yml version ${metadataVersion} does not match package version ${version}`);
  }

  const releaseDate = yamlValue(previous, 'releaseDate') || new Date().toISOString();
  const size = fs.statSync(setupPath).size;
  const sha512 = sha512Base64(setupPath);
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${setupName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${setupName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  fs.writeFileSync(metadataPath, metadata, 'utf8');
  return { metadataPath, setupPath, setupName, version, size, sha512 };
}

if (require.main === module) {
  const result = prepareUpdateRelease();
  process.stdout.write(
    `Automatic updates now use ${result.setupName}\n` +
    `  ${result.size} bytes\n` +
    `  SHA-512 ${result.sha512}\n`,
  );
}

module.exports = { prepareUpdateRelease, sha512Base64, yamlValue };
