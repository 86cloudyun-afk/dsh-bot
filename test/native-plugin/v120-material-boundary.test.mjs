import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PluginStore,copy} from '../../src/native/store.mjs';
import {PermissionPolicy,defaultShare} from '../../src/native/policy.mjs';
import {KnowledgeController,lexicalScore} from '../../src/native/knowledge.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
function setup(t) {
  const tables=['bots','sessions','memories','grants','tasks','attempts','groups','meetings','operations','outbox','materials','schedules','occurrences','notices','taskInputs'];
  const state={schema:2,storeId:'boundary-test',revision:0,...Object.fromEntries(tables.map(key=>[key,{}]))};
  for(const botId of ['owner','reader'])state.bots[botId]={botId,name:botId,lifecycle:'active',revision:1,share:defaultShare()};
  state.sessions.readerSession={sessionId:'readerSession',botId:'reader',purpose:'contact',state:'ready',archived:false,origins:[]};
  let persisted=copy(state);
  const store=new PluginStore({async putRecord(table,key,value){persisted=copy(value);},async close(){}},state);
  const operator={},agent={id:'readerSession'},policy=new PermissionPolicy(store,{agents:new Map([[agent.id,agent]]),operatorPeer:operator});
  const human=policy.fromPeer(operator),reader=policy.fromAgent(agent),k=new KnowledgeController({store,policy,adapter:{}});
  t.after(()=>store.close());
  let serial=0;
  const ingest=(text,title='neutral',extra={})=>k.ingest(human,command(`ingest-${++serial}`,'material.ingest',{botId:'owner',title,text,...extra}));
  return {store,policy,human,reader,k,ingest,persisted:()=>copy(persisted)};
}
async function exactHits(f,doc,query,minimumScore=1) {
  const before=f.store.read(),hits=f.k.search(f.human,{query,botId:'owner'});
  assert.equal(hits.length,2,`${query} must retrieve both real adjacent chunks`);
  assert.deepEqual(hits.map(hit=>hit.chunkId),doc.chunks.map(chunk=>chunk.chunkId));
  assert.equal(doc.contentHash,createHash('sha256').update(doc.text).digest('hex'));
  for(const hit of hits) {
    const chunk=doc.chunks.find(row=>row.chunkId===hit.chunkId);
    assert.deepEqual(Object.fromEntries(Object.keys(chunk).map(key=>[key,hit[key]])),chunk);
    assert.equal(hit.excerpt,doc.text.slice(chunk.startOffset,chunk.endOffset));
    assert.ok(hit.score>=minimumScore,`${query} must supplement the boundary match score`);
    const page=await f.k.page(f.human,{docId:doc.docId,chunkId:hit.chunkId});
    assert.equal(page.text,hit.excerpt);assert.equal(page.contentHash,doc.contentHash);
    assert.equal(page.startOffset,hit.startOffset);assert.equal(page.endOffset,hit.endOffset);
  }
  assert.deepEqual(f.store.read(),before,'search and opening citations must not mutate storage');
  assert.deepEqual(f.persisted(),before);
  return hits;
}

for(const query of ['中国','かな','한국'])test(`boundary search returns original adjacent CJK chunks for ${query}`,async t=>{
  const f=setup(t),doc=await f.ingest('a'.repeat(799)+query);
  assert.deepEqual(doc.chunks.map(c=>[c.startOffset,c.endOffset]),[[0,800],[800,801]]);
  await exactHits(f,doc,query,5);
});
test('a real English word split at the cap returns both original chunks',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(797)+'continuity tail');
  await exactHits(f,doc,'continuity',5);
});
test('an English phrase across the cap supplements each participating chunk',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(794)+'first second');
  await exactHits(f,doc,'first second',5);
});
test('a crossing occurrence still supplements a chunk that also contains a complete phrase',async t=>{
  const f=setup(t),doc=await f.ingest('first second'+'.'.repeat(782)+'first second');
  const hits=await exactHits(f,doc,'first second',5);
  assert.equal(hits[0].score,10);assert.equal(hits[1].score,5);
});
const normalizedCases=[
  ['combining accent','.'.repeat(796)+'Cafe\u0301 rest','café'],
  ['fullwidth letters','.'.repeat(797)+'ＣＯＮＴＩＮＵＩＴＹ tail','continuity'],
  ['Hangul composition','.'.repeat(799)+'\u1100\u1161 rest','가'],
  ['astral offsets','😀'.repeat(799)+'中国','中国'],
  ['CRLF phrase','.'.repeat(796)+'one\r\ntwo','one\r\ntwo'],
];
for(const [label,text,query] of normalizedCases)test(`boundary matching normalizes ${label} while preserving raw offsets`,async t=>{
  const f=setup(t),doc=await f.ingest(text);
  assert.equal(doc.chunks.length,2);
  assert.equal(doc.chunks.map(c=>text.slice(c.startOffset,c.endOffset)).join(''),text);
  assert.ok(doc.chunks.every(c=>!text.slice(c.startOffset,c.endOffset).endsWith('\r')));
  await exactHits(f,doc,query,label==='Hangul composition'?1:5);
});
test('terms already in the neighboring chunk never promote an unrelated chunk',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(780)+'continuity'+'.'.repeat(10)+'unrelated');
  const hits=f.k.search(f.human,{query:'continuity'});
  assert.equal(hits.length,1);assert.equal(hits[0].chunkId,doc.chunks[0].chunkId);
  assert.equal(hits[0].score,lexicalScore('continuity',{body:hits[0].excerpt,title:doc.title,section:hits[0].section}));
});
test('boundary substring in a larger English word is not a real word or phrase match',async t=>{
  const f=setup(t);await f.ingest('.'.repeat(797)+'chinaware');
  assert.deepEqual(f.k.search(f.human,{query:'china'}),[]);
});
test('query terms on opposite sides without the requested phrase keep their original scores',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(797)+'one nope two');
  const hits=f.k.search(f.human,{query:'one two'});
  assert.deepEqual(hits.map(hit=>[hit.chunkId,hit.score]),doc.chunks.map(chunk=>[chunk.chunkId,1]));
});
test('ordinary chunk scores retain body, title and section weights without neighbor inflation',async t=>{
  const f=setup(t),doc=await f.ingest('## continuity\n\n'+'.'.repeat(800)+' unrelated','continuity');
  const hits=f.k.search(f.human,{query:'continuity'});
  assert.equal(hits.length,doc.chunks.length);
  for(const hit of hits)assert.equal(hit.score,lexicalScore('continuity',{body:hit.excerpt,title:doc.title,section:hit.section}));
});
test('boundary candidates keep binary document ties, offsets and all existing limit bounds',async t=>{
  const f=setup(t);for(let i=0;i<11;i++)await f.ingest('.'.repeat(799)+'中国');
  const expected=Object.values(f.store.read().materials).sort((a,b)=>a.docId<b.docId?-1:1).flatMap(doc=>doc.chunks.map(chunk=>[doc.docId,chunk.chunkId]));
  assert.deepEqual(f.k.search(f.human,{query:'中国',limit:20}).map(h=>[h.docId,h.chunkId]),expected.slice(0,20));
  assert.deepEqual(f.k.search(f.human,{query:'中国',limit:1}).map(h=>[h.docId,h.chunkId]),expected.slice(0,1));
  assert.equal(f.k.search(f.human,{query:'中国'}).length,8);
  for(const limit of [0,21,1.5])assert.throws(()=>f.k.search(f.human,{query:'中国',limit}),{code:'invalid_limit'});
});
test('archive, share revocation and replacements immediately change boundary visibility',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(799)+'中国');
  assert.equal(f.k.search(f.reader,{query:'中国'}).length,2);
  await f.policy.authorizeShare(f.human,command('revoke','share.set',{botId:'owner',share:{enabled:false,receivers:['*'],scope:{sessions:['*'],memories:['*'],materials:['*']}}}));
  assert.deepEqual(f.k.search(f.reader,{query:'中国'}),[]);
  await assert.rejects(f.k.page(f.reader,{docId:doc.docId,chunkId:doc.chunks[0].chunkId}),{code:'access_denied'});
  const replacement=await f.ingest('replacement body','neutral',{replacesDocId:doc.docId});
  assert.notEqual(replacement.docId,doc.docId);
  await f.k.archive(f.human,command('archive','material.archive',{docId:doc.docId,expectedVersion:1}));
  assert.deepEqual(f.k.search(f.human,{query:'中国'}),[]);
  assert.equal(f.k.search(f.human,{query:'replacement'}).length,1);
  assert.equal((await f.k.page(f.human,{docId:doc.docId,chunkId:doc.chunks[0].chunkId})).text,doc.text.slice(0,800));
  assert.deepEqual(f.store.read().materials[doc.docId].chunks,doc.chunks);
});
test('a crossing English phrase cannot borrow a prefix from a larger neighboring word',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(794)+'first secondhand');
  const hits=f.k.search(f.human,{query:'first second'});
  assert.deepEqual(hits.map(hit=>[hit.chunkId,hit.score]),[[doc.chunks[0].chunkId,1]]);
});
test('a middle original chunk can participate in two real boundaries before stable ranking',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(799)+'中国'+'.'.repeat(798)+'中国');
  assert.equal(doc.chunks.length,3);
  const hits=f.k.search(f.human,{query:'中国'});
  assert.deepEqual(hits.map(hit=>[hit.chunkId,hit.score]),[[doc.chunks[1].chunkId,10],[doc.chunks[0].chunkId,5],[doc.chunks[2].chunkId,5]]);
  for(const hit of hits)assert.equal((await f.k.page(f.human,{docId:doc.docId,chunkId:hit.chunkId})).text,hit.excerpt);
});
test('contextual lowercase changes within the left chunk cannot promote the right chunk',async t=>{
  const f=setup(t),text='.'.repeat(796)+'ΟΣ\u200d\u200dΑ',doc=await f.ingest(text);
  assert.deepEqual(doc.chunks.map(c=>[c.startOffset,c.endOffset]),[[0,800],[800,801]]);
  assert.equal(lexicalScore('οσ',{body:text.slice(0,800)}),0);
  assert.equal(lexicalScore('οσ',{body:text.slice(800)}),0);
  assert.deepEqual(f.k.search(f.human,{query:'οσ'}),[],'contextual sigma casing does not make the left-only text a crossing occurrence');
});
test('a genuinely crossing Greek word still matches its contextual lowercase form',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(799)+'ΟΣ');
  await exactHits(f,doc,'ΟΣ',5);
});
test('lowercase expansion before a boundary preserves the translated match offsets',async t=>{
  const f=setup(t),doc=await f.ingest('.'.repeat(796)+'İcontinuity tail');
  await exactHits(f,doc,'continuity',5);
});
