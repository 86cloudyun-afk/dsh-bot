import test from "node:test";
import assert from "node:assert/strict";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { businessFixture } from "./business-fixture.mjs";
import { eventually } from "./official-fixture.mjs";

test("native model resolution receives the original AbortSignal", async (t) => {
  const f = await businessFixture(t),
    bot = await f.bot(),
    binding = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    }),
    agent = f.ctx.agents.get(binding.sessionId);
  const resolve = f.ctx.llm.resolveCallConfig.bind(f.ctx.llm),
    signals = [];
  f.ctx.llm.resolveCallConfig = async (config, signal) => {
    if (signal !== undefined) {
      assert.ok(signal instanceof AbortSignal);
      signal.throwIfAborted();
      signals.push(signal);
    }
    return resolve(config, signal);
  };
  agent.followup(
    createUserMessage({ content: [{ type: "text", text: "One response." }] }),
  );
  await eventually(() =>
    f.events.get(agent.id)?.some((row) => row.type === "turn/end"),
  );
  assert.equal(f.requests.length, 1);
  assert.ok(signals.includes(f.requests[0].signal));
});

test("a contact model change takes effect on its next native turn", async (t) => {
  const f = await businessFixture(t),
    bot = await f.bot(),
    binding = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    }),
    agent = f.ctx.agents.get(binding.sessionId);
  agent.followup(
    createUserMessage({ content: [{ type: "text", text: "First response." }] }),
  );
  await eventually(
    () =>
      f.events.get(agent.id)?.filter((row) => row.type === "turn/end")
        .length === 1,
  );
  await f.bots.update(f.human, {
    operationId: "contact-model",
    action: "bot.update",
    input: {
      botId: bot.botId,
      expectedVersion: bot.revision,
      contact: { provider: "controlled", model: "model-b" },
    },
  });
  agent.followup(
    createUserMessage({ content: [{ type: "text", text: "Next response." }] }),
  );
  await eventually(
    () =>
      f.events.get(agent.id)?.filter((row) => row.type === "turn/end")
        .length === 2,
  );
  assert.deepEqual(
    f.requests.map((row) => row.model),
    ["model-a", "model-b"],
  );
  assert.equal(
    JSON.stringify(f.events.get(agent.id)).includes("model_drift"),
    false,
  );
});
