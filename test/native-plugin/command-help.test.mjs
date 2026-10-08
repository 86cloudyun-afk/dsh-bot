import test from "node:test";
import assert from "node:assert/strict";
import {createUserMessage} from "@deepseek-ai/dsh-llm";
import {brokerFixture} from "./broker-fixture.mjs";
import {deferred, eventually, textChunks} from "./official-fixture.mjs";

const invoke = (f, agent, args, callId = crypto.randomUUID()) => f.ctx.tools.execute({
  callId, name: "dsh_bot", agent, signal: new AbortController().signal, arguments: args,
});
function value(result) {
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test("native Bot help needs no write ID and changes no business state", async t => {
  const f = await brokerFixture(t), bot = await f.bot(), binding = await f.contact(bot),
    agent = f.ctx.agents.get(binding.sessionId), before = f.store.read();
  const help = value(await invoke(f, agent, {action: "help"}));
  assert.deepEqual(help.identity, {kind: "bot", botId: bot.botId, sessionId: binding.sessionId});
  assert.ok(help.commands["task.create"]);
  assert.ok(help.commands["task.start"]);
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.requests.length, 0);
});

test("documented native commands dispatch background work while contact still replies", async t => {
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  let f;
  f = await brokerFixture(t, {stream: async function* (options) {
    if (f.store.read().sessions[options.sessionId]?.purpose === "execution") {
      entered.resolve(); await release.promise; yield* textChunks("Actual background result");
    } else yield* textChunks("Independent contact reply");
  }});
  const bot = await f.bot(), binding = await f.contact(bot), agent = f.ctx.agents.get(binding.sessionId);
  const createHelp = value(await invoke(f, agent, {action: "help", input: {action: "task.create"}})),
    create = createHelp.commands["task.create"].example;
  create.operationId = "documented-create";
  create.input.title = "Documented background dispatch";
  const task = value(await invoke(f, agent, create));
  assert.deepEqual(task.createdBy, {kind: "bot", botId: bot.botId, sessionId: binding.sessionId});
  assert.equal(task.originSessionId, binding.sessionId);
  const startHelp = value(await invoke(f, agent, {action: "help", input: {action: "task.start"}})),
    start = startHelp.commands["task.start"].example;
  start.operationId = "documented-start";
  start.input.taskId = task.taskId;
  start.input.expectedVersion = task.version;
  const attempt = value(await invoke(f, agent, start));
  await entered.promise;
  assert.notEqual(attempt.sessionId, binding.sessionId);
  agent.followup(createUserMessage({content: [{type: "text", text: "A new topic"}], source: {kind: "user"}}));
  await agent.whenIdle();
  assert.ok(JSON.stringify(f.events.get(agent.id)).includes("Independent contact reply"));
  assert.equal(f.store.read().attempts[attempt.attemptId].reservationHeld, true);
  release.resolve();
  await eventually(() => f.store.read().attempts[attempt.attemptId].state === "returned", "documented native result");
});

test("help rejects caller overrides and unsupported actions without a write", async t => {
  const f = await brokerFixture(t), bot = await f.bot(), binding = await f.contact(bot),
    actor = f.policy.fromAgent(f.ctx.agents.get(binding.sessionId)), before = f.store.read();
  await assert.rejects(f.service.dispatch(actor, {action: "help", input: {action: "task.create", botId: "someone-else"}}), {code: "invalid_input"});
  await assert.rejects(f.service.dispatch(actor, {action: "help", input: {action: "task.list"}}), {code: "unknown_action"});
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.requests.length, 0);
});
