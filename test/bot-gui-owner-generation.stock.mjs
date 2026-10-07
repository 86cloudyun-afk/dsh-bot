/** Actual private GUI owner, native journal and RPC; only external SSE output is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Ledger} from '../src/ledger.mjs';
import {guiGenerationRuntime,initialization} from './bot-gui-generation-fixture.mjs';
import {syntheticResponse} from './work-generation-fixture.mjs';
import * as Native from '@deepseek-ai/dsh-experimental-native-run';

const original=Object.freeze({operationId:'gui-native-create-original',nonce:'gui-native-create-nonce',name:'Native GUI Bot'});
const input=number=>({operationId:`gui-native-contact-${number}`,nonce:`gui-native-contact-${number}`,text:'Harmless keyless synthetic GUI main goal'});
async function originalReceipt(f,botId,operation){let receipt;for(let n=0;n<80;n++){await f.tick();receipt=await f.ownerCall('inspectContactReceipt',botId,{operationId:operation.operationId,nonce:operation.nonce});if(receipt.ok&&receipt.value.generationObservation.local==='returned')break;}return receipt;}
test('a mounted Loader owner declares its actual native Workspace dependency before original creation',{skip:typeof Native.mountOwnedGenerationArchiveGate!=='function'},async t=>{
  const f=await guiGenerationRuntime(t,{mountedOwner:true}),created=await f.call('createBot',original);
  assert.equal(created.ok,true);assert.equal(created.value.state,'created');
  assert.equal((await f.call('bootstrap')).value.nativeGenerationTerminalSupported,true);
  assert.equal(f.ctx.agents.get(created.value.sessionId).id,created.value.sessionId);assert.equal(f.requests(),0);
});
test('actual GUI requires a genuine M1 journal and keeps the model gate closed on a default launch',async t=>{
  const f=await guiGenerationRuntime(t),created=await f.call('createBot',original),boot=(await f.call('bootstrap')).value;
  assert.equal(created.ok,true);assert.equal(boot.modelRequestsEnabled,false);assert.equal(boot.modelDispatchStatus,'disabled');
  assert.equal(boot.creation.operationId,original.operationId);assert.equal(f.requests(),0);
  if(typeof f.Native.openOwnedGenerationJournal!=='function'){
    assert.equal(created.value.state,'unknown');assert.equal(boot.nativeGenerationTerminalSupported,false);assert.equal(f.ctx.agents.list().length,0);
    assert.equal((await f.call('reconcileCreate',{operationId:original.operationId,nonce:original.nonce})).value.sessionId,created.value.sessionId);
    return;
  }
  assert.equal(created.value.state,'created');assert.equal(boot.nativeGenerationTerminalSupported,true);
  const main=f.ctx.agents.get(created.value.sessionId);assert.ok(main);
  assert.deepEqual(f.ctx.tools.schemas(main).map(tool=>tool.name),['dsh_bot_delegate']);assert.equal(f.ctx.tools.schemas().length,0);
  assert.deepEqual(main.session.snapshotEvents().map(event=>[event.type,event.data]),[
    ['permission/preset',{preset:initialization.permissionPreset}],['sandbox/mode',{mode:initialization.sandboxMode}],['approval/policy',{policy:initialization.approvalPolicy}]]);
  assert.equal((await f.ownerCall('sendContactText',created.value.botId,{operationId:'disabled-send',nonce:'disabled-nonce',text:'Do not dispatch this goal'})).ok,false);
  const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));
  try{assert.equal(ledger.list('contactOwnerOperation').length,0);assert.equal(ledger.list('ownedMainGeneration').length,0);}finally{ledger.close();}
  assert.equal(f.requests(),0);
  const identity={ledgerId:boot.ledgerId,botId:boot.selectedBotId,sessionId:boot.contactSessionId};await f.close();
  const restarted=await guiGenerationRuntime(t,{directory:f.directory});
  const recovered=(await restarted.call('bootstrap')).value;
  assert.deepEqual({ledgerId:recovered.ledgerId,botId:recovered.selectedBotId,sessionId:recovered.contactSessionId},identity);
  assert.equal(recovered.nativeGenerationTerminalSupported,true);assert.equal(recovered.modelRequestsEnabled,false);
  assert.deepEqual(restarted.ctx.tools.schemas(restarted.ctx.agents.get(identity.sessionId)).map(tool=>tool.name),['dsh_bot_delegate']);
  assert.equal(restarted.requests(),0);
});

test('actual GUI waterfall admits one protected input and exact original receipt in the strict empty initialization diagnostic',{skip:typeof Native.openOwnedGenerationJournal!=='function'},async t=>{
  const f=await guiGenerationRuntime(t,{enabled:true,initialMode:null}),created=await f.call('createBot',original);
  assert.equal(created.value.state,'created');const first=input(1);
  assert.equal((await f.ownerCall('sendContactText',created.value.botId,first)).ok,true);await f.waitRequest();
  const receipt=await originalReceipt(f,created.value.botId,first);assert.equal(receipt.value.preciseNativeSettlementVerified,true);
  assert.equal(receipt.value.generationObservation.remote,'settled');assert.equal(f.requests(),1);
  const duplicate=await f.ownerCall('sendContactText',created.value.botId,first);
  assert.equal(duplicate.value.messageId,receipt.value.messageId);assert.equal(duplicate.value.preciseNativeSettlementVerified,true);assert.equal(f.requests(),1);
});

for(const initialMode of [initialization,null])test(`actual GUI resumes the same sealed known main and reconciles the original before accepting another input (${initialMode?'official modes':'strict empty initialization diagnostic'})`,{skip:typeof Native.openOwnedGenerationJournal!=='function'},async t=>{
  const f=await guiGenerationRuntime(t,{enabled:true,initialMode}),created=await f.call('createBot',original),boot=(await f.call('bootstrap')).value;
  assert.equal(created.value.state,'created');assert.equal(boot.modelRequestsEnabled,true);assert.equal(boot.nativeGenerationTerminalSupported,true);
  const first=input(1);assert.equal((await f.ownerCall('sendContactText',created.value.botId,first)).ok,true);
  await f.waitRequest();
  const receipt=await originalReceipt(f,created.value.botId,first);assert.equal(receipt.ok,true);assert.equal(receipt.value.preciseNativeSettlementVerified,true);assert.equal(f.requests(),1);
  const selected=(await f.ownerCall('selectedView',created.value.botId)).value;assert.equal(selected.contact.reply.text,'Synthetic work result');
  const identity={ledgerId:boot.ledgerId,botId:boot.selectedBotId,sessionId:boot.contactSessionId};await f.close();
  const restarted=await guiGenerationRuntime(t,{directory:f.directory,enabled:true,initialMode}),recovered=(await restarted.call('bootstrap')).value;
  assert.deepEqual({ledgerId:recovered.ledgerId,botId:recovered.selectedBotId,sessionId:recovered.contactSessionId},identity);
  assert.equal(recovered.modelDispatchStatus,'available');assert.equal(recovered.nativeGenerationTerminalSupported,true);
  const reconciled=await restarted.ownerCall('inspectContactReceipt',identity.botId,{operationId:first.operationId,nonce:first.nonce});
  assert.equal(reconciled.value.messageId,receipt.value.messageId);assert.equal(reconciled.value.preciseNativeSettlementVerified,true);assert.equal(restarted.requests(),0);
  assert.equal((await restarted.ownerCall('sendContactText',identity.botId,input(2))).ok,true);
  await restarted.waitRequest();
  assert.equal((await originalReceipt(restarted,identity.botId,input(2))).value.preciseNativeSettlementVerified,true);assert.equal(restarted.requests(),1);
  const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));try{assert.equal(ledger.list('bot').length,1);assert.equal(ledger.list('creation').length,1);
    assert.deepEqual(ledger.list('ownedMainGeneration').map(row=>row.binding.generation),[1,2]);assert.equal(ledger.list('contactOwnerOperation').length,2);}finally{ledger.close();}
});

for(const initialMode of [initialization,null])test(`UNKNOWN native history keeps the original GUI identity read-only on restart without raw Agent activation or new input (${initialMode?'official modes':'strict empty initialization diagnostic'})`,{skip:typeof Native.openOwnedGenerationJournal!=='function'},async t=>{
  const f=await guiGenerationRuntime(t,{enabled:true,initialMode,fetcher:()=>syntheticResponse({finish:false})}),created=await f.call('createBot',original),boot=(await f.call('bootstrap')).value;
  assert.equal(created.value.state,'created');const first=input(1);assert.equal((await f.ownerCall('sendContactText',created.value.botId,first)).ok,true);
  await f.waitRequest();
  const receipt=await originalReceipt(f,created.value.botId,first);assert.equal(receipt.value.generationObservation.remote,'UNKNOWN');assert.equal(receipt.value.preciseNativeSettlementVerified,false);
  assert.equal((await f.ownerCall('sendContactText',created.value.botId,input(2))).ok,false);assert.equal(f.requests(),1);
  await f.close();const restarted=await guiGenerationRuntime(t,{directory:f.directory,enabled:true,initialMode}),recovered=(await restarted.call('bootstrap')).value;
  assert.equal(recovered.ledgerId,boot.ledgerId);assert.equal(recovered.selectedBotId,created.value.botId);assert.equal(recovered.contactSessionId,created.value.sessionId);
  assert.equal(recovered.modelDispatchStatus,'unconfirmed');assert.equal(recovered.modelRequestsEnabled,false);assert.equal(recovered.nativeGenerationTerminalSupported,false);
  assert.equal(restarted.ctx.agents.get(created.value.sessionId),undefined);assert.equal(restarted.ctx.sessions.get(created.value.sessionId),undefined);assert.equal(restarted.requests(),0);
  const cold=await restarted.ownerCall('selectedView',created.value.botId);assert.equal(cold.ok,true);assert.equal(cold.value.readOnly,true);
  assert.equal(cold.value.contact.status,'unknown');assert.equal(cold.value.contact.generation,1);assert.equal(cold.value.contact.preciseNativeSettlementVerified,false);
  const observed=await restarted.ownerCall('inspectContactReceipt',created.value.botId,{operationId:first.operationId,nonce:first.nonce});
  assert.equal(observed.ok,true);assert.equal(observed.value.state,'durably-queued');assert.equal(observed.value.preciseNativeSettlementVerified,false);
  assert.equal(observed.value.generationObservation.remote,'UNKNOWN');
  assert.equal((await restarted.ownerCall('sendContactText',created.value.botId,input(2))).ok,false);
  assert.equal(restarted.requests(),0);assert.equal(restarted.ctx.agents.list().length,0);assert.equal(restarted.ctx.sessions.list().length,0);
  const ledger=new Ledger(join(f.directory,'bot-gui.sqlite'));try{assert.equal(ledger.list('bot').length,1);assert.equal(ledger.list('creation').length,1);
    assert.equal(ledger.list('ownedMainGeneration').length,1);assert.equal(ledger.list('contactOwnerOperation').length,1);}finally{ledger.close();}
});
