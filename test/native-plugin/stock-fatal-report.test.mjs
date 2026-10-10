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

for(const testsPassed of [false,true])test(`official SDK exit during real unfinished cleanup records the exit with testsPassed=${testsPassed}`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-intermediate-failure-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,normal=new URL('./stock-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {finishStockGui} from ${JSON.stringify(normal)};import {installFailLoud} from ${JSON.stringify(sdk)};import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
    const evidence=${JSON.stringify(evidence)},report={passed:${testsPassed},stage:'native-teardown',checks:{originalNativeCheck:true},requests:[{}],sourceCommit:'${'d'.repeat(40)}',artifactSha256:'${'e'.repeat(64)}',realModelRequests:0};
    const gui={evidence,report,errors:[],writeReport(){return writeFile(join(evidence,'stock-gui-report.json'),JSON.stringify(report,null,2)+'\\n');},async shutdown(){
      await writeFile(join(evidence,'intermediate-snapshot.json'),await readFile(join(evidence,'stock-gui-report.json')));
      Promise.reject(new TypeError('SECRET_SENTINEL SDK exit during unfinished cleanup'));await new Promise(()=>{});
    }};
    installStockFatalReport(()=>gui);installFailLoud('controlled-sdk',process);await finishStockGui(gui);`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  const intermediate=JSON.parse(await readFile(join(evidence,'intermediate-snapshot.json'),'utf8'));
  assert.equal(intermediate.passed,false);assert.equal(intermediate.testsPassed,testsPassed);assert.equal(intermediate.teardownComplete,false);assert.equal(intermediate.fatalExit,undefined);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true,'A real SDK exit during unfinished cleanup must replace the intermediate checkpoint');assert.deepEqual(saved.processExit,{code:1});
  assert.equal(saved.passed,false);assert.equal(saved.testsPassed,testsPassed);assert.equal(saved.teardownComplete,false);
  assert.equal(saved.fatal,undefined);assert.equal(saved.error,undefined);
  assert.equal(saved.stage,'native-teardown');assert.deepEqual(saved.checks,{originalNativeCheck:true});assert.equal(saved.controlledRequests,1);assert.equal(saved.realModelRequests,0);
  assert.equal(saved.sourceCommit,'d'.repeat(40));assert.equal(saved.artifactSha256,'e'.repeat(64));assert.equal(bytes.includes('SECRET_SENTINEL'),false);
});

test('real caught cleanup failure retains its known public errors while recording nonzero exit',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-caught-cleanup-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,normal=new URL('./stock-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {finishStockGui} from ${JSON.stringify(normal)};import {installFailLoud} from ${JSON.stringify(sdk)};import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
    const evidence=${JSON.stringify(evidence)},report={passed:true,stage:'native-teardown',checks:{originalNativeCheck:true},requests:[{}],realModelRequests:0};
    const gui={evidence,report,errors:[],writeReport(){return writeFile(join(evidence,'stock-gui-report.json'),JSON.stringify(report,null,2)+'\\n');},async shutdown(){throw Object.assign(new RangeError('SECRET_SENTINEL caught cleanup failure'),{code:'EIO'});}};
    installStockFatalReport(()=>gui);installFailLoud('controlled-sdk',process);
    const passed=await finishStockGui(gui);await writeFile(join(evidence,'caught-snapshot.json'),await readFile(join(evidence,'stock-gui-report.json')));process.exitCode=passed?0:1;`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);
  const normalReport=JSON.parse(await readFile(join(evidence,'caught-snapshot.json'),'utf8'));
  assert.equal(normalReport.teardownComplete,false);assert.equal(normalReport.teardownError.type,'RangeError');assert.equal(normalReport.teardownError.code,'EIO');assert.match(normalReport.teardownError.messageHash,/^[a-f\d]{64}$/);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});assert.equal(saved.passed,false);assert.equal(saved.testsPassed,true);assert.equal(saved.teardownComplete,false);
  assert.deepEqual(saved.error,normalReport.error);assert.deepEqual(saved.teardownError,normalReport.teardownError);assert.deepEqual(saved.checks,{originalNativeCheck:true});assert.equal(saved.controlledRequests,1);
  assert.equal(saved.fatal,undefined);assert.equal(bytes.includes('SECRET_SENTINEL'),false);
});

test('exit fallback never converts invalid current error evidence into a public error or hash',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-invalid-error-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},report:{commandExitCode:'7',error:{type:'Error',messageHash:'SECRET_SENTINEL invalid hash',message:'SECRET_SENTINEL raw error'},teardownError:{type:'SECRET_SENTINEL invalid type',messageHash:'${'a'.repeat(64)}',code:'EIO'}}}));process.exit(1);`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});assert.equal(saved.error,undefined);assert.equal(saved.teardownError,undefined);assert.equal(saved.fatal,undefined);assert.equal(saved.commandExitCode,undefined);
  assert.equal(bytes.includes('SECRET_SENTINEL'),false);
});

test('exit fallback retains the known integer exit of a real failed initialization command',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-command-exit-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,normal=new URL('./stock-report.mjs',import.meta.url).href;
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {publicStockError} from ${JSON.stringify(normal)};import {execFileSync} from 'node:child_process';
    let report;installStockFatalReport(()=>report?({evidence:${JSON.stringify(evidence)},report}):undefined,{output:${JSON.stringify(evidence)}});
    try{execFileSync(process.execPath,['--eval','process.exit(7)'],{stdio:'pipe'});}catch(error){report={stage:'standard-profile-initialization-or-plugin-install',commandExitCode:error.status,error:publicStockError(error)};process.exitCode=1;}`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});assert.equal(saved.commandExitCode,7);
  assert.equal(saved.error.type,'Error');assert.match(saved.error.messageHash,/^[a-f\d]{64}$/);assert.equal(saved.teardownComplete,false);assert.equal(saved.stage,'standard-profile-initialization-or-plugin-install');
  assert.equal(saved.controlledRequests,undefined);assert.equal(saved.realModelRequests,undefined);assert.equal(bytes.includes('process.exit(7)'),false);
});

for(const [label,prior,expected] of [
  ['known zero',{controlledRequests:0},0],['known three',{controlledRequests:3},3],
  ['negative unknown',{controlledRequests:-1},undefined],['string unknown',{controlledRequests:'3'},undefined],
  ['empty actual array',{requests:[],controlledRequests:3},0],['actual array length',{requests:[{},{}],controlledRequests:0},2],
])test(`official SDK exit keeps current request-count proof: ${label}`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-current-count-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {installFailLoud} from ${JSON.stringify(sdk)};
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},report:{stage:'current-native-stage',checks:{originalNativeCheck:true},...${JSON.stringify(prior)}}}));
    installFailLoud('controlled-sdk',process);Promise.reject(new TypeError('SECRET_SENTINEL current SDK exit'));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});assert.equal(saved.controlledRequests,expected);assert.deepEqual(saved.checks,{originalNativeCheck:true});
  assert.equal(saved.realModelRequests,undefined);assert.equal(bytes.includes('SECRET_SENTINEL'),false);
});

for(const mode of ['complete','caught-failure','invalid-false','raw-error','mismatch'])test(`current actual SDK child failure has terminal parent cleanup guard: ${mode}`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-child-parent-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href,normal=new URL('./stock-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  const childScript=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {installFailLoud} from ${JSON.stringify(sdk)};
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},report:{stage:'child-native-stage',checks:{childOriginalCheck:true},requests:[],sourceCommit:'${'d'.repeat(40)}',artifactSha256:'${'e'.repeat(64)}',realModelRequests:0}}));
    installFailLoud('controlled-sdk',process);Promise.reject(new TypeError('SECRET_SENTINEL current child failure'));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',childScript],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assert.ok(child.stderr.includes('fatal load failure'));
  const original=JSON.parse(await readFile(join(evidence,'stock-gui-report.json'),'utf8'));
  assert.equal(original.teardownComplete,false);assert.equal(original.controlledRequests,0);assert.equal(original.requests,undefined);
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};import {publicStockError} from ${JSON.stringify(normal)};import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
    const evidence=${JSON.stringify(evidence)},report=${JSON.stringify(original)};
    installStockFatalReport(()=>({evidence,report}));
    async function shutdown(){${mode==='caught-failure'?"throw new TypeError('SECRET_SENTINEL settled parent cleanup failure');":''}}
    try{await shutdown();report.parentCleanup={complete:true};}catch(error){report.parentCleanup={complete:false,error:publicStockError(error)};}
    ${mode==='invalid-false'?'report.parentCleanup={complete:false};':mode==='raw-error'?`report.parentCleanup={complete:false,error:{type:'TypeError',messageHash:'${'a'.repeat(64)}',message:'SECRET_SENTINEL raw cleanup error'}};`:''}
    const bytes=JSON.stringify(report,null,2)+'\\n';await writeFile(join(evidence,'stock-gui-report.json'),bytes);await writeFile(join(evidence,'parent-snapshot.json'),bytes);
    ${mode==='mismatch'?"report.stage='current-parent-stage';report.checks={currentParentCheck:true};":''}
    process.exitCode=1;`;
  const parent=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(parent.status,1);assert.equal(parent.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),saved=JSON.parse(bytes),snapshot=await readFile(join(evidence,'parent-snapshot.json'),'utf8');
  if(mode==='complete'||mode==='caught-failure'){
    assert.equal(bytes,snapshot,'Current child evidence and settled parent cleanup must survive nonzero parent exit byte-for-byte');
    assert.equal(saved.teardownComplete,false);assert.equal(saved.controlledRequests,0);assert.equal(saved.testsPassed,false);assert.deepEqual(saved.checks,{childOriginalCheck:true});
    assert.equal(saved.parentCleanup.complete,mode==='complete');
    if(mode==='caught-failure'){assert.equal(saved.parentCleanup.error.type,'TypeError');assert.match(saved.parentCleanup.error.messageHash,/^[a-f\d]{64}$/);}
  }else{
    assert.notEqual(bytes,snapshot,'Invalid or mismatching parent checkpoint must not be preserved');assert.equal(saved.fatalExit,true);assert.deepEqual(saved.processExit,{code:1});
    if(mode==='mismatch'){assert.equal(saved.stage,'current-parent-stage');assert.deepEqual(saved.checks,{currentParentCheck:true});}
    else assert.equal(saved.parentCleanup,undefined);
  }
  assert.equal(saved.sourceCommit,original.sourceCommit);assert.equal(saved.artifactSha256,original.artifactSha256);assert.equal(bytes.includes('SECRET_SENTINEL'),false);
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
