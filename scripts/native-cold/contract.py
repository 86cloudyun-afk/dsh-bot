"""Read-only test partition and platform identity; importing never launches Node."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

class Refused(Exception):
    pass

def require(condition, category):
    if not condition:
        raise Refused(category)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def check_partition(root, read=Path.read_bytes):
    manifest = json.loads(read(root/'scripts/native-cold/partition.json'))
    files = manifest['originalFiles']
    require(set(files) == {str(p.relative_to(root)) for p in (root/'test').glob('*.test.mjs')}, 'JS_INVENTORY_REFUSED')
    migrations = manifest['migrations']
    require(len(migrations) == 2 and len({m['from'] for m in migrations}) == 2 and len({m['to'] for m in migrations}) == 2, 'PARTITION_REFUSED')
    moved = {m['from']: m for m in migrations}
    for filename, digest in files.items():
        data = read(root/filename)
        if filename not in moved:
            require(sha(data) == digest, 'ORIGINAL_TEST_BODY_REFUSED')
            continue
        m = moved[filename]
        require(sha(data) == m['remainingSHA256'] and m['name'].encode() not in data, 'JS_PARTITION_REFUSED')
        native = read(root/m['to']).splitlines(keepends=True)
        declarations = [line for line in native if m['name'].encode() in line]
        require(len(declarations) == 1 and declarations[0] == native[-1], 'COLD_PARTITION_REFUSED')
        require(sha(declarations[0]) == m['declarationSHA256'] and sha(b''.join(native[:-1])) == m['supportSHA256'], 'COLD_BODY_REFUSED')
        restored = data.splitlines(keepends=True)
        restored.insert(m['originalLine'], declarations[0])
        require(sha(b''.join(restored)) == digest, 'ORIGINAL_BODY_UNION_REFUSED')
    for filename, digest in manifest['supportFiles'].items():
        require(sha(read(root/filename)) == digest, 'FIXTURE_BODY_REFUSED')
    return {'originalFiles':len(files), 'movedCases':len(migrations), 'intersection':[], 'originalBodyUnionExact':True,
            'legacyNativeNotIncluded':manifest['excludedLegacyNativeFiles']}

def select_platform(os_name, machine):
    key = {('linux','x86_64'):'linux-x64', ('darwin','arm64'):'darwin-arm64'}.get((os_name, machine))
    require(key is not None, 'PLATFORM_REFUSED')
    return json.loads((HERE/'platforms.json').read_text())[key]

if __name__ == '__main__':
    print(json.dumps(check_partition(HERE.parents[1]), sort_keys=True))
