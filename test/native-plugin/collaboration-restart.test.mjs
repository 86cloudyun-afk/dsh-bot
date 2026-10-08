import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { deferred, eventually, textChunks } from "./official-fixture.mjs";
import {
  incrementStream,
  installIncrement,
  readCounters,
} from "./collaboration-counter-probe.mjs";

async function crashPrefix(mode) {
  const directory = await mkdtemp(
    join(tmpdir(), `review-collaboration-${mode}-`),
  );
  const output = execFileSync(
    process.execPath,
    ["test/native-plugin/collaboration-crash-probe.mjs", mode, directory],
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
  return { directory, prefix, crashSnapshot };
}

test("review: retrying a group post after restart must not replay its original member work", async (t) => {
  const { directory, prefix } = await crashPrefix("group"),
    f = await collaborationFixture(t, { directory, stream: incrementStream() });
  installIncrement(f, join(directory, "review-counters.json"));
  const before = f.store.read().groups[prefix.groupId];
  assert.equal(before.rounds[prefix.intent.roundId].state, "running");
  assert.equal(
    before.messages.filter((row) => row.producer.kind === "bot").length,
    1,
  );
  await f.recovery.reconcile(f.human, {
    operationId: "restart-reconcile",
    action: "recovery.reconcile",
    input: {},
  });
  const receipt = await f.collaboration.post(f.human, prefix.startCommand);
  assert.equal(receipt.roundId, prefix.intent.roundId);
  await f.store.drain();
  await new Promise((resolve) => setImmediate(resolve));
  const after = f.store.read().groups[prefix.groupId];
  const counters = await readCounters(join(directory, "review-counters.json"));
  assert.equal(after.rounds[prefix.intent.roundId].state, "UNKNOWN");
  assert.deepEqual(counters, prefix.counters);
  assert.equal(
    after.rounds[prefix.intent.roundId].channels.length,
    before.rounds[prefix.intent.roundId].channels.length,
  );
  assert.equal(
    f.requests.length,
    0,
    "the original post restarts every member from cycle zero, including an already committed member reply and an unresolved prior request",
  );
});

test("review: a completed original native opinion must be reconciled or explicitly unknown after restart", async (t) => {
  const { directory, prefix } = await crashPrefix("meeting"),
    f = await collaborationFixture(t, { directory });
  const raw = await f.adapter.readNative(prefix.sessionId);
  assert.ok(
    raw.events.some(
      (row) => row.seq === prefix.eventSeq && row.type === "assistant/message",
    ),
  );
  assert.ok(
    raw.events.some(
      (row) => row.type === "turn/end" && row.data.reason.kind === "completed",
    ),
  );
  await f.recovery.reconcile(f.human, {
    operationId: "restart-reconcile",
    action: "recovery.reconcile",
    input: {},
  });
  await f.collaboration.startMeeting(f.human, prefix.startCommand);
  await f.store.drain();
  await new Promise((resolve) => setImmediate(resolve));
  const meeting = f.store.read().meetings[prefix.meetingId],
    binding = f.store.read().sessions[prefix.sessionId];
  assert.ok(
    meeting.opinions[prefix.botId] || binding.state === "UNKNOWN",
    "recovery leaves the terminated channel falsely ready, while the original completed reply is never imported and no truthful absence is recorded",
  );
});
