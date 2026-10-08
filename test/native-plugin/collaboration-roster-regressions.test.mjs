import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  incrementStream,
  installIncrement,
  readCounters,
} from "./collaboration-counter-probe.mjs";

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
async function originals(f, meeting) {
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].opinions)
        .length === 2,
  );
  await phase(f, meeting, "independent");
}

for (const scenario of ["pending", "completed"])
  test(`round3 review: removal excludes ${scenario} discussion derived from the withdrawn participant`, async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    let f, a, b, oldDiscussion;
    const marker = "WITHDRAWN-B-OPINION";
    f = await collaborationFixture(t, {
      stream: async function* (options) {
        const lineage = f.store.read().sessions[options.sessionId].lineage,
          hasOld = JSON.stringify(options.messages).includes(marker);
        if (lineage.phase === "independent")
          yield* textChunks(
            lineage.botId === b.botId ? marker : "Independent A",
          );
        else if (lineage.phase === "discussion") {
          if (
            (scenario === "pending" && lineage.botId === a.botId) ||
            (scenario === "completed" && lineage.botId === b.botId)
          )
            await gate.promise;
          yield* textChunks(
            hasOld && lineage.botId === a.botId
              ? `DISCUSSION DERIVED FROM ${marker}`
              : "Discussion from current roster",
          );
        } else
          yield* textChunks(
            hasOld
              ? `NEW DECISION PROPAGATES ${marker}`
              : "New decision from current roster",
          );
      },
    });
    a = await f.bot("A");
    b = await f.bot("B");
    const group = await f.group(`Discussion-${scenario}`, [a, b]),
      meeting = await f.meeting(group);
    await originals(f, meeting);
    await eventually(() => f.requests.length === 4);
    if (scenario === "completed")
      await eventually(
        () => !!f.store.read().meetings[meeting.meetingId].discussion[a.botId],
      );
    const before = f.store.read().meetings[meeting.meetingId],
      removedOpinionSession = before.opinions[b.botId].source.sessionId;
    oldDiscussion = before.participants.find(
      (row) => row.botId === a.botId,
    ).sessionId;
    await members(f, group, [a], a, `withdraw-B-${scenario}`);
    gate.resolve();
    await eventually(
      () =>
        !!f.store.read().meetings[meeting.meetingId].discussion[a.botId] ||
        !!f.store.read().meetings[meeting.meetingId].absences[a.botId],
    );
    await flush(f);
    const contact = await f.contact(a),
      actor = f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
    const sourceReadable = f.policy.canRead(actor, {
        kind: "session",
        id: removedOpinionSession,
      }),
      visible = f.service
        .snapshot(actor)
        .meetings.find((row) => row.meetingId === meeting.meetingId);
    await phase(f, meeting, "discussion");
    await eventually(
      () => !!f.store.read().meetings[meeting.meetingId].decision,
    );
    await phase(f, meeting, "decision");
    const row = f.store.read().meetings[meeting.meetingId];
    assert.equal(
      row.discussion[a.botId]?.text.includes(marker) ?? false,
      false,
      "the unchanged participant retains or publishes discussion based on the withdrawn participant, then a real current decision consumes it",
    );
    assert.equal(row.decision.text.includes(marker), false);
  });

test("round3 closure: a real replacement decision wins before and after late old output", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let f, a, b;
  const marker = "OLD-DECISION-CONTRIBUTOR";
  f = await collaborationFixture(t, {
    stream: async function* (options) {
      const lineage = f.store.read().sessions[options.sessionId].lineage;
      if (lineage.phase === "independent")
        yield* textChunks(
          lineage.botId === b.botId
            ? marker
            : "Independent current coordinator",
        );
      else if (lineage.phase === "discussion")
        yield* textChunks("Valid discussion");
      else {
        const old = JSON.stringify(options.messages).includes(marker);
        if (old) await gate.promise;
        yield* textChunks(
          old
            ? `Late decision with ${marker}`
            : "Replacement decision from current roster",
        );
      }
    },
  });
  a = await f.bot("A");
  b = await f.bot("B");
  const group = await f.group("StrictDecisionFence", [a, b]),
    meeting = await f.meeting(group);
  await originals(f, meeting);
  await eventually(
    () =>
      Object.keys(f.store.read().meetings[meeting.meetingId].discussion)
        .length === 2,
  );
  await phase(f, meeting, "discussion");
  await eventually(() => f.requests.length === 5);
  const old = f.store
    .read()
    .meetings[
      meeting.meetingId
    ].participants.find((row) => row.botId === a.botId).sessionId;
  await members(f, group, [a], a, "withdraw-decision-contributor");
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].decision?.text ===
      "Replacement decision from current roster",
  );
  const fresh = f.store.read().meetings[meeting.meetingId].decision;
  assert.notEqual(fresh.source.sessionId, old);
  assert.equal(fresh.botId, a.botId);
  assert.ok(
    f.ctx.agents.get(old),
    "the old native call remains held until the test releases its late output",
  );
  gate.resolve();
  await eventually(() => !f.ctx.agents.get(old));
  await flush(f);
  assert.deepEqual(f.store.read().meetings[meeting.meetingId].decision, fresh);
  assert.equal(
    f.store.read().meetings[meeting.meetingId].absences[a.botId],
    undefined,
  );
  const history = await f.adapter.readNative(fresh.source.sessionId);
  assert.equal(
    history.events.find((row) => row.seq === fresh.source.eventSeq).data.message
      .source.kind,
    "model",
  );
});

test("round3 closure: epoch change preserves the sole request for the actual new-topic opinion", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    group = await f.group("StrictTopicBudget", [a]);
  const original = f.store.transact.bind(f.store);
  let changed = false,
    oldId;
  f.store.transact = async (cmd, mutate) => {
    if (cmd.action === "collaboration.request-admitted" && !changed) {
      const binding = f.store.read().sessions[cmd.input.sessionId];
      if (binding.lineage?.epoch === 1) {
        changed = true;
        oldId = binding.sessionId;
        await f.collaboration.changeTopic(
          f.human,
          command("queued-topic-change", "meeting.topic", {
            meetingId: binding.lineage.meetingId,
            epoch: 1,
            topic: "New epoch topic",
            materials: "NEW-EPOCH-FROZEN-MATERIAL",
          }),
        );
      }
    }
    return original(cmd, mutate);
  };
  const meeting = await f.collaboration.startMeeting(
    f.human,
    command("strict-budget-start", "meeting.start", {
      groupId: group.groupId,
      topic: "Old",
      materials: "OLD-MATERIAL",
      maxRequests: 1,
    }),
  );
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].opinions[a.botId]?.epoch === 2,
  );
  await eventually(() => !f.ctx.agents.get(oldId));
  await flush(f);
});

test("round3 closure: member rejoin at admission cannot spend budget for the old member epoch", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    b = await f.bot("B"),
    group = await f.group("StrictMemberBudget", [a, b]),
    original = f.store.transact.bind(f.store);
  let changed = false,
    oldId;
  f.store.transact = async (cmd, mutate) => {
    if (cmd.action === "collaboration.request-admitted" && !changed) {
      const binding = f.store.read().sessions[cmd.input.sessionId];
      if (binding.botId === a.botId && binding.lineage.memberEpoch === 1) {
        changed = true;
        oldId = binding.sessionId;
        await members(f, group, [b], b, "remove-old-admission-member");
        await members(f, group, [a, b], a, "rejoin-new-admission-member");
      }
    }
    return original(cmd, mutate);
  };
  const meeting = await f.collaboration.startMeeting(
    f.human,
    command("strict-member-start", "meeting.start", {
      groupId: group.groupId,
      topic: "Same frozen material",
      materials: "Current material",
      maxRequests: 2,
    }),
  );
  await eventually(
    () =>
      f.store.read().meetings[meeting.meetingId].opinions[a.botId]
        ?.memberEpoch === 3 &&
      !!f.store.read().meetings[meeting.meetingId].opinions[b.botId],
  );
  await eventually(() => !f.ctx.agents.get(oldId));
  await flush(f);
});

test("round3 closure: old-phase admission is rejected without spending the discussion and decision budget", async (t) => {
  const f = await collaborationFixture(t),
    a = await f.bot("A"),
    group = await f.group("StrictPhaseBudget", [a]),
    original = f.store.transact.bind(f.store);
  let changed = false,
    oldId;
  f.store.transact = async (cmd, mutate) => {
    if (cmd.action === "collaboration.request-admitted" && !changed) {
      const binding = f.store.read().sessions[cmd.input.sessionId];
      if (binding.lineage.phase === "independent") {
        changed = true;
        oldId = binding.sessionId;
        await f.collaboration.advance(
          f.human,
          command("skip-unstarted-independent", "meeting.advance", {
            meetingId: binding.lineage.meetingId,
            epoch: 1,
            phase: "independent",
            absences: {
              [a.botId]:
                "Explicitly skip this still unstarted independent turn.",
            },
          }),
        );
      }
    }
    return original(cmd, mutate);
  };
  const meeting = await f.collaboration.startMeeting(
    f.human,
    command("strict-phase-start", "meeting.start", {
      groupId: group.groupId,
      topic: "Phase budget",
      materials: "Current material",
      maxRequests: 2,
    }),
  );
  await eventually(
    () => !!f.store.read().meetings[meeting.meetingId].discussion[a.botId],
  );
  await phase(f, meeting, "discussion", "strict-phase-discussion");
  await eventually(() => !!f.store.read().meetings[meeting.meetingId].decision);
  await phase(f, meeting, "decision", "strict-phase-decision");
  await eventually(() => !f.ctx.agents.get(oldId));
  await flush(f);
});

test("round3 closure: repeated reconcile and original group post retries preserve UNKNOWN and never replay effects", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "round3-group-restart-"));
  const output = execFileSync(
    process.execPath,
    ["test/native-plugin/collaboration-crash-probe.mjs", "group", directory],
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
  const crashSnapshot = `${directory}-at-crash`;
  await cp(directory, crashSnapshot, { recursive: true });
  const f = await collaborationFixture(t, {
    directory,
    stream: incrementStream(),
  });
  installIncrement(f, join(directory, "review-counters.json"));
  const original =
      f.store.read().groups[prefix.groupId].rounds[prefix.intent.roundId],
    beforeMessages = f.store.read().groups[prefix.groupId].messages.length;
  for (let cycle = 0; cycle < 3; cycle++) {
    await f.recovery.reconcile(
      f.human,
      command(`repeat-reconcile-${cycle}`, "recovery.reconcile", {}),
    );
    const receipt = await f.collaboration.post(f.human, prefix.startCommand);
    assert.deepEqual(receipt, prefix.intent);
    await flush(f);
    const row = f.store.read().groups[prefix.groupId],
      round = row.rounds[prefix.intent.roundId];
    assert.equal(round.state, "UNKNOWN");
    assert.equal(round.requests, original.requests);
    assert.deepEqual(round.channels, original.channels);
    assert.equal(row.messages.length, beforeMessages);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(
      await readCounters(join(directory, "review-counters.json")),
      prefix.counters,
    );
  }
  for (const id of original.channels)
    assert.equal(f.ctx.agents.get(id), undefined);
});
