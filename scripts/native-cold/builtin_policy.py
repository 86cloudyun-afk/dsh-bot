import datetime,json,re
import supervisor as R
CASES={"builtin-dual":74}
FORBIDDEN_MARKERS=['original-loader-tripwire.json','identity-io-tripwire.json','fake-original-loader-ran.json','caller-catch-ran.json','exit-listener-ran.json','patched-exit-ran.json','fallback-returned.json','second-load-attempted.json']

ASSERTION_IDS={'C_SQLITE_ESM_IMPORT', 'C_IO_GUARDS_INSTALL', 'C_SQLITE_DESCRIPTOR_REQUIRED', 'C_SQLITE_DENY_BINDING_INSTALL', 'C_BUILTIN_EXPORT_SYNC', 'C_SQLITE_CJS_IMPORT', 'H_PUBLIC_EXIT_POISON', 'C_BOUNDARY_PREFLIGHT', 'H_FIRST_DENIED_DLOPEN', 'T_EXIT_CAPABILITY_REQUIRED', 'H_FALLBACK_RETURNED', 'T_SYNTHETIC_LOADER_INSTALL', 'H_PROGRESS_WRITE', 'C_DLOPEN_GUARD_INSTALL', 'C_GUARD_READY_TRACE_COMMIT', 'H_EXIT_LISTENER_INSTALL', 'C_SQLITE_BINDING_IDENTITY_REQUIRED', 'H_CALLER_CATCH_REACHED', 'C_EXIT_CAPTURE', 'H_SECOND_LOAD_ATTEMPT', 'C_INITIAL_TRACE_COMMIT'}

LABEL_CODES={'ERR_ASSERTION','ERR_ACCESS_DENIED','ERR_DLOPEN_DISABLED','ERR_DLOPEN_FAILED','SQLITE_GUARD_BINDING_REFUSED','SQLITE_GUARD_INSTALL_REFUSED','IMMEDIATE_NATIVE_EXIT_UNAVAILABLE','UNRECORDED'}

def exact(a,b):return json.dumps(a,sort_keys=True,separators=(',',':'))==json.dumps(b,sort_keys=True,separators=(',',':'))


def stamp(value):
 if type(value) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z',value) is None:return False
 try:datetime.datetime.strptime(value,'%Y-%m-%dT%H:%M:%S.%fZ');return True
 except ValueError:return False


def read_fixed(path):
 R.require(R.regular(path),'BUILTIN_PROOF_JSON_REFUSED')
 fd=R.os.open(path,R.os.O_RDONLY|R.os.O_NOFOLLOW|R.os.O_NONBLOCK)
 with R.os.fdopen(fd,'rb') as file:
  info=R.os.fstat(file.fileno())
  R.require(R.stat.S_ISREG(info.st_mode) and info.st_size<=16384,'BUILTIN_PROOF_JSON_REFUSED')
  raw=file.read(16385)
 R.require(len(raw)<=16384,'BUILTIN_PROOF_JSON_REFUSED')
 def pairs(items):
  value={}
  for k,v in items:R.require(k not in value,'BUILTIN_PROOF_JSON_REFUSED');value[k]=v
  return value
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(R.SafetyError('BUILTIN_PROOF_JSON_REFUSED')))


def original_terminal_valid(t,pid,case):
 try:
  if case not in CASES or type(t) is not dict or type(pid) is not int or not 0<pid<2**31:return False
  if type(t.get('pid')) is not int or t['pid']!=pid or not stamp(t.get('startUTC')):return False
  cap=case=='cap-seed';fault=case=='commit-fault'
  if fault:
   expected={'pid':pid,'startUTC':t['startUTC'],'endUTC':None,'stage':'SYNTHETIC_READY','setupReady':False,'nativeLoadAttempts':0,'nativeLoads':0,'nativeCalls':0,'nativeAttempts':[],'boundaryRefusals':[],'modelAttempts':None,'scope':'SYNTHETIC_COMMIT_FAULT'}
   return exact(t,expected)
  if not stamp(t.get('endUTC')) or t['startUTC']>t['endUTC']:return False
  reason='ADDON_ATTEMPT_RECORD_LIMIT_REFUSED' if cap else 'OTHER_ADDON_LOAD_REFUSED'
  identity={'scope':'UNKNOWN','contentSHA256':None,'packageIdentity':'UNKNOWN','payloadIdentity':'UNKNOWN','pathRelation':'UNKNOWN','isPathAlias':None,'unknownReason':'ATTEMPT_RECORD_LIMIT' if cap else 'OUT_OF_SCOPE'}
  event={'index':17 if cap else 1,'admission':'DENY','reason':reason,'outcome':'NOT_CALLED','identity':identity}
  if cap:
   expected={'pid':pid,'startUTC':t['startUTC'],'endUTC':t['endUTC'],'stage':'NATIVE_ADMISSION_REFUSED','setupReady':False,'nativeLoadAttempts':17,'nativeLoads':0,'nativeCalls':0,'nativeAttempts':[event],'boundaryRefusals':[reason],'modelAttempts':None,'scope':'SYNTHETIC_SEEDED_COUNTER16'}
  else:
   expected={'pid':pid,'startUTC':t['startUTC'],'endUTC':t['endUTC'],'stage':'NATIVE_ADMISSION_REFUSED','setupReady':False,'explicitApprovedAddonFlag':False,'environmentRestricted':True,'sqliteGuardVerified':True,'resolveCalls':0,'resolveCompleted':False,'resolveStartUTC':None,'resolveEndUTC':None,'resolveAgentPresent':None,'outerErrorCode':'UNRECORDED','nativeLoadAttempts':1,'nativeLoads':0,'nativeAttempts':[event],'nativeCalls':0,'nativeCallStartUTC':None,'nativeCallEndUTC':None,'nativeCallbackErrno':None,'nativeReturnCategory':'UNRECORDED','nativeFdOwned':False,'nativeFdIdentity':None,'nativeFdClosedBeforeExit':None,'networkAttempts':0,'spawnAttempts':0,'workerAttempts':0,'sqliteConstructAttempts':0,'modelAttempts':None,'boundaryRefusals':[reason],'setupFailureCode':'NONE','targetSHA256':R.NATIVE_SHA}
  return exact(t,expected)
 except (TypeError,KeyError,ValueError,RecursionError):return False


def terminal_valid(t,pid,case):
 extra={'systemLoads':0,'narbLoads':0,'narbInfoQueries':0,'narbRequireCalls':0,'narbCalls':[],'terminalRefusalCategory':'OTHER_ADDON_LOAD_REFUSED','installedIdentity':None}
 if type(t) is not dict or not all(k in t and exact(t[k],v) for k,v in extra.items()):return False
 core={k:v for k,v in t.items() if k not in extra};events=core.get('nativeAttempts')
 if type(events) is not list or len(events)!=1:return False
 event=events[0]
 if type(event) is not dict or set(event)!={'index','targetId','admission','reason','outcome','identity'} or event['targetId']!='UNKNOWN':return False
 core['nativeAttempts']=[{k:v for k,v in event.items() if k!='targetId'}]
 return original_terminal_valid(core,pid,case)



def collect_journal(root,pid,case):
 # No returned filename or unvalidated payload enters durable evidence.
 allowed=set(BUNDLE_PINS)|set(FORBIDDEN_MARKERS)|{'builtin-progress.json','binding-config.json'}
 entries=list(root.iterdir());R.require(len(entries)<=208,'BUILTIN_JOURNAL_INVENTORY_REFUSED')
 grouped={role:[] for role in ['TARGET','ASSERTION','TRACE']}
 for entry in entries:
  if entry.name in allowed:R.require(R.regular(entry),'BUILTIN_JOURNAL_INVENTORY_REFUSED');continue
  match=re.fullmatch(r'builtin-observation-(TARGET|ASSERTION|TRACE)-([0-9]{4})',entry.name)
  R.require(match is not None and not entry.is_symlink() and R.stat.S_ISDIR(entry.lstat().st_mode),'BUILTIN_JOURNAL_INVENTORY_REFUSED')
  children=list(entry.iterdir());R.require(len(children)==1 and children[0].name=='record.json' and R.regular(children[0]),'BUILTIN_JOURNAL_INVENTORY_REFUSED')
  role=match[1];sequence=int(match[2]);R.require(1<=sequence<=64,'BUILTIN_JOURNAL_SEQUENCE_REFUSED');grouped[role].append((sequence,children[0]))
 values={};statuses={};counts={};valid=True
 for role,items in grouped.items():
  items.sort();counts[role]=len(items)
  R.require([seq for seq,_ in items]==list(range(1,len(items)+1)),'BUILTIN_JOURNAL_SEQUENCE_REFUSED')
  R.require(role!='TARGET' or len(items)<=1,'BUILTIN_JOURNAL_SEQUENCE_REFUSED')
  statuses[role]=role+'_MISSING';records=[]
  for seq,path in items:
   try:
    e=read_fixed(path)
    R.require(type(e) is dict and set(e)=={'schemaVersion','scope','durability','pid','case','role','sequence','payload'} and type(e['schemaVersion']) is int and e['schemaVersion']==1 and e['scope']=='ISOLATED_NATIVE_TEST_ONLY' and e['durability']=='NON_DURABLE' and type(e['pid']) is int and e['pid']==pid and e['case']==case and e['role']==role and type(e['sequence']) is int and e['sequence']==seq and type(e['payload']) is dict and type(e['payload'].get('pid')) is int and e['payload']['pid']==pid,'BUILTIN_JOURNAL_ENVELOPE_REFUSED')
    R.require(role!='TRACE' or seq==len(items) or e['payload'].get('stage')!='NATIVE_ADMISSION_REFUSED','BUILTIN_JOURNAL_TERMINAL_ORDER_REFUSED')
    records.append(e['payload'])
   except (R.SafetyError,ValueError,TypeError,RecursionError):statuses[role]=role+'_INVALID';valid=False;records=[];break
   except BaseException:statuses[role]=role+'_READ_FAILED';valid=False;records=[];break
  if records:values[role]=records[-1];statuses[role]=role+'_PRESENT'
 return values,statuses,{'inventoryValid':valid,'recordCounts':counts,'pendingPresent':False,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE','productionDurabilityEstablished':False,'sameUIDHostileRaceGuarantee':False}
