import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const temp = realpathSync(mkdtempSync(resolve(tmpdir(), 'dsh-bot-tests-')));
try {
  const result = spawnSync(process.execPath, [
    '--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${temp}`,
    `--allow-fs-write=${temp}`, '--experimental-test-isolation=none',
    '--import', resolve(root, 'scripts/test-safety.mjs'), '--test',
    ...(process.argv.slice(2).length ? process.argv.slice(2) : ['test/*.test.mjs'])
  ], {cwd: root, env: {DSH_HOME: resolve(temp, 'dsh-home'), DSH_BOT_TEST_ROOT: temp, TMPDIR: temp, TZ:'UTC', LANG:'en_US.UTF-8'}, stdio: 'inherit'});
  process.exitCode = result.status ?? 1;
} finally { rmSync(temp, {recursive: true, force: true}); }
