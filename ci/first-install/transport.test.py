"""Ordinary byte/file fixtures; no SDK, child, native or network work."""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('first_transport', Path(__file__).with_name('transport.py'))
transport = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transport)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture():
    files = {path: b'ordinary reviewed tool bytes\n' for path in transport.TOOL_PATHS.values()}
    files['product/manifest.json'] = json.dumps({
        'sourceHead': 'a' * 40, 'sourceTree': 'b' * 40, 'buildId': 'ordinary-build',
        'packageSourceClean': True,
    }).encode()
    rows = [{'path': path, 'bytes': len(raw), 'sha256': sha(raw),
             'mode': 0o755 if path == transport.TOOL_PATHS['installer'] else 0o600,
             'target': 'common'} for path, raw in sorted(files.items())]
    descriptor = {'format': 1, 'classification': 'DSH_BOT_V1_THIN_INSTALL_BUNDLE',
                  'publicReleaseQualified': False, 'runtime': {'nodeVersion': '24.19.0'},
                  'officialSdk': {'cliVersion': '0.2.0-rc.2'}, 'tools': transport.TOOL_PATHS,
                  'product': {'buildId': 'ordinary-build', 'manifest': 'product/manifest.json'},
                  'targets': [{'id': 'linux-x64', 'platform': 'linux', 'arch': 'x64'},
                              {'id': 'darwin-arm64', 'platform': 'darwin', 'arch': 'arm64'}],
                  'files': rows}
    raw = json.dumps(descriptor).encode()
    files['thin-install-descriptor.json'] = raw
    pins = {'format': 1, 'classification': 'PRIVATE_FIRST_INSTALL_EXTERNAL_INPUT_PINS',
            'frozen': True, 'sourceHead': 'a' * 40, 'sourceTree': 'b' * 40,
            'archive': {'path': 'inputs/final-thin.tar.gz', 'bytes': 1, 'sha256': 'c' * 64},
            'descriptor': {'path': 'thin-install-descriptor.json', 'bytes': len(raw),
                           'sha256': sha(raw), 'mode': 0o600},
            'productBuildId': 'ordinary-build', 'sourceIndexSha256': 'd' * 64}
    return files, pins


def archive(files, altered=None):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w', format=tarfile.PAX_FORMAT) as writer:
        for path, raw in sorted(files.items()):
            member = tarfile.TarInfo(path)
            member.size, member.mode, member.mtime = len(raw), (0o755 if path == transport.TOOL_PATHS['installer'] else 0o600), 0
            member.uid = member.gid = 0
            member.uname = member.gname = ''
            if altered:
                altered(member)
            writer.addfile(member, io.BytesIO(raw))
    return gzip.compress(buffer.getvalue(), mtime=0)


class OrdinaryTransport(unittest.TestCase):
    def test_transport_retains_original_executable_mode(self):
        files, pins = fixture()
        decoded, records, _ = transport.decode_archive(archive(files), pins)
        with tempfile.TemporaryDirectory(prefix='first-transport-test-') as value:
            root = Path(value).resolve()
            os.chmod(root, 0o700)
            old = os.umask(0o077)
            try:
                transport.extract_closed(root, decoded, records)
            finally:
                os.umask(old)
            path = root / transport.TOOL_PATHS['installer']
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
            self.assertEqual(path.read_bytes(), files[transport.TOOL_PATHS['installer']])

    def test_transport_refuses_normalized_executable_mode(self):
        files, pins = fixture()
        with self.assertRaisesRegex(transport.Refused, 'TRANSPORT_FILE_HASH_MODE_REFUSED'):
            transport.decode_archive(archive(files, lambda member: setattr(member, 'mode', 0o600)), pins)

    def test_transport_refuses_serialized_nonzero_owner(self):
        files, pins = fixture()
        with self.assertRaisesRegex(transport.Refused, 'TRANSPORT_HEADER_REFUSED'):
            transport.decode_archive(archive(files, lambda member: setattr(member, 'uid', 1)), pins)

    def test_closed_inventory_refuses_unindexed_regular_file(self):
        files, pins = fixture()
        files['extra.txt'] = b'ordinary extra file'
        with self.assertRaisesRegex(transport.Refused, 'TRANSPORT_CLOSED_FILE_SET_REFUSED'):
            transport.decode_archive(archive(files), pins)

    def test_descriptor_pin_refuses_changed_descriptor_bytes(self):
        files, pins = fixture()
        files['thin-install-descriptor.json'] += b' '
        with self.assertRaisesRegex(transport.Refused, 'THIN_EXTERNAL_DESCRIPTOR_PIN_REFUSED'):
            transport.decode_archive(archive(files), pins)

    def test_unfrozen_input_refused_before_output_function(self):
        _, pins = fixture()
        pins['frozen'] = False
        with self.assertRaisesRegex(transport.Refused, 'FIRST_INSTALL_INPUT_NOT_FROZEN'):
            transport.pins_from(json.dumps(pins))


if __name__ == '__main__':
    unittest.main()
