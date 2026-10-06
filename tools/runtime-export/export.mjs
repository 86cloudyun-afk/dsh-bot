import * as fs from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const inside = (root, path) => path === root || path.startsWith(root + sep);
const safeRelative = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !path.split(/[\\/]/).some(p => p === '..' || p === '.' || p === '');
const prohibited = path => path.split(/[\\/]/).some(p => p === 'node_modules' || p === '.git' || p === '.env' || p.startsWith('.env.') || p === '.aws' || p === '.codex' || p === '.agents');
const packageName = name => typeof name === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name);
const slot = name => name.replace('/', '+');
const sorted = values => [...values].sort();
function verifiedPeerRange(range, version) {
  if (range === version) return true;
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!v) return false;
  if (range === '*') return true;
  const r = /^([~^])(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!r) return false; // Unsupported ranges remain RED rather than assumed compatible.
  const value = v.slice(1).map(Number), lower = r.slice(2).map(Number);
  const compare = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
  const upper = r[1] === '~' ? [lower[0], lower[1]+1, 0]
    : lower[0] ? [lower[0]+1, 0, 0] : lower[1] ? [0, lower[1]+1, 0] : [0, 0, lower[2]+1];
  return compare(value, lower) >= 0 && compare(value, upper) < 0;
}
const plans = new WeakSet();
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
async function canonicalFile(path) { const stat = await fs.lstat(path); return stat.isFile() && !stat.isSymbolicLink() && await fs.realpath(path) === path; }
async function checkSourceIdentity(root, identity) {
  for (const file of identity.sourceFiles) {
    try { const path = join(root, file.path); if (!await canonicalFile(path)) return false; const bytes = await fs.readFile(path); if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes) return false; }
    catch { return false; }
  }
  return true;
}
const readJson = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const compatible = (meta, platform, arch) => {
  const accepts = (list, value) => !list || ((!list.includes('!' + value)) && (list.every(x => x.startsWith('!')) || list.includes(value)));
  return accepts(meta.os, platform) && accepts(meta.cpu, arch);
};
function patternRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++; if (pattern[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if ('[]{}!'.includes(c)) throw fail('UNSUPPORTED_PUBLISH_PATTERN');
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}
async function walk(root, at = '', result = [], options = {}) {
  for (const item of await fs.readdir(join(root, at), { withFileTypes: true })) {
    const path = at ? at + '/' + item.name : item.name;
    if (prohibited(path) && options.skipForbidden !== false) continue;
    if (item.isDirectory()) { if (options.directories) result.push({ path, directory: true }); await walk(root, path, result, options); }
    else result.push({ path, symbolic: item.isSymbolicLink() });
  }
  return result;
}
async function payload(record, issues) {
  const issue = (code, path) => issues.push({ code, package: record.name, path });
  if (!Array.isArray(record.meta.files) || record.meta.files.length === 0) { issue('PUBLISH_FILES_REQUIRED'); return []; }
  const available = await walk(record.absolute);
  const selected = new Set(['package.json']);
  for (const value of record.meta.files) {
    if (typeof value !== 'string') { issue('INVALID_PUBLISH_PATTERN'); continue; }
    const exclude = value.startsWith('!'); const clean = (exclude ? value.slice(1) : value).replace(/\/$/, '');
    if (!safeRelative(clean) || prohibited(clean)) { issue('UNSAFE_PUBLISH_PATTERN', value); continue; }
    let matches;
    try {
      const regexp = patternRegex(clean);
      matches = available.filter(x => regexp.test(x.path) || x.path.startsWith(clean + '/') || x.path.split('/').slice(0, -1).some((_, i) => regexp.test(x.path.split('/').slice(0, i + 1).join('/'))));
    } catch (error) { issue(error.code, value); continue; }
    if (!exclude && matches.length === 0) issue('DECLARED_FILE_MISSING', value);
    for (const file of matches) exclude ? selected.delete(file.path) : selected.add(file.path);
  }
  // Publication identity and root license/notice are included only when present.
  for (const file of available) if (/^(?:LICENSE|COPYING|NOTICE|README)(?:\..*)?$/i.test(file.path)) selected.add(file.path);
  const entries = [];
  for (const path of sorted(selected)) {
    const absolute = join(record.absolute, path); const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(absolute) !== absolute) { issue('PAYLOAD_SYMLINK_REFUSED', path); continue; }
    if (stat.mode & 0o7000) { issue('PAYLOAD_SPECIAL_MODE_REFUSED', path); continue; }
    const bytes = await fs.readFile(absolute);
    entries.push({ path, bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 });
  }
  const expected = [];
  if (typeof record.meta.main === 'string') expected.push(record.meta.main);
  if (typeof record.meta.types === 'string') expected.push(record.meta.types);
  if (typeof record.meta.bin === 'string') expected.push(record.meta.bin);
  else expected.push(...Object.values(record.meta.bin ?? {}));
  const exports = value => {
    if (typeof value === 'string' && !value.includes('*')) expected.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(exports);
  };
  exports(record.meta.exports);
  for (const value of expected) {
    const path = value.replace(/^\.\//, '');
    if (!safeRelative(path) || !entries.some(x => x.path === path)) issue('RUNTIME_ENTRY_MISSING', path);
  }
  if (entries.some(x => x.path === 'prebuilds.json')) {
    try {
      const native = await readJson(join(record.absolute, 'prebuilds.json'));
      if (!Array.isArray(native.binaries)) issue('NATIVE_BINARY_MANIFEST_INVALID', 'prebuilds.json');
      else for (const binary of native.binaries) if (!safeRelative(binary.path) || !entries.some(x => x.path === binary.path)) issue('NATIVE_BINARY_MISSING', binary.path);
    } catch { issue('NATIVE_BINARY_MANIFEST_INVALID', 'prebuilds.json'); }
  }
  return entries;
}
export async function planRuntime({ sourceRoot, lock, roots, identity, platform = process.platform, arch = process.arch }) {
  const root = await fs.realpath(sourceRoot); const issues = []; const skipped = [];
  const issue = (code, details = {}) => issues.push({ code, ...details });
  const commits = ['publicBaseCommit', 'sourceMaterialCommit', 'supplementCommit', 'declaredLocalHead'];
  const sourcePaths = new Set();
  if (!identity || !commits.every(k => /^[a-f0-9]{40}$/.test(identity[k] ?? '')) || identity.sourceMode !== 'public-base-plus-verified-overlay' || !Array.isArray(identity.sourceFiles) || identity.sourceFiles.length === 0) {
    issue('SOURCE_IDENTITY_REQUIRED');
  } else for (const file of identity.sourceFiles) {
    if (sourcePaths.has(file.path)) issue('SOURCE_IDENTITY_DUPLICATE', { path: file.path });
    sourcePaths.add(file.path);
    if (!safeRelative(file.path) || prohibited(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) { issue('SOURCE_IDENTITY_PATH_INVALID', { path: file.path }); continue; }
    try {
      const path = join(root, file.path); const stat = await fs.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(path) !== path) { issue('SOURCE_IDENTITY_MISMATCH', { path: file.path }); continue; }
      const bytes = await fs.readFile(path);
      if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes) issue('SOURCE_IDENTITY_MISMATCH', { path: file.path });
    } catch { issue('SOURCE_IDENTITY_MISMATCH', { path: file.path }); }
  }
  if (!lock?.importers || !lock.packages || !lock.snapshots) throw fail('PNPM_LOCK_SCHEMA_REQUIRED');
  const indexed = new Map();
  for (const [folder, importer] of Object.entries(lock.importers)) {
    if (folder === '.') continue;
    if (!safeRelative(folder) || prohibited(folder)) { issue('IMPORTER_PATH_INVALID', { path: folder }); continue; }
    try {
      const absolute = join(root, folder); if (await fs.realpath(absolute) !== absolute) { issue('IMPORTER_SYMLINK_REFUSED', { path: folder }); continue; }
      const meta = await readJson(join(absolute, 'package.json'));
      if (!packageName(meta.name) || typeof meta.version !== 'string') { issue('PACKAGE_IDENTITY_INVALID', { path: folder }); continue; }
      if (indexed.has(meta.name)) { issue('DUPLICATE_WORKSPACE_PACKAGE', { package: meta.name }); continue; }
      indexed.set(meta.name, { name: meta.name, path: folder, absolute, meta, importer });
    } catch (error) { issue('IMPORTER_PACKAGE_UNAVAILABLE', { path: folder, reason: error.code ?? error.name }); }
  }
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every(packageName)) throw fail('EXPLICIT_PACKAGE_ROOTS_REQUIRED');
  const selected = new Map(), external = new Map(), pending = sorted(new Set(roots));
  function addExternal(name, reference, from, optional = false) {
    const key = name + '@' + reference;
    const metadataKey = name + '@' + reference.replace(/\(.*/, '');
    const meta = lock.packages[key] ?? lock.packages[metadataKey]; const snapshot = lock.snapshots[key];
    if (!meta || !snapshot) { issue('EXTERNAL_LOCK_ENTRY_REQUIRED', { package: from, dependency: name, reference }); return; }
    if (!compatible(meta, platform, arch)) {
      if (optional) skipped.push({ package: from, dependency: name, reason: 'PLATFORM_OPTIONAL' });
      else issue('REQUIRED_DEPENDENCY_PLATFORM_MISMATCH', { package: from, dependency: name });
      return;
    }
    if (external.has(key)) return;
    const integrity = meta.resolution?.integrity;
    if (typeof integrity !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(integrity)) issue('EXTERNAL_INTEGRITY_REQUIRED', { package: from, dependency: name, reference });
    external.set(key, { name, reference, integrity: integrity ?? null, lockPackageKey: metadataKey, dependencies: snapshot.dependencies ?? {}, optionalDependencies: snapshot.optionalDependencies ?? {} });
    for (const [dep, range] of Object.entries(meta.peerDependencies ?? {})) if (!meta.peerDependenciesMeta?.[dep]?.optional) {
      const resolved = snapshot.dependencies?.[dep];
      if (!resolved) issue('EXTERNAL_PEER_RESOLUTION_REQUIRED', { package: key, dependency: dep });
      else if (!verifiedPeerRange(range, resolved.replace(/\(.*/, ''))) issue('EXTERNAL_PEER_VERSION_NOT_VERIFIED', { package: key, dependency: dep, range, resolved });
    }
    for (const [dep, ref] of Object.entries(snapshot.dependencies ?? {})) addExternal(dep, ref, key);
    for (const [dep, ref] of Object.entries(snapshot.optionalDependencies ?? {})) addExternal(dep, ref, key, true);
  }
  for (let i = 0; i < pending.length; i++) {
    const name = pending[i]; if (selected.has(name)) continue;
    const item = indexed.get(name);
    if (!item) { issue('UNRESOLVED_REQUIRED_DEPENDENCY', { dependency: name }); continue; }
    if (!compatible(item.meta, platform, arch)) { issue('REQUIRED_DEPENDENCY_PLATFORM_MISMATCH', { dependency: name }); continue; }
    selected.set(name, item);
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dep, specifier] of Object.entries(item.meta[section] ?? {})) {
        if (section === 'peerDependencies' && item.meta.peerDependenciesMeta?.[dep]?.optional) { skipped.push({ package: name, dependency: dep, reason: 'OPTIONAL_PEER' }); continue; }
        const optional = section === 'optionalDependencies'; const workspace = indexed.get(dep);
        if (workspace) {
          if (!compatible(workspace.meta, platform, arch) && optional) { skipped.push({ package: name, dependency: dep, reason: 'PLATFORM_OPTIONAL' }); continue; }
          if (section !== 'peerDependencies') {
            const binding = item.importer[section]?.[dep];
            if (!binding) { issue('LOCK_DEPENDENCY_REQUIRED', { package: name, dependency: dep }); continue; }
            const override = lock.overrides?.[dep];
            const verifiedOverride = typeof override === 'string' && override.startsWith('link:') && resolve(root, override.slice(5)) === workspace.absolute && typeof binding.specifier === 'string' && binding.specifier.startsWith('link:') && resolve(item.absolute, binding.specifier.slice(5)) === workspace.absolute;
            if (binding.specifier !== specifier && !verifiedOverride) issue('LOCK_SPECIFIER_MISMATCH', { package: name, dependency: dep });
            if (!binding.version?.startsWith('link:') || resolve(item.absolute, binding.version.slice(5)) !== workspace.absolute) issue('WORKSPACE_LINK_MISMATCH', { package: name, dependency: dep });
          } else {
            const range = specifier.replace(/^workspace:/, '');
            if (!['*', '^', '~', workspace.meta.version, '^' + workspace.meta.version, '~' + workspace.meta.version].includes(range)) issue('PEER_VERSION_NOT_VERIFIED', { package: name, dependency: dep, specifier });
          }
          pending.push(dep);
        } else if (specifier.startsWith('workspace:') || specifier.startsWith('link:')) {
          if (optional) skipped.push({ package: name, dependency: dep, reason: 'OPTIONAL_WORKSPACE_UNAVAILABLE' });
          else issue('UNRESOLVED_REQUIRED_DEPENDENCY', { package: name, dependency: dep });
        } else {
          const binding = item.importer[section]?.[dep] ?? (section === 'peerDependencies' ? item.importer.dependencies?.[dep] ?? item.importer.devDependencies?.[dep] : undefined);
          if (!binding) { issue('LOCK_DEPENDENCY_REQUIRED', { package: name, dependency: dep }); continue; }
          if (binding.specifier !== specifier) issue('LOCK_SPECIFIER_MISMATCH', { package: name, dependency: dep });
          if (section === 'peerDependencies' && (typeof binding.version !== 'string' || !verifiedPeerRange(specifier, binding.version.replace(/\(.*/, '')))) issue('EXTERNAL_PEER_VERSION_NOT_VERIFIED', { package: name, dependency: dep, range: specifier, resolved: binding.version });
          addExternal(dep, binding.version, name, optional);
        }
      }
    }
  }
  const packages = [];
  for (const item of [...selected.values()].sort((a, b) => a.name.localeCompare(b.name))) packages.push({ name: item.name, version: item.meta.version, sourcePath: item.path, absolute: item.absolute, slot: slot(item.name), files: await payload(item, issues) });
  const plan = freeze({ sourceRoot: root, roots: sorted(new Set(roots)), identity: structuredClone(identity), platform, arch, packages, externalPackages: [...external.values()].sort((a, b) => (a.name + a.reference).localeCompare(b.name + b.reference)), skipped, issues, lockSha256: sha(JSON.stringify(lock)) });
  plans.add(plan); return plan;
}
export async function exportRuntime({ plan, outputDirectory }) {
  if (!plans.has(plan)) throw fail('INVALID_EXPORT_PLAN');
  if (plan.issues.length) throw fail('EXPORT_PLAN_RED');
  if (!isAbsolute(outputDirectory)) throw fail('ABSOLUTE_OUTPUT_REQUIRED');
  const out = resolve(outputDirectory);
  if (inside(plan.sourceRoot, out) || inside(out, plan.sourceRoot)) throw fail('EXCLUSIVE_OUTPUT_REQUIRED');
  if (await fs.realpath(dirname(out)) !== dirname(out)) throw fail('CANONICAL_OUTPUT_PARENT_REQUIRED');
  if (!await checkSourceIdentity(plan.sourceRoot, plan.identity)) throw fail('SOURCE_IDENTITY_CHANGED');
  // Claim the destination exclusively; rename must never replace another writer's directory.
  try { await fs.mkdir(out, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw fail('OUTPUT_ALREADY_EXISTS'); throw error; }
  let claimed; const staging = out;
  try {
    claimed = await fs.stat(out);
    const allFiles = [];
    for (const item of plan.packages) for (const file of item.files) {
      const source = join(item.absolute, file.path); const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7000) || await fs.realpath(source) !== source) throw fail('INPUT_CHANGED_AFTER_PLAN');
      const bytes = await fs.readFile(source); if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes) throw fail('INPUT_CHANGED_AFTER_PLAN');
      const path = '.packages/' + item.slot + '/' + file.path;
      await fs.mkdir(dirname(join(staging, path)), { recursive: true });
      await fs.writeFile(join(staging, path), bytes, { flag: 'wx', mode: file.mode }); await fs.chmod(join(staging, path), file.mode);
      allFiles.push({ path, bytes: file.bytes, sha256: file.sha256, mode: file.mode });
    }
    const sourceIdentity = { ...plan.identity }; delete sourceIdentity.sourceFiles;
    const manifest = { format: 2, classification: 'PRIVATE_SOURCE_BUILD_OVERLAY_NOT_STANDALONE_RUNTIME', sourceIdentity, sourceFileIndexSha256: sha(JSON.stringify(plan.identity.sourceFiles)), verifiedSourceFileCount: plan.identity.sourceFiles.length,
      lockObjectSha256: plan.lockSha256, platform: plan.platform, arch: plan.arch, roots: plan.roots, corePackageCount: plan.packages.length, sourceAliases: false, externalDependenciesIncluded: false,
      packages: plan.packages.map(({ absolute, files, ...item }) => ({ ...item, packageJsonSha256: files.find(x => x.path === 'package.json').sha256 })), externalPackages: plan.externalPackages, skipped: plan.skipped,
      files: allFiles.sort((a, b) => a.path.localeCompare(b.path)), executableBytesAltered: false };
    await fs.writeFile(join(staging, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (!await checkSourceIdentity(plan.sourceRoot, plan.identity)) throw fail('SOURCE_IDENTITY_CHANGED');
    await verifyRuntime({ directory: staging });
    return { manifest, outputDirectory: out, ownership: Object.freeze({ ino: claimed.ino, dev: claimed.dev }) };
  } catch (error) {
    if (!claimed) error.cleanupErrorCategory = 'ARTIFACT_OWNERSHIP_UNAVAILABLE';
    else {
      try { const current = await fs.lstat(staging); if (current.isDirectory() && current.ino === claimed.ino && current.dev === claimed.dev) await fs.rm(staging, { recursive: true, force: true }); }
      catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanupErrorCategory = cleanupError.code ?? cleanupError.message; }
    }
    throw error;
  }
}
export async function verifyRuntime({ directory, expectedManifestSha256 }) {
  const root = await fs.realpath(directory); const manifest = await readJson(join(root, 'artifact-manifest.json'));
  const manifestBytes = await fs.readFile(join(root, 'artifact-manifest.json'));
  if (expectedManifestSha256 !== undefined && sha(manifestBytes) !== expectedManifestSha256) throw fail('ARTIFACT_MANIFEST_HASH_MISMATCH');
  if (manifest.format !== 2 || manifest.classification !== 'PRIVATE_SOURCE_BUILD_OVERLAY_NOT_STANDALONE_RUNTIME' || manifest.sourceAliases !== false || manifest.externalDependenciesIncluded !== false || manifest.executableBytesAltered !== false || !Array.isArray(manifest.files) || !Array.isArray(manifest.packages) || !manifest.packages.length || manifest.corePackageCount !== manifest.packages.length || !Array.isArray(manifest.roots) || !manifest.roots.length || !manifest.roots.every(packageName) || !Array.isArray(manifest.externalPackages) || !Array.isArray(manifest.skipped)
    || !['publicBaseCommit', 'sourceMaterialCommit', 'supplementCommit', 'declaredLocalHead'].every(k => /^[a-f0-9]{40}$/.test(manifest.sourceIdentity?.[k] ?? '')) || manifest.sourceIdentity.sourceMode !== 'public-base-plus-verified-overlay' || !/^[a-f0-9]{64}$/.test(manifest.sourceFileIndexSha256 ?? '') || !/^[a-f0-9]{64}$/.test(manifest.lockObjectSha256 ?? '') || !Number.isSafeInteger(manifest.verifiedSourceFileCount) || manifest.verifiedSourceFileCount < 1) throw fail('ARTIFACT_MANIFEST_INVALID');
  const expected = new Set(['artifact-manifest.json']); const seen = new Set();
  const allowedSlots = new Set(manifest.packages.map(x => x.slot)); const expectedDirs = new Set(['.packages']);
  for (const file of manifest.files) {
    if (!safeRelative(file.path) || prohibited(file.path) || !file.path.startsWith('.packages/') || !allowedSlots.has(file.path.split('/')[1]) || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw fail('ARTIFACT_FILE_SET_MISMATCH');
    let parent = dirname(file.path); while (parent !== '.') { expectedDirs.add(parent); parent = dirname(parent); }
    expected.add(file.path); const path = join(root, file.path); const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(path) !== path) throw fail('ARTIFACT_FILE_SET_MISMATCH');
    const bytes = await fs.readFile(path);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256 || (stat.mode & 0o7777) !== file.mode) throw fail('ARTIFACT_HASH_MISMATCH');
  }
  const packageMetadata = new Map();
  for (const item of manifest.packages) {
    if (!packageName(item.name) || item.slot !== slot(item.name) || seen.has(item.name)) throw fail('ARTIFACT_PACKAGE_IDENTITY_INVALID');
    seen.add(item.name); const p = '.packages/' + item.slot + '/package.json';
    if (!expected.has(p)) throw fail('ARTIFACT_PACKAGE_IDENTITY_INVALID');
    const bytes = await fs.readFile(join(root, p)); const pkg = JSON.parse(bytes);
    if (pkg.name !== item.name || pkg.version !== item.version || sha(bytes) !== item.packageJsonSha256) throw fail('ARTIFACT_PACKAGE_IDENTITY_INVALID');
    if (pkg.main !== undefined) {
      const main = typeof pkg.main === 'string' ? pkg.main.replace(/^\.\//, '') : '';
      if (!safeRelative(main) || prohibited(main) || !expected.has('.packages/' + item.slot + '/' + main)) throw fail('ARTIFACT_RUNTIME_ENTRY_MISSING');
    }
    packageMetadata.set(item.name, pkg);
  }
  if (manifest.roots.some(name => !packageMetadata.has(name))) throw fail('ARTIFACT_MANIFEST_INVALID');
  const externalKeys = new Set(); const externalNames = new Set();
  for (const item of manifest.externalPackages) {
    const key = item.name + '@' + item.reference;
    if (!packageName(item.name) || typeof item.reference !== 'string' || typeof item.lockPackageKey !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(item.integrity ?? '') || !item.dependencies || typeof item.dependencies !== 'object' || !item.optionalDependencies || typeof item.optionalDependencies !== 'object' || externalKeys.has(key)) throw fail('ARTIFACT_EXTERNAL_CLOSURE_INVALID');
    externalKeys.add(key); externalNames.add(item.name);
  }
  for (const item of manifest.externalPackages) for (const [name, ref] of Object.entries(item.dependencies)) if (!externalKeys.has(name + '@' + ref)) throw fail('ARTIFACT_EXTERNAL_CLOSURE_INVALID');
  for (const [name, pkg] of packageMetadata) for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) for (const [dep, range] of Object.entries(pkg[section] ?? {})) {
    if (section === 'peerDependencies' && pkg.peerDependenciesMeta?.[dep]?.optional) continue;
    if (section === 'optionalDependencies' && manifest.skipped.some(x => x.package === name && x.dependency === dep && x.reason.startsWith('PLATFORM_'))) continue;
    if (range.startsWith('workspace:') ? !packageMetadata.has(dep) : !packageMetadata.has(dep) && !externalNames.has(dep)) throw fail('ARTIFACT_DEPENDENCY_CLOSURE_INVALID');
    if (section === 'peerDependencies' && !packageMetadata.has(dep) && !manifest.externalPackages.filter(x => x.name === dep).every(x => verifiedPeerRange(range, x.reference.replace(/\(.*/, '')))) throw fail('ARTIFACT_PEER_VERSION_NOT_VERIFIED');
  }
  const actual = await walk(root, '', [], { skipForbidden: false, directories: true });
  if (actual.length !== expected.size + expectedDirs.size || actual.some(x => x.symbolic || (x.directory ? !expectedDirs.has(x.path) : !expected.has(x.path)))) throw fail('ARTIFACT_FILE_SET_MISMATCH');
  return { verified: true, verificationScope: 'internal integrity and declared closure; external bytes absent; source/build provenance requires caller pin', trustedManifestPinChecked: expectedManifestSha256 !== undefined, packageCount: manifest.packages.length, fileCount: manifest.files.length, manifestSha256: sha(manifestBytes) };
}
