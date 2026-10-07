"""Prepare and compile an exact supported native Host target without private Home, credentials, or retained outputs."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, tarfile, urllib.request, datetime, platform

parser = argparse.ArgumentParser()
parser.add_argument('--target', choices=['linux-x64','darwin-arm64'], required=True, help='Must exactly match the actual operating system and architecture')
parser.add_argument('--source', type=Path, required=True, help='Exclusive new source directory')
parser.add_argument('--evidence', type=Path, required=True, help='Exclusive new command/evidence directory')
parser.add_argument('--source-packet', type=Path, required=True, help='Verified original private snapshots plus the verified owned-generation M0, M1 and M2 deltas')
parser.add_argument('--materials', type=Path, help='Prepared public dependency material directory; required for offline mode')
parser.add_argument('--expected-materials-sha256', help='Caller trusted MATERIALS.json SHA-256; required with --materials')
parser.add_argument('--public-source', type=Path, help='Verified public Git object repository for offline reproduction')
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
actual_target = 'linux-x64' if platform.system() == 'Linux' and platform.machine() in ['x86_64','AMD64'] else 'darwin-arm64' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else None
if args.target != actual_target:
    raise SystemExit('Target must match the actual supported platform and architecture')
if args.offline and args.target != 'linux-x64':
    raise SystemExit('Offline dependency materials are qualified for Linux x64 only')
base = '639ed015397290b3745d163aafe02ffee4aa3f84'
recipe = Path(__file__).resolve().parent
source, evidence, packet = args.source.resolve(), args.evidence.resolve(), args.source_packet.resolve()
materials = args.materials.resolve() if args.materials else None
if source.exists() or evidence.exists():
    raise SystemExit('Source and evidence directories must not already exist')
public_source = args.public_source.resolve() if args.public_source else (materials/'public-base.bundle' if args.offline and materials else None)
if args.offline and (materials is None or public_source is None):
    raise SystemExit('Offline mode requires public dependency material files and verified public source')
if materials is not None:
    manifest_bytes = (materials / 'MATERIALS.json').read_bytes()
    actual = hashlib.sha256(manifest_bytes).hexdigest()
    if not args.expected_materials_sha256 or actual != args.expected_materials_sha256:
        raise SystemExit('Caller trusted material manifest SHA-256 required')
    for item in json.loads(manifest_bytes)['files']:
        rel = Path(item['path'])
        if rel.is_absolute() or '..' in rel.parts:
            raise SystemExit('Unsafe material path')
        path = materials / rel
        if path.is_symlink() or not path.is_file():
            raise SystemExit('Non-file material input')
        with path.open('rb') as inp:
            got = hashlib.file_digest(inp, 'sha256').hexdigest()
        if got != item['sha256'] or path.stat().st_size != item['bytes']:
            raise SystemExit('Material digest mismatch: ' + item['path'])
os.umask(0o077)
evidence.mkdir(parents=True, mode=0o700)
build_home = evidence / 'prepare-home'
build_home.mkdir(mode=0o700)
environment = os.environ.copy()
for name in ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'DSH_HOME']:
    environment.pop(name, None)
environment.update(HOME=str(build_home), XDG_CONFIG_HOME=str(build_home / 'config'), CI='true')
commands = []
def run(label, command, cwd):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (evidence / (label + '.log')).open('w') as out:
        completed = subprocess.run([str(part) for part in command], cwd=cwd, env=environment, stdout=out, stderr=subprocess.STDOUT)
    item = {'label':label, 'args':[str(part) for part in command], 'cwd':str(cwd), 'startedUTC':started,
            'endedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode':completed.returncode}
    commands.append(item)
    (evidence / 'prepare-commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    print(json.dumps({'label':label,'exitCode':completed.returncode}), flush=True)
    if completed.returncode != 0:
        raise SystemExit('Command failed: ' + label + '; inspect ' + str(evidence / (label + '.log')))
if public_source:
    if public_source.is_file():
        heads = subprocess.check_output(['git','bundle','list-heads',str(public_source)],text=True).splitlines()
        if not any(line.split()[0] == base for line in heads):
            raise SystemExit('Pinned public Git bundle commit missing')
        run('public-clone',['git','clone','--no-checkout',str(public_source),str(source)],source.parent)
    else:
        pinned = subprocess.check_output(['git','-C',str(public_source),'rev-parse',base],text=True).strip()
        if pinned != base:
            raise SystemExit('Pinned public Git commit missing')
        run('public-clone',['git','clone','--no-checkout','--shared',str(public_source),str(source)],source.parent)
else:
    run('public-clone', ['git','clone','--no-checkout','--filter=blob:none','https://github.com/deepseek-ai/deepseek-harness.git',str(source)], source.parent)
run('public-checkout', ['git','checkout','--detach',base], source)
checks = []
for name, prefix in [('host-source-transfer-manifest.json','current-related-source'),
                     ('host-consumption-supplement/supplement-manifest.json','host-consumption-supplement/source')]:
    manifest = json.loads((packet / name).read_text())
    if manifest['publicBaseCommit'] != base:
        raise SystemExit('Public baseline manifest mismatch')
    for item in manifest['files']:
        rel = Path(item['path'])
        if rel.is_absolute() or '..' in rel.parts:
            raise SystemExit('Unsafe source packet path')
        original = packet / prefix / rel
        data = original.read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['bytes']:
            raise SystemExit('Source packet digest mismatch: ' + str(rel))
        target = source / rel
        if 'publicBaseSha256' in item:
            public_hash = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
            if public_hash != item['publicBaseSha256']:
                raise SystemExit('Public source digest mismatch: ' + str(rel))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        checks.append({'path':item['path'],'sha256':item['sha256'],'bytes':len(data),'pass':True})
delta_manifest = packet / 'generation-delta/manifest.json'
delta_bytes = delta_manifest.read_bytes()
if hashlib.sha256(delta_bytes).hexdigest() != '364d9eaadef1510361b75a8f75a9f5813d39b48eaba936a80b7ffbd48eb179e8':
    raise SystemExit('Pinned generation M0 delta transport mismatch')
for item in json.loads(delta_bytes)['files']:
    rel = Path(item['path'])
    if rel.is_absolute() or '..' in rel.parts:
        raise SystemExit('Unsafe generation delta source path')
    data = (packet / 'generation-delta/source' / rel).read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['bytes']:
        raise SystemExit('Generation delta source digest mismatch: ' + str(rel))
    target = source / rel
    previous = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if previous != item['previousSha256']:
        raise SystemExit('Generation delta predecessor mismatch: ' + str(rel))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    checks.append({'path':item['path'],'sha256':item['sha256'],'bytes':len(data),'pass':True,'generationDelta':True})
delta_manifest = packet / 'generation-m1-delta/manifest.json'
delta_bytes = delta_manifest.read_bytes()
if hashlib.sha256(delta_bytes).hexdigest() != 'ea9d0f8c52adb43710f0b0655de4552cc1d17f2973db6441e5ba53072b630bb3':
    raise SystemExit('Pinned generation M1 delta transport mismatch')
for item in json.loads(delta_bytes)['files']:
    rel = Path(item['path'])
    if rel.is_absolute() or '..' in rel.parts:
        raise SystemExit('Unsafe generation M1 delta path')
    data = (packet / 'generation-m1-delta/source' / rel).read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['bytes']:
        raise SystemExit('Generation M1 source digest mismatch: ' + str(rel))
    target = source / rel
    previous = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if previous != item['previousSha256']:
        raise SystemExit('Generation M1 predecessor mismatch: ' + str(rel))
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    checks.append({'path':item['path'],'sha256':item['sha256'],'bytes':len(data),'pass':True,'milestone':'M1'})
delta_manifest = packet / 'generation-m2-delta/manifest.json'
delta_bytes = delta_manifest.read_bytes()
if hashlib.sha256(delta_bytes).hexdigest() != '459c9fbb18b04fb39e69c08f09b06e73bff41f2805f4f446c4f8360f2947e0c4':
    raise SystemExit('Pinned generation M2 delta transport mismatch')
for item in json.loads(delta_bytes)['files']:
    rel = Path(item['path'])
    if rel.is_absolute() or '..' in rel.parts:
        raise SystemExit('Unsafe generation M2 delta path')
    data = (packet / 'generation-m2-delta/source' / rel).read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['bytes']:
        raise SystemExit('Generation M2 source digest mismatch: ' + str(rel))
    target = source / rel
    previous = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if previous != item['previousSha256']:
        raise SystemExit('Generation M2 predecessor mismatch: ' + str(rel))
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    checks.append({'path':item['path'],'sha256':item['sha256'],'bytes':len(data),'pass':True,'milestone':'M2'})
(evidence / 'source-verification.json').write_text(json.dumps({'checks':checks,'pass':True,'snapshotOnly':True},indent=2)+'\n')
tool = source / '.tools'
download = tool / 'downloads'
download.mkdir(parents=True)
archives = [('node-v24.19.0-'+args.target+'.tar.xz','https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz','14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647'),
            ('musl-1.2.5.tar.gz','https://musl.libc.org/releases/musl-1.2.5.tar.gz','a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4')] if args.target == 'linux-x64' else [
            ('node-v24.19.0-darwin-arm64.tar.gz','https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz','8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d')]
for name,url,expected in archives:
    target = download / name
    if materials is not None:
        shutil.copyfile(materials / 'downloads' / name, target)
    else:
        with urllib.request.urlopen(url, timeout=180) as response, target.open('wb') as out:
            shutil.copyfileobj(response,out)
    with target.open('rb') as inp:
        actual = hashlib.file_digest(inp,'sha256').hexdigest()
    if actual != expected:
        raise SystemExit('Pinned public tool archive digest mismatch: ' + name)
    # musl source uses reviewed symlinks; archives are hash-pinned before extraction.
    with tarfile.open(target) as archive:
        archive.extractall(tool, filter='tar')
node_directory = tool / ('node-v24.19.0-'+args.target)
node = node_directory / 'bin/node'
environment['PATH'] = ':'.join([str(node_directory/'bin'),str(tool/'musl/bin'),str(source/'node_modules/.bin'),environment['PATH']])
bootstrap = tool / 'bootstrap'
bootstrap.mkdir()
for name in ['package.json','package-lock.json']:
    shutil.copyfile(recipe / 'bootstrap' / name, bootstrap / name)
if materials is not None:
    npm_cache = tool / 'npm-cache'
    shutil.copytree(materials / 'npm-cache', npm_cache)
    shutil.copytree(materials / 'pnpm-store', tool / 'pnpm-store')
    metadata = materials / 'pnpm-metadata'
    for name in ['metadata','metadata-full']:
        shutil.copytree(metadata / name, build_home / '.cache/pnpm/v11' / name)
else:
    npm_cache = tool / 'npm-cache'
npm_arguments = [node,node_directory/'lib/node_modules/npm/bin/npm-cli.js','ci','--prefix',bootstrap,'--ignore-scripts','--no-audit','--no-fund','--cache',npm_cache]
if args.offline:
    npm_arguments.append('--offline')
run('bootstrap-install',npm_arguments,source)
if args.target == 'linux-x64':
    run('musl-configure',['./configure','--prefix='+str(tool/'musl'),'--disable-shared'],tool/'musl-1.2.5')
    run('musl-build',['make','-j4'],tool/'musl-1.2.5')
    run('musl-install',['make','install'],tool/'musl-1.2.5')
pnpm = [node,bootstrap/'node_modules/pnpm/bin/pnpm.cjs']
rows = json.loads((recipe / 'historical-packages-projection.json').read_text())
if args.target == 'darwin-arm64':
    for index,row in enumerate(rows):
        if row['name'] == '@deepseek-ai/node-addon-system-linux-x64':
            rows[index] = {'name':'@deepseek-ai/node-addon-system-darwin-arm64','version':row['version'],
                          'sourcePath':'native/system/packages/darwin-arm64','platformAdaptedFrom':row['name'],
                          'historicalBinaryIdentityClaimed':False,
                          'pkgJSON':hashlib.sha256((source/'native/system/packages/darwin-arm64/package.json').read_bytes()).hexdigest()}
(evidence/'historical-packages-projection.json').write_text(json.dumps(rows,indent=2)+'\n')
for row in rows:
    pnpm += ['--filter',row['name']+'...']
pnpm += ['--filter','@deepseek-ai/dsh-typert-generator...','--filter','@deepseek-ai/dsh-tool-cordis...',
         '--filter','@deepseek-ai/dsh-root...','--filter','@deepseek-ai/node-addon-system-workspace...',
         'install','--frozen-lockfile','--ignore-scripts','--store-dir',tool/'pnpm-store']
if args.offline:
    pnpm.append('--offline')
run('source-dependency-install',pnpm,source)
for name in ['cold-build.mjs','source-identity.mjs','overlay-receipt.json','generation-delta.json','prepare-cold.py','offline-tests.py','bootstrap/package.json','bootstrap/package-lock.json']:
    (evidence / name).parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(recipe / name,evidence / name)
run('cold-build',[node,evidence/'cold-build.mjs',source,evidence],source)
run('source-identity',[node,evidence/'source-identity.mjs',source,evidence],source)
run('core-export',[node,recipe/'export-tool/cli.mjs','--source',source,'--identity',evidence/'source-identity.json',
                   '--roots',evidence/'roots-runtime.json','--report',evidence/'runtime-export-report.json',
                   '--output',evidence/'core-overlay'],source)
receipt={'offline':args.offline,'sourceSnapshotChecks':len(checks),'retainedRuntimeCopied':False,
         'privateHomeOrCredentialsCopied':False,'freshPublicDependencyMaterialsUsed':bool(materials),
         'modelsRequested':False,'target':args.target,'targetMatchedActualHost':True,'crossCompiled':False,'commands':commands}
(evidence/'prepare-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'prepared':True,'coreOverlay':str(evidence/'core-overlay'),'offline':args.offline}),flush=True)
