import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp,writeFile,readFile,mkdir,symlink,access,rename,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Context } from '@deepseek-ai/cordis';
import { provideCmdline,internals as cmdlineIo } from '@deepseek-ai/dsh-cmdline';
import { OwnedNativeController } from '../src/native-controller.mjs';
import { fixture,runtime,deferred,response } from './native-fixture.mjs';
import { guideAcceptancePayloads } from '../src/guide-acceptance.mjs';
import { guideInput } from './guide-fixture.mjs';

async function optionalModule(path){try{return await import(path);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};}}
const app=await optionalModule('../src/owner-app.mjs'),startup=await optionalModule('../src/owner-startup.mjs'),input=await optionalModule('../src/owner-input.mjs');
function entry(module,name='apply'){assert.equal(typeof module[name],'function','Restricted owner entry must exist');return module[name];}
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function waitFor(read,description){const deadline=Date.now()+4000;while(Date.now()<deadline){const result=read();if(result)return result;await pause();}assert.fail(`Timed out: ${description}`);}
async function ownerFixture({mode='init',enable=false,home,context,capacity}={}){
 entry(app);entry(startup);
 const directory=home ?? await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'owner-case-'));
 const ctx=context ?? await runtime(directory),stdin=new PassThrough(),stdout=new PassThrough(),records=[],exits=[];
 stdout.setEncoding('utf8');let pending='';stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))!==-1){records.push(JSON.parse(pending.slice(0,end)));pending=pending.slice(end+1);}});
 let ready;provideCmdline(ctx,{args:[`--${mode}`,...enable?['--enable-model-requests']:[]],exit:code=>exits.push(code),ready:{onReady(fn){ready=fn;return ()=>{ready=undefined;};}}});
 await ctx.plugin(startup);
 const options={homeDirectory:directory,agentPreset:'acceptance/empty',input:stdin,output:stdout,...capacity?{capacity}:{}};
 const fiber=await ctx.plugin(app,options);await fiber.await();assert.equal(fiber.state,2,'Native const-enum FiberState.ACTIVE is 2');ready();
 const initial=await waitFor(()=>records.find(r=>r.event==='ready'),'owner ready');
 const send=frame=>stdin.write(JSON.stringify(frame)+'\n');
 const next=async(frame,match)=>{const before=records.length;send(frame);return waitFor(()=>records.slice(before).find(match ?? (r=>r.command===frame.command)),'command response');};
 return {directory,ctx,fiber,stdin,stdout,records,exits,initial,send,next,
  async close(){await fiber.dispose();await ctx.fiber.dispose();stdin.destroy();stdout.destroy();}};
}

test('owner closure grammar exposes only bounded task commands and rejects identity or target claims',()=>{
 const frames=[{command:'progress'},{command:'plan',operationId:'p1',expectedRevision:1,steps:[{title:'Check content',evidence:'digest'}]},
  {command:'advance',operationId:'a1',planId:'bound-plan',expectedRevision:1,cursor:1},
  {command:'submit',operationId:'s1',expectedRevision:1,expectedAuthorityEpoch:1,artifactDigest:'a'.repeat(64),evidence:'manual content only'},
  {command:'accept',operationId:'c1',expectedRevision:2,artifactDigest:'a'.repeat(64),acceptanceVersion:1,outcome:'inconclusive'}];
 for(const frame of frames){assert.deepEqual(input.parseOwnerCommand(JSON.stringify(frame)),frame);
  for(const field of ['actor','caller','peer','authorizationRef','taskId'])assert.throws(()=>input.parseOwnerCommand(JSON.stringify({...frame,[field]:'untrusted'})),{code:'invalid_owner_command'});
 }
 for(const frame of [ {...frames[1],expectedRevision:0},{...frames[1],steps:[]},{...frames[1],steps:[{title:'x',evidence:'y',actor:'human'}]},
  {...frames[2],cursor:0},{...frames[3],artifactDigest:'bad'},{...frames[3],evidence:'x'.repeat(4097)},{...frames[4],outcome:'settled'}])
  assert.throws(()=>input.parseOwnerCommand(JSON.stringify(frame)),{code:'invalid_owner_command'});
});
test('actual private Owner stdin closes progress submit and content acceptance with existing guards',async()=>{
 let calls=0;globalThis.fetch=()=>{calls++;throw Error('No model request in content closure');};const f=await ownerFixture();
 try{const first=await f.next({command:'progress'});assert.equal(first.event,'result');assert.equal(first.publicHumanAuthorityVerified,false);
  const t=first.task;assert.equal(t.revision,1);assert.equal(first.authority,'private-runtime-owner');
  const planned=await f.next({command:'plan',operationId:'closure-plan',expectedRevision:t.revision,steps:[{title:'Manual content review',evidence:'artifact digest'}]});
  assert.equal(planned.progress.authorizationRef,'native-owner');const advanced=await f.next({command:'advance',operationId:'closure-advance',planId:planned.progress.planId,expectedRevision:1,cursor:1});
  assert.equal(advanced.progress.state,'waiting_native');assert.equal(advanced.progress.checkpoint.trigger,'authorized_check');assert.equal(advanced.progress.checkpoint.effectsIssued,false);
  const p=guideAcceptancePayloads(guideInput({task:t,expectedAuthorityEpoch:first.authorityEpoch,executionEvidence:null}));
  const submit={command:'submit',operationId:'closure-submit',expectedRevision:p.expectedRevisions.submit,...p.submitTask};delete submit.taskId;
  assert.equal((await f.next({...submit,operationId:'stale-epoch',expectedAuthorityEpoch:first.authorityEpoch+1})).errorCategory,'authority_conflict');
  const submitted=await f.next(submit);assert.equal(submitted.task.revision,2);assert.equal(submitted.task.submission.producer.kind,'host');assert.equal(submitted.task.submission.nativeExecutionVerified,false);
  assert.deepEqual((await f.next(submit)).task,submitted.task);
  assert.equal((await f.next({...submit,expectedRevision:2})).errorCategory,'owner_operation_conflict');
  const accept={command:'accept',operationId:'closure-accept',expectedRevision:p.expectedRevisions.accept,...p.acceptTask};delete accept.taskId;
  assert.equal((await f.next({...accept,operationId:'stale-version',acceptanceVersion:2})).errorCategory,'acceptance_conflict');
  assert.equal((await f.next({...accept,operationId:'wrong-digest',artifactDigest:'b'.repeat(64)})).errorCategory,'acceptance_conflict');
  assert.equal((await f.next({...accept,operationId:'stale-revision',expectedRevision:1})).errorCategory,'revision_conflict');
  const accepted=await f.next(accept);assert.equal(accepted.task.responsibility,'verified');assert.equal(accepted.task.acceptanceCheck.actor.kind,'host');
  assert.equal(accepted.task.acceptanceCheck.acceptanceVersion,t.acceptanceVersion);assert.equal(accepted.task.artifactDigest,p.artifactDigest);
  assert.equal((await f.next({command:'progress'})).task.revision,3);assert.equal(calls,0);
  const db=new DatabaseSync(join(f.directory,'owner-state','product.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT count(*) AS n FROM objects WHERE kind='grant' AND id='root'").get().n,0);
   const grant=JSON.parse(db.prepare("SELECT value FROM objects WHERE kind='grant' AND id='native-owner'").get().value);assert.equal(grant.scope,'owned-text-sessions');assert.equal(grant.epoch,1);
  }finally{db.close();}
 }finally{await f.close();}
});
test('content passed preserves actual native UNKNOWN usage reservation and original IDs on cold resume',async()=>{
 const entered=deferred();let calls=0;globalThis.fetch=async(_url,options)=>{calls++;entered.resolve();await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 const f=await ownerFixture({enable:true});let resumed;
 try{const initial=await f.next({command:'progress'}),plan=await f.next({command:'plan',operationId:'unknown-plan',expectedRevision:1,steps:[{title:'Observe original outcome',evidence:'original ID'}]});
  await f.next({command:'prepare',operationId:'content-original-unknown',kind:'execution',text:'Harmless offline pending text.'});await f.next({command:'admit',operationId:'content-original-unknown'});
  await f.next({command:'run',operationId:'content-original-unknown'},r=>r.event==='started');await entered.promise;
  const before=(await f.next({command:'stop',operationId:'content-original-unknown'})).operation;assert.equal(before.state,'unknown');assert.equal(before.usage,null);assert.equal(before.reservationHeld,true);
  const advanced=await f.next({command:'advance',operationId:'unknown-observation',planId:plan.progress.planId,expectedRevision:1,cursor:1});
  assert.equal(advanced.progress.state,'reconciling_unknown');assert.equal(advanced.progress.retryCount,0);
  const p=guideAcceptancePayloads(guideInput({task:initial.task,expectedAuthorityEpoch:initial.authorityEpoch,executionEvidence:before}));assert.equal(p.overallOutcome,'inconclusive');
  const submit={command:'submit',operationId:'unknown-submit',expectedRevision:1,...p.submitTask};delete submit.taskId;await f.next(submit);
  const accept={command:'accept',operationId:'unknown-accept',expectedRevision:2,...p.acceptTask};delete accept.taskId;
  assert.equal((await f.next(accept)).task.responsibility,'verified');assert.equal((await f.next({command:'inspect',operationId:before.operationId})).operation.state,'unknown');
  const view=await f.next({command:'progress'});assert.equal(view.operations.find(x=>x.operationId===before.operationId).reservationHeld,true);assert.equal(view.task.submission.nativeExecutionVerified,false);
  const home=f.directory,ids=f.initial.sessions;await f.close();resumed=await ownerFixture({mode:'resume',home});
  const restored=(await resumed.next({command:'inspect',operationId:before.operationId})).operation;
  assert.equal(restored.operationId,before.operationId);assert.equal(restored.nativeOperationId,before.nativeOperationId);assert.equal(restored.state,'unknown');
  assert.equal(restored.usage,null);assert.equal(restored.reservationHeld,true);assert.deepEqual(resumed.initial.sessions,ids);
  assert.equal((await resumed.next({command:'progress'})).task.responsibility,'verified');assert.equal(calls,1,'one synthetic request, no replay');
 }finally{if(resumed)await resumed.close();else await f.close();}
});

test('native owner-capability construction creates no configured-human root grant',async()=>{
 const f=await fixture(OwnedNativeController);try{assert.equal(f.ledger.get('grant','root'),null);assert.equal(f.ledger.get('grant','native-owner').authority,'private-runtime-owner');}finally{await f.close();}
});
test('owner startup accepts only native launcher flags; help does not publish startup authority',async()=>{
 const apply=entry(startup),ctx=new Context(),exits=[],out=[];const saved=cmdlineIo.stdout;cmdlineIo.stdout={write:text=>out.push(text)};
 try{provideCmdline(ctx,{args:['--help'],exit:code=>exits.push(code)});apply(ctx);assert.deepEqual(exits,[0]);assert.match(out.join(''),/dsh-bot-owner/);assert.equal(ctx.get('dshBotOwnerStartup'),undefined);}finally{cmdlineIo.stdout=saved;await ctx.fiber.dispose();}
 const bad=new Context();try{const badExits=[];provideCmdline(bad,{args:['--init','--resume'],exit:code=>badExits.push(code)});apply(bad);assert.deepEqual(badExits,[2]);assert.equal(bad.get('dshBotOwnerStartup'),undefined);}finally{await bad.fiber.dispose();}
});
test('owner JSON schema rejects caller claims, unknown fields and oversize text before effects',()=>{
 const parse=entry(input,'parseOwnerCommand');
 assert.deepEqual(parse('{"command":"status"}'),{command:'status'});
 for(const field of ['actor','caller','authorizationRef','authenticatedActor','peer'])assert.throws(()=>parse(JSON.stringify({command:'status',[field]:{kind:'human',id:'owner'}})),{code:'invalid_owner_command'});
 assert.throws(()=>parse(JSON.stringify({command:'prepare',operationId:'r1',kind:'execution',text:'x'.repeat(4097)})),{code:'invalid_owner_command'});
 assert.throws(()=>parse('x'.repeat(8193)),{code:'invalid_owner_command'});
 assert.throws(()=>parse('{"command":"createRole"}'),{code:'invalid_owner_command'});
});
test('actual native owner app creates two empty Sessions with no public controller or model request',async()=>{
 let calls=0;globalThis.fetch=()=>{calls++;throw Error('Zero-model owner fixture');};const f=await ownerFixture();
 try{assert.equal(f.initial.authority,'private-runtime-owner');assert.equal(f.initial.publicHumanAuthorityVerified,false);assert.equal(f.initial.modelRequestsEnabled,false);assert.equal(f.initial.modelTools,0);
  assert.notEqual(f.initial.sessions.contact,f.initial.sessions.execution);
  assert.equal(f.ctx.get('dshBotOwner'),undefined);assert.equal(f.ctx.get('dshBotOwnerController'),undefined);assert.equal(f.ctx.get('dshBotOwnerCaller'),undefined);
  assert.equal(calls,0);const bad=await f.next({command:'status',actor:{kind:'human',id:'owner'}},r=>r.event==='error');assert.equal(bad.errorCategory,'invalid_owner_command');assert.equal(calls,0);
 }finally{await f.close();}
});
test('owner inspect and status show operation, CLI exit and cleanup independently without inventing future process facts',async()=>{
 const f=await ownerFixture();try{
  const p=(await f.next({command:'prepare',operationId:'layer-1',kind:'execution',text:'Bounded offline explanation.'})).operation;
  assert.equal(p.explanation?.operation.state,'NOT_SENT');assert.equal(p.explanation.cliExit.state,'UNCONFIRMED');assert.equal(p.explanation.cleanup.state,'UNCONFIRMED');
  await f.next({command:'admit',operationId:'layer-1'});
  const inspected=(await f.next({command:'inspect',operationId:'layer-1'})).operation,status=await f.next({command:'status'});
  assert.deepEqual(status.operations.find(p=>p.operationId==='layer-1').explanation,inspected.explanation);assert.equal(inspected.explanation.operation.state,'PENDING');
 }finally{await f.close();}
});
test('default owner app prepare/admit/inspect/stop is native zero-model; repeated original IDs are stable and conflicts rejected',async()=>{
 let calls=0;globalThis.fetch=()=>{calls++;throw Error('Zero-model owner fixture');};const f=await ownerFixture();
 try{const frame={command:'prepare',operationId:'review-1',kind:'execution',text:'Harmless owned source review.'};
  const first=await f.next(frame),again=await f.next(frame);assert.equal(first.operation.state,'prepared');assert.deepEqual(again.operation,first.operation);
  const conflict=await f.next({...frame,text:'Different input'},r=>r.event==='error');assert.equal(conflict.errorCategory,'owner_operation_conflict');
  assert.equal((await f.next({command:'admit',operationId:'review-1'})).operation.state,'admitted');
  const refused=await f.next({command:'run',operationId:'review-1'},r=>r.event==='error');assert.equal(refused.errorCategory,'owner_model_requests_disabled');
  assert.equal((await f.next({command:'inspect',operationId:'review-1'})).operation.state,'admitted');
  const stop=await f.next({command:'stop',operationId:'review-1'});assert.equal(stop.operation.state,'fenced');assert.equal(stop.operation.reservationHeld,false);assert.equal(calls,0);
  const blocked=await f.next({...frame,operationId:'review-2'},r=>r.event==='error');assert.equal(blocked.errorCategory,'generation_stopped');
 }finally{await f.close();}
});
test('owner resume preserves original IDs and never automatically drives fenced work',async()=>{
 let calls=0;globalThis.fetch=()=>{calls++;throw Error('Zero-model owner fixture');};const first=await ownerFixture();let second;
 try{await first.next({command:'prepare',operationId:'cold-1',kind:'contact',text:'Harmless contact.'});await first.next({command:'admit',operationId:'cold-1'});await first.next({command:'stop',operationId:'cold-1'});const ids=first.initial.sessions;const home=first.directory;await first.close();
  second=await ownerFixture({mode:'resume',home});assert.deepEqual(second.initial.sessions,ids);assert.equal((await second.next({command:'inspect',operationId:'cold-1'})).operation.state,'fenced');assert.equal(calls,0);
 }finally{if(second)await second.close();else await first.close();}
});
test('resume missing data and symlink escape fail before a product writer changes anything',async()=>{
 entry(app);entry(startup);const prior=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'prior-owner-')),home=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'link-owner-'));
 const target=join(prior,'product.sqlite');await writeFile(target,'Keep this temporary prior state byte-identical.');const before=await readFile(target);
 await symlink(prior,join(home,'owner-state'));const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
 try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_path_conflict'});assert.deepEqual(await readFile(target),before);}finally{await ctx.fiber.dispose();}
 const missing=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'missing-owner-')),other=await runtime(missing);provideCmdline(other,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await other.plugin(startup);
 try{await assert.rejects(()=>app.apply(other,{homeDirectory:missing,agentPreset:'acceptance/empty'}),{code:'owner_state_incomplete'});await assert.rejects(access(join(missing,'owner-state')),{code:'ENOENT'});}finally{await other.fiber.dispose();}
});
test('model drive is offline-only simulated here; inspect and stop stay reachable during pending work',async()=>{
 const entered=deferred();let calls=0;globalThis.fetch=async(_url,options)=>{calls++;entered.resolve();await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 const f=await ownerFixture({enable:true});try{await f.next({command:'prepare',operationId:'pending-1',kind:'execution',text:'Offline cancellation case.'});await f.next({command:'admit',operationId:'pending-1'});
  const marker=await f.next({command:'run',operationId:'pending-1'},r=>r.event==='started');assert.equal(marker.operationId,'pending-1');await entered.promise;
  assert.equal((await f.next({command:'inspect',operationId:'pending-1'})).operation.localTransport,'open');
  const stopped=await f.next({command:'stop',operationId:'pending-1'});assert.equal(stopped.operation.state,'unknown');assert.equal(stopped.operation.reservationHeld,true);assert.equal(calls,1);
  assert.equal((await f.next({command:'run',operationId:'pending-1'})).operation.state,'unknown');assert.equal(calls,1);
 }finally{await f.close();}
});
test('EOF and explicit close revoke stdin admission before bounded native exit request',async()=>{
 for(const source of ['close','eof']){const f=await ownerFixture();try{if(source==='close')await f.next({command:'close'});else f.stdin.end();await waitFor(()=>f.exits.length,'native appExit');assert.deepEqual(f.exits,[0]);assert.equal(f.stdin.listenerCount('data'),0);}finally{await f.close();}}
});
for(const phase of ['before','after'])for(const source of ['close','eof'])test(`owner exit exposes ${phase} cleanup failure on ${source} with nonzero native exit`,async()=>{
 const f=await ownerFixture(),original=OwnedNativeController.prototype.close,code=`OFFLINE_OWNER_CLOSE_${phase.toUpperCase()}`;let failed=false;
 OwnedNativeController.prototype.close=async function(caller){
  if(phase==='before' && !failed){failed=true;throw Object.assign(Error('Opaque injected cleanup detail'),{code});}
  await original.call(this,caller);
  if(phase==='after' && !failed){failed=true;throw Object.assign(Error('Opaque injected cleanup detail'),{code});}
 };
 try{
  if(source==='close')await f.next({command:'close'});else f.stdin.end();
  await waitFor(()=>f.exits.length,'cleanup-aware native appExit');assert.deepEqual(f.exits,[1]);
  assert.equal(f.stdin.listenerCount('data'),0);assert.ok(f.records.some(r=>r.event==='error' && r.command==='close' && r.errorCategory===code));
  assert.equal(JSON.stringify(f.records).includes('Opaque injected cleanup detail'),false);
 }finally{OwnedNativeController.prototype.close=original;await f.close();}
});
test('missing persisted owner fence metadata cannot be repaired by resume; prior database bytes stay unchanged',async()=>{
 const first=await ownerFixture(),home=first.directory;await first.close();const path=join(home,'owner-state','product.sqlite');
 const db=new DatabaseSync(path);db.prepare("DELETE FROM objects WHERE kind='grant' AND id='native-owner'").run();db.close();const before=await readFile(path);
 const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
 try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_incomplete'});assert.deepEqual(await readFile(path),before);}finally{await ctx.fiber.dispose();}
});

test('owner cleanup rejects object error codes before writing the public protocol',async()=>{
 const f=await ownerFixture(),original=OwnedNativeController.prototype.close;
 OwnedNativeController.prototype.close=async function(caller){await original.call(this,caller);throw Object.assign(Error('opaque cleanup message'),{
  code:{toString:()=> 'VALID_CODE',detail:'opaque code object'},
 });};
 try{await f.next({command:'close'});await waitFor(()=>f.exits.length,'category-safe native appExit');assert.deepEqual(f.exits,[1]);
  const error=f.records.find(r=>r.event==='error' && r.command==='close');assert.equal(error?.errorCategory,'owner_runtime_unconfirmed');
  assert.equal(JSON.stringify(f.records).includes('opaque'),false);
 }finally{OwnedNativeController.prototype.close=original;await f.close();}
});

test('owner projects legacy opaque native failure codes as safe categories while retaining receipts',async()=>{
 const f=await ownerFixture({enable:true}),original=OwnedNativeController.prototype.inspect;
 try{
  globalThis.fetch=async()=>response();const operationId='legacy-category';
  await f.next({command:'prepare',operationId,kind:'execution',text:'Harmless offline text.'});await f.next({command:'admit',operationId});
  await f.next({command:'run',operationId},r=>r.event==='started');
  const settled=await waitFor(()=>f.records.find(r=>r.command==='run' && r.operation?.operationId===operationId),'known native result');
  assert.equal(settled.operation.state,'settled');assert.equal(settled.operation.errorCategory,null);
  for(const code of ['unsafe opaque/code',{detail:'opaque legacy category'}]){
   OwnedNativeController.prototype.inspect=function(...args){const p=original.apply(this,args);return {...p,native:{...p.native,failureCode:code}};};
   const inspected=(await f.next({command:'inspect',operationId})).operation;
   assert.equal(inspected.errorCategory,'owner_runtime_unconfirmed');assert.deepEqual(inspected.receipt,settled.operation.receipt);
   assert.deepEqual(inspected.usage,settled.operation.usage);assert.equal(inspected.reservationHeld,false);
  }
 }finally{OwnedNativeController.prototype.inspect=original;await f.close();}
});
test('batched inspect cannot project an in-progress admission as unknown',async()=>{
 const f=await ownerFixture();try{await f.next({command:'prepare',operationId:'admission-1',kind:'execution',text:'Offline admission race.'});
  const before=f.records.length;f.stdin.write('{"command":"admit","operationId":"admission-1"}\n{"command":"inspect","operationId":"admission-1"}\n');
  await waitFor(()=>f.records.length>=before+2,'batched responses');const records=f.records.slice(before);
  assert.ok(records.some(r=>r.event==='error' && r.command==='inspect' && r.errorCategory==='owner_operation_busy'));
  assert.ok(records.some(r=>r.command==='admit' && r.operation?.state==='admitted'));
  assert.equal((await f.next({command:'inspect',operationId:'admission-1'})).operation.state,'admitted');
 }finally{await f.close();}
});
test('a serialized fake Context cannot open an owner app writer',async()=>{
 entry(app);const fake={fiber:{},get:()=>({})};await assert.rejects(()=>app.apply(fake,{homeDirectory:'/tmp/not-an-owned-home'}),{code:'unsupported_host_identity'});
});

test('resume rejects entry Session identity differing from the native binding before any writer',async()=>{
 const first=await ownerFixture(),home=first.directory;await first.close();const path=join(home,'owner-state','entry.json');
 const stored=JSON.parse(await readFile(path,'utf8'));stored.sessions.execution='session-forged-display';await writeFile(path,JSON.stringify(stored));
 const database=join(home,'owner-state','product.sqlite'),before=await readFile(database);
 const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
 try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_incomplete'});assert.deepEqual(await readFile(database),before);}finally{await ctx.fiber.dispose();}
});

test('an allowed caller operation ID cannot collide with an internal stop envelope',async()=>{
 const f=await ownerFixture();try{
  await f.next({command:'prepare',operationId:'owner-stop-stop-target',kind:'contact',text:'Harmless caller ID resembling an internal control.'});
  await f.next({command:'prepare',operationId:'stop-target',kind:'execution',text:'Harmless target.'});
  await f.next({command:'admit',operationId:'stop-target'});
  const before=f.records.length;f.send({command:'stop',operationId:'stop-target'});
  const result=await waitFor(()=>f.records.slice(before).find(r=>r.command==='stop'),'stop response');
  assert.equal(result.operation?.state,'fenced');assert.equal(result.operation.reservationHeld,false);
 }finally{await f.close();}
});

test('resume rejects SQLite sidecar and Session-root links before a product writer',async()=>{
 for(const which of ['sidecar','sessions']){
  const first=await ownerFixture(),home=first.directory;await first.close();
  const prior=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'escape-prior-')),sentinel=join(prior,'sentinel');await writeFile(sentinel,'Temporary prior state, never write through a link.');
  if(which==='sidecar')await symlink(sentinel,join(home,'owner-state','product.sqlite-wal'));
  else{await rename(join(home,'sessions'),join(home,'sessions-original'));await symlink(prior,join(home,'sessions'));}
  const database=join(home,'owner-state','product.sqlite'),before=await readFile(database),priorBytes=await readFile(sentinel);
  const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
  try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_path_conflict'});assert.deepEqual(await readFile(database),before);assert.deepEqual(await readFile(sentinel),priorBytes);}finally{await ctx.fiber.dispose();}
 }
});

test('a missing native Session artifact rejects resume before either journal writer',async()=>{
 const first=await ownerFixture(),home=first.directory,session=first.initial.sessions.execution;await first.close();
 const project=(await readdir(join(home,'sessions')))[0];await rename(join(home,'sessions',project,session),join(home,'missing-session-backup'));
 const paths=['product.sqlite','journal/journal.sqlite'].map(p=>join(home,'owner-state',p)),before=await Promise.all(paths.map(p=>readFile(p)));
 const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
 try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_incomplete'});
  assert.deepEqual(await Promise.all(paths.map(p=>readFile(p))),before);}finally{await ctx.fiber.dispose();}
});

test('native plugin disposal revokes command admission synchronously before effects run',async()=>{
 const f=await ownerFixture();try{
  const closing=f.fiber.dispose();f.send({command:'prepare',operationId:'dispose-window',kind:'execution',text:'Harmless same-stack lifetime probe.'});await closing;
  const db=new DatabaseSync(join(f.directory,'owner-state','product.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT count(*) AS n FROM objects WHERE kind='ownerCommand' AND id='dispose-window'").get().n,0);
   assert.equal(db.prepare("SELECT count(*) AS n FROM objects WHERE kind='nativeOperation' AND id='dispose-window'").get().n,0);}finally{db.close();}
 }finally{await f.close();}
});

test('array command values are malformed input and cannot fall through to a generation stop',async()=>{
 assert.throws(()=>input.parseOwnerCommand('{"command":["inspect"],"operationId":"array-target"}'),{code:'invalid_owner_command'});
 const f=await ownerFixture();try{
  await f.next({command:'prepare',operationId:'array-target',kind:'execution',text:'Harmless schema test.'});await f.next({command:'admit',operationId:'array-target'});
  const before=f.records.length;f.send({command:['inspect'],operationId:'array-target'});const result=await waitFor(()=>f.records[before],'malformed response');
  assert.equal(result.errorCategory,'invalid_owner_command');assert.equal((await f.next({command:'inspect',operationId:'array-target'})).operation.state,'admitted');
 }finally{await f.close();}
});
test('empty or mismatched native journal metadata rejects resume before writers',async()=>{
 for(const mode of ['empty','foreign']){
  const first=await ownerFixture(),home=first.directory;await first.close();const path=join(home,'owner-state','journal','journal.sqlite');
  if(mode==='empty')await writeFile(path,'');else{const db=new DatabaseSync(path);const row=JSON.parse(db.prepare('SELECT data FROM meta WHERE id=1').get().data);row.hostId='foreign-owner';db.prepare('UPDATE meta SET data=? WHERE id=1').run(JSON.stringify(row));db.close();}
  const paths=['product.sqlite','journal/journal.sqlite','journal/writer.lock'].map(p=>join(home,'owner-state',p)),before=await Promise.all(paths.map(p=>readFile(p)));
  const ctx=await runtime(home);provideCmdline(ctx,{args:['--resume'],exit:()=>{},ready:{onReady:()=>()=>{}}});await ctx.plugin(startup);
  try{await assert.rejects(()=>app.apply(ctx,{homeDirectory:home,agentPreset:'acceptance/empty'}),{code:'owner_state_incomplete'});assert.deepEqual(await Promise.all(paths.map(p=>readFile(p))),before);}finally{await ctx.fiber.dispose();}
 }
});

for(const phase of ['dispose','derive'])test(`owner run exposes late ${phase} failure alongside settled receipt and usage`,async()=>{
 const f=await ownerFixture({enable:true});let restore=()=>{};
 try{
  const operationId=`late-${phase}`,code=phase==='dispose'?'OFFLINE_STORAGE_CLOSE_FAILURE':'OFFLINE_HISTORY_FAILURE';
  globalThis.fetch=async()=>response();
  await f.next({command:'prepare',operationId,kind:'execution',text:'Harmless offline text.'});await f.next({command:'admit',operationId});
  if(phase==='dispose'){
   const persistence=f.ctx.sessionPersistence,open=persistence.open.bind(persistence);
   persistence.open=async(...args)=>{const handle=await open(...args);if(args[1]==='read'){
    const dispose=handle[Symbol.asyncDispose].bind(handle);handle[Symbol.asyncDispose]=async()=>{await dispose();throw Object.assign(Error('offline local close'),{code});};
   }return handle;};restore=()=>{persistence.open=open;};
  }else{
   const agent=f.ctx.agents.get(f.initial.sessions.execution),derive=agent.session.deriveMessages.bind(agent.session);
   agent.session.deriveMessages=(...args)=>{const db=new DatabaseSync(join(f.directory,'owner-state','journal','journal.sqlite'),{readOnly:true});let settled;
    try{settled=db.prepare('SELECT data FROM operations').all().some(row=>JSON.parse(row.data).state==='settled');}finally{db.close();}
    if(settled)throw Object.assign(Error('offline local projection'),{code});return derive(...args);};restore=()=>{agent.session.deriveMessages=derive;};
  }
  await f.next({command:'run',operationId},r=>r.event==='started');
  const result=await waitFor(()=>f.records.find(r=>r.command==='run' && r.operation?.operationId===operationId),'native final result');restore();restore=()=>{};
  assert.equal(result.event,'result');assert.equal(result.operation.state,'settled');assert.equal(result.operation.errorCategory,code);
  assert.equal(result.operation.reservationHeld,false);assert.ok(result.operation.receipt);assert.equal(result.operation.usage.totalTokens,8);
  const inspected=await f.next({command:'inspect',operationId});assert.deepEqual(inspected.operation,result.operation);
 }finally{restore();await f.close();}
});
