import test from "node:test";
import assert from "node:assert/strict";
import { ConversationBroker } from "../../src/native/broker.mjs";
import { brokerFixture } from "./broker-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("native archive and unarchive fence and recover the same Bot delivery", async (t) => {
  const f = await brokerFixture(t),
    bot = await f.bot(),
    origin = await f.contact(bot);
  await f.ctx.workspaceRegistry.archiveSession(origin.sessionId);
  const row = await f.broker.enqueue(f.human, {
    operationId: "native-archived-message",
    action: "session.send",
    input: { sessionId: origin.sessionId, text: "Original message" },
  });
  assert.equal(row.state, "blocked");
  assert.equal(row.nativeAdmission, false);
  assert.equal(f.requests.length, 0);
  assert.equal(
    (await f.sessions.list(f.human)).items.find(
      (item) => item.sessionId === origin.sessionId,
    ).archived,
    true,
  );
  await f.ctx.workspaceRegistry.unarchiveSession(origin.sessionId);
  const result = await f.broker.deliver(row.outboxId);
  assert.equal(result.state, "accepted");
  assert.equal(result.message.id, row.message.id);
  await eventually(() => f.requests.length === 1);
});

test("review: UNKNOWN child delivery keeps parent held and cold reconciliation never resends", async (t) => {
  const parentGate = deferred(),
    childGate = deferred();
  t.after(() => {
    parentGate.resolve();
    childGate.resolve();
  });
  const f = await brokerFixture(t, {
      stream: async function* (options) {
        if (JSON.stringify(options.messages).includes("执行任务 Parent"))
          await parentGate.promise;
        else await childGate.promise;
        yield* textChunks("Actual native child and parent reply");
      },
    }),
    bot = await f.bot(),
    parent = await f.task(bot, "Parent");
  const parentAttempt = await f.tasks.start(f.human, {
    operationId: "parent-start",
    action: "task.start",
    input: { taskId: parent.taskId, expectedVersion: 1 },
  });
  await eventually(() => f.requests.length === 1);
  const actor = f.policy.fromAgent(f.ctx.agents.get(parentAttempt.sessionId));
  const child = await f.tasks.create(actor, {
    operationId: "child-create",
    action: "task.create",
    input: {
      botId: bot.botId,
      title: "Child",
      goal: "Harmless work",
      criteria: [],
    },
  });
  const childAttempt = await f.tasks.start(actor, {
    operationId: "child-start",
    action: "task.start",
    input: { taskId: child.taskId, expectedVersion: 1 },
  });
  await eventually(() => f.requests.length === 2);
  parentGate.resolve();
  await f.ctx.agents.get(parentAttempt.sessionId).whenIdle();
  const flush = f.ctx.sessions.flush.bind(f.ctx.sessions);
  let lost = false;
  f.ctx.sessions.flush = async (session) => {
    await flush(session);
    if (session.id === parentAttempt.sessionId && !lost) {
      lost = true;
      throw Error("Controlled lost child admission ACK");
    }
  };
  childGate.resolve();
  await eventually(
    () =>
      f.store.read().outbox[childAttempt.resultOutboxId]?.state === "UNKNOWN",
  );
  await f.ctx.agents.get(parentAttempt.sessionId).whenIdle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(f.adapter.resources(parentAttempt.sessionId).settled, true);
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
    true,
  );
  const original = f.store.read().outbox[childAttempt.resultOutboxId];
  assert.equal(original.nativeAdmission, true);
  assert.equal((await f.broker.deliver(original.outboxId)).state, "UNKNOWN");
  assert.equal(
    f.requests.filter((row) => row.sessionId === parentAttempt.sessionId)
      .length,
    2,
  );
  const restored = await f.broker.reconcile(f.human, {
    operationId: "cold-reconcile",
    action: "outbox.reconcile",
    input: { outboxId: original.outboxId },
  });
  assert.equal(restored.state, "accepted");
  assert.equal(restored.message.id, original.message.id);
  assert.equal(restored.operationId, original.operationId);
  await eventually(
    () => !f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
  );
  await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      f.broker.reconcile(f.human, {
        operationId: `repeat-unknown-reconcile-${index}`,
        action: "outbox.reconcile",
        input: { outboxId: original.outboxId },
      }),
    ),
  );
  assert.equal(
    f.requests.filter((row) => row.sessionId === parentAttempt.sessionId)
      .length,
    2,
  );
  assert.equal(
    (await f.adapter.readNative(parentAttempt.sessionId)).events.filter(
      (event) =>
        event.type === "user/message" && event.data.id === original.message.id,
    ).length,
    1,
  );
});

test("review: explicit recovery delivers known-unadmitted result after broker restart", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await brokerFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("Original result");
      },
    }),
    bot = await f.bot(),
    origin = await f.contact(bot);
  const task = await f.tasks.create(f.human, {
    operationId: "create-task",
    action: "task.create",
    input: {
      botId: bot.botId,
      title: "Work",
      goal: "Harmless work",
      criteria: [],
      originSessionId: origin.sessionId,
    },
  });
  const attempt = await f.tasks.start(f.human, {
    operationId: "start-task",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await eventually(() => f.requests.length === 1);
  await f.sessions.archive(f.human, {
    operationId: "archive-origin",
    action: "session.archive",
    input: { sessionId: origin.sessionId },
  });
  gate.resolve();
  await eventually(
    () => f.store.read().outbox[attempt.resultOutboxId]?.state === "blocked",
  );
  const original = f.store.read().outbox[attempt.resultOutboxId];
  assert.equal(original.nativeAdmission, false);
  await f.broker.close();
  const replacement = new ConversationBroker(f);
  f.beforeClose.unshift(() => replacement.close());
  f.recovery.broker = replacement;
  await f.recovery.reconcile(f.human, {
    operationId: "new-runtime-recovery",
    action: "recovery.reconcile",
    input: {},
  });
  assert.equal(f.store.read().outbox[original.outboxId].state, "blocked");
  await f.sessions.restore(f.human, {
    operationId: "restore-origin",
    action: "session.restore",
    input: { sessionId: origin.sessionId },
  });
  f.policy.requireTaskResultDelivery(f.store.read().outbox[original.outboxId]);
  const result = await replacement.reconcile(f.human, {
    operationId: "retry-original-result",
    action: "outbox.reconcile",
    input: { outboxId: original.outboxId },
  });
  assert.equal(result.state, "accepted");
  assert.equal(result.error, undefined);
  assert.equal(result.message.id, original.message.id);
  assert.equal(
    (await f.adapter.readNative(origin.sessionId)).events.some(
      (event) =>
        event.type === "user/message" && event.data.id === original.message.id,
    ),
    true,
  );
});
