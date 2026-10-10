import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import {businessFixture} from './business-fixture.mjs';
import {taskFixture} from './task-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});

test('session pages include a completed native turn before the persistence batch deadline',async t=>{
  const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,command('session.create',{botId:bot.botId}));
  const agent=f.ctx.agents.get(row.sessionId),message=createUserMessage({content:[{type:'text',text:'Completed native page marker'}],source:{kind:'v113-runtime-test'}});
  agent.followup(message);await agent.whenIdle();
  assert.ok(f.events.get(row.sessionId).some(event=>event.type==='turn/end'));
  const page=await f.sessions.page(f.human,{sessionId:row.sessionId,limit:500});
  assert.ok(page.events.some(event=>event.type==='user/message'&&event.data.id===message.id),'fresh native user message must be available');
  assert.ok(page.events.some(event=>event.type==='assistant/message'),'fresh native reply must be available');
  assert.ok(page.events.some(event=>event.type==='turn/end'),'completed native turn must be available');
  assert.equal(page.original,true);assert.equal(page.nextCursor,null);assert.equal(f.requests.length,1);
});

test('managed child persists its admitted cwd and preset with native delegation lineage',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('Controlled child configuration reply');}});
  await f.ctx.plugin(AgentPresets,{default:'alpha'}).await();
  await f.ctx.agentPresets.register({id:'alpha',plugins:[]});await f.ctx.agentPresets.register({id:'beta',plugins:[]});
  const bot=await f.bot('ChildConfiguration'),parent=await f.task(bot,'ParentConfiguration');
  const root=await f.tasks.start(f.human,command('task.start',{taskId:parent.taskId,expectedVersion:1}));
  await eventually(()=>f.requests.length===1);
  const cwd=`${f.dir}/child-default`;await mkdir(cwd);
  const updated=await f.bots.update(f.human,command('bot.update',{botId:bot.botId,expectedVersion:bot.revision,cwd,presetId:'beta'}));
  const child=await f.task(updated,'ChildConfiguration'),attempt=await f.tasks.start(f.human,command('task.start',{taskId:child.taskId,expectedVersion:1,parentAttemptId:root.attemptId}));
  await eventually(()=>f.requests.length===2);
  const binding=f.store.read().sessions[attempt.sessionId],agent=f.ctx.agents.get(attempt.sessionId),native=await f.adapter.inspectSession(attempt.sessionId);
  assert.equal(native.header.cwd,binding.cwd);assert.equal(native.header.agentPreset,binding.presetId);assert.equal(native.presetId,binding.presetId);
  assert.equal(f.ctx.sessionProjections.stateOf(agent.session,'agentPreset'),binding.presetId);
  assert.equal(f.ctx.agentPresets.composedPreset(agent.ctx),binding.presetId);
  assert.equal(native.header.parentSession,root.sessionId);assert.equal(native.header.delegationDepth,1);assert.equal(native.header.origin,'subagent');
  assert.ok(native.events.some(event=>event.type==='subagent/descriptor'&&event.data.mode==='one-shot'));
  assert.ok((await f.ctx.subagents.listChildren(root.sessionId,new AbortController().signal)).some(row=>row.id===attempt.sessionId&&row.mode==='one-shot'));
  gate.resolve();await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  await f.tasks.close();await f.adapter.close();
  const cold=await f.adapter.readNative(attempt.sessionId);
  const restored=await f.ctx.agents.resume({resumeSessionId:attempt.sessionId,agentOptions:{provider:'controlled',model:'model-b'},setup:async ctx=>{await f.ctx.agentPresets.mount(ctx,f.adapter.effectivePresetAt(cold));}});
  t.after(()=>restored.dispose());
  assert.equal(restored.agent.session.header.cwd,binding.cwd);
  assert.equal(f.ctx.sessionProjections.stateOf(restored.agent.session,'agentPreset'),binding.presetId);
  assert.equal(f.ctx.agentPresets.composedPreset(restored.agent.ctx),binding.presetId);assert.equal(f.requests.length,2);
});
