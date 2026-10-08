import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
test('production manifest exposes only the native plugin and client', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './locale/*.json', './package.json'].sort());
  assert.equal(manifest.scripts.start, undefined, 'a DSH plugin has no standalone application launcher');
  assert.equal(manifest.dependencies, undefined, 'host packages must come from the existing DSH installation');
});

test('production tarball excludes all standalone and private runtime files', async () => {
  const destination = await mkdtemp(resolve(tmpdir(), 'dsh-bot-pack-'));
  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {cwd: root, encoding: 'utf8', timeout: 30000}));
    const names = packed.files.map(file => file.path);
    const forbidden = /(^node_modules\/|server\.mjs$|(^|[/-])(owner|native-controller|runtime-export)|^ui\/|^scripts\/|^tools\/)/;
    assert.deepEqual(names.filter(name => forbidden.test(name)), []);
    assert.ok(names.includes('src/native/plugin.mjs'));
    assert.ok(names.includes('src/client/client.js'));
    for (const file of names.filter(name => /\.(mjs|js|json|yml)$/.test(name))) {
      const text = await readFile(resolve(root, file), 'utf8');
      assert.equal(/dsh-experimental-native-run|__DSH_BOOT__|\/dsh-bot-owner/.test(text), false, file);
    }
  } finally {
    await rm(destination, {recursive: true, force: true});
  }
});
