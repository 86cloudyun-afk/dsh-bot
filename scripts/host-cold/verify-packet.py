"""Verify the complete frozen private CI source/recipe packet before executing it."""
from pathlib import Path
import hashlib
import json
import stat
import sys

root = Path(sys.argv[1]).resolve(strict=True)
expected = '6aa6fd867c566ca700bf0d961d53118229c810badf0c04724bce44c5cbd791d8'
manifest = root / 'CI_INPUTS.json'
data = manifest.read_bytes()
assert hashlib.sha256(data).hexdigest() == expected, 'CI_PACKET_MANIFEST_REFUSED'
value = json.loads(data)
assert value['format'] == 1 and value['runtimePayloadCopied'] is False and value['oldHomeCopied'] is False
assert value['publicBaseCommit'] == '639ed015397290b3745d163aafe02ffee4aa3f84'
assert value['sourceMaterialCommit'] == '616b511b4358dd7c173601816fc1f79f92f2a010'
assert value['localPatchRights'] == 'UNKNOWN'
names = set()
for row in value['files']:
    relative = Path(row['path'])
    assert relative.as_posix() == row['path'] and not relative.is_absolute() and '..' not in relative.parts
    assert relative.parts[0] in {'recipes', 'materials'} and row['path'] not in names
    names.add(row['path'])
    path = root / relative
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and path.resolve(strict=True) == path
    raw = path.read_bytes()
    after = path.lstat()
    assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    assert len(raw) == row['bytes'] and hashlib.sha256(raw).hexdigest() == row['sha256']
actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
assert actual == names | {'CI_INPUTS.json', 'verify-packet.py'}, 'CI_PACKET_EXTRA_FILE_REFUSED'
print(json.dumps({'status': 'PASS_PRIVATE_SOURCE_PACKET', 'manifestSHA256': expected,
                  'verifiedFiles': len(names), 'runtimePayloadCopied': False,
                  'oldHomeCopied': False, 'localPatchRights': 'UNKNOWN'}))
