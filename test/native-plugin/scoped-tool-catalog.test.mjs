import test from 'node:test';
import assert from 'node:assert/strict';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local';
import BashLocal from '@deepseek-ai/dsh-bash-local';
import * as ShellEnv from '@deepseek-ai/dsh-shell-env';
import * as BashTool from '@deepseek-ai/dsh-tool-bash';
import * as ChildControl from '@deepseek-ai/dsh-tool-subagent-control';
import * as ChildList from '@deepseek-ai/dsh-tool-subagent-control/list-agents';
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as ForkProvider from '@deepseek-ai/dsh-subagent-fork-in-process';
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent';
import {brokerFixture} from './broker-fixture.mjs';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {deferred, eventually, textChunks} from './official-fixture.mjs';

// The official preset registry owns two different tool scopes. Only the small
// probe tools are synthetic; bash and child-control schemas are the shipped ones.
async function fixture(t) {
  const f = await brokerFixture(t);
  await f.ctx.plugin(SubprocessLocal).await();
  await f.ctx.plugin(BashLocal, {cwd: f.dir}).await();
  await f.ctx.plugin(ShellEnv).await();
  await f.ctx.plugin(AgentPresets, {default: 'alpha'}).await();
  await f.ctx.plugin(SpawnProvider).await();
  await f.ctx.plugin(ForkProvider).await();
  Object.assign(f.ctx.loader.builtins, {
    'catalog-probe': {
      name: 'catalog-probe', inject: ['tools'],
      apply(ctx, {name}) {
        ctx.tools.register({
          name, description: `Harmless scoped ${name} probe`,
          parameters: {type: 'object', properties: {}, additionalProperties: false},
          output: {schema: {type: 'boolean'}, render: () => [{type: 'text', text: 'ok'}]},
          execute: async () => true,
        });
      },
    },
    'catalog-bash': BashTool,
    'catalog-child-control': ChildControl,
    'catalog-child-list': ChildList,
    'catalog-subagent': SubagentTool,
  });
  await f.ctx.agentPresets.register({id: 'alpha', plugins: [
    {id: 'alpha-work', name: 'cordis:catalog-probe', config: {name: 'alpha_work'}},
    {id: 'bash', name: 'cordis:catalog-bash'},
    {id: 'blocked-management', name: 'cordis:catalog-probe', config: {name: 'plugin_manager'}},
    {id: 'blocked-spawn', name: 'cordis:catalog-subagent', config: {provider: 'spawn', toolName: 'subagent'}},
    {id: 'managed-fork', name: 'cordis:catalog-subagent', config: {provider: 'fork', toolName: 'subagent_fork'}},
    {id: 'custom-delegation', name: 'cordis:catalog-subagent', config: {provider: 'spawn', toolName: 'reviewer'}},
    {id: 'child-control', name: 'cordis:catalog-child-control'},
    {id: 'child-list', name: 'cordis:catalog-child-list'},
  ]});
  await f.ctx.agentPresets.register({id: 'beta', plugins: [
    {id: 'beta-work', name: 'cordis:catalog-probe', config: {name: 'beta_work'}},
  ]});
  const a = await f.bots.create(f.human, {
    operationId: 'alpha-bot', action: 'bot.create',
    input: {name: 'Alpha', presetId: 'alpha', contact: {provider: 'controlled', model: 'model-a'}},
  }), b = await f.bots.create(f.human, {
    operationId: 'beta-bot', action: 'bot.create',
    input: {name: 'Beta', presetId: 'beta', contact: {provider: 'controlled', model: 'model-a'}},
  }), first = await f.contact(a, 'alpha-contact'), second = await f.contact(b, 'beta-contact');
  return {...f, a: f.ctx.agents.get(first.sessionId), b: f.ctx.agents.get(second.sessionId)};
}

async function invoke(f, agent, action, input = {}) {
  const result = await f.ctx.tools.execute({
    callId: crypto.randomUUID(), name: 'dsh_bot', agent,
    signal: new AbortController().signal, arguments: {action, input},
  });
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test('Bot catalog reports its own native preset tools instead of another Bot scope', async t => {
  const f = await fixture(t), schemasA = f.ctx.tools.schemas(f.a).map(row => row.name),
    schemasB = f.ctx.tools.schemas(f.b).map(row => row.name);
  assert.ok(schemasA.includes('alpha_work'));
  assert.ok(schemasA.includes('bash'));
  assert.equal(schemasA.includes('beta_work'), false);
  assert.ok(schemasB.includes('beta_work'));
  assert.equal(schemasB.includes('bash'), false);
  const a = await invoke(f, f.a, 'catalog'), b = await invoke(f, f.b, 'catalog');
  assert.ok(a.nativeTools.includes('alpha_work'));
  assert.equal(a.nativeTools.includes('beta_work'), false, 'other Bot tools leaked into caller catalog');
  assert.ok(b.nativeTools.includes('beta_work'));
  assert.equal(b.nativeTools.includes('alpha_work'), false);
  assert.equal(b.nativeTools.includes('bash'), false);
  const human = await f.service.dispatch(f.human, {action: 'catalog'});
  assert.equal(human.toolScope.kind, 'inventory');
  assert.ok(human.nativeTools.includes('alpha_work'));
  assert.ok(human.nativeTools.includes('beta_work'));
  assert.equal(f.requests.length, 0);
});

test('help and tools.list expose actual native schemas and explain business-action scope without writes', async t => {
  const f = await fixture(t), before = f.store.read(), help = await invoke(f, f.a, 'help');
  assert.match(help.protocol.tools, /dsh_bot/);
  assert.match(help.protocol.tools, /bash/);
  assert.match(help.protocol.tools, /tools\.list/);
  assert.equal(help.commands.bash, undefined);
  assert.equal(help.commands['tools.list'].readOnly, true);
  const tools = await invoke(f, f.a, 'tools.list');
  assert.deepEqual(help.toolCatalog, tools);
  assert.equal(tools.toolScope.kind, 'session');
  assert.equal(tools.toolScope.sessionId, f.a.id);
  assert.equal(tools.runCodeMounted, false);
  const bash = tools.mountedTools.find(row => row.name === 'bash');
  assert.equal(bash.availability, 'native_guarded');
  assert.deepEqual(bash.parameters, f.ctx.tools.schemas(f.a).find(row => row.name === 'bash').parameters);
  assert.ok(tools.nativeTools.includes('bash'));
  assert.equal(tools.mountedTools.some(row => row.name === 'beta_work'), false);
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.requests.length, 0);
});

test('mounted blocked tools and managed delegation are never advertised as direct native work', async t => {
  const f = await fixture(t), tools = await invoke(f, f.a, 'tools.list');
  const byName = Object.fromEntries(tools.mountedTools.map(row => [row.name, row]));
  assert.equal(byName.plugin_manager.availability, 'plugin_blocked');
  assert.equal(byName.plugin_manager.reason, 'capability_denied');
  assert.equal(byName.subagent.availability, 'plugin_blocked');
  assert.equal(byName.subagent_fork.availability, 'managed_work_required');
  assert.equal(byName.subagent_fork.route, 'task.create/task.start');
  for (const name of ['plugin_manager', 'subagent', 'subagent_fork'])
    assert.equal(tools.nativeTools.includes(name), false);
  for (const name of ['send_message', 'interrupt_agent', 'list_agents']) {
    assert.equal(byName[name].category, 'child_control');
    assert.equal(byName[name].availability, 'native_guarded');
  }
  const blocked = await f.ctx.tools.execute({
    callId: 'blocked-manager', name: 'plugin_manager', agent: f.a,
    signal: new AbortController().signal, arguments: {},
  });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /capability_denied/);
  t.after(f.ctx.tools.guard(exec => exec.name === 'bash' ? 'native_approval_required' : undefined));
  const guarded = await f.ctx.tools.execute({
    callId: 'guarded-bash', name: 'bash', agent: f.a,
    signal: new AbortController().signal, arguments: {command: 'true', description: 'Harmless catalog check'},
  });
  assert.equal(guarded.isError, true);
  assert.match(JSON.stringify(guarded), /native_approval_required/);
  const actor = f.policy.fromAgent(f.a);
  await assert.rejects(f.service.dispatch(actor, {action: 'tools.list', input: {sessionId: f.b.id}}), {code: 'invalid_input'});
  assert.equal(f.requests.length, 0);
});

test('native schema aliases remain unclassified and never imply permission to create untracked work', async t => {
  const f = await fixture(t), tools = await invoke(f, f.a, 'tools.list'),
    alias = tools.mountedTools.find(row => row.name === 'reviewer');
  assert.ok(alias, 'official custom delegation schema must remain visible');
  assert.equal(alias.category, 'native');
  assert.equal(alias.availability, 'native_guarded');
  assert.match(tools.toolProtocol.classification, /自定义/);
  assert.match(tools.toolProtocol.native, /并非执行保证/);
  assert.match(tools.toolProtocol.delegation, /work_admission_required/);
  assert.equal(f.requests.length, 0);
});

test('independent opinions can inspect tools without advertising a delegation path outside their sealed channel', async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const f = await collaborationFixture(t, {stream: async function* () {
    entered.resolve(); await release.promise; yield* textChunks('Independent opinion');
  }});
  await f.ctx.plugin(SpawnProvider).await();
  await f.ctx.plugin(SubagentTool, {provider: 'spawn', toolName: 'reviewer'}).await();
  await f.ctx.plugin(SubagentTool, {provider: 'spawn', toolName: 'subagent_fork'}).await();
  const bot = await f.bot(), group = await f.group('ScopedCatalog', [bot]), meeting = await f.meeting(group);
  await entered.promise;
  const sessionId = f.store.read().meetings[meeting.meetingId].participants[0].sessionId,
    agent = f.ctx.agents.get(sessionId), before = f.store.read(),
    tools = await invoke(f, agent, 'tools.list');
  assert.equal(tools.mountedTools.some(row => row.name === 'subagent_fork'), true);
  assert.deepEqual(tools.nativeTools, []);
  for (const tool of tools.mountedTools) {
    assert.equal(tool.availability, 'plugin_blocked');
    assert.equal(tool.reason, 'capability_denied');
    assert.equal(tool.route, undefined, 'sealed participant cannot use task.create/task.start either');
  }
  assert.deepEqual((await invoke(f, agent, 'help')).toolCatalog, tools);
  assert.deepEqual(f.store.read(), before);
  release.resolve();
  await eventually(() => f.store.read().meetings[meeting.meetingId].opinions[bot.botId], 'independent opinion');
});
