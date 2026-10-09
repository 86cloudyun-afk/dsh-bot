import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture } from './task-fixture.mjs';
import { collaborationFixture } from './collaboration-fixture.mjs';
import { deferred, eventually, textChunks } from './official-fixture.mjs';

const command = (action, input, operationId = action) => ({action,input,operationId});
async function passed(f, bot, title = 'Prerequisite') {
  const task = await f.task(bot,title);
  const attempt = await f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},`start-${title}`));
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  const current=f.store.read().tasks[task.taskId];
  await f.tasks.accept(f.human,command('task.accept',{taskId:task.taskId,expectedVersion:current.version,attemptId:attempt.attemptId,outcome:'passed',evidence:'Verified actual result'},`accept-${title}`));
  return f.store.read().tasks[task.taskId];
}

test('template validates the complete team before one atomic creation and replays original IDs without native work',async t=>{
  const f=await collaborationFixture(t),{TemplateController}=await import('../../src/native/templates.mjs');
  const templates=new TemplateController(f),team=templates.list(f.human).find(row=>row.roles?.length===2);
  assert.ok(team);
  const roles=team.roles.map((row,index)=>({roleKey:row.roleKey,config:{name:`Role ${index}`,role:`Custom role ${index}`,cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}}));
  const make=()=>({...command('template.instantiate',{templateId:team.templateId,templateVersion:team.templateVersion,roles,group:{name:'Custom team'}},'instantiate'),expectedRevision:f.store.read().revision});
  const bad=make();bad.input.roles=structuredClone(roles);bad.input.roles[1].config.contact.model='missing';
  await assert.rejects(templates.instantiate(f.human,bad));
  assert.equal(Object.keys(f.store.read().bots).length,0);
  const request=make(),result=await templates.instantiate(f.human,request);
  assert.deepEqual(await templates.instantiate(f.human,request),result);
  assert.equal(Object.keys(f.store.read().bots).length,2);
  assert.equal(Object.keys(f.store.read().groups).length,1);
  assert.equal(Object.keys(f.store.read().sessions).length,0);
  assert.equal(Object.keys(f.store.read().grants).length,0);
  assert.equal(Object.keys(f.store.read().memories).length,0);
  assert.equal(f.requests.length,0);
  assert.equal(Object.keys(result.botIdsByRole).length,2);
});

test('cross Bot dependency cycles are atomic and blocked start reserves no slot or native model',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),one=await f.task(a,'One'),two=await f.task(b,'Two');
  await f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:one.taskId,expectedVersion:one.version,dependsOn:[two.taskId]},'one-deps'));
  await assert.rejects(f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:two.taskId,expectedVersion:two.version,dependsOn:[one.taskId]},'two-deps')),{code:'dependency_cycle'});
  const current=f.store.read().tasks[one.taskId];
  await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:one.taskId,expectedVersion:current.version})),{code:'dependency_blocked'});
  assert.equal(Object.keys(f.store.read().attempts).length,0);assert.equal(f.requests.length,0);
});

test('passed exact definition stores immutable actual prerequisite inputs, operation versions and cold settlement remain valid',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),upstream=await passed(f,a);
  const archived=await f.tasks.archive(f.human,command('task.archive',{taskId:upstream.taskId,expectedVersion:upstream.version}));
  const dependent=await f.tasks.create(f.human,command('task.create',{botId:a.botId,title:'Dependent',goal:'Read fixed prerequisite result',criteria:[],dependsOn:[upstream.taskId]},'dependent'));
  const resources=f.adapter.resources.bind(f.adapter);
  f.adapter.resources=id=>id===f.store.read().attempts[upstream.currentAttemptId].sessionId?{known:false,settled:false}:resources(id);
  const attempt=await f.tasks.start(f.human,command('task.start',{taskId:dependent.taskId,expectedVersion:dependent.version},'dependent-start'));
  const fixed=f.store.read().attempts[attempt.attemptId].prerequisiteInputs;
  assert.equal(fixed[0].taskId,upstream.taskId);assert.equal(fixed[0].version,archived.version);
  assert.equal(fixed[0].epoch,f.store.read().attempts[upstream.currentAttemptId].epoch);
  assert.ok(fixed[0].result.content.length);assert.equal(fixed[0].acceptanceEvidence.text,'Verified actual result');
  await f.tasks.adjust(f.human,command('task.adjust',{taskId:upstream.taskId,expectedVersion:archived.version,goal:'New upstream definition'},'upstream-adjust'));
  assert.deepEqual(f.store.read().attempts[attempt.attemptId].prerequisiteInputs,fixed);
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:dependent.taskId,expectedVersion:f.store.read().tasks[dependent.taskId].version},'dependent-again')),{code:'dependency_blocked'});
});

test('handoff preserves settled history and acceptance, and old adjust cannot move UNKNOWN work',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),task=await passed(f,a),before=f.store.read(),attempt=before.attempts[task.currentAttemptId];
  const request=command('task.handoff',{taskId:task.taskId,expectedVersion:task.version,toBotId:b.botId,note:'Continue with B'},'handoff');
  const result=await f.tasks.handoff(f.human,request);
  assert.deepEqual(await f.tasks.handoff(f.human,request),result);
  const after=f.store.read();assert.equal(result.botId,b.botId);assert.equal(result.version,task.version+1);assert.equal(result.definitionVersion,task.definitionVersion);
  assert.deepEqual(result.acceptanceEvidence,task.acceptanceEvidence);assert.deepEqual(after.attempts[attempt.attemptId],attempt);
  assert.deepEqual(result.createdBy,task.createdBy);assert.deepEqual(result.source,task.source);assert.equal(result.handoffs.length,1);
  await f.store.transact(command('seed',{},'unknown'),draft=>{draft.attempts[attempt.attemptId].state='UNKNOWN';draft.attempts[attempt.attemptId].reservationHeld=true;return null;});
  await assert.rejects(f.tasks.adjust(f.human,command('task.adjust',{taskId:task.taskId,expectedVersion:result.version,botId:a.botId,title:'Must not partially change'},'bypass')),{code:'attempt_unsettled'});
  assert.equal(f.store.read().tasks[task.taskId].title,task.title);
});

test('template rejects duplicate role, unknown config, invalid cwd/preset/parameters and stale CAS with zero partial records',async t=>{
  const f=await collaborationFixture(t),{TemplateController}=await import('../../src/native/templates.mjs'),templates=new TemplateController(f),team=templates.list(f.human).find(row=>row.roles?.length===2);
  const roles=team.roles.map((row,index)=>({roleKey:row.roleKey,config:{name:`Role ${index}`,cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}}));
  const variants=[rows=>rows[1].roleKey=rows[0].roleKey,rows=>rows[1].config.unknown=true,rows=>rows[1].config.cwd='/definitely-missing-directory',rows=>rows[1].config.presetId='missing-preset',rows=>rows[1].config.contact.parameters={unknown:1}];
  for(let i=0;i<variants.length;i++){
    const next=structuredClone(roles);variants[i](next);
    await assert.rejects(templates.instantiate(f.human,{...command('template.instantiate',{templateId:team.templateId,templateVersion:1,roles:next,group:{name:'Invalid'}},`bad-${i}`),expectedRevision:f.store.read().revision}), `variant ${i}`);
    assert.equal(Object.keys(f.store.read().bots).length,0);assert.equal(Object.keys(f.store.read().groups).length,0);
  }
  await assert.rejects(templates.instantiate(f.human,{...command('template.instantiate',{templateId:team.templateId,templateVersion:1,roles},'stale'),expectedRevision:999}),{code:'revision_conflict'});
  assert.equal(f.requests.length,0);
});

test('old acceptance, exact epoch mismatch and resource faults never unlock a dependency',async t=>{
  const f=await taskFixture(t),a=await f.bot(),upstream=await passed(f,a),task=await f.tasks.create(f.human,command('task.create',{botId:a.botId,title:'Dependent',goal:'Use proof',criteria:[],dependsOn:[upstream.taskId]},'dependent'));
  const saved=structuredClone(f.store.read().tasks[upstream.taskId].acceptanceEvidence),savedAttempt=structuredClone(f.store.read().attempts[upstream.currentAttemptId]);
  const variants=[(e,row)=>delete e.definitionDigest,(e,row)=>e.epoch++,(e,row)=>row.localEvidence.resourceFaults=[{error:'termination_unknown'}],(e,row)=>row.state='UNKNOWN'];
  for(let i=0;i<variants.length;i++) {
    await f.store.transact(command('seed',{},`seed-bad-${i}`),draft=>{draft.tasks[upstream.taskId].acceptanceEvidence=structuredClone(saved);draft.attempts[upstream.currentAttemptId]=structuredClone(savedAttempt);variants[i](draft.tasks[upstream.taskId].acceptanceEvidence,draft.attempts[upstream.currentAttemptId]);return null;});
    await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},`bad-start-${i}`)),{code:'dependency_blocked'});
  }
  assert.equal(Object.values(f.store.read().attempts).filter(row=>row.taskId===task.taskId).length,0);
});

test('dependency admission checks prospective owner result source ACL even for a human caller',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),upstream=await passed(f,a),task=await f.tasks.create(f.human,command('task.create',{botId:b.botId,title:'Dependent',goal:'Use A actual output',criteria:[],dependsOn:[upstream.taskId]},'dependent'));
  await f.policy.authorizeShare(f.human,command('share.set',{botId:a.botId,share:{enabled:true,receivers:['*'],scope:{tasks:['*'],sessions:[],memories:['*']}}},'hide-native-source'));
  const requests=f.requests.length;
  await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},'blocked-source')),{code:'access_denied'});
  assert.equal(f.requests.length,requests);assert.equal(Object.values(f.store.read().attempts).filter(row=>row.taskId===task.taskId).length,0);
});

test('handoff requires target control, rejects pending descendants/parent/outbox, and all failures leave definition intact',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),task=await passed(f,a),session=await f.sessions.create(f.human,command('session.create',{botId:a.botId},'owner-contact')),actor=f.policy.fromAgent(f.ctx.agents.get(session.sessionId));
  await assert.rejects(f.tasks.handoff(actor,command('task.handoff',{taskId:task.taskId,expectedVersion:task.version,toBotId:b.botId},'no-control')),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,command('grant.set',{grantId:'target-control',ownerBotId:b.botId,recipientBotId:a.botId,active:true,level:'control',scope:{tasks:[task.taskId]}},'target-grant'));
  const original=structuredClone(f.store.read().attempts[task.currentAttemptId]);
  const seed=async (id,mutate)=>f.store.transact(command('seed',{},id),draft=>{draft.attempts[task.currentAttemptId]=structuredClone(original);delete draft.attempts.related;delete draft.outbox.pending;mutate(draft);return null;});
  const variants=[draft=>draft.attempts.related={...original,attemptId:'related',taskId:'other',parentAttemptId:original.attemptId,state:'UNKNOWN',reservationHeld:true},draft=>{draft.attempts.related={...original,attemptId:'related',taskId:'other',state:'stop_requested',reservationHeld:true};draft.attempts[original.attemptId].parentAttemptId='related';},draft=>draft.outbox.pending={outboxId:'pending',taskId:task.taskId,state:'UNKNOWN'}];
  for(let i=0;i<variants.length;i++){
    await seed(`pending-${i}`,variants[i]);
    await assert.rejects(f.tasks.handoff(actor,command('task.handoff',{taskId:task.taskId,expectedVersion:task.version,toBotId:b.botId},`handoff-${i}`)),{code:i===2?'delivery_pending':'attempt_unsettled'});
    assert.equal(f.store.read().tasks[task.taskId].botId,a.botId);assert.equal(f.store.read().tasks[task.taskId].version,task.version);
  }
  await seed('clear-pending',()=>{});
  const result=await f.tasks.handoff(actor,command('task.handoff',{taskId:task.taskId,expectedVersion:task.version,toBotId:b.botId},'controlled-handoff'));
  assert.equal(result.botId,b.botId);assert.equal(result.handoffs[0].source.sessionId,actor.sessionId);
});

test('persisted settlement is insufficient while current known native resources remain active',async t=>{
  const f=await taskFixture(t),a=await f.bot(),upstream=await passed(f,a),task=await f.tasks.create(f.human,command('task.create',{botId:a.botId,title:'Dependent',goal:'Use proof',criteria:[],dependsOn:[upstream.taskId]},'dependent'));
  const resources=f.adapter.resources.bind(f.adapter),sourceSession=f.store.read().attempts[upstream.currentAttemptId].sessionId;
  f.adapter.resources=id=>id===sourceSession?{known:true,settled:false,models:1,tools:0,resourceFaults:[]}:resources(id);
  await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},'live-evidence')),{code:'dependency_blocked'});
  f.adapter.resources=resources;
});

test('unknown parent identity blocks handoff instead of assuming settlement from absence',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),task=await passed(f,a);
  await f.store.transact(command('seed',{},'missing-parent'),draft=>{draft.attempts[task.currentAttemptId].parentAttemptId='missing-parent-attempt';return null;});
  await assert.rejects(f.tasks.handoff(f.human,command('task.handoff',{taskId:task.taskId,expectedVersion:task.version,toBotId:b.botId},'handoff-missing-parent')),{code:'attempt_unsettled'});
});

test('three-node cycle and competing dependency edits preserve atomic CAS',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B'),c=await f.bot('C'),one=await f.task(a,'One'),two=await f.task(b,'Two'),three=await f.task(c,'Three');
  await f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:one.taskId,expectedVersion:1,dependsOn:[two.taskId]},'a-b'));
  await f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:two.taskId,expectedVersion:1,dependsOn:[three.taskId]},'b-c'));
  await assert.rejects(f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:three.taskId,expectedVersion:1,dependsOn:[one.taskId]},'c-a')),{code:'dependency_cycle'});
  await assert.rejects(f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:three.taskId,expectedVersion:1,dependsOn:[three.taskId]},'self')),{code:'dependency_cycle'});
  const outcomes=await Promise.allSettled([
    f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:three.taskId,expectedVersion:1,dependsOn:[]},'first-edit')),
    f.tasks.setDependencies(f.human,command('task.dependencies.set',{taskId:three.taskId,expectedVersion:1,dependsOn:[]},'stale-edit')),
  ]);
  assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].reason.code,'revision_conflict');assert.equal(f.store.read().tasks[three.taskId].version,2);
});

test('explicit acceptance renews a truly settled legacy attempt without inferring old acceptance',async t=>{
  const f=await taskFixture(t),a=await f.bot(),upstream=await passed(f,a),task=await f.tasks.create(f.human,command('task.create',{botId:a.botId,title:'Dependent',goal:'Use proof',criteria:[],dependsOn:[upstream.taskId]},'dependent'));
  await f.store.transact(command('seed',{},'legacy-evidence'),draft=>{
    delete draft.attempts[upstream.currentAttemptId].definitionDigest;
    for(const field of ['definitionDigest','definitionVersion','epoch'])delete draft.tasks[upstream.taskId].acceptanceEvidence[field];return null;
  });
  await assert.rejects(f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},'legacy-blocked')),{code:'dependency_blocked'});
  await f.tasks.accept(f.human,command('task.accept',{taskId:upstream.taskId,expectedVersion:upstream.version,attemptId:upstream.currentAttemptId,outcome:'passed',evidence:'Explicit renewed acceptance'},'renewed-acceptance'));
  const attempt=await f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},'renewed-start'));
  assert.equal(attempt.prerequisiteInputs[0].acceptanceEvidence.text,'Explicit renewed acceptance');
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
});


test('review: frozen input authorization survives unrelated private upstream definition edits',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());let f,b;
  f=await taskFixture(t,{stream:async function*(options){if(f.store.read().sessions[options.sessionId]?.botId===b?.botId)await gate.promise;yield*textChunks('Fixed actual output');}});
  const a=await f.bot('A');b=await f.bot('B');const upstream=await passed(f,a),originalSession=f.store.read().attempts[upstream.currentAttemptId].sessionId;
  await f.policy.authorizeShare(f.human,command('share.set',{botId:a.botId,share:{enabled:true,receivers:['*'],scope:{tasks:['*'],sessions:[originalSession],memories:['*']}}},'fixed-original-sharing'));
  const task=await f.tasks.create(f.human,command('task.create',{botId:b.botId,title:'Fixed downstream',goal:'Use only admitted upstream content',criteria:[],dependsOn:[upstream.taskId]},'fixed-dependent'));
  const attempt=await f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:task.version},'fixed-start'));
  const fixed=structuredClone(attempt.prerequisiteInputs),binding=f.store.read().sessions[attempt.sessionId],reference=binding.origins.find(row=>['task','taskInput'].includes(row.kind));
  const writer=await f.sessions.create(f.human,command('session.create',{botId:a.botId},'private-writer')),actor=f.policy.fromAgent(f.ctx.agents.get(writer.sessionId));
  await f.tasks.adjust(actor,command('task.adjust',{taskId:upstream.taskId,expectedVersion:upstream.version,goal:'An unrelated newly private definition'},'private-upstream-edit'));
  assert.equal(f.policy.canProspectiveBotRead({botId:b.botId,purpose:'execution'},{kind:'task',id:upstream.taskId}),false);
  assert.equal(f.policy.canProspectiveBotRead({botId:b.botId,purpose:'execution'},reference),true);
  assert.equal(reference.kind,'taskInput');assert.deepEqual(f.store.read().attempts[attempt.attemptId].prerequisiteInputs,fixed);
  const frozen=f.store.read().taskInputs[reference.id];assert.equal(frozen.attemptSessionId,originalSession);assert.deepEqual(frozen.source,upstream.source);
  gate.resolve();await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
});

test('review: human report provenance cannot bypass the original execution session for dependency or handoff',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('Canceled');}}),a=await f.bot('A'),b=await f.bot('B'),upstream=await f.task(a,'HumanReport');
  const attempt=await f.tasks.start(f.human,command('task.start',{taskId:upstream.taskId,expectedVersion:1},'report-start'));
  await f.tasks.submit(f.human,command('task.submit',{taskId:upstream.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch,report:'Protected original report'},'human-report'));
  await f.tasks.stop(f.human,command('task.stop',{taskId:upstream.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch},'report-stop'));gate.resolve();
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  const current=f.store.read().tasks[upstream.taskId];await f.tasks.accept(f.human,command('task.accept',{taskId:upstream.taskId,expectedVersion:current.version,attemptId:attempt.attemptId,outcome:'passed',evidence:'Verified saved report'},'report-accept'));
  await f.policy.authorizeShare(f.human,command('share.set',{botId:a.botId,share:{enabled:true,receivers:['*'],scope:{tasks:['*'],sessions:[],memories:['*']}}},'protect-report-session'));
  const task=await f.tasks.create(f.human,command('task.create',{botId:b.botId,title:'Report dependent',goal:'Use protected report',criteria:[],dependsOn:[upstream.taskId]},'report-dependent'));
  const outcomes=await Promise.allSettled([
    f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:1},'report-dependent-start')),
    f.tasks.handoff(f.human,command('task.handoff',{taskId:upstream.taskId,expectedVersion:f.store.read().tasks[upstream.taskId].version,toBotId:b.botId},'report-handoff')),
  ]);
  assert.deepEqual(outcomes.map(row=>row.status),['rejected','rejected']);
  assert.ok(outcomes.every(row=>row.reason.code==='access_denied'));
  assert.equal(Object.values(f.store.read().attempts).filter(row=>row.taskId===task.taskId).length,0);
});

test('review: replayed start through service denies nested fixed input after original source revocation without relaunch',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());let f,b;
  f=await taskFixture(t,{stream:async function*(options){if(f.store.read().sessions[options.sessionId]?.botId===b?.botId)await gate.promise;yield*textChunks('Restricted upstream output');}});
  const a=await f.bot('A');b=await f.bot('B');const upstream=await passed(f,a),contact=await f.sessions.create(f.human,command('session.create',{botId:b.botId},'replay-caller')),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const task=await f.tasks.create(f.human,command('task.create',{botId:b.botId,title:'Replay dependent',goal:'Use upstream result',criteria:[],dependsOn:[upstream.taskId]},'replay-dependent'));
  const request=command('task.start',{taskId:task.taskId,expectedVersion:1},'replay-fixed-start'),attempt=await f.service.dispatch(actor,request);
  await f.policy.authorizeShare(f.human,command('share.set',{botId:a.botId,share:{enabled:true,receivers:['*'],scope:{tasks:['*'],sessions:[],memories:['*']}}},'replay-revoke-source'));
  const count=f.requests.length;await assert.rejects(f.service.dispatch(actor,request),{code:'access_denied'});
  assert.equal(f.requests.length,count);assert.equal(f.store.read().tasks[task.taskId].currentAttemptId,attempt.attemptId);assert.equal(Object.values(f.store.read().attempts).filter(row=>row.taskId===task.taskId).length,1);
  gate.resolve();
});

test('review: later admissions reuse the immutable snapshot while retaining their newly observed task version',async t=>{
  const f=await taskFixture(t),a=await f.bot(),upstream=await passed(f,a),task=await f.tasks.create(f.human,command('task.create',{botId:a.botId,title:'Repeat fixed input',goal:'Use accepted output',criteria:[],dependsOn:[upstream.taskId]},'repeat-dependent'));
  const first=await f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:1},'repeat-first'));await eventually(()=>!f.store.read().attempts[first.attemptId].reservationHeld);
  const saved=structuredClone(f.store.read().taskInputs[first.prerequisiteInputs[0].inputId]);
  const archived=await f.tasks.archive(f.human,command('task.archive',{taskId:upstream.taskId,expectedVersion:upstream.version},'archive-after-input'));
  const second=await f.tasks.start(f.human,command('task.start',{taskId:task.taskId,expectedVersion:f.store.read().tasks[task.taskId].version},'repeat-second'));
  assert.equal(second.prerequisiteInputs[0].inputId,first.prerequisiteInputs[0].inputId);assert.equal(second.prerequisiteInputs[0].version,archived.version);
  assert.deepEqual(f.store.read().taskInputs[saved.inputId],saved);assert.equal(Object.keys(f.store.read().taskInputs).length,1);
  await eventually(()=>!f.store.read().attempts[second.attemptId].reservationHeld);
});
