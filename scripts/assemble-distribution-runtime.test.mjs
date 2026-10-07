import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import mutableFs from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { planRuntime, exportRuntime } from '../tools/runtime-export/export.mjs';

const module = await import('./assemble-distribution-runtime.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const sha = value => createHash('sha256').update(value).digest('hex');
const sri = value => 'sha512-' + createHash('sha512').update(value).digest('base64');
const write = async (path, value, mode = 0o644) => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, value, { mode });
  await fs.chmod(path, mode);
};
const json = async (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
// Instrument real owned-file reads, including descriptor reads. No fake bytes or
// simulated assembly result is returned: the callback may mutate a fixture after
// its actual first read, reproducing the reviewed metadata snapshot race.
function observeReads(t, afterRead) {
  const paths = [], readFile = mutableFs.readFile, open = mutableFs.open;
  const observed = async (path, bytes) => { paths.push(String(path)); await afterRead?.(String(path), bytes); return bytes; };
  t.mock.method(mutableFs, 'readFile', async (path, ...args) => observed(path, await readFile(path, ...args)));
  t.mock.method(mutableFs, 'open', async (path, ...args) => {
    const handle = await open(path, ...args), read = handle.readFile.bind(handle);
    handle.readFile = async (...values) => observed(path, await read(...values));
    return handle;
  });
  syncBuiltinESMExports();
  const restore = () => { t.mock.restoreAll(); syncBuiltinESMExports(); };
  t.after(restore);
  return { paths, restore };
}
const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
function archive(files) {
  const blocks = [];
  for (const [path, value] of Object.entries(files)) {
    const bytes = Buffer.from(value), header = Buffer.alloc(512);
    header.write(path); header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(bytes.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257);
    header.write(octal(header.reduce((sum, n) => sum + n, 0), 7) + ' ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
async function fixture(t, { unsafeTarPath, skippedOptionalWorkspace, invalidGzip } = {}) {
  const parent = process.env.DSH_BOT_TEST_ROOT || '/workspace/dsh-v1-evidence/distribution-consumer';
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(join(parent, 'assembly-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const officialRoot = join(root, 'official'), sourceRoot = join(root, 'source'), overlayDirectory = join(root, 'overlay');
  const registryDirectory = join(root, 'registry'), productRoot = join(root, 'product');
  for (const path of [officialRoot, sourceRoot, registryDirectory, productRoot]) await fs.mkdir(path);
  const external = [];
  for (const version of ['1.0.0', '2.0.0']) {
    const name = 'color-fixture', meta = { name, version, main: 'index.js', scripts: { install: 'touch lifecycle-was-run' } };
    const bytes = invalidGzip ? Buffer.from('PRIVXYZ') : archive({ 'package/package.json': JSON.stringify(meta), 'package/index.js': `module.exports = '${version}';\n`, 'package/LICENSE': 'Fixture MIT notice\n', ...(unsafeTarPath ? { [unsafeTarPath]: 'untrusted archive path' } : {}) });
    const integrity = sri(bytes), file = name + '@' + version;
    const metadata = { ...meta, dist: { integrity, tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` } };
    await write(join(registryDirectory, file + '.tgz'), bytes);
    await json(join(registryDirectory, file + '.metadata.json'), metadata);
    external.push({ name, version, integrity, actualIntegrity: integrity, tarballPath: 'registry/' + file + '.tgz', metadataPath: 'registry/' + file + '.metadata.json', bytes: bytes.length, tarballSha256: sha(bytes), metadataSha256: sha(await fs.readFile(join(registryDirectory, file + '.metadata.json'))) });
  }
  const packages = [
    { name: '@deepseek-ai/cordis', version: '4.0.4', sourcePath: 'vendor/cordis', dependencies: { 'color-fixture': '^1.0.0' }, code: "module.exports = require('color-fixture');\n" },
    { name: '@deepseek-ai/dsh-agent', version: '0.2.0-rc.2', sourcePath: 'packages/agent', dependencies: { '@deepseek-ai/cordis': 'workspace:*', 'color-fixture': '^2.0.0' }, code: "module.exports = [require('@deepseek-ai/cordis'),require('color-fixture')];\n" },
  ];
  const lock = { importers: {}, packages: {}, snapshots: {} }, sourceFiles = [];
  for (const item of packages) {
    const meta = { name: item.name, version: item.version, main: 'lib/index.js', files: ['lib'], dependencies: item.dependencies, ...(skippedOptionalWorkspace ? { optionalDependencies: { '@deepseek-ai/platform-unavailable': 'workspace:*' } } : {}) };
    await json(join(sourceRoot, item.sourcePath, 'package.json'), meta);
    await write(join(sourceRoot, item.sourcePath, 'lib/index.js'), item.code, 0o755);
    lock.importers[item.sourcePath] = { dependencies: {} };
    for (const [name, specifier] of Object.entries(item.dependencies)) {
      const version = name.startsWith('@') ? 'link:../../vendor/cordis' : item.name.endsWith('cordis') ? '1.0.0' : '2.0.0';
      lock.importers[item.sourcePath].dependencies[name] = { specifier, version };
    }
    for (const file of ['package.json', 'lib/index.js']) {
      const path = item.sourcePath + '/' + file, bytes = await fs.readFile(join(sourceRoot, path));
      sourceFiles.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  for (const item of external) { lock.packages[item.name + '@' + item.version] = { resolution: { integrity: item.integrity } }; lock.snapshots[item.name + '@' + item.version] = {}; }
  if (skippedOptionalWorkspace) {
    const path = 'packages/platform/package.json';
    await json(join(sourceRoot, path), { name: '@deepseek-ai/platform-unavailable', version: '1.0.0', files: ['lib'], os: [process.platform === 'linux' ? 'darwin' : 'linux'] });
    lock.importers['packages/platform'] = {};
    const bytes = await fs.readFile(join(sourceRoot, path)); sourceFiles.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  }
  const sourceLockPath = join(sourceRoot, 'lock.json'); await json(sourceLockPath, lock);
  const identity = { publicBaseCommit: 'a'.repeat(40), sourceMaterialCommit: 'b'.repeat(40), supplementCommit: 'c'.repeat(40), declaredLocalHead: 'd'.repeat(40), sourceMode: 'public-base-plus-verified-overlay', declaredLocalHeadIsBuiltIdentity: false, localPatchRights: 'UNKNOWN', dependencyLockSha256: sha(await fs.readFile(sourceLockPath)), sourceFiles };
  const sourceIdentityPath = join(root, 'identity.json'); await json(sourceIdentityPath, identity);
  const plan = await planRuntime({ sourceRoot, lock, roots: packages.map(x => x.name), identity });
  assert.deepEqual(plan.issues, []); await exportRuntime({ plan, outputDirectory: overlayDirectory });
  const officialPackages = [
    { name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', bin: { dsh: 'lib/bin.js' }, dependencies: { '@deepseek-ai/dsh-agent': '0.2.0-rc.2', 'color-fixture': '^9.0.0' }, files: { 'lib/bin.js': '#!/usr/bin/env node\nconsole.log("fixture launcher");\n' } },
    { name: '@deepseek-ai/dsh-agent', version: '0.2.0-rc.2', main: 'index.js', files: { 'index.js': 'module.exports="old";' } },
    { name: '@deepseek-ai/cordis', version: '4.0.4', main: 'index.js', files: { 'index.js': 'module.exports="old";' } },
    { name: 'color-fixture', version: '9.0.0', main: 'index.js', files: { 'index.js': 'module.exports="9.0.0";' } },
  ];
  const publicLock = { lockfileVersion: 3, packages: { '': { devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' } } } };
  for (const { files, ...meta } of officialPackages) {
    const path = 'node_modules/' + meta.name;
    await json(join(officialRoot, path, 'package.json'), meta);
    for (const [name, bytes] of Object.entries(files)) await write(join(officialRoot, path, name), bytes, 0o755);
    publicLock.packages[path] = { version: meta.version, resolved: `https://registry.npmjs.org/${meta.name}/-/${meta.name.split('/').at(-1)}-${meta.version}.tgz`, integrity: sri(Buffer.from(meta.name)), dependencies: meta.dependencies, bin: meta.bin };
  }
  const officialLockPath = join(officialRoot, 'package-lock.json'); await json(officialLockPath, publicLock);
  await json(join(productRoot, 'package.json'), { name: 'dsh-bot', version: '0.1.0-alpha.1', type: 'module', files: ['src', 'cordis.patch.yml', 'README.md'], peerDependencies: { '@deepseek-ai/cordis': '4.0.4' } });
  await write(join(productRoot, 'src/client/index.js'), 'export const fixture = true;\n');
  await write(join(productRoot, 'src/server.mjs'), 'export const fixture = true;\n');
  await write(join(productRoot, 'cordis.patch.yml'), 'name: dsh-bot\n'); await write(join(productRoot, 'README.md'), 'fixture product\n');
  await write(join(officialRoot, 'Home/config.yml'), 'MUST NOT COPY'); await write(join(productRoot, '.env'), 'MUST NOT COPY');
  const publicLicensePath = join(sourceRoot, 'LICENSE'), nativeLicensePath = join(sourceRoot, 'native/system/LICENSE');
  await write(publicLicensePath, 'MIT License\nCopyright fixture\n'); await write(nativeLicensePath, 'BSD 3-Clause License\nCopyright fixture\n');
  const muslCopyrightPath = join(sourceRoot, 'licenses/musl.COPYRIGHT.txt'), muslSourceNoticesPath = join(sourceRoot, 'licenses/musl.source-notices.txt');
  await write(muslCopyrightPath, 'musl fixture public COPYRIGHT\nMIT License\nCopyright libc contributors\n');
  await write(muslSourceNoticesPath, 'Additional fixture public musl source notices.\nBSD permission text\n');
  const registryReceiptsPath = join(root, 'receipts.json'); await json(registryReceiptsPath, { receipts: external, scriptsExecuted: false });
  const options = { officialRoot, officialLockPath, expectedOfficialLockSha256: sha(await fs.readFile(officialLockPath)), overlayDirectory, expectedManifestSha256: sha(await fs.readFile(join(overlayDirectory, 'artifact-manifest.json'))), sourceIdentityPath, expectedSourceIdentitySha256: sha(await fs.readFile(sourceIdentityPath)), sourceLockPath, registryDirectory, registryReceiptsPath, productRoot, outputDirectory: join(root, 'runtime'), publicLicensePath, expectedPublicLicenseSha256: sha(await fs.readFile(publicLicensePath)), nativeLicensePath, expectedNativeLicenseSha256: sha(await fs.readFile(nativeLicensePath)), muslCopyrightPath, expectedMuslCopyrightSha256: sha(await fs.readFile(muslCopyrightPath)), muslSourceNoticesPath, expectedMuslSourceNoticesSha256: sha(await fs.readFile(muslSourceNoticesPath)) };
  return { root, options, external };
}
function cliArguments(options) {
  const flags = {
    '--official': 'officialRoot', '--official-lock': 'officialLockPath', '--official-lock-sha256': 'expectedOfficialLockSha256', '--overlay': 'overlayDirectory', '--manifest-sha256': 'expectedManifestSha256', '--source-identity': 'sourceIdentityPath', '--source-identity-sha256': 'expectedSourceIdentitySha256', '--source-lock': 'sourceLockPath', '--registry': 'registryDirectory', '--receipts': 'registryReceiptsPath', '--product': 'productRoot', '--output': 'outputDirectory', '--public-license': 'publicLicensePath', '--public-license-sha256': 'expectedPublicLicenseSha256', '--native-license': 'nativeLicensePath', '--native-license-sha256': 'expectedNativeLicenseSha256', '--musl-copyright': 'muslCopyrightPath', '--musl-copyright-sha256': 'expectedMuslCopyrightSha256', '--musl-source-notices': 'muslSourceNoticesPath', '--musl-source-notices-sha256': 'expectedMuslSourceNoticesSha256',
  };
  return [resolve(import.meta.dirname, 'assemble-distribution-runtime.mjs'), ...Object.entries(flags).flatMap(([flag, key]) => [flag, options[key]])];
}

test('assembler exports a separate explicit format 2 consumer', () => {
  assert.equal(typeof module.assembleDistributionRuntime, 'function', 'format 2 offline consumer is missing');
  assert.equal(typeof module.verifyDistributionRuntime, 'function', 'assembled receipt verification is missing');
});

test('offline assembly preserves exact core payload, distinct external bindings and official graph', async t => {
  const { options } = await fixture(t);
  const result = await module.assembleDistributionRuntime(options);
  const require = createRequire(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
  assert.deepEqual(require('@deepseek-ai/dsh-agent'), ['1.0.0', '2.0.0']);
  assert.equal(require('color-fixture'), '9.0.0');
  const before = await fs.readFile(join(options.overlayDirectory, '.packages/@deepseek-ai+dsh-agent/lib/index.js'));
  const after = await fs.readFile(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh-agent/lib/index.js'));
  assert.deepEqual(after, before);
  assert.equal((await fs.stat(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh-agent/lib/index.js'))).mode & 0o777, 0o755);
  const pkg = JSON.parse(await fs.readFile(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh-agent/package.json')));
  assert.equal(pkg.dependencies['@deepseek-ai/cordis'], '4.0.4');
  assert.equal(result.manifest.metadataChanges.some(x => x.beforeSha256 !== x.afterSha256 && x.package === '@deepseek-ai/dsh-agent'), true);
  assert.equal(result.manifest.sourceIdentity.declaredLocalHeadIsBuiltIdentity, false);
  assert.equal(result.manifest.credentialsOrHomesCopied, false);
  assert.equal(result.manifest.lifecycleScriptsExecuted, false);
  assert.equal(result.manifest.publicReleaseQualified, false);
  assert.match(await fs.readFile(join(result.runtimeDirectory, 'NOTICES.txt'), 'utf8'), /MIT License[\s\S]*BSD 3-Clause License[\s\S]*UNKNOWN/);
  for (const path of ['Home', '.env', 'node_modules/lifecycle-was-run']) await assert.rejects(fs.lstat(join(result.runtimeDirectory, path)), { code: 'ENOENT' });
  assert.equal(await fs.readlink(result.dsh), '../@deepseek-ai/dsh/lib/bin.js');
  const verified = await module.verifyDistributionRuntime({ directory: result.runtimeDirectory, expectedManifestSha256: result.manifestSha256 });
  assert.equal(verified.verified, true);
  await fs.appendFile(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh-agent/lib/index.js'), 'tampered');
  await assert.rejects(module.verifyDistributionRuntime({ directory: result.runtimeDirectory, expectedManifestSha256: result.manifestSha256 }), { code: 'DISTRIBUTION_FILE_HASH_MISMATCH' });
});

test('untrusted overlay and extra payload fail before claiming output', async t => {
  const { options } = await fixture(t);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedManifestSha256: undefined }), { code: 'TRUSTED_DIGEST_REQUIRED' });
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedManifestSha256: '0'.repeat(64) }), { code: 'ARTIFACT_MANIFEST_HASH_MISMATCH' });
  await write(join(options.overlayDirectory, '.packages/@deepseek-ai+dsh-agent/lib/unlisted.js'), 'not inventoried');
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'ARTIFACT_FILE_SET_MISMATCH' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

test('external raw bytes must match manifest SRI and registry metadata SRI', async t => {
  const { options, external } = await fixture(t);
  const path = join(options.registryDirectory, external[0].name + '@' + external[0].version + '.tgz');
  await fs.appendFile(path, 'corrupt');
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'REGISTRY_TARBALL_INTEGRITY_MISMATCH' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

test('existing caller output is preserved and symlinked input paths are refused', async t => {
  const { root, options } = await fixture(t);
  await fs.mkdir(options.outputDirectory); await write(join(options.outputDirectory, 'caller.txt'), 'owned by caller');
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'OUTPUT_ALREADY_EXISTS' });
  assert.equal(await fs.readFile(join(options.outputDirectory, 'caller.txt'), 'utf8'), 'owned by caller');
  const alias = join(root, 'overlay-alias'); await fs.symlink(options.overlayDirectory, alias);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, overlayDirectory: alias, outputDirectory: join(root, 'runtime-2') }), { code: 'CANONICAL_INPUT_REQUIRED' });
});

test('source identity, source lock and platform must match the trusted overlay', async t => {
  const { options } = await fixture(t);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedSourceIdentitySha256: '0'.repeat(64) }), { code: 'SOURCE_IDENTITY_HASH_MISMATCH' });
  await fs.appendFile(options.sourceLockPath, ' ');
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'SOURCE_LOCK_HASH_MISMATCH' });
});

test('platform mismatch is rejected even with a caller-trusted manifest pin', async t => {
  const { options } = await fixture(t);
  const path = join(options.overlayDirectory, 'artifact-manifest.json'), manifest = JSON.parse(await fs.readFile(path));
  manifest.arch = process.arch === 'x64' ? 'arm64' : 'x64'; await json(path, manifest);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedManifestSha256: sha(await fs.readFile(path)) }), { code: 'OVERLAY_PLATFORM_ARCH_MISMATCH' });
});

test('registry metadata SRI cannot disagree with the trusted raw tarball integrity', async t => {
  const { options, external } = await fixture(t);
  const path = join(options.registryDirectory, external[0].name + '@' + external[0].version + '.metadata.json');
  const meta = JSON.parse(await fs.readFile(path)); meta.dist.integrity = sri(Buffer.from('different registry data')); await json(path, meta);
  const receipts = JSON.parse(await fs.readFile(options.registryReceiptsPath)); receipts.receipts[0].metadataSha256 = sha(await fs.readFile(path)); await json(options.registryReceiptsPath, receipts);
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'REGISTRY_METADATA_INTEGRITY_MISMATCH' });
});

test('authenticated registry archives still refuse traversal paths before creating output', async t => {
  const { options, root } = await fixture(t, { unsafeTarPath: 'package/../escaped.js' });
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'REGISTRY_TAR_PATH_REFUSED' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(join(root, 'escaped.js')), { code: 'ENOENT' });
});

test('missing dependency after staging cleans only the claimed output', async t => {
  const { options, root } = await fixture(t);
  const productPath = join(options.productRoot, 'package.json'), meta = JSON.parse(await fs.readFile(productPath));
  meta.peerDependencies['@deepseek-ai/absent-required-peer'] = '0.2.0-rc.2'; await json(productPath, meta);
  const caller = join(root, 'caller'); await write(join(caller, 'keep.txt'), 'caller content');
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'RUNTIME_DEPENDENCY_CLOSURE_MISSING' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
  assert.equal(await fs.readFile(join(caller, 'keep.txt'), 'utf8'), 'caller content');
});

test('unavailable optional workspace metadata is removed with an explicit normalization record', async t => {
  const { options } = await fixture(t, { skippedOptionalWorkspace: true });
  const result = await module.assembleDistributionRuntime(options);
  const pkg = JSON.parse(await fs.readFile(join(result.runtimeDirectory, 'node_modules/@deepseek-ai/dsh-agent/package.json')));
  assert.equal(pkg.optionalDependencies?.['@deepseek-ai/platform-unavailable'], undefined);
  assert.deepEqual(result.manifest.metadataChanges.find(x => x.package === '@deepseek-ai/dsh-agent').removedSkippedOptionalDependencies, ['@deepseek-ai/platform-unavailable']);
});

test('official launcher version and lock digest are explicit refusal boundaries', async t => {
  const { options } = await fixture(t);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedOfficialLockSha256: '0'.repeat(64) }), { code: 'OFFICIAL_LOCK_HASH_MISMATCH' });
  const path = join(options.officialRoot, 'node_modules/@deepseek-ai/dsh/package.json'), meta = JSON.parse(await fs.readFile(path));
  meta.version = '0.2.0-rc.3'; await json(path, meta);
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'OFFICIAL_LOCK_PACKAGE_MISMATCH' });
});

test('source-file index binding and trusted public license bytes cannot drift', async t => {
  const { options } = await fixture(t);
  const identity = JSON.parse(await fs.readFile(options.sourceIdentityPath)); identity.sourceFiles[0].sha256 = '0'.repeat(64); await json(options.sourceIdentityPath, identity);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedSourceIdentitySha256: sha(await fs.readFile(options.sourceIdentityPath)) }), { code: 'SOURCE_IDENTITY_MANIFEST_MISMATCH' });
  identity.sourceFiles[0].sha256 = JSON.parse(await fs.readFile(join(options.overlayDirectory, 'artifact-manifest.json'))).packages.find(x => x.name === '@deepseek-ai/cordis').packageJsonSha256;
  await json(options.sourceIdentityPath, identity);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedSourceIdentitySha256: sha(await fs.readFile(options.sourceIdentityPath)), expectedPublicLicenseSha256: '0'.repeat(64) }), { code: 'PUBLIC_LICENSE_HASH_MISMATCH' });
});

test('an output that contains an input is refused without removing the input', async t => {
  const { options, root } = await fixture(t);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, outputDirectory: root }), { code: 'EXCLUSIVE_RUNTIME_OUTSIDE_INPUTS_REQUIRED' });
  assert.equal((await fs.stat(options.sourceIdentityPath)).isFile(), true);
});

test('product publication payload cannot copy a symlink to caller configuration', async t => {
  const { options, root } = await fixture(t);
  await write(join(root, 'private-config.yml'), 'must remain outside runtime');
  await fs.symlink(join(root, 'private-config.yml'), join(options.productRoot, 'src/config-link.yml'));
  await assert.rejects(module.assembleDistributionRuntime(options), { code: 'CANONICAL_INPUT_REQUIRED' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

for (const [kind, select] of [
  ['official package metadata', options => join(options.officialRoot, 'node_modules/@deepseek-ai/dsh/package.json')],
  ['product package metadata', options => join(options.productRoot, 'package.json')],
  ['overlay manifest', options => join(options.overlayDirectory, 'artifact-manifest.json')],
]) test(`linked ${kind} is refused without reading its outside target`, async t => {
  const { options, root } = await fixture(t), selected = select(options), outside = join(root, 'outside-synthetic-private.json');
  await write(outside, 'PRIVXYZ'); await fs.unlink(selected); await fs.symlink(outside, selected);
  const reads = observeReads(t);
  const cause = await module.assembleDistributionRuntime(options).then(() => assert.fail('linked input must be refused'), cause => cause);
  reads.restore();
  assert.equal(cause.code, 'CANONICAL_INPUT_REQUIRED');
  assert.equal(cause.message.includes('PRIVXYZ'), false);
  assert.equal(reads.paths.includes(selected), false, 'canonical refusal must precede any bytes read');
  assert.equal(reads.paths.includes(outside), false);
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

for (const selected of ['.env', '.aws', 'Home', 'src/.aws']) test(`protected publication declaration ${selected} is refused before reading files`, async t => {
  const { options } = await fixture(t), path = join(options.productRoot, 'package.json');
  const meta = JSON.parse(await fs.readFile(path)); meta.files.push(selected); await json(path, meta);
  const protectedFile = join(options.productRoot, selected, ...selected.endsWith('.aws') ? ['credentials'] : selected === 'Home' ? ['config.yml'] : []);
  await write(protectedFile, 'OWNED_SYNTHETIC_PRIVATE_CONTENT');
  const reads = observeReads(t);
  const cause = await module.assembleDistributionRuntime(options).then(() => assert.fail('protected publication declaration must be refused'), cause => cause);
  reads.restore();
  assert.equal(cause.code, 'PROHIBITED_PRODUCT_PUBLICATION_PATH');
  assert.equal(reads.paths.includes(protectedFile), false, 'prohibition must be checked before traversing the selected path');
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

for (const kind of ['official', 'product']) test(`${kind} metadata first-read version drift is refused`, async t => {
  const { options } = await fixture(t);
  const path = kind === 'official' ? join(options.officialRoot, 'node_modules/color-fixture/package.json') : join(options.productRoot, 'package.json');
  let changed = false;
  const reads = observeReads(t, async (selected, bytes) => {
    if (selected !== path || changed) return;
    changed = true; const meta = JSON.parse(bytes); meta.version = '999.0.0'; await json(path, meta);
  });
  const cause = await module.assembleDistributionRuntime(options).then(() => assert.fail('metadata decision snapshot drift must be refused'), cause => cause);
  reads.restore();
  assert.equal(changed, true, 'the real first metadata read must have triggered the mutation');
  assert.equal(cause.code, 'INPUT_CHANGED_DURING_ASSEMBLY');
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

test('CLI malformed JSON reports a fixed category without raw synthetic content', async t => {
  const { options } = await fixture(t);
  await write(join(options.officialRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'PRIVXYZ');
  const result = spawnSync(process.execPath, cliArguments(options), { env: { PATH: '/usr/local/bin:/usr/bin:/bin', TZ: 'UTC', LANG: 'C' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('PRIVXYZ'), false);
  assert.deepEqual(JSON.parse(result.stderr), { errorCategory: 'ARTIFACT_JSON_INVALID' });
});

test('CLI unknown decompression errors use a fixed category', async t => {
  const { options } = await fixture(t, { invalidGzip: true });
  const result = spawnSync(process.execPath, cliArguments(options), { env: { PATH: '/usr/local/bin:/usr/bin:/bin', TZ: 'UTC', LANG: 'C' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { errorCategory: 'ASSEMBLY_FAILED' });
});

test('late output replacement preserves caller files under ownership-aware cleanup', async t => {
  const { options, root } = await fixture(t), path = join(options.outputDirectory, 'distribution-runtime-manifest.json');
  let replaced = false;
  const reads = observeReads(t, async selected => {
    if (selected !== path || replaced) return;
    replaced = true; await fs.rename(options.outputDirectory, join(root, 'owned-output-retained'));
    await fs.mkdir(options.outputDirectory); await write(join(options.outputDirectory, 'caller.txt'), 'CALLER_REPLACEMENT_REMAINS');
  });
  const cause = await module.assembleDistributionRuntime(options).then(() => assert.fail('replacement must be refused'), cause => cause);
  reads.restore(); assert.equal(replaced, true);
  assert.equal(cause.cleanupErrorCategory, 'OUTPUT_OWNERSHIP_CHANGED');
  assert.equal(await fs.readFile(join(options.outputDirectory, 'caller.txt'), 'utf8'), 'CALLER_REPLACEMENT_REMAINS');
});

test('self-consistent changed package bytes cannot retain the locked final identity', async t => {
  const { options } = await fixture(t), result = await module.assembleDistributionRuntime(options);
  const path = 'node_modules/color-fixture/package.json', absolute = join(result.runtimeDirectory, path);
  const meta = JSON.parse(await fs.readFile(absolute)); meta.version = '999.0.0'; await json(absolute, meta);
  const manifest = result.manifest, bytes = await fs.readFile(absolute), record = manifest.files.find(x => x.path === path);
  record.sha256 = sha(bytes); record.bytes = bytes.length;
  await json(result.manifestPath, manifest);
  await assert.rejects(module.verifyDistributionRuntime({ directory: result.runtimeDirectory, expectedManifestSha256: sha(await fs.readFile(result.manifestPath)) }), { code: 'DISTRIBUTION_PACKAGE_IDENTITY_MISMATCH' });
});

test('final product publication metadata must match its first-read declaration', async t => {
  const { options } = await fixture(t), result = await module.assembleDistributionRuntime(options);
  const path = 'node_modules/dsh-bot/package.json', absolute = join(result.runtimeDirectory, path);
  const meta = JSON.parse(await fs.readFile(absolute)); meta.files = ['Home']; await json(absolute, meta);
  const bytes = await fs.readFile(absolute), record = result.manifest.files.find(x => x.path === path);
  record.sha256 = sha(bytes); record.bytes = bytes.length; await json(result.manifestPath, result.manifest);
  await assert.rejects(module.verifyDistributionRuntime({ directory: result.runtimeDirectory, expectedManifestSha256: sha(await fs.readFile(result.manifestPath)) }), { code: 'DISTRIBUTION_PRODUCT_PUBLICATION_IDENTITY_MISMATCH' });
});

test('notices contain complete caller-pinned musl text within its compiled-libc scope', async t => {
  const { options } = await fixture(t), result = await module.assembleDistributionRuntime(options);
  const notices = await fs.readFile(join(result.runtimeDirectory, 'NOTICES.txt'), 'utf8');
  assert.equal(notices.includes(await fs.readFile(options.muslCopyrightPath, 'utf8')), true);
  assert.equal(notices.includes(await fs.readFile(options.muslSourceNoticesPath, 'utf8')), true);
  const musl = result.manifest.licenses.filter(item => item.scope.includes('musl'));
  assert.equal(musl.length, 2);
  assert.deepEqual(musl.map(item => item.sha256), [options.expectedMuslCopyrightSha256, options.expectedMuslSourceNoticesSha256]);
  assert.equal(result.manifest.modifiedPackageRights, 'UNKNOWN');
  assert.equal(result.manifest.publicReleaseQualified, false);
});

test('musl copyright and source notice pins are required and checked before output creation', async t => {
  const { options } = await fixture(t);
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedMuslCopyrightSha256: undefined }), { code: 'TRUSTED_DIGEST_REQUIRED' });
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedMuslCopyrightSha256: '0'.repeat(64) }), { code: 'MUSL_COPYRIGHT_HASH_MISMATCH' });
  await assert.rejects(module.assembleDistributionRuntime({ ...options, expectedMuslSourceNoticesSha256: '0'.repeat(64) }), { code: 'MUSL_SOURCE_NOTICES_HASH_MISMATCH' });
  await assert.rejects(fs.lstat(options.outputDirectory), { code: 'ENOENT' });
});

test('verification metadata rereads stay bound to the pinned receipt inventory', async t => {
  const { options } = await fixture(t), result = await module.assembleDistributionRuntime(options);
  const path = join(result.runtimeDirectory, 'node_modules/color-fixture/package.json');
  let count = 0, changed = false;
  const reads = observeReads(t, async (selected, bytes) => {
    if (selected !== path || ++count !== 2) return;
    changed = true; const meta = JSON.parse(bytes); meta.version = '999.0.0'; await json(path, meta);
  });
  const cause = await module.verifyDistributionRuntime({ directory: result.runtimeDirectory, expectedManifestSha256: result.manifestSha256 }).then(() => assert.fail('later metadata checks must retain the pinned inventory authority'), cause => cause);
  reads.restore(); assert.equal(changed, true);
  assert.equal(cause.code, 'INPUT_CHANGED_DURING_ASSEMBLY');
});
