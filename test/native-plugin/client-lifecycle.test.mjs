import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

/** Browser module registration contract; actual clicks are separately tested in the stock GUI. */
test("client adds a Bot workbench and existing Bot chooser through additive native seats", async () => {
  let localeModule;
  vm.runInNewContext(
    await readFile(
      new URL(
        "../../node_modules/@deepseek-ai/dsh-client-locale/lib/client.js",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load(value) {
            localeModule = value;
          },
        },
      },
    },
  );
  const { LocaleRuntime } = localeModule.factory(() => ({}));
  let module;
  vm.runInNewContext(
    await readFile(
      new URL("../../src/client/client.js", import.meta.url),
      "utf8",
    ),
    {
      AbortController,
      window: {
        __ModuleLoader__: {
          load(value) {
            module = value;
          },
        },
      },
    },
  );
  const plugin = module.factory(() => ({
      createElement() {},
      useState() {},
      useEffect() {},
      useSyncExternalStore() {},
    })),
    registrations = [],
    effects = [];
  const ctx = {
    emit() {},
    slots: {
      inject(_slot, fn) {
        return fn();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    effect(fn) {
      effects.push(fn);
    },
    provide() {
      return () => {};
    },
    connection: {
      rpc: {
        call: async () => ({ ok: true, value: { bots: [], revision: 0 } }),
      },
    },
    layout: { selectPanel() {} },
    uiWorkspace: { openSession() {} },
  };
  ctx.locale = new LocaleRuntime(ctx, undefined, {
    languages: ["zh"],
    preference: "zh",
  });
  plugin.apply(ctx);
  const unlocale = effects[0]();
  assert.equal(ctx.locale.bind("dsh.bot")("title"), "Bot 工作台");
  unlocale();
  assert.equal(ctx.locale.bind("dsh.bot")("title"), "title");
  const main = registrations.find((row) => row.options.name === "main");
  assert.equal(main.options.key, "dsh-bot");
  for (const slot of [
    "sidebar.panellist",
    "sidebar.footer.action",
    "shell.overlay",
    "conversation.session.header.utilities",
  ])
    assert.ok(
      registrations.some((row) => row.options.name === slot),
      `missing additive seat ${slot}`,
    );
  assert.equal(
    registrations.some((row) =>
      ["sidebar", "conversation.session.preset"].includes(row.options.name),
    ),
    false,
  );
});
