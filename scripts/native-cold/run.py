"""Private candidate CI only: one builtin proof, then each original cold case once.

No model credentials enter children. Raw output stays bounded in parent memory.
The child journal is NON_DURABLE; parent receipts are committed before cleanup.
Importing this module never launches a child.
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path
import builtin_policy as B
import diagnostic as C
import supervisor as R
import trace_policy as T
import installed_identity as I
from contract import check_partition, select_platform, Refused

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1]
BRANCH = 'release/v0.1.0-rc.1-source-closure-20261006'
REPOSITORY = '86cloudyun-afk/dsh-bot'
AUTHORIZATION = 'Sentinel_efa81846b3c881919388af8358173c52'
CASES = ('builtin-dual', 'cold1', 'cold2')
WITNESSES = {}

def architecture(raw, pins):
    if pins['platform']=='darwin':
        return raw[:4]==bytes.fromhex('cffaedfe') and struct.unpack('<I',raw[4:8])[0]==0x100000c
    return raw[:4]==b'\x7fELF' and raw[4]==2 and struct.unpack('<H',raw[18:20])[0]==62

def git(*args):
    result=subprocess.run(['git','-C',str(SOURCE),*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                          env={'PATH':os.defpath,'LANG':'C','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'},timeout=10)
    R.require(result.returncode==0 and len(result.stdout)<65536,'SOURCE_IDENTITY_REFUSED')
    return result.stdout.decode('ascii').strip()

def check_context(ctx):
    R.require(git('rev-parse','HEAD')==ctx['head'] and git('rev-parse','HEAD^{tree}')==ctx['tree'] and git('status','--porcelain')=='','SOURCE_CHANGED_REFUSED')
    R.checked_node()
    I.check(ctx,SOURCE)
    R.require(R.sha(HERE/'platforms.json')==ctx['platformsSHA256'],'PLATFORM_PINS_CHANGED_REFUSED')
    R.require(check_partition(SOURCE)==ctx['partition'],'PARTITION_CHANGED_REFUSED')
    for name,digest in ctx['helpers'].items():
        R.require(R.regular(HERE/name) and R.sha(HERE/name)==digest,'HELPER_PIN_REFUSED')
    lock=json.loads((SOURCE/'package-lock.json').read_text())['packages']
    sdk=json.loads((SOURCE/'node_modules/@deepseek-ai/dsh/package.json').read_text())
    R.require(sdk['name']=='@deepseek-ai/dsh' and sdk['version']=='0.2.0-rc.2','SDK_VERSION_REFUSED')
    for row in ctx['pins']['bindings']:
        path=SOURCE/'node_modules'/row['packageRelativeSDKFile']
        metadata=json.loads((SOURCE/'node_modules'/row['package']/'package.json').read_text())
        locked=lock['node_modules/'+row['package']]
        R.require(metadata['name']==row['package'] and metadata['version']==row['version'] and locked['version']==row['version'] and locked['integrity']==row['integrity'],'PACKAGE_PIN_REFUSED')
        R.require(R.regular(path) and path.stat().st_size==row['bytes'] and R.sha(path)==row['sha256'],'PAYLOAD_PIN_REFUSED')
        with path.open('rb') as file:
            R.require(architecture(file.read(32),ctx['pins']),'PAYLOAD_ARCHITECTURE_REFUSED')

def context(args):
    # These are non-secret CI identity fields. No credential environment is read.
    R.require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY and
              os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH and
              os.environ.get('GITHUB_SHA')==args.expected_sha,'CI_SCOPE_REFUSED')
    R.require(re.fullmatch('[0-9a-f]{40}',args.expected_sha) is not None,'COMMIT_ARGUMENT_REFUSED')
    temp=Path(args.temp_dir).resolve(strict=True)
    R.require(temp.is_dir(),'TEMP_ROOT_REFUSED')
    evidence=Path(args.evidence_dir)
    R.require(evidence.parent.resolve(strict=True)==temp and not evidence.exists() and not evidence.is_symlink(),'EVIDENCE_ROOT_REFUSED')
    evidence.mkdir(mode=0o700);evidence=evidence.resolve(strict=True)
    pins=select_platform(sys.platform,platform.machine())
    try:node=Path(args.node).resolve(strict=True)
    except (OSError,ValueError):raise R.SafetyError('NODE_PIN_REFUSED') from None
    R.NODE=node; R.NODE_SHA=pins['node']['binarySHA256']; R.NATIVE_SHA=pins['bindings'][0]['sha256']
    R.checked_node()
    with node.open('rb') as file:
        R.require(architecture(file.read(32),pins),'NODE_ARCHITECTURE_REFUSED')
    helpers=json.loads((HERE/'bundle-pins.json').read_text())
    current=Path(args.current_dir)
    R.require(current.parent.resolve(strict=True)==temp and current.is_dir() and not current.is_symlink() and current.resolve(strict=True)==current,'CURRENT_INSTALLATION_ROOT_REFUSED')
    installation_bytes,_,installation_sha=I.fixed(current/'installation-record.json',1024*1024)
    installation=json.loads(installation_bytes)
    R.require(installation['schemaVersion']==1 and installation['scope']=='CURRENT_NATIVE_PRODUCT_AND_SDK','INSTALLATION_RECORD_REFUSED')
    ctx={'head':args.expected_sha,'tree':git('rev-parse','HEAD^{tree}'),'pins':pins,'node':node,'temp':temp,'evidence':evidence,
         'helpers':helpers,'partition':check_partition(SOURCE),'platformsSHA256':R.sha(HERE/'platforms.json'),
         'current':current,'installation':installation,'installationRecordSHA256':installation_sha}
    T.configure(pins);B.BUNDLE_PINS=helpers
    check_context(ctx)
    R.atomic_create(evidence/'identity.json',{'authorization':AUTHORIZATION,'sourceHead':ctx['head'],'sourceTree':ctx['tree'],
        'platform':pins,'nodeSHA256':R.NODE_SHA,'helperSHA256':helpers,'partition':ctx['partition'],
        'installedIdentity':installation,'installationRecordSHA256':installation_sha,
        'maximumChildren':3,'maximumColdChildren':2,'deadlinesSeconds':{'builtin':5,'cold':20},'noRetry':True,
        'childEnvironmentKeys':sorted(R.ENV_KEYS),'childObservationDurability':'NON_DURABLE','productionDurabilityEstablished':False})
    return ctx

def prepare(root,ctx):
    for name,digest in ctx['helpers'].items():
        path=root/name;path.write_bytes((HERE/name).read_bytes());path.chmod(0o600)
        R.require(R.regular(path) and R.sha(path)==digest,'COPY_PIN_REFUSED')
    installed={'current':str(ctx['current']),'recordSHA256':ctx['installationRecordSHA256'],'sdkManifestSHA256':ctx['installation']['sdkManifestSHA256'],
               'packageSHA256':ctx['installation']['packageSHA256'],'head':ctx['head'],'tree':ctx['tree']}
    (root/'binding-config.json').write_text(json.dumps({'source':str(SOURCE),'pins':ctx['pins'],'installed':installed}))
    (root/'binding-config.json').chmod(0o600)

def collect_cold(root,pid,case,helpers):
    known=set(helpers)|{'binding-config.json','synthetic-empty-home','node-addon-native-custom-loader-'+str(os.getuid())}
    entries=list(root.iterdir());R.require(len(entries)<=208,'COLD_INVENTORY_REFUSED')
    records=[]
    for entry in entries:
        if entry.name in helpers or entry.name=='binding-config.json':
            R.require(R.regular(entry),'COLD_INVENTORY_REFUSED');continue
        match=re.fullmatch('builtin-observation-TRACE-([0-9]{4})',entry.name)
        if match:
            R.require(not entry.is_symlink() and entry.is_dir(),'COLD_INVENTORY_REFUSED')
            children=list(entry.iterdir())
            R.require(len(children)==1 and children[0].name=='record.json' and R.regular(children[0]),'COLD_INVENTORY_REFUSED')
            records.append((int(match[1]),children[0]));continue
        R.require(entry.name in known or re.fullmatch('(resume-|native-resume-)[A-Za-z0-9_-]+',entry.name),'COLD_INVENTORY_REFUSED')
        R.require(not entry.is_symlink() and entry.is_dir(),'COLD_INVENTORY_REFUSED')
    records.sort()
    R.require(0<len(records)<=64 and [i for i,_ in records]==list(range(1,len(records)+1)),'COLD_SEQUENCE_REFUSED')
    value=None
    for sequence,path in records:
        envelope=B.read_fixed(path)
        expected={'schemaVersion':1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE','pid':pid,'case':case,'role':'TRACE','sequence':sequence}
        R.require(type(envelope) is dict and set(envelope)==set(expected)|{'payload'} and
                  all(B.exact(envelope[k],v) for k,v in expected.items()),'COLD_ENVELOPE_REFUSED')
        value=envelope['payload']
        R.require(type(value) is dict and type(value.get('pid')) is int and value['pid']==pid,'COLD_ENVELOPE_REFUSED')
        R.require(sequence==len(records) or value.get('stage')!='NATIVE_ADMISSION_REFUSED','COLD_TERMINAL_ORDER_REFUSED')
    R.require(T.trace_valid(value,pid),'COLD_TRACE_REFUSED')
    return value,{'recordCount':len(records),'inventoryValid':True,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE'}

def builtin_observation(root,pid):
    journal,statuses,contract=B.collect_journal(root,pid,'builtin-dual')
    trace=journal.get('TRACE');target=journal.get('TARGET');assertion=journal.get('ASSERTION')
    R.require(contract['inventoryValid'] and B.terminal_valid(trace,pid,'builtin-dual'),'BUILTIN_TRACE_REFUSED')
    R.require(B.exact(target,{'pid':pid,'version':'v24.19.0','case':'builtin-dual','targetId':'CATCH_FALLBACK_IMMEDIATE_STOP'}),'BUILTIN_TARGET_REFUSED')
    R.require(B.exact(assertion,{'pid':pid,'case':'builtin-dual','assertionId':'H_FIRST_DENIED_DLOPEN','status':'IN_PROGRESS','errorCode':'UNRECORDED'}),'BUILTIN_ASSERTION_REFUSED')
    progress=B.read_fixed(root/'builtin-progress.json')
    R.require(B.exact(progress,{'pid':pid,'version':'v24.19.0','mode':'catch-fallback','permission':True,'allowAddons':False,'actualNativeLoaderRetained':False,'syntheticSeededAttempts':0}),'BUILTIN_PROGRESS_REFUSED')
    R.require(not any((root/name).exists() or (root/name).is_symlink() for name in B.FORBIDDEN_MARKERS),'POST_DENIAL_MARKER_REFUSED')
    return trace,contract

def verify_prior(case,ctx,prior):
    expected='builtin-dual' if case=='cold1' else 'cold1'
    witness=WITNESSES.get(expected)
    R.require(witness is not None and prior is witness['result'] and prior['status']=='PASS','PRIOR_RETURN_REFUSED')
    for name,digest in witness['hashes'].items():
        R.require(R.regular(ctx['evidence']/name) and R.sha(ctx['evidence']/name)==digest,'PRIOR_RECEIPT_CHANGED_REFUSED')
    R.require(prior['completion']['diagnosticPersisted'] and prior['completion']['temporaryDirectoryRemoved'] and
              prior['completion']['safeToRunOtherApprovedCase'] and not prior['errors'],'PRIOR_CLEANUP_REFUSED')

def run_case(case,ctx,prior=None):
    R.require(case in CASES,'CASE_REFUSED')
    if case!='builtin-dual':verify_prior(case,ctx,prior)
    evidence=ctx['evidence']; paths={name:evidence/(case+'-'+name+'.json') for name in ('launch','started','receipt','cleanup','terminal')}
    R.require(not any(p.exists() or p.is_symlink() for p in paths.values()),'ONE_SHOT_REFUSED')
    root=None;errors=[];trace=None;counts={};diagnostics=[];observation=None;startup=None;eligible=False
    child=R.Capture(childCreated=False,childPID=None,returncode=None,processStopped=True,outputComplete=False,errorCategories=[])
    completion={'status':'PREPARATION_INCOMPLETE','diagnosticPersisted':False,'temporaryDirectoryRemoved':False,'safeToRunOtherApprovedCase':False}
    stop=R.SupervisorSignals();entered=False;start=time.monotonic()
    try:
        try:
            stop.__enter__();entered=True
            check_context(ctx)
            root=Path(tempfile.mkdtemp(prefix='dsh-native-cold-',dir=ctx['temp'])).resolve(strict=True)
            prepare(root,ctx)
            args=[str(ctx['node']),'--permission']
            if case=='builtin-dual':
                args+=['--allow-fs-read='+str(root),'--allow-fs-write='+str(root),'--import',(root/'builtin-tripwire.mjs').as_uri(),
                       '--import',(root/'companion.mjs').as_uri()+'?'+case,str(root/'builtin-harness.mjs'),'catch-fallback']
            else:
                entry=json.loads((HERE/'partition.json').read_text())['migrations'][int(case[-1])-1]['to']
                args+=['--allow-addons','--allow-fs-read='+str(SOURCE),'--allow-fs-read='+str(ctx['current']),'--allow-fs-read='+str(root),'--allow-fs-write='+str(root),
                       '--experimental-test-isolation=none','--import',str(ctx['current']/'product/scripts/test-safety.mjs'),
                       '--import',(root/'companion.mjs').as_uri()+'?'+case,'--test','--test-reporter=tap',str(ctx['current']/'product'/entry)]
            R.atomic_create(paths['launch'],{'case':case,'sourceHead':ctx['head'],'sourceTree':ctx['tree'],'maximumChildRuns':1,
                'deadlineSeconds':5 if case=='builtin-dual' else 20,'argv':args,'environmentKeys':sorted(R.ENV_KEYS),
                'SDKReadGrant':case!='builtin-dual','allowAddons':case!='builtin-dual','modelNetworkDatabaseAllowed':False})
            child=R.supervise_bounded(args,root if case=='builtin-dual' else ctx['current']/'product',R.synthetic_env(root),5 if case=='builtin-dual' else 20,
                allow_addons=case!='builtin-dual',supervisor_signals=stop,
                on_started=lambda pid:R.atomic_create(paths['started'],{'pid':pid,'startUTC':R.now()}))
            errors.extend(child['errorCategories'])
            if case=='builtin-dual':trace,observation=builtin_observation(root,child['childPID'])
            else:
                trace,observation=collect_cold(root,child['childPID'],case,ctx['helpers'])
                counts,diagnostics=R.parse_output(child.stdout)
            check_context(ctx)
            if case!='builtin-dual':R.require(trace['installedIdentity']==I.check(ctx,SOURCE),'CHILD_INSTALLED_IDENTITY_REFUSED')
            startup=C.collect_startup(child.stdout,child.stderr,child['returncode'],trace['stage'],owned_root=str(root))
            if startup['classificationTruncated']:errors.append('OUTPUT_TRUNCATED')
            if startup['startupErrorCategory'] in {'NODE_PERMISSION_REFUSAL','NATIVE_ADDON_PERMISSION','AMBIGUOUS_FAILURE'}:errors.append('STARTUP_REFUSED')
            if case=='builtin-dual':
                eligible=not errors and child['childCreated'] and child['processStopped'] and child['outputComplete'] and child['returncode']==74
            else:
                eligible=T.cold_eligible(trace=trace,counts=counts,diagnostics=diagnostics,returncode=child['returncode'],
                    stopped=child['processStopped'],complete=child['outputComplete'],errors=errors,pins=True)
            if not eligible:errors.append('OUTCOME_REFUSED')
        except R.SafetyError as error:errors.append(error.code)
        except BaseException:errors.append('COLLECTION_OR_PREPARATION_FAILURE')
        finally:stop.interruptible=False
        if stop.received is not None:errors.append('SUPERVISOR_SIGNAL');eligible=False
        if startup is None:
            try:
                startup=C.collect_startup(child.stdout,child.stderr,child['returncode'],trace['stage'] if trace else None,owned_root=str(root) if root else None)
            except BaseException:
                errors.append('STARTUP_COLLECTION_FAILED');eligible=False
                startup={'startupErrorCategory':'COLLECTION_FAILURE','rawStdoutSHA256':hashlib.sha256(child.stdout).hexdigest(),
                         'rawStderrSHA256':hashlib.sha256(child.stderr).hexdigest(),'stdoutByteCount':len(child.stdout),
                         'stderrByteCount':len(child.stderr),'rawOutputSavedOrPrinted':False}
        metadata=getattr(child,'boundedMetadata',None)
        if metadata:
            for name,label in [('stdout','Stdout'),('stderr','Stderr')]:
                startup['raw'+label+'SHA256']=metadata[name]['sha256'];startup[name+'ByteCount']=metadata[name]['bytes']
            if not all(m['completeWithinLimit'] for m in metadata.values()):errors.append('STREAM_LIMIT_REFUSED');eligible=False
        record={'case':case,'sourceHead':ctx['head'],'sourceTree':ctx['tree'],'endUTC':R.now(),'elapsedSeconds':time.monotonic()-start,
            'process':dict(child),'errors':list(errors),'runtimeTrace':trace,'testCounts':counts,'safeColdDiagnostics':diagnostics,
            'startupDiagnostic':startup,'boundedCaptureMetadata':metadata,'observationContract':observation,'supervisorSignal':stop.received,
            'rawOutputSavedOrPrinted':False,'childDurability':'NON_DURABLE','productionDurabilityEstablished':False,
            'modelObservation':'UNKNOWN_NOT_INSTRUMENTED' if case=='builtin-dual' else trace['modelAttempts'] if trace else 'UNKNOWN',
            'parentReceiptDurability':'DURABLE_PARENT_AFTER_CHILD_EXIT'}
        if root is not None:
            completion=R.persist_and_cleanup(root,paths['receipt'],paths['cleanup'],record,child['processStopped'],eligible and not errors)
        else:
            try:R.atomic_create(paths['receipt'],record);completion['diagnosticPersisted']=True;R.atomic_create(paths['cleanup'],completion)
            except BaseException:errors.append('PREPARATION_DIAGNOSTIC_WRITE_FAILED')
    finally:
        if entered:
            try:stop.__exit__(None,None,None)
            except BaseException:errors.append('SIGNAL_GUARD_RESTORE_FAILED');completion['safeToRunOtherApprovedCase']=False
    if stop.received is not None:completion['safeToRunOtherApprovedCase']=False
    passed=not errors and completion['safeToRunOtherApprovedCase']
    result={'case':case,'status':'PASS' if passed else 'BLOCKED_OR_FAIL','errors':errors,'pid':child['childPID'],
            'returncode':child['returncode'],'processStopped':child['processStopped'],'testCounts':counts,'completion':completion,
            'model':record['modelObservation'],'elapsedSeconds':record['elapsedSeconds'],'productionDurabilityEstablished':False}
    try:
        hashes={p.name:R.sha(p) for p in (paths['receipt'],paths['cleanup'])}
        R.atomic_create(paths['terminal'],{'case':case,'evaluatedOutcome':result['status'],'supervisorSignal':stop.received,
            'diagnosticSHA256':hashes[paths['receipt'].name],'cleanupSHA256':hashes[paths['cleanup'].name]},rollback_on_failure=True)
        hashes[paths['terminal'].name]=R.sha(paths['terminal'])
        if passed:WITNESSES[case]={'result':result,'hashes':hashes}
    except BaseException:errors.append('TERMINAL_WRITE_FAILED');result['status']='BLOCKED_OR_FAIL';completion['safeToRunOtherApprovedCase']=False
    return result

def preflight_failure(args,category):
    record={'status':'BLOCKED','layer':'IDENTITY_PREFLIGHT','category':category,'actualChildren':0,'model':'UNKNOWN','noRetry':True}
    try:
        temp=Path(args.temp_dir).resolve(strict=True);evidence=Path(args.evidence_dir)
        R.require(evidence.parent.resolve(strict=True)==temp and evidence.is_dir() and not evidence.is_symlink(),'EVIDENCE_ROOT_REFUSED')
        R.atomic_create(evidence/'preflight-failure.json',record)
    except BaseException:
        record['diagnosticPersisted']=False
    else:record['diagnosticPersisted']=True
    print(json.dumps(record),flush=True)
    return 2

def main():
    parser=argparse.ArgumentParser()
    for name in ('expected-sha','node','temp-dir','evidence-dir','current-dir'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    try:ctx=context(args)
    except R.SafetyError as error:
        return preflight_failure(args,error.code)
    except Refused as error:
        return preflight_failure(args,str(error))
    except BaseException:
        return preflight_failure(args,'IDENTITY_COLLECTION_FAILURE')
    results=[];prior=None
    try:
        for case in CASES:
            result=run_case(case,ctx,prior);results.append(result)
            # The first cold result is durably recorded and printed before the second can start.
            print(json.dumps(result,sort_keys=True),flush=True)
            if result['status']!='PASS':break
            prior=result
    except R.SafetyError as error:
        results.append({'case':case,'status':'BLOCKED_OR_FAIL','errors':[error.code],'pid':None})
    except BaseException:
        results.append({'case':case,'status':'BLOCKED_OR_FAIL','errors':['PARENT_COMPLETION_FAILURE'],'pid':None})
    installation_record={'sourceHead':ctx['head'],'sourceTree':ctx['tree'],'installedIdentity':ctx['installation'],
        'installationRecordSHA256':ctx['installationRecordSHA256'],'results':results,'actualSDKNativeExecutedByBuilder':False}
    stopped=all(r.get('processStopped',r.get('pid') is None) is True for r in results)
    installation_completion=R.persist_and_cleanup(ctx['current'],ctx['evidence']/'installation-receipt.json',ctx['evidence']/'installation-cleanup.json',installation_record,stopped,len(results)==3 and all(r['status']=='PASS' for r in results))
    summary={'sourceHead':ctx['head'],'sourceTree':ctx['tree'],'status':'PASS' if len(results)==3 and all(r['status']=='PASS' for r in results) and installation_completion['safeToRunOtherApprovedCase'] else 'BLOCKED_OR_FAIL',
        'installationCompletion':installation_completion,
        'results':results,'actualChildren':sum(r['pid'] is not None for r in results),'maximumChildren':3,
        'unstartedCases':[c for c in CASES if c not in [r['case'] for r in results if r['pid'] is not None]],'noRetry':True,
        'legacyNativeNotIncluded':ctx['partition']['legacyNativeNotIncluded'],'productionDurabilityEstablished':False}
    try:R.atomic_create(ctx['evidence']/'summary.json',summary)
    except BaseException:summary['status']='BLOCKED_OR_FAIL'
    print(json.dumps({'status':summary['status'],'actualChildren':summary['actualChildren'],'unstartedCases':summary['unstartedCases']}),flush=True)
    return 0 if summary['status']=='PASS' else 2

if __name__=='__main__':
    raise SystemExit(main())
