/** Index public source inputs, verified private overlays, and the exact local build recipe. */
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve(process.argv[2] ?? process.cwd());
const evidence = resolve(process.argv[3] ?? import.meta.dirname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: source }).toString().split('\0').filter(Boolean);
const forbidden = path => path.split('/').some(value => ['.agents', '.codex', 'node_modules', '.git'].includes(value) || value === '.env' || value.startsWith('.env.'));
const selected = new Set(tracked.filter(path => !forbidden(path) && ['native', 'vendor', 'packages', 'scripts', 'patches'].includes(path.split('/')[0]) && (/\.(ts|tsx|json|js|mjs|c|h|yaml|yml|patch)$/.test(path) || /\/(LICENSE|NOTICE)$/.test(path)) && !/\/(tests|test)\//.test(path)));
for (const path of tracked.filter(path => !path.includes('/') && (/^(package\.json|pnpm-|tsconfig|tsdown)/.test(path) || path === 'LICENSE'))) selected.add(path);
for (const file of JSON.parse(readFileSync(join(evidence, 'overlay-receipt.json'))).files) selected.add(file.path);
for (const path of ['host-build.config.mjs', 'host-build-typert.mjs']) selected.add(path);
const sourceFiles = [...selected].sort().map(path => {
  if (forbidden(path)) throw new Error('forbidden source path');
  const absolute = join(source, path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('noncanonical source file: ' + path);
  const bytes = readFileSync(absolute);
  return { path, sha256: hash(bytes), bytes: bytes.length };
});
const recipeFiles = ['cold-build.mjs', 'host-build.config.mjs', 'host-build-typert.mjs', 'source-identity.mjs'].map(path => { const bytes = readFileSync(join(evidence, path)); return { path, sha256: hash(bytes), bytes: bytes.length }; });
const identity = {
  publicBaseCommit: '639ed015397290b3745d163aafe02ffee4aa3f84',
  publicBaseTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: source }).toString().trim(),
  sourceMaterialCommit: '616b511b4358dd7c173601816fc1f79f92f2a010',
  supplementCommit: '616b511b4358dd7c173601816fc1f79f92f2a010',
  declaredLocalHead: '3fbedc25d3626caf4e401b14c31a7f0326a19ec7',
  sourceMode: 'public-base-plus-verified-overlay',
  declaredLocalHeadIsBuiltIdentity: false,
  buildQualification: 'macOS arm64 cold source build; no retained runtime, Home, cache, or credentials copied',
  localPatchRights: 'UNKNOWN',
  runtimeExcludedDevelopmentConsumer: {name:'@deepseek-ai/dsh-sdk-client', reason:'The unchanged SDK subprocess client depends on the complete dsh CLI. It is cold-built for the supplied protected specs; the distribution obtains CLI/SDK packages from the independently locked official launcher closure.'},
  recipeFiles,
  dependencyLockSha256: hash(readFileSync(join(source, 'pnpm-lock.yaml'))),
  bootstrapLockSha256: hash(readFileSync(join(source, '.tools/bootstrap/package-lock.json'))),
  sourceFiles,
};
writeFileSync(join(evidence, 'source-identity.json'), JSON.stringify(identity, null, 2) + '\n');
const roots = JSON.parse(readFileSync(join(evidence, 'historical-packages-projection.json'))).map(row => row.name);
writeFileSync(join(evidence, 'roots-75.json'), JSON.stringify(roots, null, 2) + '\n');
writeFileSync(join(evidence, 'roots-runtime.json'), JSON.stringify(roots.filter(name => name !== '@deepseek-ai/dsh-sdk-client'), null, 2) + '\n');
console.log(JSON.stringify({ sourceFileCount: sourceFiles.length, sourceFileIndexSha256: hash(JSON.stringify(sourceFiles)), sourceIdentitySha256: hash(JSON.stringify(identity, null, 2) + '\n'), sourceMode: identity.sourceMode }));
