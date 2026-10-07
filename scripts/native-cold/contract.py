"""Read-only test partition and platform identity; importing never launches Node."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
HISTORICAL_KEYS = ('baseHead','baseTree','originalFiles','migrations','excludedLegacyNativeFiles','supportFiles')
HISTORICAL_METADATA_SHA256 = 'a716b93c03541146c880ac1e8bb2877e68014f7d2cfa23a85be24cc8dd64d4e6'
ADDITIONAL_PURE_FILES = frozenset((
    'test/bot-gui-bootstrap.test.mjs','test/bot-gui-controls.test.mjs',
    'test/bot-gui-generation-policy.test.mjs','test/bot-gui-profile.test.mjs',
    'test/bot-gui-startup.test.mjs','test/initial-session-blank.test.mjs',
    'test/owned-bot-lifecycle.test.mjs','test/owned-generation-input-window.test.mjs',
    'test/work-generation-bridge.test.mjs',
))
EXTENDED_PURE_FILES = frozenset(('test/adapter.test.mjs','test/bot-client-owner.test.mjs','test/package-snapshot.test.mjs'))
PACKAGE_IMPORT_CHANGE = {
    'offset':71,
    'original':"import {mkdtemp,readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';\n",
    'current':"import {mkdtemp,readFile,writeFile,mkdir,readdir,lstat,chmod} from 'node:fs/promises';\n",
}

class Refused(Exception):
    pass

def require(condition, category):
    if not condition:
        raise Refused(category)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def check_partition(root, read=Path.read_bytes):
    manifest = json.loads(read(root/'scripts/native-cold/partition.json'))
    require(type(manifest) is dict and set(manifest) == set(HISTORICAL_KEYS)|{'additionalPureFiles','extendedPureFiles'}, 'PURE_PARTITION_METADATA_REFUSED')
    historical = {name:manifest[name] for name in HISTORICAL_KEYS}
    require(sha(json.dumps(historical,sort_keys=True,separators=(',',':')).encode()) == HISTORICAL_METADATA_SHA256, 'HISTORICAL_PARTITION_REFUSED')
    files = manifest['originalFiles']
    additions = manifest['additionalPureFiles'];extensions = manifest['extendedPureFiles']
    require(type(additions) is dict and set(additions) == ADDITIONAL_PURE_FILES and type(extensions) is dict and set(extensions) == EXTENDED_PURE_FILES, 'PURE_PARTITION_METADATA_REFUSED')
    require(not set(files)&set(additions) and set(extensions)<=set(files), 'PURE_PARTITION_METADATA_REFUSED')
    require(set(files)|set(additions) == {str(p.relative_to(root)) for p in (root/'test').rglob('*.test.mjs')}, 'JS_INVENTORY_REFUSED')
    migrations = manifest['migrations']
    require(len(migrations) == 2 and len({m['from'] for m in migrations}) == 2 and len({m['to'] for m in migrations}) == 2, 'PARTITION_REFUSED')
    moved = {m['from']: m for m in migrations}
    require(not set(moved)&set(extensions), 'PURE_PARTITION_METADATA_REFUSED')
    require({m['to'] for m in migrations}|set(manifest['excludedLegacyNativeFiles']) == {str(p.relative_to(root)) for p in (root/'test').rglob('*.native.mjs')}, 'NATIVE_INVENTORY_REFUSED')
    cold_names = tuple(m['name'].encode() for m in migrations)
    extended_audit = {}
    for filename, digest in files.items():
        data = read(root/filename)
        require(all(name not in data for name in cold_names), 'JS_PARTITION_REFUSED')
        if filename not in moved:
            if filename in extensions:
                row = extensions[filename]
                require(type(row) is dict and set(row) == {'currentSHA256','originalPrefixBytes','appendSHA256','importChange'}, 'PURE_PARTITION_METADATA_REFUSED')
                original_size = row['originalPrefixBytes'];change = row['importChange']
                require(type(original_size) is int and original_size>0, 'PURE_PARTITION_METADATA_REFUSED')
                expected_change = PACKAGE_IMPORT_CHANGE if filename=='test/package-snapshot.test.mjs' else None
                require(change is None if expected_change is None else type(change) is dict and change == expected_change and type(change['offset']) is int, 'PURE_IMPORT_CHANGE_REFUSED')
                old_import = change['original'].encode() if change else b''
                new_import = change['current'].encode() if change else b''
                current_size = original_size+len(new_import)-len(old_import)
                require(0<current_size<len(data), 'PURE_PARTITION_METADATA_REFUSED')
                require(sha(data) == row['currentSHA256'] and sha(data[current_size:]) == row['appendSHA256'], 'PURE_EXTENSION_BODY_REFUSED')
                restored = data[:current_size]
                if change:
                    offset = change['offset']
                    require(restored[offset:offset+len(new_import)] == new_import, 'PURE_IMPORT_CHANGE_REFUSED')
                    restored = restored[:offset]+old_import+restored[offset+len(new_import):]
                require(len(restored) == original_size and sha(restored) == digest, 'ORIGINAL_TEST_BODY_REFUSED')
                extended_audit[filename] = {'currentSHA256':row['currentSHA256'],'originalSHA256':digest,
                    'originalPrefixBytes':original_size,'currentPrefixBytes':current_size,'appendSHA256':row['appendSHA256'],
                    'appendBytes':len(data)-current_size,'importChange':change,'originalBodyExactAfterReversal':True}
            else:
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
    for filename,digest in additions.items():
        data = read(root/filename)
        require(all(name not in data for name in cold_names), 'JS_PARTITION_REFUSED')
        require(sha(data) == digest, 'PURE_TEST_BODY_REFUSED')
    for filename, digest in manifest['supportFiles'].items():
        require(sha(read(root/filename)) == digest, 'FIXTURE_BODY_REFUSED')
    return {'originalFiles':len(files), 'movedCases':len(migrations), 'additionalPureFiles':len(additions),
            'extendedPureFiles':len(extensions),'currentPureFiles':len(files)+len(additions),
            'additionalPureInventory':additions,'extendedPureInventory':extended_audit,
            'intersection':[], 'originalBodyUnionExact':True,
            'originalBodyUnionMethod':'DECLARED_PURE_EXTENSION_REVERSAL_AND_TWO_COLD_REINSERTIONS',
            'legacyNativeNotIncluded':manifest['excludedLegacyNativeFiles']}

def select_platform(os_name, machine):
    key = {('linux','x86_64'):'linux-x64', ('darwin','arm64'):'darwin-arm64'}.get((os_name, machine))
    require(key is not None, 'PLATFORM_REFUSED')
    return json.loads((HERE/'platforms.json').read_text())[key]

if __name__ == '__main__':
    print(json.dumps(check_partition(HERE.parents[1]), sort_keys=True))
