/** Actual Core preparation substrate, keyless synthetic provider; no GUI/browser/model claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {generationFixture,route,preset} from './work-generation-fixture.mjs';

async function preparer(){
  const module=await import('../src/bot-gui-generation-preparation.mjs').catch(error=>{
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    return {};
  });
  assert.equal(typeof module.createGuiGenerationPreparation,'function','missing private native journal preparation');
  return module.createGuiGenerationPreparation;
}
test('GUI preparation uses only an actual journal-capable SDK before any native Session or model side effect',async t=>{
  const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
  const prepare=create({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
    route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
  t.after(()=>prepare.close());
  if(typeof f.Native.openOwnedGenerationJournal!=='function'){
    await assert.rejects(()=>prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_owned_journal_unsupported'});
    await assert.rejects(lstat(join(f.directory,'owned-generations')),{code:'ENOENT'});
  }else{
    const result=await prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId});
    assert.equal(f.Native.isPreparedOwnedGenerationSource(result.prepared,f.ctx,intent.sessionId,'main'),true);
    assert.equal(result.prepared.mode,'create');assert.deepEqual(result.route,{provider:route.provider,model:route.model,maxTokens:2048,reasoningEffort:'off'});
  }
  assert.equal(f.ctx.agents.list().length,0);assert.equal(f.ctx.sessions.list().length,0);assert.equal(f.requests(),0);
  assert.equal(f.ledger.get('creation',intent.operationId).sessionId,intent.sessionId);
  assert.equal(f.ledger.list('ownedMainGeneration').length,0);
});
test('copied Context, changed native policy and a consumed preparation cannot allocate a replacement Session',async t=>{
  const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
  const options={ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
    route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false};
  assert.throws(()=>create({...options,ownerCtx:{...f.ctx}}),{code:'gui_native_owner_required'});
  const prepare=create(options);t.after(()=>prepare.close());
  await assert.rejects(()=>prepare.prepare({...intent,cwd:'/changed-workspace'},{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_native_creation_changed'});
  const first=prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId});
  await first.catch(()=>{});
  await assert.rejects(()=>prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_native_preparation_consumed'});
  assert.equal(f.ctx.agents.list().length,0);assert.equal(f.requests(),0);assert.equal(f.ledger.list('creation').length,1);
});
