"""Synthetic files and bytes only. No SDK/Node children or network."""
import copy,hashlib,json,os,stat,tempfile,unittest
from contextlib import contextmanager
from pathlib import Path,PosixPath
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

class PrefixPathTests(unittest.TestCase):
    @contextmanager
    def owned(self):
        with tempfile.TemporaryDirectory(prefix='dsh-prefix-tests-',dir='/tmp') as d:
            yield Path(d).resolve(strict=True)

    def write(self,path,data):
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);path.chmod(0o600)

    def installation(self,root):
        source=root/'source';sdk=source/'node_modules/synthetic-sdk';sdk.mkdir(parents=True)
        self.write(source/'package-lock.json',json.dumps({'packages':{'node_modules/synthetic-sdk':{'version':'1.0.0','integrity':'sha512-synthetic-fixture'}}}).encode())
        self.write(sdk/'package.json',b'{"name":"synthetic-sdk","version":"1.0.0"}');self.write(sdk/'index.js',b'owned synthetic SDK; never executed')
        current=root/'current';product=current/'product';(product/'src').mkdir(parents=True)
        (product/'node_modules').symlink_to(source/'node_modules',target_is_directory=True)
        data=b'owned synthetic product; never executed';self.write(product/'src/index.js',data)
        manifest=json.dumps(I.sdk_inventory(source)).encode();self.write(current/'sdk-manifest.json',manifest)
        self.write(current/'build.json',b'{}');self.write(current/'archive.tgz',b'owned synthetic archive')
        record={'sourceHead':'a'*40,'sourceTree':'b'*40,'sourceWorktreeClean':True,'sdkManifest':'sdk-manifest.json','sdkManifestSHA256':hashlib.sha256(manifest).hexdigest(),
                'buildManifest':'build.json','buildManifestSHA256':hashlib.sha256(b'{}').hexdigest(),'tarball':'archive.tgz','packageSHA256':hashlib.sha256(b'owned synthetic archive').hexdigest(),
                'files':[{'path':'src/index.js','bytes':len(data),'mode':0o600,'sha256':hashlib.sha256(data).hexdigest()}],'testFiles':[]}
        raw=json.dumps(record).encode();self.write(current/'installation-record.json',raw)
        ctx={'current':current,'installation':record,'installationRecordSHA256':hashlib.sha256(raw).hexdigest(),'head':record['sourceHead'],'tree':record['sourceTree']}
        return source,sdk,product,ctx,raw

    def test_unicode_binary_prefix_collision_and_complete_rows(self):
        values={'a.json':b'root','a/z.js':bytes(range(256))*9,'space name.js':b'space','中文.json':b'unicode','é.js':b'accent','e\u0301.mjs':b'combined','empty.js':b''}
        with self.owned() as root:
            for path,data in values.items():self.write(root/path,data)
            rows=I.files_under(root,True)
            self.assertEqual([row['path'] for row in rows],sorted(values,key=lambda value:value.encode()))
            self.assertEqual(rows,[{'path':name,'bytes':len(values[name]),'sha256':hashlib.sha256(values[name]).hexdigest(),'mode':0o600} for name in sorted(values,key=lambda value:value.encode())])

    def test_standard_tree_avoids_per_entry_relative_construction(self):
        with self.owned() as root:
            self.write(root/'a.js',b'owned');self.write(root/'nested/b.js',b'owned')
            original=PosixPath.relative_to;observed=[]
            def relative(path,*args,**kwargs):observed.append(path);return original(path,*args,**kwargs)
            with patch.object(PosixPath,'relative_to',relative):rows=I.files_under(root)
            self.assertEqual([row['path'] for row in rows],['a.js','nested/b.js'])
            self.assertEqual(observed,[])

    def test_deep_directory_names_have_no_leading_root_separator(self):
        with self.owned() as root:
            name='/'.join(['depth']*32+['file.js']);self.write(root/name,b'owned depth')
            self.assertEqual([row['path'] for row in I.files_under(root)],[name])

    def test_empty_alias_and_relative_roots_preserve_original_boundary(self):
        with self.owned() as parent:
            root=parent/'tree';root.mkdir();self.assertEqual(I.files_under(root),[])
            alias=parent/'alias';alias.symlink_to(root,target_is_directory=True)
            with self.assertRaises(R.SafetyError) as caught:I.files_under(alias)
            self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            previous=Path.cwd()
            try:
                os.chdir(parent)
                with self.assertRaises(R.SafetyError) as caught:I.files_under(Path('tree'))
                self.assertEqual(caught.exception.code,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            finally:os.chdir(previous)

    def test_path_subclass_keeps_relative_and_as_posix_behavior(self):
        events=[]
        class CompatiblePath(PosixPath):
            def relative_to(self,*args,**kwargs):events.append('relative');return super().relative_to(*args,**kwargs)
            def as_posix(self):events.append('as_posix');return 'observed/'+super().as_posix()
        with self.owned() as root:
            self.write(root/'file.js',b'owned subclass')
            self.assertEqual([row['path'] for row in I.files_under(CompatiblePath(root))],['observed/file.js'])
            self.assertEqual(events,['relative','as_posix'])

    def test_path_like_root_keeps_fspath_compatibility(self):
        events=[]
        class PathLikeRoot:
            def __init__(self,path):self.path=path
            def __fspath__(self):events.append('fspath');return str(self.path)
            def is_dir(self):return self.path.is_dir()
            def is_symlink(self):return self.path.is_symlink()
            def resolve(self,strict=False):
                if self.path.resolve(strict=strict)==self.path:return self
                raise AssertionError('owned root unexpectedly noncanonical')
            def iterdir(self):return self.path.iterdir()
        with self.owned() as root:
            self.write(root/'file.js',b'owned pathlike')
            self.assertEqual([row['path'] for row in I.files_under(PathLikeRoot(root))],['file.js'])
            self.assertEqual(events,['fspath'])

    def test_non_direct_entries_keep_original_relative_or_outside_error(self):
        for outside in (False,True):
            with self.subTest(outside=outside),self.owned() as parent:
                root=parent/'tree';root.mkdir();path=parent/'outside.js' if outside else root/'nested/file.js';self.write(path,b'owned non-direct')
                originalIter=PosixPath.iterdir;originalRelative=PosixPath.relative_to;observed=[]
                def entries(directory):return iter([path]) if directory==root else originalIter(directory)
                def relative(value,*args,**kwargs):observed.append(value);return originalRelative(value,*args,**kwargs)
                with patch.object(PosixPath,'iterdir',entries),patch.object(PosixPath,'relative_to',relative):
                    if outside:
                        with self.assertRaises(ValueError):I.files_under(root)
                    else:self.assertEqual([row['path'] for row in I.files_under(root)],['nested/file.js'])
                self.assertEqual(observed,[path])

    def test_subclass_child_of_standard_root_keeps_custom_computation(self):
        events=[]
        class CompatibleChild(PosixPath):
            def relative_to(self,*args,**kwargs):events.append('relative');return super().relative_to(*args,**kwargs)
            def as_posix(self):events.append('as_posix');return 'child/'+super().as_posix()
        with self.owned() as root:
            self.write(root/'file.js',b'owned child');child=CompatibleChild(root/'file.js');original=PosixPath.iterdir
            def entries(directory):return iter([child]) if directory==root else original(directory)
            with patch.object(PosixPath,'iterdir',entries):rows=I.files_under(root)
            self.assertEqual([row['path'] for row in rows],['child/file.js']);self.assertEqual(events,['relative','as_posix'])

    def test_all_file_resolves_opens_fstats_and_full_hashes_remain(self):
        with self.owned() as root:
            values={'a.js':b'owned binary\x00\xff','nested/b.js':b'owned other'}
            for path,data in values.items():self.write(root/path,data)
            originals=(PosixPath.resolve,os.open,os.fstat,hashlib.sha256);resolved=[];opened=[];fstats=[];hashed=[]
            def resolve(path,*args,**kwargs):resolved.append(path);return originals[0](path,*args,**kwargs)
            def open_file(path,flags,*args,**kwargs):opened.append((path,flags));return originals[1](path,flags,*args,**kwargs)
            def fstat(fd):fstats.append(fd);return originals[2](fd)
            def digest(data=b'',*args,**kwargs):hashed.append(data);return originals[3](data,*args,**kwargs)
            with patch.object(PosixPath,'resolve',resolve),patch.object(os,'open',open_file),patch.object(os,'fstat',fstat),patch.object(hashlib,'sha256',digest):I.files_under(root)
            self.assertEqual(len(resolved),4);self.assertEqual(len(opened),2);self.assertEqual(len(fstats),4)
            self.assertTrue(all(flags & os.O_NOFOLLOW and flags & os.O_NONBLOCK for _,flags in opened))
            self.assertEqual(hashed,[values['a.js'],values['nested/b.js']])

    def test_full_check_avoids_relative_construction_and_retains_record_reopen(self):
        with self.owned() as root:
            source,_,_,ctx,_=self.installation(root);record=ctx['current']/'installation-record.json'
            originalRelative=PosixPath.relative_to;originalFixed=I.fixed;originalBytes=Path.read_bytes;relativeCalls=[];protected=[];reopened=[]
            def relative(path,*args,**kwargs):relativeCalls.append(path);return originalRelative(path,*args,**kwargs)
            def fixed(path,*args,**kwargs):
                if Path(path)==record:protected.append(path)
                return originalFixed(path,*args,**kwargs)
            def read_bytes(path):
                if path==record:reopened.append(path)
                return originalBytes(path)
            with patch.object(PosixPath,'relative_to',relative),patch.object(I,'fixed',fixed),patch.object(Path,'read_bytes',read_bytes):result=I.check(ctx,source)
            self.assertEqual(result['sourceHead'],ctx['head']);self.assertEqual(len(protected),1);self.assertEqual(len(reopened),1)
            self.assertEqual(relativeCalls,[])

    def test_record_changes_after_protected_read_still_stop_at_second_read(self):
        for change in ('growth','truncate','replace','delete','symlink'):
            with self.subTest(change=change),self.owned() as root:
                source,_,_,ctx,raw=self.installation(root);record=ctx['current']/'installation-record.json';original=I.fixed;fired=[]
                def fixed(path,*args,**kwargs):
                    result=original(path,*args,**kwargs)
                    if Path(path)==record and not fired:
                        fired.append(True)
                        if change=='growth':self.write(record,raw+b' ')
                        elif change=='truncate':
                            with record.open('r+b') as file:file.truncate(3)
                        elif change=='replace':
                            other=record.with_name('replacement.json');self.write(other,raw+b' ');other.replace(record)
                        elif change=='delete':record.unlink()
                        else:
                            other=record.with_name('target.json');self.write(other,raw+b' ');record.unlink();record.symlink_to(other.name)
                    return result
                with patch.object(I,'fixed',fixed):
                    if change=='delete':
                        with self.assertRaises(FileNotFoundError):I.check(ctx,source)
                    else:
                        with self.assertRaises(R.SafetyError) as caught:I.check(ctx,source)
                        self.assertEqual(caught.exception.code,'INSTALLATION_RECORD_CHANGED_REFUSED')
                self.assertEqual(fired,[True])

    def test_fresh_calls_reject_changed_added_removed_or_aliased_files(self):
        for change in ('sdk-change','sdk-add','sdk-remove','sdk-symlink','product-change','product-add','product-remove','product-symlink'):
            with self.subTest(change=change),self.owned() as root:
                source,sdk,product,ctx,_=self.installation(root);I.check(ctx,source)
                if change=='sdk-change':self.write(sdk/'index.js',b'owned changed SDK')
                elif change=='sdk-add':self.write(sdk/'added.js',b'owned added SDK')
                elif change=='sdk-remove':(sdk/'index.js').unlink()
                elif change=='sdk-symlink':(sdk/'index.js').unlink();(sdk/'index.js').symlink_to('package.json')
                elif change=='product-change':
                    path=product/'src/index.js';data=path.read_bytes();self.write(path,bytes([data[0]^1])+data[1:])
                elif change=='product-add':self.write(product/'src/added.js',b'owned added product')
                elif change=='product-remove':(product/'src/index.js').unlink()
                else:
                    self.write(product/'owned-target.js',b'owned synthetic alias target');(product/'src/index.js').unlink();(product/'src/index.js').symlink_to('../owned-target.js')
                if change=='product-remove':
                    with self.assertRaises(FileNotFoundError):I.check(ctx,source)
                else:
                    with self.assertRaises(R.SafetyError) as caught:I.check(ctx,source)
                    expected='INSTALLED_CONTENT_IDENTITY_REFUSED' if change in {'sdk-symlink','product-symlink'} else 'INSTALLED_PRODUCT_CHANGED_REFUSED' if change in {'product-change','product-add'} else 'SDK_BUNDLE_CHANGED_REFUSED'
                    self.assertEqual(caught.exception.code,expected)

if __name__=='__main__':unittest.main()
