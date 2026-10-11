import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {GroupMeetingController} from '../../src/native/collaboration.mjs';
import {BotService} from '../../src/native/service.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';

const command=(operationId,action,input={})=>({operationId,action,input});
const reference=(kind,id)=>({kind,id});
const hasReference=(refs,kind,id)=>refs.some(row=>row.kind===kind&&row.id===id);
function measuredReads(store,read) {
  const original=store.read;let reads=0;
  store.read=function(...args){reads++;return original.apply(this,args);};
  try{return {value:read(),reads};}finally{store.read=original;}
}
async function fixture(t) {
  const f=await businessFixture(t),a=await f.bot('snapshot-reader'),b=await f.bot('snapshot-source'),c=await f.bot('snapshot-hidden');
  const contact=await f.sessions.create(f.human,command('snapshot-contact','session.create',{botId:a.botId})),
    ownSource=await f.sessions.create(f.human,command('snapshot-own-source','session.create',{botId:a.botId})),
    source=await f.sessions.create(f.human,command('snapshot-source-contact','session.create',{botId:b.botId})),
    independent=await f.sessions.create(f.human,command('snapshot-independent-source','session.create',{botId:b.botId}));
  const origin=await f.bots.memoryWrite(f.human,command('snapshot-origin','memory.write',{botId:b.botId,text:'shared origin'})),
    oldOrigin=await f.bots.memoryWrite(f.human,command('snapshot-old-origin','memory.write',{botId:b.botId,text:'outside prompt window'})),
    hiddenOrigin=await f.bots.memoryWrite(f.human,command('snapshot-hidden-origin','memory.write',{botId:c.botId,text:'unreadable origin'}));
  const knowledge=new KnowledgeController(f),material=await knowledge.ingest(f.human,command('snapshot-material','material.ingest',{botId:b.botId,title:'Original evidence',text:'authoritative material text'}));
  const collaboration=new GroupMeetingController({...f,tasks:{runtimeId:'snapshot-test'}}),service=new BotService({...f,collaboration,knowledge});
  f.adapter.setService(service);f.beforeClose.push(()=>collaboration.close());
  const group=await collaboration.createGroup(f.human,command('snapshot-group','group.create',{name:'Snapshot team',botIds:[a.botId,b.botId],coordinatorBotId:a.botId}));
  await f.policy.authorizeShare(f.human,command('snapshot-hide-origin','share.set',{botId:c.botId,share:{enabled:false,receivers:[],scope:{}}}));
  await f.store.transact(command('snapshot-records','fixture.collaboration'),draft=>{
    draft.sessions.ordinary={sessionId:'ordinary',botId:null,purpose:'contact',state:'ready'};
    for(let i=0;i<160;i++) {
      const memoryId=`snapshot-padding-${i}`;
      draft.memories[memoryId]={memoryId,botId:a.botId,text:'ledger padding '.repeat(80),source:{kind:'human'},origins:[]};
    }
    const origins=[reference('memory',origin.memoryId),reference('session','ordinary')];
    const contentSources=[{kind:'material',docId:material.docId}];
    for(let i=0;i<60;i++)draft.groups[group.groupId].messages.push({
      messageId:`snapshot-message-${i}`,groupId:group.groupId,botId:b.botId,text:`original group message ${i}`,
      producer:{kind:'bot',botId:b.botId},source:{sessionId:i===58?ownSource.sessionId:source.sessionId},contentSources,
      origins:i===0?[reference('memory',oldOrigin.memoryId)]:i===59?[reference('memory',hiddenOrigin.memoryId)]:origins,
    });
    draft.sessions[independent.sessionId].purpose='independent';
    draft.sessions[independent.sessionId].lineage={meetingId:'snapshot-meeting',epoch:7,phase:'independent',botId:b.botId,memberEpoch:2,sessionId:independent.sessionId};
    const opinion={botId:b.botId,text:'original independent opinion',origins,source:{sessionId:independent.sessionId}};
    draft.meetings['snapshot-meeting']={meetingId:'snapshot-meeting',groupId:group.groupId,ownerBotId:a.botId,epoch:7,phase:'complete',
      participants:[{botId:a.botId,active:true,memberEpoch:1,sessionId:contact.sessionId},{botId:b.botId,active:true,memberEpoch:2,sessionId:independent.sessionId}],
      opinions:{[b.botId]:opinion},discussion:{[b.botId]:{...opinion,text:'original discussion'}},decision:{...opinion,text:'original decision'},history:[{epoch:6,phase:'complete',text:'original older meeting'}],actions:[]};
    return null;
  });
  await f.policy.authorizeShare(f.human,command('snapshot-ordinary-grant','grant.set',{grantId:'snapshot-ordinary',ownerBotId:null,recipientBotId:a.botId,level:'read',scope:{sessions:['ordinary']},active:true}));
  return {...f,a,b,c,contact,ownSource,source,independent,origin,oldOrigin,hiddenOrigin,material,group,knowledge,collaboration,service,actor:f.policy.fromAgent(f.ctx.agents.get(contact.sessionId))};
}

// Actual Policy/Service authorization and auditing; full PluginStore.read means
// canonical cloning of the entire ledger, so per-record reads regress this bound.
for(const principal of ['human','bot'])test(`${principal} collaboration snapshot uses one call-owned ledger copy and preserves original records`,async t=>{
  const f=await fixture(t),before=f.store.read();assert.ok(Buffer.byteLength(JSON.stringify(before))>200000);
  const actor=principal==='human'?f.human:f.actor,{value,reads}=measuredReads(f.store,()=>f.service.snapshot(actor));
  assert.equal(value.groups.find(row=>row.groupId===f.group.groupId).messages.length,principal==='human'?60:59);
  const meeting=value.meetings.find(row=>row.meetingId==='snapshot-meeting');assert.equal(meeting.opinions[f.b.botId].text,'original independent opinion');assert.equal(meeting.decision.text,'original decision');assert.equal(meeting.history.length,principal==='human'?1:0);
  if(principal==='bot')for(const {kind,id} of [reference('memory',f.origin.memoryId),reference('material',f.material.docId),reference('session',f.source.sessionId),reference('session',f.ownSource.sessionId),reference('session',f.independent.sessionId),reference('session','ordinary')])assert.ok(hasReference(f.policy.readDependencies(actor),kind,id),`lost ${kind} dependency ${id}`);
  assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
  assert.equal(reads,1,`snapshot cloned the full ledger ${reads} times`);
});

test('direct collaboration views capture fresh state once and only account consumed prompt-window sources',async t=>{
  const f=await fixture(t),state=f.store.read();
  const groupRead=measuredReads(f.store,()=>f.collaboration.viewGroup(f.actor,state.groups[f.group.groupId],{messageLimit:2}));
  assert.deepEqual(groupRead.value.messages.map(row=>row.messageId),['snapshot-message-57','snapshot-message-58']);
  const dependencies=f.policy.readDependencies(f.actor);
  for(const {kind,id} of [reference('memory',f.origin.memoryId),reference('material',f.material.docId),reference('session',f.source.sessionId),reference('session',f.ownSource.sessionId),reference('session','ordinary')])assert.ok(hasReference(dependencies,kind,id));
  assert.equal(hasReference(dependencies,'memory',f.oldOrigin.memoryId),false);assert.equal(hasReference(dependencies,'memory',f.hiddenOrigin.memoryId),false);
  const meetingRead=measuredReads(f.store,()=>f.collaboration.viewMeeting(f.actor,state.meetings['snapshot-meeting']));
  assert.ok(hasReference(f.policy.readDependencies(f.actor),'session',f.independent.sessionId));
  groupRead.value.messages[0].text='changed returned copy';meetingRead.value.opinions[f.b.botId].text='changed returned copy';assert.deepEqual(f.store.read(),state);
  assert.equal(groupRead.reads,1,`direct group view cloned ${groupRead.reads} times`);assert.equal(meetingRead.reads,1,`direct meeting view cloned ${meetingRead.reads} times`);assert.equal(f.requests.length,0);
});

test('new standalone reads recheck grant revocation and current sealed lineage without caching prior state',async t=>{
  const f=await fixture(t),original=f.store.read(),group=original.groups[f.group.groupId],meeting=original.meetings['snapshot-meeting'];
  assert.equal(f.collaboration.viewGroup(f.actor,group).messages.length,59);assert.ok(f.collaboration.viewMeeting(f.actor,meeting).decision);
  for(const [label,mutate,visible] of [
    ['independent',draft=>{draft.meetings['snapshot-meeting'].phase='independent';},false],
    ['cancelled-unrevealed',draft=>{draft.meetings['snapshot-meeting'].phase='cancelled';},false],
    ['cancelled-revealed',draft=>{draft.meetings['snapshot-meeting'].revealedEpoch=7;},true],
    ['new-epoch',draft=>{draft.meetings['snapshot-meeting'].epoch=8;},false],
    ['removed-member',draft=>{draft.meetings['snapshot-meeting'].epoch=7;draft.meetings['snapshot-meeting'].phase='complete';draft.meetings['snapshot-meeting'].participants[1].active=false;},false],
  ]) {
    await f.store.transact(command(`snapshot-${label}`,'fixture.lineage'),draft=>{mutate(draft);return null;});
    const viewed=f.collaboration.viewMeeting(f.actor,meeting);assert.equal(!!viewed.decision,visible,label);assert.equal(Object.keys(viewed.opinions).length,visible?1:0,label);
  }
  await f.policy.authorizeShare(f.human,command('snapshot-revoke-grant','grant.set',{grantId:'snapshot-ordinary',ownerBotId:null,recipientBotId:f.a.botId,level:'read',scope:{sessions:['ordinary']},active:false,expectedVersion:1}));
  assert.deepEqual(f.collaboration.viewGroup(f.actor,group).messages.map(row=>row.messageId),['snapshot-message-0']);
  await f.policy.authorizeShare(f.human,command('snapshot-revoke-source','share.set',{botId:f.b.botId,share:{enabled:false,receivers:[],scope:{}}}));
  assert.equal(f.collaboration.viewGroup(f.actor,group).messages.length,0);assert.equal(f.collaboration.viewGroup(f.human,group).messages.length,60);assert.deepEqual(f.store.read().groups[f.group.groupId],group);
  assert.throws(()=>f.service.snapshot({kind:'human'}),{code:'access_denied'});assert.equal(f.requests.length,0);
});

test('Bot snapshot dispatch persists the same source audit and denies derivatives after source revocation',async t=>{
  const f=await fixture(t),before=f.store.read();await f.service.dispatch(f.actor,{action:'snapshot',input:{}});
  const published=f.store.read();
  for(const {kind,id} of [reference('memory',f.origin.memoryId),reference('material',f.material.docId),reference('session',f.source.sessionId),reference('session',f.ownSource.sessionId),reference('session',f.independent.sessionId),reference('session','ordinary')])assert.ok(hasReference(published.sessions[f.contact.sessionId].origins,kind,id),`lost durable ${kind} source ${id}`);
  assert.deepEqual(published.groups,before.groups);assert.deepEqual(published.meetings,before.meetings);
  await f.policy.authorizeShare(f.human,command('snapshot-published-source-revoke','share.set',{botId:f.b.botId,share:{enabled:false,receivers:[],scope:{}}}));
  assert.equal(f.policy.canReadDerived(f.actor,published.sessions[f.contact.sessionId]),false);await assert.rejects(f.service.dispatch(f.actor,{action:'snapshot',input:{}}),{code:'access_denied'});assert.equal(f.requests.length,0);
});
