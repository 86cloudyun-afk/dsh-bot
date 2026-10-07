"""One private CI-only Node child. Observe key presence, never environment values."""
import argparse
import hashlib
import io
import json
import os
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

KEYS = {'cfUserTextEncodingPresent', 'otherUnexpectedKeyPresent'}
PROGRAM = """const allowed = new Set(['DSH_HOME','DSH_BOT_TEST_ROOT','TMPDIR','TZ','LANG','NODE_TEST_CONTEXT']);
const keys = Object.keys(process.env);
process.stdout.write(JSON.stringify({cfUserTextEncodingPresent:keys.includes('__CF_USER_TEXT_ENCODING'),otherUnexpectedKeyPresent:keys.some(key=>!allowed.has(key)&&key!=='__CF_USER_TEXT_ENCODING')})+'\\n');"""

def observation(raw):
    if len(raw)>256:
        raise ValueError('OBSERVATION_REFUSED')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('OBSERVATION_REFUSED')
            result[key]=value
        return result
    value=json.loads(raw,object_pairs_hook=unique)
    if type(value) is not dict or set(value)!=KEYS or any(type(v) is not bool for v in value.values()):
        raise ValueError('OBSERVATION_REFUSED')
    return value

def prepare_node(directory,pins):
    """Fetch pinned public bytes; never execute the candidate during preparation."""
    with urllib.request.urlopen(pins['artifactURL'],timeout=30) as response:
        archive=response.read(96*1024*1024+1)
    if len(archive)>96*1024*1024 or hashlib.sha256(archive).hexdigest()!=pins['artifactSHA256']:
        raise ValueError('NODE_PIN_REFUSED')
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as package:
        members=package.getmembers()
        if len(members)>10000:raise ValueError('NODE_PIN_REFUSED')
        matches=[m for m in members if m.name.split('/')[-2:]==['bin','node']]
        if len(matches)!=1 or not matches[0].isfile() or matches[0].size!=pins['binaryBytes']:
            raise ValueError('NODE_PIN_REFUSED')
        with package.extractfile(matches[0]) as file:raw=file.read(pins['binaryBytes']+1)
    if len(raw)!=pins['binaryBytes'] or hashlib.sha256(raw).hexdigest()!=pins['binarySHA256'] or raw[:4]!=bytes.fromhex('cffaedfe') or struct.unpack('<I',raw[4:8])[0]!=0x100000c:
        raise ValueError('NODE_PIN_REFUSED')
    node=directory/'node'
    with node.open('xb') as file:file.write(raw)
    node.chmod(0o700)
    return node

def main():
    parser=argparse.ArgumentParser()
    for flag in ('node-directory','temp-dir','evidence-dir','expected-sha'):parser.add_argument('--'+flag,required=True)
    args=parser.parse_args()
    if not (os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='86cloudyun-afk/dsh-bot' and
            os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF')=='refs/heads/ci/macos-env-diagnostic-20261007' and
            os.environ.get('GITHUB_SHA')==args.expected_sha and re.fullmatch('[0-9a-f]{40}',args.expected_sha)):
        print('PRIVATE_DIAGNOSTIC_SCOPE_REFUSED');return 2
    temp=Path(args.temp_dir).resolve(strict=True)
    evidence=Path(args.evidence_dir)
    if not temp.is_dir() or evidence.parent.resolve(strict=True)!=temp or evidence.exists() or evidence.is_symlink():
        print('EXCLUSIVE_EVIDENCE_ROOT_REFUSED');return 2
    evidence.mkdir(mode=0o700)
    receipt={'schemaVersion':1,'sourceHead':args.expected_sha,'scope':'SYNTHETIC_MAC_ENV_KEYS_ONLY','status':'BLOCKED_OR_FAIL',
             'maximumChildren':1,'actualChildren':0,'deadlineSeconds':5,'childEnvironmentValuesInspected':False,'unexpectedEnvironmentNamesRetained':False,
             'preparationNodeExecutions':0,'nativeOrSDKExecuted':False,'modelRequests':0,'sysctlProbes':0,'observation':None,'errors':[]}
    root=None;root_identity=None;node_root=None;node_identity=None;child=None;started=None;capture_complete=False
    try:
        if sys.platform!='darwin' or platform.machine()!='arm64':raise ValueError('PLATFORM_REFUSED')
        pins=json.loads((Path(__file__).parent/'platforms.json').read_bytes())['darwin-arm64']['node']
        node_root=Path(args.node_directory)
        if not node_root.is_absolute() or node_root.parent.resolve(strict=True)!=temp or node_root==evidence or node_root.exists() or node_root.is_symlink():raise ValueError('NODE_PIN_REFUSED')
        node_root.mkdir(mode=0o700);node_identity=node_root.stat()
        node=prepare_node(node_root,pins).resolve(strict=True);before=node.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size!=pins['binaryBytes']:raise ValueError('NODE_PIN_REFUSED')
        raw=node.read_bytes();after=node.lstat()
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('NODE_PIN_REFUSED')
        if hashlib.sha256(raw).hexdigest()!=pins['binarySHA256'] or raw[:4]!=bytes.fromhex('cffaedfe') or struct.unpack('<I',raw[4:8])[0]!=0x100000c:raise ValueError('NODE_PIN_REFUSED')
        receipt['nodeBinarySHA256']=pins['binarySHA256']
        receipt['nodeArchiveSHA256']=pins['artifactSHA256']
        root=Path(tempfile.mkdtemp(prefix='dsh-env-key-probe-',dir=temp)).resolve(strict=True);root_identity=root.stat()
        home=root/'empty-home';home.mkdir(mode=0o700)
        env={'DSH_HOME':str(home),'DSH_BOT_TEST_ROOT':str(root),'TMPDIR':str(root),'TZ':'UTC','LANG':'C'}
        started=time.monotonic()
        child=subprocess.Popen([str(node),'--permission','--input-type=module','--eval',PROGRAM],cwd=root,env=env,
                               stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        receipt['actualChildren']=1
        stdout,stderr=child.communicate(timeout=max(0.001,5-(time.monotonic()-started)))
        capture_complete=True
        receipt.update(runningSeconds=time.monotonic()-started,returncode=child.returncode,processStopped=child.poll() is not None,
                       stdoutBytes=len(stdout),stderrBytes=len(stderr),stdoutSHA256=hashlib.sha256(stdout).hexdigest(),stderrSHA256=hashlib.sha256(stderr).hexdigest())
        if receipt['runningSeconds']>5 or child.returncode!=0 or stderr:raise ValueError('CHILD_OUTCOME_REFUSED')
        receipt['observation']=observation(stdout);receipt['status']='PASS_DIAGNOSTIC_ONLY'
    except subprocess.TimeoutExpired:
        receipt['errors'].append('CHILD_TIMEOUT')
    except ValueError as error:
        receipt['errors'].append(str(error) if str(error) in {'PLATFORM_REFUSED','NODE_PIN_REFUSED','OBSERVATION_REFUSED','CHILD_OUTCOME_REFUSED'} else 'PREPARATION_OR_OBSERVATION_REFUSED')
    except BaseException:
        receipt['errors'].append('PREPARATION_OR_CAPTURE_FAILURE')
    finally:
        if child is not None and not capture_complete:
            stop_start=time.monotonic();stop_deadline=stop_start+4
            try:
                if child.poll() is None:child.kill()
                remaining=stop_deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('STOP_OR_CAPTURE_UNCONFIRMED')
                child.communicate(timeout=remaining)
                if time.monotonic()>stop_deadline:raise TimeoutError('STOP_OR_CAPTURE_UNCONFIRMED')
                capture_complete=True
            except BaseException:receipt['errors'].append('STOP_OR_CAPTURE_UNCONFIRMED')
            receipt['stopConfirmationSeconds']=time.monotonic()-stop_start
        receipt['processStopped']=child is None or child.poll() is not None
        receipt['captureComplete']=child is None or capture_complete
        receipt['temporaryDirectoryRemoved']=root is None
        if root is not None and receipt['processStopped'] and receipt['captureComplete']:
            try:
                current=root.lstat()
                if root.is_symlink() or (current.st_dev,current.st_ino)!=(root_identity.st_dev,root_identity.st_ino):raise ValueError('CLEANUP_IDENTITY_REFUSED')
                shutil.rmtree(root);receipt['temporaryDirectoryRemoved']=not root.exists()
            except BaseException:receipt['errors'].append('CLEANUP_UNCONFIRMED')
        receipt['nodeDirectoryRemoved']=node_root is None
        if node_root is not None and node_identity is not None and receipt['processStopped'] and receipt['captureComplete']:
            try:
                current=node_root.lstat()
                if node_root.is_symlink() or (current.st_dev,current.st_ino)!=(node_identity.st_dev,node_identity.st_ino):raise ValueError('CLEANUP_IDENTITY_REFUSED')
                shutil.rmtree(node_root);receipt['nodeDirectoryRemoved']=not node_root.exists()
            except BaseException:receipt['errors'].append('NODE_CLEANUP_UNCONFIRMED')
        if receipt['errors'] or not receipt['processStopped'] or not receipt['captureComplete'] or not receipt['temporaryDirectoryRemoved'] or not receipt['nodeDirectoryRemoved']:receipt['status']='BLOCKED_OR_FAIL'
        with (evidence/'environment-diagnostic.json').open('x') as file:json.dump(receipt,file,indent=2);file.write('\n')
        print(json.dumps(receipt,sort_keys=True))
    return 0 if receipt['status']=='PASS_DIAGNOSTIC_ONLY' else 2

if __name__=='__main__':raise SystemExit(main())
