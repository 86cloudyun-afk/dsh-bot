import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';

const command=(operationId,action,input={})=>({operationId,action,input});
async function fixture(t) {
  const f=await businessFixture(t),own=await f.bot('snapshot-owner'),foreign=await f.bot('snapshot-source');
  const contact=await f.sessions.create(f.human,command('reader','session.create',{botId:own.botId}));
  const source=await f.sessions.create(f.human,command('source','session.create',{botId:foreign.botId}));
  const sealed=await f.sessions.create(f.human,command('sealed','session.create',{botId:own.botId}));
  const knowledge=new KnowledgeController(f),service=new BotService({...f,knowledge});
  const material=await knowledge.ingest(f.human,command('material','material.ingest',{botId:foreign.botId,title:'Original material',text:'evidence '.repeat(128)}));
  await f.store.transact(command('large-mixed','test.seed'),draft=>{
    for(let i=0;i<250;i++) {
      const memoryId=`memory_${i}`;
      draft.memories[memoryId]={memoryId,botId:i%2?foreign.botId:own.botId,version:1,text:'x'.repeat(1024),category:'fact',pinned:false,inactive:false,source:{kind:'human'},origins:[],createdAt:'2026-10-09T00:00:00.000Z'};
    }
    draft.memories.memory_0.forgotten=true;
    draft.memories.memory_1.inactive=true;
    draft.memories.derived={memoryId:'derived',botId:own.botId,text:'derived evidence',origins:[{kind:'memory',id:'memory_3'}],source:{kind:'session',sessionId:source.sessionId},contentSources:[{kind:'material',docId:material.docId}]};
    for(let i=0;i<49;i++) {const docId=`document_${String(i).padStart(2,'0')}`;draft.materials[docId]={...material,docId,origins:[{kind:'session',id:source.sessionId}]};}
    draft.sessions.unowned={sessionId:'unowned',botId:null,purpose:'contact'};
    draft.meetings.sealedMeeting={meetingId:'sealedMeeting',epoch:1,phase:'independent',participants:[{botId:own.botId,active:true}]};
    draft.sessions[sealed.sessionId].lineage={meetingId:'sealedMeeting',epoch:1,phase:'independent',sessionId:sealed.sessionId,botId:own.botId};
    draft.memories.sealedMemory={memoryId:'sealedMemory',botId:own.botId,text:'sealed evidence',source:{kind:'session',sessionId:sealed.sessionId}};
    draft.tasks.visible={taskId:'visible',botId:own.botId,title:'Visible task',state:'returned',version:1,handoffs:[{fromBotId:foreign.botId,provenance:{origins:[{kind:'material',id:material.docId}]},source:{kind:'session',sessionId:source.sessionId}}]};
    draft.taskInputs.fixed={inputId:'fixed',taskId:'visible',botId:own.botId,attemptSessionId:source.sessionId,result:{text:'fixed result',origins:[{kind:'material',id:material.docId}]}};
    draft.attempts.visible={attemptId:'visible',taskId:'visible',botId:own.botId,sessionId:contact.sessionId,epoch:1,prerequisiteInputs:[{inputId:'fixed'}],result:{text:'visible result',origins:[{kind:'memory',id:'memory_3'}]},report:{text:'visible report',origins:[{kind:'material',id:material.docId}]}};
    draft.outbox.visible={outboxId:'visible',botId:own.botId,kind:'result',origins:[{kind:'material',id:material.docId}],text:'visible output'};
    draft.groups.visible={groupId:'visible',members:[{botId:own.botId,active:true}],title:'Visible group'};
    return null;
  });
  await f.policy.authorizeShare(f.human,command('ordinary-read','grant.set',{grantId:'ordinary',ownerBotId:null,recipientBotId:own.botId,level:'read',scope:{sessions:['unowned']},active:true}));
  return {...f,own,foreign,contact,source,sealed,material,knowledge,service,actor:f.policy.fromAgent(f.ctx.agents.get(contact.sessionId))};
}
function measuredReads(store,read) {
  const original=store.read;let reads=0;
  store.read=function(...args){reads++;return original.apply(this,args);};
  try {return {value:read(),reads};} finally {store.read=original;}
}

// Reintroducing per-row fresh policy reads makes this fail as store size grows.
test('large mixed snapshots use one call-owned store copy for main and material reads',async t=>{
  const f=await fixture(t);
  assert.ok(Buffer.byteLength(JSON.stringify(f.store.read()))>300000);
  for(const actor of [f.human,f.actor]) {
    const {value,reads}=measuredReads(f.store,()=>f.service.snapshot(actor));
    assert.equal(value.memories.length,actor===f.human?251:249);
    assert.equal(value.materials.length,50);assert.equal(value.attempts.length,1);assert.equal(value.groups.length,1);
    assert.ok(value.sessions.some(row=>row.sessionId==='unowned'));
    assert.ok(reads<=1,`snapshot cloned the complete store ${reads} times`);
  }
});

test('large material metadata lists use one fresh call-owned store copy',async t=>{
  const f=await fixture(t);
  for(const actor of [f.human,f.actor]) {
    const {value,reads}=measuredReads(f.store,()=>f.knowledge.metadata(actor,{limit:500}));
    assert.equal(value.length,50);assert.equal(Object.hasOwn(value[0],'text'),false);assert.equal(Object.hasOwn(value[0],'chunks'),false);
    assert.ok(reads<=1,`metadata cloned the complete store ${reads} times`);
  }
});

test('snapshots retain current ACL, source barriers and independent returned copies',async t=>{
  const f=await fixture(t),before=f.store.read(),snapshot=f.service.snapshot(f.actor);
  assert.equal(snapshot.sessions.some(row=>row.sessionId===f.sealed.sessionId),false);
  assert.equal(snapshot.memories.some(row=>row.memoryId==='sealedMemory'),false);
  const deps=f.policy.readDependencies(f.actor);
  for(const reference of [{kind:'memory',id:'memory_3'},{kind:'material',id:f.material.docId},{kind:'session',id:f.source.sessionId},{kind:'session',id:'unowned'}])
    assert.ok(deps.some(row=>row.kind===reference.kind&&row.id===reference.id),`lost ${reference.kind} ${reference.id}`);
  snapshot.memories.find(row=>row.memoryId==='derived').origins[0].id='changed';
  snapshot.materials[0].source.kind='changed';snapshot.tasks[0].handoffs[0].provenance.origins[0].id='changed';
  snapshot.attempts[0].result.text='changed';snapshot.groups[0].members[0].active=false;
  deps[0].id='changed';assert.deepEqual(f.store.read(),before);
  assert.equal(f.policy.readDependencies(f.actor).some(row=>row.id==='changed'),false);
  assert.equal(f.service.snapshot(f.actor).attempts[0].result.text,'visible result');
  await f.policy.authorizeShare(f.human,command('revoke-grant','grant.set',{grantId:'ordinary',ownerBotId:null,recipientBotId:f.own.botId,level:'read',scope:{sessions:['unowned']},active:false}));
  assert.equal(f.service.snapshot(f.actor).sessions.some(row=>row.sessionId==='unowned'),false);
  assert.equal(f.policy.canRead(f.actor,{kind:'session',id:'unowned'}),false);
  assert.throws(()=>f.policy.noteRead(f.actor,{kind:'session',id:'unowned'}),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,command('revoke-sharing','share.set',{botId:f.foreign.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:['*']}}}));
  const revoked=f.service.snapshot(f.actor);
  assert.equal(revoked.memories.some(row=>row.memoryId==='derived'||row.botId===f.foreign.botId),false);
  assert.equal(revoked.materials.length,0);assert.equal(revoked.attempts.length,0);assert.equal(revoked.outbox.length,0);assert.equal(revoked.tasks[0].handoffs.length,0);
  assert.equal(f.knowledge.metadata(f.actor).length,0);
  assert.equal(f.policy.canReadDerived(f.actor,before.memories.derived),false);
  assert.throws(()=>f.policy.noteDerivedRead(f.actor,before.memories.derived),{code:'access_denied'});
  assert.equal(f.service.snapshot(f.human).materials.length,50);
  assert.throws(()=>f.service.snapshot({kind:'human'}),{code:'access_denied'});
  assert.throws(()=>f.knowledge.metadata({kind:'human'}),{code:'access_denied'});
  await assert.rejects(f.service.dispatch(f.actor,{action:'snapshot',input:{state:before}}),{code:'access_denied'});
  assert.equal(f.requests.length,0);
});

test('Bot snapshot publication persists read scope and rechecks it after revocation',async t=>{
  const f=await fixture(t);
  await f.service.dispatch(f.actor,{action:'snapshot',input:{}});
  const binding=f.store.read().sessions[f.contact.sessionId];
  for(const reference of [{kind:'memory',id:'memory_3'},{kind:'material',id:f.material.docId},{kind:'session',id:f.source.sessionId}])
    assert.ok(binding.origins.some(row=>row.kind===reference.kind&&row.id===reference.id),`lost persisted ${reference.kind} source`);
  await f.policy.authorizeShare(f.human,command('publication-revoke','share.set',{botId:f.foreign.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:['*']}}}));
  assert.equal(f.policy.canReadDerived(f.actor,f.store.read().sessions[f.contact.sessionId]),false);
  await assert.rejects(f.service.dispatch(f.actor,{action:'snapshot',input:{}}),{code:'access_denied'});
  assert.equal(f.requests.length,0);
});
