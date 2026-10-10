import test from "node:test";
import assert from "node:assert/strict";
import { brokerFixture } from "./broker-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

for (const timing of ["before-admission", "after-acceptance"])
  test(`a missing native delivery scan ${timing} cannot erase live admission`, async (t) => {
    const authorizeEntered = deferred(), authorizeGate = deferred(), readEntered = deferred(), readGate = deferred();
    t.after(() => { authorizeGate.resolve(); readGate.resolve(); });
    const f = await brokerFixture(t), bot = await f.bot(), contact = await f.contact(bot);
    const resume = f.adapter.resumeOwned.bind(f.adapter), read = f.adapter.readNative.bind(f.adapter);
    let delayedResume = false, delayedRead = false;
    f.adapter.resumeOwned = async binding => {
      if (binding.sessionId === contact.sessionId && !delayedResume) {
        delayedResume = true;
        authorizeEntered.resolve();
        await authorizeGate.promise;
      }
      return resume(binding);
    };
    const send = f.broker.enqueue(f.human, {
      operationId: "original-message", action: "session.send",
      input: { sessionId: contact.sessionId, text: "Actual original message" },
    });
    await authorizeEntered.promise;
    const original = Object.values(f.store.read().outbox)[0];
    f.adapter.readNative = async id => {
      const history = await read(id);
      if (id === contact.sessionId && !delayedRead) {
        delayedRead = true;
        readEntered.resolve(history);
        await readGate.promise;
      }
      return history;
    };
    const reconcile = f.broker.reconcile(f.human, {
      operationId: "inspect-original", action: "outbox.reconcile", input: { outboxId: original.outboxId },
    });
    const stale = await readEntered.promise;
    assert.equal(stale.events.some(event => event.type === "user/message" && event.data.id === original.message.id), false);
    let accepted;
    if (timing === "before-admission") {
      readGate.resolve();
      assert.equal((await reconcile).state, "queued");
      authorizeGate.resolve();
      accepted = await send;
    } else {
      authorizeGate.resolve();
      accepted = await send;
      assert.equal(accepted.state, "accepted");
      readGate.resolve();
      assert.deepEqual(await reconcile, accepted);
    }
    await eventually(() => f.events.get(contact.sessionId)?.some(event => event.type === "turn/end"));
    const current = f.store.read().outbox[original.outboxId], history = await read(contact.sessionId);
    assert.equal(current.state, "accepted");
    assert.deepEqual(current.nativeEvidence, accepted.nativeEvidence);
    assert.equal(history.events.filter(event => event.type === "user/message" && event.data.id === original.message.id).length, 1);
    assert.equal(f.requests.length, 1);
    await f.bots.delete(f.human, {
      operationId: "delete-with-settled-delivery", action: "bot.delete",
      input: { botId: bot.botId, expectedVersion: bot.revision },
    });
  });

test("a late delivery error preserves native acceptance already reconciled", async (t) => {
  const entered = deferred(), gate = deferred();
  t.after(() => gate.resolve());
  const f = await brokerFixture(t), bot = await f.bot(), contact = await f.contact(bot),
    flush = f.ctx.sessions.flush.bind(f.ctx.sessions);
  let delayed = false;
  f.ctx.sessions.flush = async (session, ...args) => {
    const result = await flush(session, ...args);
    if (session.id === contact.sessionId && !delayed) {
      delayed = true;
      entered.resolve();
      await gate.promise;
      throw Object.assign(Error("Controlled lost native flush acknowledgement"), { code: "controlled_flush_ack_loss" });
    }
    return result;
  };
  const send = f.broker.enqueue(f.human, {
    operationId: "send", action: "session.send",
    input: { sessionId: contact.sessionId, text: "The original single input" },
  });
  await entered.promise;
  const original = Object.values(f.store.read().outbox)[0], accepted = await f.broker.reconcile(f.human, {
    operationId: "known-native-admission", action: "outbox.reconcile", input: { outboxId: original.outboxId },
  });
  assert.equal(accepted.state, "accepted");
  gate.resolve();
  assert.deepEqual(await send, accepted);
  await eventually(() => f.events.get(contact.sessionId)?.some(event => event.type === "turn/end"));
  assert.deepEqual(f.store.read().outbox[original.outboxId], accepted);
  assert.equal(f.requests.length, 1);
});

test("stale child delivery inspection cannot retain a parent after real settlement", async (t) => {
  const parentGate = deferred(), authorizeEntered = deferred(), authorizeGate = deferred(),
    readEntered = deferred(), readGate = deferred();
  t.after(() => { parentGate.resolve(); authorizeGate.resolve(); readGate.resolve(); });
  const f = await brokerFixture(t, {
    stream: async function* (options) {
      const parent = JSON.stringify(options.messages).includes("执行任务 ParentRace");
      if (parent) await parentGate.promise;
      yield* textChunks(parent ? "Actual parent reply" : "Actual child result consumed once");
    },
  });
  const bot = await f.bot(), parent = await f.task(bot, "ParentRace"), root = await f.tasks.start(f.human, {
    operationId: "root-start", action: "task.start", input: { taskId: parent.taskId, expectedVersion: 1 },
  });
  await eventually(() => f.requests.length === 1);
  const actor = f.policy.fromAgent(f.ctx.agents.get(root.sessionId)), child = await f.tasks.create(actor, {
    operationId: "child-create", action: "task.create",
    input: { botId: bot.botId, title: "ChildRace", goal: "Harmless reply", criteria: [] },
  });
  const resume = f.adapter.resumeOwned.bind(f.adapter), read = f.adapter.readNative.bind(f.adapter);
  let delayedResume = false, delayedRead = false;
  f.adapter.resumeOwned = async binding => {
    if (binding.sessionId === root.sessionId && !delayedResume) {
      delayedResume = true;
      authorizeEntered.resolve();
      await authorizeGate.promise;
    }
    return resume(binding);
  };
  const attempt = await f.tasks.start(actor, {
    operationId: "child-start", action: "task.start", input: { taskId: child.taskId, expectedVersion: 1 },
  });
  await authorizeEntered.promise;
  const original = f.store.read().outbox[attempt.resultOutboxId];
  f.adapter.readNative = async id => {
    const history = await read(id);
    if (id === root.sessionId && !delayedRead) {
      delayedRead = true;
      readEntered.resolve();
      await readGate.promise;
    }
    return history;
  };
  const reconcile = f.broker.reconcile(f.human, {
    operationId: "child-inspection", action: "outbox.reconcile", input: { outboxId: original.outboxId },
  });
  await readEntered.promise;
  authorizeGate.resolve();
  await eventually(() => f.store.read().outbox[original.outboxId].state === "accepted");
  readGate.resolve();
  assert.equal((await reconcile).state, "accepted");
  parentGate.resolve();
  await eventually(() => !f.store.read().attempts[root.attemptId].reservationHeld);
  const history = await read(root.sessionId), state = f.store.read();
  assert.equal(state.attempts[attempt.attemptId].reservationHeld, false);
  assert.equal(state.attempts[root.attemptId].state, "returned");
  assert.equal(f.adapter.resources(root.sessionId).settled, true);
  assert.equal(history.events.filter(event =>
    event.type === "user/message" && event.data.id === original.message.id,
  ).length, 1);
  const parentRequests = f.requests.filter(request => request.sessionId === root.sessionId);
  assert.equal(parentRequests.length, 2);
  assert.equal(parentRequests.filter(request => JSON.stringify(request.messages).includes("Actual child result consumed once")).length, 1);
});
