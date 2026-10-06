/** Real rc2 Context/Connection identities; no HTTP or human-authentication claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './operator-read-fixture.mjs';
import {createExplicitOperatorReadBinding} from '../src/explicit-operator-read-binding.mjs';
import {Host} from '../src/host.mjs';
import {Ledger} from '../src/ledger.mjs';
import * as bindingModule from '../src/explicit-operator-read-binding.mjs';
import {createBotTaskReadSource} from '../src/bot-task-read-source.mjs';

test('explicit operator source defaults unconfigured, narrows selected summaries and refuses identity copies',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await f.read(f.operator),{status:'not_configured'});
  f.binding.select(f.scope);assert.equal((await f.read(f.operator)).status,'ready');
  assert.deepEqual(await f.read({id:f.operator.id,ctx:f.operator.ctx}),{status:'access_denied'});
  f.binding.revoke();assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
 }finally{await f.close();}
});
test('invalid or replaced scopes revoke earlier reads and pending results cannot cross lease generations',async()=>{
 const f=await fixture();try{
  f.binding.select(f.scope);const late=f.read(f.operator);
  f.binding.select({...f.scope,botIds:[],taskIds:[]});assert.deepEqual(await late,{status:'access_denied'});
  assert.deepEqual(await f.read(f.operator),{status:'ready',snapshot:{bot:[],task:[]}});
  assert.throws(()=>f.binding.select({...f.scope,role:'human'}),{code:'explicit_operator_scope_required'});
  assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
  f.binding.select(f.scope);await f.operator.dispose();assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
 }finally{await f.close();}
});
test('owner disposal, cancellation and close remove read authority',async()=>{
 const f=await fixture();try{
  f.binding.select(f.scope);const cancel=new AbortController();cancel.abort();
  assert.deepEqual(await f.binding.source.readForPeer(f.operator,cancel.signal),{status:'access_denied'});
  await f.ownerCtx.fiber.dispose();assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
  assert.throws(()=>f.binding.select(f.scope),{code:'disposed'});
 }finally{await f.close();}
});

test('cross-Host owner Context cannot install another Host retained read port',async()=>{
 const a=await fixture(),b=await fixture();try{
  assert.equal((await a.read(a.operator)).status,'not_configured');
  assert.throws(()=>createExplicitOperatorReadBinding({ownerCtx:b.ownerCtx,expectedHost:b.host,readPort:a.readPort}),{code:'owner_read_port_mismatch'});
 }finally{await a.close();await b.close();}
});

test('distinct Hosts sharing a real owner fiber cannot interchange their retained ports',async()=>{
 const f=await fixture(),otherLedger=new Ledger(':memory:');try{
  const otherHost=new Host({ledger:otherLedger,ownerHumanId:'SYNTHETIC OTHER HOST',ownerCapability:f.caller});
  assert.throws(()=>createExplicitOperatorReadBinding({ownerCtx:f.ownerCtx,expectedHost:otherHost,readPort:f.readPort}),{code:'owner_read_port_mismatch'});
 }finally{await f.close();otherLedger.close();}
});

test('an identity-preserving plain Connection replacement cannot keep a lease current',async()=>{
 const f=await fixture();try{
  f.binding.select(f.scope);
  const actualGet=f.ownerCtx.get.bind(f.ownerCtx);
  f.ownerCtx.get=name=>name==='connection'?{operator:f.operator}:actualGet(name);
  assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
 }finally{await f.close();}
});

test('narrow owner installation provides the actual optional read source and fails closed on revoke',async()=>{
 const f=await fixture({makeBinding:false});try{
  assert.equal(typeof bindingModule.installExplicitOperatorReadBinding,'function');
  const installed=bindingModule.installExplicitOperatorReadBinding({ownerCtx:f.ownerCtx,expectedHost:f.host,readPort:f.readPort});
  assert.equal(f.root.get('dshBotReadSource'),installed.source);
  assert.deepEqual(Object.keys(f.root.get('dshBotReadSource')),['readForPeer']);
  assert.deepEqual(await installed.source.readForPeer(f.operator,new AbortController().signal),{status:'not_configured'});
  installed.select(f.scope);
  assert.equal((await f.root.get('dshBotReadSource').readForPeer(f.operator,new AbortController().signal)).status,'ready');
  installed.revoke();assert.deepEqual(await installed.source.readForPeer(f.operator,new AbortController().signal),{status:'access_denied'});
 }finally{await f.close();}
});

test('legacy retained Host resolver also returns only the safe summary field allowlist',async()=>{
 const f=await fixture();try{
  const source=createBotTaskReadSource({resolveAccess:()=>({host:f.host,caller:f.caller,authorityEpoch:1,botIds:f.scope.botIds,taskIds:f.scope.taskIds,isCurrent:()=>true})});
  const result=await source.readForPeer(f.operator,new AbortController().signal);
  assert.equal(result.status,'ready');
  assert.deepEqual(Object.keys(result.snapshot.bot[0]),['botId','name','lifecycle','readiness','epoch','revision']);
  assert.deepEqual(Object.keys(result.snapshot.task[0]),['taskId','ownerBotId','title','responsibility','epoch','revision','stop']);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }finally{await f.close();}
});

test('selected port excludes other objects and unknown or foreign-owner IDs fail the entire read',async()=>{
 const f=await fixture();try{
  const otherBot=f.command('createBot',{name:'SYNTHETIC UNSELECTED',config:{contact:{provider:'inert',model:'unused'}}});
  const otherTask=f.command('createTask',{ownerBotId:otherBot.botId,title:'SYNTHETIC UNSELECTED TASK',scope:{namespace:'PRIVATE',writeResources:[]},acceptance:'PRIVATE'});
  f.ledger.list=()=>{throw Error('broad read forbidden');};
  f.binding.select(f.scope);const ready=await f.read(f.operator);
  assert.deepEqual(ready.snapshot.bot.map(row=>row.botId),f.scope.botIds);
  assert.deepEqual(ready.snapshot.task.map(row=>row.taskId),f.scope.taskIds);
  assert.equal(JSON.stringify(ready).includes('UNSELECTED'),false);
  for(const scope of [{...f.scope,botIds:['unknown']},{...f.scope,taskIds:['unknown']},{...f.scope,taskIds:[otherTask.taskId]}]){
   f.binding.select(scope);assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
  }
  assert.throws(()=>f.binding.select({...f.scope,botIds:Array(1)}),{code:'explicit_operator_scope_required'});
  assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
 }finally{await f.close();}
});

test('active grant epoch changes and revocation fence the retained selected port',async()=>{
 const f=await fixture();try{
  f.binding.select(f.scope);const grant=f.ledger.get('grant','native-owner');
  for(const change of [{epoch:2},{active:false}]){
   f.ledger.put('grant','native-owner',{...grant,...change});
   assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
  }
 }finally{await f.close();}
});

test('grant validation, projection and final lease check finish before a scheduled grant revoke',async()=>{
 const f=await fixture();try{
  f.binding.select(f.scope);const get=f.ledger.get.bind(f.ledger),events=[];let scheduled=false;
  f.ledger.get=(kind,id)=>{
   const row=get(kind,id);events.push(kind);
   if(kind==='grant' && !scheduled){scheduled=true;queueMicrotask(()=>{events.push('revoked');f.ledger.put('grant','native-owner',{...row,active:false});});}
   return row;
  };
  const result=await f.read(f.operator);
  assert.equal(result.status,'ready');assert.deepEqual(events,['grant','bot','task','revoked']);
  assert.deepEqual(await f.read(f.operator),{status:'access_denied'});
 }finally{await f.close();}
});
