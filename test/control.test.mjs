import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, human, createBot, createTask } from './helpers.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Host } from '../src/host.mjs';
import { digest } from '../src/errors.mjs';

function envelope(command,payload,more={}) { return {operationId:randomUUID(),nonce:randomUUID(),command,payloadDigest:digest(payload),expectedRevision:null,expectedEpochs:{},rootHumanInstructionRef:'input',authorizationRef:'root',createdAt:new Date().toISOString(),deadline:null,...more}; }

test('F01 nonce identity persists across restart and conflicting binding is rejected',()=>{
 const f=fixture(), payload={name:'A',config:{contact:{provider:'x',model:'m'}}};
 const e=envelope('createBot',payload); const first=f.host.execute(human,e,payload);
 f.ledger.close(); const ledger=new Ledger(f.path); const host=new Host({ledger,ownerHumanId:human.id});
 assert.equal(host.execute(human,{...e,operationId:randomUUID()},payload).operationId,first.operationId);
 assert.equal(ledger.list('bot').length,1);
 assert.throws(()=>host.execute(human,{...e,payloadDigest:digest({...payload,name:'B'})},{...payload,name:'B'}),{code:'nonce_conflict'});
 ledger.close();
});
test('operationId binds actor and exact command',()=>{
 const f=fixture(), payload={name:'A',config:{contact:{provider:'x',model:'m'}}}; const e=envelope('createBot',payload);
 f.host.execute(human,e,payload);
 assert.throws(()=>f.host.execute(human,{...e,nonce:randomUUID(),payloadDigest:digest({...payload,name:'B'})},{...payload,name:'B'}),{code:'operation_conflict'}); f.ledger.close();
});
test('short transactions roll back complete message and operation together',()=>{
 const f=fixture(); assert.throws(()=>f.ledger.transaction(()=>{f.ledger.put('message','m',{text:'x'}); throw Error('injected crash');}));
 assert.equal(f.ledger.get('message','m'),null); f.ledger.close();
});
test('bot is registered only and config versions remain immutable',()=>{
 const f=fixture(), b=createBot(f); const old=f.ledger.get('config',b.configVersion);
 assert.equal(b.readiness,'registered'); assert.equal(b.contactSessionId,null);
 const next=f.cmd('updateBotConfig',{botId:b.botId,config:{contact:{provider:'synthetic',model:'new'}}},b.revision).result;
 assert.notEqual(next.configVersion,b.configVersion); assert.deepEqual(f.ledger.get('config',b.configVersion),old); f.ledger.close();
});
test('startAttempt fails closed on native capabilities with no substitute calls',()=>{
 let calls=0; const adapter={capabilities:()=>({}), dispatch:()=>{calls++;}};
 const f=fixture(adapter), b=createBot(f), t=createTask(f,b);
 const r=f.cmd('startAttempt',{taskId:t.taskId},t.revision);
 assert.equal(r.result.execution,'queued'); assert.ok(r.result.blockers.some(x=>x.code==='unsupported'));
 assert.equal(r.result.runGeneration,null); assert.equal(calls,0); f.ledger.close();
});
test('F24 unknown attempt blocks retry and does not release resource',()=>{
 const f=fixture(), b=createBot(f), t=createTask(f,b); const a=f.cmd('startAttempt',{taskId:t.taskId},t.revision).result;
 f.ledger.put('attempt',a.attemptId,{...a,execution:'outcome_unknown'});
 const now=f.ledger.get('task',t.taskId); const next=f.cmd('startAttempt',{taskId:t.taskId},now.revision).result;
 assert.ok(next.blockers.some(x=>x.code==='outcome_unknown')); assert.equal(next.runGeneration,null); f.ledger.close();
});
test('old task revision cannot be adjusted and stop never claims native completion',()=>{
 const f=fixture(),b=createBot(f),t=createTask(f,b);
 const r=f.cmd('adjustTask',{taskId:t.taskId,title:'new goal'},t.revision).result;
 assert.equal(r.pendingRevision.title,'new goal'); assert.equal(r.title,t.title);
 assert.throws(()=>f.cmd('adjustTask',{taskId:t.taskId,title:'stale'},t.revision),{code:'revision_conflict'});
 const s=f.cmd('stopTask',{taskId:t.taskId},r.revision).result;
 assert.equal(s.stop.state,'unsupported'); assert.equal(s.epoch,t.epoch+1); f.ledger.close();
});
test('archival remains recoverable and does not dispatch or claim stopped',()=>{
 const f=fixture(),b=createBot(f); const a=f.cmd('archive',{kind:'bot',id:b.botId},b.revision).result;
 assert.equal(a.lifecycle,'archived'); assert.equal(a.nativeArchive,'unsupported');
 const r=f.cmd('restore',{kind:'bot',id:b.botId},a.revision).result;
 assert.equal(r.lifecycle,'active'); assert.equal(r.readiness,'registered'); assert.equal(r.contactSessionId,null); f.ledger.close();
});
test('trusted actor cannot be spoofed by envelope body and bot lacks root grant',()=>{
 const f=fixture(),p={name:'fake',config:{contact:{provider:'x',model:'m'}}}; const e=envelope('createBot',p);
 assert.throws(()=>f.host.execute({kind:'bot',id:'bot-1'},{...e,authenticatedActor:human},p),{code:'unauthorized'});
 assert.throws(()=>f.host.execute(human,{...e,authenticatedActor:{kind:'human',id:'another'}},p),{code:'actor_conflict'}); f.ledger.close();
});
test('operationId cannot be laundered through another operation nonce',()=>{
 const f=fixture();const p={name:'A',config:{contact:{provider:'x',model:'m'}}},q={...p,name:'B'};
 const a=envelope('createBot',p),b=envelope('createBot',q);f.host.execute(human,a,p);f.host.execute(human,b,q);
 assert.throws(()=>f.host.execute(human,{...a,operationId:b.operationId},p),{code:'operation_conflict'});f.ledger.close();
});
test('config insert-only ledger rejects same-version content mutation',()=>{
 const f=fixture(),b=createBot(f);const old=f.ledger.get('config',b.configVersion);
 assert.throws(()=>f.ledger.put('config',b.configVersion,{...old,contact:{provider:'x',model:'changed'}}),{code:'config_immutable'});
 assert.deepEqual(f.ledger.get('config',b.configVersion),old);f.ledger.close();
});
test('revoked root keeps trusted human operation lookup and stop available',()=>{
 const f=fixture(),b=createBot(f),t=createTask(f,b);const rev=f.cmd('revoke',{grantId:'root'});
 assert.equal(f.cmd('inspectOperation',{operationId:rev.operationId}).result.operationId,rev.operationId);
 assert.equal(f.cmd('stopTask',{taskId:t.taskId},t.revision).result.stop.state,'unsupported');
 assert.throws(()=>f.cmd('startAttempt',{taskId:t.taskId},f.ledger.get('task',t.taskId).revision),{code:'unauthorized'});f.ledger.close();
});
test('new expired operations and malformed dates are refused before mutation',()=>{const f=fixture(),payload={name:'expired',config:{contact:{provider:'x',model:'m'}}};assert.throws(()=>f.host.execute(human,envelope('createBot',payload,{deadline:'2020-01-01T00:00:00Z'}),payload),{code:'deadline_expired'});assert.throws(()=>f.host.execute(human,envelope('createBot',payload,{createdAt:'not-a-date'}),payload),{code:'invalid_envelope'});assert.equal(f.ledger.list('bot').length,0);f.ledger.close();});
