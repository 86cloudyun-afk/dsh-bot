import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { businessFixture } from "./business-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

async function fixture(t) {
  const release = deferred();
  t.after(() => release.resolve());
  const f = await businessFixture(t, {
    async *stream(options) {
      await Promise.race([
        release.promise,
        new Promise((resolve) =>
          options.signal.addEventListener("abort", resolve, { once: true }),
        ),
      ]);
      options.signal.throwIfAborted();
      yield* textChunks("Released");
    },
  });
  const handle = await f.ctx.agents.create({
    sessionId: randomUUID(),
    cwd: f.dir,
    agentOptions: { provider: "controlled", model: "model-a" },
    setup(ctx) {
      installModelSelection(ctx, {
        current: { provider: "controlled", model: "model-a" },
      });
    },
  });
  t.after(() => handle.dispose());
  handle.agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "First ordinary turn" }],
    }),
  );
  await eventually(() => f.requests.length === 1);
  const target = (await f.sessions.list(f.human)).items.find(
    (row) => row.sessionId === handle.agent.id,
  ).activity;
  return { ...f, handle, target, release };
}

test("unified reply stop preserves ordinary queue and never repeats into a later turn", async (t) => {
  const f = await fixture(t),
    sid = f.handle.agent.id;
  f.handle.agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "Second queued turn" }],
    }),
  );
  const command = {
    operationId: "stop",
    action: "session.stop",
    input: { sessionId: sid, expectedTurn: f.target.token },
  };
  const receipt = await f.sessions.stop(f.human, command);
  assert.equal(receipt.accepted, true);
  await f.handle.agent.whenIdle();
  assert.equal(f.handle.agent.inbox.hasPending, true);
  f.handle.agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "Resume queued input" }],
    }),
  );
  await eventually(() => f.requests.length === 2);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.deepEqual(await f.sessions.stop(f.human, command), receipt);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.equal(f.store.read().sessions[sid].botId, null);
  assert.equal(f.store.read().sessions[sid].purpose, "ordinary");
});

test("an old visible reply token cannot stop the next ordinary turn", async (t) => {
  const f = await fixture(t),
    sid = f.handle.agent.id;
  f.handle.agent.cancel({ kind: "user" }, { keepInbox: true });
  await f.handle.agent.whenIdle();
  f.handle.agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "Next ordinary turn" }],
    }),
  );
  await eventually(() => f.requests.length === 2);
  await assert.rejects(
    f.sessions.stop(f.human, {
      operationId: "stale",
      action: "session.stop",
      input: { sessionId: sid, expectedTurn: f.target.token },
    }),
    { code: "stale_turn" },
  );
  assert.equal(f.requests[1].signal.aborted, false);
});

test("ordinary reply stop requires current control permission including receipt replay", async (t) => {
  const f = await fixture(t),
    bot = await f.bot(),
    contact = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    }),
    actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const command = {
    operationId: "stop",
    action: "session.stop",
    input: { sessionId: f.handle.agent.id, expectedTurn: f.target.token },
  };
  await assert.rejects(f.sessions.stop(actor, command), {
    code: "access_denied",
  });
  const grant = {
    grantId: "ordinary-control",
    ownerBotId: null,
    recipientBotId: bot.botId,
    level: "control",
    active: true,
    scope: { sessions: [f.handle.agent.id] },
  };
  await f.policy.authorizeShare(f.human, {
    operationId: "grant",
    action: "grant.set",
    input: grant,
  });
  assert.equal((await f.sessions.stop(actor, command)).accepted, true);
  await f.policy.authorizeShare(f.human, {
    operationId: "revoke",
    action: "grant.set",
    input: { ...grant, active: false },
  });
  await assert.rejects(f.sessions.stop(actor, command), {
    code: "access_denied",
  });
});
