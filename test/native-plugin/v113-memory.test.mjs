import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {businessFixture} from './business-fixture.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {MemoryController} from '../../src/native/memory.mjs';
import {canonical,PluginStore} from '../../src/native/store.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const command=(operationId,action,input)=>({operationId,action,input});
const hashed=fileText=>({fileText,fileDigest:createHash('sha256').update(fileText).digest('hex')});
const file=provenance=>hashed(`{"format":"dsh-bot-memory","formatVersion":1,"storeId":"external","botName":"External","entries":[{"text":"Preserved history","category":"fact","pinned":false,"provenance":${provenance}}]}`);
async function fixture(t){const f=await businessFixture(t),knowledge=new KnowledgeController(f);return {...f,memory:new MemoryController({...f,knowledge})};}
const importFile=(f,bot,data,operationId,expectedMemoryRevision=0)=>f.memory.import(f.human,command(operationId,'memory.import',{botId:bot.botId,...data,expectedMemoryRevision}));
const exportFile=async(f,bot,memoryId)=>{const result=await f.memory.export(f.human,{botId:bot.botId,memoryIds:[memoryId]});return {fileText:result.fileText,fileDigest:result.fileDigest};};

test('inactive protected history remains exact and inactive through repeated native import/export',async t=>{
  const f=await fixture(t),root={storeId:'external',protected:true,source:{kind:'session',sessionId:'unavailable-original',eventSeq:0}};
  let data=file(JSON.stringify(root));
  for(let index=0;index<7;index++){
    const bot=await f.bot(`Inactive-${index}`),receipt=await importFile(f,bot,data,`inactive-${index}`),row=f.store.read().memories[receipt.addedIds[0]];
    assert.equal(row.inactive,true);assert.deepEqual(receipt.inactiveIds,receipt.addedIds);assert.deepEqual(f.memory.search(f.human,{botId:bot.botId}),[]);
    data=await exportFile(f,bot,row.memoryId);let historical=JSON.parse(data.fileText).entries[0].provenance;
    for(let level=0;level<=index;level++)historical=historical.originalProvenance;
    assert.deepEqual(historical,root);assert.ok(Buffer.byteLength(data.fileText)<=4*1024*1024);
  }
  assert.equal(f.requests.length,0);
});

test('supported deep protected history previews without model work and validates every historical descriptor',async t=>{
  const f=await fixture(t),bot=await f.bot('Deep-preview'),depth=600;
  const nested='{"storeId":"external","protected":false,"originalProvenance":'.repeat(depth);
  const data=file(nested+'{"storeId":"older","protected":true,"source":{"kind":"session","sessionId":"foreign-source","eventSeq":0}}'+'}'.repeat(depth));
  assert.ok(Buffer.byteLength(data.fileText)<4*1024*1024);
  const before=f.store.read(),preview=await f.memory.preview(f.human,{botId:bot.botId,...data});
  assert.equal(preview.entries[0].decision,'inactive');assert.equal(preview.entries[0].sourceVerification,'external_protected_source');
  const malformed=file(nested+'{"storeId":"older","protected":true,"source":{"kind":"human","unexpected":true}}'+'}'.repeat(depth));
  await assert.rejects(f.memory.preview(f.human,{botId:bot.botId,...malformed}),{code:'invalid_import'});
  await assert.rejects(f.memory.preview({kind:'human'},{botId:bot.botId,...data}),{code:'access_denied'});
  assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
});

test('deep native history exports within the file quota without pretty indentation growth',async t=>{
  const f=await fixture(t),bot=await f.bot('Deep-native'),depth=600;
  const data=file('{"storeId":"external","protected":false,"originalProvenance":'.repeat(depth)+'{"storeId":"older","protected":true}'+'}'.repeat(depth));
  const receipt=await importFile(f,bot,data,'deep-native'),id=receipt.addedIds[0],exported=await exportFile(f,bot,id);
  assert.ok(Buffer.byteLength(exported.fileText)<=4*1024*1024);
  let historical=JSON.parse(exported.fileText).entries[0].provenance.originalProvenance;
  for(let index=0;index<depth;index++)historical=historical.originalProvenance;
  assert.deepEqual(historical,{storeId:'older',protected:true});
  const next=await f.bot('Deep-copy'),copy=await importFile(f,next,exported,'deep-copy');
  assert.equal(f.store.read().memories[copy.addedIds[0]].inactive,true);assert.equal(f.requests.length,0);
});

test('Bot pin rejects metadata byte growth atomically and administrative forget remains available',async t=>{
  const f=await fixture(t),bot=await f.bot('Pin-quota'),target=await f.memory.write(f.human,command('quota-target','memory.write',{botId:bot.botId,text:'target'}));
  const binding=await f.sessions.create(f.human,command('quota-session','session.create',{botId:bot.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  const bytes=rows=>Object.values(rows).reduce((n,row)=>n+Buffer.byteLength(canonical(row)),0),limit=2*1024*1024;
  await f.store.transact(command('quota-near-limit','test.fixture',{}),draft=>{
    let index=0;while(bytes(draft.memories)+9000<limit){const memoryId=`quota-${index++}`;draft.memories[memoryId]={...target,memoryId,text:'x'.repeat(8192)};}
    const memoryId=`quota-${index}`;draft.memories[memoryId]={...target,memoryId,text:'x'};
    draft.memories[memoryId].text+='x'.repeat(limit-10-bytes(draft.memories));return null;
  });
  const before=f.store.read();assert.equal(bytes(before.memories),limit-10);
  await assert.rejects(f.memory.pin(actor,command('quota-pin','memory.pin',{memoryId:target.memoryId,expectedVersion:1,pinned:true})),{code:'memory_quota'});
  assert.deepEqual(f.store.read(),before);
  await f.memory.forget(f.human,command('quota-forget','memory.forget',{memoryId:target.memoryId,expectedVersion:1}));
  assert.equal(f.store.read().memories[target.memoryId].forgotten,true);
});

test('forgetting historical root leaves an independent human import readable while actual source ACL stays live',async t=>{
  const f=await fixture(t),source=await f.bot('Historical-source'),target=await f.bot('Independent-copy'),next=await f.bot('Later-copy');
  const knowledge=f.memory.knowledge,doc=await knowledge.ingest(f.human,command('actual-material','material.ingest',{botId:source.botId,title:'actual source',text:'actual evidence'}));
  const original=await f.memory.write(f.human,command('original','memory.write',{botId:source.botId,text:'Independent remembered fact',source:{kind:'material',docId:doc.docId,chunkId:doc.chunks[0].chunkId}}));
  const first=await importFile(f,target,await exportFile(f,source,original.memoryId),'human-copy'),id=first.addedIds[0];
  await f.memory.forget(f.human,command('forget-historical','memory.forget',{memoryId:original.memoryId,expectedVersion:original.version}));
  const binding=await f.sessions.create(f.human,command('copy-contact','session.create',{botId:target.botId})),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  assert.equal(f.memory.search(actor,{botId:target.botId})[0].text,'Independent remembered fact');
  const data=await exportFile(f,target,id);assert.equal((await f.memory.preview(f.human,{botId:next.botId,...data})).entries[0].verified,true);
  await f.policy.authorizeShare(f.human,command('revoke-actual-source','share.set',{botId:source.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],memories:['*'],materials:['*'],tasks:['*']}}}));
  assert.deepEqual(f.memory.search(actor,{botId:target.botId}),[]);assert.equal(f.memory.context(actor,binding).includes('Independent remembered fact'),false);
});


test('native JSON capability rejects unsupported deep imports before any backend mutation',async t=>{
  const f=await fixture(t),bot=await f.bot('Unsupported-native'),depth=12000;
  const data=file('{"storeId":"external","protected":false,"originalProvenance":'.repeat(depth)+'{"storeId":"older","protected":true}'+'}'.repeat(depth));
  assert.ok(Buffer.byteLength(data.fileText)<4*1024*1024);
  const before=f.store.read(),path=join(f.dir,'storage','dsh_bot_v1.json'),originalBytes=await readFile(path);
  const rejected=error=>error.code==='invalid_import'&&error.details?.rejectedBeforeWrite===true;
  await assert.rejects(f.memory.preview(f.human,{botId:bot.botId,...data}),rejected);
  await assert.rejects(importFile(f,bot,data,'unsupported-native'),rejected);
  assert.deepEqual(f.store.read(),before);assert.deepEqual(await readFile(path),originalBytes);
  const ordinary=await f.memory.write(f.human,command('ordinary-after-rejection','memory.write',{botId:bot.botId,text:'Still usable'}));
  assert.equal(ordinary.text,'Still usable');
  await f.store.close();const reopened=await PluginStore.open(f.ctx.storage.backend.get('json').kv);f.beforeClose.push(()=>reopened.close());
  assert.equal(reopened.read().memories[ordinary.memoryId].text,'Still usable');
  assert.equal(Object.hasOwn(reopened.read().operations,'unsupported-native'),false);assert.equal(f.requests.length,0);
});
