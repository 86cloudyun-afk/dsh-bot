"""Synthetic files and bytes only. No SDK/Node children or network."""
import copy,hashlib,json,stat,tempfile,unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
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

class FixedReadTests(unittest.TestCase):
    @contextmanager
    def owned_file(self,data):
        with tempfile.TemporaryDirectory(prefix='dsh-fixed-read-',dir='/tmp') as d:
            path=Path(d).resolve(strict=True)/'owned.bin';path.write_bytes(data);path.chmod(0o600)
            yield path

    @contextmanager
    def observe_real_read(self,*,before_read=None,after_read=None):
        """Transparent observer: bytes and metadata still come from the real owned file."""
        original=I.os.fdopen;requests=[];lengths=[]
        @contextmanager
        def wrapped(fd,mode):
            with original(fd,mode) as real:
                class Reader:
                    def fileno(self):return real.fileno()
                    def read(self,size):
                        requests.append(size)
                        if before_read is not None:before_read()
                        data=real.read(size);lengths.append(len(data))
                        if after_read is not None:after_read()
                        return data
                yield Reader()
        with patch.object(I.os,'fdopen',side_effect=wrapped):yield requests,lengths

    def test_read_request_is_verified_file_size_plus_one(self):
        for data in (b'',b'\x00',bytes(range(256))*257):
            with self.subTest(bytes=len(data)),self.owned_file(data) as path,self.observe_real_read() as observed:
                I.fixed(path)
                self.assertEqual(observed[0],[len(data)+1])
                self.assertEqual(observed[1],[len(data)])

    def test_full_binary_content_digest_and_mode_are_retained_at_size_limit(self):
        for data in (b'',b'\x00',bytes(range(256))*257):
            with self.subTest(bytes=len(data)),self.owned_file(data) as path:
                actual,mode,digest=I.fixed(path,maximum=len(data))
                self.assertEqual(actual,data);self.assertEqual(mode,0o600)
                self.assertEqual(digest,hashlib.sha256(data).hexdigest())

    def test_growth_between_opened_metadata_and_read_is_refused(self):
        data=b'owned synthetic original'
        with self.owned_file(data) as path:
            def grow():
                with path.open('ab') as file:file.write(b'+')
            with self.observe_real_read(before_read=grow) as observed,self.assertRaises(R.SafetyError) as caught:
                I.fixed(path,maximum=len(data))
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            self.assertEqual(observed[1],[len(data)+1])

    def test_truncation_between_opened_metadata_and_read_is_refused(self):
        data=b'owned synthetic original'
        with self.owned_file(data) as path:
            def truncate():
                with path.open('r+b') as file:file.truncate(3)
            with self.observe_real_read(before_read=truncate) as observed,self.assertRaises(R.SafetyError) as caught:
                I.fixed(path)
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            self.assertEqual(observed[1],[3])

    def test_same_bytes_path_replacement_after_open_is_refused(self):
        data=b'owned synthetic original'
        with self.owned_file(data) as path:
            replacement=path.with_name('replacement.bin');replacement.write_bytes(data);replacement.chmod(0o600)
            with self.observe_real_read(before_read=lambda:replacement.replace(path)) as observed,self.assertRaises(R.SafetyError) as caught:
                I.fixed(path)
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            self.assertEqual(observed[1],[len(data)])

    def test_same_size_mutation_after_read_is_refused(self):
        data=b'owned synthetic original'
        with self.owned_file(data) as path:
            with self.observe_real_read(after_read=lambda:path.write_bytes(b'x'*len(data))),self.assertRaises(R.SafetyError) as caught:
                I.fixed(path)
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')

    def test_same_bytes_replacement_between_lstat_and_open_is_refused(self):
        data=b'owned synthetic original'
        with self.owned_file(data) as path:
            replacement=path.with_name('replacement.bin');replacement.write_bytes(data);replacement.chmod(0o600);original=I.os.open
            def replaced(name,flags):replacement.replace(path);return original(name,flags)
            with patch.object(I.os,'open',side_effect=replaced),self.assertRaises(R.SafetyError) as caught:I.fixed(path)
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')

    def test_existing_size_symlink_and_hardlink_limits_still_refuse(self):
        data=b'owned synthetic original'
        for change in ('oversize','symlink','hardlink'):
            with self.subTest(change=change),self.owned_file(data) as path:
                maximum=len(data)-1 if change=='oversize' else len(data)
                if change=='symlink':
                    target=path.with_name('target.bin');path.replace(target);path.symlink_to(target)
                if change=='hardlink':I.os.link(path,path.with_name('alias.bin'))
                with self.assertRaises(R.SafetyError) as caught:I.fixed(path,maximum=maximum)
                self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')

if __name__=='__main__':unittest.main()
