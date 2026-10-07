/** Actual private GUI lifecycle/SDK substrate. Keyless synthetic output; no browser or remote-model evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {Ledger} from '../src/ledger.mjs';
import {canonical} from '../src/errors.mjs';
import {createGuiGenerationPreparation} from '../src/bot-gui-generation-preparation.mjs';
import {generationFixture,route,preset} from './work-generation-fixture.mjs';
import {guiGenerationRuntime,syntheticGuiDelegation} from './bot-gui-generation-fixture.mjs';
import {observeUntil,syntheticResponse} from './work-generation-fixture.mjs';

test('copied lifecycle grants cannot reopen or close an original GUI journal, and active history cannot enable cold restore',async t=>{
 const f=await generationFixture(t,undefined,{realWorkspace:true});
 const intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const prepare=createGuiGenerationPreparation({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
  route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
 t.after(()=>prepare.close());
 const options={grant:{},role:'main',mainSessionId:intent.sessionId,originalCreationIntent:{binding:intent,operationId:intent.operationId,nonce:intent.nonce}};
 await assert.rejects(()=>prepare.prepareRestore(intent,options),{code:'gui_restore_grant_required'});
 await assert.rejects(()=>prepare.prepareRestore(intent,{...options,grant:{nativeRestoreVerified:true,cold:true,recovery:true}}),{code:'gui_restore_grant_required'});
 await assert.rejects(()=>prepare.releaseArchivedJournals({}),{code:'gui_restore_grant_required'});
 await assert.rejects(()=>prepare.inspectArchivedHistory(intent,{role:'main',originalCreationIntent:options.originalCreationIntent}),{code:'gui_archived_history_required'});
 await assert.rejects(lstat(join(f.directory,'owned-generations')),{code:'ENOENT'});
 assert.equal(f.ctx.agents.list().length,0);assert.equal(f.requests(),0);
 assert.equal(f.ledger.get('creation',intent.operationId).state,'prepared');
 assert.equal(f.ledger.list('guiNativeCreationOriginal').length,0);
});

test('actual GUI archives a mode-initialized blank main and restores the same Bot and Session identity with no replay',async t=>{
 const f=await guiGenerationRuntime(t);
 assert.equal(typeof f.Native.admitOwnedBlankSessionControl,'function','M2_NATIVE_CONTROLS_REQUIRED');
 const created=await f.call('createBot',{operationId:'gui-blank-lifecycle-create',nonce:'gui-blank-lifecycle-create',name:'同会话恢复'});
 assert.equal(created.ok,true);assert.equal(created.value.state,'created');
 const {botId,sessionId}=created.value;
 assert.equal((await f.call('bootstrap')).value.controls.canArchive,true);
 const archive={operationId:'gui-blank-original-archive',nonce:'gui-blank-original-archive',botId,botEpoch:1};
 const archived=await f.call('archiveBot',archive);
 assert.equal(archived.ok,true);assert.equal(archived.value.state,'accepted');assert.equal(archived.value.botEpoch,2);
 assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId),true);
 const cold=await f.ownerCall('selectedView',botId);assert.equal(cold.ok,true);assert.equal(cold.value.readOnly,true);
 assert.equal(cold.value.contact.sessionId,sessionId);assert.equal(cold.value.contact.preciseNativeSettlementVerified,false);
 assert.equal((await f.call('bootstrap')).value.controls.canRestore,true);
 const restore={operationId:'gui-blank-original-restore',nonce:'gui-blank-original-restore',botId,botEpoch:2};
 const restored=await f.call('restoreBot',restore);
 assert.equal(restored.ok,true);assert.equal(restored.value.state,'accepted');assert.equal(restored.value.botEpoch,3);
 const boot=(await f.call('bootstrap')).value;
 assert.equal(boot.selectedBotId,botId);assert.equal(boot.contactSessionId,sessionId);assert.equal(boot.nativeGenerationTerminalSupported,true);
 assert.equal(boot.modelRequestsEnabled,false);assert.equal(boot.controls.canArchive,true);
 assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId),false);
 assert.equal(f.ctx.agents.get(sessionId).id,sessionId);
 assert.equal(canonical(f.ctx.tools.schemas(f.ctx.agents.get(sessionId)).map(tool=>tool.name)),canonical(['dsh_bot_delegate']));
 assert.equal((await f.call('restoreBot',restore)).value.state,'accepted');
 assert.equal(f.requests(),0);
});

test('a cold archived GUI verifies the original native journal before restoring the same mode-initialized main',async t=>{
 const f=await guiGenerationRuntime(t);
 assert.equal(typeof f.Native.admitOwnedBlankSessionControl,'function','M2_NATIVE_HISTORY_REQUIRED');
 const created=(await f.call('createBot',{operationId:'cold-archive-create',nonce:'cold-archive-create',name:'归档后重启'})).value;
 assert.equal(created.state,'created');
 const archived=await f.call('archiveBot',{operationId:'cold-original-archive',nonce:'cold-original-archive',botId:created.botId,botEpoch:1});
 assert.equal(archived.value.state,'accepted');await f.close();
 const next=await guiGenerationRuntime(t,{directory:f.directory}),boot=(await next.call('bootstrap')).value;
 assert.equal(boot.selectedBotId,created.botId);assert.equal(boot.contactSessionId,created.sessionId);assert.equal(boot.controls.lifecycle,'archived');
 assert.equal(boot.controls.canRestore,true);assert.equal(boot.modelRequestsEnabled,false);assert.equal(next.ctx.agents.list().length,0);assert.equal(next.requests(),0);
 const cold=await next.ownerCall('selectedView',created.botId);assert.equal(cold.value.readOnly,true);assert.equal(cold.value.preciseNativeSettlementVerified,false);
 const request={operationId:'cold-original-restore',nonce:'cold-original-restore',botId:created.botId,botEpoch:2},restored=await next.call('restoreBot',request);
 assert.equal(restored.ok,true);assert.equal(restored.value.state,'accepted');assert.equal(restored.value.botEpoch,3);
 assert.equal(next.ctx.agents.get(created.sessionId).id,created.sessionId);assert.equal((await next.call('bootstrap')).value.controls.canArchive,true);
 assert.equal((await next.ownerCall('selectedView',created.botId)).value.readOnly,undefined);
 assert.equal((await next.call('restoreBot',request)).value.state,'accepted');assert.equal(next.ctx.agents.list().length,1);assert.equal(next.requests(),0);
});

test('known GUI main, parent and zero-tool child restore their original native identities before a new parent generation',async t=>{
 let mainCalls=0,parentCalls=0;
 const fetcher=(_url,init)=>{const input=JSON.stringify(JSON.parse(init.body).messages.find(message=>message.role==='user')?.content);
  if(input.includes('Goal: lifecycle-child-goal'))return syntheticResponse({text:'CHILD_RESULT'});
  if(input.includes('Goal: lifecycle-parent-goal'))return parentCalls++===0?syntheticGuiDelegation('lifecycle-child','lifecycle-child-goal'):syntheticResponse({text:'PARENT_RESULT'});
  return mainCalls++===0?syntheticGuiDelegation('lifecycle-parent','lifecycle-parent-goal'):syntheticResponse({text:'MAIN_RESULT'});
 };
 const f=await guiGenerationRuntime(t,{enabled:true,fetcher});assert.equal(typeof f.Native.selectOwnedGenerationHistory,'function','M2_NATIVE_HISTORY_REQUIRED');
 const created=(await f.call('createBot',{operationId:'known-tree-create',nonce:'known-tree-create',name:'原工作树恢复'})).value,botId=created.botId;
 const originalContact={operationId:'known-tree-main-original',nonce:'known-tree-main-original',text:'Delegate one original parent and child'},firstContact=await f.ownerCall('sendContactText',botId,originalContact);
 assert.equal(firstContact.ok,true);
 const view=await observeUntil(async()=>{const reply=await f.ownerCall('selectedView',botId);assert.equal(reply.ok,true);return reply.value;},value=>value.work.length===2&&value.held===0
  &&value.work.every(work=>work.preciseNativeSettlementVerified&&work.result)&&value.contact.preciseNativeSettlementVerified&&value.contact.reply?.inputKind==='dsh-bot-work-result');
 const originals=view.work.map(work=>({taskId:work.taskId,task_id:work.task_id,sessionId:work.sessionId,generation:work.generation}));
 const archived=await f.call('archiveBot',{operationId:'known-tree-archive',nonce:'known-tree-archive',botId,botEpoch:1});assert.equal(archived.value.state,'accepted');
 assert.equal((await f.call('bootstrap')).value.controls.canRestore,true);
 const restored=await f.call('restoreBot',{operationId:'known-tree-restore',nonce:'known-tree-restore',botId,botEpoch:2});assert.equal(restored.ok,true);
 assert.equal(restored.value.state,'accepted');assert.equal(restored.value.botEpoch,3);
 const after=(await f.ownerCall('selectedView',botId)).value;assert.deepEqual(after.work.map(work=>({taskId:work.taskId,task_id:work.task_id,sessionId:work.sessionId,generation:work.generation})),originals);
 assert.equal(after.held,0);assert.equal(after.work.every(work=>work.preciseNativeSettlementVerified),true);
 const beforeQuery=f.requests(),historical=await f.ownerCall('inspectContactReceipt',botId,{operationId:originalContact.operationId,nonce:originalContact.nonce});
 assert.equal(historical.ok,true);assert.equal(historical.value.messageId,firstContact.value.messageId);assert.equal(historical.value.preciseNativeSettlementVerified,true);
 assert.equal((await f.ownerCall('sendContactText',botId,originalContact)).value.messageId,firstContact.value.messageId);
 assert.equal((await f.ownerCall('requestContactStop',botId,{operationId:'gui-old-contact-stop-denied',nonce:'gui-old-contact-stop-denied',contactOperationId:originalContact.operationId})).ok,false);
 assert.equal(f.requests(),beforeQuery);
 const parent=after.work.find(work=>work.task_id==='lifecycle-parent'),child=after.work.find(work=>work.task_id==='lifecycle-child');
 assert.deepEqual(f.ctx.tools.schemas(f.ctx.agents.get(parent.sessionId)).map(tool=>tool.name),['dsh_bot_delegate']);assert.equal(f.ctx.tools.schemas(f.ctx.agents.get(child.sessionId)).length,0);
 assert.equal(f.ctx.agents.get(child.sessionId).session.header.parentSession,parent.sessionId);
 const request={operationId:'known-tree-parent-continue',nonce:'known-tree-parent-continue',botId,taskId:parent.taskId,sessionId:parent.sessionId,generation:1};
 const continued=await f.call('continueWork',request);assert.equal(continued.ok,true);assert.equal(continued.value.generation,2);assert.equal(continued.value.sessionId,parent.sessionId);
 await observeUntil(async()=>{const result=await f.ownerCall('selectedView',botId);return result.value;},value=>value.work.find(work=>work.taskId===parent.taskId).generation===2
  &&value.work.find(work=>work.taskId===parent.taskId).result?.turn===2&&value.held===0&&value.work.every(work=>work.preciseNativeSettlementVerified)
  &&value.contact.generation>after.contact.generation&&value.contact.preciseNativeSettlementVerified&&value.contact.reply?.inputKind==='dsh-bot-work-result');
 const identity={botId,mainSessionId:created.sessionId,workSessions:originals.map(work=>work.sessionId).sort()};await f.close();
 const next=await guiGenerationRuntime(t,{directory:f.directory,enabled:true,fetcher}),boot=(await next.call('bootstrap')).value;
 assert.deepEqual({botId:boot.selectedBotId,mainSessionId:boot.contactSessionId,workSessions:next.ctx.agents.list().map(agent=>agent.id).filter(id=>id!==created.sessionId).sort()},identity);
 assert.equal(boot.modelDispatchStatus,'available');assert.equal(next.requests(),0);
 const recovered=(await next.ownerCall('selectedView',botId)).value;assert.equal(recovered.held,0);assert.equal(recovered.work.every(work=>work.preciseNativeSettlementVerified),true);
 const coldHistorical=await next.ownerCall('inspectContactReceipt',botId,{operationId:originalContact.operationId,nonce:originalContact.nonce});
 assert.equal(coldHistorical.value.messageId,firstContact.value.messageId);assert.equal(coldHistorical.value.preciseNativeSettlementVerified,true);assert.equal(next.requests(),0);
});

test('first active cold GUI recovery preserves a known parent g2 and its original zero-tool child without replay',async t=>{
 let mainCalls=0,parentCalls=0;
 const fetcher=(_url,init)=>{const input=JSON.stringify(JSON.parse(init.body).messages.find(message=>message.role==='user')?.content);
  if(input.includes('Goal: first-cold-child-goal'))return syntheticResponse({text:'FIRST_CHILD_RESULT'});
  if(input.includes('Goal: first-cold-parent-goal'))return parentCalls++===0?syntheticGuiDelegation('first-cold-child','first-cold-child-goal'):syntheticResponse({text:'FIRST_PARENT_RESULT'});
  return mainCalls++===0?syntheticGuiDelegation('first-cold-parent','first-cold-parent-goal'):syntheticResponse({text:'FIRST_MAIN_RESULT'});
 };
 const f=await guiGenerationRuntime(t,{enabled:true,fetcher});
 const created=(await f.call('createBot',{operationId:'first-active-cold-create',nonce:'first-active-cold-create',name:'首次已知树重启'})).value,botId=created.botId;
 assert.equal(created.state,'created');
 assert.equal((await f.ownerCall('sendContactText',botId,{operationId:'first-active-cold-main',nonce:'first-active-cold-main',text:'Create the original parent and child'})).ok,true);
 const selected=async owner=>{const result=await owner.ownerCall('selectedView',botId);assert.equal(result.ok,true);return result.value;};
 const initial=await observeUntil(()=>selected(f),value=>value.work.length===2&&value.held===0&&value.work.every(work=>work.preciseNativeSettlementVerified&&work.result)
  &&value.contact.preciseNativeSettlementVerified&&value.contact.reply?.inputKind==='dsh-bot-work-result');
 const parent=initial.work.find(work=>work.task_id==='first-cold-parent');
 const continued=await f.call('continueWork',{operationId:'first-active-cold-continue',nonce:'first-active-cold-continue',botId,taskId:parent.taskId,sessionId:parent.sessionId,generation:1});
 assert.equal(continued.ok,true);assert.equal(continued.value.generation,2);
 const before=await observeUntil(()=>selected(f),value=>value.work.find(work=>work.taskId===parent.taskId)?.generation===2
  &&value.work.find(work=>work.taskId===parent.taskId)?.result?.turn===2&&value.held===0&&value.work.every(work=>work.preciseNativeSettlementVerified)
  &&value.contact.generation>initial.contact.generation&&value.contact.preciseNativeSettlementVerified&&value.contact.reply?.inputKind==='dsh-bot-work-result');
 const identities=before.work.map(work=>({taskId:work.taskId,sessionId:work.sessionId,generation:work.generation}));
 await f.close();
 const next=await guiGenerationRuntime(t,{directory:f.directory,enabled:true,fetcher}),boot=(await next.call('bootstrap')).value;
 assert.equal(boot.modelDispatchStatus,'available');assert.equal(boot.modelRequestsEnabled,true);assert.equal(boot.controls.botEpoch,1);
 assert.equal(boot.selectedBotId,botId);assert.equal(boot.contactSessionId,created.sessionId);assert.equal(next.ctx.agents.list().length,3);
 const recovered=await selected(next);assert.equal(recovered.held,0);assert.equal(recovered.work.every(work=>work.preciseNativeSettlementVerified),true);
 assert.deepEqual(recovered.work.map(work=>({taskId:work.taskId,sessionId:work.sessionId,generation:work.generation})),identities);
 const child=recovered.work.find(work=>work.task_id==='first-cold-child');
 assert.equal(next.ctx.agents.get(child.sessionId).session.header.parentSession,parent.sessionId);
 assert.equal(next.ctx.tools.schemas(next.ctx.agents.get(child.sessionId)).length,0);assert.equal(next.requests(),0);
});

test('an UNKNOWN child keeps the entire original GUI tree cold and read-only even when the main and parent are known',async t=>{
 let mainCalls=0,parentCalls=0;
 const f=await guiGenerationRuntime(t,{enabled:true,fetcher:(_url,init)=>{
  const input=JSON.stringify(JSON.parse(init.body).messages.find(message=>message.role==='user')?.content);
  if(input.includes('Goal: cold-unknown-child-goal'))return syntheticResponse({finish:false});
  if(input.includes('Goal: cold-known-parent-goal'))return parentCalls++===0?syntheticGuiDelegation('cold-unknown-child','cold-unknown-child-goal'):syntheticResponse({text:'KNOWN_PARENT'});
  return mainCalls++===0?syntheticGuiDelegation('cold-known-parent','cold-known-parent-goal'):syntheticResponse({text:'KNOWN_MAIN'});
 }});
 assert.equal(typeof f.Native.selectOwnedGenerationHistory,'function','M2_NATIVE_HISTORY_REQUIRED');
 const created=(await f.call('createBot',{operationId:'unknown-tree-create',nonce:'unknown-tree-create',name:'未知子工作保留'})).value,botId=created.botId;
 assert.equal((await f.ownerCall('sendContactText',botId,{operationId:'unknown-tree-main',nonce:'unknown-tree-main',text:'Start an original parent and child'})).ok,true);
 const before=await observeUntil(async()=>{const reply=await f.ownerCall('selectedView',botId);assert.equal(reply.ok,true);return reply.value;},value=>value.work.length===2
  &&value.work.find(work=>work.task_id==='cold-known-parent')?.preciseNativeSettlementVerified
  &&value.work.find(work=>work.task_id==='cold-unknown-child')?.generationObservation.local==='returned'
  &&value.contact.preciseNativeSettlementVerified&&value.contact.reply?.inputKind==='dsh-bot-work-result');
 const identity={mainSessionId:created.sessionId,work:before.work.map(work=>({taskId:work.taskId,sessionId:work.sessionId,generation:work.generation}))};
 assert.equal(before.held,1);assert.equal(before.work.find(work=>work.task_id==='cold-unknown-child').generationObservation.remote,'UNKNOWN');
 await f.close();
 const next=await guiGenerationRuntime(t,{directory:f.directory,enabled:true}),boot=(await next.call('bootstrap')).value;
 assert.equal(boot.selectedBotId,botId);assert.equal(boot.contactSessionId,identity.mainSessionId);assert.equal(boot.modelDispatchStatus,'unconfirmed');
 assert.equal(boot.modelRequestsEnabled,false);assert.equal(boot.nativeGenerationTerminalSupported,false);
 assert.equal(boot.controls.canArchive,false);assert.equal(boot.controls.canRestore,false);assert.equal(boot.controls.work.every(work=>work.canContinue===false),true);
 const cold=(await next.ownerCall('selectedView',botId)).value;
 assert.equal(cold.readOnly,true);assert.equal(cold.held,1);assert.equal(cold.contact.preciseNativeSettlementVerified,false);
 assert.deepEqual(cold.work.map(work=>({taskId:work.taskId,sessionId:work.sessionId,generation:work.generation})),identity.work);
 assert.equal(cold.work.every(work=>work.generationObservation.remote==='UNKNOWN'&&work.preciseNativeSettlementVerified===false),true);
 assert.equal((await next.ownerCall('sendContactText',botId,{operationId:'cold-never-send',nonce:'cold-never-send',text:'Do not activate this tree'})).ok,false);
 for(const work of cold.work){
  assert.equal((await next.call('continueWork',{operationId:'cold-never-continue-'+work.taskId,nonce:'cold-never-continue-'+work.taskId,botId,
   taskId:work.taskId,sessionId:work.sessionId,generation:work.generation})).ok,false);
  assert.equal((await next.ownerCall('requestWorkStop',botId,{operationId:'cold-never-stop-'+work.taskId,nonce:'cold-never-stop-'+work.taskId,taskId:work.taskId,generation:work.generation})).ok,false);
 }
 assert.equal(next.ctx.agents.list().length,0);assert.equal(next.ctx.sessions.list().length,0);assert.equal(next.nativeActivations(),0);assert.equal(next.requests(),0);
 const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));
 try{assert.equal(ledger.list('bot').length,1);assert.equal(ledger.list('workGeneration').length,2);assert.equal(ledger.list('workDelivery').length,2);
  assert.equal(ledger.list('workContinuation').length,0);assert.equal(ledger.list('contactOwnerOperation').length,1);
 }finally{ledger.close();}
});
