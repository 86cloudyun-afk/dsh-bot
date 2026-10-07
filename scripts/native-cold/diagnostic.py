"""Pure fixed-field observer; no launch, SDK import or raw-stream persistence."""
import hashlib
import re
import signal

CODE_CATEGORIES={'ERR_ACCESS_DENIED':'NODE_PERMISSION_REFUSAL','ERR_MODULE_NOT_FOUND':'DEPENDENCY_RESOLUTION','MODULE_NOT_FOUND':'DEPENDENCY_RESOLUTION','ERR_DLOPEN_DISABLED':'NATIVE_ADDON_PERMISSION','ERR_DLOPEN_FAILED':'NATIVE_ADDON_LOAD_FAILED','ERR_INVALID_ARG_VALUE':'NODE_ARGUMENT_ERROR','ERR_INVALID_ARG_TYPE':'NODE_ARGUMENT_ERROR','ERR_TEST_FAILURE':'TEST_RUNNER_FAILURE','ERR_ASSERTION':'ASSERTION_FAILURE','DSH_DUMMY_PRELOAD_FAILURE':'SYNTHETIC_PRELOAD_FAILURE'}
FIXED_STAGES=frozenset(['COMPANION_STARTED','ONE_NATIVE_LOCK_STARTED','ONE_EXISTING_RESOLVE_STARTED','READY_FOR_ONE_ORIGINAL_TEST','PROCESS_EXIT','SETUP_FAILED_EXIT','COMPANION_SETUP_FAILED','DUMMY_GUARD_READY','DUMMY_TEST_COMPLETE','GUARD_PREFLIGHT_COMPLETE'])

# Fixed Node v24.19.0 error fields. Raw text is inspected only in memory.
# No eval, path canonicalization, filesystem probe, raw path/message/stack output.
PERMISSION_NAMES=frozenset(['FileSystem','FileSystemRead','FileSystemWrite','ChildProcess','WorkerThreads','WASI','Inspector','Addon'])
PERMISSION_RESOURCE_IDS={
 'native-admission-immediate-stop-builtin-tripwire-v2-20261006.mjs':'TRIPWIRE_V2',
 'cold_native_attempt_companion_v6_20261006.mjs':'COMPANION_V6',
 'native-admission-immediate-stop-builtin-harness-v2-20261006.mjs':'HARNESS_V2',
 'native_admission_immediate_stop_v1_20261006.mjs':'STOP_V1',
 'cold_native_attempt_identity_v3_20261006.mjs':'IDENTITY_V3',
 'builtin-target.json':'TARGET_JSON','builtin-target.json.pending':'TARGET_PENDING',
 'builtin-assertion.json':'ASSERTION_JSON','builtin-assertion.json.pending':'ASSERTION_PENDING',
 'builtin-progress.json':'PROGRESS_JSON','safe-runtime-trace.json':'TRACE_JSON',
 'safe-runtime-trace.json.pending':'TRACE_PENDING','package.json':'OWNED_PACKAGE_JSON',
}
PERMISSION_TYPED_LIMIT=16384
_PermissionFlags={'FileSystemRead':'--allow-fs-read','FileSystemWrite':'--allow-fs-write','ChildProcess':'--allow-child-process','WorkerThreads':'--allow-worker','WASI':'--allow-wasi','Inspector':'--allow-inspector','Addon':'--allow-addons'}
_PermissionHeaders={}
for _prefix in ['Error: ','Error [ERR_ACCESS_DENIED]: ']:
 for _message in ['Access to this API has been restricted','Access to this API has been restricted.']:
  _PermissionHeaders[_prefix+_message]=None
 for _scope,_flag in _PermissionFlags.items():
  _PermissionHeaders[_prefix+'Access to this API has been restricted. Use '+_flag+' to manage permissions.']=_scope
_PermissionRefusalReasons=frozenset(['ERROR_CODE_NOT_PERMISSION','STDERR_TYPED_PARSE_LIMIT','INVALID_UTF8','CONTROL_TEXT_REFUSED','AMBIGUOUS_PERMISSION_BLOCK','AMBIGUOUS_ERROR_CODE','FIXED_NODE_TEMPLATE_MISSING','FIXED_NODE_BLOCK_INVALID','HEADER_PERMISSION_MISMATCH','COLLECTION_FAILURE','DIAGNOSTIC_INTERNAL_FAILURE'])
def unknown_safe_permission(reason,observed_phase=None):
 if reason not in _PermissionRefusalReasons:reason='DIAGNOSTIC_INTERNAL_FAILURE'
 return {'parseStatus':'NOT_APPLICABLE' if reason=='ERROR_CODE_NOT_PERMISSION' else 'REFUSED','permission':'UNKNOWN','resourceScope':'UNKNOWN','resourceId':'UNKNOWN','canonicalRelation':'UNKNOWN_NOT_PROBED','operation':'UNKNOWN','operationEvidence':'UNKNOWN','childStage':observed_phase if type(observed_phase) is str and observed_phase in FIXED_STAGES else 'UNKNOWN','unknownReasons':[reason],'parseEvidence':'IN_MEMORY_FIXED_NODE_TEXT_PARSE_ONLY','actualFSProbe':False}
def _permission_literal(raw,kind):
 limit=64 if kind=='PERMISSION' else 1024
 if raw is None:return None,kind+'_FIELD_MISSING'
 if len(raw)>limit+2:return None,kind+'_TOO_LONG'
 if len(raw)<2 or raw[0] not in "'\"":return None,kind+'_NON_STRING'
 if raw[-1]!=raw[0]:return None,kind+'_INVALID_LITERAL'
 value=raw[1:-1]
 if '\\' in value or raw[0] in value or any(ord(c)<32 or ord(c)>126 for c in value):return None,kind+'_INVALID_LITERAL'
 return value,None
def safe_permission_diagnostic(stderr,error_code,owned_root=None,observed_phase=None):
 if len(stderr)>PERMISSION_TYPED_LIMIT:return unknown_safe_permission('STDERR_TYPED_PARSE_LIMIT',observed_phase)
 if error_code!='ERR_ACCESS_DENIED':return unknown_safe_permission('ERROR_CODE_NOT_PERMISSION',observed_phase)
 try:text=stderr.decode('utf-8','strict')
 except UnicodeDecodeError:return unknown_safe_permission('INVALID_UTF8',observed_phase)
 if any((ord(c)<32 and c not in '\r\n\t') or 127<=ord(c)<=159 or c in '\u2028\u2029' for c in text):return unknown_safe_permission('CONTROL_TEXT_REFUSED',observed_phase)
 lines=text.splitlines()
 headers=[i for i,line in enumerate(lines) if line.removesuffix(' {').rstrip() in _PermissionHeaders]
 codes=[i for i,line in enumerate(lines) if re.fullmatch(r"  code: (?:'ERR_ACCESS_DENIED'|\"ERR_ACCESS_DENIED\"),?",line)]
 if len(headers)>1 or len(codes)>1:return unknown_safe_permission('AMBIGUOUS_PERMISSION_BLOCK',observed_phase)
 if len(headers)!=1 or len(codes)!=1:return unknown_safe_permission('FIXED_NODE_TEMPLATE_MISSING',observed_phase)
 h,c=headers[0],codes[0]
 if not h<c or c-h>40 or not lines[c-1].endswith(' {'):return unknown_safe_permission('FIXED_NODE_BLOCK_INVALID',observed_phase)
 fields={};i=c+1
 while i<len(lines) and lines[i]!='}':
  match=re.fullmatch(r'  (permission|resource):(?: (.*))?',lines[i])
  if match is None or match[1] in fields:return unknown_safe_permission('FIXED_NODE_BLOCK_INVALID',observed_phase)
  name,raw=match[1],match[2];i+=1
  if raw is None or raw=='':
   if i>=len(lines) or not lines[i].startswith('    ') or lines[i].startswith('     '):return unknown_safe_permission('FIXED_NODE_BLOCK_INVALID',observed_phase)
   raw=lines[i][4:];i+=1
  fields[name]=raw.removesuffix(',')
 if i>=len(lines) or any(line.strip() and line!='Node.js v24.19.0' for line in lines[i+1:]):return unknown_safe_permission('FIXED_NODE_BLOCK_INVALID',observed_phase)
 result=unknown_safe_permission('DIAGNOSTIC_INTERNAL_FAILURE',observed_phase);result['unknownReasons']=[]
 permission,reason=_permission_literal(fields.get('permission'),'PERMISSION')
 if reason:result['unknownReasons'].append(reason)
 elif permission not in PERMISSION_NAMES:result['unknownReasons'].append('PERMISSION_NOT_WHITELISTED')
 else:result['permission']=permission
 expected=_PermissionHeaders[lines[h].removesuffix(' {').rstrip()]
 if expected is not None and result['permission']!='UNKNOWN' and result['permission']!=expected:return unknown_safe_permission('HEADER_PERMISSION_MISMATCH',observed_phase)
 resource,reason=_permission_literal(fields.get('resource'),'RESOURCE')
 if reason:result['unknownReasons'].append(reason)
 elif re.fullmatch(r'[A-Za-z0-9_./-]+',resource) is None:result['unknownReasons'].append('RESOURCE_INVALID_LITERAL')
 elif not resource.startswith('/'):result['unknownReasons'].append('RESOURCE_NOT_ABSOLUTE')
 elif '//' in resource or any(x in {'.','..'} for x in resource.split('/')):result['unknownReasons'].append('RESOURCE_NONCANONICAL_TEXT')
 elif type(owned_root) is not str or re.fullmatch(r'/[A-Za-z0-9_/-]+',owned_root) is None or owned_root.endswith('/') or '//' in owned_root or any(x in {'.','..'} for x in owned_root.split('/')):result['unknownReasons'].append('OWNED_ROOT_CONTEXT_MISSING')
 elif resource==owned_root:result.update(resourceScope='OWNED_ROOT',resourceId='OWNED_ROOT_DIRECTORY')
 elif resource.startswith(owned_root+'/'):
  result['resourceScope']='OWNED_ROOT';result['resourceId']=PERMISSION_RESOURCE_IDS.get(resource[len(owned_root)+1:],'UNKNOWN')
  if result['resourceId']=='UNKNOWN':result['unknownReasons'].append('UNKNOWN_OWNED_RESOURCE')
 else:result['resourceScope']='OUTSIDE_OWNED_ROOT';result['unknownReasons'].append('OUTSIDE_OWNED_ROOT')
 if result['permission'] in {'FileSystem','FileSystemRead','FileSystemWrite'}:
  operation_names={'openSync':'FS_OPEN_SYNC','renameSync':'FS_RENAME_SYNC','realpathSync':'FS_REALPATH_SYNC','readFileSync':'FS_READ_FILE_SYNC','statSync':'FS_STAT_SYNC','lstatSync':'FS_LSTAT_SYNC','accessSync':'FS_ACCESS_SYNC'}
  for line in lines[h+1:c]:
   match=re.fullmatch(r'    at (?:Object\.)?(openSync|renameSync|realpathSync|readFileSync|statSync|lstatSync|accessSync) \(node:fs:[0-9]{1,6}:[0-9]{1,6}\)(?: \{)?',line)
   if match:result.update(operation=operation_names[match[1]],operationEvidence='FIXED_NODE_STDERR_FRAME_ONLY');break
   if re.fullmatch(r'    at (?:Object\.)?(?:getPackageScopeConfig|getNearestParentPackageJSON|read) \(node:internal/modules/package_json_reader:[0-9]{1,6}:[0-9]{1,6}\)(?: \{)?',line):result.update(operation='NODE_PACKAGE_SCOPE_CALLSITE',operationEvidence='FIXED_NODE_STDERR_FRAME_ONLY');break
 result['parseStatus']='PARSED' if result['permission']!='UNKNOWN' and result['resourceId']!='UNKNOWN' else 'PARTIAL'
 return result

def collect_startup(stdout,stderr,returncode,observed_phase=None,*,owned_root=None):
    category='NONE' if returncode==0 else 'UNCLASSIFIED_FAILURE'
    code='UNRECORDED';termination_signal=None;truncated=len(stderr)>1048576
    if returncode is None:category='CHILD_NOT_FINISHED'
    elif returncode<0:
        category='SIGNAL_TERMINATION'
        try:termination_signal=signal.Signals(-returncode).name
        except ValueError:termination_signal='UNRECORDED'
    elif truncated:category='TRUNCATED_STDERR_UNCLASSIFIED'
    else:
        text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',stderr.decode('utf-8','replace'))
        markers=set(re.findall(r'(?:Error|TypeError|SyntaxError) \[([A-Z_]+)\]:',text))
        markers.update(re.findall(r"^\s+code:\s*['\"]([A-Z_]+)['\"]",text,re.M))
        known=markers.intersection(CODE_CATEGORIES)
        if len(known)>1:category='AMBIGUOUS_FAILURE'
        elif known:code=next(iter(known));category=CODE_CATEGORIES[code]
        elif re.search(r'^(?:[^\r\n]{0,256}/)?node: bad option:',text,re.M):category='NODE_CLI_ARGUMENT_ERROR'
        elif re.search(r"^Could not find '[^\r\n]*'\r?$",text,re.M):category='NODE_TEST_INPUT_DISCOVERY'
    if isinstance(observed_phase,str) and observed_phase in FIXED_STAGES:
        stage=observed_phase;evidence='FIXED_CHILD_MARKER'
    elif observed_phase is None:
        stage='NODE_TEST_DISCOVERY' if category=='NODE_TEST_INPUT_DISCOVERY' else 'CHILD_STARTED_ONLY'
        evidence='FIXED_NODE_STDERR_MARKER' if category=='NODE_TEST_INPUT_DISCOVERY' else 'SUPERVISOR_ONLY'
    else:stage='UNRECORDED_CHILD_STAGE';evidence='CHILD_MARKER_UNRECOGNIZED'
    result={'startupErrorCategory':category,'startupErrorCode':code,'observedStage':stage,'stageEvidence':evidence,'terminationExitCode':returncode if returncode is not None and returncode>=0 else None,'terminationSignal':termination_signal,'rawStdoutSHA256':hashlib.sha256(stdout).hexdigest(),'rawStderrSHA256':hashlib.sha256(stderr).hexdigest(),'stdoutByteCount':len(stdout),'stderrByteCount':len(stderr),'classificationTruncated':truncated,'rawOutputSavedOrPrinted':False}
    result['safePermissionDiagnostic']=unknown_safe_permission('AMBIGUOUS_ERROR_CODE',observed_phase) if category=='AMBIGUOUS_FAILURE' else safe_permission_diagnostic(stderr,code,owned_root,observed_phase)
    return result
