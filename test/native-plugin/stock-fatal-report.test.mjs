import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

for(const mode of ['throw','reject'])test(`stock fatal monitor records ${mode} without masking the fatal exit or exposing exception secrets`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-fatal-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},errors:[],report:{stage:'real-native-stage',checks:{originalNativeCheck:true},requests:[{}],sourceCommit:'${'a'.repeat(40)}',artifactSha256:'${'b'.repeat(64)}',sourceTreeDirty:false,realModelRequests:0}}));
    process.on('uncaughtExceptionMonitor',()=>writeFileSync(join(${JSON.stringify(evidence)},'monitor-snapshot.json'),readFileSync(join(${JSON.stringify(evidence)},'stock-gui-report.json'))));
    const error=new TypeError('SECRET_SENTINEL /private/credential https://private.invalid/token');error.code='SECRET_SENTINEL';
    ${mode==='throw'?'setImmediate(()=>{throw error;});':'Promise.reject(error);'}
  `;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),report=JSON.parse(bytes);
  assert.equal(bytes,await readFile(join(evidence,'monitor-snapshot.json'),'utf8'),'Exit fallback must preserve this monitor\'s rich evidence byte-for-byte');
  assert.equal(report.fatalExit,true);assert.equal(report.passed,false);assert.equal(report.teardownComplete,false);
  assert.equal(report.fatal.type,'TypeError');assert.equal(report.fatal.origin,mode==='throw'?'uncaughtException':'unhandledRejection');
  assert.deepEqual(report.checks,{originalNativeCheck:true});assert.equal(report.controlledRequests,1);
  assert.equal(report.sourceCommit,'a'.repeat(40));assert.equal(report.artifactSha256,'b'.repeat(64));
  assert.match(report.fatal.messageHash,/^[a-f\d]{64}$/);assert.equal(report.fatal.code,undefined);
  for(const secret of ['SECRET_SENTINEL','/private/credential','https://private.invalid','token'])assert.equal(bytes.includes(secret),false);
});

test('official SDK exit preserves this run\'s genuine completed normal failure byte-for-byte',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-current-failure-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,normal=new URL('./stock-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {finishStockGui,recordStockError} from ${JSON.stringify(normal)};import {installFailLoud} from ${JSON.stringify(sdk)};import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
    const evidence=${JSON.stringify(evidence)},report={passed:false,stage:'current-native-stage',checks:{currentNativeCheck:true},requests:[{}],sourceCommit:'${'d'.repeat(40)}',artifactSha256:'${'e'.repeat(64)}',realModelRequests:0};
    const gui={evidence,report,errors:[],writeReport(){return writeFile(join(evidence,'stock-gui-report.json'),JSON.stringify(report,null,2)+'\\n');},async shutdown(){}};
    installStockFatalReport(()=>gui);installFailLoud('controlled-sdk',process);
    await recordStockError(report,new TypeError('SECRET_SENTINEL original failure'));await finishStockGui(gui);
    await writeFile(join(evidence,'normal-snapshot.json'),await readFile(join(evidence,'stock-gui-report.json')));
    Promise.reject(new TypeError('SECRET_SENTINEL secondary SDK exit'));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(bytes,await readFile(join(evidence,'normal-snapshot.json'),'utf8'));
  assert.equal(saved.passed,false);assert.equal(saved.testsPassed,false);assert.equal(saved.teardownComplete,true);
  assert.equal(saved.error.type,'TypeError');assert.match(saved.error.messageHash,/^[a-f\d]{64}$/);assert.equal(saved.fatalExit,undefined);
  assert.equal(saved.sourceCommit,'d'.repeat(40));assert.equal(saved.artifactSha256,'e'.repeat(64));assert.deepEqual(saved.checks,{currentNativeCheck:true});
  assert.equal(bytes.includes('SECRET_SENTINEL'),false);
});

for(const mode of ['release','immediate'])test(`official SDK fatal rejection ${mode} leaves fallback evidence without changing its native exit`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-sdk-fatal-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {installFailLoud} from ${JSON.stringify(sdk)};import {writeFileSync} from 'node:fs';import {join} from 'node:path';
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},errors:[],report:{stage:'actual-native-stage',checks:{originalNativeCheck:true},requests:[{}],sourceCommit:'${'a'.repeat(40)}',artifactSha256:'${'b'.repeat(64)}',sourceTreeDirty:false,realModelRequests:0}}));
    installFailLoud('controlled-sdk',process,${mode==='release'?`async()=>{writeFileSync(join(${JSON.stringify(evidence)},'released'),'released');}`:'undefined'});
    Promise.reject(new TypeError('SECRET_SENTINEL /private/credential https://private.invalid/token'));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  if(mode==='release')assert.equal(await readFile(join(evidence,'released'),'utf8'),'released');
  assert.equal(existsSync(join(evidence,'stock-gui-report.json')),true,'Actual official fatal exit must leave sanitized public evidence');
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),report=JSON.parse(bytes);
  assert.equal(report.passed,false);assert.equal(report.testsPassed,false);assert.equal(report.teardownComplete,false);assert.equal(report.fatalExit,true);
  assert.deepEqual(report.processExit,{code:1});assert.equal(report.fatal,undefined);assert.equal(report.error,undefined);
  assert.equal(report.stage,'actual-native-stage');assert.deepEqual(report.checks,{originalNativeCheck:true});assert.equal(report.controlledRequests,1);
  assert.equal(report.sourceCommit,'a'.repeat(40));assert.equal(report.artifactSha256,'b'.repeat(64));
  for(const secret of ['SECRET_SENTINEL','/private/credential','https://private.invalid','token'])assert.equal(bytes.includes(secret),false);
});

test('ordinary successful exit creates no fatal report and uninstall removes both observers',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-clean-exit-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  for(const dispose of [false,true]){
    const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};
      const uninstall=installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},report:{stage:'ordinary-exit',checks:{}}}));
      ${dispose?'uninstall();process.exit(1);':'process.exit(0);'}`;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
    assert.equal(child.status,dispose?1:0);assert.equal(child.signal,null);
    await assert.rejects(readFile(join(evidence,'stock-gui-report.json')),{code:'ENOENT'});
  }
});

for(const passed of [false,true])test(`nonzero exit ${passed?'invalidates completed success':'preserves completed failure byte-for-byte'}`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-complete-exit-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  const report={passed,testsPassed:true,teardownComplete:true,stage:'complete',checks:{originalNativeCheck:true},requests:[{}],sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),sourceTreeDirty:false,...(passed?{}:{error:{type:'Error',messageHash:'c'.repeat(64)}})};
  const original=JSON.stringify(report,null,2)+'\n';await writeFile(join(evidence,'stock-gui-report.json'),original,{mode:0o600});
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},errors:[],report:${JSON.stringify(report)}}));process.exit(1);`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8');
  if(!passed){assert.equal(bytes,original);return;}
  const saved=JSON.parse(bytes);assert.equal(saved.passed,false);assert.equal(saved.testsPassed,true);assert.equal(saved.teardownComplete,true);
  assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});assert.equal(saved.fatal,undefined);
  assert.equal(saved.sourceCommit,report.sourceCommit);assert.equal(saved.artifactSha256,report.artifactSha256);assert.deepEqual(saved.checks,report.checks);
});

test('natural nonzero exit before GUI availability records only known exit evidence',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-unknown-exit-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};
    installStockFatalReport(()=>undefined,{output:${JSON.stringify(evidence)}});process.exitCode=1;`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.signal,null);
  const saved=JSON.parse(await readFile(join(evidence,'stock-gui-report.json'),'utf8'));
  assert.equal(saved.passed,false);assert.equal(saved.testsPassed,false);assert.equal(saved.teardownComplete,false);assert.deepEqual(saved.processExit,{code:1});
  assert.equal(saved.fatal,undefined);assert.equal(saved.error,undefined);assert.equal(saved.controlledRequests,undefined);assert.equal(saved.realModelRequests,undefined);
  assert.equal(saved.sourceCommit,undefined);assert.equal(saved.artifactSha256,undefined);assert.deepEqual(saved.checks,{});
});

for(const mode of ['different-run','same-progress','before-gui'])test(`official SDK fatal exit replaces a stale failed report ${mode}`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-reused-evidence-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const stale={passed:false,testsPassed:false,teardownComplete:true,stage:'previous-native-stage',checks:{previousNativeCheck:true},requests:[{},{}],sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),realModelRequests:0,error:{type:'Error',messageHash:'c'.repeat(64)}};
  const current=mode==='same-progress'?{...stale}:{stage:'current-native-stage',checks:{currentNativeCheck:true},requests:[{},{},{}],sourceCommit:'d'.repeat(40),artifactSha256:'e'.repeat(64),realModelRequests:0};
  if(mode==='same-progress')for(const field of ['passed','testsPassed','teardownComplete','error'])delete current[field];
  const original=JSON.stringify(stale,null,2)+'\n';await writeFile(join(evidence,'stock-gui-report.json'),original,{mode:0o600});
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {installFailLoud} from ${JSON.stringify(sdk)};import {readFileSync} from 'node:fs';import {join} from 'node:path';import assert from 'node:assert/strict';
    installStockFatalReport(()=>${mode==='before-gui'?'undefined':`({evidence:${JSON.stringify(evidence)},errors:[],report:${JSON.stringify(current)}})`},{output:${JSON.stringify(evidence)}});
    assert.equal(readFileSync(join(${JSON.stringify(evidence)},'stock-gui-report.json'),'utf8'),${JSON.stringify(original)},'Registration must leave existing evidence untouched');
    installFailLoud('controlled-sdk',process);Promise.reject(new TypeError('SECRET_SENTINEL /private/credential'));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true,'Stale failure must not substitute for the current SDK exit');assert.deepEqual(saved.processExit,{code:1});
  assert.equal(saved.passed,false);assert.equal(saved.testsPassed,false);assert.equal(saved.teardownComplete,false);assert.equal(saved.error,undefined);assert.equal(saved.fatal,undefined);
  if(mode==='before-gui'){
    assert.equal(saved.stage,'fatal-runner-exit');assert.deepEqual(saved.checks,{});
    assert.equal(saved.sourceCommit,undefined);assert.equal(saved.artifactSha256,undefined);assert.equal(saved.controlledRequests,undefined);assert.equal(saved.realModelRequests,undefined);
  }else{
    assert.equal(saved.stage,current.stage);assert.deepEqual(saved.checks,current.checks);assert.equal(saved.controlledRequests,current.requests.length);
    assert.equal(saved.sourceCommit,current.sourceCommit);assert.equal(saved.artifactSha256,current.artifactSha256);assert.equal(saved.realModelRequests,0);
  }
  assert.equal(bytes.includes('SECRET_SENTINEL'),false);assert.equal(bytes.includes('/private/credential'),false);
});
