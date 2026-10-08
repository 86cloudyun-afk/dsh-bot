import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { eventually } from "./official-fixture.mjs";

test("a meeting action publishes its real task and meeting link in one durable commit", async (t) => {
  const f = await collaborationFixture(t),
    bot = await f.bot(),
    group = await f.group("Atomic", [bot]),
    meeting = await f.meeting(group);
  for (const phase of ["independent", "discussion"]) {
    await eventually(() =>
      phase === "independent"
        ? Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
            .length === 1
        : Object.keys(f.store.read().meetings[meeting.meetingId].discussion)
            .length === 1,
    );
    await f.collaboration.advance(f.human, {
      operationId: phase,
      action: "meeting.advance",
      input: { meetingId: meeting.meetingId, epoch: 1, phase },
    });
  }
  await eventually(() => f.store.read().meetings[meeting.meetingId].decision);
  const observations = [];
  t.after(
    f.store.subscribe(() => {
      const state = f.store.read();
      observations.push({
        tasks: Object.keys(state.tasks),
        actions: state.meetings[meeting.meetingId].actions,
      });
    }),
  );
  const command = {
    operationId: "atomic-action",
    action: "meeting.action",
    input: {
      meetingId: meeting.meetingId,
      epoch: 1,
      botId: bot.botId,
      title: "Real linked task",
      goal: "A harmless goal",
      criteria: [],
    },
  };
  const task = await f.collaboration.actionTask(f.human, command);
  assert.ok(
    observations.every((row) =>
      row.tasks.every((id) => row.actions.includes(id)),
    ),
  );
  assert.equal(
    (await f.collaboration.actionTask(f.human, command)).taskId,
    task.taskId,
  );
  assert.equal(Object.keys(f.store.read().tasks).length, 1);
});
