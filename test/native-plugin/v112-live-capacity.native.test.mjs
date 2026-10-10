import test from "node:test";
import assert from "node:assert/strict";
import { brokerFixture } from "./broker-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

test("fifteen live work slots leave the same Bot contact responsive and settle their original results", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let f;
  f = await brokerFixture(t, {
    stream: async function* (options) {
      const execution = f.store.read().sessions[options.sessionId]?.purpose === "execution";
      if (execution) await gate.promise;
      yield* textChunks(execution ? `Execution result ${options.sessionId}` : "Contact replied while all work slots were occupied");
    },
  });
  const bot = await f.bot(), attempts = [];
  for (let index = 0; index < 15; index++) {
    const task = await f.task(bot, `Live-${index}`);
    attempts.push(await f.tasks.start(f.human, {
      operationId: `live-start-${index}`,
      action: "task.start",
      input: { taskId: task.taskId, expectedVersion: task.version },
    }));
  }
  await eventually(() => f.requests.length === 15);
  assert.equal(new Set(f.requests.map(request => request.sessionId)).size, 15);
  for (const attempt of attempts) {
    assert.equal(f.store.read().attempts[attempt.attemptId].reservationHeld, true);
    assert.equal(f.store.read().attempts[attempt.attemptId].state, "running");
    assert.equal(f.adapter.resources(attempt.sessionId).models, 1);
    assert.equal(f.adapter.resources(attempt.sessionId).settled, false);
    assert.ok(f.ctx.agents.get(attempt.sessionId));
  }

  const overflow = await f.task(bot, "Overflow"), beforeOverflow = f.store.read(),
    agentIds = f.ctx.agents.list().map(agent => agent.id).sort();
  await assert.rejects(f.tasks.start(f.human, {
    operationId: "overflow-start",
    action: "task.start",
    input: { taskId: overflow.taskId, expectedVersion: overflow.version },
  }), { code: "capacity_exhausted" });
  assert.deepEqual(Object.keys(f.store.read().attempts), Object.keys(beforeOverflow.attempts));
  assert.deepEqual(Object.keys(f.store.read().sessions), Object.keys(beforeOverflow.sessions));
  assert.deepEqual(f.ctx.agents.list().map(agent => agent.id).sort(), agentIds);
  assert.equal(f.requests.length, 15);
  assert.equal(f.store.read().tasks[overflow.taskId].currentAttemptId, null);

  const contact = await f.contact(bot, "main-contact"), delivery = await f.broker.enqueue(f.human, {
    operationId: "contact-during-full-work",
    action: "session.send",
    input: { sessionId: contact.sessionId, text: "Please reply while every work slot is still occupied." },
  });
  assert.equal(delivery.state, "accepted");
  await eventually(() => f.events.get(contact.sessionId)?.some(event => event.type === "turn/end"));
  await f.ctx.agents.get(contact.sessionId).whenIdle();
  await f.ctx.sessions.flush(f.ctx.agents.get(contact.sessionId).session);
  const contactHistory = await f.adapter.readNative(contact.sessionId);
  assert.ok(contactHistory.events.some(event => event.type === "assistant/message" &&
    event.data.message.content.some(block => block.type === "text" && block.text === "Contact replied while all work slots were occupied")));
  assert.equal(f.requests.length, 16);
  assert.equal(f.requests.at(-1).sessionId, contact.sessionId);
  assert.equal(f.requests.filter(request => request.sessionId === contact.sessionId).length, 1);
  assert.equal(Object.values(f.store.read().attempts).filter(attempt => attempt.botId === bot.botId && attempt.reservationHeld).length, 15);
  assert.ok(attempts.every(attempt => f.adapter.resources(attempt.sessionId).models === 1));

  gate.resolve();
  await eventually(() => attempts.every(attempt => !f.store.read().attempts[attempt.attemptId].reservationHeld));
  const state = f.store.read();
  for (const attempt of attempts) {
    const settled = state.attempts[attempt.attemptId], task = state.tasks[attempt.taskId],
      history = await f.adapter.readNative(attempt.sessionId);
    assert.equal(settled.state, "returned");
    assert.equal(settled.epoch, attempt.epoch);
    assert.equal(task.currentAttemptId, attempt.attemptId);
    assert.equal(task.state, "awaiting_acceptance");
    assert.equal(settled.result.content[0].text, `Execution result ${attempt.sessionId}`);
    assert.equal(history.events.filter(event => event.type === "user/message" && event.data.id === attempt.messageId).length, 1);
    assert.equal(f.requests.filter(request => request.sessionId === attempt.sessionId).length, 1);
    assert.equal(f.ctx.agents.get(attempt.sessionId), undefined);
    assert.equal(f.adapter.resources(attempt.sessionId).settled, true);
    assert.equal(settled.localEvidence.settled, true);
  }
  assert.equal(f.requests.length, 16);
  assert.equal(Object.values(state.attempts).filter(attempt => attempt.reservationHeld).length, 0);
  await f.adapter.disposeOwned(contact.sessionId);
  assert.equal(f.ctx.agents.get(contact.sessionId), undefined);
  assert.equal(f.adapter.resources(contact.sessionId).settled, true);
  assert.deepEqual(f.ctx.agents.list(), []);
});
