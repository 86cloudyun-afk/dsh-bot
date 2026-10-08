import test from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {eventually,textChunks} from './official-fixture.mjs';

test('two groups perform separate bounded real member model rounds',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),g1=await f.group('One',[a,b]),g2=await f.group('Two',[a,b]);
  const rounds=[];for(const group of [g1,g2])rounds.push(await f.collaboration.post(f.human,{operationId:`post-${group.groupId}`,action:'group.post',input:{groupId:group.groupId,text:`Discuss ${group.name}.`}}));
  await eventually(()=>rounds.every(row=>f.store.read().groups[row.groupId].rounds[row.roundId].state==='complete'),'real group rounds');
  assert.equal(f.requests.length,4);
  for(const group of [g1,g2]){const current=f.store.read().groups[group.groupId];assert.equal(current.messages.filter(row=>row.producer.kind==='bot').length,2);assert.ok(current.messages.every(row=>row.groupId===group.groupId));assert.equal(current.rounds[rounds.find(row=>row.groupId===group.groupId).roundId].requests,2);}
});
test('simultaneous meetings preserve their own materials and real opinion sessions',async t=>{
  const f=await collaborationFixture(t,{stream:async function*(options){yield*textChunks(JSON.stringify(options.messages).includes('MATERIAL-ONE')?'Opinion ONE':'Opinion TWO');}}),a=await f.bot('A'),b=await f.bot('B'),g=await f.group('One',[a,b]);
  const one=await f.meeting(g,'One','MATERIAL-ONE'),two=await f.meeting(g,'Two','MATERIAL-TWO');
  await eventually(()=>[one,two].every(row=>Object.keys(f.store.read().meetings[row.meetingId].opinions).length===2),'independent real opinions');
  for(const [meeting,marker,other] of [[one,'Opinion ONE','Opinion TWO'],[two,'Opinion TWO','Opinion ONE']]){
    const row=f.store.read().meetings[meeting.meetingId];assert.equal(row.phase,'independent');for(const opinion of Object.values(row.opinions)){assert.equal(opinion.text,marker);assert.equal(opinion.source.meetingId,row.meetingId);assert.ok(opinion.source.sessionId);assert.equal(opinion.text.includes(other),false);}
  }assert.equal(f.requests.length,4);
});
test('decision actions create real tasks using the caller current control permission',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),group=await f.group('Decision',[a,b]),meeting=await f.meeting(group);
  await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId].opinions).length===2);
  await f.collaboration.advance(f.human,{operationId:'discuss',action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch:1,phase:'independent'}});
  await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId].discussion).length===2);
  await f.collaboration.advance(f.human,{operationId:'decide',action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch:1,phase:'discussion'}});
  await eventually(()=>f.store.read().meetings[meeting.meetingId].decision?.text);
  const contact=await f.contact(a),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId)),command={operationId:'action',action:'meeting.action',input:{meetingId:meeting.meetingId,epoch:1,botId:b.botId,title:'Implement decision',goal:'Harmless actual task',criteria:['Actual reply']}};
  await assert.rejects(f.collaboration.actionTask(actor,command),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,{operationId:'control',action:'grant.set',input:{grantId:'a-b-control',ownerBotId:b.botId,recipientBotId:a.botId,level:'control',active:true,scope:{tasks:['*']}}});
  const task=await f.collaboration.actionTask(actor,command);assert.equal(f.store.read().tasks[task.taskId].botId,b.botId);
  await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'grant.set',input:{grantId:'a-b-control',ownerBotId:b.botId,recipientBotId:a.botId,level:'control',active:false,scope:{tasks:['*']}}});
  await assert.rejects(f.tasks.start(actor,{operationId:'start-action',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}}),{code:'access_denied'});
});

test('a failed member cannot cause a group to exceed its original model request budget',async t=>{
  const f=await collaborationFixture(t,{stream:async function*(){throw Error('Controlled provider failure');}}),a=await f.bot('A'),b=await f.bot('B');
  const group=await f.collaboration.createGroup(f.human,{operationId:'budget-group',action:'group.create',input:{name:'Budget',botIds:[a.botId,b.botId],coordinatorBotId:a.botId,rounds:3,maxRequests:1}});
  const round=await f.collaboration.post(f.human,{operationId:'budget-post',action:'group.post',input:{groupId:group.groupId,text:'One bounded request only.'}});
  await eventually(()=>f.store.read().groups[group.groupId].rounds[round.roundId].state==='complete');assert.equal(f.requests.length,1);
});
test('revoked origins are hidden in group and meeting DTOs and taint any model that read them',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),c=await f.bot('C'),group=await f.group('Origin',[a,b]),contact=await f.contact(a),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const memory=await f.bots.memoryWrite(f.human,{operationId:'C-secret',action:'memory.write',input:{botId:c.botId,text:'ORIGIN-C'}});
  await f.store.transact({operationId:'derived-group',action:'seed',input:{}},draft=>{draft.groups[group.groupId].messages.push({groupId:group.groupId,text:'ORIGIN-C',producer:{kind:'bot',botId:b.botId},origins:[{kind:'memory',id:memory.memoryId}]});return null;});
  assert.ok(JSON.stringify(f.service.snapshot(actor).groups).includes('ORIGIN-C'));
  assert.ok(f.policy.readDependencies(actor).some(ref=>ref.id===memory.memoryId));
  await f.policy.authorizeShare(f.human,{operationId:'restrict-C',action:'share.set',input:{botId:c.botId,share:{enabled:false,receivers:[],scope:{}}}});
  assert.equal(JSON.stringify(f.service.snapshot(actor).groups).includes('ORIGIN-C'),false);
});
