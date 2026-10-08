import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';

function registerProbe(f, t, name, body) {
  t.after(f.ctx.tools.register({
    name, description: 'Harmless native tool probe',
    parameters: {type: 'object', properties: {}, additionalProperties: false},
    output: {schema: {type: 'boolean'}, render: () => [{type: 'text', text: 'ok'}]},
    execute: body,
  }));
}
async function contact(f, bot) {
  const row = await f.sessions.create(f.human, {
    operationId: 'default-tool-contact', action: 'session.create', input: {botId: bot.botId},
  });
  return f.ctx.agents.get(row.sessionId);
}
const execute = (f, agent, name) => f.ctx.tools.execute({
  callId: name, name, agent, signal: new AbortController().signal, arguments: {},
});

test('a new Bot can use a native work tool without configuring a tool list', async t => {
  const f = await businessFixture(t), bot = await f.bot(), agent = await contact(f, bot);
  let calls = 0;
  registerProbe(f, t, 'available_work_tool', async () => {calls++; return true;});
  assert.equal((await execute(f, agent, 'available_work_tool')).isError, false);
  assert.equal(calls, 1);
  assert.equal(f.requests.length, 0);
});

test('previously saved tool lists do not restrict newly available native work tools', async t => {
  const f = await businessFixture(t), bot = await f.bots.create(f.human, {
    operationId: 'legacy-bot', action: 'bot.create', input: {
      name: 'Previously configured', cwd: f.dir,
      contact: {provider: 'controlled', model: 'model-a'}, capabilities: ['old_tool'],
    },
  }), agent = await contact(f, bot);
  let calls = 0;
  registerProbe(f, t, 'new_work_tool', async () => {calls++; return true;});
  assert.equal((await execute(f, agent, 'new_work_tool')).isError, false);
  assert.equal(calls, 1);
});

test('default work tool access still observes the official native tool guard', async t => {
  const f = await businessFixture(t), bot = await f.bot(), agent = await contact(f, bot);
  let calls = 0;
  registerProbe(f, t, 'approval_probe', async () => {calls++; return true;});
  assert.equal((await execute(f, agent, 'approval_probe')).isError, false);
  t.after(f.ctx.tools.guard(exec => exec.name === 'approval_probe' ? 'native_approval_required' : undefined));
  const denied = await execute(f, agent, 'approval_probe');
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /native_approval_required/);
  assert.equal(calls, 1);
});
