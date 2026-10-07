"""Verify source-built macOS ARM64 flock and protected contracts in a fresh Home."""
from pathlib import Path
import argparse, datetime, json, os, platform, struct, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('MAC_HOST_PLATFORM_REQUIRED')
source, evidence = args.source.resolve(strict=True), args.evidence.resolve(strict=True)
home = evidence / 'offline-test-home'
home.mkdir(mode=0o700)
environment = os.environ.copy()
for name in ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'DSH_HOME']:
    environment.pop(name, None)
environment.update(HOME=str(home), XDG_CONFIG_HOME=str(home/'config'), CI='true')
node = source / '.tools/node-v24.19.0-darwin-arm64/bin/node'
payload = source / 'native/system/packages/darwin-arm64/bin/system.node'
raw = payload.read_bytes()
if len(raw) < 32 or raw[:4] != bytes.fromhex('cffaedfe'):
    raise SystemExit('MAC_NATIVE_PAYLOAD_MACHO_REQUIRED')
cpu, subtype, filetype = struct.unpack_from('<III', raw, 4)
if cpu != 0x0100000c or filetype != 8:
    raise SystemExit('MAC_NATIVE_PAYLOAD_ARM64_BUNDLE_REQUIRED')
selected = [
    ('protected-specs', [node, source/'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.protected.config.ts',
      'packages/experimental/native-run/tests/protected-factory.spec.ts', 'packages/experimental/native-run/tests/native-session.spec.ts'], source),
    ('native-oracle', [node, 'scripts/build-test-oracle.mjs'], source/'native/system'),
    ('native-entry', [node, 'test/entry.test.js'], source/'native/system'),
    ('native-flock', [node, '--test', 'test/flock.test.js'], source/'native/system'),
]
receipts = []
for name, command, cwd in selected:
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (evidence/(name+'.log')).open('w') as output:
        completed = subprocess.run([str(part) for part in command], cwd=cwd, env=environment, stdout=output, stderr=subprocess.STDOUT)
    receipts.append({'name':name, 'command':[str(part) for part in command], 'cwd':str(cwd),
                     'startedUTC':started, 'endedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode':completed.returncode})
    print(json.dumps({'name':name,'exitCode':completed.returncode}), flush=True)
report = {'modelsRequested':False, 'modelKeysInherited':False, 'existingHomeInherited':False,
          'platform':'darwin', 'arch':'arm64', 'nativePayloadMachOArm64Bundle':True,
          'linuxLandlockQualificationClaimed':False, 'receipts':receipts}
(evidence/'offline-tests-receipt.json').write_text(json.dumps(report,indent=2)+'\n')
raise SystemExit(1 if any(row['exitCode'] != 0 for row in receipts) else 0)
