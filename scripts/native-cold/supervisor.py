import datetime,hashlib,json,os,re,shutil,signal,stat,subprocess,tempfile,time
from pathlib import Path

def checked_node():
    require(regular(NODE) and sha(NODE)==NODE_SHA,'NODE_PIN_REFUSED')
    return NODE

ENV_KEYS={'DSH_HOME','DSH_BOT_TEST_ROOT','TMPDIR','TZ','LANG'}

CODES={'NONE','UNRECORDED','gateway/internal','ERR_ACCESS_DENIED','ERR_DLOPEN_DISABLED','ERR_DLOPEN_FAILED','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_ASSERTION','ERR_TEST_FAILURE','SQLITE_GUARD_BINDING_REFUSED','SQLITE_GUARD_INSTALL_REFUSED','SQLITE_CONSTRUCTION_REFUSED'}

REFUSALS={'PREFLIGHT_BOUNDARY_REFUSED','OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED','ADDON_ATTEMPT_RECORD_LIMIT_REFUSED','NATIVE_EXPORT_SURFACE_REFUSED','NATIVE_CALL_LIMIT_REFUSED','NATIVE_ARGUMENT_REFUSED','TEMP_FILE_INVENTORY_LIMIT_REFUSED','TEMP_SYMLINK_REFUSED','NON_SYNTHETIC_FD_REFUSED','SQLITE_CONSTRUCTION_REFUSED','NETWORK_OPERATION_REFUSED','CHILD_PROCESS_REFUSED','WORKER_REFUSED','SQLITE_GUARD_BINDING_REFUSED','SQLITE_GUARD_INSTALL_REFUSED','RESOLVE_GUARD_BINDING_REFUSED','RESOLVE_CALL_LIMIT_REFUSED'}

TRACE_KEYS={'pid','startUTC','endUTC','stage','setupReady','explicitApprovedAddonFlag','environmentRestricted','sqliteGuardVerified','resolveCalls','resolveCompleted','resolveStartUTC','resolveEndUTC','resolveAgentPresent','outerErrorCode','nativeLoadAttempts','nativeLoads','nativeAttempts','nativeCalls','nativeCallStartUTC','nativeCallEndUTC','nativeCallbackErrno','nativeReturnCategory','nativeFdOwned','nativeFdIdentity','nativeFdClosedBeforeExit','networkAttempts','spawnAttempts','workerAttempts','sqliteConstructAttempts','modelAttempts','boundaryRefusals','setupFailureCode','targetSHA256'}

STAGES={'COMPANION_STARTED','ONE_NATIVE_LOCK_STARTED','ONE_EXISTING_RESOLVE_STARTED','READY_FOR_ONE_ORIGINAL_TEST','PROCESS_EXIT','SETUP_FAILED_EXIT','COMPANION_SETUP_FAILED','GUARD_PREFLIGHT_COMPLETE'}

class SafetyError(Exception):
    def __init__(self,code):self.code=code;super().__init__(code)


class Capture(dict):
    """Raw streams stay in memory attributes and never enter JSON mappings."""
    stdout=b''
    stderr=b''


class SupervisorStop(BaseException):pass


class SupervisorSignals:
    """Observe stop signals throughout a case; interrupt only with a held child handle."""
    signals=(signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGQUIT)
    def __init__(self):self.received=None;self.interruptible=False;self.previous={}
    def handler(self,number,frame):
        if self.received is None:self.received=signal.Signals(number).name
        if self.interruptible:
            self.interruptible=False
            raise SupervisorStop()
    def __enter__(self):
        try:
            for number in self.signals:
                self.previous[number]=signal.getsignal(number);signal.signal(number,self.handler)
        except BaseException:
            self.__exit__(None,None,None);raise SafetyError('SIGNAL_GUARD_REFUSED') from None
        return self
    def __exit__(self,*unused):
        self.interruptible=False
        for number,handler in self.previous.items():signal.signal(number,handler)


def require(condition,code):
    if not condition:raise SafetyError(code)


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()


def regular(path):
    p=Path(path);return p.is_absolute() and not p.is_symlink() and p.resolve()==p and stat.S_ISREG(p.lstat().st_mode)


def synthetic_env(root):
    root=Path(root)
    require(root.is_absolute() and root.resolve()==root and root.is_dir() and not root.is_symlink(),'SYNTHETIC_ROOT_REFUSED')
    return {'DSH_HOME':str(root/'synthetic-empty-home'),'DSH_BOT_TEST_ROOT':str(root),'TMPDIR':str(root),'TZ':'UTC','LANG':'C'}


def atomic_create(path,value,*,rollback_on_failure=False):
    """Durable exclusive install. Never truncate an existing evidence file."""
    path=Path(path);temporary=None;installed=False
    try:
        fd,name=tempfile.mkstemp(prefix='.defensive-evidence-',dir=path.parent);temporary=Path(name)
        with os.fdopen(fd,'wb') as file:
            file.write((json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode());file.flush();os.fsync(file.fileno())
        os.link(temporary,path);installed=True
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    except BaseException as error:
        if installed and rollback_on_failure:
            try:path.unlink()
            except OSError:pass
        if isinstance(error,FileExistsError):raise SafetyError('ONE_SHOT_REFUSED') from None
        if isinstance(error,(OSError,TypeError,ValueError)):raise SafetyError('EVIDENCE_WRITE_FAILED') from None
        raise
    finally:
        if temporary is not None:
            try:temporary.unlink()
            except OSError:pass


def supervise_once(args,cwd,env,timeout=20,*,popen=subprocess.Popen,node_check=checked_node,on_started=None,allow_addons=False,supervisor_signals=None):
    result=Capture(childCreated=False,childPID=None,returncode=None,terminationExitCode=None,terminationSignal=None,processStopped=True,timedOut=False,terminated=False,killed=False,outputComplete=False,errorCategories=[])
    child=None;deadline=None;kill_reserve=0
    def remaining(reserve=0):return max(0,deadline-time.monotonic()-reserve)
    try:
        node=node_check();require(args[0]==str(node),'NODE_ARGUMENT_REFUSED')
        require('--permission' in args and (allow_addons or '--allow-addons' not in args),'GUARD_FLAGS_REFUSED')
        require(set(env)==ENV_KEYS and env==synthetic_env(Path(env['DSH_BOT_TEST_ROOT'])),'ENVIRONMENT_REFUSED')
        require(type(timeout) in (int,float) and 0<timeout<=20,'DEADLINE_REFUSED')
        require(supervisor_signals is None or supervisor_signals.received is None,'SUPERVISOR_SIGNAL')
        deadline=time.monotonic()+timeout;kill_reserve=min(1,timeout/4);stop_reserve=min(4,timeout/2)
        child=popen(args,cwd=cwd,env=dict(env),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        result.update(childCreated=True,childPID=child.pid,processStopped=False)
        if supervisor_signals is not None:
            if supervisor_signals.received is not None:raise SupervisorStop()
            supervisor_signals.interruptible=True
        if on_started is not None:on_started(child.pid)
        result.stdout,result.stderr=child.communicate(timeout=remaining(stop_reserve));result['outputComplete']=True
    except subprocess.TimeoutExpired:result['timedOut']=True;result['errorCategories'].append('TIMEOUT')
    except SupervisorStop:result['errorCategories'].append('SUPERVISOR_SIGNAL')
    except SafetyError as error:result['errorCategories'].append(error.code)
    except BaseException:result['errorCategories'].append('SUPERVISION_FAILURE' if child is not None else 'CHILD_CREATION_FAILED')
    finally:
        if supervisor_signals is not None:supervisor_signals.interruptible=False
        if child is not None:
            alive=True
            try:
                alive=child.poll() is None
            except BaseException:result['errorCategories'].append('CHILD_STATE_UNREADABLE')
            if alive:
                result['terminated']=True
                try:child.terminate()
                except ProcessLookupError:pass
                except BaseException:result['errorCategories'].append('TERMINATE_FAILED')
            if not result['outputComplete']:
                try:result.stdout,result.stderr=child.communicate(timeout=remaining(kill_reserve));result['outputComplete']=True
                except BaseException:
                    result['killed']=True
                    try:child.kill()
                    except ProcessLookupError:pass
                    except BaseException:result['errorCategories'].append('KILL_FAILED')
                    try:result.stdout,result.stderr=child.communicate(timeout=remaining());result['outputComplete']=True
                    except BaseException:result['errorCategories'].append('TERMINAL_SUPERVISION_FAILURE')
            try:
                result['returncode']=child.poll()
                if result['returncode'] is not None:
                    try:os.kill(child.pid,0)
                    except ProcessLookupError:result['processStopped']=True
            except BaseException:pass
            if not result['processStopped']:result['errorCategories'].append('PROCESS_STOP_UNVERIFIED')
    result['terminationExitCode']=result['returncode'] if result['returncode'] is not None and result['returncode']>=0 else None
    if result['returncode'] is not None and result['returncode']<0:
        try:result['terminationSignal']=signal.Signals(-result['returncode']).name
        except ValueError:result['terminationSignal']='UNRECORDED'
    return result


def persist_and_cleanup(root,receipt,completion,record,stopped,eligible,*,writer=atomic_create,remover=shutil.rmtree):
    out={'status':'DIAGNOSTIC_WRITE_FAILED','diagnosticPersisted':False,'temporaryDirectoryRemoved':False,'safeToRunOtherApprovedCase':False}
    try:writer(receipt,record);out['diagnosticPersisted']=True;out['diagnosticSHA256']=sha(receipt)
    except BaseException:return out
    out['status']='PROCESS_STOP_UNVERIFIED'
    if stopped:
        try:remover(root);out['temporaryDirectoryRemoved']=not Path(root).exists();out['status']='CLEANUP_OK' if out['temporaryDirectoryRemoved'] else 'CLEANUP_FAILED'
        except BaseException:out['status']='CLEANUP_FAILED'
    out['safeToRunOtherApprovedCase']=bool(eligible and stopped and out['temporaryDirectoryRemoved'] and out['status']=='CLEANUP_OK')
    try:writer(completion,out)
    except BaseException:out['status']='COMPLETION_WRITE_FAILED';out['safeToRunOtherApprovedCase']=False
    return out


def parse_output(stdout):
    text=stdout.decode('utf-8','replace')
    counts={k:int(v) for k,v in re.findall(r'\b(tests|pass|fail|cancelled|skipped)\s+(\d+)\s*$',text,re.M)}
    require(all(v<=1 for v in counts.values()),'TEST_SELECTION_REFUSED')
    diagnostics=[]
    keys={'stage','agentPresent','errorCode','errorCategory','errorLayer','innerCodeMarker','innerEvidence','structuredCauseRetained','modelIOZero'}
    enums={'errorCode':CODES,'errorCategory':{'GATEWAY_INTERNAL','FILESYSTEM_ACCESS_DENIED','ADDON_LOADING_DISABLED','NATIVE_LOADING_FAILED','UNKNOWN'},'errorLayer':{'UNKNOWN','NATIVE_ADDON_PERMISSION','NATIVE_ADDON_LOAD_FAILED','FILESYSTEM_PERMISSION','DEPENDENCY_RESOLUTION','HOST_PLATFORM_CAPABILITY','SYNTHETIC_FIXTURE_FORMAT'},'innerCodeMarker':CODES|{'ERR_FLOCK_UNSUPPORTED_PLATFORM','SESSION_QUERY_CORRUPT_SESSION'},'innerEvidence':{'UNRECORDED','STRUCTURED_CAUSE_CODE','SDK_STRINGIFIED_ERROR_MARKER'}}
    for line in text.splitlines():
        pos=line.find('{"stage":"existing-cold-resolve"')
        if pos<0:continue
        value=json.JSONDecoder().raw_decode(line[pos:])[0]
        require(type(value) is dict and set(value)==keys and value['stage']=='existing-cold-resolve','OUTPUT_SCHEMA_REFUSED')
        require(all(type(value[k]) is bool for k in ['agentPresent','structuredCauseRetained','modelIOZero']),'OUTPUT_SCHEMA_REFUSED')
        require(all(type(value[k]) is str and value[k] in enum for k,enum in enums.items()),'OUTPUT_SCHEMA_REFUSED')
        diagnostics.append(value)
    require(len(diagnostics)<=1,'TEST_SELECTION_REFUSED')
    return counts,diagnostics



NODE=None
NODE_SHA=None

import capture as BC
def supervise_bounded(*args,**kwargs):
 holder={}
 def popen(*pa,**pk):holder['child']=BC.CappedProcess(*pa,**pk);return holder['child']
 capture=supervise_once(*args,popen=popen,**kwargs);child=holder.get('child')
 if child and child.setupFailed:capture['outputComplete']=False;capture['errorCategories'].append('CAPTURE_PIPE_SETUP_FAILED')
 if child and not capture['outputComplete']:
  capture.stdout=bytes(child.streams['stdout'].raw);capture.stderr=bytes(child.streams['stderr'].raw)
  for stream in child.streams.values():stream.release()
  capture['errorCategories'].append('CAPTURE_INCOMPLETE')
 capture.boundedMetadata={name:stream.metadata() for name,stream in child.streams.items()} if child else None
 if child and any(stream.overflow for stream in child.streams.values()):capture['errorCategories'].append('STREAM_LIMIT_REFUSED')
 return capture
