import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantController} from '../../src/native/assistant.mjs';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {businessFixture} from './business-fixture.mjs';
import {taskFixture} from './task-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
const once={kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:01'};

async function reminderFixture(t) {
  const f=await businessFixture(t),bot=await f.bot(),session=await f.sessions.create(f.human,command('contact','session.create',{botId:bot.botId}));
  let now=Date.parse('2026-10-09T00:00:00Z'),timerId=0,store=f.store,policy=f.policy,human=f.human,assistant;
  const timers=new Map(),clock={now:()=>now,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const tasks={async createScheduled(){assert.fail('reminders cannot create native work');},async startScheduled(){assert.fail('reminders cannot start native work');}};
  const makeAssistant=()=>new AssistantController({store,policy,adapter:f.adapter,tasks,clock});assistant=makeAssistant();
  f.beforeClose.push(async()=>{await assistant.close();if(store!==f.store)await store.close();});
  return {...f,bot,session,timers,clock,
    get assistant(){return assistant;},get store(){return store;},get human(){return human;},get policy(){return policy;},
    setNow(value){now=Date.parse(value);},
    create(input={},id='create'){return assistant.createSchedule(human,command(id,'schedule.create',{ownerBotId:bot.botId,kind:'reminder',message:'Original reminder',rule:once,...input}));},
    update(schedule,input={},id='edit'){return assistant.updateSchedule(human,command(id,'schedule.update',{scheduleId:schedule.scheduleId,expectedVersion:schedule.version,...input}));},
    state(schedule,enabled,id=enabled?'enable':'pause'){return assistant.setScheduleState(human,command(id,enabled?'schedule.enable':'schedule.pause',{scheduleId:schedule.scheduleId,expectedVersion:schedule.version,enabled}));},
    async restart(){
      await assistant.close();await store.close();store=await PluginStore.open(f.ctx.storage.backend.get('json').kv);
      const operator={};policy=new PermissionPolicy(store,{agents:f.ctx.agents,operatorPeer:operator});human=policy.fromPeer(operator);assistant=makeAssistant();await assistant.start();
    },
  };
}

for(const action of ['stop','adjust'])test(`parent ${action} synchronizes the held forest task, attempt, session and assistant briefing`,async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('Controlled original response');}}),bot=await f.bot();
  const parent=await f.task(bot,'ContinuityParent'),child=await f.task(bot,'ContinuityChild');
  const root=await f.tasks.start(f.human,command('parent-start','task.start',{taskId:parent.taskId,expectedVersion:parent.version}));
  const leaf=await f.tasks.start(f.human,command('child-start','task.start',{taskId:child.taskId,expectedVersion:child.version,parentAttemptId:root.attemptId}));
  const assistant=new AssistantController({...f,tasks:f.tasks});f.beforeClose.unshift(()=>assistant.close());
  await eventually(()=>f.requests.length===2);
  const request=command('change-parent',`task.${action}`,action==='stop'?{taskId:parent.taskId,attemptId:root.attemptId,epoch:root.epoch}:{taskId:parent.taskId,expectedVersion:f.store.read().tasks[parent.taskId].version,goal:'Use the replacement goal'});
  await f.tasks[action](f.human,request);
  const state=f.store.read(),briefing=assistant.briefing(f.human),stop=action==='stop'?state.operations[request.operationId].result:state.operations[state.tasks[parent.taskId].adjustStop.stopOperationId].result;
  assert.deepEqual(stop.attemptIds,[root.attemptId,leaf.attemptId]);
  assert.equal(Object.values(state.attempts).filter(a=>a.reservationHeld).length,2);
  assert.equal(briefing.tasks.filter(row=>row.state==='stopping').length,2);
  for(const original of [root,leaf]){
    const attempt=state.attempts[original.attemptId],task=state.tasks[original.taskId],brief=briefing.tasks.find(row=>row.taskId===task.taskId);
    assert.equal(task.state,'stopping');assert.equal(task.currentAttemptId,original.attemptId);assert.equal(attempt.state,'stop_requested');assert.equal(attempt.epoch,original.epoch);assert.equal(attempt.reservationHeld,true);
    assert.equal(state.sessions[original.sessionId].state,'stopping');assert.equal(attempt.stopOperationId,stop.operationId);
    assert.equal(brief.state,task.state);assert.equal(brief.attemptId,original.attemptId);assert.equal(brief.attemptState,attempt.state);
    assert.equal(f.adapter.resources(original.sessionId).settled,false);
  }
  assert.ok(f.requests.every(row=>row.signal.aborted));
  gate.resolve();await eventually(()=>[root,leaf].every(row=>!f.store.read().attempts[row.attemptId].reservationHeld));
  assert.equal(Object.values(f.store.read().attempts).filter(a=>a.reservationHeld).length,0);
  for(const original of [root,leaf]){
    const attempt=f.store.read().attempts[original.attemptId];assert.equal(attempt.state,'stopped');assert.equal(attempt.localEvidence.settled,true);assert.equal(f.adapter.resources(original.sessionId).settled,true);
    assert.equal(f.store.read().tasks[original.taskId].state,'stopped');
  }
  assert.equal(f.requests.length,2);
});

test('paused overdue once reminder keeps its original cursor through text editing, enabling and durable restart exactly once',async t=>{
  const f=await reminderFixture(t),original=await f.create();await f.assistant.start();
  const paused=await f.state(original,false);assert.equal(f.timers.size,0);
  f.setNow('2026-10-09T00:05:00Z');
  const edited=await f.update(paused,{message:'Edited late reminder'});
  assert.equal(edited.nextDueAt,original.nextDueAt);assert.equal(edited.nextTriggerKey,original.nextTriggerKey);
  const enabled=await f.state(edited,true);assert.equal(enabled.nextDueAt,original.nextDueAt);
  await f.restart();await Promise.all([f.assistant.runDue(),f.assistant.runDue({recovery:true})]);
  const state=f.store.read(),notices=Object.values(state.notices),occurrences=Object.values(state.occurrences);
  assert.equal(notices.length,1);assert.equal(occurrences.length,1);assert.equal(notices[0].kind,'reminder');assert.equal(notices[0].message,'Edited late reminder');
  assert.equal(notices[0].late,true);assert.equal(notices[0].dueAt,original.nextDueAt);assert.equal(occurrences[0].triggerKey,original.nextTriggerKey);assert.equal(occurrences[0].state,'settled');
  assert.equal(state.schedules[original.scheduleId].nextDueAt,null);assert.equal(state.schedules[original.scheduleId].nextTriggerKey,null);
  const saved={notices:state.notices,occurrences:state.occurrences};await f.restart();assert.deepEqual(f.store.read().notices,saved.notices);assert.deepEqual(f.store.read().occurrences,saved.occurrences);
  assert.equal(f.requests.length,0);assert.equal(Object.keys(f.store.read().tasks).length,0);assert.equal(f.timers.size,0);
});

const cursorCases=[
  {name:'once',rule:once,equivalent:{type:'once',timeZone:'UTC',localDate:'2026-10-09',localTime:'00:01'}},
  {name:'interval',rule:{kind:'interval',timezone:'UTC',anchorAt:'2026-10-09T00:01:00Z',everyMinutes:15},equivalent:{type:'interval',timeZone:'UTC',startAt:'2026-10-09T01:01:00+01:00',intervalMinutes:15}},
  {name:'daily',rule:{kind:'daily',timezone:'UTC',time:'00:01',startDate:'2026-10-09'},equivalent:{type:'daily',timeZone:'UTC',localTime:'00:01',startDate:'2026-10-09'}},
  {name:'weekly',rule:{kind:'weekly',timezone:'UTC',time:'00:01',weekdays:[5,1]},equivalent:{type:'weekly',timeZone:'UTC',localTime:'00:01',weekdays:[1,5,1]}},
];
for(const {name,rule,equivalent} of cursorCases)test(`${name} reminder normalized-equivalent rule preserves overdue cursor across content, enabled and missed policy edits`,async t=>{
  const f=await reminderFixture(t),original=await f.create({rule});
  let current=await f.state(original,false);f.setNow('2026-10-09T00:35:00Z');
  for(const [id,input] of [['text',{message:'New text'}],['missed',{missedPolicy:'latest'}],['enabled',{enabled:true}],['normalized',{rule:equivalent}]]){
    current=await f.update(current,input,id);
    assert.equal(current.nextDueAt,original.nextDueAt);assert.equal(current.nextTriggerKey,original.nextTriggerKey);assert.deepEqual(current.rule,original.rule);
  }
  await f.restart();
  const notices=Object.values(f.store.read().notices),first=notices.find(n=>n.dueAt===original.nextDueAt);
  assert.equal(notices.length,1);
  assert.ok(first);assert.equal(first.late,true);assert.equal(first.message,'New text');assert.equal(f.requests.length,0);
  const count=notices.length;await f.assistant.runDue({recovery:true});await f.restart();assert.equal(Object.keys(f.store.read().notices).length,count);
});

test('already triggered once reminder preserves null cursor through edits, clock rewind and restart',async t=>{
  const f=await reminderFixture(t),original=await f.create();f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();
  const saved={notices:f.store.read().notices,occurrences:f.store.read().occurrences};
  f.setNow('2026-10-09T00:00:00Z');
  const updated=await f.update(f.store.read().schedules[original.scheduleId],{message:'After firing',rule:{type:'once',timeZone:'UTC',localDate:'2026-10-09',localTime:'00:01'}});
  assert.equal(updated.nextDueAt,null);assert.equal(updated.nextTriggerKey,null);
  await f.restart();f.setNow('2026-10-09T00:05:00Z');await f.assistant.runDue();await f.restart();
  assert.deepEqual(f.store.read().notices,saved.notices);assert.deepEqual(f.store.read().occurrences,saved.occurrences);assert.equal(f.requests.length,0);
});

test('interval reminder edit preserves the next untriggered cycle without repeating its settled first cycle',async t=>{
  const f=await reminderFixture(t),original=await f.create({rule:cursorCases[1].rule});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();
  const first=Object.values(f.store.read().occurrences)[0],afterFirst=f.store.read().schedules[original.scheduleId];
  assert.equal(afterFirst.nextDueAt,'2026-10-09T00:16:00.000Z');
  f.setNow('2026-10-09T00:20:00Z');const updated=await f.update(afterFirst,{message:'Second cycle text'});
  assert.equal(updated.nextDueAt,afterFirst.nextDueAt);assert.equal(updated.nextTriggerKey,afterFirst.nextTriggerKey);
  await f.restart();await f.assistant.runDue({recovery:true});
  const state=f.store.read(),notices=Object.values(state.notices),cycles=Object.values(state.occurrences);
  assert.equal(cycles.length,2);assert.equal(notices.length,2);assert.deepEqual(state.occurrences[first.occurrenceId],first);
  assert.equal(notices.filter(n=>n.dueAt===first.dueAt).length,1);
  const second=notices.find(n=>n.dueAt===afterFirst.nextDueAt);assert.ok(second);assert.equal(second.late,true);assert.equal(second.message,'Second cycle text');
  assert.equal(state.schedules[original.scheduleId].nextDueAt,'2026-10-09T00:31:00.000Z');assert.equal(f.requests.length,0);
});

for(const change of ['time','timezone','version','rule-kind'])test(`reminder ${change} rule change calculates a new cursor`,async t=>{
  const f=await reminderFixture(t),original=await f.create();f.setNow('2026-10-09T00:05:00Z');
  const rule=change==='time'?{...once,time:'00:10'}:change==='timezone'?{...once,timezone:'Asia/Shanghai'}:change==='version'?{...once,version:2}:{kind:'interval',timezone:'UTC',anchorAt:'2026-10-09T00:01:00Z',everyMinutes:15};
  const updated=await f.update(original,{rule});
  assert.equal(updated.nextDueAt,change==='time'?'2026-10-09T00:10:00.000Z':change==='rule-kind'?'2026-10-09T00:16:00.000Z':null);
  assert.equal(updated.nextTriggerKey,change==='time'?'local:2026-10-09':change==='rule-kind'?'utc:2026-10-09T00:16:00.000Z':null);
  await f.restart();assert.equal(Object.keys(f.store.read().notices).length,0);assert.equal(f.requests.length,0);
});

for(const initialKind of ['reminder','task'])test(`${initialKind} schedule type switch calculates a new cursor and keeps task consent explicit`,async t=>{
  const f=await reminderFixture(t),recipe={botId:f.bot.botId,title:'Scheduled work',goal:'One response',criteria:[],originSessionId:f.session.sessionId};
  const original=await f.create({kind:initialKind,...(initialKind==='task'?{recipe}:{})});f.setNow('2026-10-09T00:05:00Z');
  const updated=await f.update(original,{kind:initialKind==='reminder'?'task':'reminder',recipe,message:'Switched reminder'});
  assert.equal(updated.nextDueAt,null);assert.equal(updated.nextTriggerKey,null);assert.equal(updated.consentVersion,original.consentVersion+1);
  if(initialKind==='reminder'){
    assert.equal(updated.executionConsent.operationId,'edit');assert.equal(updated.executionConsent.consentVersion,updated.consentVersion);assert.deepEqual(updated.executionConsent.actions,['task.create','task.start']);
  }else{assert.equal(updated.executionConsent,null);assert.equal(updated.recipe,undefined);}
  await f.restart();assert.equal(Object.keys(f.store.read().occurrences).length,0);assert.equal(f.requests.length,0);
});

test('unchanged task rule still recomputes its cursor and updates consent rather than inheriting reminder recovery',async t=>{
  const f=await reminderFixture(t),original=await f.create({kind:'task',recipe:{botId:f.bot.botId,title:'Consented work',goal:'Original goal',criteria:[],originSessionId:f.session.sessionId}});
  f.setNow('2026-10-09T00:05:00Z');
  const updated=await f.update(original,{recipe:{...original.recipe,goal:'Replacement goal'}});
  assert.equal(updated.nextDueAt,null);assert.equal(updated.nextTriggerKey,null);assert.equal(updated.consentVersion,2);assert.equal(updated.executionConsent.operationId,'edit');
  assert.notEqual(updated.executionConsent.recipeHash,original.executionConsent.recipeHash);
  assert.deepEqual(f.store.read().operations.create.result.executionConsent,original.executionConsent);
  await f.restart();assert.equal(Object.keys(f.store.read().tasks).length,0);assert.equal(f.requests.length,0);
});

test('parent stop leaves a settled child and its later independent attempt unchanged',async t=>{
  const parentGate=deferred(),laterGate=deferred();t.after(()=>{parentGate.resolve();laterGate.resolve();});
  const f=await taskFixture(t,{stream:async function*(options,n){
    if(JSON.stringify(options.messages).includes('执行任务 HistoricalParent'))await parentGate.promise;
    else if(n===3)await laterGate.promise;
    yield*textChunks('Controlled response');
  }}),bot=await f.bot(),parent=await f.task(bot,'HistoricalParent'),child=await f.task(bot,'HistoricalChild');
  const root=await f.tasks.start(f.human,command('parent-start','task.start',{taskId:parent.taskId,expectedVersion:parent.version}));
  await eventually(()=>f.requests.length===1);
  const old=await f.tasks.start(f.human,command('old-child-start','task.start',{taskId:child.taskId,expectedVersion:child.version,parentAttemptId:root.attemptId}));
  await eventually(()=>!f.store.read().attempts[old.attemptId].reservationHeld);
  const settled=f.store.read().attempts[old.attemptId],settledSession=f.store.read().sessions[old.sessionId];
  const later=await f.tasks.start(f.human,command('later-child-start','task.start',{taskId:child.taskId,expectedVersion:f.store.read().tasks[child.taskId].version}));
  await eventually(()=>f.requests.length===3);
  const before=f.store.read(),receipt=await f.tasks.stop(f.human,command('stop-parent','task.stop',{taskId:parent.taskId,attemptId:root.attemptId,epoch:root.epoch}));
  assert.deepEqual(receipt.attemptIds,[root.attemptId]);assert.equal(Object.values(f.store.read().attempts).filter(a=>a.reservationHeld).length,2);
  assert.deepEqual(f.store.read().attempts[old.attemptId],settled);assert.deepEqual(f.store.read().sessions[old.sessionId],settledSession);
  assert.deepEqual(f.store.read().attempts[later.attemptId],before.attempts[later.attemptId]);assert.deepEqual(f.store.read().tasks[child.taskId],before.tasks[child.taskId]);
  assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests[2].signal.aborted,false);
  const assistant=new AssistantController({...f,tasks:f.tasks});f.beforeClose.unshift(()=>assistant.close());
  assert.equal(assistant.briefing(f.human).tasks.filter(row=>row.state==='stopping').length,1);
  parentGate.resolve();await eventually(()=>!f.store.read().attempts[root.attemptId].reservationHeld);
  assert.equal(f.store.read().attempts[later.attemptId].reservationHeld,true);assert.equal(f.store.read().tasks[child.taskId].state,'running');
  laterGate.resolve();await eventually(()=>!f.store.read().attempts[later.attemptId].reservationHeld);assert.equal(f.requests.length,3);
});

test('stopping a recovered held old child fences its original resources without changing a superseding current task',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('Controlled response');}}),bot=await f.bot(),parent=await f.task(bot,'SupersededParent'),child=await f.task(bot,'SupersededChild');
  const root=await f.tasks.start(f.human,command('parent-start','task.start',{taskId:parent.taskId,expectedVersion:parent.version}));
  const old=await f.tasks.start(f.human,command('child-start','task.start',{taskId:child.taskId,expectedVersion:child.version,parentAttemptId:root.attemptId}));
  await eventually(()=>f.requests.length===2);
  // A restored ledger can retain an older held attempt while its task points to a later settled attempt.
  await f.store.transact(command('restored-later-attempt','fixture.recovered',{}),draft=>{
    const laterId='later-restored-attempt';draft.attempts[laterId]={attemptId:laterId,taskId:child.taskId,botId:bot.botId,epoch:old.epoch+1,state:'returned',reservationHeld:false};
    draft.tasks[child.taskId].currentAttemptId=laterId;draft.tasks[child.taskId].state='awaiting_acceptance';draft.tasks[child.taskId].epoch=old.epoch+1;return true;
  });
  const before=f.store.read(),request=command('stop-parent','task.stop',{taskId:parent.taskId,attemptId:root.attemptId,epoch:root.epoch});
  const receipt=await f.tasks.stop(f.human,request);
  assert.deepEqual(receipt.attemptIds,[root.attemptId,old.attemptId]);assert.deepEqual(f.store.read().tasks[child.taskId],before.tasks[child.taskId]);assert.deepEqual(f.store.read().attempts['later-restored-attempt'],before.attempts['later-restored-attempt']);
  assert.equal(f.store.read().attempts[old.attemptId].state,'stop_requested');assert.equal(f.store.read().attempts[old.attemptId].reservationHeld,true);assert.equal(f.store.read().sessions[old.sessionId].state,'stopping');
  const assistant=new AssistantController({...f,tasks:f.tasks});f.beforeClose.unshift(()=>assistant.close());
  const brief=assistant.briefing(f.human);assert.equal(brief.tasks.filter(row=>row.state==='stopping').length,1);assert.equal(brief.tasks.find(row=>row.taskId===child.taskId).attemptId,'later-restored-attempt');
  gate.resolve();await eventually(()=>[root,old].every(a=>!f.store.read().attempts[a.attemptId].reservationHeld));
  assert.deepEqual(f.store.read().tasks[child.taskId],before.tasks[child.taskId]);assert.deepEqual(f.store.read().attempts['later-restored-attempt'],before.attempts['later-restored-attempt']);assert.equal(f.requests.length,2);
});

test('old parent stop receipt replay and stale stop cannot change or cancel its new attempt',async t=>{
  const gate=deferred(),laterGate=deferred();t.after(()=>{gate.resolve();laterGate.resolve();});
  const f=await taskFixture(t,{stream:async function*(_options,n){await (n===1?gate.promise:laterGate.promise);yield*textChunks('Controlled response');}}),bot=await f.bot(),parent=await f.task(bot,'ReplayParent');
  const old=await f.tasks.start(f.human,command('old-start','task.start',{taskId:parent.taskId,expectedVersion:parent.version}));await eventually(()=>f.requests.length===1);
  const request=command('original-stop','task.stop',{taskId:parent.taskId,attemptId:old.attemptId,epoch:old.epoch}),receipt=await f.tasks.stop(f.human,request);
  gate.resolve();await eventually(()=>!f.store.read().attempts[old.attemptId].reservationHeld);
  const later=await f.tasks.start(f.human,command('new-start','task.start',{taskId:parent.taskId,expectedVersion:f.store.read().tasks[parent.taskId].version}));
  await eventually(()=>f.requests.length===2);const before=f.store.read();
  assert.deepEqual(await f.tasks.stop(f.human,request),receipt);
  await assert.rejects(f.tasks.stop(f.human,command('stale-stop','task.stop',request.input)),{code:'stale_attempt'});
  assert.deepEqual(f.store.read().tasks[parent.taskId],before.tasks[parent.taskId]);assert.deepEqual(f.store.read().attempts[later.attemptId],before.attempts[later.attemptId]);assert.equal(f.requests[1].signal.aborted,false);
  laterGate.resolve();await eventually(()=>!f.store.read().attempts[later.attemptId].reservationHeld);
});
