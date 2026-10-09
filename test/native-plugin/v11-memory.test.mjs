import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {businessFixture} from './business-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
async function setup(t) {
  const f=await businessFixture(t),bot=await f.bot('memory');
  const mod=await import('../../src/native/memory.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')assert.fail('MemoryController is missing');throw e;});
  const {KnowledgeController}=await import('../../src/native/knowledge.mjs');
  const knowledge=new KnowledgeController(f);return {...f,bot,knowledge,m:new mod.MemoryController({...f,knowledge})};
}
function file(entries,extra={}) {const fileText=JSON.stringify({format:'dsh-bot-memory',formatVersion:1,storeId:'external',botName:'External',entries,...extra});return {fileText,fileDigest:createHash('sha256').update(fileText).digest('hex')};}
test('edits preserve material source and restrictions and forgotten tombstones cannot be revived',async t=>{
  const f=await setup(t),doc=await f.knowledge.ingest(f.human,command('doc','material.ingest',{botId:f.bot.botId,title:'fact',text:'source text'}));
  const first=await f.m.write(f.human,command('write','memory.write',{botId:f.bot.botId,text:'remembered',source:{kind:'material',docId:doc.docId,chunkId:doc.chunks[0].chunkId}}));
  const edited=await f.m.write(f.human,command('edit','memory.write',{botId:f.bot.botId,memoryId:first.memoryId,expectedVersion:1,text:'edited'}));
  assert.deepEqual(edited.source,first.source);assert.ok(edited.origins.some(r=>r.kind==='material'&&r.id===doc.docId));assert.ok(edited.contentSources.some(s=>s.kind==='human'));
  await f.m.forget(f.human,command('forget','memory.forget',{memoryId:first.memoryId,expectedVersion:2}));
  await assert.rejects(f.m.write(f.human,command('revive','memory.write',{botId:f.bot.botId,memoryId:first.memoryId,expectedVersion:3,text:'revived'})),{code:'memory_forgotten'});
  assert.equal(f.store.read().bots[f.bot.botId].memoryRevision,3);assert.equal(f.store.read().bots[f.bot.botId].configRevision,f.bot.configRevision);
});
test('pin quota is CAS guarded and context includes complete bounded previews with exact read accounting',async t=>{
  const f=await setup(t);let records=[];
  for(let i=0;i<10;i++)records.push(await f.m.write(f.human,command(`write-${i}`,'memory.write',{botId:f.bot.botId,text:`fact-${i} `+'😀'.repeat(600),pinned:i<8})));
  await assert.rejects(f.m.pin(f.human,command('pin-over','memory.pin',{memoryId:records[8].memoryId,expectedVersion:1,pinned:true})),{code:'pin_quota'});
  await assert.rejects(f.m.pin(f.human,command('pin-stale','memory.pin',{memoryId:records[0].memoryId,expectedVersion:0,pinned:false})),{code:'revision_conflict'});
  const binding=await f.sessions.create(f.human,command('session','session.create',{botId:f.bot.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId)),reads=[];
  const original=f.policy.noteRead.bind(f.policy);f.policy.noteRead=(a,r)=>{reads.push(r);original(a,r);};
  const preview=f.m.contextPreview(actor,binding,{maxChars:3000});assert.equal(reads.length,0);
  const context=f.m.context(actor,binding,{maxChars:3000});assert.ok(context.length<=3000);assert.equal(context,preview.context);assert.deepEqual(reads.filter(r=>r.kind==='memory').map(r=>r.id),preview.includedMemoryIds);
  const line=context.split('\n').find(l=>l.startsWith('长期记忆'));assert.ok(Array.isArray(JSON.parse(line.slice(line.indexOf('：')+1))));
});
test('strict import digest, revision and pin checks reject atomically and exact retries do not append',async t=>{
  const f=await setup(t),input={botId:f.bot.botId,...file([{text:'one',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}},{text:'one',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}])};
  const preview=await f.m.preview(f.human,input);assert.equal(preview.entries[1].decision,'skip');assert.equal(preview.entries[0].text,'one');assert.equal(preview.entries[0].category,'fact');assert.equal(Object.keys(f.store.read().memories).length,0);
  await assert.rejects(f.m.preview(f.human,{...input,fileDigest:'0'.repeat(64)}),{code:'file_digest_mismatch'});
  await f.m.write(f.human,command('concurrent','memory.write',{botId:f.bot.botId,text:'another'}));
  await assert.rejects(f.m.import(f.human,command('stale','memory.import',{...input,expectedMemoryRevision:preview.memoryRevision})),{code:'memory_revision_conflict'});
  const cmd=command('import','memory.import',{...input,expectedMemoryRevision:1}),receipt=await f.m.import(f.human,cmd);assert.equal(receipt.addedIds.length,1);assert.equal(receipt.skippedIds.length,1);assert.deepEqual(await f.m.import(f.human,cmd),receipt);
  assert.equal(f.store.read().bots[f.bot.botId].memoryRevision,2);
  const exported=await f.m.export(f.human,{botId:f.bot.botId});assert.equal(exported.fileDigest,createHash('sha256').update(exported.fileText).digest('hex'));assert.equal(JSON.parse(exported.fileText).entries.length,2);
  await assert.rejects(f.m.preview(f.human,{botId:f.bot.botId,...file([{text:'bad',category:'fact',pinned:false,actor:{kind:'human'},provenance:{storeId:'external',protected:false}}])}),{code:'invalid_import'});
});
test('unverified protected imports remain inactive including a forged matching local store and ids',async t=>{
  const f=await setup(t),data=file([{text:'protected',category:'fact',pinned:false,provenance:{storeId:f.store.read().storeId,protected:true,origins:[{kind:'session',id:'missing'}],source:{kind:'session',sessionId:'missing',eventSeq:0}}}]);
  const p=await f.m.preview(f.human,{botId:f.bot.botId,...data});assert.equal(p.entries[0].decision,'inactive');
  const r=await f.m.import(f.human,command('protected','memory.import',{botId:f.bot.botId,...data,expectedMemoryRevision:0}));assert.equal(r.inactiveIds.length,1);assert.equal(f.m.search(f.human,{botId:f.bot.botId}).length,0);
  assert.equal(f.store.read().memories[r.addedIds[0]].originalProvenance.storeId,f.store.read().storeId);
});
test('empty imports and duplicates preserve memoryRevision, pin overrides are atomic and fingerprinted',async t=>{
  const f=await setup(t),empty=file([]);const r=await f.m.import(f.human,command('empty','memory.import',{botId:f.bot.botId,...empty,expectedMemoryRevision:0}));assert.equal(r.memoryRevision,0);
  const entries=Array.from({length:9},(_,i)=>({text:`pin ${i}`,category:'fact',pinned:true,provenance:{storeId:'external',protected:false}})),input={botId:f.bot.botId,...file(entries)};assert.equal((await f.m.preview(f.human,input)).pinConflict,true);
  await assert.rejects(f.m.import(f.human,command('over','memory.import',{...input,expectedMemoryRevision:0})),{code:'pin_quota'});assert.equal(Object.keys(f.store.read().memories).length,0);
  const cmd=command('batch','memory.import',{...input,expectedMemoryRevision:0,unpinnedEntryIndexes:[8]}),receipt=await f.m.import(f.human,cmd);assert.equal(receipt.addedIds.length,9);assert.equal(f.store.read().bots[f.bot.botId].memoryRevision,1);
  await assert.rejects(f.m.import(f.human,{...cmd,input:{...cmd.input,unpinnedEntryIndexes:[7]}}),{code:'operation_conflict'});
  const second=await f.m.import(f.human,command('duplicate','memory.import',{...input,expectedMemoryRevision:1}));assert.equal(second.addedIds.length,0);assert.equal(second.memoryRevision,1);
});
test('strict files reject prototype nested source fields and more than 500 entries before changing store',async t=>{
  const f=await setup(t),before=f.store.read().revision;
  const texts=['{"format":"dsh-bot-memory","formatVersion":1,"storeId":"external","botName":"X","entries":[{"text":"x","category":"fact","pinned":false,"provenance":{"storeId":"external","protected":false,"__proto__":{"kind":"human"}}}]}',file([{text:'x',category:'fact',pinned:false,provenance:{storeId:'external',protected:false,source:{kind:'human',cwd:'/secret'}}}]).fileText,file(Array.from({length:501},()=>({text:'x',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}))).fileText];
  for(const fileText of texts)await assert.rejects(f.m.preview(f.human,{botId:f.bot.botId,fileText,fileDigest:createHash('sha256').update(fileText).digest('hex')}),{code:'invalid_import'});
  assert.equal(f.store.read().revision,before);assert.equal(f.requests.length,0);
});
test('external source ID collisions remain descriptive and inactive edits cannot reactivate protected records',async t=>{
  const f=await setup(t),binding=await f.sessions.create(f.human,command('local-session','session.create',{botId:f.bot.botId}));
  const input={botId:f.bot.botId,...file([{text:'external secret',category:'fact',pinned:false,provenance:{storeId:'external',protected:true,source:{kind:'session',sessionId:binding.sessionId,eventSeq:0},origins:[{kind:'session',id:binding.sessionId}]}}])},r=await f.m.import(f.human,command('foreign','memory.import',{...input,expectedMemoryRevision:0})),id=r.addedIds[0];
  const row=await f.m.write(f.human,command('edit-inactive','memory.write',{botId:f.bot.botId,memoryId:id,expectedVersion:1,text:'human edit'}));assert.equal(row.inactive,true);assert.deepEqual(row.origins,[]);assert.equal(row.originalProvenance.storeId,'external');assert.equal(row.source.kind,'import');
  const actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));assert.deepEqual(f.m.search(actor,{botId:f.bot.botId}),[]);assert.equal(f.m.context(actor,binding).includes('human edit'),false);
  const exported=JSON.parse((await f.m.export(f.human,{botId:f.bot.botId,memoryIds:[id]})).fileText);assert.equal(exported.entries[0].provenance.originalProvenance.storeId,'external');
});
test('nested retained provenance cannot conceal protection behind an ordinary outer descriptor',async t=>{
  const f=await setup(t),data=file([{text:'protected nested',category:'fact',pinned:false,provenance:{storeId:'external',protected:false,source:{kind:'human'},originalProvenance:{storeId:'older-store',protected:true,source:{kind:'session',sessionId:'foreign-session',eventSeq:0},origins:[{kind:'session',id:'foreign-session'}]}}}]);
  const preview=await f.m.preview(f.human,{botId:f.bot.botId,...data});assert.equal(preview.entries[0].decision,'inactive');
  const receipt=await f.m.import(f.human,command('nested','memory.import',{botId:f.bot.botId,...data,expectedMemoryRevision:0}));assert.equal(receipt.inactiveIds.length,1);assert.deepEqual(f.m.search(f.human,{botId:f.bot.botId}),[]);
});
test('verified local material export imported to another Bot retains restrictions after source revocation',async t=>{
  const f=await setup(t),other=await f.bots.create(f.human,command('other','bot.create',{name:'other',role:'target',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}})),doc=await f.knowledge.ingest(f.human,command('local-doc','material.ingest',{botId:f.bot.botId,title:'source',text:'verified material'}));
  const memory=await f.m.write(f.human,command('local-memory','memory.write',{botId:f.bot.botId,text:'verified fact',source:{kind:'material',docId:doc.docId,chunkId:doc.chunks[0].chunkId}})),data=await f.m.export(f.human,{botId:f.bot.botId,memoryIds:[memory.memoryId]});
  const input={botId:other.botId,fileText:data.fileText,fileDigest:data.fileDigest};assert.equal((await f.m.preview(f.human,input)).entries[0].verified,true);
  const receipt=await f.m.import(f.human,command('local-copy','memory.import',{...input,expectedMemoryRevision:0})),row=f.store.read().memories[receipt.addedIds[0]];assert.equal(row.inactive,false);assert.ok(row.origins.some(ref=>ref.kind==='material'&&ref.id===doc.docId));
  const binding=await f.sessions.create(f.human,command('other-session','session.create',{botId:other.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));assert.equal(f.m.search(actor,{botId:other.botId}).length,1);
  await f.policy.authorizeShare(f.human,command('source-revoke','share.set',{botId:f.bot.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],memories:['*'],materials:['*']}}}));assert.deepEqual(f.m.search(actor,{botId:other.botId}),[]);assert.equal(f.m.context(actor,binding).includes('verified fact'),false);
});
test('human edits preserve historical categories and automatic writes compare stable forgotten source evidence',async t=>{
  const f=await setup(t);await f.store.transact(command('legacy','seed',{}),draft=>{draft.memories.legacy={memoryId:'legacy',botId:f.bot.botId,text:'old',category:'historical-value',version:1,source:{kind:'human',operationId:'old'},origins:[],forgotten:false};return null;});
  const edited=await f.m.write(f.human,command('legacy-edit','memory.write',{botId:f.bot.botId,memoryId:'legacy',expectedVersion:1,text:'new'}));assert.equal(edited.category,'historical-value');
  await f.store.transact(command('legacy-tombstone','seed',{}),draft=>{draft.memories.tombstone={memoryId:'tombstone',botId:f.bot.botId,text:'old source',category:'fact',version:1,source:{kind:'session',sessionId:'old-session',eventSeq:7},origins:[],forgotten:true};return null;});
  // The source validator uses actual official session events for richer metadata.
  const binding=await f.sessions.create(f.human,command('source-session','session.create',{botId:f.bot.botId})),agent=f.ctx.agents.get(binding.sessionId);
  const {createUserMessage}=await import('@deepseek-ai/dsh-llm');const {eventually}=await import('./official-fixture.mjs');agent.followup(createUserMessage({content:[{type:'text',text:'source'}],source:{kind:'test'}}));await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(e=>e.type==='user/message');await f.store.transact(command('fix-tombstone','seed',{}),draft=>{draft.memories.tombstone.source={sessionId:binding.sessionId,eventSeq:event.seq};return null;});
  const actor=f.policy.fromAgent(agent);await assert.rejects(f.m.write(actor,command('auto-return','memory.write',{botId:f.bot.botId,text:'source again',automatic:true,source:{sessionId:binding.sessionId,eventSeq:event.seq}})),{code:'forgotten_source'});
});
test('context reserves complete task summaries before pinned memories and never records omitted items',async t=>{
  const f=await setup(t);for(let i=0;i<14;i++)await f.m.write(f.human,command(`context-${i}`,'memory.write',{botId:f.bot.botId,text:`query ${i} `+'x'.repeat(900),pinned:i<8}));
  await f.store.transact(command('context-task','seed',{}),draft=>{draft.tasks.pending={taskId:'pending',botId:f.bot.botId,title:'mandatory unfinished work',state:'UNKNOWN'};return null;});
  const binding=await f.sessions.create(f.human,command('context-session','session.create',{botId:f.bot.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId)),reads=[];
  const note=f.policy.noteRead.bind(f.policy);f.policy.noteRead=(a,ref)=>{reads.push(ref);note(a,ref);};
  const preview=f.m.contextPreview(actor,binding,{query:'query',maxChars:1800}),context=f.m.context(actor,binding,{query:'query',maxChars:1800});assert.equal(context,preview.context);assert.ok(context.includes('mandatory unfinished work'));assert.ok(context.length<=1800);assert.ok(preview.omitted.some(row=>row.reason==='budget'));
  assert.deepEqual(reads.filter(r=>r.kind==='memory').map(r=>r.id),preview.includedMemoryIds);assert.deepEqual(reads.filter(r=>r.kind==='task').map(r=>r.id),['pending']);
  for(const line of context.split('\n').filter(line=>line.startsWith('身份')||line.startsWith('未完成任务')||line.startsWith('长期记忆')))JSON.parse(line.slice(line.indexOf('：')+1));
});
test('memory byte and entry quotas include tombstones and inactive records and permit administrative forget',async t=>{
  const f=await setup(t),memory=await f.m.write(f.human,command('quota-memory','memory.write',{botId:f.bot.botId,text:'original'}));
  await f.store.transact(command('memory-fill','seed',{}),draft=>{for(let i=0;i<1999;i++){const id=`quota-${i}`;draft.memories[id]={...memory,memoryId:id,forgotten:true,inactive:true};}return null;});
  const revision=f.store.read().revision;await assert.rejects(f.m.write(f.human,command('memory-over','memory.write',{botId:f.bot.botId,text:'new entry'})),{code:'memory_quota'});assert.equal(f.store.read().revision,revision);
  const importData=file([{text:'append batch',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}]);await assert.rejects(f.m.import(f.human,command('batch-over','memory.import',{botId:f.bot.botId,...importData,expectedMemoryRevision:1})),{code:'memory_quota'});assert.equal(f.store.read().revision,revision);
  await f.m.forget(f.human,command('administrative','memory.forget',{memoryId:memory.memoryId,expectedVersion:1}));assert.equal(f.store.read().memories[memory.memoryId].forgotten,true);
});
test('arbitrary historical category values survive edit and import export without silent rewriting',async t=>{
  const f=await setup(t),category='旧分类'.repeat(100);await f.store.transact(command('long-category','seed',{}),draft=>{draft.memories.oldCategory={memoryId:'oldCategory',botId:f.bot.botId,text:'old body',category,version:1,source:{kind:'human',operationId:'old'},forgotten:false,origins:[]};return null;});
  const edited=await f.m.write(f.human,command('edit-category','memory.write',{botId:f.bot.botId,memoryId:'oldCategory',expectedVersion:1,text:'new body'}));assert.equal(edited.category,category);
  const exported=await f.m.export(f.human,{botId:f.bot.botId,memoryIds:['oldCategory']}),preview=await f.m.preview(f.human,{botId:f.bot.botId,fileText:exported.fileText,fileDigest:exported.fileDigest});assert.equal(preview.entries[0].category,category);assert.equal(preview.entries[0].decision,'skip');
});
test('frozen taskInput origins export descriptively and external IDs stay inactive without local authority',async t=>{
  const f=await setup(t),memory=await f.m.write(f.human,command('task-input-memory','memory.write',{botId:f.bot.botId,text:'protected frozen prerequisite'}));
  await f.store.transact(command('task-input-origin','seed',{}),draft=>{draft.memories[memory.memoryId].origins=[{kind:'taskInput',id:'frozen-input'}];return null;});
  const exported=await f.m.export(f.human,{botId:f.bot.botId,memoryIds:[memory.memoryId]}),original=JSON.parse(exported.fileText).entries[0];
  assert.deepEqual(original.provenance.origins,[{kind:'taskInput',id:'frozen-input'}]);assert.equal(original.provenance.protected,true);
  const external=file([{...original,text:'external frozen fact',provenance:{...original.provenance,storeId:'external'}}]),preview=await f.m.preview(f.human,{botId:f.bot.botId,...external});assert.equal(preview.entries[0].decision,'inactive');
  const receipt=await f.m.import(f.human,command('external-task-input','memory.import',{botId:f.bot.botId,...external,expectedMemoryRevision:1}));assert.equal(receipt.inactiveIds.length,1);const row=f.store.read().memories[receipt.addedIds[0]];assert.equal(row.inactive,true);assert.deepEqual(row.origins,[]);assert.deepEqual(row.originalProvenance.origins,[{kind:'taskInput',id:'frozen-input'}]);
  const edited=await f.m.write(f.human,command('edit-task-input-memory','memory.write',{botId:f.bot.botId,memoryId:memory.memoryId,expectedVersion:1,text:'edited frozen prerequisite'}));assert.deepEqual(edited.origins,[{kind:'taskInput',id:'frozen-input'}]);
});
test('claimed local taskInput provenance requires an actual immutable input record',async t=>{
  const f=await setup(t),memory=await f.m.write(f.human,command('missing-input-memory','memory.write',{botId:f.bot.botId,text:'local missing input'}));
  await f.store.transact(command('missing-input-origin','seed',{}),draft=>{draft.memories[memory.memoryId].origins=[{kind:'taskInput',id:'missing-frozen-input'}];return null;});
  const exported=await f.m.export(f.human,{botId:f.bot.botId,memoryIds:[memory.memoryId]}),preview=await f.m.preview(f.human,{botId:f.bot.botId,fileText:exported.fileText,fileDigest:exported.fileDigest});assert.equal(preview.entries[0].verified,false);assert.equal(preview.entries[0].sourceVerification,'source_unverified');
  await f.store.transact(command('real-input','seed',{}),draft=>{draft.taskInputs['missing-frozen-input']={inputId:'missing-frozen-input',taskId:'upstream-task',botId:f.bot.botId,result:{text:'frozen body',source:{kind:'human'},origins:[]},origins:[]};return null;});
  const verified=await f.m.preview(f.human,{botId:f.bot.botId,fileText:exported.fileText,fileDigest:exported.fileDigest});assert.equal(verified.entries[0].verified,true);assert.equal(verified.entries[0].sourceVerification,'verified_local_source');
});
