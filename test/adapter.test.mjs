import test from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter,REQUIRED_NATIVE } from '../src/adapter.mjs';
test('cold adapter uses only list/inspect, filters scoped ordinary sessions and never claims completeness',async()=>{const calls=[];const context={sessionController:{list:async()=>{calls.push('list');return {items:[{sessionId:'allowed'},{sessionId:'foreign'}]};},inspect:async id=>{calls.push(id);return {id};},selectModel:()=>{throw Error('forbidden');},cancel:()=>{throw Error('forbidden');}},resolveAgent:()=>{throw Error('wake forbidden');}};const a=new DshAdapter(context),scope={sessionIds:['allowed']};const r=await a.listSessions(scope);assert.deepEqual(r.items,[{sessionId:'allowed'}]);assert.equal(r.complete,false);await assert.rejects(()=>a.inspectSession('foreign',scope),{code:'scope_denied'});await a.inspectSession('allowed',scope);assert.deepEqual(calls,['list','allowed']);for(const method of ['selectSessionModel','dispatch','inspectOperation','stopRun','archiveSession','restoreSession']) assert.equal(a[method]().status,'unsupported');assert.deepEqual(calls,['list','allowed']);assert.equal(Object.keys(a.capabilities()).length,REQUIRED_NATIVE.length);assert.deepEqual(a.sessionModeCatalog().options,[]);});

test('synthetic creation port treats only exact retained native initialization tuple as semantically blank',async()=>{
 const initialization={permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'};
 const events=[{type:'permission/preset',seq:0,time:1,data:{preset:'workspace-write'}},{type:'sandbox/mode',seq:1,time:2,data:{mode:'workspace-write'}},{type:'approval/policy',seq:2,time:3,data:{policy:'ask'}}];
 const session={id:'synthetic-initial',seq:3,snapshotEvents:()=>structuredClone(events)},agent={id:session.id,session,ctx:{}};
 const context={sessions:{get:()=>session},agents:{get:()=>agent},sessionProjections:{stateOf:()=> 'synthetic/empty'},tools:{schemas:()=>[]}};
 const adapter=new DshAdapter(context),intent={operationId:'synthetic-op',sessionId:session.id,cwd:'/synthetic',agentPreset:'synthetic/empty'},scopeOf=()=>agent;
 const bound=adapter.ownedCreationPort([session.id],{scopeOf,initialization});initialization.approvalPolicy='never';
 assert.equal((await bound.inspectOwnedCreation(intent)).blank,true);
 assert.equal((await adapter.ownedCreationPort([session.id],{scopeOf}).inspectOwnedCreation(intent)).blank,false);
 events.push({type:'user/message',seq:3,time:4,data:{id:'injected-input'}});session.seq=4;
 assert.equal((await bound.inspectOwnedCreation(intent)).blank,false);
});
