import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const mode of ['throw','reject'])test(`stock fatal monitor records ${mode} without masking the fatal exit or exposing exception secrets`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-fatal-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-fatal-report.mjs',import.meta.url).href;
  const script=`import {installStockFatalReport} from ${JSON.stringify(helper)};
    installStockFatalReport(()=>({evidence:${JSON.stringify(evidence)},errors:[],report:{stage:'real-native-stage',checks:{originalNativeCheck:true},requests:[{}],sourceCommit:'${'a'.repeat(40)}',artifactSha256:'${'b'.repeat(64)}',sourceTreeDirty:false,realModelRequests:0}}));
    const error=new TypeError('SECRET_SENTINEL /private/credential https://private.invalid/token');error.code='SECRET_SENTINEL';
    ${mode==='throw'?'setImmediate(()=>{throw error;});':'Promise.reject(error);'}
  `;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),report=JSON.parse(bytes);
  assert.equal(report.fatalExit,true);assert.equal(report.passed,false);assert.equal(report.teardownComplete,false);
  assert.equal(report.fatal.type,'TypeError');assert.equal(report.fatal.origin,mode==='throw'?'uncaughtException':'unhandledRejection');
  assert.deepEqual(report.checks,{originalNativeCheck:true});assert.equal(report.controlledRequests,1);
  assert.equal(report.sourceCommit,'a'.repeat(40));assert.equal(report.artifactSha256,'b'.repeat(64));
  assert.match(report.fatal.messageHash,/^[a-f\d]{64}$/);assert.equal(report.fatal.code,undefined);
  for(const secret of ['SECRET_SENTINEL','/private/credential','https://private.invalid','token'])assert.equal(bytes.includes(secret),false);
});
