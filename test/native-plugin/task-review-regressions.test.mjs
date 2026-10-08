import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { taskFixture } from "./task-fixture.mjs";
import { brokerFixture } from "./broker-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("review: changed criteria reject the stopped obsolete attempt", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await taskFixture(t, {
    stream: async function* () {
      await gate.promise;
      yield* textChunks("Old goal result");
    },
  });
  const bot = await f.bot(),
    task = await f.task(bot),
    attempt = await f.tasks.start(f.human, {
      operationId: "start",
      action: "task.start",
      input: { taskId: task.taskId, expectedVersion: 1 },
    });
  await eventually(() => f.requests.length === 1);
  await f.tasks.adjust(f.human, {
    operationId: "adjust",
    action: "task.adjust",
    input: {
      taskId: task.taskId,
      expectedVersion: f.store.read().tasks[task.taskId].version,
      goal: "A different goal",
      criteria: ["Entirely different acceptance conditions"],
    },
  });
  gate.resolve();
  await eventually(
    () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
  );
  const current = f.store.read().tasks[task.taskId];
  await assert.rejects(
    f.tasks.accept(f.human, {
      operationId: "accept-obsolete",
      action: "task.accept",
      input: {
        taskId: task.taskId,
        expectedVersion: current.version,
        attemptId: attempt.attemptId,
        outcome: "passed",
        evidence: "Old goal result",
      },
    }),
    { code: "stale_attempt" },
  );
  assert.equal(f.store.read().attempts[attempt.attemptId].state, "stopped");
  assert.equal(f.store.read().tasks[task.taskId].acceptance, "unknown");
  assert.equal(f.requests.length, 1);
});

test("review: results reach the original ordinary session", async (t) => {
  const f = await brokerFixture(t),
    bot = await f.bot();
  const ordinary = await f.ctx.agents.create({
    sessionId: randomUUID(),
    meta: { cwd: f.dir },
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => ordinary.dispose());
  await f.ctx.sessions.flush(ordinary.agent.session);
  // Controller facade exercises original native inbox delivery; stock GUI tests use the real controller.
  let delivered = 0;
  f.ctx.provide("sessionController", {
    async prompt(request, signal) {
      signal.throwIfAborted();
      delivered++;
      ordinary.agent.followup(
        createUserMessage({
          content: request.content,
          source: { kind: "user", rpcId: request.requestId },
        }),
      );
      await f.ctx.sessions.flush(ordinary.agent.session);
      return { accepted: true };
    },
  });
  const task = await f.tasks.create(f.human, {
    operationId: "ordinary-origin-task",
    action: "task.create",
    input: {
      botId: bot.botId,
      title: "Return to origin",
      goal: "Harmless reply",
      criteria: [],
      originSessionId: ordinary.agent.id,
    },
  });
  const attempt = await f.tasks.start(f.human, {
    operationId: "start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await eventually(() =>
    Object.values(f.store.read().outbox).some(
      (row) => row.attemptId === attempt.attemptId && row.state === "accepted",
    ),
  );
  const row = Object.values(f.store.read().outbox).find(
    (row) => row.attemptId === attempt.attemptId,
  );
  assert.equal(row.state, "accepted");
  assert.equal(row.sessionId, ordinary.agent.id);
  assert.ok(f.requests.length >= 1);
  assert.equal(delivered, 1);
  assert.equal(
    (await f.adapter.readNative(ordinary.agent.id)).events.some(
      (event) =>
        event.type === "agent/inbox/spliced" &&
        event.data.inserted.some(
          (message) => message.source?.rpcId === row.message.id,
        ),
    ),
    true,
  );
});

test("review: restore retains UNKNOWN when the original log is absent", async (t) => {
  const f = await brokerFixture(t),
    bot = await f.bot(),
    create = f.adapter.createOwned.bind(f.adapter);
  f.adapter.createOwned = async () => {
    throw Object.assign(Error("Controlled interrupted native create"), {
      code: "interrupted",
    });
  };
  await assert.rejects(
    f.sessions.create(f.human, {
      operationId: "interrupted-create",
      action: "session.create",
      input: { botId: bot.botId },
    }),
    { code: "interrupted" },
  );
  f.adapter.createOwned = create;
  const original = Object.values(f.store.read().sessions).find(
    (row) => row.operationId === "interrupted-create",
  );
  assert.equal(original.state, "UNKNOWN");
  await assert.rejects(f.adapter.readNative(original.sessionId));
  await assert.rejects(
    f.sessions.restore(f.human, {
      operationId: "restore-unknown",
      action: "session.restore",
      input: { sessionId: original.sessionId },
    }),
    { code: "recovery_required" },
  );
  assert.equal(f.store.read().sessions[original.sessionId].state, "UNKNOWN");
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.adapter.readNative(original.sessionId));
});

test("review: parent remains held while a child admitted during native read is active", async (t) => {
  const childGate = deferred(),
    readEntered = deferred(),
    releaseRead = deferred();
  t.after(() => {
    childGate.resolve();
    releaseRead.resolve();
  });
  const f = await taskFixture(t, {
    stream: async function* (options) {
      if (JSON.stringify(options.messages).includes("执行任务 Child"))
        await childGate.promise;
      yield* textChunks("Actual result");
    },
  });
  const bot = await f.bot(),
    parent = await f.task(bot, "Parent"),
    read = f.adapter.readNative.bind(f.adapter),
    settle = f.store.transact.bind(f.store),
    settlementTried = deferred();
  let parentSession;
  f.store.transact = (command, mutate) => {
    const result = settle(command, mutate);
    if (command.action === "attempt.settled")
      result.finally(() => settlementTried.resolve()).catch(() => {});
    return result;
  };
  f.adapter.readNative = async (sessionId, signal) => {
    if (sessionId === parentSession) {
      readEntered.resolve();
      await releaseRead.promise;
    }
    return read(sessionId, signal);
  };
  const parentAttempt = await f.tasks.start(f.human, {
    operationId: "parent-start",
    action: "task.start",
    input: { taskId: parent.taskId, expectedVersion: 1 },
  });
  parentSession = parentAttempt.sessionId;
  await readEntered.promise;
  const child = await f.task(bot, "Child"),
    childAttempt = await f.tasks.start(f.human, {
      operationId: "child-start",
      action: "task.start",
      input: {
        taskId: child.taskId,
        expectedVersion: 1,
        parentAttemptId: parentAttempt.attemptId,
      },
    });
  await eventually(() => f.requests.length === 2);
  releaseRead.resolve();
  await settlementTried.promise;
  await f.store.drain();
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
    true,
  );
  assert.equal(
    f.store.read().attempts[childAttempt.attemptId].reservationHeld,
    true,
  );
  assert.equal(f.adapter.resources(childAttempt.sessionId).settled, false);
  childGate.resolve();
  await eventually(
    () => !f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
  );
});

test("review: a late canceled launch preserves proven stopped settlement", async (t) => {
  const created = deferred(),
    launchGate = deferred();
  t.after(() => launchGate.resolve());
  const f = await taskFixture(t),
    bot = await f.bot(),
    task = await f.task(bot),
    create = f.adapter.createOwned.bind(f.adapter);
  f.adapter.createOwned = async (binding) => {
    const handle = await create(binding);
    created.resolve();
    await launchGate.promise;
    return handle;
  };
  const pending = f.tasks.start(f.human, {
    operationId: "start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  pending.catch(() => {});
  await created.promise;
  const attempt = Object.values(f.store.read().attempts).find(
    (row) => row.taskId === task.taskId,
  );
  await f.tasks.stop(f.human, {
    operationId: "stop-before-ready",
    action: "task.stop",
    input: {
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      epoch: attempt.epoch,
    },
  });
  await eventually(
    () => f.store.read().attempts[attempt.attemptId].state === "stopped",
  );
  launchGate.resolve();
  await assert.rejects(pending, { code: "stale_attempt" });
  const final = f.store.read().attempts[attempt.attemptId];
  assert.equal(final.state, "stopped");
  assert.equal(final.reservationHeld, false);
  assert.equal(f.store.read().tasks[task.taskId].state, "stopped");
  assert.equal(f.requests.length, 0);
});

test("review: an authentic child result reaches its original active execution parent", async (t) => {
  const parentGate = deferred();
  t.after(() => parentGate.resolve());
  const f = await brokerFixture(t, {
    stream: async function* (options) {
      if (JSON.stringify(options.messages).includes("执行任务 Parent"))
        await parentGate.promise;
      yield* textChunks("Child actual result");
    },
  });
  const bot = await f.bot(),
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
      goal: "Harmless child work",
      criteria: [],
    },
  });
  assert.equal(child.originSessionId, parentAttempt.sessionId);
  const childAttempt = await f.tasks.start(actor, {
    operationId: "child-start",
    action: "task.start",
    input: { taskId: child.taskId, expectedVersion: 1 },
  });
  assert.equal(childAttempt.parentAttemptId, parentAttempt.attemptId);
  await eventually(
    () =>
      f.store.read().outbox[childAttempt.resultOutboxId]?.state === "accepted",
  );
  const outbox = f.store.read().outbox[childAttempt.resultOutboxId];
  assert.equal(outbox.state, "accepted");
  assert.equal(
    f.store.read().attempts[childAttempt.attemptId].state,
    "returned",
  );
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
    true,
  );
  assert.equal(f.requests.length, 2);
  parentGate.resolve();
  await eventually(
    () => !f.store.read().attempts[parentAttempt.attemptId].reservationHeld,
  );
  assert.equal(
    f.store.read().attempts[parentAttempt.attemptId].state,
    "returned",
  );
});
