/** Actual peer/RPC policy and native SDK loop with keyless synthetic SSE. No GUI/browser or remote-model claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {symbols} from '@deepseek-ai/cordis';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {installSelectedBotContactOwner} from '../src/selected-bot-contact-owner.mjs';
import {generationFixture,syntheticResponse,tick} from './work-generation-fixture.mjs';

async function contact(t,{fetcher,canSend=()=>true}={}){
 const f=await generationFixture(t,fetcher),i=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision),port=f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'main',isCurrent:()=>true,prepareGeneration:i=>f.prepareGeneration(i,'main')});
 const created=await new SessionCreationDriver({host:f.host,caller:f.caller,port}).run(f.caller,i.operationId);assert.equal(created.state,'created');const agent=f.ctx.agents.get(i.sessionId);
 const definition=defineTool({name:'dsh_bot_delegate',description:'Harmless synthetic fixture scope',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},async execute(){return{};}});const unregister=agent.ctx.tools.register(definition);t.after(()=>unregister());const source=f.host.adapter.bindOwnedMainGeneration(port,created,definition);
 f.ctx.provide('webServer',{register(){return()=>{};}});await f.ctx.plugin(ctx=>{new HostConnectionService(ctx,[],null);}).await();const traced=f.ctx.get('connection'),connection=traced[symbols.original]??traced;await connection.operator.ctx.fiber.await();
 const captured=new Map(),register=connection.register;connection.register=function(owner,channel,handler){captured.set(channel,handler);return register.call(this,owner,channel,handler);};t.after(()=>{connection.register=register;});const generation={};
 const owner=installSelectedBotContactOwner({ownerCtx:f.ctx,expectedHost:f.host,connection,peer:connection.operator,connectionGeneration:generation,getConnectionGeneration:()=>generation,selectedBotId:f.bot.botId,botEpoch:1,authorityEpoch:1,contactAgent:agent,requireOwnedGeneration:true,generationSource:source,canSend});t.after(()=>owner.dispose());
 const call=(endpoint,payload={})=>captured.get('/dsh-bot-owner')(endpoint,{command:endpoint,botId:f.bot.botId,payload},new AbortController().signal,connection.operator);
 return{...f,agent,call};
}
const payload=(n=1)=>({operationId:`native-contact-${n}`,nonce:`native-contact-${n}`,text:'Harmless synthetic original main message'});

test('actual SDK synthetic contact RPC settles original receipt and duplicate never resends',async t=>{
 const f=await contact(t),p=payload(),first=await f.call('sendContactText',p);assert.equal(first.ok,true);let receipt=first;
 for(let n=0;n<40&&!receipt.value.preciseNativeSettlementVerified;n++){await tick();receipt=await f.call('inspectContactReceipt',{operationId:p.operationId,nonce:p.nonce});}
 assert.equal(receipt.value.state,'durably-queued');assert.equal(receipt.value.preciseNativeSettlementVerified,true);assert.equal(receipt.value.generationObservation.remote,'settled');assert.equal(receipt.value.generationObservation.usageKnown,true);assert.equal(f.requests(),1);
 const row=f.ledger.list('contactOwnerOperation')[0];assert.equal(row.generationBinding.inputMessageId,row.message.id);assert.equal(row.generationBinding.generation,1);assert.equal(f.ledger.list('ownedMainGeneration').length,1);
 const duplicate=await f.call('sendContactText',p);assert.equal(duplicate.value.messageId,receipt.value.messageId);assert.equal(duplicate.value.preciseNativeSettlementVerified,true);assert.equal(f.requests(),1);assert.deepEqual(JSON.parse(JSON.stringify(duplicate)),duplicate);
 const next=await f.call('sendContactText',payload(2));assert.equal(next.ok,true);assert.equal(f.ledger.list('contactOwnerOperation')[1].generationBinding.generation,2);
});

test('actual SDK synthetic missing finish rejects new contact operation before allocation',async t=>{
 const f=await contact(t,{fetcher:()=>syntheticResponse({finish:false})}),p=payload();assert.equal((await f.call('sendContactText',p)).ok,true);await f.waitRequest();
 let receipt;for(let n=0;n<40;n++){await tick();receipt=await f.call('inspectContactReceipt',{operationId:p.operationId,nonce:p.nonce});if(receipt.value.generationObservation.local==='returned')break;}
 assert.equal(receipt.value.preciseNativeSettlementVerified,false);assert.equal(receipt.value.generationObservation.remote,'UNKNOWN');const before=f.agent.session.seq;
 assert.equal((await f.call('sendContactText',payload(2))).ok,false);assert.equal(f.ledger.list('contactOwnerOperation').length,1);assert.equal(f.ledger.list('ownedMainGeneration').length,1);assert.equal(f.agent.session.seq,before);assert.equal(f.requests(),1);
});

test('actual SDK synthetic contact stop fences original operation before exact abort and reports UNKNOWN',async t=>{
 let f,aborted=false;f=await contact(t,{fetcher:(_url,init)=>new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>{const operation=f.ledger.list('contactOwnerOperation').find(r=>r.command==='sendContactText');assert.equal(operation.fence.operationId,'native-contact-stop');aborted=true;reject(new DOMException('Synthetic original abort','AbortError'));},{once:true});})});
 const p=payload();assert.equal((await f.call('sendContactText',p)).ok,true);await f.waitRequest();
 const stop={operationId:'native-contact-stop',nonce:'native-contact-stop',contactOperationId:p.operationId},result=await f.call('requestContactStop',stop);assert.equal(result.ok,true);assert.equal(result.value.state,'accepted');assert.equal(aborted,true);assert.equal(result.value.generationObservation.local,'returned');assert.equal(result.value.generationObservation.remote,'UNKNOWN');assert.equal(result.value.preciseNativeSettlementVerified,false);assert.equal(f.requests(),1);
 const duplicate=await f.call('requestContactStop',stop);assert.equal(duplicate.value.state,'accepted');assert.equal(f.requests(),1);
});

test('actual branded contact source still requires explicit private model gate before allocation',async t=>{
 const f=await contact(t,{canSend:()=>false}),before=f.agent.session.seq;assert.equal((await f.call('sendContactText',payload())).ok,false);assert.equal(f.ledger.list('contactOwnerOperation').length,0);assert.equal(f.ledger.list('ownedMainGeneration').length,0);assert.equal(f.agent.session.seq,before);assert.equal(f.requests(),0);
});
