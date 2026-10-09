import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {eventually} from './official-fixture.mjs';

async function setup(t) {
  const f=await businessFixture(t),bot=await f.bot('knowledge');
  const mod=await import('../../src/native/knowledge.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')assert.fail('KnowledgeController is missing');throw e;});
  return {...f,bot,k:new mod.KnowledgeController(f)};
}
const command=(operationId,action,input)=>({operationId,action,input});
test('material chunks reconstruct exact Unicode and CRLF body and open exact citations',async t=>{
  const f=await setup(t),text='# 中国\r\n\r\n'+('😀中'.repeat(700))+'\r\n\r\n## 次节\r\nCafé\r\n';
  const doc=await f.k.ingest(f.human,command('ingest','material.ingest',{botId:f.bot.botId,title:'中国报告',text}));
  assert.equal(doc.contentHash,createHash('sha256').update(text).digest('hex'));
  assert.equal(doc.chunks.map(c=>text.slice(c.startOffset,c.endOffset)).join(''),text);
  for(const c of doc.chunks) {assert.ok([...text.slice(c.startOffset,c.endOffset)].length<=800);assert.ok(!text.slice(c.startOffset,c.endOffset).endsWith('\r'));}
  assert.ok(doc.chunks.some(c=>c.section.includes('次节')));
  const hits=f.k.search(f.human,{query:'中'});assert.ok(hits.length);
  for(const hit of hits) {assert.equal(hit.excerpt,text.slice(hit.startOffset,hit.endOffset));const page=await f.k.page(f.human,{docId:hit.docId,chunkId:hit.chunkId});assert.equal(page.text,hit.excerpt);}
  assert.deepEqual(f.k.search(f.human,{query:'!!!'}),[]);
  const metadata=f.k.metadata(f.human);assert.equal(JSON.stringify(metadata).includes('😀'),false);assert.equal(Object.hasOwn(metadata[0],'chunks'),false);
});
test('native ingestion reads real event seq and raw text part index and rejects forged evidence',async t=>{
  const f=await setup(t),binding=await f.sessions.create(f.human,command('session','session.create',{botId:f.bot.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'A😀中国B'}],source:{kind:'test'}}));
  await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const events=(await f.adapter.readNative(binding.sessionId)).events,event=events.find(e=>e.type==='user/message'),source={sessionId:binding.sessionId,eventSeq:event.seq,partIndex:0,startOffset:1,endOffset:5};
  const doc=await f.k.ingest(f.human,command('native','material.ingest',{botId:f.bot.botId,title:'native',source}));
  assert.equal(doc.text,'😀中国');assert.ok(doc.source.eventHash);assert.ok(doc.source.fullPartHash);assert.ok(doc.origins.some(r=>r.kind==='session'&&r.id===binding.sessionId));
  await assert.rejects(f.k.ingest(f.human,command('bad-range','material.ingest',{botId:f.bot.botId,title:'bad',source:{...source,startOffset:2}})),{code:'invalid_source'});
  await assert.rejects(f.k.ingest(f.human,command('forged','material.ingest',{botId:f.bot.botId,title:'bad',text:'forged',source})),{code:'invalid_material'});
  await assert.rejects(f.k.ingest({kind:'human'},command('fake','material.ingest',{botId:f.bot.botId,title:'bad',text:'bad'})),{code:'access_denied'});
});
test('archive preserves immutable citation and quota identity while revisions create new documents',async t=>{
  const f=await setup(t),doc=await f.k.ingest(f.human,command('first','material.ingest',{botId:f.bot.botId,title:'first',text:'retain me'}));
  await f.k.archive(f.human,command('archive','material.archive',{docId:doc.docId,expectedVersion:1}));
  assert.deepEqual(f.k.search(f.human,{query:'retain'}),[]);assert.equal((await f.k.page(f.human,{docId:doc.docId})).text,'retain me');
  const next=await f.k.ingest(f.human,command('revision','material.ingest',{botId:f.bot.botId,title:'second',text:'replacement',replacesDocId:doc.docId}));
  assert.notEqual(next.docId,doc.docId);assert.ok(next.origins.some(r=>r.kind==='material'&&r.id===doc.docId));
  const before=f.store.read().revision;await assert.rejects(f.k.ingest(f.human,command('oversize','material.ingest',{botId:f.bot.botId,title:'large',text:'😀'.repeat(16385)})),{code:'material_quota'});assert.equal(f.store.read().revision,before);
  assert.equal((await f.k.download(f.human,{docId:doc.docId})).text,'retain me');
});
test('read revocation hides human native excerpts and inherited material memories without erasing bodies',async t=>{
  const f=await setup(t),other=await f.bots.create(f.human,command('other-bot','bot.create',{name:'source-owner',role:'source',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}})),reader=await f.sessions.create(f.human,command('reader','session.create',{botId:f.bot.botId})),origin=await f.sessions.create(f.human,command('origin','session.create',{botId:other.botId})),agent=f.ctx.agents.get(origin.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'REVOKED_SECRET'}],source:{kind:'test'}}));await eventually(()=>f.events.get(origin.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(origin.sessionId)).events.find(e=>e.type==='user/message');
  const doc=await f.k.ingest(f.human,command('capture','material.ingest',{botId:f.bot.botId,title:'captured',source:{sessionId:origin.sessionId,eventSeq:event.seq,partIndex:0,startOffset:0,endOffset:14}})),actor=f.policy.fromAgent(f.ctx.agents.get(reader.sessionId));
  assert.ok(f.k.search(actor,{query:'REVOKED_SECRET'}).length);
  await f.policy.authorizeShare(f.human,command('revoke','share.set',{botId:other.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],memories:['*'],materials:['*']}}}));
  assert.deepEqual(f.k.search(actor,{query:'REVOKED_SECRET'}),[]);assert.deepEqual(f.k.metadata(actor),[]);await assert.rejects(f.k.page(actor,{docId:doc.docId}),{code:'access_denied'});assert.equal(f.store.read().materials[doc.docId].text,'REVOKED_SECRET');
  await assert.rejects(f.k.ingest(actor,command('cross-write','material.ingest',{botId:other.botId,title:'hijack',text:'bad'})),{code:'access_denied'});
});
test('sealed independent sources remain unavailable in the same Bot other channel and derived body cannot claim human source',async t=>{
  const f=await setup(t),first=await f.sessions.create(f.human,command('first-session','session.create',{botId:f.bot.botId})),second=await f.sessions.create(f.human,command('second-session','session.create',{botId:f.bot.botId}));
  await f.store.transact(command('sealed','seed',{}),draft=>{draft.meetings.meeting={meetingId:'meeting',epoch:1,phase:'independent'};draft.sessions[first.sessionId].lineage={meetingId:'meeting',epoch:1,phase:'independent',sessionId:first.sessionId,botId:f.bot.botId};return null;});
  const actor=f.policy.fromAgent(f.ctx.agents.get(first.sessionId)),other=f.policy.fromAgent(f.ctx.agents.get(second.sessionId));
  const doc=await f.k.ingest(actor,command('derived','material.ingest',{botId:f.bot.botId,title:'sealed',text:'SEALED_SECRET'}));assert.equal(doc.source.kind,'session');assert.ok(doc.origins.some(r=>r.id===first.sessionId));assert.ok(f.k.search(actor,{query:'SECRET'}).length);assert.deepEqual(f.k.search(other,{query:'SECRET'}),[]);
  await assert.rejects(f.k.ingest(actor,command('human-label','material.ingest',{botId:f.bot.botId,title:'forged',text:'bad',source:{kind:'human'}})),{code:'invalid_material'});
});
test('citation opening detects changed source event evidence and tiny CRLF pages make progress',async t=>{
  const f=await setup(t),binding=await f.sessions.create(f.human,command('source-session','session.create',{botId:f.bot.botId})),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'original'}],source:{kind:'test'}}));await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const event=(await f.adapter.readNative(binding.sessionId)).events.find(e=>e.type==='assistant/message'),part=event.data.message.content.findIndex(p=>p.type==='text'),text=event.data.message.content[part].text;
  const doc=await f.k.ingest(f.human,command('assistant-source','material.ingest',{botId:f.bot.botId,title:'assistant',source:{sessionId:binding.sessionId,eventSeq:event.seq,partIndex:part,startOffset:0,endOffset:text.length}}));
  const original=f.adapter.readNative.bind(f.adapter);f.adapter.readNative=async(...args)=>{const history=await original(...args);history.events.find(e=>e.seq===event.seq).data.message.content[part].text+='changed';return history;};
  assert.equal((await f.k.page(f.human,{docId:doc.docId})).source.status,'changed');
  await assert.rejects(f.k.resolveSource(f.human,{docId:doc.docId,chunkId:doc.chunks[0].chunkId}),{code:'source_unavailable'});
  const crlf=await f.k.ingest(f.human,command('crlf','material.ingest',{botId:f.bot.botId,title:'CRLF',text:'\r\nx'})),page=await f.k.page(f.human,{docId:crlf.docId,limit:1});assert.ok(page.endOffset>0,'tiny page cursor must progress');
});
test('material quotas count archived rows and reject invalid filenames and Unicode without partial changes',async t=>{
  const f=await setup(t),doc=await f.k.ingest(f.human,command('base','material.ingest',{botId:f.bot.botId,title:'base',text:'keep'}));
  await f.store.transact(command('fill','seed',{}),draft=>{for(let i=0;i<99;i++){const id=`old-${i}`;draft.materials[id]={...doc,docId:id,archived:true};}return null;});
  const revision=f.store.read().revision;await assert.rejects(f.k.ingest(f.human,command('full','material.ingest',{botId:f.bot.botId,title:'full',text:'full'})),{code:'material_quota'});assert.equal(f.store.read().revision,revision);
  await assert.rejects(f.k.ingest(f.human,command('bad-file','material.ingest',{botId:f.bot.botId,title:'file',text:'x',fileName:'../x.txt'})),{code:'invalid_material'});
  await assert.rejects(f.k.ingest(f.human,command('surrogate','material.ingest',{botId:f.bot.botId,title:'unicode',text:'\ud800'})),{code:'invalid_material'});
});
test('lexical ranking normalizes scoring only and preserves CJK singleton, sections and stable tie ordering',async t=>{
  const f=await setup(t),{chunkMaterial,lexicalScore}=await import('../../src/native/knowledge.mjs');
  const body='Title\r\n=====\r\n\r\n~~~js\r\n# fake heading\r\n~~~\r\n\r\n## 正节\r\n漢字 かな 한국 ＣＡＦＥ a1\r\n';
  const doc=await f.k.ingest(f.human,command('lexical','material.ingest',{botId:f.bot.botId,title:'lexical',text:body}));
  assert.ok(doc.chunks.some(c=>c.section==='Title'));assert.ok(doc.chunks.some(c=>c.section==='Title / 正节'));assert.ok(doc.chunks.every(c=>!c.section.includes('fake')));
  for(const query of ['漢','かな','한국','cafe','a','1'])assert.ok(f.k.search(f.human,{query}).length,query);
  assert.equal(f.store.read().materials[doc.docId].text,body);assert.equal(lexicalScore('word word',{body:'word word word'}),lexicalScore('word',{body:'word word word'}));
  const astral='😀'.repeat(801),chunks=chunkMaterial('doc-test','hash',astral);assert.deepEqual(chunks.map(c=>[c.startOffset,c.endOffset,c.startLine,c.endLine]),[[0,1600,1,1],[1600,1602,1,1]]);
  const first=await f.k.ingest(f.human,command('tie1','material.ingest',{botId:f.bot.botId,title:'same',text:'tied'})),second=await f.k.ingest(f.human,command('tie2','material.ingest',{botId:f.bot.botId,title:'same',text:'tied'}));
  assert.deepEqual(f.k.search(f.human,{query:'tied'}).map(h=>h.docId),[first.docId,second.docId].sort());
});
