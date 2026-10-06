import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mod = await import('./export.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const api = name => { assert.equal(typeof mod[name], 'function', `Missing implementation: ${name}`); return mod[name]; };
const hash = value => createHash('sha256').update(value).digest('hex');
const integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
async function fixture(t) {
  const tmp = await fs.mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'runtime-export-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const root = join(tmp, 'source'); await fs.mkdir(root);
  const lock = { importers: {}, packages: { 'external@1.0.0': { resolution: { integrity } } }, snapshots: { 'external@1.0.0': {} } };
  async function pkg(name, folder, extra = {}) {
    const dir = join(root, folder); await fs.mkdir(join(dir, 'lib'), { recursive: true });
    await fs.writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, type: 'module', main: 'lib/index.js', files: ['lib/'], ...extra }) + '\n');
    await fs.writeFile(join(dir, 'lib/index.js'), `export const name = ${JSON.stringify(name)};\n`);
    lock.importers[folder] = {}; return dir;
  }
  const a = await pkg('@fixture/a', 'packages/a', { dependencies: { '@fixture/b': 'workspace:*' }, devDependencies: { '@fixture/unused': 'workspace:*' } });
  const b = await pkg('@fixture/b', 'packages/b', { dependencies: { external: '1.0.0' } });
  await pkg('@fixture/unused', 'packages/unused');
  lock.importers['packages/a'].dependencies = { '@fixture/b': { specifier: 'workspace:*', version: 'link:../b' } };
  lock.importers['packages/a'].devDependencies = { '@fixture/unused': { specifier: 'workspace:*', version: 'link:../unused' } };
  lock.importers['packages/b'].dependencies = { external: { specifier: '1.0.0', version: '1.0.0' } };
  await fs.writeFile(join(root, 'fixture-source.txt'), 'synthetic source fixture\n');
  const identity = { publicBaseCommit: 'a'.repeat(40), sourceMaterialCommit: 'b'.repeat(40), supplementCommit: 'c'.repeat(40), declaredLocalHead: 'd'.repeat(40), sourceMode: 'public-base-plus-verified-overlay', localPatchRights: 'UNKNOWN', sourceFiles: [{ path: 'fixture-source.txt', sha256: hash('synthetic source fixture\n'), bytes: 25 }] };
  return { tmp, root, a, b, lock, identity, pkg, options: { sourceRoot: root, lock, roots: ['@fixture/a'], identity, platform: 'linux', arch: 'x64' } };
}
test('closure follows declared production edges and excludes unrelated/dev packages', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options);
  assert.deepEqual(p.packages.map(x => x.name), ['@fixture/a', '@fixture/b']);
  assert.equal(p.externalPackages.length, 1); assert.deepEqual(p.issues, []);
});
test('missing required workspace edge yields a precise RED plan', async t => {
  const f = await fixture(t); delete f.lock.importers['packages/b'];
  const p = await api('planRuntime')(f.options);
  assert.ok(p.issues.some(x => x.code === 'UNRESOLVED_REQUIRED_DEPENDENCY' && x.dependency === '@fixture/b'));
});
test('manifest and lock specifier mismatch cannot silently pick another resolution', async t => {
  const f = await fixture(t); f.lock.importers['packages/a'].dependencies['@fixture/b'].specifier = 'workspace:~';
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'LOCK_SPECIFIER_MISMATCH'));
});
test('workspace link escape is rejected', async t => {
  const f = await fixture(t); f.lock.importers['packages/a'].dependencies['@fixture/b'].version = 'link:../../../outside';
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'WORKSPACE_LINK_MISMATCH'));
});
test('external dependency without registry integrity keeps export RED', async t => {
  const f = await fixture(t); delete f.lock.packages['external@1.0.0'].resolution.integrity;
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'EXTERNAL_INTEGRITY_REQUIRED'));
});
test('foreign snapshot transitive dependency missing from lock is reported', async t => {
  const f = await fixture(t); f.lock.snapshots['external@1.0.0'].dependencies = { absent: '2.0.0' };
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'EXTERNAL_LOCK_ENTRY_REQUIRED' && x.dependency === 'absent'));
});
test('explicitly declared missing payload file blocks export', async t => {
  const f = await fixture(t); const q = JSON.parse(await fs.readFile(join(f.a, 'package.json'))); q.files.push('missing.bin'); await fs.writeFile(join(f.a, 'package.json'), JSON.stringify(q));
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'DECLARED_FILE_MISSING' && x.path === 'missing.bin'));
});
test('payload symlink is refused before export', async t => {
  const f = await fixture(t); await fs.symlink('/etc/hostname', join(f.a, 'lib/leak.js'));
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'PAYLOAD_SYMLINK_REFUSED'));
});
test('source identity mismatch is RED and writes no output', async t => {
  const f = await fixture(t); f.identity.sourceFiles[0].sha256 = '0'.repeat(64);
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'SOURCE_IDENTITY_MISMATCH'));
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'output') }), { code: 'EXPORT_PLAN_RED' });
  await assert.rejects(fs.access(join(f.tmp, 'output')), { code: 'ENOENT' });
});
test('output within an input tree is refused without mutation', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options);
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: join(f.root, 'output') }), { code: 'EXCLUSIVE_OUTPUT_REQUIRED' });
  await assert.rejects(fs.access(join(f.root, 'output')), { code: 'ENOENT' });
});
test('symlinked output parent is refused', async t => {
  const f = await fixture(t); await fs.symlink(f.tmp, join(f.tmp, 'alias')); const p = await api('planRuntime')(f.options);
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'alias/output') }), { code: 'CANONICAL_OUTPUT_PARENT_REQUIRED' });
});
test('exports only selected regular files and preserves executable bytes and private metadata', async t => {
  const f = await fixture(t); await fs.writeFile(join(f.a, 'excluded.txt'), 'never copied'); await fs.chmod(join(f.a, 'lib/index.js'), 0o755);
  const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); const result = await api('exportRuntime')({ plan: p, outputDirectory: out });
  assert.equal(result.manifest.corePackageCount, 2); assert.equal(result.manifest.externalDependenciesIncluded, false); assert.equal(result.manifest.format, 2); assert.equal(result.manifest.candidateCommit, undefined);
  const a = join(out, '.packages', '@fixture+a');
  assert.equal(await fs.readFile(join(a, 'lib/index.js'), 'utf8'), await fs.readFile(join(f.a, 'lib/index.js'), 'utf8'));
  assert.equal((await fs.stat(join(a, 'lib/index.js'))).mode & 0o777, 0o755);
  assert.equal(JSON.parse(await fs.readFile(join(a, 'package.json'))).private, true);
  await assert.rejects(fs.access(join(a, 'excluded.txt')), { code: 'ENOENT' });
  assert.equal((await api('verifyRuntime')({ directory: out })).verified, true);
});
test('two exports from fixed inputs have byte-identical manifest and file index', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options);
  const a = await api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'one') }); const b = await api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'two') });
  assert.deepEqual(a.manifest, b.manifest);
  assert.equal(await fs.readFile(join(f.tmp, 'one/artifact-manifest.json'), 'utf8'), await fs.readFile(join(f.tmp, 'two/artifact-manifest.json'), 'utf8'));
});
test('independent verifier rejects altered executable bytes', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  await fs.writeFile(join(out, '.packages/@fixture+a/lib/index.js'), 'tampered');
  await assert.rejects(() => api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_HASH_MISMATCH' });
});
test('independent verifier rejects unexpected payload files', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  await fs.writeFile(join(out, '.packages/@fixture+a/extra.js'), 'unlisted');
  await assert.rejects(() => api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_FILE_SET_MISMATCH' });
});
test('verifier sees forbidden node_modules and empty directories instead of hiding them', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  await fs.mkdir(join(out, '.packages/@fixture+a/node_modules/hidden'), { recursive: true });
  await fs.writeFile(join(out, '.packages/@fixture+a/node_modules/hidden/file.js'), 'extra');
  await assert.rejects(() => api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_FILE_SET_MISMATCH' });
});
test('verifier rejects an unlisted empty directory', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  await fs.mkdir(join(out, '.packages/@fixture+a/extra-empty'));
  await assert.rejects(() => api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_FILE_SET_MISMATCH' });
});
test('source identity refuses a symlinked ancestor', async t => {
  const f = await fixture(t); const outside = join(f.tmp, 'outside'); await fs.mkdir(outside); await fs.writeFile(join(outside, 'source.txt'), 'real outside bytes'); await fs.symlink(outside, join(f.root, 'alias'));
  f.identity.sourceFiles = [{ path: 'alias/source.txt', bytes: 18, sha256: hash('real outside bytes') }];
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'SOURCE_IDENTITY_MISMATCH'));
});
test('changed source identity after planning blocks all output writes', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); await fs.writeFile(join(f.root, 'fixture-source.txt'), 'changed');
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'out') }), { code: 'SOURCE_IDENTITY_CHANGED' });
  await assert.rejects(fs.access(join(f.tmp, 'out')), { code: 'ENOENT' });
});
test('export plan identity is frozen and detached from caller mutations', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); f.identity.publicBaseCommit = 'not-a-commit';
  assert.equal(p.identity.publicBaseCommit, 'a'.repeat(40));
  assert.throws(() => { p.identity.publicBaseCommit = 'not-a-commit'; }, TypeError);
});
test('required external peers must have an exact resolved dependency', async t => {
  const f = await fixture(t); f.lock.packages['external@1.0.0'].peerDependencies = { ghost: '^2.0.0' };
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'EXTERNAL_PEER_RESOLUTION_REQUIRED'));
});
test('manifest cannot detach package identities from the retained payload', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  const mp = join(out, 'artifact-manifest.json'); const m = JSON.parse(await fs.readFile(mp)); m.packages = []; m.corePackageCount = 0; await fs.writeFile(mp, JSON.stringify(m));
  await assert.rejects(() => api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_MANIFEST_INVALID' });
});
test('payload parent replaced by symlink after planning cannot escape input root', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); await fs.rename(join(f.a, 'lib'), join(f.tmp, 'escaped-lib')); await fs.symlink(join(f.tmp, 'escaped-lib'), join(f.a, 'lib'));
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'out') }), { code: 'INPUT_CHANGED_AFTER_PLAN' });
});
test('workspace peer version requirements cannot be ignored', async t => {
  const f = await fixture(t); const file = join(f.a, 'package.json'); const p = JSON.parse(await fs.readFile(file)); p.peerDependencies = { '@fixture/b': 'workspace:^9.0.0' }; await fs.writeFile(file, JSON.stringify(p));
  const result = await api('planRuntime')(f.options); assert.ok(result.issues.some(x => x.code === 'PEER_VERSION_NOT_VERIFIED'));
});
test('publish wildcard includes descendants of matching directories', async t => {
  const f = await fixture(t); await fs.mkdir(join(f.a, 'lib/sub')); await fs.writeFile(join(f.a, 'lib/sub/deep.js'), 'nested'); const file = join(f.a, 'package.json'); const m = JSON.parse(await fs.readFile(file)); m.files = ['lib/*']; await fs.writeFile(file, JSON.stringify(m));
  const p = await api('planRuntime')(f.options); assert.ok(p.packages[0].files.some(x => x.path === 'lib/sub/deep.js'));
});
test('exclusive output rejects an independently created destination directory', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await fs.mkdir(out); const before = (await fs.stat(out)).ino;
  await assert.rejects(() => api('exportRuntime')({ plan: p, outputDirectory: out }), { code: 'OUTPUT_ALREADY_EXISTS' }); assert.equal((await fs.stat(out)).ino, before);
});
test('CLI preflight uses source lock and writes a truthful report without an artifact', async t => {
  const f = await fixture(t); f.lock.lockfileVersion = '9.0'; const raw = JSON.stringify(f.lock); await fs.writeFile(join(f.root, 'pnpm-lock.yaml'), raw);
  f.identity.sourceFiles.push({ path: 'pnpm-lock.yaml', bytes: Buffer.byteLength(raw), sha256: hash(raw) });
  const identity = join(f.tmp, 'identity.json'), roots = join(f.tmp, 'roots.json'), report = join(f.tmp, 'report.json'); await fs.writeFile(identity, JSON.stringify(f.identity)); await fs.writeFile(roots, JSON.stringify(['@fixture/a']));
  const p = spawnSync(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), '--source', f.root, '--identity', identity, '--roots', roots, '--report', report], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr); const result = JSON.parse(await fs.readFile(report)); assert.equal(result.corePackageCount, 2); assert.equal(result.exported, false); assert.equal(result.legacyConsumerCompatibility.status, 'RED');
});
test('unchanged fixed release assembler rejects the new manifest format before output writes', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const candidate = join(f.tmp, 'candidate'); await api('exportRuntime')({ plan: p, outputDirectory: candidate });
  const official = join(f.tmp, 'official'); await fs.mkdir(join(official, 'node_modules/@deepseek-ai/dsh'), { recursive: true }); await fs.writeFile(join(official, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }));
  const { assembleOwnerRuntime } = await import('./contracts/scripts__assemble-owner-runtime.mjs');
  const output = join(f.tmp, 'assembled'); await assert.rejects(() => assembleOwnerRuntime({ officialRoot: official, candidateRoot: candidate, outputDirectory: output, productRoot: f.root }), /FIXED_ARTIFACT_IDENTITY_REQUIRED/);
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});
test('a pinned workspace override is accepted only when both lock and link target agree', async t => {
  const f = await fixture(t); f.lock.overrides = { '@fixture/b': 'link:packages/b' }; f.lock.importers['packages/a'].dependencies['@fixture/b'].specifier = 'link:../b';
  const p = await api('planRuntime')(f.options); assert.deepEqual(p.issues, []);
});
test('native publication manifest cannot reference an absent binary', async t => {
  const f = await fixture(t); const meta = JSON.parse(await fs.readFile(join(f.b, 'package.json'))); meta.files.push('prebuilds.json', 'bin/'); await fs.writeFile(join(f.b, 'package.json'), JSON.stringify(meta));
  await fs.mkdir(join(f.b, 'bin')); await fs.writeFile(join(f.b, 'bin/present'), 'real bytes'); await fs.writeFile(join(f.b, 'prebuilds.json'), JSON.stringify({ binaries: [{ path: 'bin/absent' }] }));
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'NATIVE_BINARY_MISSING' && x.path === 'bin/absent'));
});

test('duplicate source identity paths cannot inflate verified input count', async t => {
  const f = await fixture(t); f.identity.sourceFiles.push({...f.identity.sourceFiles[0]});
  const p = await api('planRuntime')(f.options);
  assert.ok(p.issues.some(x => x.code === 'SOURCE_IDENTITY_DUPLICATE'));
});
test('resolved external required peer must satisfy a supported locked version range', async t => {
  const f = await fixture(t);
  f.lock.packages['external@1.0.0'].peerDependencies = { ghost: '^2.0.0' };
  f.lock.snapshots['external@1.0.0'].dependencies = { ghost: '1.0.0' };
  f.lock.packages['ghost@1.0.0'] = {resolution:{integrity}};f.lock.snapshots['ghost@1.0.0'] = {};
  const p = await api('planRuntime')(f.options);
  assert.ok(p.issues.some(x => x.code === 'EXTERNAL_PEER_VERSION_NOT_VERIFIED'));
});
test('caller-pinned manifest hash rejects a rewritten internally valid manifest', async t => {
  const f=await fixture(t); const p=await api('planRuntime')(f.options);const out=join(f.tmp,'out');await api('exportRuntime')({plan:p,outputDirectory:out});
  const file=join(out,'artifact-manifest.json');const bytes=await fs.readFile(file);const trusted=hash(bytes);
  assert.equal((await api('verifyRuntime')({directory:out,expectedManifestSha256:trusted})).trustedManifestPinChecked,true);
  const manifest=JSON.parse(bytes);manifest.sourceIdentity.publicBaseCommit='e'.repeat(40);await fs.writeFile(file,JSON.stringify(manifest,null,2)+'\n');
  await assert.rejects(api('verifyRuntime')({directory:out,expectedManifestSha256:trusted}),{code:'ARTIFACT_MANIFEST_HASH_MISMATCH'});
});

test('R1 workspace required external peer rejects incompatible exact importer resolution', async t => {
  for (const section of ['peerDependencies', 'dependencies', 'devDependencies']) {
    const f = await fixture(t); const path = join(f.a, 'package.json'); const pkg = JSON.parse(await fs.readFile(path));
    pkg.peerDependencies = { external: '^2.0.0' }; await fs.writeFile(path, JSON.stringify(pkg));
    f.lock.importers['packages/a'][section] = { ...(f.lock.importers['packages/a'][section] ?? {}), external: { specifier: '^2.0.0', version: '1.0.0' } };
    const p = await api('planRuntime')(f.options);
    assert.ok(p.issues.some(x => x.code === 'EXTERNAL_PEER_VERSION_NOT_VERIFIED' && x.package === '@fixture/a' && x.dependency === 'external'), section);
    await assert.rejects(api('exportRuntime')({ plan: p, outputDirectory: join(f.tmp, 'out') }), { code: 'EXPORT_PLAN_RED' });
    await assert.rejects(fs.access(join(f.tmp, 'out')), { code: 'ENOENT' });
  }
});
test('R1 unsupported workspace external peer range stays RED', async t => {
  const f = await fixture(t); const path = join(f.a, 'package.json'); const pkg = JSON.parse(await fs.readFile(path));
  pkg.peerDependencies = { external: '^1.0.0 || ^2.0.0' }; await fs.writeFile(path, JSON.stringify(pkg));
  f.lock.importers['packages/a'].devDependencies.external = { specifier: '^1.0.0 || ^2.0.0', version: '1.0.0' };
  const p = await api('planRuntime')(f.options); assert.ok(p.issues.some(x => x.code === 'EXTERNAL_PEER_VERSION_NOT_VERIFIED'));
});
test('R1 verifier rejects internally incompatible workspace external peer metadata', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  const path = '.packages/@fixture+a/package.json'; const pkg = JSON.parse(await fs.readFile(join(out, path))); pkg.peerDependencies = { external: '^2.0.0' };
  const bytes = Buffer.from(JSON.stringify(pkg)); await fs.writeFile(join(out, path), bytes);
  const mp = join(out, 'artifact-manifest.json'); const manifest = JSON.parse(await fs.readFile(mp)); const file = manifest.files.find(x => x.path === path); file.bytes = bytes.length; file.sha256 = hash(bytes); manifest.packages.find(x => x.name === pkg.name).packageJsonSha256 = hash(bytes); await fs.writeFile(mp, JSON.stringify(manifest));
  await assert.rejects(api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_PEER_VERSION_NOT_VERIFIED' });
});

test('R2 verifier rejects a manifest and disk that omit the declared main', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  const mp = join(out, 'artifact-manifest.json'); const original = await fs.readFile(mp); const m = JSON.parse(original);
  m.files = m.files.filter(x => x.path !== '.packages/@fixture+a/lib/index.js'); await fs.rm(join(out, '.packages/@fixture+a/lib'), { recursive: true }); await fs.writeFile(mp, JSON.stringify(m));
  await assert.rejects(api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_RUNTIME_ENTRY_MISSING' });
});
test('R2 declared main cannot escape its owning package', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  const path = '.packages/@fixture+a/package.json'; const pkg = JSON.parse(await fs.readFile(join(out, path))); pkg.main = '../@fixture+b/lib/index.js'; const bytes = Buffer.from(JSON.stringify(pkg)); await fs.writeFile(join(out, path), bytes);
  const mp = join(out, 'artifact-manifest.json'); const m = JSON.parse(await fs.readFile(mp)); const file = m.files.find(x => x.path === path); file.bytes = bytes.length; file.sha256 = hash(bytes); m.packages.find(x => x.name === pkg.name).packageJsonSha256 = hash(bytes); await fs.writeFile(mp, JSON.stringify(m));
  await assert.rejects(api('verifyRuntime')({ directory: out }), { code: 'ARTIFACT_RUNTIME_ENTRY_MISSING' });
});
test('R2 trusted original manifest pin rejects the reduced missing-main manifest first', async t => {
  const f = await fixture(t); const p = await api('planRuntime')(f.options); const out = join(f.tmp, 'out'); await api('exportRuntime')({ plan: p, outputDirectory: out });
  const mp = join(out, 'artifact-manifest.json'); const original = await fs.readFile(mp); const m = JSON.parse(original); m.files = m.files.filter(x => x.path !== '.packages/@fixture+a/lib/index.js'); await fs.rm(join(out, '.packages/@fixture+a/lib'), { recursive: true }); await fs.writeFile(mp, JSON.stringify(m));
  await assert.rejects(api('verifyRuntime')({ directory: out, expectedManifestSha256: hash(original) }), { code: 'ARTIFACT_MANIFEST_HASH_MISMATCH' });
});

async function cliFixture(t) {
  const f = await fixture(t); f.lock.lockfileVersion = '9.0'; const raw = JSON.stringify(f.lock); await fs.writeFile(join(f.root, 'pnpm-lock.yaml'), raw);
  f.identity.sourceFiles.push({ path: 'pnpm-lock.yaml', bytes: Buffer.byteLength(raw), sha256: hash(raw) });
  const id = join(f.tmp, 'identity.json'), roots = join(f.tmp, 'roots.json'); await fs.writeFile(id, JSON.stringify(f.identity)); await fs.writeFile(roots, JSON.stringify(['@fixture/a']));
  return { ...f, report: join(f.tmp, 'report.json'), out: join(f.tmp, 'out'), args: ['--source', f.root, '--identity', id, '--roots', roots] };
}
const cliEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: '/tmp' };
function cliArgs(f, imports = []) {
  return ['--import', fileURLToPath(new URL('./offline-guard.mjs', import.meta.url)), ...imports.flatMap(p => ['--import', p]), fileURLToPath(new URL('./cli.mjs', import.meta.url)), ...f.args, '--report', f.report, '--output', f.out];
}
function runCli(f, imports = []) { return spawnSync(process.execPath, cliArgs(f, imports), { encoding: 'utf8', env: cliEnv }); }
async function reportFailurePreload(f, replacement = false) {
  const path = join(f.tmp, 'report-write-fault.mjs');
  await fs.writeFile(path, `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const target=${JSON.stringify(f.report)}, output=${JSON.stringify(f.out)}, replacement=${replacement};
const originalOpen=fs.open.bind(fs), originalWrite=fs.writeFile.bind(fs);
async function failWrite(){
 if(replacement){
  try{await fs.rename(target,target+'.owned');}catch(e){if(e.code!=='ENOENT')throw e;}
  await originalWrite(target,'caller replacement report',{flag:'wx'});
  await fs.rename(output,output+'.owned');await fs.mkdir(output);await originalWrite(output+'/caller.txt','caller replacement output',{flag:'wx'});
 }
 const error=new Error('SIMULATED_REPORT_WRITE_FAILURE');error.code='EIO';throw error;
}
fs.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===target)handle.writeFile=failWrite;return handle;};
fs.writeFile=async(path,...args)=>path===target?failWrite():originalWrite(path,...args);
syncBuiltinESMExports();
`);
  return path;
}
test('R3 existing report is preserved and blocks every artifact write', async t => {
  const f = await cliFixture(t); await fs.writeFile(f.report, 'caller original report'); const before = await fs.stat(f.report);
  const r = runCli(f); assert.equal(r.status, 1); assert.equal(await fs.readFile(f.report, 'utf8'), 'caller original report'); assert.equal((await fs.stat(f.report)).ino, before.ino);
  await assert.rejects(fs.access(f.out), { code: 'ENOENT' });
});
test('R3 existing report symlink and target bytes are preserved before artifact writes', async t => {
  const f = await cliFixture(t); const target = join(f.tmp, 'caller.txt'); await fs.writeFile(target, 'caller secret-free fixture'); await fs.symlink(target, f.report);
  const r = runCli(f); assert.equal(r.status, 1); assert.equal((await fs.lstat(f.report)).isSymbolicLink(), true); assert.equal(await fs.readFile(target, 'utf8'), 'caller secret-free fixture');
  await assert.rejects(fs.access(f.out), { code: 'ENOENT' });
});
test('R3 equal report and artifact path fails before creating either', async t => {
  const f = await cliFixture(t); f.report = f.out; const r = runCli(f); assert.equal(r.status, 1);
  await assert.rejects(fs.access(f.out), { code: 'ENOENT' });
});
test('R3 late report write failure removes only this invocation artifact and report', async t => {
  const f = await cliFixture(t); const preload = await reportFailurePreload(f); const r = runCli(f, [preload]); assert.equal(r.status, 1); assert.match(r.stderr, /EIO/);
  await assert.rejects(fs.access(f.out), { code: 'ENOENT' }); await assert.rejects(fs.access(f.report), { code: 'ENOENT' });
});
test('R3 existing caller output survives failure and newly claimed report is cleaned', async t => {
  const f = await cliFixture(t); await fs.mkdir(f.out); await fs.writeFile(join(f.out, 'caller.txt'), 'caller existing output'); const before = await fs.stat(f.out);
  const r = runCli(f); assert.equal(r.status, 1); assert.equal((await fs.stat(f.out)).ino, before.ino); assert.equal(await fs.readFile(join(f.out, 'caller.txt'), 'utf8'), 'caller existing output');
  await assert.rejects(fs.access(f.report), { code: 'ENOENT' });
});
test('R3 failure cleanup preserves caller replacements with different ownership', async t => {
  const f = await cliFixture(t); const preload = await reportFailurePreload(f, true); const r = runCli(f, [preload]); assert.equal(r.status, 1); assert.match(r.stderr, /EIO/);
  assert.equal(await fs.readFile(f.report, 'utf8'), 'caller replacement report'); assert.equal(await fs.readFile(join(f.out, 'caller.txt'), 'utf8'), 'caller replacement output');
});
test('R3 successful CLI publishes complete report and artifact with matching trusted digest', async t => {
  const f = await cliFixture(t); const r = runCli(f); assert.equal(r.status, 0, r.stderr); const report = JSON.parse(await fs.readFile(f.report)); const stdout = JSON.parse(r.stdout);
  assert.equal(report.exported, true); assert.equal(report.artifactManifestSha256, stdout.artifactManifestSha256);
  const v = await api('verifyRuntime')({ directory: f.out, expectedManifestSha256: report.artifactManifestSha256 }); assert.equal(v.verified, true); assert.equal(v.trustedManifestPinChecked, true);
});
test('R3 concurrent CLI report claims preserve exactly one successful complete result', async t => {
  const f = await cliFixture(t);
  const launch = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, cliArgs(f), { env: cliEnv }); let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); });
  const results = await Promise.all([launch(), launch()]); assert.deepEqual(results.map(x => x.status).sort(), [0, 1]);
  const report = JSON.parse(await fs.readFile(f.report)); assert.equal(report.exported, true); assert.equal((await api('verifyRuntime')({ directory: f.out, expectedManifestSha256: report.artifactManifestSha256 })).verified, true);
});

test('R3 artifact cleanup failure still cleans the independently owned report', async t => {
  const f = await cliFixture(t); const writeFault = await reportFailurePreload(f); const cleanupFault = join(f.tmp, 'cleanup-fault.mjs');
  await fs.writeFile(cleanupFault, `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const target=${JSON.stringify(f.out)}, original=fs.rm.bind(fs);fs.rm=async(path,...args)=>{if(path===target){const error=new Error('SIMULATED_CLEANUP_PERMISSION_FAILURE');error.code='EACCES';throw error;}return original(path,...args);};syncBuiltinESMExports();\n`);
  const r = runCli(f, [writeFault, cleanupFault]); assert.equal(r.status, 1); assert.match(r.stderr, /"errorCategory":"EIO"/); assert.match(r.stderr, /"cleanupErrorCategory":"EACCES"/);
  assert.equal((await fs.stat(f.out)).isDirectory(), true); await assert.rejects(fs.access(f.report), { code: 'ENOENT' });
});

async function ownershipFaultPreload(f, mode) {
  const path = join(f.tmp, 'ownership-fault.mjs');
  await fs.writeFile(path, `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const report=${JSON.stringify(f.report)},output=${JSON.stringify(f.out)},mode=${JSON.stringify(mode)};
const open=fs.open.bind(fs),stat=fs.stat.bind(fs),lstat=fs.lstat.bind(fs);const fail=code=>{throw Object.assign(new Error('SIMULATED_OWNERSHIP_FAILURE'),{code});};
fs.open=async(...args)=>{const h=await open(...args);if(mode==='report-stat'&&args[0]===report)h.stat=async()=>fail('EIO');return h;};
fs.stat=async(path,...args)=>mode==='output-stat'&&path===output?fail('EIO'):stat(path,...args);
fs.lstat=async(path,...args)=>(mode==='lstat-output'&&path===output)||(mode==='lstat-report'&&path===report)?fail('EACCES'):lstat(path,...args);syncBuiltinESMExports();\n`);
  return path;
}
test('R3 cleanup output inspection failure is explicit and report cleanup still runs', async t => {
  const f = await cliFixture(t); const write = await reportFailurePreload(f); const lookup = await ownershipFaultPreload(f, 'lstat-output'); const r = runCli(f, [write, lookup]);
  assert.equal(r.status, 1); assert.match(r.stderr, /"cleanupErrorCategory":"EACCES"/); assert.equal((await fs.stat(f.out)).isDirectory(), true); await assert.rejects(fs.access(f.report), { code: 'ENOENT' });
});
test('R3 cleanup report inspection failure is explicit and preserves unknown ownership', async t => {
  const f = await cliFixture(t); const write = await reportFailurePreload(f); const lookup = await ownershipFaultPreload(f, 'lstat-report'); const r = runCli(f, [write, lookup]);
  assert.equal(r.status, 1); assert.match(r.stderr, /"cleanupErrorCategory":"EACCES"/); assert.equal((await fs.stat(f.report)).isFile(), true); await assert.rejects(fs.access(f.out), { code: 'ENOENT' });
});
test('R3 report claim identity failure explicitly reports blocked cleanup without blind deletion', async t => {
  const f = await cliFixture(t); const fault = await ownershipFaultPreload(f, 'report-stat'); const r = runCli(f, [fault]);
  assert.equal(r.status, 1); assert.match(r.stderr, /"errorCategory":"EIO"/); assert.match(r.stderr, /"cleanupErrorCategory":"REPORT_OWNERSHIP_UNAVAILABLE"/);
  assert.equal((await fs.stat(f.report)).isFile(), true); await assert.rejects(fs.access(f.out), { code: 'ENOENT' });
});
test('R3 artifact claim identity failure explicitly reports blocked cleanup without blind deletion', async t => {
  const f = await cliFixture(t); const fault = await ownershipFaultPreload(f, 'output-stat'); const r = runCli(f, [fault]);
  assert.equal(r.status, 1); assert.match(r.stderr, /"errorCategory":"EIO"/); assert.match(r.stderr, /"cleanupErrorCategory":"ARTIFACT_OWNERSHIP_UNAVAILABLE"/);
  assert.equal((await fs.stat(f.out)).isDirectory(), true); await assert.rejects(fs.access(join(f.out, 'artifact-manifest.json')), { code: 'ENOENT' }); await assert.rejects(fs.access(f.report), { code: 'ENOENT' });
});
