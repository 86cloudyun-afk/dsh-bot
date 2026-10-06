import test from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter } from '../src/adapter.mjs';
import * as creation from '../src/session-creation.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Host } from '../src/host.mjs';
import { fixture,human } from './helpers.mjs';

const mode='acceptance/创造 opaque';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function setup(){
 const calls=[],native=new Map(),caller=Object.freeze({}),a=new DshAdapter({agentPresets:{list:()=>[{id:mode,name:'创造'}],defaultId:mode}});
 const f=fixture(a);await f.host.refreshSessionModeCatalog(human);
 const b=f.cmd('createBot',{name:'creation',config:{contact:{provider:'synthetic',model:'A'},agentPreset:mode}}).result;
 const port={async createOwnedSession(i){calls.push(['create',i.sessionId]);native.set(i.sessionId,proof(i));return {sessionId:i.sessionId};},async inspectOwnedCreation(i){calls.push(['inspect',i.sessionId]);return native.get(i.sessionId) ?? null;}};
 const driver=()=>new creation.SessionCreationDriver({host:f.host,caller,port});
 const prepare=()=>f.cmd('prepareContactSession',{botId:b.botId,cwd:'/isolated/public'},f.ledger.get('bot',b.botId).revision).result;
 return {...f,b,caller,calls,native,port,driver,prepare};
}
function proof(i){return {sessionId:i.sessionId,agentPreset:i.agentPreset,blank:true,globalTools:0,scopedTools:0};}

test('durable predetermined creation intent records exact config and authority without native effects',async()=>{
 const f=await setup(),i=f.prepare();assert.equal(i.state,'prepared');assert.equal(i.agentPreset,mode);assert.equal(i.configVersion,f.b.configVersion);assert.equal(i.botEpoch,1);assert.equal(i.authorityEpoch,1);assert.ok(i.sessionId);assert.deepEqual(f.ledger.get('creation',i.operationId),i);assert.deepEqual(f.calls,[]);
 assert.throws(()=>f.prepare(),{code:'contact_creation_exists'});assert.equal(f.ledger.list('creation').length,1);f.ledger.close();
});
test('driver rejects an unverified or serialized caller before any effect',async()=>{
 const f=await setup(),i=f.prepare(),d=f.driver();for(const caller of [null,{},human])await assert.rejects(()=>d.run(caller,i.operationId),{code:'unsupported_host_identity'});
 assert.deepEqual(f.calls,[]);assert.equal(f.ledger.get('creation',i.operationId).state,'prepared');f.ledger.close();
});
test('valid owned projection binds contact session only; repeat returns durable result without recreation',async()=>{
 const f=await setup(),i=f.prepare(),cfg=f.ledger.get('config',i.configVersion),d=f.driver(),r=await d.run(f.caller,i.operationId);
 assert.equal(r.state,'created');assert.equal(r.proof.agentPreset,mode);assert.equal(r.proof.scopedTools,0);assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,i.sessionId);assert.equal(f.ledger.get('conversation',f.b.contactConversationId).sessionId,i.sessionId);assert.deepEqual(f.ledger.get('config',i.configVersion),cfg);
 assert.deepEqual(await d.run(f.caller,i.operationId),r);assert.deepEqual(f.calls,[['create',i.sessionId],['inspect',i.sessionId]]);assert.equal(f.host.snapshot(human).nativeRuntimeVerified,false);f.ledger.close();
});
test('lost create receipt inspects only original ID and can confirm its exact projection',async()=>{
 const f=await setup(),i=f.prepare();f.port.createOwnedSession=async i=>{f.calls.push(['create',i.sessionId]);f.native.set(i.sessionId,proof(i));throw Error('suppressed private diagnostic');};
 const r=await f.driver().run(f.caller,i.operationId);assert.equal(r.state,'created');assert.equal(r.receipt,'recovered_same_id');assert.deepEqual(f.calls,[['create',i.sessionId],['inspect',i.sessionId]]);assert.equal(JSON.stringify(r).includes('private diagnostic'),false);f.ledger.close();
});
test('uncertain absent result stays unknown across retries and reopened ledger with no recreate',async()=>{
 const f=await setup(),i=f.prepare();f.port.createOwnedSession=async i=>{f.calls.push(['create',i.sessionId]);throw Error('lost');};
 assert.equal((await f.driver().run(f.caller,i.operationId)).state,'unknown');f.ledger.close();
 const ledger=new Ledger(f.path),host=new Host({ledger,ownerHumanId:human.id,adapter:f.host.adapter}),d=new creation.SessionCreationDriver({host,caller:f.caller,port:f.port});
 assert.equal((await d.run(f.caller,i.operationId)).state,'unknown');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.ok(f.calls.every(c=>c[1]===i.sessionId));ledger.close();
});
test('restart from committed creating state performs read-only same-ID reconciliation',async()=>{
 const f=await setup(),i=f.prepare();f.ledger.put('creation',i.operationId,{...i,state:'creating'});f.native.set(i.sessionId,proof(i));
 assert.equal((await f.driver().run(f.caller,i.operationId)).state,'created');assert.deepEqual(f.calls,[['inspect',i.sessionId]]);f.ledger.close();
});
test('native ID, projection, blank and model-tool mismatches never bind',async()=>{
 for(const change of [{sessionId:'other'},{agentPreset:'other'},{agentPreset:null},{blank:false},{globalTools:1},{scopedTools:1},{}]){
  const f=await setup(),i=f.prepare();f.port.inspectOwnedCreation=async()=>Object.keys(change).length?{...proof(i),...change}:{sessionId:i.sessionId};
  const r=await f.driver().run(f.caller,i.operationId);assert.equal(r.state,'unknown');assert.equal(r.errorCategory,'creation_proof_mismatch');assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,null);f.ledger.close();
 }
});
test('native receipt with another Session ID cannot be adopted by projection fallback',async()=>{
 const f=await setup(),i=f.prepare();f.port.createOwnedSession=async i=>{f.native.set(i.sessionId,proof(i));return {sessionId:'other'};};
 const r=await f.driver().run(f.caller,i.operationId);assert.equal(r.state,'unknown');assert.equal(r.errorCategory,'creation_receipt_mismatch');assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,null);
 assert.equal((await f.driver().run(f.caller,i.operationId)).state,'unknown');assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,null);f.ledger.close();
 const ledger=new Ledger(f.path),host=new Host({ledger,ownerHumanId:human.id,adapter:f.host.adapter}),d=new creation.SessionCreationDriver({host,caller:f.caller,port:f.port});
 assert.equal((await d.run(f.caller,i.operationId)).errorCategory,'creation_receipt_mismatch');assert.equal(ledger.get('bot',f.b.botId).contactSessionId,null);ledger.close();
});
test('archive, revoke, config change or explicit stop before create suppresses native effects',async()=>{
 for(const action of ['archive','revoke','config','stop']){
  const f=await setup(),i=f.prepare();invalidate(f,action,i);const r=await f.driver().run(f.caller,i.operationId);
  assert.equal(r.state,'fenced');assert.deepEqual(f.calls,[]);assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,null);f.ledger.close();
 }
});
test('archive, revoke, config change or stop during native await prevents confirmation',async()=>{
 for(const action of ['archive','revoke','config','stop']){
  const f=await setup(),i=f.prepare(),wait=deferred(),entered=deferred();f.port.createOwnedSession=async i=>{f.calls.push(['create',i.sessionId]);f.native.set(i.sessionId,proof(i));entered.resolve();await wait.promise;return {sessionId:i.sessionId};};
  const pending=f.driver().run(f.caller,i.operationId);await entered.promise;invalidate(f,action,i);wait.resolve();
  assert.equal((await pending).state,'fenced');assert.equal(f.ledger.get('bot',f.b.botId).contactSessionId,null);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);f.ledger.close();
 }
});
function invalidate(f,action,i){
 const b=f.ledger.get('bot',f.b.botId);
 if(action==='archive')f.cmd('archive',{kind:'bot',id:b.botId},b.revision);
 if(action==='revoke')f.cmd('revoke',{grantId:'root'});
 if(action==='config')f.cmd('updateBotConfig',{botId:b.botId,config:{contact:{provider:'synthetic',model:'B'}}},b.revision);
 if(action==='stop')f.cmd('stopContactCreation',{operationId:i.operationId});
}
test('one in-process consumer creates while concurrent duplicate is refused',async()=>{
 const f=await setup(),i=f.prepare(),wait=deferred(),entered=deferred();f.port.createOwnedSession=async i=>{f.calls.push(['create',i.sessionId]);entered.resolve();await wait.promise;f.native.set(i.sessionId,proof(i));return {sessionId:i.sessionId};};
 const pending=f.driver().run(f.caller,i.operationId);await entered.promise;await assert.rejects(()=>f.driver().run(f.caller,i.operationId),{code:'creation_in_progress'});wait.resolve();assert.equal((await pending).state,'created');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);f.ledger.close();
});
test('missing or broken current definition is refused before create and no standard fallback',async()=>{
 const f=await setup(),i=f.prepare();f.host.adapter.context.agentPresets.list=()=>[{id:mode,broken:'invalid'}];
 await assert.rejects(()=>f.driver().run(f.caller,i.operationId),{code:'agent-preset/not-found'});assert.deepEqual(f.calls,[]);assert.equal(f.ledger.get('creation',i.operationId).state,'prepared');f.ledger.close();
});
test('expired creation deadline fences before native create',async()=>{
 const f=await setup(),i=f.prepare();f.ledger.put('creation',i.operationId,{...i,deadline:'2000-01-01T00:00:00Z'});
 assert.equal((await f.driver().run(f.caller,i.operationId)).state,'fenced');assert.deepEqual(f.calls,[]);f.ledger.close();
});
test('native adapter port enforces owned IDs and uses actual projection and Agent scope',async()=>{
 const session={id:'owned',seq:0},agent={id:'owned',ctx:{},session},requests=[];
 const ctx={sessionController:{create:async r=>{requests.push(r);return {sessionId:r.sessionId};}},sessions:{get:id=>id==='owned'?session:undefined},agents:{get:id=>id==='owned'?agent:undefined},sessionProjections:{stateOf:(s,key)=>{assert.equal(s,session);assert.equal(key,'agentPreset');return mode;}},tools:{schemas:scope=>{assert.ok(scope===undefined || scope===agent);return [];}}};
 const a=new DshAdapter(ctx),port=a.ownedCreationPort(['owned'],{scopeOf:c=>{assert.equal(c,agent.ctx);return agent;}}),i={sessionId:'owned',cwd:'/isolated',agentPreset:mode};
 await assert.rejects(()=>port.createOwnedSession({...i,sessionId:'foreign'}),{code:'scope_denied'});await assert.rejects(()=>port.inspectOwnedCreation({...i,sessionId:'foreign'}),{code:'scope_denied'});
 await port.createOwnedSession(i);assert.deepEqual(requests,[i]);assert.deepEqual(await port.inspectOwnedCreation(i),proof(i));
 const wrong=a.ownedCreationPort(['owned'],{scopeOf:()=>({})});await assert.rejects(()=>wrong.inspectOwnedCreation(i),{code:'scope_denied'});
});
test('native adapter never treats header alone or detached/cold records as verified projection',async()=>{
 const session={id:'owned',seq:0,header:{agentPreset:mode}},agent={id:'owned',ctx:{},session};
 const ctx={sessions:{get:()=>session},agents:{get:()=>agent},sessionProjections:{stateOf:()=>undefined},tools:{schemas:()=>[]}};
 const a=new DshAdapter(ctx),port=a.ownedCreationPort(['owned'],{scopeOf:()=>agent});await assert.rejects(()=>port.inspectOwnedCreation({sessionId:'owned'}),{code:'mode_projection_unavailable'});
 ctx.sessions.get=()=>undefined;assert.equal(await port.inspectOwnedCreation({sessionId:'owned'}),null);
});
