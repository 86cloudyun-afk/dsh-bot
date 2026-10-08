import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {deferred,eventually} from './official-fixture.mjs';

async function serviceFixture(t,options={}) {
  const f=await businessFixture(t,options);
  const module=await import('../../src/native/service.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native Bot service is missing');throw error;});
  const service=new module.BotService(f);f.adapter.setService(service);return {...f,service};
}
test('native scoped tools derive the caller from the actual execution Agent',async t=>{
  const f=await serviceFixture(t),a=await f.bot(),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  assert.ok(f.ctx.tools.get('dsh_bot',agent));assert.equal(f.ctx.tools.get('dsh_bot'),undefined);
  const result=await f.ctx.tools.execute({callId:'real',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{action:'snapshot',input:{}}});
  assert.equal(result.isError,false);assert.equal(result.value.bots[0].botId,a.botId);
  const denied=await f.ctx.tools.execute({callId:'spoof',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{operationId:'spoof',action:'bot.create',input:{name:'Forged',actor:'human'}}});
  assert.equal(denied.isError,true);assert.equal(Object.keys(f.store.read().bots).length,1);
});
test('final native stream rejects a changed model after request policy',async t=>{
  const f=await serviceFixture(t);
  f.ctx.on('agent/request',async(_payload,next)=>({...await next(),model:'model-b'}),{global:true});
  const a=await f.bot(),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Do not change the model.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(agent.id)?.some(e=>e.type==='turn/end'));
  assert.equal(f.requests.length,0);
  assert.match(JSON.stringify(f.events.get(agent.id)),/model_drift/);
});
test('a native cold resume rebinds Bot policy before releasing any input',async t=>{
  const f=await serviceFixture(t),a=await f.bot(),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}});
  await f.adapter.disposeOwned(channel.sessionId);
  const resumed=await f.ctx.agents.resume({resumeSessionId:channel.sessionId,agentOptions:{provider:'controlled',model:'model-c'}});
  t.after(()=>resumed.dispose());assert.ok(f.ctx.tools.get('dsh_bot',resumed.agent));
  resumed.agent.followup(createUserMessage({content:[{type:'text',text:'Use the Bot configuration.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(channel.sessionId)?.some(e=>e.type==='turn/end'));
  assert.equal(f.requests.length,1,JSON.stringify(f.events.get(channel.sessionId)));assert.equal(f.requests[0].model,'model-a');
});
test('a revoked queued mutation rechecks the actual grant at business commit',async t=>{
  const f=await serviceFixture(t),a=await f.bot('A'),b=await f.bot('B'),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  const grant={grantId:'g',ownerBotId:b.botId,recipientBotId:a.botId,level:'control',scope:{sessions:['*']},active:true};
  await f.policy.authorizeShare(f.human,{operationId:'grant',action:'grant.set',input:grant});
  const gate=deferred(),entered=deferred();
  const unhook=agent.ctx.on('tools/execute',async(_exec,next)=>{entered.resolve();await gate.promise;return next();});t.after(unhook);
  const pending=f.ctx.tools.execute({callId:'queued',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{operationId:'foreign-create',action:'session.create',input:{botId:b.botId}}});
  await entered.promise;await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'grant.set',input:{...grant,active:false}});gate.resolve();
  assert.equal((await pending).isError,true);assert.equal(Object.keys(f.store.read().sessions).length,1);
});
test('disposing the plugin adapter removes scoped tools from native-owned resumed Agents',async t=>{
  const f=await serviceFixture(t),a=await f.bot(),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}});
  await f.adapter.disposeOwned(channel.sessionId);const handle=await f.ctx.agents.resume({resumeSessionId:channel.sessionId});t.after(()=>handle.dispose());
  assert.ok(f.ctx.tools.get('dsh_bot',handle.agent));await f.adapter.close();assert.equal(f.ctx.tools.get('dsh_bot',handle.agent),undefined);
});

test('configured sampling values reach the frozen final stream and native request log',async t=>{
  const f=await serviceFixture(t),a=await f.bots.create(f.human,{operationId:'config',action:'bot.create',input:{name:'Sampling',cwd:f.dir,contact:{provider:'controlled',model:'model-a',maxTokens:80,temperature:0.25}}});
  const channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'One reply.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(channel.sessionId)?.some(e=>e.type==='turn/end'));
  assert.equal(f.requests.length,1,JSON.stringify(f.events.get(channel.sessionId)));assert.equal(f.requests[0].temperature,0.25);assert.equal(f.requests[0].maxTokens,80);
});
test('revocation fences the next model call even when old shared tool results remain in native history',async t=>{
  const f=await serviceFixture(t),a=await f.bot('A'),b=await f.bot('B');
  await f.bots.memoryWrite(f.human,{operationId:'shared',action:'memory.write',input:{botId:b.botId,text:'Shared fact'}});
  const channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  const read=await f.ctx.tools.execute({callId:'read',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{action:'memory.search',input:{botId:b.botId}}});assert.equal(read.isError,false);
  assert.ok(f.store.read().sessions[channel.sessionId].origins.length);
  await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'share.set',input:{botId:b.botId,share:{enabled:false,receivers:['*'],scope:{memories:['*'],sessions:['*'],tasks:['*']}}}});
  agent.followup(createUserMessage({content:[{type:'text',text:'Reveal the old shared fact.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(channel.sessionId)?.some(e=>e.type==='turn/end'));assert.equal(f.requests.length,0);
});
test('Bot capability limits do not remove native tools from ordinary sessions',async t=>{
  const f=await serviceFixture(t),a=await f.bot();let bodies=0;
  const unregister=f.ctx.tools.register({name:'probe_tool',description:'Harmless test probe',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'ok'}]},async execute(){bodies++;return true;}});t.after(unregister);
  const channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  const input={callId:'limited',name:'probe_tool',agent,signal:new AbortController().signal,arguments:{}};
  assert.equal((await f.ctx.tools.execute(input)).isError,true);assert.equal(bodies,0);
  const ordinary=await f.ctx.agents.create({sessionId:'ordinary'});t.after(()=>ordinary.dispose());
  assert.equal((await f.ctx.tools.execute({...input,callId:'ordinary',agent:ordinary.agent})).isError,false);assert.equal(bodies,1);
});
