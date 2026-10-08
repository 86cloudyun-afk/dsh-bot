import test from "node:test";
import assert from "node:assert/strict";
import { taskFixture } from "./task-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("an admitted child has real native ownership, descriptor and catalog identity", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await taskFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("Harmless native reply");
      },
    }),
    bot = await f.bot(),
    parent = await f.task(bot, "Parent"),
    root = await f.tasks.start(f.human, {
      operationId: "parent-start",
      action: "task.start",
      input: { taskId: parent.taskId, expectedVersion: 1 },
    });
  const child = await f.task(bot, "Child"),
    attempt = await f.tasks.start(f.human, {
      operationId: "child-start",
      action: "task.start",
      input: {
        taskId: child.taskId,
        expectedVersion: 1,
        parentAttemptId: root.attemptId,
      },
    });
  await eventually(() => f.requests.length === 2);
  const agent = f.ctx.agents.get(attempt.sessionId);
  await f.ctx.sessions.flush(agent.session);
  assert.equal(agent.session.header.parentSession, root.sessionId);
  assert.equal(agent.session.header.delegationDepth, 1);
  const history = await f.adapter.readNative(attempt.sessionId),
    descriptor = history.events.find(
      (row) => row.type === "subagent/descriptor",
    );
  assert.equal(descriptor?.data.mode, "one-shot");
  const catalog = await f.ctx.subagents.listChildren(
    root.sessionId,
    new AbortController().signal,
  );
  assert.ok(
    catalog.some(
      (row) => row.id === attempt.sessionId && row.mode === "one-shot",
    ),
  );
  await f.tasks.stop(f.human, {
    operationId: "stop-root",
    action: "task.stop",
    input: { taskId: parent.taskId, attemptId: root.attemptId, epoch: 1 },
  });
  gate.resolve();
  await eventually(
    () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
  );
  assert.equal(f.store.read().attempts[attempt.attemptId].state, "stopped");
});
