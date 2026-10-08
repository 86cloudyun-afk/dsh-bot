import test from "node:test";
import assert from "node:assert/strict";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { taskFixture } from "./task-fixture.mjs";
import { eventually, textChunks } from "./official-fixture.mjs";

test("settlement records the final native turn observed after the idle barrier", async (t) => {
  let turns = 0;
  const f = await taskFixture(t, {
      stream: async function* () {
        yield* textChunks(++turns === 1 ? "Initial reply" : "Final reply after followup");
      },
    }),
    bot = await f.bot(),
    task = await f.task(bot),
    quiesce = f.adapter.quiesce.bind(f.adapter);
  let delivered = false;
  f.adapter.quiesce = async (sessionId) => {
    if (!delivered) {
      delivered = true;
      // A native child/result followup can arrive while whenIdle is being awaited.
      const agent = f.ctx.agents.get(sessionId);
      agent.followup(createUserMessage({
        content: [{ type: "text", text: "A final native followup" }],
        source: { kind: "dsh-bot-task", attemptId: f.store.read().sessions[sessionId].attemptId },
      }));
      await eventually(() => turns === 2, "the final native turn enters its stream");
    }
    return quiesce(sessionId);
  };
  const attempt = await f.tasks.start(f.human, {
    operationId: "start",
    action: "task.start",
    input: { taskId: task.taskId, expectedVersion: task.version },
  });
  await eventually(() => !f.store.read().attempts[attempt.attemptId].reservationHeld);
  const settled = f.store.read().attempts[attempt.attemptId],
    history = await f.adapter.readNative(attempt.sessionId),
    lastReply = history.events.filter((event) => event.type === "assistant/message").at(-1);
  assert.equal(turns, 2);
  assert.equal(settled.state, "returned");
  assert.equal(settled.result.eventSeq, lastReply.seq);
  assert.equal(settled.result.content[0].text, "Final reply after followup");
  assert.equal(settled.localEvidence.requests.length, 2);
  assert.equal(settled.usage.length, 2);
});
