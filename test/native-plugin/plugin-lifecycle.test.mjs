import test from "node:test";
import assert from "node:assert/strict";
import { createOfficialFixture } from "./official-fixture.mjs";
import * as Plugin from "../../src/native/plugin.mjs";

test("native plugin mounts exact authenticated API routes and preserves Bot identities across reload", async () => {
  const f = await createOfficialFixture(),
    operator = {},
    routes = new Map();
  f.ctx.provide("profileContext", { name: "owned-test", dir: f.dir });
  f.ctx.provide("webServer", {});
  f.ctx.provide("connection", {
    operator,
    fetch: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  });
  const invoke = async (endpoint, payload) => {
    const method = `dsh.bot/${endpoint}`,
      request = new Request(`http://localhost/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "original-rpc-id",
          method,
          payload,
        }),
      }),
      response = await routes.get(`/api/${method}`).fetch(request);
    return response.json();
  };
  try {
    const first = f.ctx.plugin(Plugin);
    await first.await();
    assert.ok(routes.has("/api/dsh.bot/command"));
    const invalid = await routes
      .get("/api/dsh.bot/command")
      .fetch(
        new Request("http://localhost/api/dsh.bot/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
    assert.equal(invalid.status, 400);
    const created = await invoke("command", {
      operationId: "create",
      action: "bot.create",
      input: {
        name: "Persistent",
        cwd: f.dir,
        contact: { provider: "controlled", model: "model-a" },
      },
    });
    assert.equal(created.type, "server-response");
    assert.equal(created.rpcId, "original-rpc-id");
    assert.equal(created.result.ok, true, JSON.stringify(created));
    const id = created.result.value.botId;
    await first.dispose();
    assert.equal(routes.size, 0);
    assert.equal(f.ctx.get("dshBot"), undefined);
    const second = f.ctx.plugin(Plugin);
    await second.await();
    const reloaded = await invoke("snapshot", {});
    assert.equal(reloaded.result.value.bots[0].botId, id);
    await second.dispose();
  } finally {
    await f.close();
  }
});
