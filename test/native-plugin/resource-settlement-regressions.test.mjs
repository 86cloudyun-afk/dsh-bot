import test from "node:test";
import assert from "node:assert/strict";
import Jobs from "@deepseek-ai/dsh-jobs-local";
import { taskFixture } from "./task-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("a native maintenance promise retains its task reservation through stopping", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await taskFixture(t),
    bot = await f.bot(),
    task = await f.task(bot);
  const read = f.adapter.readNative.bind(f.adapter);
  let started = false,
    maintenance;
  f.adapter.readNative = async (sid, ...args) => {
    const value = await read(sid, ...args);
    if (!started && f.store.read().sessions[sid]?.purpose === "execution") {
      started = true;
      maintenance = f.ctx.agents.get(sid).runMaintenance(() => gate.promise);
    }
    return value;
  };
  const attempt = await f.tasks.start(f.human, {
    operationId: "start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await eventually(() => started);
  await f.tasks.stop(f.human, {
    operationId: "stop",
    action: "task.stop",
    input: { taskId: task.taskId, attemptId: attempt.attemptId, epoch: 1 },
  });
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(
    f.store.read().attempts[attempt.attemptId].reservationHeld,
    true,
  );
  gate.resolve();
  await maintenance;
  await eventually(
    () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
  );
  assert.equal(f.store.read().attempts[attempt.attemptId].state, "stopped");
});

test("owned teardown failure preserves UNKNOWN and the work reservation", async (t) => {
  const f = await taskFixture(t),
    bot = await f.bot(),
    task = await f.task(bot);
  const dispose = f.adapter.disposeOwned.bind(f.adapter);
  f.adapter.disposeOwned = async () => {
    throw Object.assign(Error("Controlled teardown failure"), {
      code: "controlled_teardown_failure",
    });
  };
  t.after(() => {
    f.adapter.disposeOwned = dispose;
  });
  const attempt = await f.tasks.start(f.human, {
    operationId: "start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: 1 },
  });
  await eventually(() =>
    ["UNKNOWN", "returned"].includes(
      f.store.read().attempts[attempt.attemptId].state,
    ),
  );
  assert.equal(f.store.read().attempts[attempt.attemptId].state, "UNKNOWN");
  assert.equal(
    f.store.read().attempts[attempt.attemptId].reservationHeld,
    true,
  );
});

test("disable drains a controller-owned restored Bot background job and leaves ordinary Agents alone", async (t) => {
  const f = await taskFixture(t),
    bot = await f.bot(),
    contact = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    });
  await f.adapter.disposeOwned(contact.sessionId);
  const restored = await f.ctx.agents.resume({
    resumeSessionId: contact.sessionId,
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => restored.dispose());
  const ordinary = await f.ctx.agents.create({
    sessionId: "ordinary",
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => ordinary.dispose());
  const jobs = f.ctx.plugin(Jobs);
  await jobs.await();
  const detach = f.ctx.jobs.attachController("test");
  t.after(detach);
  const gate = deferred();
  t.after(() => gate.resolve({ status: "killed" }));
  let cancelled = 0;
  const jobId = f.ctx.jobs.start({
    kind: "test",
    owner: contact.sessionId,
    label: "Bot-owned background work",
    run() {
      return {
        cancel() {
          cancelled++;
          gate.resolve({ status: "killed" });
        },
        done: gate.promise,
      };
    },
  });
  await f.adapter.close();
  assert.equal(cancelled, 1);
  assert.equal(f.ctx.jobs.get(jobId, contact.sessionId).status, "killed");
  assert.equal(f.ctx.agents.get(ordinary.agent.id), ordinary.agent);
});

test("disable waits for a restored Bot job producer to actually settle", async (t) => {
  const f = await taskFixture(t),
    bot = await f.bot(),
    contact = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    });
  await f.adapter.disposeOwned(contact.sessionId);
  const restored = await f.ctx.agents.resume({
    resumeSessionId: contact.sessionId,
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => restored.dispose());
  const jobs = f.ctx.plugin(Jobs);
  await jobs.await();
  const detach = f.ctx.jobs.attachController("test");
  t.after(detach);
  const gate = deferred();
  t.after(() => gate.resolve({ status: "killed" }));
  let cancelled = false,
    closed = false;
  f.ctx.jobs.start({
    kind: "test",
    owner: contact.sessionId,
    label: "Controlled slow producer",
    run() {
      return {
        cancel() {
          cancelled = true;
        },
        done: gate.promise,
      };
    },
  });
  const closing = f.adapter.close().then(() => {
    closed = true;
  });
  await eventually(() => cancelled);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, false);
  gate.resolve({ status: "killed" });
  await closing;
  assert.equal(closed, true);
});
