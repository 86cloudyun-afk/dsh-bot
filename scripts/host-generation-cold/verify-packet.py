"""Verify caller-pinned source bytes before running the final private Host recipe."""
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import sys

# Caller pins bind the frozen M3 source packet; prior M2 evidence remains separate.
INDEX_NAME = 'M3_CI_INPUTS.json'
EXPECTED_INDEX_SHA256 = '93510c7358e9182b2c67ccd22053327acef264a887dc678341150b3222d44a2b'
REQUIRED_METADATA = {
    'format': 1,
    'milestone': 'M3',
    'publicBaseCommit': '639ed015397290b3745d163aafe02ffee4aa3f84',
    'sourceOnly': True,
    'localPatchRights': 'UNKNOWN',
    'declaredLocalHeadIsBuiltIdentity': False,
    'supportedNativeTargets': ['linux-x64', 'darwin-arm64'],
    'qualifiedTargetEvidenceSeparate': True,
}
MAX_FILE_BYTES = 32 * 1024 * 1024


class PacketRefused(Exception):
    pass


def refuse(code):
    raise PacketRefused(code)


def require_frozen_pin(value):
    if not isinstance(value, str) or re.fullmatch(r'[a-f0-9]{64}', value) is None:
        refuse('CI_PACKET_NOT_FROZEN')
    return value


def relative_name(value):
    if not isinstance(value, str) or not value or '\\' in value or '\0' in value:
        refuse('CI_PACKET_PATH_REFUSED')
    path = Path(value)
    if path.is_absolute() or path.as_posix() != value or any(p in ('', '.', '..') for p in value.split('/')):
        refuse('CI_PACKET_PATH_REFUSED')
    return path


def state(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_nlink)


def canonical_regular(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o7000:
        refuse('CI_PACKET_FILE_TYPE_REFUSED')
    if path.resolve(strict=True) != path:
        refuse('CI_PACKET_ALIAS_REFUSED')
    if before.st_size > MAX_FILE_BYTES:
        refuse('CI_PACKET_FILE_SIZE_REFUSED')
    return before


def read_regular(path):
    before = canonical_regular(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        current = canonical_regular(path)
        if state(before) != state(opened) or state(opened) != state(current):
            refuse('CI_PACKET_INPUT_CHANGED')
        chunks, count = [], 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, opened.st_size + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            if count > opened.st_size:
                refuse('CI_PACKET_INPUT_CHANGED')
        after = os.fstat(descriptor)
        final = canonical_regular(path)
        if count != opened.st_size or state(opened) != state(after) or state(after) != state(final):
            refuse('CI_PACKET_INPUT_CHANGED')
        return b''.join(chunks), final
    finally:
        os.close(descriptor)


def complete_files(root):
    names = set()
    def visit(directory):
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                value = path.lstat()
                if path.resolve(strict=True) != path or stat.S_ISLNK(value.st_mode):
                    refuse('CI_PACKET_ALIAS_REFUSED')
                relative = path.relative_to(root)
                if stat.S_ISDIR(value.st_mode):
                    if relative.parts[0] not in ('recipes', 'materials'):
                        refuse('CI_PACKET_EXTRA_DIRECTORY_REFUSED')
                    visit(path)
                elif stat.S_ISREG(value.st_mode):
                    names.add(relative.as_posix())
                else:
                    refuse('CI_PACKET_FILE_TYPE_REFUSED')
    visit(root)
    return names


def verify_packet(root, index_name, expected_sha256, required_metadata):
    expected_sha256 = require_frozen_pin(expected_sha256)
    root = Path(root)
    before = root.lstat()
    if not root.is_absolute() or not stat.S_ISDIR(before.st_mode) or root.resolve(strict=True) != root:
        refuse('CI_PACKET_ROOT_REFUSED')
    index_relative = relative_name(index_name)
    if len(index_relative.parts) != 1:
        refuse('CI_PACKET_INDEX_PATH_REFUSED')
    index_path = root / index_relative
    raw, index_final = read_regular(index_path)
    retained = [(index_path, state(index_final))]
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        refuse('CI_PACKET_MANIFEST_REFUSED')
    try:
        value = json.loads(raw)
    except (UnicodeError, ValueError):
        refuse('CI_PACKET_JSON_REFUSED')
    if not isinstance(value, dict) or any(type(value.get(k)) is not type(v) or value.get(k) != v for k, v in required_metadata.items()):
        refuse('CI_PACKET_METADATA_REFUSED')
    rows = value.get('files')
    if not isinstance(rows, list) or not rows or len(rows) > 100000:
        refuse('CI_PACKET_INDEX_REFUSED')
    names = set()
    for row in rows:
        if not isinstance(row, dict):
            refuse('CI_PACKET_INDEX_REFUSED')
        relative = relative_name(row.get('path'))
        if relative.parts[0] not in ('recipes', 'materials') or row['path'] in names:
            refuse('CI_PACKET_INDEX_REFUSED')
        if type(row.get('bytes')) is not int or not 0 <= row['bytes'] <= MAX_FILE_BYTES:
            refuse('CI_PACKET_INDEX_REFUSED')
        require_frozen_pin(row.get('sha256'))
        mode = row.get('mode')
        if mode is not None and (type(mode) is not int or not 0 <= mode <= 0o777):
            refuse('CI_PACKET_MODE_REFUSED')
        data, final = read_regular(root / relative)
        if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
            refuse('CI_PACKET_PAYLOAD_REFUSED')
        if mode is not None and final.st_mode & 0o777 != mode:
            refuse('CI_PACKET_MODE_REFUSED')
        retained.append((root / relative, state(final)))
        names.add(row['path'])
    if complete_files(root) != names | {index_name, 'verify-packet.py'}:
        refuse('CI_PACKET_EXTRA_FILE_REFUSED')
    # Later input reads must not invalidate an already captured descriptor or payload.
    for path, expected_state in retained:
        if state(canonical_regular(path)) != expected_state:
            refuse('CI_PACKET_INPUT_CHANGED')
    after = root.lstat()
    if root.resolve(strict=True) != root or state(before) != state(after):
        refuse('CI_PACKET_ROOT_CHANGED')
    return {'status': 'PASS_PRIVATE_SOURCE_PACKET', 'manifestSHA256': expected_sha256,
            'verifiedFiles': len(names), 'sourceOnly': True, 'localPatchRights': 'UNKNOWN'}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            refuse('CI_PACKET_ARGUMENTS_REFUSED')
        requested = Path(os.path.abspath(sys.argv[1]))
        print(json.dumps(verify_packet(requested, INDEX_NAME, EXPECTED_INDEX_SHA256, REQUIRED_METADATA)))
    except (PacketRefused, OSError) as cause:
        print(str(cause) if isinstance(cause, PacketRefused) else 'CI_PACKET_FILESYSTEM_REFUSED', file=sys.stderr)
        raise SystemExit(1)
