"""Synthetic files and bytes only. No SDK/Node children or network."""
import copy,hashlib,json,stat,tempfile,unittest
from pathlib import Path
import installed_identity as I
import supervisor as R

class InstalledTests(unittest.TestCase):
    def metadata_checks(self,path):
        info=path.lstat()
        return {'regular':stat.S_ISREG(info.st_mode),'nlinkOne':info.st_nlink==1,
                'withinSize':info.st_size<=4*1024*1024,'canonicalEquality':path.resolve(strict=True)==path}

    def test_owned_temporary_parent_alias_has_a_valid_canonical_baseline(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d).resolve(strict=True);owned=parent/'owned';owned.mkdir()
            alias=parent/'temporary-parent-alias';alias.symlink_to(owned,target_is_directory=True)
            source,sdk=self.fixture(alias)
            try:inventory=I.sdk_inventory(source)
            except R.SafetyError:
                self.fail('SYNTHETIC_VALID_BASELINE_REFUSED '+json.dumps(self.metadata_checks(source/'package-lock.json'),sort_keys=True))
            self.assertEqual(len(inventory['files']),2)
            self.assertTrue(all(self.metadata_checks(source/'package-lock.json').values()))

    def fixture(self,d):
        source=Path(d).resolve(strict=True)/'source';sdk=source/'node_modules/synthetic-sdk';sdk.mkdir(parents=True)
        (source/'package-lock.json').write_text(json.dumps({'packages':{'node_modules/synthetic-sdk':{'version':'1.0.0','integrity':'sha512-synthetic-fixture'}}}))
        (sdk/'package.json').write_text(json.dumps({'name':'synthetic-sdk','version':'1.0.0'}));(sdk/'index.js').write_text('synthetic only')
        self.assertTrue(all(self.metadata_checks(source/'package-lock.json').values()),json.dumps(self.metadata_checks(source/'package-lock.json'),sort_keys=True))
        self.assertEqual(len(I.sdk_inventory(source)['files']),2)
        return source,sdk

    def test_same_version_drift_changes_inventory(self):
        with tempfile.TemporaryDirectory() as d:
            source,sdk=self.fixture(d);original=I.sdk_inventory(source);(sdk/'index.js').write_text('changed synthetic only')
            self.assertNotEqual(I.sdk_inventory(source),original)

    def test_file_addition_and_removal_change_inventory(self):
        with tempfile.TemporaryDirectory() as d:
            source,sdk=self.fixture(d);original=I.sdk_inventory(source);(sdk/'added.js').write_text('synthetic')
            self.assertNotEqual(I.sdk_inventory(source),original);(sdk/'added.js').unlink();(sdk/'index.js').unlink()
            self.assertNotEqual(I.sdk_inventory(source),original)

    def test_file_alias_is_refused_before_read(self):
        with tempfile.TemporaryDirectory() as d:
            source,sdk=self.fixture(d);(sdk/'index.js').unlink();(sdk/'index.js').symlink_to('package.json')
            with self.assertRaises(R.SafetyError):I.sdk_inventory(source)

    def test_metadata_version_cannot_claim_lock_version(self):
        with tempfile.TemporaryDirectory() as d:
            source,sdk=self.fixture(d);(sdk/'package.json').write_text(json.dumps({'name':'synthetic-sdk','version':'2.0.0'}))
            with self.assertRaises(R.SafetyError):I.sdk_inventory(source)

    def test_node_and_parent_canonical_row_shape(self):
        with tempfile.TemporaryDirectory() as d:
            source,sdk=self.fixture(d);inventory=I.sdk_inventory(source)
            self.assertEqual(set(inventory),{'schemaVersion','scope','lockSHA256','packages','files'})
            self.assertEqual(len(inventory['files']),2)
            self.assertEqual([r['path'] for r in inventory['files']],['synthetic-sdk/index.js','synthetic-sdk/package.json'])

if __name__=='__main__':unittest.main()
