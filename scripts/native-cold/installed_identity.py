"""Pure read-only public SDK/current-installation identity. Never launch Node or SDK."""
import errno,hashlib,json,os,pathlib,re,stat,sys,types
from pathlib import Path,PosixPath
from functools import lru_cache
import supervisor as R

_FAST_POSIX=sys.implementation.name=='cpython' and sys.version_info[:2]==(3,12) and hasattr(os.path,'_joinrealpath')
_VALID_PATH=re.compile(r'(?!(?:\.{1,2})(?:/|$))[^/\\\t\r\n\x00]+(?:/(?!(?:\.{1,2})(?:/|$))[^/\\\t\r\n\x00]+)*')
_SDK_SUFFIXES=('.js','.mjs','.cjs','.json','.wasm')
_POSIX_MEMBERS=PosixPath.__dict__
_PATH_MEMBERS=Path.__dict__

_PATH_CODE_SHA256={
    'iterdir':'1fdd935c3653b6e5321324e1ecf2f2792f6a670a33857905837d296173e61e4d',
    'stat':'16cc8b5a4b4757f23bd611e1ddcb3b784f031f18edd57376590d629facb321ac',
    'lstat':'f3ccf22149a1ac2857dd543851eabad929ff0bd5dedadd398a233dfc5d643fc8',
    'is_dir':'16d9327835765192304253bbfd4c158eca7b596a5c37de6fb629a1994b062a7e',
    'is_file':'9a30aebdbfcb9f830897f3d1f1c5088ba5e712c9b60bdfe85ac313077e213ed7',
    'is_symlink':'6daaccb38bbe0c7bc3d2691566a86c87ee43c6820a2391a2c34de33130ff6146',
    'resolve':'d3096335bb76cf1d7b0888828ab0c775b31ed40712eb3869e5f35b06debbffaa',
}

def _path_code_signature(code):
    constants=[_path_code_signature(value) if type(value) is types.CodeType else value for value in code.co_consts]
    if constants and type(constants[0]) is str:constants[0]=None
    return [code.co_code.hex(),code.co_exceptiontable.hex(),code.co_names,code.co_varnames,code.co_argcount,code.co_posonlyargcount,code.co_kwonlyargcount,code.co_flags,code.co_stacksize,code.co_freevars,code.co_cellvars,constants]

def _raw_path_method(name):
    # Live namespace views avoid invoking unknown descriptors just to inspect
    # them. All recognized methods are defined by Path or overridden by PosixPath.
    try:return _POSIX_MEMBERS[name] if name in _POSIX_MEMBERS else _PATH_MEMBERS[name]
    except KeyError:return None

def _standard_path_method(name):
    """Recognize the concrete 3.12 stdlib code, never an import-time replacement.

    Fingerprints omit locations and optional docstrings, but include bytecode,
    exception tables, constants and call shape. Unknown patch versions fall
    back. This checks pure code only and adds no filesystem observations.
    """
    method=_raw_path_method(name)
    if not _FAST_POSIX or type(method) is not types.FunctionType or method.__globals__ is not vars(pathlib) or method.__module__!='pathlib' or method.__qualname__!='Path.'+name:return None
    try:digest=hashlib.sha256(json.dumps(_path_code_signature(method.__code__),separators=(',',':')).encode()).hexdigest()
    except (TypeError,ValueError):return None
    return method if digest==_PATH_CODE_SHA256[name] else None

_STANDARD_METHODS={name:_standard_path_method(name) for name in _PATH_CODE_SHA256}
_STANDARD_CODES={name:method.__code__ if method is not None else None for name,method in _STANDARD_METHODS.items()}

@lru_cache(maxsize=32768)
def lexical_prefixes(spelling):
    """Cache immutable strings only; no filesystem observations or resolution."""
    if spelling=='/':return ()
    if spelling.count('/')>128:
        return tuple(spelling[:match.start()] for match in re.finditer('/',spelling) if match.start())+(spelling,)
    parent=spelling.rpartition('/')[0] or '/'
    return lexical_prefixes(parent)+(spelling,)

def canonical(path):
    """Fresh strict resolution, with less lexical work on standard 3.12 POSIX paths.

    Every ancestor is still lstat'ed in the runtime resolver's order. Only the
    string joins and the final already-canonical Path construction are elided.
    The runtime's own recursive resolver handles links with the same current
    ancestor, remaining suffix, and per-resolution link state. Other runtimes
    and custom paths retain their original resolve implementation.
    """
    standard_resolve=_STANDARD_METHODS['resolve'] is not None and _raw_path_method('resolve') is _STANDARD_METHODS['resolve'] and _STANDARD_METHODS['resolve'].__code__ is _STANDARD_CODES['resolve'] and _STANDARD_METHODS['resolve'].__globals__.get('os') is os
    if type(path) is not PosixPath or not _FAST_POSIX or not standard_resolve:
        return path.resolve(strict=True)==path
    spelling=str(path)
    if not spelling.startswith('/') or '//' in spelling or spelling!='/' and spelling.endswith('/') or '/..' in spelling:
        return path.resolve(strict=True)==path
    prefixes=lexical_prefixes(spelling)
    try:
        for index,entry in enumerate(prefixes):
            observed=os.lstat(entry)
            if stat.S_ISLNK(observed.st_mode):
                parent=prefixes[index-1] if index else '/'
                seen={entry:None}
                resolved,ok=os.path._joinrealpath(parent,os.readlink(entry),True,seen)
                rest=spelling[len(entry)+1:]
                if not ok:resolved=os.path.join(resolved,rest)
                else:
                    seen[entry]=resolved
                    resolved,_=os.path._joinrealpath(resolved,rest,True,seen)
                return Path(os.path.abspath(resolved))==path
    except OSError as error:
        if error.errno==errno.ELOOP:raise RuntimeError('Symlink loop from %r'%error.filename)
        raise
    return True

def fixed(path,maximum=512*1024*1024):
    path=path if type(path) is PosixPath else Path(path);before=path.lstat()
    R.require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=maximum and canonical(path),'INSTALLED_CONTENT_IDENTITY_REFUSED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as file:
        opened=os.fstat(file.fileno());R.require((opened.st_dev,opened.st_ino,opened.st_size)==(before.st_dev,before.st_ino,before.st_size),'INSTALLED_CONTENT_IDENTITY_REFUSED')
        data=file.read(before.st_size+1);after=os.fstat(file.fileno());last=path.lstat()
    R.require(len(data)==before.st_size and (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)==(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) and (last.st_dev,last.st_ino,last.st_size)==(before.st_dev,before.st_ino,before.st_size),'INSTALLED_CONTENT_IDENTITY_REFUSED')
    return data,stat.S_IMODE(before.st_mode),hashlib.sha256(data).hexdigest()

def safe(path):
    return type(path) is str and 0<len(path)<1024 and _VALID_PATH.fullmatch(path) is not None

def files_under(root,sdk=False):
    rows=[];inspected=0;total=0
    def walk(directory,prefix=None):
        nonlocal inspected,total
        R.require(directory.is_dir() and not directory.is_symlink() and canonical(directory),'INSTALLED_CONTENT_IDENTITY_REFUSED')
        directory_text=str(directory) if prefix is not None and type(directory) is PosixPath else None
        entries=sorted(directory.iterdir(),key=lambda p:p.name.encode())
        for path in entries:
            inspected+=1;R.require(inspected<=100000,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            if sdk and path.name=='.bin':continue
            direct=directory_text is not None and type(path) is PosixPath and (str(path).rpartition('/')[0] or '/')==directory_text
            rel=(prefix+'/' if prefix else '')+path.name if direct else path.relative_to(root).as_posix()
            R.require(safe(rel) and not path.is_symlink(),'INSTALLED_CONTENT_IDENTITY_REFUSED')
            if path.is_dir():walk(path,rel if direct else None)
            else:
                R.require(path.is_file(),'INSTALLED_CONTENT_IDENTITY_REFUSED')
                if not sdk or rel.endswith(_SDK_SUFFIXES):
                    data,mode,digest=fixed(path);total+=len(data);R.require(total<=2*1024**3 and len(rows)<50000,'INSTALLED_CONTENT_IDENTITY_REFUSED')
                    rows.append({'path':rel,'bytes':len(data),'sha256':digest,'mode':mode})
    walk(root,'' if type(root) is PosixPath else None);return sorted(rows,key=lambda r:r['path'].encode())

def sdk_inventory(source):
    data,_,digest=fixed(source/'package-lock.json',4*1024*1024);lock=json.loads(data);packages=[]
    for path,pin in sorted(lock['packages'].items(),key=lambda r:r[0].encode()):
        if not path:continue
        R.require(safe(path) and path.startswith('node_modules/'),'INSTALLED_CONTENT_IDENTITY_REFUSED')
        directory=source/path
        if not directory.exists():R.require(pin.get('optional') is True,'INSTALLED_CONTENT_IDENTITY_REFUSED');continue
        metadata=json.loads(fixed(directory/'package.json',1024*1024)[0]);name=pin.get('name',path[path.rfind('node_modules/')+13:])
        R.require(metadata['name']==name and metadata['version']==pin['version'] and type(pin.get('integrity')) is str,'INSTALLED_CONTENT_IDENTITY_REFUSED')
        packages.append({'path':path,'name':metadata['name'],'version':metadata['version'],'integrity':pin['integrity']})
    rows=files_under(source/'node_modules',True);R.require(0<len(packages)<=2000 and rows,'INSTALLED_CONTENT_IDENTITY_REFUSED')
    return {'schemaVersion':1,'scope':'LOCKED_INSTALLED_SDK_CONTENT','lockSHA256':digest,'packages':packages,'files':rows}

def check(ctx,source):
    current=ctx['current'];record=json.loads(fixed(current/'installation-record.json',1024*1024)[0])
    R.require(R.sha(current/'installation-record.json')==ctx['installationRecordSHA256'] and record==ctx['installation'],'INSTALLATION_RECORD_CHANGED_REFUSED')
    sdk_bytes,_,sdk_sha=fixed(current/record['sdkManifest'],8*1024*1024)
    R.require(sdk_sha==record['sdkManifestSHA256'] and json.loads(sdk_bytes)==sdk_inventory(source),'SDK_BUNDLE_CHANGED_REFUSED')
    R.require(record['sourceHead']==ctx['head'] and record['sourceTree']==ctx['tree'] and record['sourceWorktreeClean'] is True,'INSTALLATION_SOURCE_REFUSED')
    R.require(fixed(current/record['buildManifest'],1024*1024)[2]==record['buildManifestSHA256'] and fixed(current/record['tarball'],64*1024*1024)[2]==record['packageSHA256'],'PACKAGE_ARCHIVE_CHANGED_REFUSED')
    product=current/'product';R.require((product/'node_modules').is_symlink() and (product/'node_modules').resolve(strict=True)==source/'node_modules','SDK_LINK_CHANGED_REFUSED')
    names=set()
    for row in record['files']+record['testFiles']:
        R.require(safe(row['path']) and row['path'] not in names,'INSTALLED_PRODUCT_CHANGED_REFUSED');names.add(row['path'])
        data,mode,digest=fixed(product/row['path'],64*1024*1024);R.require(len(data)==row['bytes'] and mode==row['mode'] and digest==row['sha256'],'INSTALLED_PRODUCT_CHANGED_REFUSED')
    for row in files_under(product/'src'):R.require('src/'+row['path'] in names,'INSTALLED_PRODUCT_CHANGED_REFUSED')
    return {'sdkManifestSHA256':sdk_sha,'packageSHA256':record['packageSHA256'],'sourceHead':ctx['head'],'sourceTree':ctx['tree'],'checkedBefore':True,'checkedAfter':True}
