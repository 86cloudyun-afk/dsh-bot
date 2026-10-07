/** Actual private GUI owner/RPC/SDK tree. Strict-empty diagnostic and synthetic keyless SSE, no browser or remote model claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Ledger} from '../src/ledger.mjs';
import {guiGenerationRuntime} from './bot-gui-generation-fixture.mjs';
import {observeUntil,syntheticResponse} from './work-generation-fixture.mjs';
const create={operationId:'gui-controls-original-create',nonce:'gui-controls-original-create',name:'Original Control Bot'};
function delegateResponse(task_id,goal){const events=[{type:'message_start',message:{usage:{input_tokens:5}}},
 {type:'content_block_start',index:0,content_block:{type:'tool_use',id:crypto.randomUUID(),name:'dsh_bot_delegate',input:{task_id,goal,completion_condition:'Keep the exact original task and session'}}},
 {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:3}},{type:'message_stop'}];
 return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));}
const send=(f,botId,id,text)=>f.ownerCall('sendContactText',botId,{operationId:id,nonce:id,text});
const selected=(f,botId)=>f.ownerCall('selectedView',botId).then(result=>{assert.equal(result.ok,true);return result.value;});
test('actual GUI advertises unavailable native lifecycle controls and refuses forged scoped operations before effects',async t=>{
 const f=await guiGenerationRuntime(t),created=await f.call('createBot',create),boot=(await f.call('bootstrap')).value;
 assert.equal(created.value.state,'created');assert.deepEqual(boot.controls,{version:1,botId:created.value.botId,botEpoch:1,lifecycle:'active',canArchive:false,canRestore:false,work:[]});
 for(const[endpoint,payload]of [['continueWork',{operationId:'disabled-original',nonce:'disabled-original',botId:created.value.botId,taskId:'unknown-task',sessionId:'unknown-session',generation:1}],
  ['archiveBot',{operationId:'archive-unsupported',nonce:'archive-unsupported',botId:created.value.botId,botEpoch:1}],
  ['restoreBot',{operationId:'restore-unsupported',nonce:'restore-unsupported',botId:'another-bot',botEpoch:1}]])assert.equal((await f.call(endpoint,payload)).ok,false);
 const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));try{assert.equal(ledger.list('workContinuation').length,0);assert.equal(ledger.list('botLifecycleOperation').length,0);}finally{ledger.close();}
 assert.equal(f.requests(),0);
});

test('actual private GUI derives a zero-tool child, continues the known original parent, and retains UNKNOWN after exact stop',async t=>{
 const childOutput=Promise.withResolvers(),continuedOutput=Promise.withResolvers();let mainCalls=0,parentCalls=0,childRequested=false,continuedRequested=false;
 t.after(()=>{childOutput.resolve(syntheticResponse({finish:false}));continuedOutput.resolve(syntheticResponse({finish:false}));});
 const f=await guiGenerationRuntime(t,{enabled:true,initialMode:null,fetcher:(_url,init)=>{const body=JSON.parse(init.body),input=JSON.stringify(body.messages.find(message=>message.role==='user')?.content);
  if(input.includes('Goal: gui-child-goal')){childRequested=true;return childOutput.promise;}
  if(input.includes('Goal: gui-parent-goal')){parentCalls++;if(parentCalls===1)return delegateResponse('gui-child','gui-child-goal');if(parentCalls===2)return syntheticResponse({text:'PARENT_RESULT'});continuedRequested=true;return continuedOutput.promise;}
  if(mainCalls++===0)return delegateResponse('gui-parent','gui-parent-goal');return syntheticResponse({text:'MAIN_RESULT'});
 }}),created=await f.call('createBot',create),botId=created.value.botId;
 assert.equal((await send(f,botId,'gui-original-main-goal','Delegate an original parent and child')).ok,true);
 const view=await observeUntil(()=>selected(f,botId),value=>childRequested&&value.work.some(row=>row.task_id==='gui-parent'&&row.preciseNativeSettlementVerified));
 const parent=view.work.find(row=>row.task_id==='gui-parent'),child=view.work.find(row=>row.task_id==='gui-child');assert.ok(child);
 assert.equal(parent.held,false);assert.equal(child.held,true);assert.equal(view.held,1);
 const parentAgent=f.ctx.agents.get(parent.sessionId),childAgent=f.ctx.agents.get(child.sessionId);
 assert.deepEqual(f.ctx.tools.schemas(parentAgent).map(tool=>tool.name),['dsh_bot_delegate']);assert.equal(f.ctx.tools.schemas(childAgent).length,0);
 assert.equal(childAgent.session.header.parentSession,parent.sessionId);assert.equal(childAgent.session.header.delegationDepth,1);assert.equal(f.ctx.agents.isOwnedBy(child.sessionId,parentAgent),true);
 const boot=(await f.call('bootstrap')).value;assert.equal(boot.controls.work.find(row=>row.taskId===parent.taskId).canContinue,true);
 assert.equal(boot.controls.work.find(row=>row.taskId===child.taskId).canContinue,false);
 const request={operationId:'gui-original-work-continue',nonce:'gui-original-work-continue',botId,taskId:parent.taskId,sessionId:parent.sessionId,generation:1};
 const next=await f.call('continueWork',request);assert.equal(next.ok,true);assert.equal(next.value.version,1);assert.equal(next.value.originalGeneration,1);assert.equal(next.value.generation,2);assert.equal(next.value.sessionId,parent.sessionId);
 await observeUntil(()=>continuedRequested,value=>value===true);const requests=f.requests();
 const duplicate=await f.call('continueWork',request);assert.equal(duplicate.value.generation,2);assert.equal(f.requests(),requests);
 const inspected=await f.call('inspectWorkContinuation',request);assert.equal(inspected.value.operationId,request.operationId);assert.equal(f.requests(),requests);
 const stop=f.ownerCall('requestWorkStop',botId,{operationId:'gui-original-parent-stop',nonce:'gui-original-parent-stop',taskId:parent.taskId,generation:2});
 await f.tick();continuedOutput.resolve(syntheticResponse({finish:false}));childOutput.resolve(syntheticResponse({finish:false}));
 assert.equal((await stop).value.state,'accepted');
 const unknown=await observeUntil(()=>selected(f,botId),value=>value.work.every(row=>row.generationObservation.local==='returned'));
 assert.equal(unknown.work.find(row=>row.taskId===parent.taskId).generation,2);assert.equal(unknown.work.find(row=>row.taskId===parent.taskId).held,true);
 assert.equal(unknown.work.find(row=>row.taskId===parent.taskId).generationObservation.remote,'UNKNOWN');assert.equal(unknown.held,2);
 assert.equal((await send(f,botId,'gui-short-main-goal','A short main goal while original work remains UNKNOWN')).ok,true);
 const mainReceipt=await observeUntil(()=>f.ownerCall('inspectContactReceipt',botId,{operationId:'gui-short-main-goal',nonce:'gui-short-main-goal'}),value=>value.ok&&value.value.preciseNativeSettlementVerified);
 assert.equal(mainReceipt.value.generationObservation.remote,'settled');assert.equal((await selected(f,botId)).held,2);
 const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));try{assert.equal(ledger.list('bot').length,1);assert.equal(ledger.list('workContinuation').length,1);
  const rows=ledger.list('workGeneration').filter(row=>row.taskId===parent.taskId);assert.equal(rows.length,2);assert.notEqual(rows[0].binding.inputMessageId,rows[1].binding.inputMessageId);
  assert.equal(rows.every(row=>row.sessionId===parent.sessionId),true);
 }finally{ledger.close();}
});

test('a GUI parent UNKNOWN cannot allocate a continuation operation, new input or generation',async t=>{
 let mainCalls=0;const f=await guiGenerationRuntime(t,{enabled:true,initialMode:null,fetcher:(_url,init)=>{
  const input=JSON.stringify(JSON.parse(init.body).messages.find(message=>message.role==='user')?.content);
  if(input.includes('Goal: gui-parent-unknown'))return syntheticResponse({finish:false});
  return mainCalls++===0?delegateResponse('gui-parent-unknown','gui-parent-unknown'):syntheticResponse();
 }}),created=await f.call('createBot',create),botId=created.value.botId;
 await send(f,botId,'gui-parent-unknown-main','Start one original parent');
 const view=await observeUntil(()=>selected(f,botId),value=>value.work.some(row=>row.task_id==='gui-parent-unknown'&&row.generationObservation.local==='returned'));
 const work=view.work[0],requests=f.requests();assert.equal(work.held,true);assert.equal(work.preciseNativeSettlementVerified,false);
 assert.equal((await f.call('bootstrap')).value.controls.work[0].canContinue,false);
 assert.equal((await f.call('continueWork',{operationId:'never-allocate',nonce:'never-allocate',botId,taskId:work.taskId,sessionId:work.sessionId,generation:1})).ok,false);
 const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));try{assert.equal(ledger.list('workContinuation').length,0);assert.equal(ledger.list('workGeneration').length,1);assert.equal(ledger.list('workDelivery').length,1);}finally{ledger.close();}
 assert.equal(f.requests(),requests);
});
