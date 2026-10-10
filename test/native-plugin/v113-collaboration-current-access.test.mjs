import test from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {eventually,textChunks} from './official-fixture.mjs';
const command=(operationId,action,input)=>({operationId,action,input});

test('group reply commit rejects a source revoked after the completed native turn',async t=>{
 const f=await collaborationFixture(t,{stream:async function*(){yield*textChunks('Reply derived from the protected group context');}});
 const member=await f.bot('ReviewMember'),source=await f.bot('ReviewSource'),group=await f.group('ReviewReplyACL',[member]);
 const memory=await f.bots.memoryWrite(f.human,command('protected-memory','memory.write',{botId:source.botId,text:'Protected group context'}));
 const contact=await f.contact(member),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
 f.policy.noteRead(actor,{kind:'memory',id:memory.memoryId});
 await f.collaboration.post(actor,command('derived-context-post','group.post',{groupId:group.groupId,text:'Protected group context copied into group'}));
 const original=f.store.transact.bind(f.store);let before,revoked=false,replyActor;
 f.store.transact=async(cmd,mutate)=>{
  if(cmd.action==='group.reply'&&!revoked){
   revoked=true;before=f.store.read();replyActor=f.policy.fromAgent(f.ctx.agents.get(cmd.input.sessionId));
   assert.ok(before.sessions[cmd.input.sessionId].origins.some(ref=>ref.kind==='memory'&&ref.id===memory.memoryId));
   await f.policy.authorizeShare(f.human,command('revoke-group-context','share.set',{botId:source.botId,share:{enabled:false,receivers:[],scope:{}}}));
   assert.equal(f.policy.canRead(replyActor,{kind:'memory',id:memory.memoryId}),false);
  }
  return original(cmd,mutate);
 };
 const intent=await f.collaboration.post(f.human,command('human-round','group.post',{groupId:group.groupId,text:'Discuss the available group context'}));
 await eventually(()=>f.store.read().groups[group.groupId].rounds[intent.roundId].state==='complete');
 const state=f.store.read(),published=state.groups[group.groupId].messages.filter(row=>row.roundId===intent.roundId);
 assert.equal(published.length,0,'source revocation before publication must reject the derivative group reply');
 assert.ok(state.groups[group.groupId].rounds[intent.roundId].absences.some(row=>row.reason==='access_denied'));
 const native=await f.adapter.readNative(replyActor.sessionId);
 assert.ok(native.events.some(event=>event.type==='assistant/message'&&JSON.stringify(event.data).includes('Reply derived')),'the exact native result remains in its original log');
 await f.policy.authorizeShare(f.human,command('restore-group-context','share.set',{botId:source.botId,share:{enabled:true,receivers:['*'],scope:{memories:['*'],sessions:['*'],tasks:['*'],materials:['*']}}}));
 const next=await f.collaboration.post(f.human,command('next-authorized-round','group.post',{groupId:group.groupId,text:'Continue after source access is explicitly restored'}));
 await eventually(()=>f.store.read().groups[group.groupId].rounds[next.roundId].state==='complete');
 assert.equal(f.store.read().groups[group.groupId].messages.filter(row=>row.roundId===next.roundId).length,1);
 assert.equal(f.store.read().groups[group.groupId].messages.filter(row=>row.roundId===intent.roundId).length,0);
});

test('bot-created meeting action task retains its required meeting ACL after membership revocation',async t=>{
 const f=await collaborationFixture(t),coordinator=await f.bot('ReviewCoordinator'),member=await f.bot('ReviewActionOwner'),group=await f.group('ReviewActionACL',[coordinator,member]),meeting=await f.meeting(group);
 for(const phase of ['independent','discussion']){
  await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId][phase==='independent'?'opinions':'discussion']).length===2);
  await f.collaboration.advance(f.human,command('advance-'+phase,'meeting.advance',{meetingId:meeting.meetingId,epoch:1,phase}));
 }
 await eventually(()=>f.store.read().meetings[meeting.meetingId].decision);
 const contact=await f.contact(member),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
 assert.deepEqual(f.policy.readDependencies(actor),[]);
 const task=await f.service.dispatch(actor,command('meeting-action-without-snapshot','meeting.action',{meetingId:meeting.meetingId,epoch:1,botId:member.botId,title:'Action linked to protected meeting',goal:'Execute this meeting action',criteria:[]}));
 const dependencies=f.store.read().tasks[task.taskId].origins;
 const receipt=f.store.read().operations['meeting-action-without-snapshot'];
 const replay=await f.service.dispatch(actor,command('meeting-action-without-snapshot','meeting.action',{meetingId:meeting.meetingId,epoch:1,botId:member.botId,title:'Action linked to protected meeting',goal:'Execute this meeting action',criteria:[]}));
 assert.deepEqual(replay,task);assert.deepEqual(f.store.read().operations['meeting-action-without-snapshot'],receipt);
 await f.collaboration.changeMembers(f.human,command('remove-action-member','group.members',{groupId:group.groupId,expectedVersion:f.store.read().groups[group.groupId].version,botIds:[coordinator.botId],coordinatorBotId:coordinator.botId}));
 assert.equal(f.policy.canRead(actor,{kind:'meeting',id:meeting.meetingId}),false);
 const taskReadable=f.policy.canRead(actor,{kind:'task',id:task.taskId});
 const beforeRequests=f.requests.length;
 let start,code;try{start=await f.service.dispatch(actor,command('start-after-meeting-membership-revoked','task.start',{taskId:task.taskId,expectedVersion:task.version}));}catch(error){code=error.code;}
 if(start)await eventually(()=>!f.store.read().attempts[start.attemptId].reservationHeld);
 assert.ok(dependencies.some(ref=>ref.kind==='meeting'&&ref.id===meeting.meetingId),'meeting action creation must persist the meeting authorization it consumed');
 assert.equal(taskReadable,false);
 assert.equal(start,undefined);
 assert.equal(code,'access_denied');assert.equal(f.requests.length,beforeRequests);
 assert.deepEqual(f.store.read().operations['meeting-action-without-snapshot'],receipt);
});

test('human-authored linked action retains independent authorship and can be assigned outside the meeting',async t=>{
 const f=await collaborationFixture(t),member=await f.bot('HumanMeetingMember'),owner=await f.bot('IndependentOwner'),group=await f.group('HumanAction',[member]),meeting=await f.meeting(group);
 for(const phase of ['independent','discussion']){
  await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId][phase==='independent'?'opinions':'discussion']).length===1);
  await f.collaboration.advance(f.human,command('human-advance-'+phase,'meeting.advance',{meetingId:meeting.meetingId,epoch:1,phase}));
 }
 await eventually(()=>f.store.read().meetings[meeting.meetingId].decision);
 const task=await f.collaboration.actionTask(f.human,command('human-independent-action','meeting.action',{meetingId:meeting.meetingId,epoch:1,botId:owner.botId,title:'Human independently authored action',goal:'Perform this harmless goal',criteria:[]}));
 assert.deepEqual(task.origins,[]);assert.deepEqual(task.createdBy,{kind:'human'});
 const contact=await f.contact(owner),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
 assert.equal(f.policy.canRead(actor,{kind:'meeting',id:meeting.meetingId}),false);
 const attempt=await f.tasks.start(actor,command('human-independent-start','task.start',{taskId:task.taskId,expectedVersion:task.version}));
 await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
 assert.equal(f.store.read().attempts[attempt.attemptId].state,'returned');
 assert.ok(f.store.read().meetings[meeting.meetingId].actions.includes(task.taskId));
});
