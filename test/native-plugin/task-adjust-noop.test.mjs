import test from "node:test";
import assert from "node:assert/strict";
import { taskFixture } from "./task-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

for (const variant of ["unchanged-definition", "previous-adjustment", "same-owner"])
  test(`an active task ${variant} adjustment preserves its real result`, async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await taskFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("Actual unchanged task result");
      },
    });
    const bot = await f.bot(), task = await f.task(bot);
    let ready = task;
    if (variant === "previous-adjustment") {
      ready = await f.tasks.adjust(f.human, {
        operationId: "adjust-before-start",
        action: "task.adjust",
        input: { taskId: task.taskId, expectedVersion: ready.version, goal: "Updated before execution" },
      });
      // Existing v1.1.1 records retain this unbound historical field after a
      // definition adjustment. It must not control a subsequently admitted run.
      await f.store.transact({ operationId: "legacy-adjustment-record", action: "fixture.legacy-adjustment", input: {} }, draft => {
        draft.tasks[task.taskId].adjustStopId = "historical-adjustment-stop";
        return null;
      });
    }
    const attempt = await f.tasks.start(f.human, {
      operationId: "start",
      action: "task.start",
      input: { taskId: task.taskId, expectedVersion: ready.version },
    });
    await eventually(() => f.requests.length === 1);
    const before = f.store.read().tasks[task.taskId];
    const command = {
      operationId: "unchanged-adjustment",
      action: "task.adjust",
      input: {
        taskId: task.taskId,
        expectedVersion: before.version,
        title: before.title,
        goal: before.goal,
        criteria: before.criteria,
        ...(variant === "same-owner" ? { botId: bot.botId } : {}),
      },
    };
    const unchanged = await f.tasks.adjust(f.human, command);
    assert.deepEqual(unchanged, before);
    assert.equal(f.store.read().attempts[attempt.attemptId].state, "running");
    await f.tasks.submit(f.human, {
      operationId: "report-after-noop",
      action: "task.submit",
      input: { taskId: task.taskId, attemptId: attempt.attemptId, epoch: attempt.epoch, report: "Still executing the original definition" },
    });
    gate.resolve();
    await eventually(() => !f.store.read().attempts[attempt.attemptId].reservationHeld);
    const settled = f.store.read();
    assert.equal(settled.attempts[attempt.attemptId].state, "returned");
    assert.ok(settled.attempts[attempt.attemptId].result);
    assert.equal(settled.tasks[task.taskId].state, "awaiting_acceptance");
    assert.equal(settled.tasks[task.taskId].definitionVersion, before.definitionVersion);
    assert.equal(f.requests.length, 1);
  });

test("retrying a definition adjustment cannot stop a later attempt", async (t) => {
  const firstGate = deferred(), nextGate = deferred();
  t.after(() => { firstGate.resolve(); nextGate.resolve(); });
  const f = await taskFixture(t, {
    stream: async function* (_options, number) {
      await (number === 1 ? firstGate : nextGate).promise;
      yield* textChunks("Actual result for the admitted definition");
    },
  });
  const bot = await f.bot(), task = await f.task(bot), first = await f.tasks.start(f.human, {
    operationId: "first-start", action: "task.start", input: { taskId: task.taskId, expectedVersion: task.version },
  });
  await eventually(() => f.requests.length === 1);
  const command = {
    operationId: "meaningful-adjustment", action: "task.adjust",
    input: { taskId: task.taskId, expectedVersion: f.store.read().tasks[task.taskId].version, goal: "Execute the second definition" },
  };
  await f.tasks.adjust(f.human, command);
  assert.equal(f.store.read().attempts[first.attemptId].state, "stop_requested");
  firstGate.resolve();
  await eventually(() => !f.store.read().attempts[first.attemptId].reservationHeld);
  const next = await f.tasks.start(f.human, {
    operationId: "next-start", action: "task.start",
    input: { taskId: task.taskId, expectedVersion: f.store.read().tasks[task.taskId].version },
  });
  await eventually(() => f.requests.length === 2);
  await f.tasks.adjust(f.human, command);
  assert.equal(f.store.read().attempts[next.attemptId].state, "running");
  assert.equal(f.store.read().attempts[next.attemptId].stopOperationId, undefined);
  nextGate.resolve();
  await eventually(() => !f.store.read().attempts[next.attemptId].reservationHeld);
  assert.equal(f.store.read().attempts[next.attemptId].state, "returned");
  assert.equal(f.requests.length, 2);
});
