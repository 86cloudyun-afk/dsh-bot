import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionId } from '@deepseek-ai/dsh-session';
import { fixture,deferred,response,runtime } from './native-fixture.mjs';
import { Ledger } from '../src/ledger.mjs';
import { join } from 'node:path';
import { readdir,writeFile,readFile } from 'node:fs/promises';
import { NativeRunHost } from '@deepseek-ai/dsh-experimental-native-run';
import { CommandError } from '../src/errors.mjs';
import { acceptanceFiles } from './acceptance-file-fixture.mjs';
import { verifyConfiguredCandidate } from '../src/acceptance-source-files.mjs';
let product;
try{product=await import('../src/native-controller.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;product={};}
function Controller(){assert.equal(typeof product.OwnedNativeController,'function','Private product controller entry must exist');return product.OwnedNativeController;}

test('configured acceptance source refusal rejects prepare without a native operation or HTTP',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return response();};
 const f=await fixture(Controller(),undefined,{acceptanceGuard:()=>{throw new CommandError('candidate_source_changed');}});
 try{assert.throws(()=>f.prepare(),{code:'candidate_source_changed'});assert.equal(f.ledger.list('nativeOperation').length,0);assert.equal(calls,0);}finally{await f.close();}
});
test('prepared sourceVersion rejects same-text candidate regeneration after auth and preserves original reservation',async()=>{
 const entered=deferred(),auth=deferred();let calls=0,files;
 globalThis.fetch=async()=>{calls++;return response();};
 const f=await fixture(Controller(),async()=>{entered.resolve();await auth.promise;return {headers:{}};},{acceptanceGuard:()=>verifyConfiguredCandidate(files.config).sourceVersion});
 try{
  files=await acceptanceFiles(join(f.directory,'source-evidence'));
  const p=f.prepare('execution',files.candidate.modelInput.text);await f.controller.admit(f.caller,p.operationId);
  const work=f.controller.drive(f.caller,p.operationId);await entered.promise;
  files.summary.sameCountReplacement=true;await writeFile(files.config.summaryPath,JSON.stringify(files.summary));const replacement=await files.regenerate();
  assert.equal(replacement.modelInput.text,files.candidate.modelInput.text);assert.notEqual(replacement.factBinding.sourceVersion,files.candidate.factBinding.sourceVersion);
  auth.resolve();const result=await work;
  assert.equal(calls,0);assert.notEqual(result.state,'settled');assert.equal(result.native.usage,null);assert.equal(result.native.reservationHeld,true);
  assert.equal(f.ledger.get('nativeOperation',p.operationId).acceptanceSourceVersion,files.candidate.factBinding.sourceVersion);
  assert.equal((await f.controller.drive(f.caller,p.operationId)).state,result.state);assert.equal(calls,0);
 }finally{auth.resolve();await f.close();}
});
test('candidate verification binds executing module paths and bytes to the configured runtime',async()=>{
 const f=await fixture(Controller());try{
  const files=await acceptanceFiles(join(f.directory,'source-evidence'));
  assert.equal(verifyConfiguredCandidate(files.config,files.executing).state,'VERIFIED_NOT_SENT');
  for(const name of ['launcher','owner','controller','native']){
   const foreign=structuredClone(files.executing);foreign[name].path=join(f.directory,name+'.mjs');await writeFile(foreign[name].path,await readFile(files.executing[name].path));
   assert.throws(()=>verifyConfiguredCandidate(files.config,foreign),{code:'candidate_runtime_mismatch'});
   const forged=structuredClone(files.executing);forged[name].sha256='0'.repeat(64);assert.throws(()=>verifyConfiguredCandidate(files.config,forged),{code:'candidate_runtime_mismatch'});
  }
 }finally{await f.close();}
});
test('acceptance source replacement during auth is rechecked by the final native guard before HTTP',async()=>{
 const entered=deferred(),auth=deferred();let changed=false,calls=0;const phases=[];
 globalThis.fetch=async()=>{calls++;return response();};
 const f=await fixture(Controller(),async()=>{entered.resolve();await auth.promise;return {headers:{}};},{acceptanceGuard:input=>{
  phases.push(input.phase);assert.equal(input.kind,'execution');assert.deepEqual(input.steps,['Bound harmless quality input.']);
  if(changed)throw new CommandError('candidate_source_changed');
  return 'a'.repeat(64);
 }});
 try{const p=f.prepare('execution','Bound harmless quality input.');await f.controller.admit(f.caller,p.operationId);const work=f.controller.drive(f.caller,p.operationId);
  await entered.promise;changed=true;auth.resolve();const result=await work;
  assert.equal(calls,0);assert.notEqual(result.state,'settled');assert.equal(result.native.usage,null);assert.equal(result.native.reservationHeld,true);
  assert.ok(phases.includes('prepare'));assert.ok(phases.filter(phase=>phase==='dispatch').length>=2);
  assert.equal((await f.controller.drive(f.caller,p.operationId)).state,result.state);assert.equal(calls,0);
 }finally{auth.resolve();await f.close();}
});

test('a plain object claiming Context services cannot establish a product owner',()=>{
 const Constructor=Controller();assert.throws(()=>new Constructor({ctx:{fiber:{},get:()=>({})},ledger:{},ownerLabel:'fake',directory:'/tmp/fake',capacity:{}}),{code:'unsupported_host_identity'});
});

test('actual owner creates protected contact/execution Sessions and settles a product operation from durable native receipts',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};
 const f=await fixture(Controller());try{
  const created=f.ledger.get('creation',f.execution.operationId);assert.equal(created.state,'created');
  assert.equal(created.proof.agentPreset,'acceptance/empty');assert.equal(created.proof.scopedTools,0);
  for(const intent of [f.contact,f.execution]){const blank=await f.ctx.sessionPersistence.open(SessionId(intent.sessionId),'read');
   try{const stored=await blank.read();assert.equal(stored.events.length,0);assert.equal(blank.header.agentPreset,'acceptance/empty');}finally{await blank.close();}}
  const p=f.prepare();assert.equal(p.state,'prepared');assert.equal(fetches,0);
  const admitted=await f.controller.admit(f.caller,p.operationId);assert.equal(admitted.native.state,'admitted');assert.equal(fetches,0);
  const r=await f.controller.drive(f.caller,p.operationId);assert.equal(r.state,'settled');assert.equal(fetches,1);
  assert.equal(r.native.reservationHeld,false);assert.equal(r.native.attempts[0].sessionReceipt.sessionId,f.execution.sessionId);
  assert.equal(r.native.binding.sessionBinding.controlConfigId,f.bot.configVersion);assert.equal(r.native.binding.configVersion,1);
  const stored=await f.ctx.sessionPersistence.open(SessionId(f.execution.sessionId),'read');const log=await stored.read();await stored.close();
  const receipt=r.native.attempts[0].sessionReceipt;assert.equal(log.events[receipt.assistantSeq].type,'assistant/message');
  assert.equal(log.events[receipt.endSeq].type,'turn/end');assert.equal(r.native.answers[0],'Offline reviewed result');
  assert.deepEqual(await f.controller.drive(f.caller,p.operationId),r);assert.equal(fetches,1);
  assert.equal(f.controller.snapshot(f.caller).nativeRuntimeVerified,false);assert.equal(f.controller.snapshot(f.caller).privateProductPathVerified,true);
 }finally{await f.close();}
});
test('serialized caller cannot create commands, inspect or dispatch through the product owner entry',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(Controller());try{
  const p=f.prepare();for(const fake of [{},{kind:'human',id:'offline-runtime-owner'},JSON.parse('{}')]){
   assert.throws(()=>f.controller.snapshot(fake),{code:'unsupported_host_identity'});
   await assert.rejects(()=>f.controller.admit(fake,p.operationId),{code:'unsupported_host_identity'});
  }assert.equal(fetches,0);assert.equal(f.ledger.get('nativeOperation',p.operationId).state,'prepared');
 }finally{await f.close();}
});
test('product config or grant changes during authentication fail the final native guard before HTTP',async()=>{
 for(const change of ['config','grant']){
  const auth=deferred(),entered=deferred();let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};
  const f=await fixture(Controller(),async()=>{entered.resolve();await auth.promise;return {headers:{}};});try{
   const p=f.prepare();await f.controller.admit(f.caller,p.operationId);const driving=f.controller.drive(f.caller,p.operationId);await entered.promise;
   if(change==='config'){const b=f.ledger.get('bot',f.bot.botId);f.command('updateBotConfig',{botId:b.botId,config:{contact:{provider:'deepseek-official',model:'deepseek-pro',reasoning:'off'}}},b.revision);}
   else{const g=f.ledger.get('grant','native-owner');f.ledger.put('grant',g.id,{...g,epoch:g.epoch+1,active:false});}
   auth.resolve();const r=await driving;assert.equal(fetches,0);assert.notEqual(r.state,'settled');assert.equal(r.native.attempts.length,0);
  }finally{auth.resolve();await f.close();}
 }
});
test('execution capacity does not prevent an independent actual contact Session response',async()=>{
 const blocked=deferred(),entered=deferred();let fetches=0;globalThis.fetch=async()=>{fetches++;if(fetches===1){entered.resolve();await blocked.promise;}return response();};
 const f=await fixture(Controller());try{
  const execution=f.prepare();await f.controller.admit(f.caller,execution.operationId);const pending=f.controller.drive(f.caller,execution.operationId);await entered.promise;
  const contact=f.prepare('contact','What is the review focus?');await f.controller.admit(f.caller,contact.operationId);
  const reply=await f.controller.drive(f.caller,contact.operationId);assert.equal(reply.state,'settled');assert.equal(fetches,2);
  assert.notEqual(reply.native.binding.sessionBinding.sessionId,f.execution.sessionId);
  assert.equal(f.controller.inspect(f.caller,execution.operationId).native.localTransport,'open');
  blocked.resolve();assert.equal((await pending).state,'settled');
 }finally{blocked.resolve();await f.close();}
});
test('product stop fence precedes native drain and stops admitted work with zero provider starts',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(Controller());try{
  const p=f.prepare('contact');await f.controller.admit(f.caller,p.operationId);const stop=f.stop(p.operationId);
  assert.equal(stop.result.state,'fenced');const r=await f.controller.stop(f.caller,stop.operationId);
  assert.equal(r.native.state,'fenced');assert.equal(r.native.reservationHeld,false);assert.equal(fetches,0);
  assert.notEqual((await f.controller.drive(f.caller,p.operationId)).state,'settled');assert.equal(fetches,0);
  assert.throws(()=>f.prepare('contact'),{code:'generation_stopped'});
 }finally{await f.close();}
});
test('authoritative reopen protects known history before a new followup and never replays the old operation',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(Controller());try{
  const p=f.prepare();await f.controller.admit(f.caller,p.operationId);await f.controller.drive(f.caller,p.operationId);await f.controller.close(f.caller);
  f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  const original=f.controller.inspect(f.caller,p.operationId);assert.equal(original.state,'settled');assert.equal(fetches,1);
  assert.equal((await f.controller.drive(f.caller,p.operationId)).state,'settled');assert.equal(fetches,1);
  const next=f.prepare();await f.controller.admit(f.caller,next.operationId);assert.equal((await f.controller.drive(f.caller,next.operationId)).state,'settled');assert.equal(fetches,2);
 }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
});
test('in-flight stop retains unknown allocations across reopen and blocks new Session work without replay',async()=>{
 const entered=deferred();let fetches=0;globalThis.fetch=async(_url,options)=>{fetches++;entered.resolve();await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 const f=await fixture(Controller());try{
  const p=f.prepare();await f.controller.admit(f.caller,p.operationId);const pending=f.controller.drive(f.caller,p.operationId);await entered.promise;
  const stop=f.stop(p.operationId),stopped=await f.controller.stop(f.caller,stop.operationId);await pending;
  assert.equal(stopped.native.state,'unknown');assert.equal(stopped.native.reservationHeld,true);assert.equal(stopped.native.usage,null);
  assert.equal(f.ledger.get('nativeOperation',p.operationId).stop.controlId,stop.operationId);
  await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  assert.equal(f.controller.inspect(f.caller,p.operationId).native.reservationHeld,true);
  assert.equal((await f.controller.drive(f.caller,p.operationId)).native.state,'unknown');assert.equal(fetches,1);
  assert.throws(()=>f.prepare(),error=>['outcome_unknown','generation_stopped'].includes(error.code));
 }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
});
test('failed blank flush or readback cannot become a created acknowledgement from an in-memory fallback',async()=>{
 for(const boundary of ['flush','readback']){
  const f=await fixture(Controller(),undefined,{beforeCreate(ctx){
   if(boundary==='flush')ctx.sessions.flush=async()=>false;
   else ctx.sessionPersistence.open=async()=>{throw Error('Offline disk read fault');};
  }});try{for(const intent of [f.contact,f.execution])assert.equal(f.ledger.get('creation',intent.operationId).state,'unknown');}
  finally{await f.close();}
 }
});
test('exact product operation deadline is rechecked after authentication before provider dispatch',async()=>{
 const auth=deferred(),entered=deferred(),clock=Date.now;let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};
 const f=await fixture(Controller(),async()=>{entered.resolve();await auth.promise;return {headers:{}};});
 try{const deadline=new Date(clock()+20000).toISOString(),p=f.command('prepareNativeTextOperation',{kind:'execution',steps:['Public design review']},null,deadline).result;
  await f.controller.admit(f.caller,p.operationId);const pending=f.controller.drive(f.caller,p.operationId);await entered.promise;
  Date.now=()=>Date.parse(deadline)+1;auth.resolve();const r=await pending;assert.equal(fetches,0);assert.equal(r.native.attempts.length,0);assert.notEqual(r.state,'settled');
 }finally{Date.now=clock;auth.resolve();await f.close();}
});
test('native text size is rejected before product admission and long product IDs map to bounded native IDs',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(Controller());try{
  assert.throws(()=>f.prepare('execution','x'.repeat(4097)),{code:'invalid_native_input'});assert.equal(f.ledger.list('nativeOperation').length,0);
  const p=f.command('prepareNativeTextOperation',{kind:'execution',steps:['Safe public input']},null,null,'p'.repeat(200)).result;
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.nativeOperationId));assert.equal((await f.controller.admit(f.caller,p.operationId)).state,'admitted');
  assert.equal(fetches,0);
 }finally{await f.close();}
});
test('mapped operation and control identities satisfy native limits even for long opaque product labels',async()=>{
 globalThis.fetch=async()=>response();const f=await fixture(Controller());try{
  const p=f.command('prepareNativeTextOperation',{kind:'contact',steps:['Public contact input']},null,null,'opaque 产品 '+ 'p'.repeat(180)).result;
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.nativeOperationId));await f.controller.admit(f.caller,p.operationId);
  const stop=f.command('stopNativeTextOperation',{operationId:p.operationId},null,null,'opaque control '+ 'c'.repeat(180));
  assert.equal((await f.controller.stop(f.caller,stop.operationId)).native.state,'fenced');
 }finally{await f.close();}
});
test('drive projection preserves a product stop link committed while the response was pending',async()=>{
 const entered=deferred(),reply=deferred();globalThis.fetch=async()=>{entered.resolve();await reply.promise;return response();};
 const f=await fixture(Controller());try{const p=f.prepare();await f.controller.admit(f.caller,p.operationId);const pending=f.controller.drive(f.caller,p.operationId);await entered.promise;
  const stop=f.stop(p.operationId);reply.resolve();await pending;assert.equal(f.ledger.get('nativeOperation',p.operationId).stop?.controlId,stop.operationId);
  await f.controller.stop(f.caller,stop.operationId);
 }finally{reply.resolve();await f.close();}
});
async function probeWriter(f){const b=f.ledger.get('nativeBinding','protected-text-owner');const probe=await NativeRunHost.open({directory:b.directory,hostId:b.hostId,capacity:b.capacity,
 targets:Object.values(b.targets).map(row=>row.target),create:false,authorize:caller=>caller===f.caller});await probe.close();}
test('owner disposal invalidates retained controller and releases its native writer without a manual close',async()=>{
 const f=await fixture(Controller());try{await f.ctx.fiber.dispose();assert.throws(()=>f.controller.snapshot(f.caller),{code:'native_controller_closed'});await probeWriter(f);}
 finally{await f.controller.close(f.caller);f.ledger.close();}
});
test('missing factory startup releases the acquired native writer automatically',async()=>{
 const f=await fixture(Controller());try{
  await f.controller.close(f.caller);f.controller=f.open();const provider=[...f.ctx.loader.entries()].find(entry=>entry.options.id==='provider');await provider.fiber.dispose();
  await assert.rejects(()=>f.controller.open(f.caller,{...f.ids,create:false}),{code:'native_provider_factory_required'});await probeWriter(f);
 }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
});
test('a second Session cold-resume failure rolls back the first driver and native writer',async()=>{
 const f=await fixture(Controller()),capacity=f.ledger.get('nativeBinding','protected-text-owner').capacity;
 await f.controller.close(f.caller);await f.ctx.fiber.dispose();
 const entries=await readdir(join(f.directory,'sessions'),{recursive:true,withFileTypes:true});
 const file=entries.find(entry=>entry.isFile() && entry.name==='session.v4.jsonl' && entry.parentPath.includes(f.execution.sessionId));assert.ok(file);
 await writeFile(join(file.parentPath,file.name),'{}\n');
 const ctx=await runtime(f.directory),controller=new (Controller())({ctx,ledger:f.ledger,ownerLabel:'offline-runtime-owner',directory:join(f.directory,'journal'),capacity});
 try{await assert.rejects(()=>controller.open(ctx.fiber,{...f.ids,create:false}));assert.equal(ctx.agents.get(SessionId(f.contact.sessionId)),undefined);await probeWriter(f);}
 finally{await controller.close(ctx.fiber);await ctx.fiber.dispose();f.ledger.close();}
});
test('startup reconciles a stale product driving row from authoritative native unknown before new preparation',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('Offline lost transport');};const f=await fixture(Controller());try{
  const p=f.prepare();await f.controller.admit(f.caller,p.operationId);assert.equal((await f.controller.drive(f.caller,p.operationId)).native.state,'unknown');
  const row=f.ledger.get('nativeOperation',p.operationId);f.ledger.put('nativeOperation',p.operationId,{...row,state:'driving',native:null});
  await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  assert.equal(f.controller.snapshot(f.caller).nativeOperations.find(op=>op.operationId===p.operationId).state,'unknown');
  assert.throws(()=>f.prepare(),{code:'outcome_unknown'});assert.equal(fetches,1);
 }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
});
test('a new actual runtime owner reconstructs both journals and native Sessions without accepting the old owner capability',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(Controller());
 const p=f.prepare();await f.controller.admit(f.caller,p.operationId);await f.controller.drive(f.caller,p.operationId);
 const capacity=f.ledger.get('nativeBinding','protected-text-owner').capacity;
 await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();
 const ctx=await runtime(f.directory),ledger=new Ledger(join(f.directory,'product.sqlite'));
 const controller=new (Controller())({ctx,ledger,ownerLabel:'offline-runtime-owner',directory:join(f.directory,'journal'),capacity});
 try{await controller.open(ctx.fiber,{...f.ids,create:false});assert.throws(()=>controller.snapshot(f.caller),{code:'unsupported_host_identity'});
  const r=controller.inspect(ctx.fiber,p.operationId);assert.equal(r.state,'settled');assert.equal(r.native.attempts[0].sessionReceipt.sessionId,f.execution.sessionId);
  assert.equal((await controller.drive(ctx.fiber,p.operationId)).state,'settled');assert.equal(fetches,1);
 }finally{await controller.close(ctx.fiber);await ctx.fiber.dispose();ledger.close();}
});

test('lifetime acceptance budget reproduces the one-reservation refusal and funds sequential stop/recovery when given headroom',async()=>{
 for(const adequate of [false,true]){
  let fetches=0;const entered=deferred();globalThis.fetch=async(_url,options)=>{fetches++;
   if(adequate && fetches===4){entered.resolve();await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
   return response();};
  const capacity={executionSlots:1,contactSlots:1,executionTokens:adequate?60000:20000,contactTokens:adequate?40000:20000,
   tokenReservationPerStep:20000,maxSteps:1,admissionDeadlineMs:1000,settlementDeadlineMs:100};
  const f=await fixture(Controller(),undefined,{capacity});try{
   for(const kind of ['execution','contact']){const p=f.prepare(kind);assert.equal((await f.controller.admit(f.caller,p.operationId)).state,'admitted');
    assert.equal((await f.controller.drive(f.caller,p.operationId)).state,'settled');}
   const queued=f.prepare('contact'),a=await f.controller.admit(f.caller,queued.operationId);
   if(!adequate){assert.equal(a.state,'unknown');assert.equal(a.errorCategory,'HOST_CAPACITY_BLOCKED');assert.equal(fetches,2);assert.throws(()=>f.prepare('contact'),{code:'outcome_unknown'});continue;}
   assert.equal(a.state,'admitted');const stop=f.stop(queued.operationId);assert.equal((await f.controller.stop(f.caller,stop.operationId)).state,'fenced');assert.equal(fetches,2);
   await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
   const followup=f.prepare();await f.controller.admit(f.caller,followup.operationId);assert.equal((await f.controller.drive(f.caller,followup.operationId)).state,'settled');
   const probe=f.prepare();assert.equal((await f.controller.admit(f.caller,probe.operationId)).state,'admitted');const pending=f.controller.drive(f.caller,probe.operationId);await entered.promise;
   const finalStop=f.stop(probe.operationId);assert.equal((await f.controller.stop(f.caller,finalStop.operationId)).state,'unknown');await pending;
   await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
   const recovered=f.controller.inspect(f.caller,probe.operationId);assert.equal(recovered.state,'unknown');assert.equal(recovered.native.reservationHeld,true);
   assert.throws(()=>f.prepare(),error=>['outcome_unknown','generation_stopped'].includes(error.code));assert.equal(fetches,4);
  }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
 }
});

test('remaining two-call acceptance budget and immutable maxTokens fund a followup then retain stopped unknown without replay',async()=>{
 let fetches=0;const entered=deferred();globalThis.fetch=async(_url,options)=>{fetches++;assert.equal(JSON.parse(options.body).max_tokens,600);
  if(fetches===2){entered.resolve();await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
  return response('One concrete source check.');};
 const capacity={executionSlots:1,contactSlots:1,executionTokens:40000,contactTokens:20000,tokenReservationPerStep:20000,maxSteps:1,admissionDeadlineMs:2000,settlementDeadlineMs:7000};
 const f=await fixture(Controller(),undefined,{capacity,maxTokens:{execution:600,contact:160}});try{
  const p=f.prepare();assert.equal((await f.controller.admit(f.caller,p.operationId)).state,'admitted');const known=await f.controller.drive(f.caller,p.operationId);
  assert.equal(known.state,'settled');assert.ok(known.native.usage.totalTokens<=20000);assert.ok(40000-known.native.usage.totalTokens>=20000);
  const probe=f.prepare();assert.equal((await f.controller.admit(f.caller,probe.operationId)).state,'admitted');const pending=f.controller.drive(f.caller,probe.operationId);await entered.promise;
  const stop=f.stop(probe.operationId);assert.equal(f.ledger.get('nativeFence',`${probe.targetId}/1`).controlId,stop.operationId);
  const stopped=await f.controller.stop(f.caller,stop.operationId);await pending;assert.equal(stopped.state,'unknown');assert.equal(stopped.native.reservationHeld,true);
  assert.equal(stopped.native.usage,null);assert.equal(stopped.native.reservedTokens,20000);assert.equal(stopped.native.localTransport,'closed');assert.equal(stopped.native.remoteExecution,'unknown');
  await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  assert.equal(f.controller.inspect(f.caller,p.operationId).state,'settled');assert.equal(f.controller.inspect(f.caller,probe.operationId).state,'unknown');
  assert.throws(()=>f.prepare(),error=>['outcome_unknown','generation_stopped'].includes(error.code));assert.equal(fetches,2);
 }finally{await f.controller.close(f.caller);await f.ctx.fiber.dispose();f.ledger.close();}
});

test('controller close may retry writer release after a bounded local drain failure without restoring invocation authority',async()=>{
 const entered=deferred(),release=deferred();let fetches=0;globalThis.fetch=async()=>{fetches++;entered.resolve();await release.promise;return response();};
 const f=await fixture(Controller());let pending;
 try{const p=f.prepare();await f.controller.admit(f.caller,p.operationId);pending=f.controller.drive(f.caller,p.operationId);await entered.promise;
  await assert.rejects(()=>f.controller.close(f.caller),{code:'LOCAL_SETTLEMENT_UNKNOWN'});
  assert.throws(()=>f.controller.snapshot(f.caller),{code:'native_controller_closed'});
  release.resolve();await pending;
  await f.controller.close(f.caller);await probeWriter(f);
  assert.throws(()=>f.controller.snapshot(f.caller),{code:'native_controller_closed'});assert.equal(fetches,1);
 }finally{release.resolve();await pending?.catch(()=>{});await f.controller.close(f.caller).catch(()=>{});await f.ctx.fiber.dispose().catch(()=>{});f.ledger.close();}
});

test('controller retains known native receipt and reports a thrown post-settlement consumer error',async()=>{
 const {NativeSessionDriver}=await import('@deepseek-ai/dsh-experimental-native-run');
 const drive=NativeSessionDriver.prototype.drive,code='OFFLINE_POST_SETTLEMENT_THROW';let f;
 try{
  f=await fixture(Controller());globalThis.fetch=async()=>response();
  const operation=f.prepare();await f.controller.admit(f.caller,operation.operationId);
  NativeSessionDriver.prototype.drive=async function(...args){await drive.apply(this,args);throw Object.assign(Error('offline late consumer throw'),{code});};
  const result=await f.controller.drive(f.caller,operation.operationId);
  assert.equal(result.state,'settled');assert.equal(result.errorCategory,code);assert.equal(result.native.usage.totalTokens,8);assert.equal(result.native.reservationHeld,false);assert.ok(result.native.attempts[0].sessionReceipt);
  assert.deepEqual(f.controller.inspect(f.caller,operation.operationId),result);
 }finally{NativeSessionDriver.prototype.drive=drive;await f?.close();}
});

test('controller preserves the native first failure when a later consumer wrapper also throws',async()=>{
 const {NativeSessionDriver}=await import('@deepseek-ai/dsh-experimental-native-run');const drive=NativeSessionDriver.prototype.drive;let f,restore=()=>{};
 try{
  f=await fixture(Controller());globalThis.fetch=async()=>response();const operation=f.prepare();await f.controller.admit(f.caller,operation.operationId);
  const persistence=f.ctx.sessionPersistence,open=persistence.open.bind(persistence);
  persistence.open=async(...args)=>{const handle=await open(...args);if(args[1]==='read'){
   const dispose=handle[Symbol.asyncDispose].bind(handle);handle[Symbol.asyncDispose]=async()=>{await dispose();throw Object.assign(Error('offline first local close'),{code:'OFFLINE_FIRST_STORAGE_FAILURE'});};
  }return handle;};restore=()=>{persistence.open=open;};
  NativeSessionDriver.prototype.drive=async function(...args){await drive.apply(this,args);throw Object.assign(Error('offline second local throw'),{code:'OFFLINE_SECOND_CONTROLLER_FAILURE'});};
  const result=await f.controller.drive(f.caller,operation.operationId);restore();restore=()=>{};
  assert.equal(result.state,'settled');assert.equal(result.errorCategory,'OFFLINE_FIRST_STORAGE_FAILURE');assert.equal(result.native.failureCode,'OFFLINE_FIRST_STORAGE_FAILURE');
  assert.equal(result.native.usage.totalTokens,8);assert.equal(result.native.reservationHeld,false);assert.ok(result.native.attempts[0].sessionReceipt);
 }finally{restore();NativeSessionDriver.prototype.drive=drive;await f?.close();}
});
