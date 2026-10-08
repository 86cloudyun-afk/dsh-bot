import test from "node:test";
import assert from "node:assert/strict";
import { taskFixture } from "./task-fixture.mjs";
import { eventually } from "./official-fixture.mjs";

async function contact(f, bot, id) {
  const row = await f.sessions.create(f.human, {
    operationId: id,
    action: "session.create",
    input: { botId: bot.botId },
  });
  return f.policy.fromAgent(f.ctx.agents.get(row.sessionId));
}
async function closeShare(f, bot) {
  await f.policy.authorizeShare(f.human, {
    operationId: "close-share",
    action: "share.set",
    input: {
      botId: bot.botId,
      share: {
        enabled: false,
        receivers: ["*"],
        scope: { sessions: ["*"], tasks: ["*"], memories: ["*"] },
      },
    },
  });
}

test("a previously acknowledged task mutation is rechecked before returning its result", async (t) => {
  const f = await taskFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    task = await f.task(b),
    actor = await contact(f, a, "reader");
  await f.policy.authorizeShare(f.human, {
    operationId: "control",
    action: "grant.set",
    input: {
      grantId: "control",
      ownerBotId: b.botId,
      recipientBotId: a.botId,
      level: "control",
      active: true,
      scope: { tasks: [task.taskId] },
    },
  });
  const command = {
    operationId: "rename",
    action: "task.adjust",
    input: {
      taskId: task.taskId,
      expectedVersion: task.version,
      title: "Adjusted task",
    },
  };
  await f.service.dispatch(actor, command);
  await closeShare(f, b);
  await assert.rejects(f.service.dispatch(actor, command), {
    code: "access_denied",
  });
});

test("adjusted task content retains the writer memory dependencies and original creator", async (t) => {
  const f = await taskFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    task = await f.task(a),
    actor = await contact(f, a, "writer");
  const memory = await f.bots.memoryWrite(f.human, {
    operationId: "memory",
    action: "memory.write",
    input: { botId: b.botId, text: "A shared planning detail" },
  });
  await f.service.dispatch(actor, {
    action: "memory.search",
    input: { botId: b.botId },
  });
  await f.service.dispatch(actor, {
    operationId: "adjust",
    action: "task.adjust",
    input: {
      taskId: task.taskId,
      expectedVersion: task.version,
      goal: "Use the shared planning detail",
    },
  });
  const stored = f.store.read().tasks[task.taskId];
  assert.deepEqual(stored.createdBy, { kind: "human" });
  assert.deepEqual(stored.source, { kind: "human" });
  assert.ok(
    stored.origins.some(
      (ref) => ref.kind === "memory" && ref.id === memory.memoryId,
    ),
  );
  await closeShare(f, b);
  const clean = await contact(f, a, "new-reader");
  assert.equal(
    f.policy.canRead(clean, { kind: "task", id: task.taskId }),
    false,
  );
});

test("task acceptance evidence retains the accepting writer dependencies", async (t) => {
  const f = await taskFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    task = await f.task(a),
    attempt = await f.tasks.start(f.human, {
      operationId: "start",
      action: "task.start",
      input: { taskId: task.taskId, expectedVersion: task.version },
    });
  await eventually(
    () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
  );
  const actor = await contact(f, a, "acceptor"),
    memory = await f.bots.memoryWrite(f.human, {
      operationId: "memory",
      action: "memory.write",
      input: { botId: b.botId, text: "A shared acceptance detail" },
    });
  await f.service.dispatch(actor, {
    action: "memory.search",
    input: { botId: b.botId },
  });
  const current = f.store.read().tasks[task.taskId];
  await f.service.dispatch(actor, {
    operationId: "accept",
    action: "task.accept",
    input: {
      taskId: task.taskId,
      expectedVersion: current.version,
      attemptId: attempt.attemptId,
      outcome: "unknown",
      evidence: "The shared acceptance detail requires follow-up",
    },
  });
  assert.ok(
    f.store
      .read()
      .tasks[task.taskId].origins.some((ref) => ref.id === memory.memoryId),
  );
  await closeShare(f, b);
  assert.equal(
    f.policy.canRead(await contact(f, a, "new-reader"), {
      kind: "task",
      id: task.taskId,
    }),
    false,
  );
});
