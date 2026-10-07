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
    agentPreset:preset,route:{provider:'offline-blocked',model:'never-invoked',reasoning:'off'},modelRequestsEnabled:false,initialMode},
    call(endpoint,payload={},peer=connection.operator) {return handlers.get('/dsh-bot-gui')(endpoint,payload,new AbortController().signal,peer);},
    async dispose(){connection.register=register;await ctx.fiber.dispose();}};
}
const create = {operationId:'gui-create-original',nonce:'gui-create-original-nonce',name:'One Bot'};

test('GUI original creation binds an immutable official initial mode before native effects and rejects changed restart modes', async () => {
  const install=await installer(),directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-mode-'));
  const expected={permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'},input={...expected};
  const f=await runtime(directory,{initialMode:input}),app=await install(f.options),before=globalThis.__offlineIO.model;
  try {
    input.approvalPolicy='never';
    const response=await f.call('createBot',create);
    assert.equal(response.ok,true);assert.equal(response.value.state,'created');
    const ledger=new Ledger(join(directory,'bot-gui.sqlite'));
    let row;
    try{row=ledger.get('guiCreationOperation',create.operationId);assert.deepEqual(row.initialMode,expected);}
    finally{ledger.close();}
    const log=await f.ctx.sessionController.inspect(row.sessionId);
    assert.deepEqual(log.events.map(event=>[event.type,event.data]),[
      ['permission/preset',{preset:'workspace-write'}],['sandbox/mode',{mode:'workspace-write'}],['approval/policy',{policy:'ask'}],
    ]);
    assert.equal(globalThis.__offlineIO.model,before);
    // An UNKNOWN native creation remains its original operation, never a replacement.
    assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).value.sessionId,row.sessionId);
  } finally{app.dispose();await f.dispose();}
  const same=await runtime(directory,{initialMode:{...expected}}),resumed=await install(same.options);
  try {
    const boot=(await same.call('bootstrap')).value;
    assert.equal(boot.creation.operationId,create.operationId);assert.equal(boot.creation.state,'created');
    assert.equal(same.ctx.agents.list().length,1);
    assert.deepEqual(same.ctx.tools.schemas(same.ctx.agents.get(boot.contactSessionId)).map(tool=>tool.name),['dsh_bot_delegate']);
  } finally{resumed.dispose();await same.dispose();}
  const changed=await runtime(directory,{initialMode:{permissionPreset:'read-only',sandboxMode:'read-only',approvalPolicy:'ask'}});
  try {await assert.rejects(()=>install(changed.options),{code:'gui_initial_mode_changed'});assert.equal(changed.ctx.agents.list().length,0);}
  finally{await changed.dispose();}
});

test('private GUI composer exposes no ledger to a forged gateway peer and creates exactly one durable tool-free main', async () => {
  const install = await installer(), directory = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-owner-'));
  const f = await runtime(directory), before = globalThis.__offlineIO.model;
  const app = await install(f.options);
  try {
    let r = await f.call('bootstrap');
    assert.equal(r.ok,true); assert.equal(r.value.selectedBotId,null); assert.equal(r.value.modelRequestsEnabled,false);
    assert.equal(r.value.version,1); assert.equal(typeof r.value.ledgerId,'string');
    assert.deepEqual(Object.keys(r.value).sort(),['version','status','ledgerId','selectedBotId','contactSessionId','modelRequestsEnabled','creation','nativeGenerationTerminalSupported'].sort());
    r = await f.call('createBot',create,{...f.connection.operator});
    assert.equal(r.ok,false);
    assert.equal((await f.call('bootstrap')).value.selectedBotId,null);
    const created = await f.call('createBot',create);
    assert.equal(created.ok,true); assert.equal(created.value.state,'created');
    const boot = (await f.call('bootstrap')).value;
    assert.equal(boot.selectedBotId,created.value.botId); assert.equal(boot.contactSessionId,created.value.sessionId);
    assert.equal(f.ctx.tools.schemas().length,0);
    const main = f.ctx.agents.get(boot.contactSessionId);
    assert.ok(main); assert.deepEqual(f.ctx.tools.schemas(main).map(t=>t.name),['dsh_bot_delegate']);
    const log = await f.ctx.sessionController.inspect(main.id);
    assert.equal(log.meta.agentPreset,preset); assert.equal(log.meta.cwd,f.options.cwd); assert.equal(log.events.length,0);
    assert.equal(globalThis.__offlineIO.model,before);
    assert.equal((await f.call('createBot',create)).value.sessionId,main.id);
    assert.equal((await f.call('reconcileCreate',{operationId:create.operationId,nonce:create.nonce})).value.sessionId,main.id);
    assert.equal((await f.call('createBot',{...create,operationId:'another-original',nonce:'another-nonce'})).ok,false);
    assert.equal((await f.call('createBot',{...create,nonce:'altered-nonce'})).ok,false);
    assert.equal((await f.call('createBot',{...create,model:'untrusted-route'})).ok,false);
    assert.equal(f.ctx.agents.list().length,1);
  } finally {app.dispose();await f.dispose();}
});

test('GUI restart preserves ledger/Bot/main identity and never activates held historical work', async () => {
  const install = await installer(), directory = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-restart-'));
  const first = await runtime(directory), app = await install(first.options);
  const created = (await first.call('createBot',create)).value, boot = (await first.call('bootstrap')).value;
  const ledger = new Ledger(join(directory,'bot-gui.sqlite'));
  const fixtureHost=new Host({ledger,ownerHumanId:'this-home-authenticated-gui-owner',ownerCapability:first.ctx.fiber,adapter:new DshAdapter(first.ctx)});
  await fixtureHost.adapter.refreshSessionModeCatalog();
  const port=fixtureHost.openOwnedWorkSessionPort(first.ctx.fiber,{botId:created.botId,botEpoch:1,authorityEpoch:1});
  const payload={task_id:'historical-work',goal:'Synthetic held historical work',completion_condition:'Never execute this fixture'};
  const historical=port.delegate(envelope('delegateWorkSession',payload,null,{bot:1,nativeOwner:1}),payload).result;
  const key=JSON.stringify([created.botId,historical.taskId,1]),held=ledger.get('workGeneration',key);
  ledger.put('workGeneration',key,{...held,state:'unknown',held:true});
  port.dispose();
  ledger.close();
  app.dispose();await first.dispose();
  const second = await runtime(directory);
  const resolveAgent=second.ctx.sessionController.resolveAgent;
  second.ctx.sessionController.resolveAgent=async function(...args) {
    const found=await resolveAgent.apply(this,args);
    assert.equal(found.error,undefined,found.error?.message);
    return found;
  };
  const recovered = await install(second.options);
  try {
    const resumed = (await second.call('bootstrap')).value;
    assert.equal(resumed.ledgerId,boot.ledgerId);assert.equal(resumed.selectedBotId,created.botId);assert.equal(resumed.contactSessionId,created.sessionId);
    assert.equal(second.ctx.agents.get(historical.sessionId),undefined);
    assert.ok(second.ctx.agents.get(created.sessionId));
    assert.deepEqual(second.ctx.tools.schemas(second.ctx.agents.get(created.sessionId)).map(t=>t.name),['dsh_bot_delegate']);
    assert.equal((await second.call('createBot',create)).value.sessionId,created.sessionId);
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
