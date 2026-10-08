import test from "node:test";
import assert from "node:assert/strict";
import Jobs from "@deepseek-ai/dsh-jobs-local";
import { businessFixture } from "./business-fixture.mjs";
import { deferred } from "./official-fixture.mjs";

test("a failed shutdown resource receipt leaves the contact UNKNOWN after disable", async (t) => {
  const f = await businessFixture(t),
    bot = await f.bot(),
    contact = await f.sessions.create(f.human, {
      operationId: "contact",
      action: "session.create",
      input: { botId: bot.botId },
    });
  await f.adapter.disposeOwned(contact.sessionId);
  const restored = await f.ctx.agents.resume({
    resumeSessionId: contact.sessionId,
    agentOptions: { provider: "controlled", model: "model-a" },
  });
  t.after(() => restored.dispose());
  await f.ctx.plugin(Jobs).await();
  const detach = f.ctx.jobs.attachController("test");
  t.after(detach);
  const gate = deferred();
  t.after(() => gate.resolve({ status: "killed" }));
  f.ctx.jobs.start({
    kind: "test",
    owner: contact.sessionId,
    label: "Controlled owned resource",
    run() {
      return {
        cancel() {
          gate.resolve({ status: "killed" });
        },
        done: gate.promise,
      };
    },
  });
  const wait = f.ctx.jobs.wait;
  f.ctx.jobs.wait = () =>
    Promise.reject(
      Object.assign(Error("Controlled lost shutdown receipt"), {
        code: "controlled_receipt_lost",
      }),
    );
  try {
    await f.adapter.close();
  } finally {
    f.ctx.jobs.wait = wait;
  }
  const binding = f.store.read().sessions[contact.sessionId];
  assert.equal(binding.state, "UNKNOWN");
  assert.equal(binding.error, "shutdown_resources_unsettled");
  assert.ok(binding.resourceEvidence.resourceFaults.length);
});
