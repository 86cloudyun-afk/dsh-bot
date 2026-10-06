/** Isolated owner-capability data binding. Peers here are opaque fixtures; native composition is separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Ledger } from '../src/ledger.mjs';
import { Host } from '../src/host.mjs';
import { digest } from '../src/errors.mjs';
import { projectBotTaskSnapshot } from '../src/bot-task-read-model.mjs';

let createBotTaskReadSource;
try { ({createBotTaskReadSource}=await import('../src/bot-task-read-source.mjs')); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const signal=()=>new AbortController().signal;
function owned() {
 const ledger=new Ledger(':memory:'),caller=Object.freeze({});
 const host=new Host({ledger,ownerHumanId:'ISOLATED OWNER LABEL',ownerCapability:caller});
 const command=(name,payload)=>host.executeOwned(caller,{
  operationId:randomUUID(),nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision:null,expectedEpochs:{},
  rootHumanInstructionRef:'isolated-read-binding',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline:null,
 },payload).result;
 const bot=name=>command('createBot',{name,config:{contact:{provider:'isolated',model:'inert'}}});
 const task=(b,title)=>command('createTask',{ownerBotId:b.botId,title,scope:{namespace:'ISOLATED SCOPE',writeResources:[]},acceptance:'PRIVATE ACCEPTANCE'});
 const a=bot('ISOLATED BOT A'),b=bot('ISOLATED BOT B'),ta=task(a,'ISOLATED TASK A'),tb=task(b,'ISOLATED TASK B');
 const scope={authorityEpoch:1,botIds:[a.botId],taskIds:[ta.taskId]};
 return {host,ledger,caller,a,b,ta,tb,scope};
}
function access(f,changes={}) { return {host:f.host,caller:f.caller,...f.scope,isCurrent:()=>true,...changes}; }
const makeSource=options=>{assert.equal(typeof createBotTaskReadSource,'function','actual read-source binding is missing');return createBotTaskReadSource(options);};

test('owner-only read uses existing capability and reads only exact Bot/task keys without writes',()=>{
 const f=owned();try{
  assert.equal(typeof f.host.snapshotOwnedBotTasks,'function','owner-capability read is missing');
  const reads=[],get=f.ledger.get.bind(f.ledger);
  f.ledger.get=(kind,id)=>{reads.push([kind,id]);return get(kind,id);};
  f.ledger.list=()=>{throw Error('broad ledger read forbidden');};
  f.ledger.put=()=>{throw Error('read must not write');};
  const snapshot=f.host.snapshotOwnedBotTasks(f.caller,f.scope);
  assert.equal(snapshot.bot[0].botId,f.a.botId);assert.equal(snapshot.task[0].taskId,f.ta.taskId);
  assert.deepEqual(reads,[['grant','native-owner'],['bot',f.a.botId],['task',f.ta.taskId]]);
  const dto=projectBotTaskSnapshot(snapshot);
  assert.deepEqual(Object.keys(dto.bot[0]),['botId','name','lifecycle','readiness','epoch','revision']);
  assert.deepEqual(Object.keys(dto.task[0]),['taskId','ownerBotId','title','responsibility','epoch','revision','stop']);
  assert.equal(JSON.stringify(dto).includes('PRIVATE'),false);assert.equal(get('grant','root'),null);
 }finally{f.ledger.close();}
});
test('owner read refuses serialized human, peer, changed scope and revoked grant before rows',()=>{
 const f=owned();try{
  assert.equal(typeof f.host.snapshotOwnedBotTasks,'function');
  for(const caller of [{kind:'human',id:'ISOLATED OWNER LABEL'},{id:'peer'},undefined])assert.throws(()=>f.host.snapshotOwnedBotTasks(caller,f.scope),{code:'unsupported_host_identity'});
  for(const scope of [{...f.scope,authorityEpoch:2},{...f.scope,taskIds:[f.tb.taskId]},{...f.scope,botIds:['missing']},{...f.scope,taskIds:['missing']},
   {...f.scope,botIds:[f.a.botId,f.a.botId]},{...f.scope,botIds:[],taskIds:[f.ta.taskId]}, {...f.scope,botIds:Array(501).fill(f.a.botId)}]) {
   assert.throws(()=>f.host.snapshotOwnedBotTasks(f.caller,scope),{code:'unauthorized'});
  }
  const grant=f.ledger.get('grant','native-owner');
  for(const change of [{active:false},{epoch:2},{scope:'elsewhere'},{actor:{kind:'host',id:'other'}},{authority:'configured-human-entry'}]) {
   f.ledger.put('grant','native-owner',{...grant,...change});
   assert.throws(()=>f.host.snapshotOwnedBotTasks(f.caller,f.scope),{code:'unauthorized'});
  }
 }finally{f.ledger.close();}
});
test('direct owner read rejects sparse scope arrays instead of returning sparse rows',()=>{
 const f=owned();try{
  for(const scope of [{...f.scope,botIds:Array(1),taskIds:[]},{...f.scope,taskIds:Array(1)}]) {
   assert.throws(()=>f.host.snapshotOwnedBotTasks(f.caller,scope),{code:'unauthorized'});
  }
 }finally{f.ledger.close();}
});
test('actual binding resolves each opaque peer independently, reads live rows, and retains closed scope',async()=>{
 const f=owned(),pa={id:'same-id'},pb={id:'same-id'},leases=new Map([[pa,access(f)],[pb,access(f,{botIds:[f.b.botId],taskIds:[f.tb.taskId]})]]);
 let calls=0;const source=makeSource({resolveAccess:async peer=>{calls++;return leases.get(peer)??null;}});
 try{
  const first=await source.readForPeer(pa,signal());assert.equal(first.status,'ready');assert.equal(first.snapshot.task[0].taskId,f.ta.taskId);
  const second=await source.readForPeer(pb,signal());assert.equal(second.snapshot.task[0].taskId,f.tb.taskId);
  assert.equal((await source.readForPeer({id:pa.id},signal())).status,'access_denied');
  f.ledger.put('task',f.ta.taskId,{...f.ta,title:'CHANGED AFTER FIRST READ'});
  assert.equal((await source.readForPeer(pa,signal())).snapshot.task[0].title,'CHANGED AFTER FIRST READ');
  assert.equal(calls,4);
 }finally{f.ledger.close();}
});
test('binding distinguishes absent policy, explicit denial, and authorized empty scope',async()=>{
 const f=owned();try{
  assert.deepEqual(await makeSource({}).readForPeer({},signal()),{status:'not_configured'});
  assert.deepEqual(await makeSource({resolveAccess:async()=>null}).readForPeer({},signal()),{status:'access_denied'});
  const empty=await makeSource({resolveAccess:async()=>access(f,{botIds:[],taskIds:[]})}).readForPeer({},signal());
  assert.deepEqual(empty,{status:'ready',snapshot:{bot:[],task:[]}});
 }finally{f.ledger.close();}
});
test('revocation and authority generation changes fence a delayed real binding before data reads',async()=>{
 const f=owned();let release,active=true;
 const source=makeSource({resolveAccess:()=>new Promise(resolve=>{release=()=>resolve(access(f,{isCurrent:()=>active}));})});
 try{
  const pending=source.readForPeer({},signal());active=false;release();assert.deepEqual(await pending,{status:'access_denied'});
  active=true;const next=source.readForPeer({},signal());
  f.ledger.put('grant','native-owner',{...f.ledger.get('grant','native-owner'),epoch:2});release();assert.deepEqual(await next,{status:'access_denied'});
 }finally{f.ledger.close();}
});
test('aborted reads do not invoke policy or read data when a delayed policy returns',async()=>{
 const f=owned();let calls=0,release;
 const source=makeSource({resolveAccess:()=>{calls++;return new Promise(resolve=>{release=()=>resolve(access(f));});}});
 try{
  const early=new AbortController();early.abort();assert.deepEqual(await source.readForPeer({},early.signal),{status:'access_denied'});assert.equal(calls,0);
  const controller=new AbortController(),pending=source.readForPeer({},controller.signal);controller.abort();
  f.ledger.get=()=>{throw Error('cancelled read reached ledger');};release();assert.deepEqual(await pending,{status:'access_denied'});
 }finally{f.ledger.close();}
});
test('post-read lease invalidation discards actual rows',async()=>{
 const f=owned();let checks=0;
 try{
  const source=makeSource({resolveAccess:async()=>access(f,{isCurrent:()=>++checks===1})});
  assert.deepEqual(await source.readForPeer({},signal()),{status:'access_denied'});
 }finally{f.ledger.close();}
});
test('binding refuses forged owner, foreign task scope, stale generation and missing live lease',async()=>{
 const f=owned();try{
  for(const change of [{caller:{kind:'human',id:'ISOLATED OWNER LABEL'}},{taskIds:[f.tb.taskId]},{authorityEpoch:2},{isCurrent:undefined},{isCurrent:()=>Promise.resolve(true)}]) {
   const source=makeSource({resolveAccess:async()=>access(f,change)});
   assert.deepEqual(await source.readForPeer({},signal()),{status:'access_denied'});
  }
 }finally{f.ledger.close();}
});
