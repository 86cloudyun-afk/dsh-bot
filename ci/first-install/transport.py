"""Unpack caller-pinned final thin bytes into one new exclusive private CI root.

The external archive and descriptor pins are supplied by Root and reviewed with
this source. They are never inferred from the untrusted tar's own inventory.
No input or failed output is automatically removed.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import io
import json
import os
import platform
import re
import stat
import sys
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
LIMIT = 256 * 1024 * 1024
TOOL_PATHS = {
    'installer': 'scripts/install-v1.mjs',
    'consumer': 'scripts/assemble-distribution-runtime.mjs',
    'guiInstaller': 'scripts/install-bot-gui-profile.mjs',
    'packageSnapshot': 'scripts/package-snapshot.mjs',
    'runtimeExporter': 'tools/runtime-export/export.mjs',
}


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'INPUT_JSON_DUPLICATE_KEY')
        result[key] = value
    return result


def parse(raw):
    try:
        return json.loads(raw, object_pairs_hook=unique_object,
                          parse_constant=lambda _: require(False, 'INPUT_JSON_INVALID'))
    except (ValueError, UnicodeError):
        raise Refused('INPUT_JSON_INVALID') from None


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def is_digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def name(value):
    require(isinstance(value, str) and value and '\\' not in value and '\0' not in value,
            'TRANSPORT_PATH_REFUSED')
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value
            and not any(part in ('', '.', '..') for part in value.split('/')),
            'TRANSPORT_PATH_REFUSED')
    require(not any(part in ('.git', 'node_modules', '.env', '.npmrc', 'Home',
                             '.ssh', '.aws', '.codex', '.agents', 'credentials.json', 'auth.json')
                    or part.startswith('.env.') for part in path.parts), 'TRANSPORT_PROHIBITED_PATH')
    return path


def state(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_nlink, value.st_uid)


def regular(path):
    value = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path
            and stat.S_ISREG(value.st_mode) and value.st_nlink == 1
            and not value.st_mode & 0o7000 and value.st_size <= LIMIT,
            'TRANSPORT_REGULAR_REQUIRED')
    return value


def read_regular(path):
    before = regular(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        require(state(before) == state(opened) == state(regular(path)), 'TRANSPORT_INPUT_CHANGED')
        chunks, count = [], 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, opened.st_size + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            require(count <= opened.st_size, 'TRANSPORT_INPUT_CHANGED')
        after = os.fstat(descriptor)
        final = regular(path)
        require(count == opened.st_size and state(opened) == state(after) == state(final),
                'TRANSPORT_INPUT_CHANGED')
        return b''.join(chunks), state(final)
    finally:
        os.close(descriptor)


def private_directory(path):
    value = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(value.st_mode)
            and value.st_uid == os.getuid() and stat.S_IMODE(value.st_mode) == 0o700,
            'PRIVATE_DIRECTORY_REQUIRED')
    return value


def pins_from(raw):
    pins = parse(raw)
    require(isinstance(pins, dict) and pins.get('format') == 1
            and pins.get('classification') == 'PRIVATE_FIRST_INSTALL_EXTERNAL_INPUT_PINS'
            and pins.get('frozen') is True, 'FIRST_INSTALL_INPUT_NOT_FROZEN')
    for key in ('archive', 'descriptor'):
        value = pins.get(key)
        require(isinstance(value, dict) and is_digest(value.get('sha256'))
                and type(value.get('bytes')) is int and 0 < value['bytes'] <= LIMIT,
                'FIRST_INSTALL_INPUT_NOT_FROZEN')
        name(value.get('path'))
    require(pins['archive']['path'] == 'inputs/final-thin.tar.gz'
            and type(pins['descriptor'].get('mode')) is int
            and 0 <= pins['descriptor']['mode'] <= 0o777
            and isinstance(pins.get('productBuildId'), str) and pins['productBuildId']
            and is_digest(pins.get('sourceIndexSha256'))
            and re.fullmatch('[a-f0-9]{40}', pins.get('sourceHead', '')) is not None
            and re.fullmatch('[a-f0-9]{40}', pins.get('sourceTree', '')) is not None,
            'FIRST_INSTALL_PIN_SCHEMA_REFUSED')
    return pins


def records_from(descriptor, pins):
    require(isinstance(descriptor, dict) and descriptor.get('format') == 1
            and descriptor.get('classification') == 'DSH_BOT_V1_THIN_INSTALL_BUNDLE'
            and descriptor.get('publicReleaseQualified') is False
            and descriptor.get('runtime', {}).get('nodeVersion') == '24.19.0'
            and descriptor.get('officialSdk', {}).get('cliVersion') == '0.2.0-rc.2'
            and descriptor.get('tools') == TOOL_PATHS
            and descriptor.get('product', {}).get('buildId') == pins['productBuildId'],
            'THIN_DESCRIPTOR_SCHEMA_REFUSED')
    targets = descriptor.get('targets')
    require(isinstance(targets, list) and len(targets) == 2
            and {item.get('id') for item in targets if isinstance(item, dict)}
            == {'linux-x64', 'darwin-arm64'}, 'THIN_TARGET_SCHEMA_REFUSED')
    for item in targets:
        require(item['id'] == item.get('platform', '') + '-' + item.get('arch', ''),
                'THIN_TARGET_SCHEMA_REFUSED')
    rows = descriptor.get('files')
    require(isinstance(rows, list) and 0 < len(rows) <= 10000, 'THIN_FILE_INDEX_REFUSED')
    records = {}
    for row in rows:
        require(isinstance(row, dict), 'THIN_FILE_INDEX_REFUSED')
        path = str(name(row.get('path')))
        require(path not in records and is_digest(row.get('sha256'))
                and type(row.get('bytes')) is int and 0 <= row['bytes'] <= LIMIT
                and type(row.get('mode')) is int and 0 <= row['mode'] <= 0o777
                and row.get('target') in ('common', 'linux-x64', 'darwin-arm64'),
                'THIN_FILE_INDEX_REFUSED')
        records[path] = row
    require(pins['descriptor']['path'] not in records, 'THIN_DESCRIPTOR_INDEX_ALIAS')
    records[pins['descriptor']['path']] = {**pins['descriptor'], 'target': 'common'}
    for path in TOOL_PATHS.values():
        require(path in records and records[path]['target'] == 'common', 'THIN_REQUIRED_TOOL_MISSING')
    return records


def decode_archive(raw, pins):
    require(len(raw) >= 10 and raw[:4] == b'\x1f\x8b\x08\x00'
            and raw[4:8] == b'\0\0\0\0', 'TRANSPORT_GZIP_HEADER_REFUSED')
    files, modes, seen, total, previous = {}, {}, set(), 0, None
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for member in archive:
            path = str(name(member.name))
            require(path not in seen and len(seen) < 20000, 'TRANSPORT_DUPLICATE_MEMBER')
            require(previous is None or previous < path, 'TRANSPORT_SORT_ORDER_REFUSED')
            previous = path
            seen.add(path)
            require(member.type == tarfile.REGTYPE and not member.issparse()
                    and 0 <= member.size <= LIMIT, 'TRANSPORT_MEMBER_TYPE_REFUSED')
            require(not member.mode & ~0o777 and member.uid == member.gid == member.mtime == 0
                    and member.uname == member.gname == member.linkname == ''
                    and not member.pax_headers,
                    'TRANSPORT_HEADER_REFUSED')
            total += member.size
            require(total <= LIMIT, 'TRANSPORT_SIZE_REFUSED')
            source = archive.extractfile(member)
            require(source is not None, 'TRANSPORT_MEMBER_READ_REFUSED')
            with source:
                contents = source.read(member.size + 1)
            require(len(contents) == member.size, 'TRANSPORT_MEMBER_READ_REFUSED')
            files[path], modes[path] = contents, member.mode
    descriptor_path = pins['descriptor']['path']
    require(descriptor_path in files, 'THIN_DESCRIPTOR_MISSING')
    descriptor_raw = files[descriptor_path]
    require(len(descriptor_raw) == pins['descriptor']['bytes']
            and digest(descriptor_raw) == pins['descriptor']['sha256'], 'THIN_EXTERNAL_DESCRIPTOR_PIN_REFUSED')
    descriptor = parse(descriptor_raw)
    records = records_from(descriptor, pins)
    require(set(files) == set(records), 'TRANSPORT_CLOSED_FILE_SET_REFUSED')
    expected_dirs = set()
    for path, row in records.items():
        require(len(files[path]) == row['bytes'] and digest(files[path]) == row['sha256']
                and modes[path] == row['mode'], 'TRANSPORT_FILE_HASH_MODE_REFUSED')
        expected_dirs.update(str(parent) for parent in PurePosixPath(path).parents if str(parent) != '.')
    require(not set(files) & expected_dirs,
            'TRANSPORT_DIRECTORY_CLOSURE_REFUSED')
    product = parse(files[str(name(descriptor['product']['manifest']))])
    require(product.get('sourceHead') == pins['sourceHead'] and product.get('sourceTree') == pins['sourceTree']
            and product.get('buildId') == pins['productBuildId'] and product.get('packageSourceClean') is True,
            'THIN_PRODUCT_SOURCE_PIN_REFUSED')
    return files, records, descriptor


def extract_closed(root, files, records):
    private_directory(root)
    for relative, contents in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        for parent in [path.parent, *path.parent.parents]:
            if parent == root or root in parent.parents:
                private_directory(parent)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb', closefd=False) as out:
                out.write(contents)
                out.flush()
                os.fchmod(fd, records[relative]['mode'])
                os.fsync(fd)
        finally:
            os.close(fd)
    found, found_dirs, retained = set(), set(), []
    expected_dirs = {str(parent) for relative in records for parent in PurePosixPath(relative).parents
                     if str(parent) != '.'}
    for path in root.rglob('*'):
        value = path.lstat()
        if stat.S_ISDIR(value.st_mode):
            private_directory(path)
            found_dirs.add(path.relative_to(root).as_posix())
        else:
            relative = path.relative_to(root).as_posix()
            require(relative in records, 'TRANSPORT_EXTRACTED_EXTRA_FILE')
            raw, final = read_regular(path)
            row = records[relative]
            require(len(raw) == row['bytes'] and digest(raw) == row['sha256']
                    and stat.S_IMODE(value.st_mode) == row['mode'], 'TRANSPORT_EXTRACTED_FILE_REFUSED')
            found.add(relative)
            retained.append((path, final))
    require(found == set(records), 'TRANSPORT_EXTRACTED_FILE_SET_REFUSED')
    require(found_dirs == expected_dirs, 'TRANSPORT_EXTRACTED_DIRECTORY_SET_REFUSED')
    for path, expected in retained:
        require(state(regular(path)) == expected, 'TRANSPORT_EXTRACTED_INPUT_CHANGED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=('linux-x64', 'darwin-arm64'), required=True)
    parser.add_argument('--runner-temp', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    pins_raw, pins_state = read_regular(HERE / 'INPUT_PINS.json')
    pins = pins_from(pins_raw)  # Must fail before creating a directory or running a public tool.
    actual = ('linux-x64' if platform.system() == 'Linux' and platform.machine() in ('x86_64', 'AMD64')
              else 'darwin-arm64' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else None)
    require(actual == args.target, 'FIRST_INSTALL_ACTUAL_TARGET_REQUIRED')
    archive_path = HERE / pins['archive']['path']
    archive_raw, archive_state = read_regular(archive_path)
    require(len(archive_raw) == pins['archive']['bytes'] and digest(archive_raw) == pins['archive']['sha256'],
            'THIN_EXTERNAL_ARCHIVE_PIN_REFUSED')
    files, records, descriptor = decode_archive(archive_raw, pins)
    parent = args.runner_temp.resolve(strict=True)
    require(parent.is_dir(), 'RUNNER_TEMP_DIRECTORY_REQUIRED')
    root = Path(tempfile.mkdtemp(prefix='dsh-first-v1-', dir=parent))
    private_directory(root)
    bundle = root / 'bundle'
    bundle.mkdir(mode=0o700)
    extract_closed(bundle, files, records)
    for leaf in ('receipts', 'screenshots', 'browser-cache', 'browser-home', 'browser-tmp', 'server-home', 'server-tmp'):
        (root / leaf).mkdir(mode=0o700)
    for prefix in ('browser-home', 'server-home'):
        for leaf in ('config', 'cache'):
            (root / prefix / leaf).mkdir(mode=0o700)
    state_file = {'format': 1, 'root': str(root), 'target': args.target, 'pinsSha256': digest(pins_raw),
                  'bundleDirectory': str(bundle), 'descriptorPath': str(bundle / pins['descriptor']['path'])}
    (root / 'state.json').write_text(json.dumps(state_file, indent=2) + '\n')
    require(state(regular(HERE / 'INPUT_PINS.json')) == pins_state
            and state(regular(archive_path)) == archive_state, 'TRANSPORT_INPUT_CHANGED')
    receipt = {'format': 1, 'classification': 'EXTERNAL_PINNED_FIRST_INSTALL_TRANSPORT',
               'status': 'PASS', 'target': args.target, 'archiveSha256': pins['archive']['sha256'],
               'descriptorSha256': pins['descriptor']['sha256'], 'inputFiles': len(files),
               'closedFileSet': True, 'fileBytesAndModesVerified': True,
               'deterministicRegularOnlyTransport': True,
               'productSourceHead': pins['sourceHead'], 'sourcePosixModesFromGitClaimed': False,
               'modelsRequested': 0, 'failedOutputsAutomaticallyRemoved': False}
    (root / 'receipts/transport.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(root)


if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, tarfile.TarError, KeyError, TypeError) as cause:
        print(str(cause) if isinstance(cause, Refused) else 'FIRST_INSTALL_TRANSPORT_REFUSED', file=sys.stderr)
        raise SystemExit(1)
