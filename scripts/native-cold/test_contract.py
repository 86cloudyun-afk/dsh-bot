"""Pure checks: no SDK/native import, subprocess, model or network operation."""
import ast
import copy
import hashlib
import json
import tempfile
import unittest
from contextlib import contextmanager
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
        self.assertEqual(result['additionalPureFiles'], 7)
        self.assertEqual(result['extendedPureFiles'], 3)
        self.assertEqual(result['currentPureFiles'], 47)
        self.assertTrue(result['originalBodyUnionExact'])
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

class CurrentPurePartitionTests(unittest.TestCase):
    ADDITIONS=(
        'test/bot-gui-bootstrap.test.mjs','test/bot-gui-controls.test.mjs',
        'test/bot-gui-generation-policy.test.mjs','test/bot-gui-profile.test.mjs',
        'test/bot-gui-startup.test.mjs','test/initial-session-blank.test.mjs',
        'test/work-generation-bridge.test.mjs',
    )
    PREFIX_BYTES={'test/adapter.test.mjs':1265,'test/bot-client-owner.test.mjs':21431,'test/package-snapshot.test.mjs':6753}
    IMPORT_CHANGE={
        'offset':71,
        'original':"import {mkdtemp,readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';\n",
        'current':"import {mkdtemp,readFile,writeFile,mkdir,readdir,lstat,chmod} from 'node:fs/promises';\n",
    }

    def digest(self,data):return hashlib.sha256(data).hexdigest()

    def declared_manifest(self):
        manifest=json.loads((ROOT/'scripts/native-cold/partition.json').read_text())
        manifest['additionalPureFiles']={name:self.digest((ROOT/name).read_bytes()) for name in self.ADDITIONS}
        manifest['extendedPureFiles']={}
        for name,prefix in self.PREFIX_BYTES.items():
            change=copy.deepcopy(self.IMPORT_CHANGE) if name=='test/package-snapshot.test.mjs' else None
            end=prefix+(len(change['current'])-len(change['original']) if change else 0)
            data=(ROOT/name).read_bytes()
            manifest['extendedPureFiles'][name]={'currentSHA256':self.digest(data),'originalPrefixBytes':prefix,
                                               'appendSHA256':self.digest(data[end:]),'importChange':change}
        return manifest

    def save_manifest(self,root,manifest):
        (root/'scripts/native-cold/partition.json').write_text(json.dumps(manifest))

    @contextmanager
    def owned(self):
        with tempfile.TemporaryDirectory(prefix='dsh-partition-tests-',dir='/tmp') as directory:
            root=Path(directory);manifest=self.declared_manifest()
            names={str(path.relative_to(ROOT)) for pattern in ('*.test.mjs','*.native.mjs') for path in (ROOT/'test').glob(pattern)}|set(manifest['supportFiles'])
            for name in names:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((ROOT/name).read_bytes())
            (root/'scripts/native-cold').mkdir(parents=True);self.save_manifest(root,manifest)
            yield root,manifest

    def approved(self,root):
        try:return check_partition(root)
        except Refused as error:self.fail('APPROVED_PURE_PARTITION_REFUSED '+str(error))

    def refused(self,root,category):
        with self.assertRaises(Refused) as caught:check_partition(root)
        self.assertEqual(str(caught.exception),category)

    def repin_current(self,root,manifest,name):
        manifest['extendedPureFiles'][name]['currentSHA256']=self.digest((root/name).read_bytes())

    def test_explicit_current_partition_reports_historical_and_pure_extension_evidence(self):
        with self.owned() as (root,manifest):
            result=self.approved(root)
            self.assertEqual((result['originalFiles'],result['movedCases'],result['additionalPureFiles'],result['extendedPureFiles'],result['currentPureFiles']),(40,2,7,3,47))
            self.assertEqual(result['additionalPureInventory'],manifest['additionalPureFiles'])
            self.assertEqual(set(result['extendedPureInventory']),set(self.PREFIX_BYTES))
            for name,row in result['extendedPureInventory'].items():
                self.assertEqual(row['originalSHA256'],manifest['originalFiles'][name])
                self.assertEqual(row['currentSHA256'],manifest['extendedPureFiles'][name]['currentSHA256'])
                self.assertEqual(row['originalPrefixBytes'],self.PREFIX_BYTES[name])
                self.assertTrue(row['originalBodyExactAfterReversal'])
            self.assertTrue(result['originalBodyUnionExact']);self.assertEqual(result['intersection'],[])

    def test_unknown_pure_test_is_refused(self):
        for name in ('test/unapproved.test.mjs','test/nested/unapproved.test.mjs'):
            with self.subTest(path=name),self.owned() as (root,_):
                self.approved(root);path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b"test('unapproved',()=>{});\n")
                self.refused(root,'JS_INVENTORY_REFUSED')

    def test_removed_original_and_additional_pure_tests_are_refused(self):
        for name in ('test/ui.test.mjs',self.ADDITIONS[0]):
            with self.subTest(path=name),self.owned() as (root,_):
                self.approved(root);(root/name).unlink();self.refused(root,'JS_INVENTORY_REFUSED')

    def test_extra_and_removed_native_files_are_refused(self):
        for change in ('extra','nested-extra','removed-moved','removed-excluded'):
            with self.subTest(change=change),self.owned() as (root,manifest):
                self.approved(root)
                if change=='extra':(root/'test/unapproved.native.mjs').write_bytes(b'owned unapproved native bytes')
                elif change=='nested-extra':
                    path=root/'test/nested/unapproved.native.mjs';path.parent.mkdir();path.write_bytes(b'owned unapproved native bytes')
                else:(root/(manifest['migrations'][0]['to'] if change=='removed-moved' else manifest['excludedLegacyNativeFiles'][0])).unlink()
                self.refused(root,'NATIVE_INVENTORY_REFUSED')

    def test_additional_pure_bytes_are_bound_to_the_declared_full_hash(self):
        for name in self.ADDITIONS:
            with self.subTest(path=name),self.owned() as (root,_):
                self.approved(root);path=root/name;path.write_bytes(path.read_bytes()+b'\n// changed owned pure bytes\n')
                self.refused(root,'PURE_TEST_BODY_REFUSED')

    def test_extension_current_hash_is_checked_before_historical_reconstruction(self):
        for name in self.PREFIX_BYTES:
            with self.subTest(path=name),self.owned() as (root,manifest):
                self.approved(root);manifest['extendedPureFiles'][name]['currentSHA256']='0'*64;self.save_manifest(root,manifest)
                self.refused(root,'PURE_EXTENSION_BODY_REFUSED')

    def test_declared_append_hash_change_is_refused(self):
        for name in self.PREFIX_BYTES:
            with self.subTest(path=name),self.owned() as (root,manifest):
                self.approved(root);manifest['extendedPureFiles'][name]['appendSHA256']='0'*64;self.save_manifest(root,manifest)
                self.refused(root,'PURE_EXTENSION_BODY_REFUSED')

    def test_changed_append_bytes_are_refused_even_when_full_current_hash_is_updated(self):
        for name in self.PREFIX_BYTES:
            with self.subTest(path=name),self.owned() as (root,manifest):
                self.approved(root);path=root/name;path.write_bytes(path.read_bytes()+b'\n// unapproved suffix\n');self.repin_current(root,manifest,name);self.save_manifest(root,manifest)
                self.refused(root,'PURE_EXTENSION_BODY_REFUSED')

    def test_original_assertion_mutation_is_refused_even_when_current_hash_is_updated(self):
        for name in self.PREFIX_BYTES:
            with self.subTest(path=name),self.owned() as (root,manifest):
                self.approved(root);path=root/name;data=path.read_bytes();offset=data.index(b'assert.');data=data[:offset]+b'removed'+data[offset+7:];path.write_bytes(data)
                self.repin_current(root,manifest,name);self.save_manifest(root,manifest);self.refused(root,'ORIGINAL_TEST_BODY_REFUSED')

    def test_original_assertion_deletion_cannot_be_reclassified_as_an_append(self):
        with self.owned() as (root,manifest):
            self.approved(root);name='test/adapter.test.mjs';path=root/name;data=path.read_bytes();assertion=b'assert.equal(r.complete,false);';self.assertEqual(data.count(assertion),1)
            path.write_bytes(data.replace(assertion,b''));row=manifest['extendedPureFiles'][name];row['originalPrefixBytes']-=len(assertion)
            self.repin_current(root,manifest,name);self.save_manifest(root,manifest);self.refused(root,'ORIGINAL_TEST_BODY_REFUSED')

    def test_undeclared_fs_import_change_is_refused(self):
        with self.owned() as (root,manifest):
            self.approved(root);name='test/package-snapshot.test.mjs';path=root/name;data=path.read_bytes();self.assertEqual(data.count(b'lstat,chmod}'),1);path.write_bytes(data.replace(b'lstat,chmod}',b'lstat,chown}'))
            self.repin_current(root,manifest,name);self.save_manifest(root,manifest);self.refused(root,'PURE_IMPORT_CHANGE_REFUSED')

    def test_other_original_import_change_is_refused(self):
        with self.owned() as (root,manifest):
            self.approved(root);name='test/package-snapshot.test.mjs';path=root/name;path.write_bytes(path.read_bytes().replace(b'import test',b'import best',1))
            self.repin_current(root,manifest,name);self.save_manifest(root,manifest);self.refused(root,'ORIGINAL_TEST_BODY_REFUSED')

    def test_declared_import_transform_cannot_expand_beyond_the_approved_change(self):
        for mutation in ('offset','float-offset','original','current','other-file'):
            with self.subTest(mutation=mutation),self.owned() as (root,manifest):
                self.approved(root);rows=manifest['extendedPureFiles'];change=rows['test/package-snapshot.test.mjs']['importChange']
                if mutation=='offset':change['offset']=0
                elif mutation=='float-offset':change['offset']=71.0
                elif mutation in ('original','current'):change[mutation]='unapproved import\n'
                else:rows['test/adapter.test.mjs']['importChange']=copy.deepcopy(change)
                self.save_manifest(root,manifest);self.refused(root,'PURE_IMPORT_CHANGE_REFUSED')

    def test_unknown_or_overlapping_pure_metadata_is_refused(self):
        for change in ('unknown-additional','original-overlap','unknown-extension','moved-extension','missing-extension'):
            with self.subTest(change=change),self.owned() as (root,manifest):
                self.approved(root)
                if change=='unknown-additional':manifest['additionalPureFiles']['test/unapproved.test.mjs']='0'*64
                elif change=='original-overlap':manifest['additionalPureFiles']['test/ui.test.mjs']=manifest['originalFiles']['test/ui.test.mjs']
                elif change=='unknown-extension':manifest['extendedPureFiles']['test/ui.test.mjs']=copy.deepcopy(manifest['extendedPureFiles']['test/adapter.test.mjs'])
                elif change=='moved-extension':manifest['extendedPureFiles'][manifest['migrations'][0]['from']]=copy.deepcopy(manifest['extendedPureFiles']['test/adapter.test.mjs'])
                else:manifest['extendedPureFiles'].pop('test/adapter.test.mjs')
                self.save_manifest(root,manifest);self.refused(root,'PURE_PARTITION_METADATA_REFUSED')

    def test_historical_hashes_cannot_be_rewritten_to_claim_current_bytes_are_original(self):
        with self.owned() as (root,manifest):
            self.approved(root);name='test/adapter.test.mjs';manifest['originalFiles'][name]=self.digest((root/name).read_bytes());self.save_manifest(root,manifest)
            self.refused(root,'HISTORICAL_PARTITION_REFUSED')

    def test_extension_prefix_bounds_reject_non_integer_and_out_of_range_values(self):
        for value in (True,0,-1,'1265',10000000):
            with self.subTest(prefix=value),self.owned() as (root,manifest):
                self.approved(root);manifest['extendedPureFiles']['test/adapter.test.mjs']['originalPrefixBytes']=value;self.save_manifest(root,manifest)
                self.refused(root,'PURE_PARTITION_METADATA_REFUSED')

    def test_native_declaration_overlap_is_refused_in_new_and_extended_pure_files(self):
        for extended in (False,True):
            with self.subTest(extended=extended),self.owned() as (root,manifest):
                self.approved(root);migration=manifest['migrations'][0];declaration=(root/migration['to']).read_bytes().splitlines(keepends=True)[-1]
                name='test/adapter.test.mjs' if extended else self.ADDITIONS[0];path=root/name;path.write_bytes(path.read_bytes()+declaration)
                if extended:
                    self.repin_current(root,manifest,name);row=manifest['extendedPureFiles'][name];row['appendSHA256']=self.digest(path.read_bytes()[row['originalPrefixBytes']:])
                else:manifest['additionalPureFiles'][name]=self.digest(path.read_bytes())
                self.save_manifest(root,manifest);self.refused(root,'JS_PARTITION_REFUSED')

    def test_original_native_body_is_still_bound_to_its_historical_hash(self):
        with self.owned() as (root,manifest):
            self.approved(root);path=root/manifest['migrations'][0]['to'];data=path.read_bytes();self.assertIn(b'assert.',data);path.write_bytes(data.replace(b'assert.',b'removed',1))
            self.refused(root,'COLD_BODY_REFUSED')

if __name__ == '__main__':
    unittest.main()
