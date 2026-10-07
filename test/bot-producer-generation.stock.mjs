/** Product producer with actual native SDK loop and synthetic SSE; model I/O is zero. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {installOwnedBotProducer} from '../src/bot-producer.mjs';
import {generationFixture,syntheticResponse,tick} from './work-generation-fixture.mjs';

test('actual SDK synthetic producer prepares work before create and routes original result through protected main',async t=>{
 const f=await generationFixture(t,()=>syntheticResponse()),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const mainPort=f.host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'main',prepareGeneration:i=>f.prepareGeneration(i,'main'),isCurrent:()=>true});
 const created=await new SessionCreationDriver({host:f.host,caller:f.caller,port:mainPort}).run(f.caller,intent.operationId);assert.equal(created.state,'created');const main=f.ctx.agents.get(intent.sessionId);
 let prepared=0;const done=Promise.withResolvers();
 const producer=installOwnedBotProducer({ownerCtx:f.ctx,host:f.host,caller:f.caller,originAgent:main,botId:f.bot.botId,botEpoch:1,authorityEpoch:1,cwd:f.directory,rootInstructionRef:'explicit-keyless-synthetic-generation',execution:{beforeExecute:async()=>{},onObserved:()=>done.resolve(),onFailure:code=>done.reject(Error(code)),generationControl:{prepareWorkGeneration:i=>{prepared++;return f.prepareGeneration(i);},bindMainDelegateTool:d=>f.host.adapter.bindOwnedMainGeneration(mainPort,created,d)}}});t.after(()=>producer.dispose());
 const work=await producer.delegate({operationId:'producer-generation',nonce:'producer-generation',task_id:'producer-work',goal:'Return synthetic work result',completion_condition:'Observe original native receipt'});assert.equal(work.sessionCreation.state,'created');assert.equal(prepared,1);
 await producer.execute({task_id:work.task_id,generation:work.generation});
 let timeout;try{await Promise.race([done.promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('synthetic_result_route_timeout')),2000);})]);}finally{clearTimeout(timeout);}
 await f.waitRequest(2);assert.equal(f.requests(),2);
 const workGeneration=f.ledger.list('workGeneration')[0];assert.equal(workGeneration.generationObservation.settlementVerified,true);assert.equal(workGeneration.held,false);assert.equal(workGeneration.state,'waiting');
 const rows=f.ledger.list('ownedMainGeneration');assert.equal(rows.length,1);assert.equal(rows[0].binding.kind,'work-result');assert.equal(rows[0].binding.parentWorkBinding.sessionId,work.sessionId);assert.equal(f.ledger.list('workObservedResponse')[0].generationBinding.inputMessageId,rows[0].binding.inputMessageId);
});
