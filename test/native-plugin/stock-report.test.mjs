import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as reporting from './stock-report.mjs';

const secret='SECRET_SENTINEL /tmp/runner/credential https://private.invalid/?token=credential';
const failed=()=>Object.assign(new TypeError(secret),{code:secret,stdout:`stdout ${secret}`,stderr:`stderr ${secret}`});
const assertPublic=bytes=>{for(const raw of ['SECRET_SENTINEL','/tmp/runner','private.invalid','credential','stdout','stderr'])assert.equal(bytes.includes(raw),false,raw);};

test('public stock error is a bounded allowlisted type/code and message hash',()=>{
  assert.equal(typeof reporting.publicStockError,'function');
  const error=failed(),publicError=reporting.publicStockError(error);
  assert.deepEqual(publicError,{type:'TypeError',messageHash:createHash('sha256').update(error.message).digest('hex')});
  assertPublic(JSON.stringify(publicError));
  assert.deepEqual(reporting.publicStockError(Object.assign(error,{code:'EIO'})),{...publicError,code:'EIO'});
  assert.deepEqual(reporting.publicStockError({name:secret,message:secret,code:secret}),{type:'Error',messageHash:publicError.messageHash});
});

test('original failure survives teardown failure with partial checks and private raw evidence',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'stock-report-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const reports=[],report={passed:false,stage:'sharing-draft',checks:{firstBot:true},requests:[],browserErrors:[{stage:'sharing-draft',message:secret}]};
  assert.equal(typeof reporting.recordStockError,'function');
  const original=failed();await reporting.recordStockError(report,original,{evidence});
  const gui={evidence,report,async writeReport(){reports.push(structuredClone(this.report));},async shutdown(){throw Object.assign(Error(`Cleanup ${secret}`),{code:'EIO',stdout:secret,stderr:secret});}};
  assert.equal(await reporting.finishStockGui(gui),false);
  for(const row of reports)assertPublic(JSON.stringify(row));
  const final=reports.at(-1);
  assert.deepEqual(final.error,reporting.publicStockError(original));
  assert.equal(final.teardownError.code,'EIO');assert.equal(final.teardownComplete,false);assert.equal(final.testsPassed,false);
  assert.deepEqual(final.checks,{firstBot:true});
  assert.ok((await readFile(join(evidence,'stock-error-private.log'),'utf8')).includes(secret));
});

test('subprocess EIO cleanup exits nonzero and exposes only bounded public errors',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'stock-report-child-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const helper=new URL('./stock-report.mjs',import.meta.url).href;
  const script=`import {writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {finishStockGui} from ${JSON.stringify(helper)};
    const evidence=${JSON.stringify(evidence)},report={passed:true,stage:'complete',checks:{originalNativeCheck:true},requests:[]};
    const gui={evidence,report,async writeReport(){await writeFile(join(evidence,'stock-gui-report.json'),JSON.stringify(report));},async shutdown(){throw Object.assign(Error(${JSON.stringify(secret)}),{code:'EIO',stdout:${JSON.stringify(secret)},stderr:${JSON.stringify(secret)}});}};
    process.exitCode=await finishStockGui(gui)?0:1;console.log(JSON.stringify(report));`;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8'});
  assert.equal(child.status,1);assert.equal(child.signal,null);assertPublic(child.stdout);assertPublic(child.stderr);
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),report=JSON.parse(bytes);assertPublic(bytes);
  assert.equal(report.passed,false);assert.equal(report.testsPassed,true);assert.equal(report.teardownComplete,false);
  assert.deepEqual(report.checks,{originalNativeCheck:true});assert.equal(report.error.code,'EIO');assert.deepEqual(report.error,report.teardownError);
  assert.ok((await readFile(join(evidence,'stock-error-private.log'),'utf8')).includes(secret));
});

test('GUI and upgrade normal catches use shared projection without raw error publication',async()=>{
  for(const file of ['stock-gui-run.mjs','stock-upgrade-run.mjs']){
    const source=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
    assert.ok(source.includes('recordStockError('),file);
    assert.ok(!source.includes('String(error.stack)'),file);
    assert.ok(!source.includes("error?.split('\\n')"),file);
  }
});


test('actual GUI normal catch hashes execFileSync path and captured output failure',async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'stock-normal-catch-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  let error;
  try {execFileSync(process.execPath,['--eval',`process.stdout.write(${JSON.stringify(secret)});process.stderr.write(${JSON.stringify(secret)});process.exit(7);`],{stdio:'pipe'});}
  catch(failure){error=failure;}
  assert.ok(error);assert.equal(error.status,7);assert.ok(String(error.stdout).includes(secret));assert.ok(String(error.stderr).includes(secret));
  const source=await readFile(new URL('./stock-gui-run.mjs',import.meta.url),'utf8'),start=source.indexOf('} catch (error) {',source.indexOf('await runV111QualityChecks(gui)'));
  assert.ok(start>0);const end=source.indexOf('} finally {',start);assert.ok(end>start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const executeCatch=new AsyncFunction('error','gui','resolve','mkdir','writeFile','join','process','console','recordStockError',source.slice(start+'} catch (error) {'.length,end));
  const report={passed:true,checks:{originalNativeCheck:true},requests:[]},gui={report,evidence,async save(){}},processState={},publicLogs=[];
  await executeCatch(error,gui,resolve,mkdir,writeFile,join,processState,{log(value){publicLogs.push(value);}},reporting.recordStockError);
  assert.equal(processState.exitCode,1);assert.equal(report.passed,false);assertPublic(JSON.stringify(report));assertPublic(publicLogs.join('\n'));
  assert.deepEqual(report.error,reporting.publicStockError(error));assert.deepEqual(report.checks,{originalNativeCheck:true});
  const privateLog=await readFile(join(evidence,'stock-error-private.log'),'utf8');assert.ok(privateLog.includes(secret));assert.ok(privateLog.includes('stdout'));assert.ok(privateLog.includes('stderr'));
});

for(const file of ['stock-ui-run.mjs','stock-simple-ui-run.mjs','stock-bot-delete-run.mjs','stock-chat-identity-run.mjs'])test(`${file} actual catch and final summary preserve failure without a secondary reporting error`,async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'stock-wrapper-report-proof-'));t.after(()=>rm(evidence,{recursive:true,force:true}));
  const source=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
  const catchMatch=[...source.matchAll(/\}\s*catch\s*\(error\)\s*\{/g)].at(-1);assert.ok(catchMatch);
  const catchStart=catchMatch.index+catchMatch[0].length,finalMatch=/\}\s*finally\s*\{/.exec(source.slice(catchStart));assert.ok(finalMatch);
  const catchEnd=catchStart+finalMatch.index,finalStart=catchEnd+finalMatch[0].length;
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const executeCatch=new AsyncFunction('error','gui','process','recordStockError',source.slice(catchStart,catchEnd));
  const executeFinal=new AsyncFunction('gui','process','console','finishStockGui',source.slice(finalStart,source.lastIndexOf('}')));
  const reports=[],publicLogs=[],processState={},original=failed(),report={passed:true,stage:'wrapper-check',checks:{originalNativeCheck:true},requests:[]};
  const gui={evidence,report,async writeReport(){reports.push(structuredClone(this.report));},async shutdown(){throw Object.assign(Error(`Cleanup-only ${secret}`),{code:'EIO'});}};
  await executeCatch(original,gui,processState,reporting.recordStockError);
  await assert.doesNotReject(()=>executeFinal(gui,processState,{log(value){publicLogs.push(value);}},reporting.finishStockGui));
  assert.equal(processState.exitCode,1);assert.equal(report.passed,false);assert.equal(report.teardownComplete,false);
  assert.deepEqual(report.error,reporting.publicStockError(original));assert.equal(report.teardownError.code,'EIO');
  assert.deepEqual(report.checks,{originalNativeCheck:true});assert.ok(reports.length>=2);assert.equal(publicLogs.length,1);
  for(const row of reports)assertPublic(JSON.stringify(row));assertPublic(publicLogs.join('\n'));
  const summary=JSON.parse(publicLogs[0]);assert.deepEqual(summary.error,report.error);assert.equal(summary.evidence,undefined);
  const privateLog=await readFile(join(evidence,'stock-error-private.log'),'utf8');assert.ok(privateLog.includes('TypeError'));assert.ok(privateLog.includes(secret));
});
