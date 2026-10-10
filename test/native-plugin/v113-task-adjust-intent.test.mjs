import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../src/native/store.mjs";
import { taskFixture } from "./task-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

const command = (operationId, action, input) => ({ operationId, action, input });
const revoke = (f, grant) => f.policy.authorizeShare(f.human,
  command("revoke-controller", "grant.set", { ...grant, active: false }));

async function running(f, name, parentAttemptId) {
  const task = await f.task(f.worker, name);
  const attempt = await f.tasks.start(f.human, command(`start-${name}`, "task.start", {
    taskId: task.taskId, expectedVersion: 1, ...(parentAttemptId ? { parentAttemptId } : {}),
  }));
  return { task, attempt };
}

async function controller(f) {
  const bot = await f.bot("Controller");
  f.worker = await f.bot("Worker");
  const session = await f.sessions.create(f.human, command("controller-contact", "session.create", { botId: bot.botId }));
  const actor = f.policy.fromAgent(f.ctx.agents.get(session.sessionId));
  const grant = { grantId: "controller-worker", ownerBotId: f.worker.botId,
    recipientBotId: bot.botId, active: true, level: "control", scope: { tasks: ["*"] } };
  await f.policy.authorizeShare(f.human, command("control-worker", "grant.set", grant));
  return { actor, grant };
}

for (const loseAck of [false, true])
  test(`accepted adjustment fences its exact old subtree before caller revocation${loseAck ? " and survives a lost acknowledgement" : ""}`, async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await taskFixture(t, { stream: async function* () {
      await gate.promise;
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield { type: "block-end", index: 0, block: { type: "tool-call", id: "old-generation-help",
        name: "dsh_bot", arguments: JSON.stringify({ action: "help", input: {} }) } };
      yield { type: "finish", reason: { kind: "tool-calls" } };
      yield* textChunks("Obsolete definition must not continue");
    } });
    const { actor, grant } = await controller(f), parent = await running(f, "Parent"),
      child = await running(f, "Child", parent.attempt.attemptId);
    await eventually(() => f.requests.length === 2);
    const adjust = command("adjust-definition", "task.adjust", {
      taskId: parent.task.taskId, expectedVersion: 2, goal: "Current definition",
    });
    const transact = f.store.transact.bind(f.store);
    let commit, intercepted = false;
    f.store.transact = async (cmd, mutate) => {
      const result = await transact(cmd, mutate);
      if (cmd.action === "task.adjust" && !intercepted) {
        intercepted = true;
        commit = f.store.read();
        await revoke(f, grant);
        if (loseAck) throw Object.assign(Error("Controlled lost adjustment acknowledgement"), { code: "controlled_ack_loss" });
      }
      return result;
    };
    let firstError;
    try { await f.tasks.adjust(actor, adjust); } catch (error) { firstError = error.code; }
    assert.equal(commit.attempts[parent.attempt.attemptId].state, "stop_requested");
    assert.equal(commit.attempts[child.attempt.attemptId].state, "stop_requested");
    assert.equal(firstError, loseAck ? "controlled_ack_loss" : undefined);
    const intent = commit.tasks[parent.task.taskId].adjustStop,
      savedReceipt = commit.operations[intent.stopOperationId];
    assert.equal(savedReceipt.action, "task.stop");
    assert.deepEqual(savedReceipt.result.attemptIds, [parent.attempt.attemptId, child.attempt.attemptId]);
    assert.equal(savedReceipt.result.epoch, parent.attempt.epoch);
    assert.equal(savedReceipt.fingerprint, digest(f.policy.command(actor, command(intent.stopOperationId,
      "task.stop", { taskId: parent.task.taskId, attemptId: parent.attempt.attemptId, epoch: parent.attempt.epoch }))));
    await f.tasks.adjust(actor, adjust);
    assert.deepEqual(f.store.read().operations[intent.stopOperationId], savedReceipt);
    assert.equal(f.store.read().tasks[parent.task.taskId].definitionVersion, 2);
    gate.resolve();
    await eventually(() => [parent, child].every(row => !f.store.read().attempts[row.attempt.attemptId].reservationHeld));
    assert.equal(f.requests.length, 2, "the old generation cannot start another provider request");
    for (const row of [parent, child]) {
      const settled = f.store.read().attempts[row.attempt.attemptId];
      assert.equal(settled.state, "stopped");
      assert.equal(settled.stopOperationId, intent.stopOperationId);
      assert.equal(settled.epoch, row.attempt.epoch);
      assert.equal(settled.localEvidence.settled, true);
    }
  });

test("an original partial adjustment receipt repairs only its known live old attempt after revocation", async (t) => {
  const gate = deferred(); t.after(() => gate.resolve());
  const f = await taskFixture(t, { stream: async function* () { await gate.promise; yield* textChunks("Original native work"); } });
  const { actor, grant } = await controller(f), parent = await running(f, "LegacyParent");
  await eventually(() => f.requests.length === 1);
  const adjust = command("legacy-adjustment", "task.adjust", { taskId: parent.task.taskId,
    expectedVersion: 2, goal: "Previously accepted current definition" });
  const stamped = f.policy.command(actor, adjust), stopOperationId = "original-adjustment-stop";
  await f.store.transact(command("legacy-partial-receipt", "fixture.legacy-receipt", {}), draft => {
    const task = draft.tasks[parent.task.taskId];
    task.goal = adjust.input.goal; task.version++; task.definitionVersion++;
    task.acceptance = "unknown"; task.state = "adjusted";
    task.adjustStop = { operationId: adjust.operationId, stopOperationId,
      attemptId: parent.attempt.attemptId, epoch: parent.attempt.epoch };
    draft.operations[adjust.operationId] = { action: "task.adjust", fingerprint: digest(stamped), result: structuredClone(task) };
    return null;
  });
  await revoke(f, grant);
  const originalReceipt = structuredClone(f.store.read().operations[adjust.operationId]);
  await f.tasks.adjust(actor, adjust);
  assert.deepEqual(f.store.read().operations[adjust.operationId], originalReceipt);
  assert.equal(f.store.read().attempts[parent.attempt.attemptId].state, "stop_requested");
  assert.equal(f.store.read().attempts[parent.attempt.attemptId].stopOperationId, stopOperationId);
  assert.equal(f.store.read().operations[stopOperationId].result.attemptId, parent.attempt.attemptId);
  gate.resolve();
  await eventually(() => !f.store.read().attempts[parent.attempt.attemptId].reservationHeld);
  assert.equal(f.requests.length, 1);
});
