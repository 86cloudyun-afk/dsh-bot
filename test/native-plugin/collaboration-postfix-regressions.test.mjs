import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const command = (operationId, action, input) => ({
  operationId,
  action,
  input,
});
const phase = (f, meeting, current, id = current) =>
  f.collaboration.advance(
    f.human,
    command(`phase-${id}`, "meeting.advance", {
      meetingId: meeting.meetingId,
      epoch: 1,
      phase: current,
    }),
  );
const members = (f, group, bots, coordinator, id) =>
  f.collaboration.changeMembers(
    f.human,
    command(id, "group.members", {
      groupId: group.groupId,
      expectedVersion: f.store.read().groups[group.groupId].version,
      botIds: bots.map((row) => row.botId),
      coordinatorBotId: coordinator.botId,
    }),
  );
const flush = async (f) => {
  await f.store.drain();
  await new Promise((resolve) => setImmediate(resolve));
  await f.store.drain();
};

test("postfix review: contributor removal fences a pending decision based on its old opinion", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let f,
    a,
    b,
    capturedOldOpinion = false;
  const marker = "REMOVED-B-INDEPENDENT-MATERIAL";
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId].lineage;
      if (lineage.phase === "independent")
        yield* textChunks(lineage.botId === b.botId ? marker : "Independent A");
      else if (lineage.phase === "discussion")
        yield* textChunks("Discussion finished");
      else {
        const hasOld = JSON.stringify(options.messages).includes(marker);
        capturedOldOpinion = hasOld;
        if (hasOld) await gate.promise;
        yield* textChunks(
          hasOld
            ? `DECISION BASED ON ${marker}`
            : "Decision based on current contributors",
        );
      }
    },
  });
  a = await f.bot("A");
  b = await f.bot("B");
  const group = await f.group("LateDecision", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await phase(f, meeting, "independent");
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].discussion)
        .length === 2,
  );
  await phase(f, meeting, "discussion");
  await eventually(() => f.requests.length === 5 && capturedOldOpinion);
  await members(f, group, [a], a, "remove-decision-contributor");
  gate.resolve();
  await eventually(() => !!f.store.read().meetings[meeting.meetingId].decision);
  await flush(f);
  const row = f.store.read().meetings[meeting.meetingId];
  assert.equal(
    row.decision.text.includes(marker),
    false,
    "the unchanged coordinator publishes its old-roster decision after the contributor and its opinion have been removed",
  );
});

test("postfix review: an old queued request cannot consume the new topic request budget", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    group = await f.group("EpochBudget", [a]);
  const original = f.store.transact.bind(f.store);
  let changed = false,
    meetingId;
  f.store.transact = async (cmd, mutate) => {
    if (cmd.action === "collaboration.request-admitted" && !changed) {
      const binding = f.store.read().sessions[cmd.input.sessionId];
      if (binding.lineage?.epoch === 1) {
        changed = true;
        meetingId = binding.lineage.meetingId;
        await f.collaboration.changeTopic(
          f.human,
          command("topic-before-budget-commit", "meeting.topic", {
            meetingId,
            epoch: 1,
            topic: "Current topic",
            materials: "Current frozen material",
          }),
        );
      }
    }
    return original(cmd, mutate);
  };
  const initial = await f.collaboration.startMeeting(
    f.human,
    command("original-budget-meeting", "meeting.start", {
      groupId: group.groupId,
      topic: "Old topic",
      materials: "Old material",
      maxRequests: 1,
    }),
  );
  await eventually(
    () => changed && f.store.read().meetings[initial.meetingId].epoch === 2,
  );
  await eventually(() => {
    const row = f.store.read().meetings[initial.meetingId],
      binding = f.store.read().sessions[row.participants[0].sessionId];
    return ["settled", "UNKNOWN"].includes(binding.state);
  });
  await flush(f);
  const row = f.store.read().meetings[initial.meetingId];
  assert.equal(
    Object.keys(row.opinions).length,
    1,
    "the old epoch request is admitted against epoch 2 after the topic change, spends its only request, and is then rejected as stale; the new channel cannot call the provider",
  );
});

test("postfix closure: replacing a pending coordinator produces the new coordinator real decision", async (t) => {
  const old = deferred();
  t.after(() => old.resolve());
  let f, a;
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId].lineage;
      if (lineage.phase === "decision" && lineage.botId === a.botId)
        await old.promise;
      yield* textChunks(`Real ${lineage.phase} for ${lineage.botId}`);
    },
  });
  a = await f.bot("A");
  const b = await f.bot("B"),
    group = await f.group("ChangeDecisionCoordinator", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await phase(f, meeting, "independent");
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].discussion)
        .length === 2,
  );
  await phase(f, meeting, "discussion");
  await eventually(() => f.requests.length === 5);
  const oldChannel = f.store
    .read()
    .meetings[
      meeting.meetingId
    ].participants.find((row) => row.botId === a.botId).sessionId;
  await members(f, group, [a, b], b, "replace-pending-coordinator");
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].decision?.botId === b.botId,
  );
  old.resolve();
  await eventually(() => !f.ctx.agents.get(oldChannel));
  await flush(f);
  assert.equal(
    f.store.read().meetings[meeting.meetingId].decision.botId,
    b.botId,
  );
  await phase(f, meeting, "decision");
  assert.equal(f.store.read().meetings[meeting.meetingId].phase, "complete");
});

test("postfix closure: discussion rejoin produces a real epoch 3 reply and completes with no stale absence", async (t) => {
  const old = deferred();
  t.after(() => old.resolve());
  let f, a;
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId].lineage;
      if (
        lineage.phase === "discussion" &&
        lineage.botId === a.botId &&
        lineage.memberEpoch === 1
      )
        await old.promise;
      yield* textChunks(
        `Real ${lineage.phase} member epoch ${lineage.memberEpoch}`,
      );
    },
  });
  a = await f.bot("A");
  const b = await f.bot("B"),
    group = await f.group("FullRejoin", [a, b]),
    meeting = await f.meeting(group);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await phase(f, meeting, "independent");
  await eventually(() => f.requests.length === 4);
  const oldChannel = f.store
    .read()
    .meetings[
      meeting.meetingId
    ].participants.find((row) => row.botId === a.botId).sessionId;
  await members(f, group, [b], b, "remove-gated-discussion");
  await members(f, group, [a, b], b, "rejoin-current-discussion");
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].discussion[a.botId]
        ?.memberEpoch === 3,
  );
  old.resolve();
  await eventually(() => !f.ctx.agents.get(oldChannel));
  await flush(f);
  assert.equal(
    f.store.read().meetings[meeting.meetingId].absences[a.botId],
    undefined,
  );
  assert.equal(
    f.store.read().meetings[meeting.meetingId].discussion[a.botId].source
      .memberEpoch,
    3,
  );
  await phase(f, meeting, "discussion");
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].decision?.botId === b.botId,
  );
  await phase(f, meeting, "decision");
  assert.equal(f.store.read().meetings[meeting.meetingId].phase, "complete");
});

test("postfix closure: cancellation excludes late independent output and keeps the original channel sealed", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await collaborationFixture(t, {
      stream: async function* () {
        await gate.promise;
        yield* textChunks("Late sealed output");
      },
    }),
    a = await f.bot("A"),
    group = await f.group("PostfixCancel", [a]),
    meeting = await f.meeting(group),
    contact = await f.contact(a);
  await eventually(() => f.requests.length === 1);
  const channel =
    f.store.read().meetings[meeting.meetingId].participants[0].sessionId;
  await f.collaboration.cancel(
    f.human,
    command("cancel-current-independent", "meeting.cancel", {
      meetingId: meeting.meetingId,
      epoch: 1,
    }),
  );
  gate.resolve();
  await eventually(() => !f.ctx.agents.get(channel));
  const actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  assert.deepEqual(f.store.read().meetings[meeting.meetingId].opinions, {});
  assert.equal(
    f.policy.canRead(actor, { kind: "session", id: channel }),
    false,
  );
});

test("postfix closure: completed restart output remains UNKNOWN without replay and the scoped absence permits a fresh later phase", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "postfix-meeting-closure-"));
  const output = execFileSync(
    process.execPath,
    ["test/native-plugin/collaboration-crash-probe.mjs", "meeting", directory],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 10000,
    },
  );
  const prefix = JSON.parse(
    output
      .split("\n")
      .find((row) => row.startsWith("REVIEW_PREFIX "))
      .slice("REVIEW_PREFIX ".length),
  );
  const f = await collaborationFixture(t, { directory }),
    raw = await f.adapter.readNative(prefix.sessionId);
  assert.ok(
    raw.events.some(
      (row) => row.type === "turn/end" && row.data.reason.kind === "completed",
    ),
  );
  await f.recovery.reconcile(
    f.human,
    command("recover-original-meeting", "recovery.reconcile", {}),
  );
  await f.collaboration.startMeeting(f.human, prefix.startCommand);
  await flush(f);
  const row = f.store.read().meetings[prefix.meetingId],
    participant = row.participants[0];
  assert.equal(f.store.read().sessions[prefix.sessionId].state, "UNKNOWN");
  assert.equal(row.runtimeState, "UNKNOWN");
  assert.deepEqual(row.opinions, {});
  assert.equal(f.requests.length, 0);
  assert.deepEqual(row.absences[prefix.botId], {
    reason: "previous_runtime_unsettled",
    epoch: 1,
    memberEpoch: participant.memberEpoch,
    phase: "independent",
  });
  await phase(f, row, "independent", "recovered-independent");
  await eventually(
    () => !!f.store.read().meetings[row.meetingId].discussion[prefix.botId],
  );
  await phase(f, row, "discussion", "recovered-discussion");
  await eventually(() => !!f.store.read().meetings[row.meetingId].decision);
  await phase(f, row, "decision", "recovered-decision");
  const final = f.store.read().meetings[row.meetingId];
  assert.equal(final.phase, "complete");
  assert.equal(f.requests.length, 2);
  assert.equal(f.store.read().sessions[prefix.sessionId].state, "UNKNOWN");
  assert.equal(final.absenceHistory[0].reason, "previous_runtime_unsettled");
});
