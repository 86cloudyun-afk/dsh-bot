/** Actual private GUI lifecycle/SDK substrate. Keyless synthetic output; no browser or remote-model evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {canonical} from '../src/errors.mjs';
import {createGuiGenerationPreparation} from '../src/bot-gui-generation-preparation.mjs';
import {generationFixture,route,preset} from './work-generation-fixture.mjs';
import {guiGenerationRuntime} from './bot-gui-generation-fixture.mjs';

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
