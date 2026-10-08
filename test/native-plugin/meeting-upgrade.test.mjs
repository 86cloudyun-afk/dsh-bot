import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

const command = (operationId, action, input) => ({ operationId, action, input });
async function legacyAction(f) {
  const a = await f.bot("A"), b = await f.bot("B"),
    group = await f.group("Legacy", [a, b]), meeting = await f.meeting(group);
  for (const phase of ["independent", "discussion"]) {
    await eventually(() => Object.keys(f.store.read().meetings[meeting.meetingId][phase === "independent" ? "opinions" : "discussion"]).length === 2);
    await f.collaboration.advance(f.human, command(phase, "meeting.advance", { meetingId: meeting.meetingId, epoch: 1, phase }));
  }
  await eventually(() => f.store.read().meetings[meeting.meetingId].decision);
  await f.collaboration.advance(f.human, command("complete", "meeting.advance", { meetingId: meeting.meetingId, epoch: 1, phase: "decision" }));
  const contact = await f.contact(a), actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId)),
    foreignId = f.store.read().meetings[meeting.meetingId].opinions[b.botId].source.sessionId,
    input = { botId: a.botId, title: "Prior action", goal: "A harmless real result", criteria: [] },
    original = command("legacy-action", "meeting.action", { meetingId: meeting.meetingId, epoch: 1, ...input });
  f.policy.noteRead(actor, { kind: "session", id: foreignId });
  // Actual old business path: create a real task, then save a separate link
  // receipt. The old schema did not record revealedEpoch on the meeting.
  const task = await f.tasks.create(actor, command(original.operationId, "task.create", input));
  await f.store.transact(command(`${original.operationId}:meeting-link`, "meeting.task-linked", { meetingId: meeting.meetingId, epoch: 1, taskId: task.taskId }), draft => {
    draft.meetings[meeting.meetingId].actions.push(task.taskId);
    delete draft.meetings[meeting.meetingId].revealedEpoch;
    return null;
  });
  return { a, b, meeting, actor, original, task, foreignId };
}

test("cancelling an upgraded revealed meeting keeps its existing action runnable", async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  let f;
  f = await collaborationFixture(t, { stream: async function* (options) {
    if (f.store.read().sessions[options.sessionId].purpose === "execution") await gate.promise;
    yield* textChunks("Actual result from a retained action");
  } });
  const prior = await legacyAction(f), attempt = await f.tasks.start(f.human, command("start-prior-action", "task.start", { taskId: prior.task.taskId, expectedVersion: prior.task.version }));
  await eventually(() => f.requests.some(row => row.sessionId === attempt.sessionId));
  await f.collaboration.cancel(f.human, command("cancel-prior-meeting", "meeting.cancel", { meetingId: prior.meeting.meetingId, epoch: 1 }));
  gate.resolve();
  await eventually(() => !f.store.read().attempts[attempt.attemptId].reservationHeld);
  assert.equal(f.store.read().attempts[attempt.attemptId].state, "returned");
  assert.equal(f.store.read().meetings[prior.meeting.meetingId].revealedEpoch, 1);
});

test("the exact old action command returns its original linked receipt without a second task", async t => {
  const f = await collaborationFixture(t), prior = await legacyAction(f),
    revision = f.store.read().revision, calls = f.requests.length;
  for (let i = 0; i < 3; i++) assert.deepEqual(await f.collaboration.actionTask(prior.actor, prior.original), prior.task);
  assert.equal(f.store.read().revision, revision);
  assert.equal(f.requests.length, calls);
  assert.equal(Object.keys(f.store.read().tasks).length, 1);
});

test("old action lookup rejects changed meeting, payload and caller and does not repair an incomplete link", async t => {
  const f = await collaborationFixture(t), prior = await legacyAction(f),
    other = await f.contact(prior.a, "other-contact"), otherActor = f.policy.fromAgent(f.ctx.agents.get(other.sessionId));
  for (const changed of [
    { ...prior.original, input: { ...prior.original.input, meetingId: "meeting_other" } },
    { ...prior.original, input: { ...prior.original.input, epoch: 2 } },
    { ...prior.original, input: { ...prior.original.input, goal: "Changed goal" } },
  ]) await assert.rejects(f.collaboration.actionTask(prior.actor, changed), { code: "operation_conflict" });
  await assert.rejects(f.collaboration.actionTask(otherActor, prior.original), { code: "operation_conflict" });
  await f.store.transact(command("incomplete-prior-link", "fixture.incomplete-link", {}), draft => {
    delete draft.operations[`${prior.original.operationId}:meeting-link`];
    draft.meetings[prior.meeting.meetingId].actions = [];
    return null;
  });
  const before = f.store.read();
  await assert.rejects(f.collaboration.actionTask(prior.actor, prior.original), { code: "recovery_required" });
  assert.deepEqual(f.store.read(), before);
});
