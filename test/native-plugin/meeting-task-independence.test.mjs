import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";

for (const cancellationPhase of ["decision", "complete"])
  test(`cancel a ${cancellationPhase} meeting without cancelling its linked task`, async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    let f;
    f = await collaborationFixture(t, {
      stream: async function* (options) {
        if (f.store.read().sessions[options.sessionId].purpose === "execution")
          await gate.promise;
        yield* textChunks("A harmless actual native result");
      },
    });
    const a = await f.bot("A"),
      b = await f.bot("B"),
      group = await f.group("Task-separation", [a, b]),
      meeting = await f.meeting(group);
    const advance = (phase) =>
      f.collaboration.advance(f.human, {
        operationId: `advance-${phase}`,
        action: "meeting.advance",
        input: { meetingId: meeting.meetingId, epoch: 1, phase },
      });
    await eventually(
      () =>
        Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
          .length === 2,
    );
    await advance("independent");
    await eventually(
      () =>
        Object.keys(f.store.read().meetings[meeting.meetingId].discussion)
          .length === 2,
    );
    await advance("discussion");
    await eventually(() => f.store.read().meetings[meeting.meetingId].decision);
    if (cancellationPhase === "complete") await advance("decision");
    const contact = await f.contact(a),
      agent = f.ctx.agents.get(contact.sessionId),
      call = async (id, args) => {
        const result = await f.ctx.tools.execute({
          callId: id,
          name: "dsh_bot",
          agent,
          signal: new AbortController().signal,
          arguments: args,
        });
        assert.equal(result.isError, false, JSON.stringify(result.content));
        return JSON.parse(result.content[0].text);
      };
    await call("read-meeting", { action: "snapshot", input: {} });
    const task = await call("link-task", {
      operationId: "link-task",
      action: "meeting.action",
      input: {
        meetingId: meeting.meetingId,
        epoch: 1,
        botId: a.botId,
        title: "Independent action",
        goal: "Give one harmless result",
        criteria: ["Actual native result"],
      },
    });
    const attempt = await f.tasks.start(f.human, {
      operationId: "start",
      action: "task.start",
      input: { taskId: task.taskId, expectedVersion: task.version },
    });
    await eventually(() =>
      f.requests.some((row) => row.sessionId === attempt.sessionId),
    );
    await f.collaboration.cancel(f.human, {
      operationId: "cancel-meeting",
      action: "meeting.cancel",
      input: { meetingId: meeting.meetingId, epoch: 1 },
    });
    assert.equal(f.store.read().attempts[attempt.attemptId].state, "running");
    gate.resolve();
    await eventually(
      () => !f.store.read().attempts[attempt.attemptId].reservationHeld,
    );
    assert.equal(f.store.read().attempts[attempt.attemptId].state, "returned");
  });

test("cancellation before reveal retains the independent opinion barrier", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    group = await f.group("Not-revealed", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  const foreign =
    f.store.read().meetings[meeting.meetingId].opinions[b.botId].source
      .sessionId;
  await f.collaboration.cancel(f.human, {
    operationId: "cancel",
    action: "meeting.cancel",
    input: { meetingId: meeting.meetingId, epoch: 1 },
  });
  const contact = await f.contact(a),
    actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  assert.equal(
    f.policy.canRead(actor, { kind: "session", id: foreign }),
    false,
  );
});
