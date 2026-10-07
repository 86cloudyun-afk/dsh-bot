/** Product bridge seam tests are synthetic: no native/model/remote execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Host} from '../src/host.mjs';
import {Ledger} from '../src/ledger.mjs';
import {DshAdapter} from '../src/adapter.mjs';
import {digest} from '../src/errors.mjs';

function envelope(command,payload,revision,epochs={}) {
 return {operationId:randomUUID(),nonce:randomUUID(),command,payloadDigest:digest(payload),expectedRevision:revision,expectedEpochs:epochs,authorizationRef:'native-owner',rootHumanInstructionRef:'synthetic-generation-bridge',createdAt:new Date().toISOString(),deadline:null};
}
async function fixture(t) {
 const ledger=new Ledger(':memory:'),caller={},adapter=new DshAdapter({agentPresets:{list:()=>[{id:'synthetic/empty'}],defaultId:'synthetic/empty'}});
 const host=new Host({ledger,ownerHumanId:'synthetic',ownerCapability:caller,adapter});t.after(()=>ledger.close());await adapter.refreshSessionModeCatalog();
 const bot=host.executeOwned(caller,envelope('createBot',{name:'Synthetic Bot',config:{contact:{provider:'unused',model:'unused'},agentPreset:'synthetic/empty'}},null),{name:'Synthetic Bot',config:{contact:{provider:'unused',model:'unused'},agentPreset:'synthetic/empty'}}).result;
 const sent=[],created=new Map(),producer={execution:true,provenance:{producerId:'synthetic-producer',ingress:'owner',originSessionId:'synthetic-main'},isCurrent:()=>true,
  createMessage:(binding,provenance,text)=>({id:randomUUID(),role:'user',content:[{type:'text',text}],source:{kind:'dsh-bot',...provenance,...binding}}),
  async send(binding,message){assert.equal(ledger.list('workGeneration').filter(g=>g.held).length,1);sent.push(message.id);},async inspect(){return true;}};
 const port=host.openOwnedWorkSessionPort(caller,{botId:bot.botId,botEpoch:1,authorityEpoch:1,producer,creation:{cwd:'/synthetic',port:{
  async createOwnedSession(i){created.set(i.sessionId,{sessionId:i.sessionId,agentPreset:i.agentPreset,blank:true,globalTools:0,scopedTools:0});return {sessionId:i.sessionId};},
  async inspectOwnedCreation(i){return created.get(i.sessionId);}
 }}});t.after(()=>port.dispose());
 const query=()=>port.query({}).work[0];
 const call=(method,command,payload)=>port[method](envelope(command,payload,query()?.revision??null,{nativeOwner:1,bot:1,...query()?{task:1}:{}}),payload);
 call('delegate','delegateWorkSession',{task_id:'task',goal:'Observe legacy execution',completion_condition:'Preserve UNKNOWN'});await call('createSession','prepareWorkSessionCreation',{task_id:'task',generation:1});
 return {ledger,port,query,call,sent};
}

test('synthetic legacy execution remains held UNKNOWN and exposes truthful serializable generation facts',async t=>{
 const f=await fixture(t),result=await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'task',generation:1});
 assert.equal(result.state,'unknown');assert.equal(result.held,true);assert.equal(result.nativeRuntimeVerified,false);
 assert.deepEqual(result.generationObservation,{local:'unknown',remote:'UNKNOWN',usageKnown:false,usage:null,settlementVerified:false});
 assert.equal(f.sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 const stopped=f.call('fence','fenceWorkSession',{task_id:'task',generation:1,reason:'terminate'}).result;
 assert.equal(stopped.held,true);assert.equal(stopped.generationObservation.remote,'UNKNOWN');assert.equal(stopped.generationObservation.settlementVerified,false);
});

test('explicit protected creation rejects missing SDK or synthetic Context before preparation or creation',async()=>{
 let prepared=0,created=0;const adapter=new DshAdapter({agents:{create:async()=>{created++;}},agentPresets:{resolve:async()=>({id:'synthetic/empty'})}});
 const port=adapter.ownedGenerationCreationPort(['synthetic-session'],{scopeOf:()=>null,role:'work',isCurrent:()=>true,prepareGeneration:()=>{prepared++;return {};}});
 await assert.rejects(()=>port.createOwnedSession({operationId:'synthetic-op',sessionId:'synthetic-session',cwd:'/synthetic',agentPreset:'synthetic/empty'}),error=>['unsupported_owned_generation_sdk','unsupported_host_identity'].includes(error.code));
 assert.equal(prepared,0);assert.equal(created,0);
});

test('synthetic legacy stop durably fences original generation and keeps UNKNOWN reservation',async t=>{
 const f=await fixture(t);await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'task',generation:1});
 const stopped=await f.call('stop','fenceWorkSession',{task_id:'task',generation:1,reason:'terminate'});
 assert.equal(stopped.fence.reason,'terminate');assert.equal(stopped.held,true);assert.equal(stopped.generationObservation.remote,'UNKNOWN');assert.equal(f.ledger.list('workGeneration')[0].fence.operationId,stopped.fence.operationId);assert.equal(f.sent.length,1);
});
