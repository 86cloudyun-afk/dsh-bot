/** Real stock components with a blocked synthetic LLM; this does not claim browser authentication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {symbols} from '@deepseek-ai/cordis';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import {stockRuntime,preset,envelope} from './bot-producer-fixture.mjs';
import {Ledger} from '../src/ledger.mjs';
import {Host} from '../src/host.mjs';
import {DshAdapter} from '../src/adapter.mjs';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Approval from '@deepseek-ai/dsh-user-approval';
import PermissionPresets from '@deepseek-ai/dsh-permission-presets';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {scopeOf} from '@deepseek-ai/dsh-scope';
globalThis.__offlineIO ??= {model:0};

async function installer() {
  const m = await import('../src/bot-gui-owner-app.mjs').catch(e => {
    if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return {};
  });
  assert.equal(typeof m.installBotGuiOwner,'function','missing private authenticated GUI owner composer');
  return m.installBotGuiOwner;
}
async function runtime(directory,{initialMode}={}) {
  const ctx = await stockRuntime(directory), handlers = new Map(), routes = new Map();
  // The stock Controller's cold projection reads this external adapter fact.
  ctx.attachments.imageLimits={maxImageBytes:1024,maxImagesPerMessage:1,maxMessageImageBytes:1024,maxImagePixels:1024,maxImageDimension:32,mediaTypes:['image/png']};
  ctx.provide('webServer',{register(route){assert.equal(routes.has(route.path),false);routes.set(route.path,route);return () => routes.delete(route.path);}});
  const mounted = ctx.plugin(ctx => {new HostConnectionService(ctx,[],null);});
  await mounted.await();
  const traced = ctx.get('connection'), connection = traced[symbols.original] ?? traced;
  await connection.operator.ctx.fiber.await();
  const register = connection.register;
  connection.register = function(owner,channel,handler) {handlers.set(channel,handler);return register.call(this,owner,channel,handler);};
  const cwd = join(directory,'harmless');
  await mkdir(cwd,{recursive:true});
  if(initialMode) {
    await ctx.plugin(SandboxPolicy,{mode:initialMode.sandboxMode,workspaceRoot:cwd});
    await ctx.plugin(Approval,{policy:initialMode.approvalPolicy});
    // Unused external shell adapter fact; actual official mode services write the Session prefix.
    ctx.provide('shell',{sandboxMode:initialMode.sandboxMode});
    await ctx.plugin(PermissionPresets,{defaultPreset:initialMode.permissionPreset,
      presets:{[initialMode.permissionPreset]:{sandbox:initialMode.sandboxMode,approval:initialMode.approvalPolicy}}});
  }
  return {ctx,connection,handlers,options:{ownerCtx:ctx,homeDirectory:directory,cwd,
    agentPreset:preset,route:{provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'},modelRequestsEnabled:false,initialMode},
    call(endpoint,payload={},peer=connection.operator) {return handlers.get('/dsh-bot-gui')(endpoint,payload,new AbortController().signal,peer);},
    async dispose(){connection.register=register;await ctx.fiber.dispose();}};
}
const create = {operationId:'gui-create-original',nonce:'gui-create-original-nonce',name:'One Bot'};

test('formal GUI refuses an SDK without a genuine journal before any native creation and preserves its original UNKNOWN',async()=>{
 const install=await installer(),directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-no-journal-')),f=await runtime(directory);
 const app=await install({...f.options,route:{provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'}});
 let nativeCreates=0;const nativeCreate=f.ctx.sessionController.create;
 f.ctx.sessionController.create=function(...args){nativeCreates++;return nativeCreate.apply(this,args);};
 try{
  const original=await f.call('createBot',create);assert.equal(original.ok,true);assert.equal(original.value.state,'unknown');
  const retained=(await f.call('bootstrap')).value.creation;assert.equal(retained.operationId,create.operationId);
  assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).value.sessionId,retained.sessionId);
  assert.equal((await f.call('createBot',{...create,operationId:'replacement',nonce:'replacement'})).ok,false);
  assert.equal(nativeCreates,0);assert.equal(f.ctx.agents.list().length,0);assert.equal(f.ctx.sessions.list().length,0);
  const ledger=new Ledger(join(directory,'bot-gui.sqlite'));
  try{assert.equal(ledger.list('creation').length,1);assert.equal(ledger.list('creation')[0].state,'unknown');assert.equal(ledger.list('contactOwnerOperation').length,0);}
  finally{ledger.close();}
 }finally{f.ctx.sessionController.create=nativeCreate;app.dispose();await f.dispose();}
});

test('GUI original UNKNOWN binds an immutable official initial mode and rejects changed restart modes before effects', async () => {
  const install=await installer(),directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-mode-'));
  const expected={permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'},input={...expected};
  const f=await runtime(directory,{initialMode:input}),app=await install(f.options),before=globalThis.__offlineIO.model;
  try {
    input.approvalPolicy='never';
    const response=await f.call('createBot',create);
    assert.equal(response.ok,true);assert.equal(response.value.state,'unknown');
    const ledger=new Ledger(join(directory,'bot-gui.sqlite'));
    let row;
    try{row=ledger.get('guiCreationOperation',create.operationId);assert.deepEqual(row.initialMode,expected);}
    finally{ledger.close();}
    assert.equal(f.ctx.sessions.get(row.sessionId),undefined);assert.equal(f.ctx.agents.get(row.sessionId),undefined);
    assert.equal(globalThis.__offlineIO.model,before);
    // An UNKNOWN native creation remains its original operation, never a replacement.
    assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).value.sessionId,row.sessionId);
  } finally{app.dispose();await f.dispose();}
  const same=await runtime(directory,{initialMode:{...expected}}),resumed=await install(same.options);
  try {
    const boot=(await same.call('bootstrap')).value;
    assert.equal(boot.creation.operationId,create.operationId);assert.equal(boot.creation.state,'unknown');
    assert.equal(same.ctx.agents.list().length,0);
  } finally{resumed.dispose();await same.dispose();}
  const changed=await runtime(directory,{initialMode:{permissionPreset:'read-only',sandboxMode:'read-only',approvalPolicy:'ask'}});
  try {await assert.rejects(()=>install(changed.options),{code:'gui_initial_mode_changed'});assert.equal(changed.ctx.agents.list().length,0);}
  finally{await changed.dispose();}
});

test('private GUI composer rejects a forged gateway peer and retains only one original UNKNOWN without a raw main', async () => {
  const install = await installer(), directory = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-owner-'));
  const f = await runtime(directory), before = globalThis.__offlineIO.model;
  const app = await install(f.options);
  try {
    let r = await f.call('bootstrap');
    assert.equal(r.ok,true); assert.equal(r.value.selectedBotId,null); assert.equal(r.value.modelRequestsEnabled,false);
    assert.equal(r.value.version,1); assert.equal(typeof r.value.ledgerId,'string');
    assert.deepEqual(Object.keys(r.value).sort(),['version','status','ledgerId','selectedBotId','contactSessionId','modelRequestsEnabled','modelDispatchStatus','creation','nativeGenerationTerminalSupported'].sort());
    r = await f.call('createBot',create,{...f.connection.operator});
    assert.equal(r.ok,false);
    assert.equal((await f.call('bootstrap')).value.selectedBotId,null);
    const created = await f.call('createBot',create);
    assert.equal(created.ok,true); assert.equal(created.value.state,'unknown');
    const boot = (await f.call('bootstrap')).value;
    assert.equal(boot.selectedBotId,null); assert.equal(boot.contactSessionId,null);assert.equal(boot.creation.sessionId,created.value.sessionId);
    assert.equal(f.ctx.tools.schemas().length,0);
    assert.equal(f.ctx.agents.get(created.value.sessionId),undefined);
    assert.equal(globalThis.__offlineIO.model,before);
    assert.equal((await f.call('createBot',create)).value.sessionId,created.value.sessionId);
    assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).value.sessionId,created.value.sessionId);
    assert.equal((await f.call('createBot',{...create,operationId:'another-original',nonce:'another-nonce'})).ok,false);
    assert.equal((await f.call('createBot',{...create,nonce:'altered-nonce'})).ok,false);
    assert.equal((await f.call('createBot',{...create,model:'untrusted-route'})).ok,false);
    assert.equal(f.ctx.agents.list().length,0);
  } finally {app.dispose();await f.dispose();}
});

test('unsealed legacy GUI restart preserves original ledger/Bot/main identity without activating any bare main or held work', async () => {
  const install = await installer(), directory = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-restart-'));
  const first = await runtime(directory);
  const ledger = new Ledger(join(directory,'bot-gui.sqlite'));
  const fixtureHost=new Host({ledger,ownerHumanId:'this-home-authenticated-gui-owner',ownerCapability:first.ctx.fiber,adapter:new DshAdapter(first.ctx)});
  await fixtureHost.adapter.refreshSessionModeCatalog();
  const command=(name,payload,revision=null)=>{const e=envelope(name,payload,revision,{nativeOwner:1});return{value:fixtureHost.executeOwned(first.ctx.fiber,e,payload).result,envelope:e};};
  const bot=command('createBot',{name:create.name,config:{contact:first.options.route,execution:first.options.route,agentPreset:preset}}).value;
  const original=command('prepareContactSession',{botId:bot.botId,cwd:first.options.cwd},bot.revision);
  const bound=await new SessionCreationDriver({host:fixtureHost,caller:first.ctx.fiber,port:fixtureHost.adapter.ownedCreationPort([original.value.sessionId],{scopeOf,durable:true})}).run(first.ctx.fiber,original.value.operationId);
  assert.equal(bound.state,'created');const created={botId:bot.botId,sessionId:bound.sessionId};
  ledger.put('guiCreationOperation',create.operationId,{...create,state:'created',initialMode:null,createdAt:new Date().toISOString(),botId:bot.botId,sessionId:bound.sessionId,creationOperation:original.envelope});
  ledger.put('guiOwner','selected',{botId:bot.botId,sessionId:bound.sessionId,botEpoch:1,configVersion:bot.configVersion});
  const ledgerId=fixtureHost.ledgerInstanceId;
  const port=fixtureHost.openOwnedWorkSessionPort(first.ctx.fiber,{botId:created.botId,botEpoch:1,authorityEpoch:1});
  const payload={task_id:'historical-work',goal:'Synthetic held historical work',completion_condition:'Never execute this fixture'};
  const historical=port.delegate(envelope('delegateWorkSession',payload,null,{bot:1,nativeOwner:1}),payload).result;
  const key=JSON.stringify([created.botId,historical.taskId,1]),held=ledger.get('workGeneration',key);
  ledger.put('workGeneration',key,{...held,state:'unknown',held:true});
  port.dispose();
  ledger.close();
  await first.dispose();
  const second = await runtime(directory);
  let rawActivations=0;second.ctx.sessionController.resolveAgent=async()=>{rawActivations++;throw Error('BARE_AGENT_ACTIVATION_FORBIDDEN');};
  const recovered = await install(second.options);
  try {
    const resumed = (await second.call('bootstrap')).value;
    assert.equal(resumed.ledgerId,ledgerId);assert.equal(resumed.selectedBotId,created.botId);assert.equal(resumed.contactSessionId,created.sessionId);
    assert.equal(second.ctx.agents.get(historical.sessionId),undefined);
    assert.equal(second.ctx.agents.get(created.sessionId),undefined);assert.equal(rawActivations,0);
    assert.equal(resumed.modelRequestsEnabled,false);assert.equal(resumed.nativeGenerationTerminalSupported,false);
    assert.equal((await second.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).ok,false);
    assert.equal((await second.call('bootstrap')).value.creation.sessionId,created.sessionId);
  } finally {recovered.dispose();await second.dispose();}
});

test('owner actions fail after actual operator replacement and disposed app', async () => {
  const install = await installer(), directory = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-stale-'));
  const f = await runtime(directory), app = await install(f.options), original = f.connection.operator;
  try {
    await f.call('createBot',create);
    f.connection.operator = {...original};
    assert.equal((await f.call('bootstrap',{},original)).ok,false);
    assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce},original)).ok,false);
    f.connection.operator = original;
    app.dispose();
    assert.equal((await f.call('bootstrap',{},original)).ok,false);
  } finally {f.connection.operator=original;app.dispose();await f.dispose();}
});

test('GUI model-enable flag cannot grant sends to an unprotected main and advertises truthful read-only continuation',async()=>{
  const install=await installer(),directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-readonly-'));
  const f=await runtime(directory),app=await install({...f.options,modelRequestsEnabled:true}),before=globalThis.__offlineIO.model;
  try{
    const created=await f.call('createBot',create);assert.equal(created.value.state,'unknown');
    const boot=(await f.call('bootstrap')).value;
    assert.equal(boot.modelRequestsEnabled,false);assert.equal(boot.modelDispatchStatus,'unconfirmed');
    assert.equal(f.handlers.has('/dsh-bot-owner'),false);
    const ledger=new Ledger(join(directory,'bot-gui.sqlite'));
    try{assert.equal(ledger.list('contactOwnerOperation').length,0);}finally{ledger.close();}
    assert.equal(f.ctx.agents.get(created.value.sessionId),undefined);assert.equal(globalThis.__offlineIO.model,before);
  }finally{app.dispose();await f.dispose();}
});
