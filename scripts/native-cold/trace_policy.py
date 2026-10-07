import copy,datetime,re
import supervisor as R
import ledger as LEG
import builtin_policy as B
import binding_config as BC
from supervisor import require,SafetyError,TRACE_KEYS,CODES,REFUSALS
STAGES=R.STAGES|{"NATIVE_ADMISSION_REFUSED"}
EXTRA_KEYS={'systemLoads','narbLoads','narbInfoQueries','narbRequireCalls','narbCalls','terminalRefusalCategory','installedIdentity','preflightBoundary','bindingConfig'}
TERMINAL_CATEGORIES_EXTRA={'NATIVE_LOCK_BOUNDARY_REFUSED','NATIVE_LOCK_CALLBACK_REFUSED','NATIVE_LOCK_RESULT_REFUSED','DNS_GUARD_INSTALL_REFUSED','DNS_GUARD_BINDING_REFUSED','INSTALLED_CONTENT_IDENTITY_REFUSED'}

TERMINAL_CATEGORIES={'OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED','NARB_API_LIMIT_REFUSED','NARB_ARGUMENT_REFUSED','NARB_INFO_LIMIT_REFUSED','NARB_MODULE_REFUSED','NARB_REQUIRE_LIMIT_REFUSED','NARB_API_REFUSED','NARB_CALL_FAILED','NARB_BINDING_INFO_REFUSED','NARB_MODULE_RESULT_REFUSED','NATIVE_EXPORT_SURFACE_REFUSED','NATIVE_WRAP_FAILED','ORIGINAL_DLOPEN_FAILED','OBSERVATION_COMMIT_REFUSED'}|REFUSALS|{'MODEL_OPERATION_REFUSED','MODEL_GUARD_BINDING_REFUSED'}

def core_trace_valid(value,expected_pid):
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'TRACE_SCHEMA_REFUSED');value[key]=item
        return value
    def integer(value,limit):return type(value) is int and 0<=value<=limit
    def stamp(value):
        if type(value) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z',value) is None:return False
        try:datetime.datetime.strptime(value,'%Y-%m-%dT%H:%M:%S.%fZ');return True
        except ValueError:return False
    try:
        require(type(value) is dict and set(value)==TRACE_KEYS,'TRACE_SCHEMA_REFUSED')
        require(type(value['pid']) is int and value['pid']==expected_pid and 0<expected_pid<2**31,'TRACE_SCHEMA_REFUSED')
        for key in ['setupReady','explicitApprovedAddonFlag','environmentRestricted','sqliteGuardVerified','resolveCompleted','nativeFdOwned']:
            require(type(value[key]) is bool,'TRACE_SCHEMA_REFUSED')
        for key in ['resolveAgentPresent','nativeFdClosedBeforeExit']:
            require(value[key] is None or type(value[key]) is bool,'TRACE_SCHEMA_REFUSED')
        for key in ['startUTC','endUTC','resolveStartUTC','resolveEndUTC','nativeCallStartUTC','nativeCallEndUTC']:
            require(stamp(value[key]) if key=='startUTC' else value[key] is None or stamp(value[key]),'TRACE_SCHEMA_REFUSED')
        for key in ['resolveCalls','nativeLoads','nativeCalls']:require(integer(value[key],1),'TRACE_SCHEMA_REFUSED')
        for key in ['nativeLoadAttempts','networkAttempts','spawnAttempts','workerAttempts','sqliteConstructAttempts']:require(integer(value[key],64),'TRACE_SCHEMA_REFUSED')
        require(value['modelAttempts'] is None or integer(value['modelAttempts'],64),'TRACE_SCHEMA_REFUSED')
        require(value['nativeCallbackErrno'] is None or integer(value['nativeCallbackErrno'],65535),'TRACE_SCHEMA_REFUSED')
        require(type(value['stage']) is str and value['stage'] in STAGES,'TRACE_SCHEMA_REFUSED')
        require(all(type(value[key]) is str and value[key] in CODES for key in ['outerErrorCode','setupFailureCode']),'TRACE_SCHEMA_REFUSED')
        require(value['targetSHA256']==NATIVE_SHA and type(value['nativeReturnCategory']) is str and value['nativeReturnCategory'] in {'UNRECORDED','LOCK_ACQUIRED','SYSCALL_ERROR'},'TRACE_SCHEMA_REFUSED')
        require(type(value['boundaryRefusals']) is list and len(value['boundaryRefusals'])<=32 and all(type(v) is str and v in REFUSALS for v in value['boundaryRefusals']),'TRACE_SCHEMA_REFUSED')
        require(LEG.native_ledger_valid(value),'TRACE_SCHEMA_REFUSED')
        identity=value['nativeFdIdentity']
        require(identity is None or type(identity) is dict and set(identity)=={'device','inode'} and all(integer(identity[k],2**64-1) for k in identity),'TRACE_SCHEMA_REFUSED')
        if value['nativeCalls']==1:
            require(value['nativeFdOwned'] and identity is not None and stamp(value['nativeCallStartUTC']),'TRACE_SCHEMA_REFUSED')
            if value['nativeCallEndUTC'] is None:
                require(value['nativeCallbackErrno'] is None and value['nativeReturnCategory']=='UNRECORDED','TRACE_SCHEMA_REFUSED')
            else:
                require(integer(value['nativeCallbackErrno'],65535) and value['nativeReturnCategory']==('LOCK_ACQUIRED' if value['nativeCallbackErrno']==0 else 'SYSCALL_ERROR'),'TRACE_SCHEMA_REFUSED')
        else:require(not value['nativeFdOwned'] and identity is None and value['nativeCallStartUTC'] is None and value['nativeCallEndUTC'] is None and value['nativeCallbackErrno'] is None and value['nativeReturnCategory']=='UNRECORDED' and value['nativeFdClosedBeforeExit'] is None,'TRACE_SCHEMA_REFUSED')
        require(value['nativeCalls']<=value['nativeLoads']<=value['nativeLoadAttempts'],'TRACE_SCHEMA_REFUSED')
        if value['resolveCalls']==0:
            require(not value['resolveCompleted'] and value['resolveAgentPresent'] is None and value['resolveStartUTC'] is None and value['resolveEndUTC'] is None,'TRACE_SCHEMA_REFUSED')
        else:
            require(stamp(value['resolveStartUTC']),'TRACE_SCHEMA_REFUSED')
            require(type(value['resolveAgentPresent']) is bool and stamp(value['resolveEndUTC']) if value['resolveCompleted'] else value['resolveAgentPresent'] is None and value['outerErrorCode']=='UNRECORDED','TRACE_SCHEMA_REFUSED')
        for begin,finish in [('startUTC','endUTC'),('resolveStartUTC','resolveEndUTC'),('nativeCallStartUTC','nativeCallEndUTC')]:
            if value[finish] is not None:require(value[begin] is not None and value[begin]<=value[finish],'TRACE_SCHEMA_REFUSED')
        for key in ['resolveStartUTC','resolveEndUTC','nativeCallStartUTC','nativeCallEndUTC']:
            if value[key] is not None:require(value['startUTC']<=value[key] and (value['endUTC'] is None or value[key]<=value['endUTC']),'TRACE_SCHEMA_REFUSED')
        if value['nativeCalls']==1:
            require(value['resolveCalls']==1 and value['resolveStartUTC']<=value['nativeCallStartUTC'],'TRACE_SCHEMA_REFUSED')
            if value['resolveEndUTC'] is not None:require(value['nativeCallEndUTC'] is None or value['nativeCallEndUTC']<=value['resolveEndUTC'],'TRACE_SCHEMA_REFUSED')
        if value['stage'] in {'PROCESS_EXIT','SETUP_FAILED_EXIT','GUARD_PREFLIGHT_COMPLETE','NATIVE_ADMISSION_REFUSED'}:
            require(value['endUTC'] is not None and value['setupReady']==(value['stage']=='PROCESS_EXIT'),'TRACE_SCHEMA_REFUSED')
            if value['nativeCalls']==1:require(type(value['nativeFdClosedBeforeExit']) is bool,'TRACE_SCHEMA_REFUSED')
        else:require(value['endUTC'] is None and value['nativeFdClosedBeforeExit'] is None,'TRACE_SCHEMA_REFUSED')
        if value['stage']=='GUARD_PREFLIGHT_COMPLETE':require(not value['setupReady'] and value['setupFailureCode']=='NONE' and value['sqliteGuardVerified'] and value['environmentRestricted'] and not value['explicitApprovedAddonFlag'] and value['nativeLoadAttempts']==value['nativeLoads']==value['nativeCalls']==value['resolveCalls']==0,'TRACE_SCHEMA_REFUSED')
        if value['setupReady']:require(value['setupFailureCode']=='NONE' and value['sqliteGuardVerified'] and value['environmentRestricted'] and value['explicitApprovedAddonFlag'],'TRACE_SCHEMA_REFUSED')
        return 'TRACE_VALID',{key:value[key] for key in TRACE_KEYS}
    except (OSError,ValueError,TypeError,KeyError,RecursionError,SafetyError):return 'TRACE_INVALID',None


def project_core(t):
 v={k:copy.deepcopy(t[k]) for k in TRACE_KEYS};events=[]
 for event in t['nativeAttempts']:
  if event['targetId']=='SYSTEM':
   e={k:copy.deepcopy(event[k]) for k in ['index','admission','reason','outcome','identity']};e['index']=len(events)+1;events.append(e)
 v['nativeAttempts']=events;v['nativeLoadAttempts']=len(events);v['nativeLoads']=t['systemLoads'];return v


def trace_valid(t,pid):
 try:
  require(type(t) is dict and set(t)==TRACE_KEYS|EXTRA_KEYS,'DUAL_TRACE_SCHEMA_REFUSED')
  require(B.boundary_valid(t['preflightBoundary']),'PREFLIGHT_OBSERVATION_SCHEMA_REFUSED')
  require(BC.observation_valid(t['bindingConfig']),'BINDING_CONFIG_OBSERVATION_REFUSED')
  integer=lambda x,max:type(x) is int and 0<=x<=max
  require(all(integer(t[k],limit) for k,limit in [('systemLoads',1),('narbLoads',1),('narbInfoQueries',2),('narbRequireCalls',1),('nativeLoads',2),('nativeLoadAttempts',3)]),'DUAL_TRACE_COUNTER_REFUSED')
  require(t['terminalRefusalCategory'] is None or t['terminalRefusalCategory'] in TERMINAL_CATEGORIES|TERMINAL_CATEGORIES_EXTRA,'DUAL_TRACE_ENUM_REFUSED')
  installed=t['installedIdentity']
  if installed is not None:
   require(type(installed) is dict and set(installed)=={'sdkManifestSHA256','packageSHA256','sourceHead','sourceTree','checkedBefore','checkedAfter'},'INSTALLED_TRACE_REFUSED')
   require(all(type(installed[k]) is str and re.fullmatch('[0-9a-f]{64}',installed[k]) for k in ['sdkManifestSHA256','packageSHA256']) and all(type(installed[k]) is str and re.fullmatch('[0-9a-f]{40}',installed[k]) for k in ['sourceHead','sourceTree']),'INSTALLED_TRACE_REFUSED')
   require(type(installed['checkedBefore']) is bool and type(installed['checkedAfter']) is bool,'INSTALLED_TRACE_REFUSED')
  events=t['nativeAttempts'];require(type(events) is list and len(events)==t['nativeLoadAttempts'],'DUAL_TRACE_LEDGER_REFUSED');loaded={'SYSTEM':0,'NARB':0};allowed=set()
  for index,e in enumerate(events,1):
   require(type(e) is dict and set(e)=={'index','targetId','admission','reason','outcome','identity'} and type(e['index']) is int and e['index']==index and e['targetId'] in {'SYSTEM','NARB','UNKNOWN'},'DUAL_TRACE_LEDGER_REFUSED')
   identity=e['identity'];require(type(identity) is dict and set(identity)==LEG.NATIVE_ID_KEYS,'DUAL_IDENTITY_REFUSED')
   require(identity['scope'] in {'KNOWN_SOURCE','OWNED_ROOT','UNKNOWN'} and identity['pathRelation'] in {'EXACT_ALLOWED_PATH','ALLOWED_PATH_ALIAS','OTHER_FILE','UNKNOWN'} and type(identity['isPathAlias']) in {bool,type(None)} and identity['unknownReason'] in LEG.NATIVE_UNKNOWN_REASONS|{'NONE'},'DUAL_IDENTITY_REFUSED')
   digest=identity['contentSHA256'];require(digest is None or type(digest) is str and re.fullmatch('[0-9a-f]{64}',digest),'DUAL_IDENTITY_REFUSED');known=LEG.NATIVE_HASH_IDENTITIES.get(digest)
   require((identity['packageIdentity'],identity['payloadIdentity'])==(known if known else ('UNKNOWN','UNKNOWN')),'DUAL_IDENTITY_REFUSED')
   require(e['admission'] in {'ALLOW','DENY','PENDING'} and e['reason'] in {'NONE','OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED','ORIGINAL_DLOPEN_FAILED','NATIVE_WRAP_FAILED'} and e['outcome'] in {'NOT_CALLED','IN_PROGRESS','LOADED','LOAD_FAILED','LOADED_WRAP_FAILED'},'DUAL_TRACE_ENUM_REFUSED')
   if e['admission']=='ALLOW':
    role=e['targetId'];require(role in {'SYSTEM','NARB'} and role not in allowed,'DUAL_TRACE_LOAD_REFUSED');allowed.add(role)
    expected=(PINS[0]["sha256"],'EXACT_ALLOWED_PATH',{'KNOWN_SOURCE'}) if role=='SYSTEM' else (PINS[1]["sha256"],'OTHER_FILE',{'KNOWN_SOURCE','OWNED_ROOT'})
    require(digest==expected[0] and identity['pathRelation']==expected[1] and identity['scope'] in expected[2] and identity['isPathAlias'] is False and identity['unknownReason']=='NONE','DUAL_TRACE_LOAD_REFUSED')
    if e['outcome'].startswith('LOADED'):loaded[role]+=1
   elif e['admission']=='DENY':require(e['outcome']=='NOT_CALLED' and index==len(events) and t['terminalRefusalCategory'] is not None,'DUAL_TRACE_DENIAL_REFUSED')
  require(loaded['SYSTEM']==t['systemLoads'] and loaded['NARB']==t['narbLoads'] and sum(loaded.values())==t['nativeLoads'],'DUAL_TRACE_COUNTER_REFUSED')
  calls=t['narbCalls'];require(type(calls) is list and len(calls)<=4,'DUAL_API_LEDGER_REFUSED');info=0;req=0
  for index,e in enumerate(calls,1):
   require(type(e) is dict and set(e)=={'index','api','moduleId','admission','outcome'} and type(e['index']) is int and e['index']==index and e['api'] in {'getNativeBindingInfo','requireBuiltin','isAllowedInternalId'} and e['moduleId'] in {'NONE','INTERNAL_ESM_LOADER'} and e['admission'] in {'ALLOW','DENY'} and e['outcome'] in {'NOT_CALLED','IN_PROGRESS','RETURNED','CALL_FAILED'},'DUAL_API_LEDGER_REFUSED')
   if e['admission']=='ALLOW':
    require(e['api']!='isAllowedInternalId' and (e['api']=='getNativeBindingInfo' and e['moduleId']=='NONE' or e['api']=='requireBuiltin' and e['moduleId']=='INTERNAL_ESM_LOADER'),'DUAL_API_LEDGER_REFUSED')
    info+=e['api']=='getNativeBindingInfo';req+=e['api']=='requireBuiltin'
   else:require(index==len(calls) and e['outcome']=='NOT_CALLED' and t['terminalRefusalCategory'] is not None,'DUAL_API_LEDGER_REFUSED')
  require(info==t['narbInfoQueries'] and req==t['narbRequireCalls'],'DUAL_API_COUNTER_REFUSED')
  return core_trace_valid(project_core(t),pid)[0]=='TRACE_VALID'
 except (KeyError,TypeError,ValueError,RecursionError,SafetyError):return False


def cold_eligible(*,trace,counts,diagnostics,returncode,stopped,complete,errors,pins):
 if not trace_valid(trace,trace.get('pid') if type(trace) is dict else None) or errors or not pins or not stopped or not complete or returncode!=0:return False
 if not B.boundary_passed(trace['preflightBoundary']):return False
 if not BC.read_matched(trace['bindingConfig']) or trace['bindingConfig']['pinsPlatform']!=PLATFORM or trace['bindingConfig']['pinsArch']!=ARCH:return False
 if trace['terminalRefusalCategory'] is not None or trace['nativeLoadAttempts']!=2 or trace['narbLoads']!=1 or trace['systemLoads']!=1 or trace['narbInfoQueries']!=2 or trace['narbRequireCalls']!=1:return False
 if trace['installedIdentity'] is None or trace['installedIdentity']['checkedBefore'] is not True or trace['installedIdentity']['checkedAfter'] is not True:return False
 if any(e['admission']!='ALLOW' or e['outcome']!='LOADED' or e['reason']!='NONE' for e in trace['nativeAttempts']):return False
 if any(e['admission']!='ALLOW' or e['outcome']!='RETURNED' for e in trace['narbCalls']):return False
 if counts.get('tests')!=1 or counts.get('pass')!=1 or counts.get('fail')!=0 or counts.get('cancelled')!=0 or len(diagnostics)!=1:return False
 d=diagnostics[0]
 if trace['resolveAgentPresent'] is not True or d.get('agentPresent') is not True or d.get('modelIOZero') is not True or d.get('errorCode')!=trace['outerErrorCode'] or d.get('errorLayer') in {'FILESYSTEM_PERMISSION','NATIVE_ADDON_PERMISSION'}:return False
 return successful_core(project_core(trace)) and counts.get('skipped')==0



def successful_core(t):
    native_known=t['nativeCalls']==1 and t['nativeCallEndUTC'] and t['nativeFdClosedBeforeExit'] is True and t['nativeCallbackErrno']==0 and t['nativeReturnCategory']=='LOCK_ACQUIRED'
    return bool(t['stage']=='PROCESS_EXIT' and t['setupFailureCode']=='NONE' and t['setupReady'] and t['explicitApprovedAddonFlag'] and t['environmentRestricted'] and t['sqliteGuardVerified'] and t['resolveCalls']==1 and t['resolveCompleted'] and t['endUTC'] and t['resolveEndUTC'] and native_known and t['networkAttempts']==t['spawnAttempts']==t['workerAttempts']==t['sqliteConstructAttempts']==t['modelAttempts']==0 and not t['boundaryRefusals'])

def configure(pins):
    global PINS,NATIVE_SHA,PLATFORM,ARCH
    PLATFORM=pins['platform'];ARCH=pins['arch']
    PINS=pins['bindings'];NATIVE_SHA=PINS[0]['sha256']
    LEG.NATIVE_GLIBC_PIN=NATIVE_SHA
    LEG.NATIVE_HASH_IDENTITIES={r['sha256']:(r['package'],r['payloadIdentity']) for r in PINS}
