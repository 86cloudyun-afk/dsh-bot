import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { preparePackageSnapshot } from './prepare-package-snapshot.mjs';
const root = resolve(import.meta.dirname, '..');
const temp = realpathSync(mkdtempSync(resolve(tmpdir(), 'dsh-bot-tests-')));
try {
  // Every verification invocation packs current source into this new temporary root.
  // No installed/cached snapshot is accepted, and the child keeps its original guard.
  const packageSnapshot = await preparePackageSnapshot({ productRoot: root, temporaryRoot: temp });
  writeFileSync(resolve(temp, 'current-package-snapshot.json'), JSON.stringify(packageSnapshot), {flag:'wx', mode:0o600});
  const manifest=JSON.parse(readFileSync(packageSnapshot.manifestPath));
  process.stdout.write(JSON.stringify({packageBuild:{sourceHead:manifest.sourceHead,sourceTree:manifest.sourceTree,sourceWorktreeClean:manifest.sourceWorktreeClean,buildId:manifest.buildId,packageSHA256:manifest.packageSHA256,fileCount:manifest.files.length}})+'\n');
  const result = spawnSync(process.execPath, [
    '--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${temp}`,
    `--allow-fs-write=${temp}`, '--experimental-test-isolation=none',
    '--import', resolve(root, 'scripts/test-safety.mjs'), '--test',
    ...(process.argv.slice(2).length ? process.argv.slice(2) : ['test/*.test.mjs'])
  ], {cwd: root, env: {DSH_HOME: resolve(temp, 'dsh-home'), DSH_BOT_TEST_ROOT: temp, TMPDIR: temp, TZ:'UTC', LANG:'en_US.UTF-8'}, stdio: 'inherit'});
  process.exitCode = result.status ?? 1;
} finally { rmSync(temp, {recursive: true, force: true}); }
