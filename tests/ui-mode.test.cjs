const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('ships stable and experimental renderers in one application', () => {
  const stable = read('src/index.html');
  const experimental = read('src/index-experimental.html');

  assert.match(stable, /styles\.css/);
  assert.match(stable, /app\.js/);
  assert.doesNotMatch(stable, /experimental/i);
  assert.match(experimental, /styles-experimental\.css/);
  assert.match(experimental, /app-experimental\.js/);
});

test('persists the selected interface and reloads only the renderer', () => {
  const main = read('src/main.cjs');
  const preload = read('src/preload.cjs');

  assert.match(main, /stored\.uiMode === 'experimental'/);
  assert.match(main, /ipcMain\.handle\('ui:set-mode'/);
  assert.match(main, /loadSelectedRenderer\(\)/);
  assert.match(preload, /setUiMode: \(mode\) => ipcRenderer\.invoke\('ui:set-mode', mode\)/);
});

test('both interfaces expose the Stable and Experimental UI setting', () => {
  for (const file of ['src/app.js', 'src/app-experimental.js']) {
    const renderer = read(file);
    assert.match(renderer, /id="ui-mode"/);
    assert.match(renderer, />Stable UI</);
    assert.match(renderer, />Experimental UI</);
    assert.match(renderer, /window\.minova\.setUiMode\(mode\)/);
  }
});
