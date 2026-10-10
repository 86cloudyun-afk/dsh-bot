import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {taskFixture} from './task-fixture.mjs';
import {deferred} from './official-fixture.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});
const fixtureUrl=new URL('./task-fixture.mjs',import.meta.url).href,
  nativeUrl=new URL('./official-fixture.mjs',import.meta.url).href,
  llmUrl=import.meta.resolve('@deepseek-ai/dsh-llm');

async function crashedFixture(t,mode) {
  const directory=await mkdtemp(join(tmpdir(),'dsh-v113-cold-delete-')),
    source=`
      import {taskFixture} from ${JSON.stringify(fixtureUrl)};
      import {deferred,eventually,textChunks} from ${JSON.stringify(nativeUrl)};
      import {createUserMessage} from ${JSON.stringify(llmUrl)};
      const directory=process.argv[1],mode=process.argv[2],gate=deferred();
      const f=await taskFixture({after(){}},{directory,stream:async function*(){await gate.promise;yield*textChunks('Never replay this crashed turn');}});
      const bot=await f.bot('ColdDeletion'),binding=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}}),agent=f.ctx.agents.get(binding.sessionId);
      const message=createUserMessage({content:[{type:'text',text:'Durable native pending user input'}],source:{kind:'user'}});
      if(mode==='open-turn'){agent.followup(message);await eventually(()=>f.requests.length===1);}
      else if(mode!=='settled')agent.inbox.append(mode,message);
      await f.ctx.sessions.flush(agent.session);await f.store.drain();
      console.log(JSON.stringify({bot,binding,messageId:message.id}));
      process.exit(0); // No graceful disposal: preserve the actual crash log.
    `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,directory,mode],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
  const identities=JSON.parse(child.stdout.trim()),f=await taskFixture(t,{directory});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await f.recovery.reconcile(f.human,command('recovery.reconcile',{}));await f.adapter.start();
  assert.equal(f.ctx.agents.get(identities.binding.sessionId),undefined);
  return {...f,...identities};
}

for(const mode of ['next-turn','next-step','open-turn'])test(`v1.1.3 cold ${mode} native work blocks Bot deletion after the real host crash`,async t=>{
  const f=await crashedFixture(t,mode),native=await f.adapter.inspectSession(f.binding.sessionId),before=f.store.read();
  if(mode==='open-turn')assert.ok(native.openTurn);
  else assert.equal(native.inbox[mode][0].id,f.messageId);
  const request=command('bot.delete',{botId:f.bot.botId,expectedVersion:f.bot.revision},'delete-crashed-cold');
  await assert.rejects(f.service.dispatch(f.human,request),error=>{
    assert.equal(error.code,'bot_contact_active');assert.equal(error.details?.rejectedBeforeWrite,true);return true;
  });
  assert.deepEqual(f.store.read(),before);
  assert.deepEqual(await f.adapter.inspectSession(f.binding.sessionId),native);
  assert.equal(f.requests.length,0);
});

test('v1.1.3 settled cold Bot deletion keeps native logs and replays without new inspection',async t=>{
  const f=await crashedFixture(t,'settled'),native=await f.adapter.inspectSession(f.binding.sessionId),
    request=command('bot.delete',{botId:f.bot.botId,expectedVersion:f.bot.revision},'delete-settled-cold'),
    deleted=await f.service.dispatch(f.human,request);
  assert.ok(deleted.deletedAt);assert.equal(deleted.botId,f.bot.botId);
  const inspect=f.adapter.inspectSession.bind(f.adapter);let reads=0;
  f.adapter.inspectSession=async(...args)=>{reads++;return inspect(...args);};
  assert.deepEqual(await f.service.dispatch(f.human,request),deleted);assert.equal(reads,0);
  assert.deepEqual(await inspect(f.binding.sessionId),native);assert.equal(f.requests.length,0);
});

test('v1.1.3 deletion fences native admission while inspection waits and preserves exact duplicate receipts',async t=>{
  const f=await taskFixture(t),a=await f.bot('DeleteA'),b=await f.bot('LiveB'),
    own=await f.sessions.create(f.human,command('session.create',{botId:a.botId})),
    other=await f.sessions.create(f.human,command('session.create',{botId:b.botId})),
    ownAgent=f.ctx.agents.get(own.sessionId),otherAgent=f.ctx.agents.get(other.sessionId),
    entered=deferred(),release=deferred(),inspect=f.adapter.inspectSession.bind(f.adapter);
  t.after(()=>release.resolve());
  f.adapter.inspectSession=async(...args)=>{if(args[0]===own.sessionId){entered.resolve();await release.promise;}return inspect(...args);};
  const request=command('bot.delete',{botId:a.botId,expectedVersion:a.revision},'delete-inspected-once'),
    pending=f.service.dispatch(f.human,request),duplicate=f.service.dispatch(f.human,request);
  await Promise.race([entered.promise,pending.then(()=>{assert.fail('Deletion committed without inspecting its original native history');})]);
  ownAgent.followup(createUserMessage({content:[{type:'text',text:'Blocked while deletion is pending'}],source:{kind:'user'}}));
  otherAgent.followup(createUserMessage({content:[{type:'text',text:'Independent Bot stays available'}],source:{kind:'user'}}));
  await Promise.all([ownAgent.whenIdle(),otherAgent.whenIdle()]);
  assert.equal(f.requests.filter(row=>row.sessionId===own.sessionId).length,0);
  assert.equal(f.requests.filter(row=>row.sessionId===other.sessionId).length,1);
  release.resolve();const result=await pending;assert.deepEqual(await duplicate,result);
  assert.ok(result.deletedAt);
});
