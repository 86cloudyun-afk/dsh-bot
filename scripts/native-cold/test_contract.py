"""Pure checks: no SDK/native import, subprocess, model or network operation."""
import ast
import json
import unittest
from pathlib import Path
from contract import check_partition, select_platform, Refused

ROOT = Path(__file__).resolve().parents[2]

class ContractTests(unittest.TestCase):
    def test_python_harness_syntax_without_import_or_launch(self):
        for path in (ROOT/'scripts/native-cold').glob('*.py'):
            ast.parse(path.read_text(),filename=path.name)
    def test_original_inventory_is_partitioned_without_body_changes(self):
        result = check_partition(ROOT)
        self.assertEqual(result['originalFiles'], 40)
        self.assertEqual(result['movedCases'], 2)
        self.assertEqual(result['intersection'], [])

    def test_assertion_removal_is_refused(self):
        def read(path):
            data = path.read_bytes()
            return data.replace(b"assert.equal(result.oldWorkHeld,true);", b'') if path.name == 'bot-chain-continuation.test.mjs' else data
        with self.assertRaises(Refused):
            check_partition(ROOT, read=read)

    def test_cold_overlap_is_refused(self):
        manifest = json.loads((ROOT/'scripts/native-cold/partition.json').read_text())
        moved = manifest['migrations'][0]
        def read(path):
            data = path.read_bytes()
            if path == ROOT/moved['from']:
                data += next(line for line in (ROOT/moved['to']).read_bytes().splitlines(keepends=True) if moved['name'].encode() in line)
            return data
        with self.assertRaises(Refused):
            check_partition(ROOT, read=read)

    def test_platform_scope_is_exact(self):
        self.assertEqual(select_platform('linux', 'x86_64')['arch'], 'x64')
        self.assertEqual(select_platform('darwin', 'arm64')['arch'], 'arm64')
        for os_name, arch in [('darwin','x86_64'),('linux','aarch64'),('win32','arm64')]:
            with self.assertRaises(Refused):
                select_platform(os_name, arch)

if __name__ == '__main__':
    unittest.main()
