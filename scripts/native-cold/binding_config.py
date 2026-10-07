"""Exact original CI-generated nonsecret config retention; no credential/environment access."""
import hashlib,json,re
from pathlib import Path
import supervisor as R

CASES={'builtin-dual','cold1','cold2'}
KEYS={'status','sha256','expectedSHA256','pinsPlatform','pinsArch'}
STATUSES={'READ_MATCHED','READ_HASH_MISMATCH','EXPECTED_HASH_INVALID'}
PLATFORMS={'linux','darwin'}
ARCHES={'x64','arm64'}

def digest(value):return type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None

def project(value):
 value=value if type(value) is dict else {}
 enum=lambda key,allowed:value.get(key) if type(value.get(key)) is str and value[key] in allowed else 'UNKNOWN'
 return {'status':enum('status',STATUSES),'sha256':value.get('sha256') if digest(value.get('sha256')) else None,
  'expectedSHA256':value.get('expectedSHA256') if digest(value.get('expectedSHA256')) else None,
  'pinsPlatform':enum('pinsPlatform',PLATFORMS),'pinsArch':enum('pinsArch',ARCHES)}

def observation_valid(value):
 return type(value) is dict and set(value)==KEYS and value==project(value) and value['status'] in STATUSES

def read_matched(value):
 return observation_valid(value) and value['status']=='READ_MATCHED' and digest(value['sha256']) and value['sha256']==value['expectedSHA256'] and value['pinsPlatform'] in PLATFORMS and value['pinsArch'] in ARCHES

def matches(value,retained):
 return read_matched(value) and type(retained) is dict and value['sha256']==retained.get('sha256') and value['pinsPlatform']==retained.get('parentPinsPlatform') and value['pinsArch']==retained.get('parentPinsArch')

def read_bytes(path):
 R.require(R.regular(path),'BINDING_CONFIG_FILE_REFUSED')
 fd=R.os.open(path,R.os.O_RDONLY|R.os.O_NOFOLLOW|R.os.O_NONBLOCK)
 with R.os.fdopen(fd,'rb') as file:
  info=R.os.fstat(file.fileno());R.require(R.stat.S_ISREG(info.st_mode) and info.st_size<=16384,'BINDING_CONFIG_FILE_REFUSED')
  raw=file.read(16385)
 R.require(len(raw)<=16384,'BINDING_CONFIG_FILE_REFUSED');return raw

def audit(raw,ctx,source):
 def pairs(items):
  value={}
  for key,item in items:R.require(key not in value,'BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED');value[key]=item
  return value
 try:value=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
 except (ValueError,TypeError,RecursionError):raise R.SafetyError('BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED') from None
 pins=ctx['pins'];key={('linux','x64'):'linux-x64',('darwin','arm64'):'darwin-arm64'}.get((pins.get('platform'),pins.get('arch')))
 R.require(key is not None and pins==json.loads((Path(__file__).parent/'platforms.json').read_text())[key],'BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED')
 expected={'source':str(source),'pins':pins,'installed':{'current':str(ctx['current']),'recordSHA256':ctx['installationRecordSHA256'],
  'sdkManifestSHA256':ctx['installation']['sdkManifestSHA256'],'packageSHA256':ctx['installation']['packageSHA256'],'head':ctx['head'],'tree':ctx['tree']}}
 R.require(all(digest(expected['installed'][key]) for key in ('recordSHA256','sdkManifestSHA256','packageSHA256')) and
  all(type(expected['installed'][key]) is str and re.fullmatch('[0-9a-f]{40}',expected['installed'][key]) for key in ('head','tree')),'BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED')
 R.require(type(value) is dict and value==expected,'BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED')
 return value

def retain(root,ctx,case,source):
 R.require(case in CASES,'CASE_REFUSED');path=root/'binding-config.json';raw=read_bytes(path);value=audit(raw,ctx,source)
 destination=ctx['evidence']/(case+'-binding-config.json');receipt=ctx['evidence']/(case+'-binding-config-receipt.json')
 sha256=hashlib.sha256(raw).hexdigest()
 R.atomic_create_bytes(destination,raw,rollback_on_failure=True)
 R.require(read_bytes(destination)==raw and read_bytes(path)==raw,'BINDING_CONFIG_CHANGED_REFUSED')
 result={'status':'RETAINED_ORIGINAL_SAFE_BYTES','file':destination.name,'sha256':sha256,'bytes':len(raw),
  'parentPinsPlatform':value['pins']['platform'],'parentPinsArch':value['pins']['arch'],'exactOriginalBytes':True,
  'audit':'EXACT_PUBLIC_PINS_AND_VERIFIED_SYNTHETIC_PATH_SCHEMA','reconstructed':False}
 R.atomic_create(receipt,result,rollback_on_failure=True)
 return result
