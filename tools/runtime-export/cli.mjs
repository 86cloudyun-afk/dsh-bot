import * as fs from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { planRuntime, exportRuntime } from './export.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const args = {};
let reportPath, reportHandle, reportIdentity, artifact, reportPublished = false;
async function removeOwned(path, identity, directory = false) {
  if (!path || !identity) return;
  const current = await fs.lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (current?.ino !== identity.ino || current?.dev !== identity.dev || !(directory ? current.isDirectory() : current.isFile())) return;
  if (directory) await fs.rm(path, { recursive: true, force: true });
  else await fs.unlink(path);
}
try {
  const accepted = new Set(['--source', '--identity', '--roots', '--report', '--output']);
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!accepted.has(process.argv[i]) || !process.argv[i + 1] || args[process.argv[i]]) throw Error('INVALID_ARGUMENTS');
    args[process.argv[i]] = process.argv[i + 1];
  }
  for (const k of ['--source', '--identity', '--roots', '--report']) if (!args[k] || !isAbsolute(args[k])) throw Error('EXPLICIT_ABSOLUTE_INPUTS_REQUIRED');
  const source = await fs.realpath(args['--source']); reportPath = resolve(args['--report']);
  if (reportPath === source || reportPath.startsWith(source + sep) || await fs.realpath(dirname(reportPath)) !== dirname(reportPath)) throw Error('EXCLUSIVE_CANONICAL_REPORT_REQUIRED');
  if (args['--output']) {
    if (!isAbsolute(args['--output'])) throw Error('ABSOLUTE_OUTPUT_REQUIRED');
    const output = resolve(args['--output']);
    if (reportPath === output || reportPath.startsWith(output + sep) || output.startsWith(reportPath + sep)) throw Error('REPORT_OUTPUT_PATH_CONFLICT');
  }
  // Claim the report before exporting; existing caller entries are never opened for writing.
  reportHandle = await fs.open(reportPath, 'wx', 0o600); reportIdentity = await reportHandle.stat();
  const identity = JSON.parse(await fs.readFile(args['--identity'], 'utf8')); const roots = JSON.parse(await fs.readFile(args['--roots'], 'utf8'));
  const raw = await fs.readFile(join(source, 'pnpm-lock.yaml')); const file = identity.sourceFiles?.find(x => x.path === 'pnpm-lock.yaml');
  if (!file || file.sha256 !== sha(raw) || file.bytes !== raw.length) throw Error('SOURCE_LOCK_IDENTITY_REQUIRED');
  let lock, parser;
  if (raw.toString().trimStart().startsWith('{')) { lock = JSON.parse(raw); parser = 'JSON subset of YAML'; }
  else {
    // The parser is an already installed public dependency of this fixed source tree.
    // No dependency installation or application package import occurs here.
    const req = createRequire(join(source, 'apps/cli/package.json'));
    if (req('js-yaml/package.json').version !== '4.2.0') throw Error('LOCKED_YAML_PARSER_VERSION_REQUIRED');
    lock = req('js-yaml').load(raw.toString()); parser = 'js-yaml4.2.0';
  }
  if (String(lock.lockfileVersion) !== '9.0' && String(lock.lockfileVersion) !== '9') throw Error('PNPM_LOCK_VERSION_REQUIRED');
  const plan = await planRuntime({ sourceRoot: source, roots, identity, lock });
  if (args['--output'] && !plan.issues.length) artifact = await exportRuntime({ plan, outputDirectory: args['--output'] });
  const report = { format: 1, classification: 'B_SOURCE_BUILD_OVERLAY_PREFLIGHT', parser, sourceLockSha256: sha(raw), sourceIdentityVerified: !plan.issues.some(x => x.code.startsWith('SOURCE_IDENTITY')), roots: plan.roots, platform: plan.platform, arch: plan.arch, corePackageCount: plan.packages.length, externalLockedSnapshotCount: plan.externalPackages.length,
    exported: Boolean(artifact), issues: plan.issues, packages: plan.packages.map(({ absolute, ...x }) => x), externalPackages: plan.externalPackages, skipped: plan.skipped,
    legacyConsumerCompatibility: { status: 'RED', releaseCommit: '3e57f2385d7fa5495e6277c4b1dbe03c046c7b32', assemblerSourceSha256: '8bd5a84631a6011d2c3b594c5427a7625b3c56a2129f06c7a8004ef624eca4a8', requiresCandidateCommit: '3fbedc25d3626caf4e401b14c31a7f0326a19ec7', requiresDeclaredCount: 74, requiresActualCount: 75, newManifestFormat: 2, note: 'A must separately design/test source identity and computed closure compatibility; existing guards unchanged' },
    ...(artifact ? { artifactManifestSha256: sha(JSON.stringify(artifact.manifest, null, 2) + '\n') } : {}) };
  await reportHandle.writeFile(JSON.stringify(report, null, 2) + '\n');
  await reportHandle.close(); reportHandle = null; reportPublished = true;
  process.stdout.write(JSON.stringify({ corePackageCount: report.corePackageCount, externalLockedSnapshotCount: report.externalLockedSnapshotCount, issueCount: report.issues.length, exported: report.exported, legacyConsumerCompatibility: 'RED', ...(report.artifactManifestSha256 ? { artifactManifestSha256: report.artifactManifestSha256 } : {}) }) + '\n');
  process.exitCode = plan.issues.length ? 1 : 0;
} catch (error) {
  if (reportHandle) await reportHandle.close().catch(() => {});
  let cleanupErrorCategory = error.cleanupErrorCategory;
  if (reportHandle && !reportIdentity) cleanupErrorCategory ??= 'REPORT_OWNERSHIP_UNAVAILABLE';
  if (!reportPublished) {
    for (const [path, identity, directory] of [[artifact?.outputDirectory, artifact?.ownership, true], [reportPath, reportIdentity, false]]) {
      try { await removeOwned(path, identity, directory); }
      catch (cleanupError) { cleanupErrorCategory ??= cleanupError.code ?? cleanupError.message; }
    }
  }
  process.stderr.write(JSON.stringify({ errorCategory: error.code ?? error.message, ...(cleanupErrorCategory ? { cleanupErrorCategory } : {}) }) + '\n'); process.exitCode = 1;
}
