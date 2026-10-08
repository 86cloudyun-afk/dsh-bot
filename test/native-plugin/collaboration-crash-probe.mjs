import { writeSync } from "node:fs";
import { collaborationFixture } from "./collaboration-fixture.mjs";
import { eventually, textChunks } from "./official-fixture.mjs";
import { join } from "node:path";
import {
  incrementStream,
  installIncrement,
  readCounters,
} from "./collaboration-counter-probe.mjs";

const [mode, directory] = process.argv.slice(2);
let f,
  b,
  startCommand,
  blocked = false;
const report = (value) => {
  writeSync(1, `REVIEW_PREFIX ${JSON.stringify(value)}\n`);
  process.exit(0);
};
f = await collaborationFixture(
  { after() {} },
  {
    directory,
    stream:
      mode === "group"
        ? incrementStream()
        : async function* () {
            yield* textChunks("Persisted original real model reply");
          },
  },
);
const a = await f.bot("A");
if (mode === "group") b = await f.bot("B");
if (mode === "group") {
  for (const bot of [a, b])
    await f.bots.update(f.human, {
      operationId: `probe-${bot.botId}`,
      action: "bot.update",
      input: {
        botId: bot.botId,
        expectedVersion: bot.revision,
        capabilities: ["review_increment"],
      },
    });
  installIncrement(f, join(directory, "review-counters.json"), {
    shouldBlock: (botId) => botId === b.botId,
    onBlock: () => {
      blocked = true;
    },
  });
}
const group = await f.group(`Crash-${mode}`, b ? [a, b] : [a]);
if (mode === "group") {
  startCommand = {
    operationId: "original-group-post",
    action: "group.post",
    input: { groupId: group.groupId, text: "An original bounded round." },
  };
  const intent = await f.collaboration.post(f.human, startCommand);
  await eventually(
    () =>
      f.requests.length === 3 &&
      blocked &&
      f.store
        .read()
        .groups[
          group.groupId
        ].messages.filter((row) => row.producer.kind === "bot").length === 1,
  );
  const channel = f.store
    .read()
    .groups[group.groupId].rounds[intent.roundId].channels.at(-1);
  await f.ctx.sessions.flush(f.ctx.agents.get(channel).session);
  await f.store.drain();
  report({
    groupId: group.groupId,
    intent,
    startCommand,
    blockedBotId: b.botId,
    counters: await readCounters(join(directory, "review-counters.json")),
    bindingStates: f.store
      .read()
      .groups[
        group.groupId
      ].rounds[intent.roundId].channels.map((id) => f.store.read().sessions[id].state),
  });
} else {
  const originalTransact = f.store.transact.bind(f.store);
  f.store.transact = (command, mutate) => {
    if (command.action === "meeting.opinion")
      report({
        meetingId: command.input.meetingId,
        sessionId: command.input.source.sessionId,
        eventSeq: command.input.source.eventSeq,
        botId: a.botId,
        startCommand,
      });
    return originalTransact(command, mutate);
  };
  startCommand = {
    operationId: "original-meeting-start",
    action: "meeting.start",
    input: {
      groupId: group.groupId,
      topic: "CrashTopic",
      materials: "Original frozen material",
    },
  };
  await f.collaboration.startMeeting(f.human, startCommand);
  await new Promise(() => {});
}
