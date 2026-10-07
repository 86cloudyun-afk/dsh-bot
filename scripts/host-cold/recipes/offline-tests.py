"""Run the supplied no-model specs and strict native gates in a disposable Home."""
from pathlib import Path
import argparse, os, subprocess, json, datetime

parser = argparse.ArgumentParser()
parser.add_argument('--source',type=Path,required=True)
parser.add_argument('--evidence',type=Path,required=True)
args = parser.parse_args()
source,evidence = args.source.resolve(),args.evidence.resolve()
evidence.mkdir(parents=True,exist_ok=True,mode=0o700)
test_home = evidence/'offline-test-home'
test_home.mkdir(mode=0o700)
environment = os.environ.copy()
for name in ['DEEPSEEK_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','DSH_HOME']:
    environment.pop(name,None)
environment.update(HOME=str(test_home),XDG_CONFIG_HOME=str(test_home/'config'),CI='true',NALR_REQUIRE_LANDLOCK='1')
environment['PATH']=str(source/'.tools/musl/bin')+':'+environment['PATH']
node=source/'.tools/node-v24.19.0-linux-x64/bin/node'
selected=[
 ('protected-specs',[node,source/'node_modules/vitest/vitest.mjs','run','--config','vitest.protected.config.ts',
                     'packages/experimental/native-run/tests/protected-factory.spec.ts','packages/experimental/native-run/tests/native-session.spec.ts'],source),
 ('native-oracle',[node,'scripts/build-test-oracle.mjs'],source/'native/system'),
 ('native-entry',[node,'test/entry.test.js'],source/'native/system'),
 ('native-flock',[node,'--test','test/flock.test.js'],source/'native/system'),
 ('native-payload',[node,'../../scripts/verify-launcher-binary.mjs'],source/'native/system/packages/linux-x64'),
 ('native-landlock-required',[node,'test/launcher.test.js'],source/'native/system'),
]
receipts=[]
for name,command,cwd in selected:
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (evidence/(name+'.log')).open('w') as out:
        result=subprocess.run([str(part) for part in command],cwd=cwd,env=environment,stdout=out,stderr=subprocess.STDOUT)
    receipts.append({'name':name,'command':[str(part) for part in command],'cwd':str(cwd),
                     'startedUTC':started,'endedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode})
    print(json.dumps({'name':name,'exitCode':result.returncode}),flush=True)
report={'modelsRequested':False,'modelKeysInherited':False,'existingHomeInherited':False,'requireLandlock':True,'receipts':receipts}
(evidence/'offline-tests-receipt.json').write_text(json.dumps(report,indent=2)+'\n')
raise SystemExit(1 if any(item['exitCode']!=0 for item in receipts) else 0)
