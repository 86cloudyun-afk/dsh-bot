import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {deferred} from './official-fixture.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {MemoryController} from '../../src/native/memory.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
async function fixture(t) {
  const f=await businessFixture(t),knowledge=new KnowledgeController(f),memory=new MemoryController({...f,knowledge});
  const owner=await f.bot('Source'),target=await f.bot('Target');
  const material=await knowledge.ingest(f.human,command('material','material.ingest',{botId:owner.botId,title:'Source',text:'Authentic material'}));
  const original=await memory.write(f.human,command('memory','memory.write',{botId:owner.botId,text:'Remembered fact',source:{kind:'material',docId:material.docId,chunkId:material.chunks[0].chunkId}}));
  return {...f,knowledge,memory,owner,target,material,original};
}
async function exported(f,bot=f.owner,memoryId=f.original.memoryId) {
  const {fileText,fileDigest}=await f.memory.export(f.human,{botId:bot.botId,memoryIds:[memoryId]});return {fileText,fileDigest};
}
async function imported(f,bot,data,operationId,expectedMemoryRevision=0) {
  return f.memory.import(f.human,command(operationId,'memory.import',{botId:bot.botId,...data,expectedMemoryRevision}));
}
function pauseSource(t,f) {
  const entered=deferred(),release=deferred(),page=f.knowledge.page.bind(f.knowledge);
  t.after(()=>release.resolve());
  f.knowledge.page=async(...args)=>{const result=await page(...args);entered.resolve();await release.promise;return result;};
  return {entered,release};
}

test('import keeps a source forgotten during native validation inactive',async t=>{
  const f=await fixture(t),data=await exported(f),{entered,release}=pauseSource(t,f);
  const pending=imported(f,f.target,data,'import-forgotten');
  await entered.promise;
  await f.memory.forget(f.human,command('forget-source','memory.forget',{memoryId:f.original.memoryId,expectedVersion:f.original.version}));
  release.resolve();const result=await pending,row=f.store.read().memories[result.addedIds[0]];
  assert.equal(row.inactive,true);assert.equal(row.inactiveReason,'source_unverified');
  assert.deepEqual(result.inactiveIds,result.addedIds);assert.deepEqual(f.memory.search(f.human,{botId:f.target.botId}),[]);
});

test('import rechecks the original memory body and version after native validation',async t=>{
  for(const change of ['body','pin'])await t.test(change,async t=>{
    const f=await fixture(t),data=await exported(f),{entered,release}=pauseSource(t,f),pending=imported(f,f.target,data,`import-${change}`);
    await entered.promise;
    if(change==='body')await f.memory.write(f.human,command('edit-source','memory.write',{botId:f.owner.botId,memoryId:f.original.memoryId,expectedVersion:f.original.version,text:'Changed fact'}));
    else await f.memory.pin(f.human,command('pin-source','memory.pin',{memoryId:f.original.memoryId,expectedVersion:f.original.version,pinned:true}));
    release.resolve();const result=await pending,row=f.store.read().memories[result.addedIds[0]];
    assert.equal(row.inactive,true);assert.equal(row.inactiveReason,'source_unverified');
  });
});

test('a verified local imported memory remains verified through another local copy',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),next=await f.bot('Next'),data=await exported(f,f.target,first.addedIds[0]);
  const preview=await f.memory.preview(f.human,{botId:next.botId,...data});
  assert.equal(preview.entries[0].verified,true);assert.equal(preview.entries[0].sourceVerification,'verified_local_source');
  const result=await imported(f,next,data,'second-copy'),row=f.store.read().memories[result.addedIds[0]];
  assert.equal(row.inactive,false);assert.ok(row.origins.some(ref=>ref.kind==='material'&&ref.id===f.material.docId));
  const binding=await f.sessions.create(f.human,command('next-session','session.create',{botId:next.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  assert.equal(f.memory.search(actor,{botId:next.botId}).length,1);
  await f.policy.authorizeShare(f.human,command('revoke-source','share.set',{botId:f.owner.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],memories:['*'],materials:['*'],tasks:['*']}}}));
  assert.deepEqual(f.memory.search(actor,{botId:next.botId}),[]);
});

test('repeated local export and import do not exhaust retained provenance depth',async t=>{
  const f=await fixture(t);let bot=f.owner,memoryId=f.original.memoryId;
  for(let index=0;index<7;index++) {
    let data;await assert.doesNotReject(async()=>{data=await exported(f,bot,memoryId);});
    const target=await f.bot(`Cycle-${index}`),result=await imported(f,target,data,`cycle-${index}`);
    bot=target;memoryId=result.addedIds[0];
  }
  assert.equal(f.store.read().memories[memoryId].inactive,false);assert.equal(f.requests.length,0);
});

test('ordinary human memories also survive repeated local export and import',async t=>{
  const f=await fixture(t),original=await f.memory.write(f.human,command('ordinary-memory','memory.write',{botId:f.owner.botId,text:'Ordinary human fact'}));
  let bot=f.owner,memoryId=original.memoryId;
  for(let index=0;index<7;index++) {
    let data;await assert.doesNotReject(async()=>{data=await exported(f,bot,memoryId);});
    const target=await f.bot(`Ordinary-${index}`),result=await imported(f,target,data,`ordinary-copy-${index}`);
    bot=target;memoryId=result.addedIds[0];
  }
  assert.equal(f.memory.search(f.human,{botId:bot.botId})[0].text,'Ordinary human fact');
});

test('local import wrappers require their actual receipt and current source memory',async t=>{
  for(const change of ['missing-receipt','digest','source-store','receipt-owner','receipt-membership','forgotten','inactive'])await t.test(change,async t=>{
    const f=await fixture(t),result=await imported(f,f.target,await exported(f),'first-copy'),memoryId=result.addedIds[0];
    await f.store.transact(command(`change-${change}`,'test.provenance',{}),draft=>{
      const row=draft.memories[memoryId],receipt=draft.operations['first-copy'];
      if(change==='missing-receipt')delete draft.operations['first-copy'];
      if(change==='digest')row.source.fileDigest='0'.repeat(64);
      if(change==='source-store')row.source.sourceStoreId='foreign-store';
      if(change==='receipt-owner')receipt.result.botId=f.owner.botId;
      if(change==='receipt-membership')receipt.result.addedIds=[];
      if(change==='forgotten')row.forgotten=true;
      if(change==='inactive')row.inactive=true;
      return null;
    });
    if(change==='forgotten')await assert.rejects(exported(f,f.target,memoryId),{code:'export_unavailable'});
    else {
      const next=await f.bot(`Invalid-${change}`),data=await exported(f,f.target,memoryId),preview=await f.memory.preview(f.human,{botId:next.botId,...data});
      assert.equal(preview.entries[0].verified,false);const importedResult=await imported(f,next,data,`invalid-copy-${change}`);
      assert.equal(f.store.read().memories[importedResult.addedIds[0]].inactive,true);
    }
  });
});

test('an import wrapper receipt removed during source I/O cannot activate the next copy',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),next=await f.bot('Next'),data=await exported(f,f.target,first.addedIds[0]);
  assert.equal((await f.memory.preview(f.human,{botId:next.botId,...data})).entries[0].verified,true);
  const {entered,release}=pauseSource(t,f);
  const pending=imported(f,next,data,'next-copy');await entered.promise;
  await f.store.transact(command('remove-receipt','test.provenance',{}),draft=>{delete draft.operations['first-copy'];return null;});
  release.resolve();const result=await pending,row=f.store.read().memories[result.addedIds[0]];
  assert.equal(row.inactive,true);assert.equal(row.inactiveReason,'source_unverified');
});

test('retained historical import wrappers cannot authenticate forgotten or inactive ancestry',async t=>{
  for(const change of ['forgotten','inactive'])await t.test(change,async t=>{
    const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),next=await f.bot('Next');
    const second=await imported(f,next,await exported(f,f.target,first.addedIds[0]),'second-copy');
    assert.equal(f.store.read().memories[second.addedIds[0]].inactive,false);
    await f.store.transact(command(`ancestry-${change}`,'test.provenance',{}),draft=>{draft.memories[first.addedIds[0]][change]=true;return null;});
    const last=await f.bot('Last'),data=await exported(f,next,second.addedIds[0]),preview=await f.memory.preview(f.human,{botId:last.botId,...data});
    assert.equal(preview.entries[0].verified,false);
    const result=await imported(f,last,data,'last-copy');assert.equal(f.store.read().memories[result.addedIds[0]].inactive,true);
  });
});

test('a forged self-referencing root descriptor remains inactive without recursive source reads',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),next=await f.bot('Next'),data=JSON.parse((await exported(f,f.target,first.addedIds[0])).fileText);
  data.entries[0].provenance.originalProvenance.originalMemoryId=first.addedIds[0];
  const fileText=JSON.stringify(data),fileDigest=createHash('sha256').update(fileText).digest('hex');
  f.knowledge.page=()=>assert.fail('a forged root reached native source I/O');
  const result=await imported(f,next,{fileText,fileDigest},'cyclic-description');
  assert.equal(f.store.read().memories[result.addedIds[0]].inactive,true);
});

test('local native derivation of an ordinary external import survives repeated verified copies',async t=>{
  const f=await fixture(t),fileText=JSON.stringify({format:'dsh-bot-memory',formatVersion:1,storeId:'external',botName:'External',entries:[{text:'Ordinary imported fact',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}]}),fileDigest=createHash('sha256').update(fileText).digest('hex');
  const first=await imported(f,f.target,{fileText,fileDigest},'external-copy'),binding=await f.sessions.create(f.human,command('derive-session','session.create',{botId:f.target.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Actual evidence for derivation'}],source:{kind:'test'}}));await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(row=>row.type==='user/message'),actor=f.policy.fromAgent(agent);
  await f.memory.write(actor,command('derive-import','memory.write',{botId:f.target.botId,memoryId:first.addedIds[0],expectedVersion:1,text:'Locally derived fact',source:{sessionId:binding.sessionId,eventSeq:event.seq}}));
  let bot=f.target,memoryId=first.addedIds[0];
  for(let index=0;index<3;index++) {
    const next=await f.bot(`Derived-${index}`),data=await exported(f,bot,memoryId),preview=await f.memory.preview(f.human,{botId:next.botId,...data});
    assert.equal(preview.entries[0].verified,true);
    const result=await imported(f,next,data,`derived-copy-${index}`);assert.equal(f.store.read().memories[result.addedIds[0]].inactive,false);
    bot=next;memoryId=result.addedIds[0];
  }
});

test('an external descriptive body retains exact local wrapper proofs across copies before native derivation',async t=>{
  const f=await fixture(t),fileText=JSON.stringify({format:'dsh-bot-memory',formatVersion:1,storeId:'external',botName:'External',entries:[{text:'External descriptive fact',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}]}),fileDigest=createHash('sha256').update(fileText).digest('hex');
  const first=await imported(f,f.target,{fileText,fileDigest},'external-copy');let bot=f.target,memoryId=first.addedIds[0];
  for(let index=0;index<3;index++) {
    const next=await f.bot(`Before-derive-${index}`),result=await imported(f,next,await exported(f,bot,memoryId),`before-derive-copy-${index}`);
    assert.equal(f.store.read().memories[result.addedIds[0]].inactive,false);bot=next;memoryId=result.addedIds[0];
  }
  const binding=await f.sessions.create(f.human,command('derive-session','session.create',{botId:bot.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Actual derivation evidence'}],source:{kind:'test'}}));await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(row=>row.type==='user/message'),actor=f.policy.fromAgent(agent);
  await f.memory.write(actor,command('derive','memory.write',{botId:bot.botId,memoryId,expectedVersion:1,text:'Actual locally derived fact',source:{sessionId:binding.sessionId,eventSeq:event.seq}}));
  const next=await f.bot('After-derive'),data=await exported(f,bot,memoryId),preview=await f.memory.preview(f.human,{botId:next.botId,...data});
  assert.equal(preview.entries[0].verified,true);const result=await imported(f,next,data,'after-derive-copy');
  assert.equal(f.store.read().memories[result.addedIds[0]].inactive,false);
});

test('another entry sharing an import receipt cannot authenticate the forgotten source memory',async t=>{
  const f=await fixture(t),fileText=JSON.stringify({format:'dsh-bot-memory',formatVersion:1,storeId:'external',botName:'External',entries:['Unrelated fact','Derived fact'].map(text=>({text,category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}))}),fileDigest=createHash('sha256').update(fileText).digest('hex');
  const first=await imported(f,f.target,{fileText,fileDigest},'external-batch'),memoryId=first.addedIds[1],binding=await f.sessions.create(f.human,command('derive-session','session.create',{botId:f.target.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Native derivation evidence'}],source:{kind:'test'}}));await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(row=>row.type==='user/message'),actor=f.policy.fromAgent(agent);
  await f.memory.write(actor,command('derive','memory.write',{botId:f.target.botId,memoryId,expectedVersion:1,text:'Locally derived fact',source:{sessionId:binding.sessionId,eventSeq:event.seq}}));
  const next=await f.bot('Next'),second=await imported(f,next,await exported(f,f.target,memoryId),'derived-copy');
  assert.equal(f.store.read().memories[second.addedIds[0]].inactive,false);
  await f.memory.forget(f.human,command('forget-ancestor','memory.forget',{memoryId,expectedVersion:2}));
  const last=await f.bot('Last'),preview=await f.memory.preview(f.human,{botId:last.botId,...await exported(f,next,second.addedIds[0])});
  assert.equal(preview.entries[0].verified,false);assert.equal(preview.entries[0].decision,'inactive');
});

test('a legacy local wrapper without a row annotation remains verifiable when its source is unique',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),memoryId=first.addedIds[0];
  await f.store.transact(command('legacy-wrapper','test.provenance',{}),draft=>{delete draft.memories[memoryId].source.description;return null;});
  const next=await f.bot('Next'),data=await exported(f,f.target,memoryId),preview=await f.memory.preview(f.human,{botId:next.botId,...data});
  assert.equal(preview.entries[0].verified,true);const result=await imported(f,next,data,'legacy-copy');
  assert.equal(f.store.read().memories[result.addedIds[0]].inactive,false);
});

test('an existing format 1 local export without the new annotation remains verifiable',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),memoryId=first.addedIds[0];
  await f.store.transact(command('legacy-wrapper','test.provenance',{}),draft=>{delete draft.memories[memoryId].source.description;return null;});
  const file=JSON.parse((await exported(f,f.target,memoryId)).fileText);delete file.entries[0].provenance.source.description;
  const fileText=JSON.stringify(file),fileDigest=createHash('sha256').update(fileText).digest('hex'),next=await f.bot('Next'),preview=await f.memory.preview(f.human,{botId:next.botId,fileText,fileDigest});
  assert.equal(preview.entries[0].verified,true);const result=await imported(f,next,{fileText,fileDigest},'old-file-copy');
  assert.equal(f.store.read().memories[result.addedIds[0]].inactive,false);
});

test('a caller cannot substitute another memory annotation for the actual stored import source',async t=>{
  const f=await fixture(t),first=await imported(f,f.target,await exported(f),'first-copy'),next=await f.bot('Next'),file=JSON.parse((await exported(f,f.target,first.addedIds[0])).fileText);
  file.entries[0].provenance.source.description=`dsh-bot-memory:${f.original.memoryId}`;
  const fileText=JSON.stringify(file),fileDigest=createHash('sha256').update(fileText).digest('hex'),result=await imported(f,next,{fileText,fileDigest},'forged-annotation');
  assert.equal(f.store.read().memories[result.addedIds[0]].inactive,true);
});

test('repeated verified copies retain material writer lineage and its independent channel barrier',async t=>{
  const f=await fixture(t),sourceSession=await f.sessions.create(f.human,command('sealed-session','session.create',{botId:f.owner.botId}));
  await f.store.transact(command('seal-writer','test.provenance',{}),draft=>{
    draft.meetings.provenanceMeeting={meetingId:'provenanceMeeting',epoch:1,phase:'independent'};
    draft.sessions[sourceSession.sessionId].lineage={sessionId:sourceSession.sessionId,botId:f.owner.botId,meetingId:'provenanceMeeting',epoch:1,phase:'independent'};return null;
  });
  const writer=f.policy.fromAgent(f.ctx.agents.get(sourceSession.sessionId)),doc=await f.knowledge.ingest(writer,command('sealed-material','material.ingest',{botId:f.owner.botId,title:'Sealed material',text:'Independent material body'}));
  const memory=await f.memory.write(f.human,command('sealed-memory','memory.write',{botId:f.owner.botId,text:'Protected independent fact',source:{kind:'material',docId:doc.docId,chunkId:doc.chunks[0].chunkId}}));
  const first=await imported(f,f.target,await exported(f,f.owner,memory.memoryId),'sealed-first-copy'),next=await f.bot('Next'),second=await imported(f,next,await exported(f,f.target,first.addedIds[0]),'sealed-second-copy');
  assert.equal(f.store.read().memories[second.addedIds[0]].inactive,false);
  const binding=await f.sessions.create(f.human,command('reader-session','session.create',{botId:next.botId})),reader=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  assert.deepEqual(f.memory.search(reader,{botId:next.botId}),[]);
  await f.store.transact(command('reveal-writer','test.provenance',{}),draft=>{draft.meetings.provenanceMeeting.phase='discussion';return null;});
  assert.equal(f.memory.search(reader,{botId:next.botId})[0].text,'Protected independent fact');
});

test('valid memory export preserves more than 64 authenticated read origins',async t=>{
  const f=await businessFixture(t),knowledge=new KnowledgeController(f),memory=new MemoryController({...f,knowledge}),source=await f.bot('WideSource'),reader=await f.bot('WideReader');
  for(let index=0;index<65;index++)await memory.write(f.human,command(`source-${index}`,'memory.write',{botId:source.botId,text:`Actual source fact ${index}`}));
  const binding=await f.sessions.create(f.human,command('reader-session','session.create',{botId:reader.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Actual native source'}],source:{kind:'test'}}));await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(row=>row.type==='user/message'),actor=f.policy.fromAgent(agent);
  assert.equal(memory.search(actor,{botId:source.botId,limit:100}).length,65);
  const summary=await memory.write(actor,command('summary','memory.write',{botId:reader.botId,text:'Summary with complete provenance',source:{sessionId:binding.sessionId,eventSeq:event.seq}}));
  let data;await assert.doesNotReject(async()=>{data=await memory.export(f.human,{botId:reader.botId,memoryIds:[summary.memoryId]});});
  assert.equal(JSON.parse(data.fileText).entries[0].provenance.origins.length,66);
  const target=await f.bot('WideTarget'),preview=await memory.preview(f.human,{botId:target.botId,fileText:data.fileText,fileDigest:data.fileDigest});
  assert.equal(preview.entries[0].verified,true);
});

test('oversize imports reject before native source reads and leave the store untouched',async t=>{
  const f=await fixture(t),fileText=' '.repeat(4*1024*1024+1),fileDigest=createHash('sha256').update(fileText).digest('hex'),before=f.store.read();
  f.knowledge.page=()=>assert.fail('oversize input performed source I/O');
  await assert.rejects(f.memory.preview(f.human,{botId:f.target.botId,fileText,fileDigest}),{code:'invalid_import'});
  await assert.rejects(imported(f,f.target,{fileText,fileDigest},'oversize-import'),{code:'invalid_import'});
  assert.deepEqual(f.store.read(),before);
});
