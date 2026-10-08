import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

const command = (operationId, action, input) => ({
  operationId,
  action,
  input,
});
const drain = async (f) => {
  await f.store.drain();
  await new Promise((resolve) => setImmediate(resolve));
  await f.store.drain();
  await new Promise((resolve) => setImmediate(resolve));
};
async function advance(f, meeting, phase, id = phase) {
  return f.collaboration.advance(
    f.human,
    command(`advance-${id}`, "meeting.advance", {
      meetingId: meeting.meetingId,
      epoch: 1,
      phase,
    }),
  );
}
async function changeMembers(f, group, bots, coordinator, id) {
  const row = f.store.read().groups[group.groupId];
  return f.collaboration.changeMembers(
    f.human,
    command(id, "group.members", {
      groupId: group.groupId,
      expectedVersion: row.version,
      botIds: bots.map((bot) => bot.botId),
      coordinatorBotId: coordinator.botId,
    }),
  );
}

test("review: removing the coordinator must leave the ongoing meeting able to decide", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    group = await f.group("Coordinator", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await changeMembers(f, group, [b], b, "replace-coordinator");
  await advance(f, meeting, "independent");
  await eventually(
    () => !!f.store.read().meetings[meeting.meetingId].discussion[b.botId],
  );
  await advance(f, meeting, "discussion");
  await drain(f);
  const row = f.store.read().meetings[meeting.meetingId];
  let error;
  try {
    await advance(f, meeting, "decision");
  } catch (e) {
    error = e.code;
  }
  assert.equal(
    row.coordinatorBotId,
    b.botId,
    "the removed coordinator still owns the meeting; no active participant is scheduled in the decision phase",
  );
});

test("review: removing a not-yet-run group member must terminate the original round", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await collaborationFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("First current member reply");
      },
    }),
    a = await f.bot("A"),
    b = await f.bot("B"),
    group = await f.group("Running", [a, b]);
  const intent = await f.collaboration.post(
    f.human,
    command("post-before-member-change", "group.post", {
      groupId: group.groupId,
      text: "Please discuss.",
    }),
  );
  await eventually(() => f.requests.length === 1);
  await changeMembers(f, group, [a], a, "remove-upcoming-member");
  gate.resolve();
  await eventually(() =>
    f.store
      .read()
      .groups[
        group.groupId
      ].messages.some((row) => row.producer.kind === "bot"),
  );
  await eventually(
    () =>
      !f.ctx.agents.get(
        f.store.read().groups[group.groupId].rounds[intent.roundId].channels[0],
      ),
  );
  await drain(f);
  const round = f.store.read().groups[group.groupId].rounds[intent.roundId];
  assert.equal(
    round.state,
    "complete",
    "stale_member escapes outside the per-member catch and leaves the round permanently running",
  );
});

test("review: an independent-phase absence must not stand in for an unfinished discussion turn", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let f;
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const phase = f.store.read().sessions[options.sessionId].lineage.phase;
      if (phase === "independent") throw Error("Independent provider failed");
      if (phase === "discussion") await gate.promise;
      yield* textChunks("Later phase reply");
    },
  });
  const a = await f.bot("A"),
    group = await f.group("Absence", [a]),
    meeting = await f.meeting(group);
  await eventually(
    () => !!f.store.read().meetings[meeting.meetingId].absences[a.botId],
  );
  const firstAbsence =
    f.store.read().meetings[meeting.meetingId].absences[a.botId];
  await advance(f, meeting, "independent");
  await eventually(() => f.requests.length === 2);
  let accepted = false,
    error;
  try {
    await advance(f, meeting, "discussion");
    accepted = true;
  } catch (e) {
    error = e.code;
  }
  assert.equal(
    accepted,
    false,
    "the prior independent failure silently authorizes advancing before the discussion has completed or has a current absence",
  );
});

test("review: a real task created by the meeting coordinator must execute after the meeting completes", async (t) => {
  let f,
    a,
    actionCalled = false;
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId]?.lineage;
      if (lineage?.phase === "decision" && !actionCalled) {
        actionCalled = true;
        const args = command("real-coordinator-action", "task.create", {
          botId: a.botId,
          title: "Coordinator action",
          goal: "One harmless actual response.",
          criteria: ["Response exists"],
        });
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield {
          type: "block-end",
          index: 0,
          block: {
            type: "tool-call",
            id: "make-action",
            name: "dsh_bot",
            arguments: JSON.stringify(args),
          },
        };
        yield { type: "finish", reason: { kind: "tool-calls" } };
      } else yield* textChunks("Current phase completed");
    },
  });
  a = await f.bot("A");
  const group = await f.group("Action", [a]),
    meeting = await f.meeting(group);
  await eventually(
    () => !!f.store.read().meetings[meeting.meetingId].opinions[a.botId],
  );
  await advance(f, meeting, "independent");
  await eventually(
    () => !!f.store.read().meetings[meeting.meetingId].discussion[a.botId],
  );
  await advance(f, meeting, "discussion");
  await eventually(() => !!f.store.read().meetings[meeting.meetingId].decision);
  const row = f.store.read().meetings[meeting.meetingId],
    task = Object.values(f.store.read().tasks).find(
      (task) => task.title === "Coordinator action",
    );
  assert.ok(task, "the real native coordinator tool created the task");
  await advance(f, meeting, "decision");
  const before = f.requests.length;
  const attempt = await f.tasks.start(
    f.human,
    command("execute-meeting-action", "task.start", {
      taskId: task.taskId,
      expectedVersion: 1,
    }),
  );
  await eventually(
    () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
  );
  const current = f.store.read().attempts[attempt.attemptId],
    events = (await f.adapter.readNative(attempt.sessionId)).events.filter(
      (row) => row.type === "turn/end",
    );
  assert.equal(
    current.state,
    "returned",
    "inherited decision lineage rejects the action execution as stale_meeting before any provider request",
  );
});

test("review: rejoining during discussion must start a new current-generation channel", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let f, a;
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId].lineage;
      if (lineage.phase === "discussion" && lineage.botId === a.botId)
        await gate.promise;
      yield* textChunks("Current generation reply");
    },
  });
  a = await f.bot("A");
  const b = await f.bot("B"),
    group = await f.group("DiscussionRejoin", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await advance(f, meeting, "independent");
  await eventually(() => f.requests.length === 4);
  const old = f.store
    .read()
    .meetings[
      meeting.meetingId
    ].participants.find((row) => row.botId === a.botId).sessionId;
  await changeMembers(f, group, [b], b, "discussion-remove");
  await changeMembers(f, group, [a, b], b, "discussion-rejoin");
  gate.resolve();
  await drain(f);
  const row = f.store.read().meetings[meeting.meetingId],
    participant = row.participants.find((row) => row.botId === a.botId);
  assert.notEqual(
    participant.sessionId,
    old,
    "the rejoined participant retains the cancelled old-member-epoch channel and never receives a new discussion turn",
  );
});
