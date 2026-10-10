import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { brokerFixture } from "./broker-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("review: task launch and result retain their durably reserved message IDs", async (t) => {
  const f = await brokerFixture(t),
    bot = await f.bot(),
    contact = await f.contact(bot);
  const task = await f.tasks.create(f.human, {
    operationId: "identity-task",
    action: "task.create",
    input: {
      botId: bot.botId,
      title: "Reserved identities",
      goal: "One harmless reply",
      criteria: [],
      originSessionId: contact.sessionId,
    },
  });
  const attempt = await f.tasks.start(f.human, {
    operationId: "identity-start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await eventually(
    () => f.store.read().outbox[attempt.resultOutboxId]?.state === "accepted",
  );
  const launch = (await f.adapter.readNative(attempt.sessionId)).events.find(
    (row) => row.type === "user/message",
  );
  const result = f.store.read().outbox[attempt.resultOutboxId];
  assert.equal(launch.data.id, attempt.messageId);
  assert.equal(result.message.id, attempt.resultMessageId);
});

test("review: the genuine parent request consumes its exact child result", async (t) => {
  const parentGate = deferred();
  t.after(() => parentGate.resolve());
  const f = await brokerFixture(t, {
      stream: async function* (options) {
        const parent = JSON.stringify(options.messages).includes(
          "执行任务 Parent",
        );
        if (parent) await parentGate.promise;
        yield* textChunks(
          parent
            ? "Parent actual final response"
            : "CHILD_NATIVE_ACTUAL_RESULT",
        );
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
  await eventually(
    () =>
      f.store.read().outbox[childAttempt.resultOutboxId]?.state === "accepted",
  );
  parentGate.resolve();
  await eventually(
    () => !f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
  );
  const parentRequests = f.requests.filter(
    (row) => row.sessionId === parentAttempt.sessionId,
  );
  assert.equal(parentRequests.length, 2);
  assert.ok(
    JSON.stringify(parentRequests[1].messages).includes(
      "CHILD_NATIVE_ACTUAL_RESULT",
    ),
  );
  const outbox = f.store.read().outbox[childAttempt.resultOutboxId],
    history = await f.adapter.readNative(parentAttempt.sessionId);
  assert.equal(
    history.events.filter(
      (event) =>
        event.type === "user/message" && event.data.id === outbox.message.id,
    ).length,
    1,
  );
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].state,
    "returned",
  );
});

test("review: idle parent waits for delayed child result and consumes it", async (t) => {
  const parentGate = deferred(),
    childGate = deferred(),
    deliveryEntered = deferred(),
    deliveryGate = deferred();
  t.after(() => {
    parentGate.resolve();
    childGate.resolve();
    deliveryGate.resolve();
  });
  const f = await brokerFixture(t, {
      stream: async function* (options) {
        if (JSON.stringify(options.messages).includes("执行任务 Parent"))
          await parentGate.promise;
        else await childGate.promise;
        yield* textChunks("Actual native reply");
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
  const deliver = f.broker.deliver.bind(f.broker);
  f.broker.deliver = async (id) => {
    if (id === childAttempt.resultOutboxId) {
      deliveryEntered.resolve();
      await deliveryGate.promise;
    }
    return deliver(id);
  };
  parentGate.resolve();
  await f.ctx.agents.get(parentAttempt.sessionId).whenIdle();
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
    true,
  );
  childGate.resolve();
  await deliveryEntered.promise;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
    true,
  );
  assert.equal(
    f.store.read().outbox[childAttempt.resultOutboxId].state,
    "queued",
  );
  deliveryGate.resolve();
  await eventually(
    () =>
      f.store.read().outbox[childAttempt.resultOutboxId].state === "accepted",
  );
  await eventually(
    () => !f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
  );
  const outbox = f.store.read().outbox[childAttempt.resultOutboxId];
  assert.equal(outbox.error, undefined);
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].state,
    "returned",
  );
  assert.equal(
    (await f.adapter.readNative(parentAttempt.sessionId)).events.some(
      (event) =>
        event.type === "user/message" && event.data.id === outbox.message.id,
    ),
    true,
  );
  assert.equal(
    f.requests.filter((row) => row.sessionId === parentAttempt.sessionId)
      .length,
    2,
  );
});

test("review: restored origin receives its known-unadmitted original result", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await brokerFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("ARCHIVED_ORIGIN_RESULT");
      },
    }),
    bot = await f.bot(),
    origin = await f.contact(bot);
  const task = await f.tasks.create(f.human, {
    operationId: "task-create",
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
    operationId: "start",
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
  await f.sessions.restore(f.human, {
    operationId: "restore-origin",
    action: "session.restore",
    input: { sessionId: origin.sessionId },
  });
  assert.equal(f.store.read().sessions[origin.sessionId].archived, false);
  assert.equal(
    (await f.broker.deliver(attempt.resultOutboxId)).state,
    "accepted",
  );
  const reconciled = await f.broker.reconcile(f.human, {
    operationId: "reconcile-result",
    action: "outbox.reconcile",
    input: { outboxId: attempt.resultOutboxId },
  });
  assert.equal(reconciled.state, "accepted");
  assert.equal(reconciled.error, undefined);
  assert.equal(
    (await f.adapter.readNative(origin.sessionId)).events.some(
      (event) =>
        event.type === "user/message" &&
        event.data.id === reconciled.message.id,
    ),
    true,
  );
});

test("review: revoked derived reads fence ordinary result publication", async (t) => {
  const entered = deferred(),
    release = deferred();
  t.after(() => release.resolve());
  const f = await brokerFixture(t, {
      stream: async function* () {
        yield* textChunks("REVOKED_RESULT_MARKER");
      },
    }),
    a = await f.bot("A"),
    b = await f.bot("B"),
    contact = await f.contact(a);
  const ordinary = await f.ctx.agents.create({
    sessionId: randomUUID(),
    meta: { cwd: f.dir },
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => ordinary.dispose());
  await f.ctx.sessions.flush(ordinary.agent.session);
  let delivered = 0;
  f.ctx.provide("sessionController", {
    async resolveAgent(sessionId) {
      assert.equal(sessionId, ordinary.agent.id);
      delivered++;
      return { agent: ordinary.agent };
    },
  });
  await f.policy.authorizeShare(f.human, {
    operationId: "ordinary-control",
    action: "grant.set",
    input: {
      grantId: "ordinary",
      ownerBotId: null,
      recipientBotId: a.botId,
      level: "control",
      scope: { sessions: [ordinary.agent.id] },
      active: true,
    },
  });
  const memory = await f.bots.memoryWrite(f.human, {
    operationId: "shared-memory",
    action: "memory.write",
    input: { botId: b.botId, text: "REVOKED_RESULT_MARKER" },
  });
  const actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  f.policy.noteRead(actor, { kind: "memory", id: memory.memoryId });
  const task = await f.tasks.create(actor, {
    operationId: "create-work",
    action: "task.create",
    input: {
      botId: a.botId,
      title: "Derived work",
      goal: "Report the shared marker",
      criteria: [],
      originSessionId: ordinary.agent.id,
    },
  });
  const deliver = f.broker.deliver.bind(f.broker);
  f.broker.deliver = async (id) => {
    entered.resolve();
    await release.promise;
    return deliver(id);
  };
  const attempt = await f.tasks.start(actor, {
    operationId: "start-work",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await entered.promise;
  const contactTask = await f.tasks.create(actor, {
    operationId: "create-contact-control",
    action: "task.create",
    input: {
      botId: a.botId,
      title: "Derived contact control",
      goal: "Report the shared marker",
      criteria: [],
      originSessionId: contact.sessionId,
    },
  });
  const contactAttempt = await f.tasks.start(actor, {
    operationId: "start-contact-control",
    action: "task.start",
    input: { taskId: contactTask.taskId, expectedVersion: 1 },
  });
  await eventually(
    () =>
      f.store.read().outbox[contactAttempt.resultOutboxId]?.state === "queued",
  );
  await f.policy.authorizeShare(f.human, {
    operationId: "revoke-shared-memory",
    action: "share.set",
    input: {
      botId: b.botId,
      share: {
        enabled: false,
        receivers: ["*"],
        scope: { sessions: ["*"], tasks: ["*"], memories: ["*"] },
      },
    },
  });
  assert.equal(
    f.policy.canRead(actor, { kind: "memory", id: memory.memoryId }),
    false,
  );
  release.resolve();
  await eventually(
    () => f.store.read().outbox[attempt.resultOutboxId]?.state === "blocked",
  );
  const row = f.store.read().outbox[attempt.resultOutboxId];
  assert.ok(
    row.origins.some(
      (ref) => ref.kind === "memory" && ref.id === memory.memoryId,
    ),
  );
  assert.equal(delivered, 0);
  assert.equal(row.error, "access_denied");
  await eventually(
    () =>
      f.store.read().outbox[contactAttempt.resultOutboxId].state === "blocked",
  );
  assert.equal(
    f.store.read().outbox[contactAttempt.resultOutboxId].error,
    "access_denied",
  );
  assert.equal(
    f.requests.filter((request) => request.sessionId === contact.sessionId)
      .length,
    0,
  );
  assert.equal(
    JSON.stringify(
      (await f.adapter.readNative(ordinary.agent.id)).events,
    ).includes("REVOKED_RESULT_MARKER"),
    false,
  );
});
