"""Pin every prepared material byte and verify fresh pnpm store content addresses."""
from pathlib import Path
import argparse, datetime, hashlib, json, re, sqlite3
parser=argparse.ArgumentParser()
parser.add_argument('--materials',type=Path,required=True)
args=parser.parse_args()
root=args.materials.resolve()
store=root/'pnpm-store/v11/files'
checked=0
for path in store.glob('*/*'):
    expected=path.parent.name+path.name.removesuffix('-exec')
    if not re.fullmatch('[a-f0-9]{128}',expected) or not path.is_file() or path.is_symlink():
        raise SystemExit('Unexpected public store file')
    with path.open('rb') as inp:
        actual=hashlib.file_digest(inp,'sha512').hexdigest()
    if actual!=expected:
        raise SystemExit('Public store content-address mismatch')
    checked+=1
connection=sqlite3.connect('file:'+str(root/'pnpm-store/v11/index.db')+'?mode=ro',uri=True)
package_keys=[item[0] for item in connection.execute('select key from package_index order by key')]
connection.close()
(root/'public-store-verification.json').write_text(json.dumps({'freshStoreFilesChecked':checked,'sha512ContentAddressesMatch':True,
    'indexPackageCount':len(package_keys),'packageIndexKeys':package_keys,'oldCacheOrHomeUsed':False},indent=2)+'\n')
files=[]
for path in sorted(root.rglob('*')):
    if path.name=='MATERIALS.json' or path.is_dir():
        continue
    if not path.is_file() or path.is_symlink():
        raise SystemExit('Non-file material payload')
    with path.open('rb') as inp:
        digest=hashlib.file_digest(inp,'sha256').hexdigest()
    files.append({'path':str(path.relative_to(root)),'sha256':digest,'bytes':path.stat().st_size,'mode':path.stat().st_mode&0o777})
manifest={'format':1,'classification':'PRIVATE_COLD_BUILD_INPUTS_NOT_PUBLIC_DISTRIBUTION_APPROVAL',
    'publicBaseCommit':'639ed015397290b3745d163aafe02ffee4aa3f84','sourceMaterialCommit':'616b511b4358dd7c173601816fc1f79f92f2a010',
    'createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localPatchRights':'UNKNOWN',
    'privateHomeProfileCredentialsOrRetainedHostRuntimeIncluded':False,'publicDependencyStorePreparedDuringThisTask':True,
    'fileCount':len(files),'bytes':sum(item['bytes'] for item in files),'files':files}
data=(json.dumps(manifest,indent=2)+'\n').encode()
(root/'MATERIALS.json').write_bytes(data)
print(json.dumps({'fileCount':len(files),'bytes':manifest['bytes'],'storeFileCount':checked,
                  'materialManifestSha256':hashlib.sha256(data).hexdigest()}))
