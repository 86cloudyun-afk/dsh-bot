"""Pure read-only public SDK/current-installation identity. Never launch Node or SDK."""
import hashlib,json,os,re,stat
from pathlib import Path,PosixPath
import supervisor as R

def fixed(path,maximum=512*1024*1024):
    path=Path(path);before=path.lstat()
    R.require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=maximum and path.resolve(strict=True)==path,'INSTALLED_CONTENT_IDENTITY_REFUSED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as file:
        opened=os.fstat(file.fileno());R.require((opened.st_dev,opened.st_ino,opened.st_size)==(before.st_dev,before.st_ino,before.st_size),'INSTALLED_CONTENT_IDENTITY_REFUSED')
        data=file.read(before.st_size+1);after=os.fstat(file.fileno());last=path.lstat()
    R.require(len(data)==before.st_size and (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)==(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) and (last.st_dev,last.st_ino,last.st_size)==(before.st_dev,before.st_ino,before.st_size),'INSTALLED_CONTENT_IDENTITY_REFUSED')
    return data,stat.S_IMODE(before.st_mode),hashlib.sha256(data).hexdigest()

def safe(path):
    return type(path) is str and 0<len(path)<1024 and not re.search(r'[\\\t\r\n\x00]',path) and not path.startswith('/') and all(p not in {'','.', '..'} for p in path.split('/'))

def files_under(root,sdk=False):
    rows=[];inspected=0;total=0
    def walk(directory,prefix=None):
        nonlocal inspected,total
        R.require(directory.is_dir() and not directory.is_symlink() and directory.resolve(strict=True)==directory,'INSTALLED_CONTENT_IDENTITY_REFUSED')
        for path in sorted(directory.iterdir(),key=lambda p:p.name.encode()):
            inspected+=1;R.require(inspected<=100000,'INSTALLED_CONTENT_IDENTITY_REFUSED')
            if sdk and path.name=='.bin':continue
            direct=prefix is not None and type(path) is PosixPath and path.parent==directory
            rel=(prefix+'/' if prefix else '')+path.name if direct else path.relative_to(root).as_posix()
            R.require(safe(rel) and not path.is_symlink(),'INSTALLED_CONTENT_IDENTITY_REFUSED')
            if path.is_dir():walk(path,rel if direct else None)
            else:
                R.require(path.is_file(),'INSTALLED_CONTENT_IDENTITY_REFUSED')
                if not sdk or re.search(r'\.(js|mjs|cjs|json|wasm)$',rel):
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
