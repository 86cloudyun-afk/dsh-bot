"""Pure filesystem negatives for the final private Host CI packet verifier."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).parent / 'host-generation-cold' / 'verify-packet.py'
spec = importlib.util.spec_from_file_location('final_packet_verifier', MODULE_PATH)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class PacketTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='final-host-packet-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / 'recipes').mkdir()
        (self.root / 'materials').mkdir()
        (self.root / 'verify-packet.py').write_bytes(b'trusted verifier\n')
        self.file = self.root / 'recipes' / 'build.py'
        self.file.write_bytes(b'pinned source\n')
        self.file.chmod(0o600)
        self.row = {'path': 'recipes/build.py', 'bytes': 14,
                    'sha256': hashlib.sha256(b'pinned source\n').hexdigest(), 'mode': 0o600}
        self.value = {'format': 1, 'sourceOnly': True,
                      'localPatchRights': 'UNKNOWN', 'files': [self.row]}
        self.required = {'format': 1, 'sourceOnly': True, 'localPatchRights': 'UNKNOWN'}

    def pin(self):
        raw = (json.dumps(self.value, sort_keys=True) + '\n').encode()
        (self.root / 'M2_CI_INPUTS.json').write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def verify(self, digest=None, root=None):
        return verifier.verify_packet(root or self.root, 'M2_CI_INPUTS.json',
                                      digest or self.pin(), self.required)

    def test_complete_pinned_packet(self):
        self.assertEqual(self.verify()['verifiedFiles'], 1)

    def test_cli_refuses_unfrozen_pin(self):
        with self.assertRaises(verifier.PacketRefused):
            verifier.require_frozen_pin(None)

    def test_descriptor_digest_is_caller_bound(self):
        self.pin()
        with self.assertRaises(verifier.PacketRefused):
            self.verify('0' * 64)

    def test_duplicate_and_noncanonical_paths(self):
        for path in ['../elsewhere', '/tmp/elsewhere', 'recipes/./build.py',
                     'recipes//build.py', 'recipes\\build.py', 'recipes/build.py\0']:
            with self.subTest(path=path):
                self.row['path'] = path
                with self.assertRaises(verifier.PacketRefused):
                    self.verify()
        self.row['path'] = 'recipes/build.py'
        self.value['files'].append(dict(self.row))
        with self.assertRaises(verifier.PacketRefused):
            self.verify()

    def test_extra_hidden_file_and_empty_alias_directory(self):
        (self.root / '.undeclared').write_bytes(b'extra')
        with self.assertRaises(verifier.PacketRefused):
            self.verify()
        (self.root / '.undeclared').unlink()
        (self.root / 'empty-alias').symlink_to(self.root / 'materials', target_is_directory=True)
        with self.assertRaises(verifier.PacketRefused):
            self.verify()

    def test_symlink_and_hardlink_payload(self):
        self.file.unlink()
        original = self.root / 'materials' / 'original'
        original.write_bytes(b'pinned source\n')
        original.chmod(0o600)
        self.file.symlink_to(original)
        with self.assertRaises(verifier.PacketRefused):
            self.verify()
        self.file.unlink()
        os.link(original, self.file)
        with self.assertRaises(verifier.PacketRefused):
            self.verify()

    def test_root_alias_and_changed_mode(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(verifier.PacketRefused):
            self.verify(root=alias)
        alias.unlink()
        self.file.chmod(0o644)
        with self.assertRaises(verifier.PacketRefused):
            self.verify()

    def test_same_bytes_replacement_during_descriptor_read(self):
        digest = self.pin()
        original_read = os.read
        replaced = False
        def read_then_replace(fd, count):
            nonlocal replaced
            data = original_read(fd, count)
            if data and not replaced:
                replacement = self.root / 'replacement'
                replacement.write_bytes((self.root / 'M2_CI_INPUTS.json').read_bytes())
                os.replace(replacement, self.root / 'M2_CI_INPUTS.json')
                replaced = True
            return data
        with patch.object(verifier.os, 'read', side_effect=read_then_replace):
            with self.assertRaises(verifier.PacketRefused):
                self.verify(digest)
        self.assertTrue(replaced)

    def late_mutation(self, mutation):
        later = self.root / 'recipes' / 'later.py'
        later.write_bytes(b'later payload\n')
        later.chmod(0o600)
        self.value['files'].append({'path': 'recipes/later.py', 'bytes': 14,
                                   'sha256': hashlib.sha256(b'later payload\n').hexdigest(), 'mode': 0o600})
        digest = self.pin()
        original_read = os.read
        changed = False
        def read_then_mutate(fd, count):
            nonlocal changed
            data = original_read(fd, count)
            if data == b'later payload\n' and not changed:
                mutation()
                changed = True
            return data
        with patch.object(verifier.os, 'read', side_effect=read_then_mutate):
            with self.assertRaises(verifier.PacketRefused):
                self.verify(digest)
        self.assertTrue(changed)

    def test_earlier_payload_changes_during_later_read(self):
        self.late_mutation(lambda: self.file.write_bytes(b'mutant source\n'))

    def test_descriptor_changes_during_later_payload_read(self):
        path = self.root / 'M2_CI_INPUTS.json'
        self.late_mutation(lambda: path.write_bytes(path.read_bytes().replace(b'UNKNOWN', b'UNOWNED')))

    def test_earlier_payload_gains_external_hardlink_during_later_read(self):
        external = tempfile.TemporaryDirectory(prefix='owned-packet-external-')
        self.addCleanup(external.cleanup)
        self.late_mutation(lambda: os.link(self.file, Path(external.name) / 'link'))


if __name__ == '__main__':
    unittest.main()
