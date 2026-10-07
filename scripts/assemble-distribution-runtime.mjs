/** Pinned format 2 consumer. Offline, no lifecycle scripts, no Home/config copying. */
import * as fs from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { verifyRuntime } from '../tools/runtime-export/export.mjs';

const CLI_VERSION = '0.2.0-rc.2';
const RECEIPT = 'distribution-runtime-manifest.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const ownErrors = new WeakSet();
const error = code => { const cause = Object.assign(new Error(code), { code }); ownErrors.add(cause); return cause; };
const inside = (root, path) => path === root || path.startsWith(root + sep);
const safe = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(x => x === '' || x === '.' || x === '..');
const packageName = name => typeof name === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name);
const prohibited = path => path.split('/').some(x => ['.git', '.env', '.aws', '.codex', '.agents', 'Home'].includes(x) || x.startsWith('.env.'));
const parseJson = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { throw error('ARTIFACT_JSON_INVALID'); } };
const packagePath = (root, name) => {
  if (!packageName(name)) throw error('INVALID_PACKAGE_NAME');
  return join(root, 'node_modules', ...name.split('/'));
};
async function canonical(path, directory = false) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw error('ABSOLUTE_ARTIFACT_PATHS_REQUIRED');
  const stat = await fs.lstat(path);
  if (resolve(path) !== path || await fs.realpath(path) !== path || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw error('CANONICAL_INPUT_REQUIRED');
  return stat;
}
const sameFileState = (a, b) => a.isFile() && b.isFile() && a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && (a.mode & 0o7777) === (b.mode & 0o7777);
async function readCanonical(path) {
  const before = await canonical(path);
  if (before.mode & 0o7000) throw error('SPECIAL_FILE_MODE_REFUSED');
  // Refuse a replaced leaf without opening its target. The opened descriptor
  // must still identify the canonical file before any payload bytes are read.
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat(), current = await canonical(path);
    if (!sameFileState(before, opened) || !sameFileState(opened, current)) throw error('INPUT_CHANGED_DURING_ASSEMBLY');
    const bytes = await handle.readFile(), after = await handle.stat(), final = await canonical(path);
    if (bytes.length !== opened.size || !sameFileState(opened, after) || !sameFileState(after, final)) throw error('INPUT_CHANGED_DURING_ASSEMBLY');
    return { bytes, stat: after };
  } finally { await handle.close(); }
}
async function pinned(path, digest, category) {
  const { bytes } = await readCanonical(path);
  if (sha(bytes) !== digest) throw error(category);
  return bytes;
}
async function fileRecord(root, path) {
  if (!safe(path) || prohibited(path)) throw error('UNSAFE_PAYLOAD_PATH');
  const { bytes, stat } = await readCanonical(join(root, path));
  return { path, bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 };
}
const sameRecord = (a, b) => a && b && a.bytes === b.bytes && a.sha256 === b.sha256 && a.mode === b.mode;
async function readTrusted(root, file, category = 'INPUT_CHANGED_DURING_ASSEMBLY') {
  if (!file || !safe(file.path) || prohibited(file.path)) throw error('UNSAFE_PAYLOAD_PATH');
  const result = await readCanonical(join(root, file.path));
  if (!sameRecord(file, { bytes: result.bytes.length, sha256: sha(result.bytes), mode: result.stat.mode & 0o777 })) throw error(category);
  return result;
}
function overlayFileSet(manifest) {
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.packages)) throw error('ARTIFACT_MANIFEST_INVALID');
  const files = new Set(['artifact-manifest.json']), directories = new Set(['.packages']), slots = new Set(manifest.packages.map(pkg => pkg.slot));
  for (const file of manifest.files) {
    if (!safe(file.path) || prohibited(file.path) || file.path.split('/').includes('node_modules') || !file.path.startsWith('.packages/') || !slots.has(file.path.split('/')[1]) || files.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw error('ARTIFACT_FILE_SET_MISMATCH');
    files.add(file.path);
    let parent = dirname(file.path); while (parent !== '.') { directories.add(parent); parent = dirname(parent); }
  }
  return { files, directories };
}
async function checkOverlayFileSet(root, expected) {
  const files = new Set(), directories = new Set();
  const walk = async (at = '') => {
    await canonical(join(root, at), true);
    for (const item of await fs.readdir(join(root, at), { withFileTypes: true })) {
      const path = at ? at + '/' + item.name : item.name;
      if (item.isDirectory() && expected.directories.has(path)) { directories.add(path); await walk(path); }
      else if (item.isFile() && expected.files.has(path)) files.add(path);
      else throw error('ARTIFACT_FILE_SET_MISMATCH');
    }
  };
  await walk();
  if (files.size !== expected.files.size || directories.size !== expected.directories.size) throw error('ARTIFACT_FILE_SET_MISMATCH');
}
async function verifyOverlayView(options, manifest, temporaryParent) {
  const manifestPath = join(options.overlayDirectory, 'artifact-manifest.json');
  const manifestBytes = await pinned(manifestPath, options.expectedManifestSha256, 'ARTIFACT_MANIFEST_HASH_MISMATCH');
  const expected = overlayFileSet(manifest);
  await checkOverlayFileSet(options.overlayDirectory, expected);
  await canonical(temporaryParent, true);
  let view, owned, failure, result;
  const checkOwnership = async () => {
    const current = await canonical(view, true);
    if (!owned || current.ino !== owned.ino || current.dev !== owned.dev || (current.mode & 0o777) !== 0o700) throw error('VERIFICATION_VIEW_OWNERSHIP_CHANGED');
  };
  try {
    view = await fs.mkdtemp(join(temporaryParent, '.dsh-overlay-verify-'));
    owned = await canonical(view, true);
    await checkOwnership();
    // The shared verifier's pathname reads operate only on this exclusive,
    // owner-only view. Caller-controlled source files are read through safe
    // descriptors and checked against the trusted manifest before copying.
    for (const file of manifest.files) {
      const { bytes } = await readTrusted(options.overlayDirectory, file, 'ARTIFACT_HASH_MISMATCH');
      const path = join(view, file.path); await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await fs.writeFile(path, bytes, { flag: 'wx', mode: file.mode }); await fs.chmod(path, file.mode);
    }
    await fs.writeFile(join(view, 'artifact-manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 });
    await checkOwnership();
    try { result = await verifyRuntime({ directory: view, expectedManifestSha256: options.expectedManifestSha256 }); }
    catch (cause) { if (cause instanceof SyntaxError) throw error('ARTIFACT_JSON_INVALID'); throw cause; }
    await checkOwnership();
    // A view never substitutes for the full original source check: reread the
    // original pinned manifest and every listed file, including modes, then
    // refuse newly added or replaced original paths before accepting a result.
    await pinned(manifestPath, options.expectedManifestSha256, 'ARTIFACT_MANIFEST_HASH_MISMATCH');
    for (const file of manifest.files) await readTrusted(options.overlayDirectory, file, 'ARTIFACT_HASH_MISMATCH');
    await checkOverlayFileSet(options.overlayDirectory, expected);
    await checkOwnership();
  } catch (cause) { failure = cause; }
  // An asynchronous pathname check does not authorize a later recursive
  // removal: another writer can replace the directory between those calls.
  // Retain the owner-only captured view on both success and failure.
  if (failure) throw failure;
  return { ...result, capturedViewRetained: true, automaticRemovalAttempted: false };
}
async function payloadFiles(root, at = '', skipModules = true) {
  if (at && (!safe(at) || prohibited(at))) throw error('PROHIBITED_PACKAGE_PAYLOAD');
  const result = [];
  for (const item of (await fs.readdir(join(root, at), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = at ? at + '/' + item.name : item.name;
    if (skipModules && item.name === 'node_modules') continue;
    if (prohibited(path)) throw error('PROHIBITED_PACKAGE_PAYLOAD');
    if (item.isDirectory()) result.push(...await payloadFiles(root, path, skipModules));
    else result.push(await fileRecord(root, path));
  }
  return result;
}
async function copyRecord(sourceRoot, file, output, destination) {
  if (!safe(destination) || prohibited(destination)) throw error('UNSAFE_PAYLOAD_PATH');
  const { bytes, stat } = await readCanonical(join(sourceRoot, file.path));
  if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes || (stat.mode & 0o7777) !== file.mode) throw error('INPUT_CHANGED_DURING_ASSEMBLY');
  const target = join(output, destination);
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, bytes, { flag: 'wx', mode: file.mode });
  await fs.chmod(target, file.mode);
}
async function publicPackages(officialRoot, lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages || lock.packages['']?.devDependencies?.['@deepseek-ai/dsh'] !== CLI_VERSION) throw error('OFFICIAL_LOCK_IDENTITY_REQUIRED');
  const packages = [], files = [];
  for (const [path, binding] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (path === '') continue;
    if (!safe(path) || !/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(path)) throw error('OFFICIAL_LOCK_PATH_INVALID');
    let stat;
    try { stat = await fs.lstat(join(officialRoot, path)); }
    catch (cause) { if (cause.code === 'ENOENT' && binding.optional) continue; throw error('OFFICIAL_LOCKED_PACKAGE_MISSING'); }
    if (!stat.isDirectory() || await fs.realpath(join(officialRoot, path)) !== join(officialRoot, path)) throw error('OFFICIAL_PACKAGE_SYMLINK_REFUSED');
    const name = path.split('node_modules/').at(-1), { bytes, stat: metadataStat } = await readCanonical(join(officialRoot, path, 'package.json')), meta = parseJson(bytes);
    const metadataRecord = { path: 'package.json', bytes: bytes.length, sha256: sha(bytes), mode: metadataStat.mode & 0o777 };
    if (meta.name !== name || meta.version !== binding.version || typeof binding.integrity !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(binding.integrity)) throw error('OFFICIAL_LOCK_PACKAGE_MISMATCH');
    let url; try { url = new URL(binding.resolved); } catch { throw error('PUBLIC_REGISTRY_PROVENANCE_REQUIRED'); }
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password) throw error('PUBLIC_REGISTRY_PROVENANCE_REQUIRED');
    const entries = await payloadFiles(join(officialRoot, path));
    if (!sameRecord(metadataRecord, entries.find(file => file.path === 'package.json'))) throw error('INPUT_CHANGED_DURING_ASSEMBLY');
    packages.push({ name, version: meta.version, path, resolved: binding.resolved, integrity: binding.integrity, packageJsonSha256: sha(bytes) });
    files.push(...entries.map(file => ({ ...file, path: path + '/' + file.path })));
  }
  const cli = packages.find(x => x.path === 'node_modules/@deepseek-ai/dsh');
  if (!cli || cli.version !== CLI_VERSION) throw error('FIXED_OFFICIAL_CLI_VERSION_REQUIRED');
  return { packages, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
function tarNumber(header, at, length) {
  const text = header.subarray(at, at + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]*$/.test(text)) throw error('REGISTRY_TAR_HEADER_INVALID');
  return text ? parseInt(text, 8) : 0;
}
function tarString(header, at, length) { return header.subarray(at, at + length).toString('utf8').replace(/\0.*$/, ''); }
function paxRecords(bytes) {
  const result = {}; let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset); const size = Number(bytes.subarray(offset, space).toString('ascii'));
    if (space < offset || !Number.isSafeInteger(size) || size < space - offset + 3 || offset + size > bytes.length) throw error('REGISTRY_TAR_PAX_INVALID');
    const value = bytes.subarray(space + 1, offset + size - 1).toString('utf8'), equal = value.indexOf('=');
    if (equal < 1) throw error('REGISTRY_TAR_PAX_INVALID');
    result[value.slice(0, equal)] = value.slice(equal + 1); offset += size;
  }
  return result;
}
function tarPayload(raw) {
  const buffer = gunzipSync(raw, { maxOutputLength: 256 * 1024 * 1024 }), files = [], seen = new Set();
  let offset = 0, pax = {}, global = {}, longName;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512); offset += 512;
    if (header.every(x => x === 0)) {
      if (buffer.subarray(offset).some(x => x !== 0)) throw error('REGISTRY_TAR_TRAILING_DATA');
      break;
    }
    const checksum = header.reduce((sum, value, i) => sum + (i >= 148 && i < 156 ? 32 : value), 0);
    if (checksum !== tarNumber(header, 148, 8)) throw error('REGISTRY_TAR_HEADER_INVALID');
    const size = tarNumber(header, 124, 12), mode = tarNumber(header, 100, 8), type = tarString(header, 156, 1);
    if (offset + size > buffer.length) throw error('REGISTRY_TAR_TRUNCATED');
    const bytes = buffer.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') { type === 'x' ? pax = paxRecords(bytes) : global = { ...global, ...paxRecords(bytes) }; continue; }
    if (type === 'L') { longName = bytes.toString('utf8').replace(/\0.*$/, ''); continue; }
    const prefix = tarString(header, 345, 155);
    const name = pax.path ?? global.path ?? longName ?? (prefix ? prefix + '/' : '') + tarString(header, 0, 100);
    pax = {}; longName = undefined;
    if (type === '5') { if (name !== 'package/' && (!name.startsWith('package/') || !safe(name.replace(/\/$/, '')))) throw error('REGISTRY_TAR_PATH_REFUSED'); continue; }
    if (!['', '0'].includes(type) || !name.startsWith('package/') || !safe(name.slice(8)) || prohibited(name.slice(8)) || name.slice(8).split('/').includes('node_modules') || mode & 0o7000) throw error('REGISTRY_TAR_PATH_REFUSED');
    const path = name.slice(8);
    if (seen.has(path)) throw error('REGISTRY_TAR_DUPLICATE_PATH');
    seen.add(path); files.push({ path, bytes: bytes.length, sha256: sha(bytes), mode: mode & 0o777, data: bytes });
  }
  if (!seen.has('package.json') || offset > buffer.length) throw error('REGISTRY_TAR_PACKAGE_JSON_REQUIRED');
  return files;
}
function checkSri(bytes, integrity) {
  const [algorithm, value] = integrity.split('-');
  return createHash(algorithm).update(bytes).digest('base64') === value;
}
async function registryPackages(options, manifest) {
  const { bytes: receiptBytes } = await readCanonical(options.registryReceiptsPath), inventory = parseJson(receiptBytes);
  if (inventory.scriptsExecuted !== false || !Array.isArray(inventory.receipts)) throw error('REGISTRY_RECEIPT_INVALID');
  const packages = [];
  for (const item of manifest.externalPackages) {
    const version = item.reference.replace(/\(.*/, ''), receipts = inventory.receipts.filter(x => x.name === item.name && x.version === version);
    if (receipts.length !== 1) throw error('REGISTRY_RECEIPT_IDENTITY_MISMATCH');
    const receipt = receipts[0];
    const inputPath = value => {
      if (!safe(value)) throw error('REGISTRY_RECEIPT_PATH_INVALID');
      const path = join(dirname(options.registryReceiptsPath), value);
      if (!inside(options.registryDirectory, path)) throw error('REGISTRY_RECEIPT_PATH_INVALID');
      return path;
    };
    const tarballPath = inputPath(receipt.tarballPath), metadataPath = inputPath(receipt.metadataPath);
    const { bytes: raw } = await readCanonical(tarballPath), { bytes: metadataBytes } = await readCanonical(metadataPath), metadata = parseJson(metadataBytes);
    if (!checkSri(raw, item.integrity) || raw.length !== receipt.bytes || sha(raw) !== receipt.tarballSha256) throw error('REGISTRY_TARBALL_INTEGRITY_MISMATCH');
    if (metadata.name !== item.name || metadata.version !== version || metadata.dist?.integrity !== item.integrity || receipt.integrity !== item.integrity || receipt.actualIntegrity !== item.integrity || sha(metadataBytes) !== receipt.metadataSha256) throw error('REGISTRY_METADATA_INTEGRITY_MISMATCH');
    const files = tarPayload(raw), meta = parseJson(files.find(x => x.path === 'package.json').data);
    if (meta.name !== item.name || meta.version !== version) throw error('REGISTRY_TARBALL_PACKAGE_IDENTITY_MISMATCH');
    const key = item.name + '@' + item.reference;
    packages.push({ key, item, meta, files, path: 'node_modules/.dsh-external/' + item.name.replace('/', '+') + '@' + version + '-' + sha(key).slice(0, 16) + '/node_modules/' + item.name,
      provenance: { name: item.name, reference: item.reference, version, integrity: item.integrity, tarballSha256: sha(raw), metadataSha256: sha(metadataBytes), rawBytes: raw.length, tarballPath, metadataPath, metadataUrl: receipt.metadataURL ?? null, tarballUrl: receipt.tarballURL ?? null } });
  }
  return { packages, receiptSha256: sha(receiptBytes) };
}
async function readSourceLock(options, official) {
  const { bytes } = await readCanonical(options.sourceLockPath);
  if (bytes.toString('utf8').trimStart().startsWith('{')) return parseJson(bytes);
  const yaml = official.packages.find(x => x.path === 'node_modules/js-yaml');
  if (!yaml) throw error('LOCKED_YAML_PARSER_REQUIRED');
  // Only the caller-selected, lock-bound public parser is used; never install one.
  try { return createRequire(join(options.officialRoot, 'package-lock.json'))('js-yaml').load(bytes.toString('utf8')); }
  catch { throw error('SOURCE_LOCK_PARSE_INVALID'); }
}
async function addLink(output, path, target) {
  if (!safe(path) || !safe(target)) throw error('UNSAFE_RUNTIME_LINK');
  const absolute = join(output, path), destination = join(output, target);
  await fs.mkdir(dirname(absolute), { recursive: true });
  await fs.symlink(relative(dirname(absolute), destination), absolute);
}
async function resolveDependency(root, from, name) {
  let at = join(root, from);
  while (inside(root, at)) {
    if (at.split(sep).at(-1) !== 'node_modules') {
      const candidate = packagePath(at, name);
      try { const actual = await fs.realpath(candidate); if (!inside(root, actual)) throw error('RUNTIME_LINK_ESCAPE'); await canonical(join(actual, 'package.json')); return relative(root, actual); }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    }
    if (at === root) break; at = dirname(at);
  }
  return null;
}
async function metadataClosure(output, coreNames, expectedBindings, trustedFiles) {
  const packageFiles = trustedFiles.filter(x => x.path.endsWith('/package.json')).sort((a, b) => a.path.localeCompare(b.path));
  const roots = new Map(), edges = [];
  for (const file of packageFiles) {
    const { bytes } = await readTrusted(output, file), meta = parseJson(bytes), path = dirname(file.path);
    if (!packageName(meta.name) || !meta.version) continue; // Some public packages publish fixture package.json files.
    if (!/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(path)) continue;
    if (coreNames.has(meta.name)) {
      if (path !== 'node_modules/' + meta.name || roots.has(meta.name)) throw error('DUPLICATE_CORE_INSTANCE');
      roots.set(meta.name, path);
    }
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) for (const name of Object.keys(meta[section] ?? {})) {
      const resolved = await resolveDependency(output, path, name);
      if (!resolved && (section === 'optionalDependencies' || section === 'peerDependencies' && meta.peerDependenciesMeta?.[name]?.optional)) continue;
      if (!resolved) throw Object.assign(error('RUNTIME_DEPENDENCY_CLOSURE_MISSING'), { package: meta.name, dependency: name });
      if (coreNames.has(name) && resolved !== 'node_modules/' + name) throw error('DUPLICATE_CORE_INSTANCE');
      edges.push({ from: path, dependency: name, section, resolved });
    }
  }
  for (const binding of expectedBindings) if (await resolveDependency(output, binding.from, binding.dependency) !== binding.resolved) throw error('EXACT_LOCK_BINDING_MISMATCH');
  return edges;
}
async function inventoryRuntime(root, at = '') {
  const files = [], directories = [], links = [];
  for (const item of (await fs.readdir(join(root, at), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = at ? at + '/' + item.name : item.name;
    if (path === RECEIPT) continue;
    if (!safe(path) || prohibited(path)) throw error('PROHIBITED_RUNTIME_PATH');
    if (item.isSymbolicLink()) {
      const link = await fs.readlink(join(root, path)), target = resolve(dirname(join(root, path)), link);
      if (isAbsolute(link) || !inside(root, target)) throw error('RUNTIME_LINK_ESCAPE');
      const actual = await fs.realpath(join(root, path)); if (!inside(root, actual)) throw error('RUNTIME_LINK_ESCAPE');
      links.push({ path, target: link, resolvesTo: relative(root, actual) });
    } else if (item.isDirectory()) {
      directories.push(path); const child = await inventoryRuntime(root, path);
      files.push(...child.files); directories.push(...child.directories); links.push(...child.links);
    } else files.push(await fileRecord(root, path));
  }
  return { files, directories, links };
}
async function normalizeMetadata(output, file, versions, changes, packageLabel, skipped) {
  const path = file.path, { bytes: before } = await readTrusted(output, file), meta = parseJson(before); let changed = false;
  const unresolvedDevelopmentRanges = [], removedSkippedOptionalDependencies = [];
  for (const name of Object.keys(meta.optionalDependencies ?? {})) if (skipped.some(item => item.package === packageLabel && item.dependency === name && item.reason.startsWith('PLATFORM_'))) {
    delete meta.optionalDependencies[name]; removedSkippedOptionalDependencies.push(name); changed = true;
  }
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) for (const [name, value] of Object.entries(meta[section] ?? {})) if (typeof value === 'string' && value.startsWith('workspace:')) {
    const version = versions.get(name);
    if (!version) {
      if (section === 'devDependencies') { unresolvedDevelopmentRanges.push({ name, range: value }); continue; }
      throw error('WORKSPACE_METADATA_BINDING_MISSING');
    }
    meta[section][name] = (value === 'workspace:^' ? '^' : value === 'workspace:~' ? '~' : '') + version; changed = true;
  }
  const after = changed ? Buffer.from(JSON.stringify(meta, null, 2) + '\n') : before;
  if (changed) await fs.writeFile(join(output, path), after);
  changes.push({ package: packageLabel, path, beforeSha256: sha(before), afterSha256: sha(after), afterBytes: after.length, workspaceRangesNormalized: changed, unresolvedDevelopmentRanges, removedSkippedOptionalDependencies });
}
async function productPayload(productRoot) {
  const { bytes, stat } = await readCanonical(join(productRoot, 'package.json')), meta = parseJson(bytes);
  if (meta.name !== 'dsh-bot' || !Array.isArray(meta.files) || !meta.files.every(safe)) throw error('EXPLICIT_PRODUCT_PUBLICATION_FILES_REQUIRED');
  if (meta.files.some(prohibited)) throw error('PROHIBITED_PRODUCT_PUBLICATION_PATH');
  const metadataRecord = { path: 'package.json', bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 };
  const files = [metadataRecord];
  for (const path of meta.files) {
    const stat = await canonical(join(productRoot, path), (await fs.lstat(join(productRoot, path))).isDirectory());
    if (stat.isDirectory()) files.push(...(await payloadFiles(join(productRoot, path))).map(file => ({ ...file, path: path + '/' + file.path })));
    else files.push(await fileRecord(productRoot, path));
  }
  if (!sameRecord(metadataRecord, await fileRecord(productRoot, 'package.json'))) throw error('INPUT_CHANGED_DURING_ASSEMBLY');
  return { meta, files };
}
async function verifyPackageIdentities(root, identities, files) {
  const seen = new Set(), indexed = new Map(files.map(file => [file.path, file]));
  for (const item of identities) {
    if (!safe(item.path) || !packageName(item.name) || typeof item.version !== 'string' || seen.has(item.path)) throw error('DISTRIBUTION_PACKAGE_IDENTITY_INVALID');
    seen.add(item.path);
    const path = item.path + '/package.json', expected = indexed.get(path);
    if (!expected) throw error('DISTRIBUTION_PACKAGE_IDENTITY_INVALID');
    const { bytes } = await readTrusted(root, expected);
    const meta = parseJson(bytes);
    if (meta.name !== item.name || meta.version !== item.version) throw error('DISTRIBUTION_PACKAGE_IDENTITY_MISMATCH');
  }
}

export async function assembleDistributionRuntime(options) {
  const pathKeys = ['officialRoot', 'officialLockPath', 'overlayDirectory', 'sourceIdentityPath', 'sourceLockPath', 'registryDirectory', 'registryReceiptsPath', 'productRoot', 'publicLicensePath', 'nativeLicensePath', 'muslCopyrightPath', 'muslSourceNoticesPath'];
  for (const key of ['expectedManifestSha256', 'expectedOfficialLockSha256', 'expectedSourceIdentitySha256', 'expectedPublicLicenseSha256', 'expectedNativeLicenseSha256', 'expectedMuslCopyrightSha256', 'expectedMuslSourceNoticesSha256']) if (!/^[a-f0-9]{64}$/.test(options[key] ?? '')) throw error('TRUSTED_DIGEST_REQUIRED');
  for (const key of pathKeys) await canonical(options[key], ['officialRoot', 'overlayDirectory', 'registryDirectory', 'productRoot'].includes(key));
  const output = options.outputDirectory;
  if (typeof output !== 'string' || !isAbsolute(output) || resolve(output) !== output) throw error('ABSOLUTE_ARTIFACT_PATHS_REQUIRED');
  if (await fs.realpath(dirname(output)) !== dirname(output)) throw error('CANONICAL_OUTPUT_PARENT_REQUIRED');
  if (pathKeys.some(key => inside(options[key], output) || inside(output, options[key]))) throw error('EXCLUSIVE_RUNTIME_OUTSIDE_INPUTS_REQUIRED');
  try { await fs.lstat(output); throw error('OUTPUT_ALREADY_EXISTS'); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  const overlayManifestPath = join(options.overlayDirectory, 'artifact-manifest.json');
  const manifest = parseJson(await pinned(overlayManifestPath, options.expectedManifestSha256, 'ARTIFACT_MANIFEST_HASH_MISMATCH'));
  const verifyOverlay = () => verifyOverlayView(options, manifest, dirname(output));
  const beforeVerification = await verifyOverlay();
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw error('OVERLAY_PLATFORM_ARCH_MISMATCH');
  const identityBytes = await pinned(options.sourceIdentityPath, options.expectedSourceIdentitySha256, 'SOURCE_IDENTITY_HASH_MISMATCH'), identity = parseJson(identityBytes);
  const { sourceFiles, ...sourceIdentity } = identity;
  if (JSON.stringify(sourceIdentity) !== JSON.stringify(manifest.sourceIdentity) || !Array.isArray(sourceFiles) || sourceFiles.length !== manifest.verifiedSourceFileCount || sha(JSON.stringify(sourceFiles)) !== manifest.sourceFileIndexSha256 || sourceIdentity.declaredLocalHeadIsBuiltIdentity !== false) throw error('SOURCE_IDENTITY_MANIFEST_MISMATCH');
  const sourceLockBytes = await pinned(options.sourceLockPath, sourceIdentity.dependencyLockSha256, 'SOURCE_LOCK_HASH_MISMATCH');
  const officialLockBytes = await pinned(options.officialLockPath, options.expectedOfficialLockSha256, 'OFFICIAL_LOCK_HASH_MISMATCH'), officialLock = parseJson(officialLockBytes);
  const official = await publicPackages(options.officialRoot, officialLock);
  const sourceLock = await readSourceLock(options, official);
  if (sha(JSON.stringify(sourceLock)) !== manifest.lockObjectSha256) throw error('SOURCE_LOCK_OBJECT_MISMATCH');
  const registry = await registryPackages(options, manifest);
  const publicLicense = await pinned(options.publicLicensePath, options.expectedPublicLicenseSha256, 'PUBLIC_LICENSE_HASH_MISMATCH');
  const nativeLicense = await pinned(options.nativeLicensePath, options.expectedNativeLicenseSha256, 'NATIVE_LICENSE_HASH_MISMATCH');
  const muslCopyright = await pinned(options.muslCopyrightPath, options.expectedMuslCopyrightSha256, 'MUSL_COPYRIGHT_HASH_MISMATCH');
  const muslSourceNotices = await pinned(options.muslSourceNoticesPath, options.expectedMuslSourceNoticesSha256, 'MUSL_SOURCE_NOTICES_HASH_MISMATCH');
  const product = await productPayload(options.productRoot);
  let claimed, created = false;
  const checkOwnership = async () => {
    const current = await fs.lstat(output);
    if (!claimed || !current.isDirectory() || current.isSymbolicLink() || current.ino !== claimed.ino || current.dev !== claimed.dev) throw error('OUTPUT_OWNERSHIP_CHANGED');
  };
  try {
    try { await fs.mkdir(output, { mode: 0o700 }); } catch (cause) { if (cause.code === 'EEXIST') throw error('OUTPUT_ALREADY_EXISTS'); throw cause; }
    created = true;
    claimed = await fs.lstat(output);
    const coreNames = new Set(manifest.packages.map(x => x.name)), versions = new Map(manifest.packages.map(x => [x.name, x.version]));
    // The original public graph has already been inventoried and pinned. Core
    // packages replaced by the source-built overlay need not be copied and
    // then recursively deleted from the caller-selected output pathname.
    const replacedPrefixes = manifest.packages.map(pkg => 'node_modules/' + pkg.name + '/');
    const retainedOfficialFiles = official.files.filter(file => !replacedPrefixes.some(prefix => file.path.startsWith(prefix)));
    const copiedFiles = new Map(retainedOfficialFiles.map(file => [file.path, { ...file }]));
    for (const file of retainedOfficialFiles) await copyRecord(options.officialRoot, file, output, file.path);
    await checkOwnership();
    for (const file of manifest.files) {
      const slot = file.path.split('/')[1], pkg = manifest.packages.find(x => x.slot === slot);
      const destination = 'node_modules/' + pkg.name + '/' + file.path.split('/').slice(2).join('/');
      await copyRecord(options.overlayDirectory, file, output, destination);
      copiedFiles.set(destination, { ...file, path: destination });
    }
    const expectedBindings = [], externalMap = new Map(registry.packages.map(pkg => [pkg.key, pkg]));
    await checkOwnership();
    for (const pkg of registry.packages) for (const file of pkg.files) {
      const path = join(output, pkg.path, file.path); await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, file.data, { flag: 'wx', mode: file.mode }); await fs.chmod(path, file.mode);
      const destination = pkg.path + '/' + file.path;
      copiedFiles.set(destination, { path: destination, bytes: file.bytes, sha256: file.sha256, mode: file.mode });
    }
    for (const pkg of registry.packages) for (const [name, reference] of Object.entries({ ...pkg.item.dependencies, ...pkg.item.optionalDependencies })) {
      const target = externalMap.get(name + '@' + reference);
      if (!target) {
        if (manifest.skipped.some(x => x.package === pkg.key && x.dependency === name && x.reason === 'PLATFORM_OPTIONAL')) continue;
        throw error('EXTERNAL_LOCK_BINDING_MISSING');
      }
      await addLink(output, pkg.path + '/node_modules/' + name, target.path);
      expectedBindings.push({ from: pkg.path, dependency: name, reference, resolved: target.path });
    }
    for (const pkg of manifest.packages) {
      const path = 'node_modules/' + pkg.name + '/package.json', { bytes } = await readTrusted(output, copiedFiles.get(path)), meta = parseJson(bytes), importer = sourceLock.importers[pkg.sourcePath];
      if (!importer) throw error('CORE_LOCK_IMPORTER_MISSING');
      for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) for (const name of Object.keys(meta[section] ?? {})) {
        if (coreNames.has(name)) { expectedBindings.push({ from: 'node_modules/' + pkg.name, dependency: name, resolved: 'node_modules/' + name }); continue; }
        if (section === 'peerDependencies' && meta.peerDependenciesMeta?.[name]?.optional || manifest.skipped.some(x => x.package === pkg.name && x.dependency === name && x.reason.startsWith('PLATFORM_'))) continue;
        const binding = importer[section]?.[name] ?? (section === 'peerDependencies' ? importer.dependencies?.[name] ?? importer.devDependencies?.[name] : undefined);
        const external = binding && externalMap.get(name + '@' + binding.version);
        if (!external) throw error('CORE_EXTERNAL_LOCK_BINDING_MISSING');
        const path = 'node_modules/' + pkg.name + '/node_modules/' + name;
        try { await fs.lstat(join(output, path)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; await addLink(output, path, external.path); }
        expectedBindings.push({ from: 'node_modules/' + pkg.name, dependency: name, section, reference: binding.version, resolved: external.path });
      }
    }
    const metadataChanges = [];
    await checkOwnership();
    for (const pkg of manifest.packages) await normalizeMetadata(output, copiedFiles.get('node_modules/' + pkg.name + '/package.json'), versions, metadataChanges, pkg.name, manifest.skipped);
    for (const file of product.files) {
      const destination = 'node_modules/dsh-bot/' + file.path;
      await copyRecord(options.productRoot, file, output, destination);
      copiedFiles.set(destination, { ...file, path: destination });
    }
    const cliPath = 'node_modules/@deepseek-ai/dsh/package.json', { bytes: beforeCli } = await readTrusted(output, copiedFiles.get(cliPath)), cli = parseJson(beforeCli);
    cli.dependencies = { ...cli.dependencies, 'dsh-bot': product.meta.version };
    const afterCli = Buffer.from(JSON.stringify(cli, null, 2) + '\n'); await fs.writeFile(join(output, cliPath), afterCli);
    metadataChanges.push({ package: '@deepseek-ai/dsh', path: cliPath, beforeSha256: sha(beforeCli), afterSha256: sha(afterCli), afterBytes: afterCli.length, productDependencyAdded: true });
    for (const change of metadataChanges) {
      const original = copiedFiles.get(change.path);
      if (!original || original.sha256 !== change.beforeSha256) throw error('METADATA_ORIGINAL_HASH_MISMATCH');
      copiedFiles.set(change.path, { ...original, sha256: change.afterSha256, bytes: change.afterBytes });
    }
    // Recreate each package's bin at its own npm level. Source .bin links are not copied.
    for (const pkg of official.packages) {
      const { bytes } = await readTrusted(output, copiedFiles.get(pkg.path + '/package.json')), meta = parseJson(bytes);
      const bins = typeof meta.bin === 'string' ? { [meta.name.split('/').at(-1)]: meta.bin } : meta.bin ?? {};
      const level = pkg.path.slice(0, pkg.path.lastIndexOf('node_modules/') + 'node_modules'.length);
      for (const [name, value] of Object.entries(bins)) {
        if (!/^[a-zA-Z0-9._-]+$/.test(name) || !safe(value.replace(/^\.\//, ''))) throw error('PUBLIC_BIN_PATH_INVALID');
        const path = level + '/.bin/' + name, target = pkg.path + '/' + value.replace(/^\.\//, '');
        try { await fs.lstat(join(output, path)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; await addLink(output, path, target); }
      }
    }
    const notices = `Private source-build runtime. Public release qualification: false.\nPublic baseline root license follows; applies only within its public source scope.\n${publicLicense.toString('utf8')}\nPublic native/system source license follows; applies only to native/system scope.\n${nativeLicense.toString('utf8')}\nPublic musl 1.2.5 copyright follows; applies only to included compiled musl/libc portions.\n${muslCopyright.toString('utf8')}\nAdditional unmodified musl 1.2.5 source notices follow; conservatively retained without claiming every listed function or architecture is embedded.\n${muslSourceNotices.toString('utf8')}\nPackage-local original notices are retained. MIT fallback entry metadata is not a dual-license determination.\nRights for private patches and every modified package: UNKNOWN.\nThe complete official SDK graph is retained for private GUI qualification. Minimal closure and license/source-offer audit remain open, including MPL and LGPL dependencies.\nSandbox enforcement is unverified; no enforcement success is asserted.\n`;
    await fs.writeFile(join(output, 'NOTICES.txt'), notices, { flag: 'wx', mode: 0o644 });
    await fs.chmod(join(output, 'NOTICES.txt'), 0o644);
    copiedFiles.set('NOTICES.txt', { path: 'NOTICES.txt', bytes: Buffer.byteLength(notices), sha256: sha(notices), mode: 0o644 });
    const closure = await metadataClosure(output, coreNames, expectedBindings, [...copiedFiles.values()]);
    const afterVerification = await verifyOverlay();
    await pinned(options.sourceIdentityPath, sha(identityBytes), 'SOURCE_IDENTITY_CHANGED');
    await pinned(options.sourceLockPath, sha(sourceLockBytes), 'SOURCE_LOCK_CHANGED');
    await pinned(options.officialLockPath, sha(officialLockBytes), 'OFFICIAL_LOCK_CHANGED');
    const inventory = await inventoryRuntime(output);
    const expectedCopiedFiles = [...copiedFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (JSON.stringify([...inventory.files].sort((a, b) => a.path.localeCompare(b.path))) !== JSON.stringify(expectedCopiedFiles)) throw error('COPIED_PAYLOAD_HASH_MODE_MISMATCH');
    const identities = new Map(official.packages.map(pkg => [pkg.path, { path: pkg.path, name: pkg.name, version: pkg.version }]));
    for (const pkg of manifest.packages) identities.set('node_modules/' + pkg.name, { path: 'node_modules/' + pkg.name, name: pkg.name, version: pkg.version });
    for (const pkg of registry.packages) identities.set(pkg.path, { path: pkg.path, name: pkg.meta.name, version: pkg.meta.version });
    identities.set('node_modules/dsh-bot', { path: 'node_modules/dsh-bot', name: product.meta.name, version: product.meta.version });
    const packageIdentities = [...identities.values()].sort((a, b) => a.path.localeCompare(b.path));
    await verifyPackageIdentities(output, packageIdentities, inventory.files);
    const receipt = { format: 1, classification: 'PRIVATE_PINNED_SOURCE_BUILD_DISTRIBUTION_RUNTIME', platform: process.platform, arch: process.arch,
      overlayManifestSha256: options.expectedManifestSha256, sourceIdentitySha256: sha(identityBytes), sourceIdentity, sourceFileIndexSha256: manifest.sourceFileIndexSha256, verifiedSourceFileCount: manifest.verifiedSourceFileCount,
      sourceLockSha256: sha(sourceLockBytes), sourceLockObjectSha256: manifest.lockObjectSha256, corePackageCount: manifest.corePackageCount, externalPackageCount: registry.packages.length,
      officialCliVersion: CLI_VERSION, officialLockSha256: sha(officialLockBytes), officialPackages: official.packages, officialInputFileIndexSha256: sha(JSON.stringify(official.files)), officialInputFileCount: official.files.length,
      officialByteTrustScope: 'Caller-selected installed public graph; pinned npm lock provenance and fresh file hashes. Installed files were not compared to npm raw tarballs by this consumer.',
      registryReceiptsSha256: registry.receiptSha256, externalPackages: registry.packages.map(pkg => ({ ...pkg.provenance, path: pkg.path })), exactBindings: expectedBindings,
      productFiles: product.files, productIdentity: { name: product.meta.name, version: product.meta.version, publicationFiles: product.meta.files }, corePackages: manifest.packages.map(pkg => ({ name: pkg.name, version: pkg.version, path: 'node_modules/' + pkg.name })), packageIdentities,
      metadataChanges, dependencyClosure: closure, overlayVerificationBefore: beforeVerification, overlayVerificationAfter: afterVerification,
      licenses: [{ scope: 'public baseline source', sha256: sha(publicLicense) }, { scope: 'public native/system source only', sha256: sha(nativeLicense) }, { scope: 'public musl 1.2.5 compiled libc portions only', sha256: sha(muslCopyright) }, { scope: 'public musl 1.2.5 additional source notices, conservatively retained for compiled libc portions', sha256: sha(muslSourceNotices) }], modifiedPackageRights: 'UNKNOWN',
      copiedFileCount: copiedFiles.size, copiedFileIndexSha256: sha(JSON.stringify(expectedCopiedFiles)), lifecycleScriptsExecuted: false, executableBytesAltered: false, credentialsOrHomesCopied: false, publicReleaseQualified: false, sandboxEnforcementVerified: false,
      qualification: 'Private isolated official CLI / source-built overlay for GUI acceptance; complete SDK closure retained. Public release, minimal closure, rights and full license obligations remain unqualified.',
      ...inventory };
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'); await fs.writeFile(join(output, RECEIPT), receiptBytes, { flag: 'wx', mode: 0o600 });
    await verifyDistributionRuntime({ directory: output, expectedManifestSha256: sha(receiptBytes) });
    await checkOwnership();
    return { runtimeDirectory: output, dsh: join(output, 'node_modules/.bin/dsh'), manifestPath: join(output, RECEIPT), manifestSha256: sha(receiptBytes), ownership: { ino: claimed.ino, dev: claimed.dev }, manifest: receipt };
  } catch (cause) {
    if (created) cause.failureOutputPolicy = 'RETAINED_NO_AUTOMATIC_REMOVAL';
    throw cause;
  }
}

export async function verifyDistributionRuntime({ directory, expectedManifestSha256 }) {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '')) throw error('TRUSTED_DIGEST_REQUIRED');
  await canonical(directory, true); await canonical(join(directory, RECEIPT));
  const bytes = await pinned(join(directory, RECEIPT), expectedManifestSha256, 'DISTRIBUTION_MANIFEST_HASH_MISMATCH'), manifest = parseJson(bytes);
  if (manifest.classification !== 'PRIVATE_PINNED_SOURCE_BUILD_DISTRIBUTION_RUNTIME' || manifest.platform !== process.platform || manifest.arch !== process.arch || !Array.isArray(manifest.files) || !Array.isArray(manifest.links) || !Array.isArray(manifest.directories) || !Array.isArray(manifest.packageIdentities) || !Array.isArray(manifest.corePackages) || manifest.corePackages.length !== manifest.corePackageCount || manifest.productIdentity?.name !== 'dsh-bot') throw error('DISTRIBUTION_MANIFEST_INVALID');
  const actual = await inventoryRuntime(directory);
  if (JSON.stringify(actual.files.map(x => x.path)) !== JSON.stringify(manifest.files.map(x => x.path)) || JSON.stringify(actual.directories) !== JSON.stringify(manifest.directories) || JSON.stringify(actual.links) !== JSON.stringify(manifest.links)) throw error('DISTRIBUTION_FILE_SET_MISMATCH');
  if (JSON.stringify(actual.files) !== JSON.stringify(manifest.files)) throw error('DISTRIBUTION_FILE_HASH_MISMATCH');
  await verifyPackageIdentities(directory, manifest.packageIdentities, actual.files);
  const identities = new Map(manifest.packageIdentities.map(item => [item.path, item]));
  const expectedIdentity = item => {
    const actual = identities.get(item.path);
    if (!actual || actual.name !== item.name || actual.version !== item.version) throw error('DISTRIBUTION_PACKAGE_IDENTITY_MISMATCH');
  };
  for (const pkg of manifest.corePackages) expectedIdentity(pkg);
  const coreNames = new Set(manifest.corePackages.map(pkg => pkg.name));
  for (const pkg of manifest.officialPackages) if (!coreNames.has(pkg.name) || pkg.path !== 'node_modules/' + pkg.name) expectedIdentity(pkg);
  for (const pkg of manifest.externalPackages) expectedIdentity(pkg);
  expectedIdentity({ path: 'node_modules/@deepseek-ai/dsh', name: '@deepseek-ai/dsh', version: CLI_VERSION });
  expectedIdentity({ path: 'node_modules/dsh-bot', name: 'dsh-bot', version: manifest.productIdentity.version });
  const { bytes: cliBytes } = await readTrusted(directory, manifest.files.find(file => file.path === 'node_modules/@deepseek-ai/dsh/package.json'));
  if (parseJson(cliBytes).dependencies?.['dsh-bot'] !== manifest.productIdentity.version) throw error('DISTRIBUTION_PRODUCT_LAUNCHER_BINDING_MISMATCH');
  const { bytes: productBytes } = await readTrusted(directory, manifest.files.find(file => file.path === 'node_modules/dsh-bot/package.json'));
  if (JSON.stringify(parseJson(productBytes).files) !== JSON.stringify(manifest.productIdentity.publicationFiles)) throw error('DISTRIBUTION_PRODUCT_PUBLICATION_IDENTITY_MISMATCH');
  const closure = await metadataClosure(directory, coreNames, manifest.exactBindings, manifest.files);
  if (JSON.stringify(closure) !== JSON.stringify(manifest.dependencyClosure)) throw error('DISTRIBUTION_DEPENDENCY_CLOSURE_MISMATCH');
  return { verified: true, manifestSha256: sha(bytes), fileCount: actual.files.length, corePackageCount: manifest.corePackageCount, externalPackageCount: manifest.externalPackageCount };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = { '--official': 'officialRoot', '--official-lock': 'officialLockPath', '--official-lock-sha256': 'expectedOfficialLockSha256', '--overlay': 'overlayDirectory', '--manifest-sha256': 'expectedManifestSha256', '--source-identity': 'sourceIdentityPath', '--source-identity-sha256': 'expectedSourceIdentitySha256', '--source-lock': 'sourceLockPath', '--registry': 'registryDirectory', '--receipts': 'registryReceiptsPath', '--product': 'productRoot', '--output': 'outputDirectory', '--public-license': 'publicLicensePath', '--public-license-sha256': 'expectedPublicLicenseSha256', '--native-license': 'nativeLicensePath', '--native-license-sha256': 'expectedNativeLicenseSha256', '--musl-copyright': 'muslCopyrightPath', '--musl-copyright-sha256': 'expectedMuslCopyrightSha256', '--musl-source-notices': 'muslSourceNoticesPath', '--musl-source-notices-sha256': 'expectedMuslSourceNoticesSha256' };
  const options = {};
  try {
    for (let i = 2; i < process.argv.length; i += 2) { if (!flags[process.argv[i]] || process.argv[i + 1] === undefined || options[flags[process.argv[i]]] !== undefined) throw error('INVALID_EXPLICIT_FLAGS'); options[flags[process.argv[i]]] = process.argv[i + 1]; }
    const result = await assembleDistributionRuntime(options);
    process.stdout.write(JSON.stringify({ runtimeDirectory: result.runtimeDirectory, dsh: result.dsh, manifestPath: result.manifestPath, manifestSha256: result.manifestSha256, ownership: result.ownership, corePackageCount: result.manifest.corePackageCount, externalPackageCount: result.manifest.externalPackageCount, publicReleaseQualified: false, lifecycleScriptsExecuted: false }) + '\n');
  } catch (cause) {
    const ioCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ENOTDIR', 'EIO', 'ENOMEM', 'ELOOP', 'ERR_ACCESS_DENIED']);
    const errorCategory = ownErrors.has(cause) || ioCodes.has(cause?.code) ? cause.code : 'ASSEMBLY_FAILED';
    const failureOutputPolicy = cause?.failureOutputPolicy === 'RETAINED_NO_AUTOMATIC_REMOVAL' ? cause.failureOutputPolicy : undefined;
    process.stderr.write(JSON.stringify({ errorCategory, failureOutputPolicy }) + '\n'); process.exitCode = 1;
  }
}
