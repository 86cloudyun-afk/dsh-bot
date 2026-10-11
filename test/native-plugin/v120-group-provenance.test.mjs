import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {eventually,textChunks} from './official-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
const message=text=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
const ref=sessionId=>({kind:'session',id:sessionId});
async function contact(f,bot,name) {
  const binding=await f.contact(bot,name),agent=f.ctx.agents.get(binding.sessionId);
  return {binding,agent,actor:f.policy.fromAgent(agent)};
}
async function revoke(f,bot,operationId) {
  await f.policy.authorizeShare(f.human,command(operationId,'share.set',{
    botId:bot.botId,share:{enabled:false,receivers:[],scope:{}},
  }));
}
async function round(f,group,operationId,text='Discuss the available messages') {
  const intent=await f.collaboration.post(f.human,command(operationId,'group.post',{groupId:group.groupId,text}));
  await eventually(()=>f.store.read().groups[group.groupId].rounds[intent.roundId].state==='complete','bounded controlled group');
  return f.store.read().groups[group.groupId];
}

// Omitting source.sessionId from viewGroup accounting leaves this derivative readable.
for(const count of [2,3])test(`v1.2 ${count} real group members retain consumed source sessions through material and later requests`,async t=>{
  let f;
  f=await collaborationFixture(t,{stream:async function*(options){
    const binding=f.store.read().sessions[options.sessionId];
    yield*textChunks(`Reply from ${f.store.read().bots[binding.botId].name}`);
  }});
  const b=await f.bot('SourceB'),a=await f.bot('ConsumerA'),bots=[b,a];
  if(count===3)bots.push(await f.bot('ConsumerC'));
  const group=await f.group(`Continuity${count}`,bots),completed=await round(f,group,'real-round');
  assert.equal(f.requests.length,count);
  const bReply=completed.messages.find(row=>row.producer.botId===b.botId),
    aReply=completed.messages.find(row=>row.producer.botId===a.botId),
    aChannel=f.store.read().sessions[aReply.source.sessionId];
  assert.ok(JSON.stringify(f.requests.find(row=>row.sessionId===aChannel.sessionId).messages).includes('Reply from SourceB'),'A actually receives the real B reply');
  const reader=await contact(f,a,'material-author'),knowledge=new KnowledgeController(f);
  f.service.knowledge=knowledge;
  const viewed=f.collaboration.viewGroup(reader.actor,completed);
  assert.equal(viewed.messages.length,count+1);
  const doc=await f.service.dispatch(reader.actor,command('group-derived-material','material.ingest',{
    botId:a.botId,title:'Group synthesis',text:'SourceB synthesis consumed by A',
  }));
  await knowledge.page(reader.actor,{docId:doc.docId});
  reader.agent.followup(message('Continue with the current authorized group synthesis'));
  await reader.agent.whenIdle();
  assert.equal(f.requests.length,count+1,'authorized contact still runs normally');
  await f.ctx.sessions.flush(reader.agent.session);
  const before=f.store.read(),log=await f.adapter.readNative(aChannel.sessionId);
  assert.ok(log.events.some(event=>event.type==='assistant/message'));
  await revoke(f,b,'revoke-real-source');
  assert.equal(f.policy.canRead(reader.actor,{kind:'material',id:doc.docId}),false,'material derived from the actual group reply must be hidden after source revocation');
  assert.ok(aChannel.origins.some(row=>row.kind==='session'&&row.id===bReply.source.sessionId),'A native prompt persists the consumed B source');
  for(let i=1;i<bots.length;i++) {
    const reply=completed.messages.find(row=>row.producer.botId===bots[i].botId),
      predecessor=completed.messages.find(row=>row.producer.botId===bots[i-1].botId),
      channel=before.sessions[reply.source.sessionId];
    assert.ok(JSON.stringify(f.requests.find(row=>row.sessionId===channel.sessionId).messages).includes(predecessor.text));
    assert.ok(channel.origins.some(row=>row.kind==='session'&&row.id===predecessor.source.sessionId),'each later native member retains its actual predecessor');
    assert.equal(f.policy.canRead(reader.actor,ref(channel.sessionId)),false,'the revoked source blocks later member sessions transitively');
  }
  assert.ok(doc.origins.some(row=>row.kind==='session'&&row.id===bReply.source.sessionId));
  assert.ok(doc.origins.some(row=>row.kind==='session'&&row.id===aChannel.sessionId),'same-Bot distinct channel remains explicit provenance');
  await assert.rejects(knowledge.page(reader.actor,{docId:doc.docId}),{code:'access_denied'});
  assert.deepEqual(knowledge.search(reader.actor,{query:'SourceB synthesis'}),[]);
  const deniedPost=await f.ctx.tools.execute({callId:'denied-derived-post',name:'dsh_bot',agent:reader.agent,
    signal:new AbortController().signal,arguments:command('denied-derived-post','group.post',{groupId:group.groupId,text:'Do not publish revoked context'})});
  assert.equal(deniedPost.isError,true,'the native tool denies publication before dispatch');
  const requests=f.requests.length;
  reader.agent.followup(message('This request must be stopped before the provider'));
  await reader.agent.whenIdle();
  assert.equal(f.requests.length,requests);
  const after=f.store.read();
  assert.deepEqual(after.groups[group.groupId],before.groups[group.groupId],'revocation does not rewrite historical messages, IDs or round settlement');
  assert.deepEqual(after.materials[doc.docId],before.materials[doc.docId]);
  assert.deepEqual(after.operations['group-derived-material'],before.operations['group-derived-material']);
  assert.deepEqual(await f.adapter.readNative(aChannel.sessionId),log,'original native log is retained');
  assert.equal(f.collaboration.viewGroup(f.human,after.groups[group.groupId]).messages.length,count+1);
  assert.equal((await knowledge.page(f.human,{docId:doc.docId})).text,doc.text);
  assert.deepEqual(f.policy.readDependencies(f.human),[]);
});

// Accounting before the prompt window makes this unrelated revocation reject A's reply.
test('v1.2 prompt filters readable messages before its 30-message window and records only consumed dependencies',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('WindowA'),b=await f.bot('WindowB'),
    oldOwner=await f.bot('OldSource'),hiddenOwner=await f.bot('HiddenSource'),group=await f.group('Window',[a,b]);
  const oldMemory=await f.bots.memoryWrite(f.human,command('old-memory','memory.write',{botId:oldOwner.botId,text:'UNCONSUMED-OLD'})),
    hiddenMemory=await f.bots.memoryWrite(f.human,command('hidden-memory','memory.write',{botId:hiddenOwner.botId,text:'UNREADABLE-TAIL'})),
    old=await contact(f,b,'old-post-channel'),filler=await contact(f,b,'filler-channel'),hidden=await contact(f,b,'hidden-post-channel');
  f.policy.noteRead(old.actor,{kind:'memory',id:oldMemory.memoryId});
  await f.collaboration.post(old.actor,command('old-post','group.post',{groupId:group.groupId,text:'UNCONSUMED-OLD'}));
  for(let i=0;i<35;i++)await f.collaboration.post(filler.actor,command(`current-${i}`,'group.post',{groupId:group.groupId,text:`CURRENT-${String(i).padStart(2,'0')}`}));
  f.policy.noteRead(hidden.actor,{kind:'memory',id:hiddenMemory.memoryId});
  for(let i=0;i<10;i++)await f.collaboration.post(hidden.actor,command(`hidden-${i}`,'group.post',{groupId:group.groupId,text:`UNREADABLE-TAIL-${i}`}));
  await revoke(f,hiddenOwner,'hide-tail');
  const ordinary=await contact(f,a,'ordinary-full-read');
  assert.equal(f.service.snapshot(ordinary.actor).groups.find(row=>row.groupId===group.groupId).messages.length,36,'ordinary Bot snapshot returns all readable messages');
  const transact=f.store.transact.bind(f.store);let aSession;
  f.store.transact=async(cmd,mutate)=>{
    if(cmd.action==='group.reply'&&f.store.read().sessions[cmd.input.sessionId].botId===a.botId){
      aSession=cmd.input.sessionId;
      await revoke(f,oldOwner,'revoke-unused-old-source');
    }
    return transact(cmd,mutate);
  };
  const completed=await round(f,group,'window-round','CURRENT-HUMAN');
  const nativePrompt=f.requests.find(row=>row.sessionId===aSession),serialized=JSON.stringify(nativePrompt.messages);
  assert.equal(serialized.includes('UNCONSUMED-OLD'),false);
  assert.equal(serialized.includes('UNREADABLE-TAIL'),false);
  assert.equal(serialized.includes('CURRENT-05'),false);
  assert.equal(serialized.includes('CURRENT-06'),true,'filtering unreadable tail occurs before slicing the last 30');
  const aReply=completed.messages.find(row=>row.source?.sessionId===aSession);
  assert.ok(aReply,'revoking an unconsumed old source must not reject the real A reply');
  assert.equal(completed.rounds[Object.keys(completed.rounds)[0]].absences.length,0);
  assert.equal(f.requests.length,2);
  assert.equal(f.store.read().sessions[aSession].origins.some(row=>row.id===oldMemory.memoryId||row.id===hiddenMemory.memoryId),false);
  assert.equal(f.service.snapshot(f.human).groups.find(row=>row.groupId===group.groupId).messages.length,49,'ordinary human snapshot retains the complete original history');
});

// Revoking a real predecessor after A finishes must also deny publication, not erase its log.
test('v1.2 group publication rechecks the actual predecessor session after native completion',async t=>{
  const f=await collaborationFixture(t),b=await f.bot('PublishSource'),a=await f.bot('PublishConsumer'),group=await f.group('Publication',[b,a]);
  const transact=f.store.transact.bind(f.store);let aSession;
  f.store.transact=async(cmd,mutate)=>{
    if(cmd.action==='group.reply'&&f.store.read().sessions[cmd.input.sessionId].botId===a.botId){
      aSession=cmd.input.sessionId;await revoke(f,b,'revoke-before-publication');
    }
    return transact(cmd,mutate);
  };
  const completed=await round(f,group,'publication-round');
  assert.equal(f.requests.length,2);
  assert.equal(completed.messages.some(row=>row.producer.botId===a.botId),false,'revoked predecessor must block A publication');
  assert.ok(Object.values(completed.rounds)[0].absences.some(row=>row.botId===a.botId&&row.reason==='access_denied'));
  const native=await f.adapter.readNative(aSession);
  assert.ok(native.events.some(event=>event.type==='assistant/message'));
  assert.equal(f.store.read().sessions[aSession].state,'UNKNOWN');
  assert.equal(f.adapter.resources(aSession).settled,true);
});

// A material source outside origins is equally part of the consumed record.
test('v1.2 group views retain material content sources alongside origins without rewriting stored history',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('MaterialReader'),b=await f.bot('MaterialOwner'),group=await f.group('MaterialBacked',[a,b]),knowledge=new KnowledgeController(f);
  const source=await knowledge.ingest(f.human,command('material-source','material.ingest',{botId:b.botId,title:'Original',text:'Material-backed group evidence'})),
    memory=await f.bots.memoryWrite(f.human,command('memory-source','memory.write',{botId:b.botId,text:'Origin fact'}));
  await f.store.transact(command('material-message-fixture','fixture.message',{}),draft=>{
    draft.groups[group.groupId].messages.push({messageId:'material-backed-message',groupId:group.groupId,text:source.text,
      producer:{kind:'bot',botId:b.botId},contentSources:[{kind:'material',docId:source.docId}],origins:[{kind:'memory',id:memory.memoryId}]});
    return null;
  });
  const reader=await contact(f,a,'material-reader'),before=f.store.read().groups[group.groupId];
  assert.equal(f.collaboration.viewGroup(reader.actor,before).messages.length,1);
  assert.ok(f.policy.readDependencies(reader.actor).some(row=>row.kind==='material'&&row.id===source.docId));
  assert.ok(f.policy.readDependencies(reader.actor).some(row=>row.kind==='memory'&&row.id===memory.memoryId));
  const derived=await knowledge.ingest(reader.actor,command('material-derived','material.ingest',{botId:a.botId,title:'Derived',text:source.text}));
  await revoke(f,b,'revoke-material-source');
  assert.equal(f.collaboration.viewGroup(reader.actor,f.store.read().groups[group.groupId]).messages.length,0);
  await assert.rejects(knowledge.page(reader.actor,{docId:derived.docId}),{code:'access_denied'});
  assert.deepEqual(f.store.read().groups[group.groupId],before);
});
