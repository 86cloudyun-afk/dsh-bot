import { stockGui, textReply, controlledProvider } from "./stock-gui-runtime.mjs";
import { runUiRegressions } from "./stock-ui-regressions.mjs";
let gui;
try {
  gui = await stockGui({ stream: async function* () { yield* textReply("Controlled UI verification"); } });
  await gui.boot();
  const service = gui.app.ctx.dshBot;
  await service.bots.create(service.policy.fromPeer(gui.app.ctx.connection.operator), {
    operationId: "ui-seed-bot", action: "bot.create",
    input: { name: "界面校验基础 Bot", cwd: `${gui.root}/work`, contact: { provider: controlledProvider, model: "model-a" } },
  });
  await runUiRegressions(gui);
  gui.check("noBrowserScriptErrors", gui.errors.length === 0);
  gui.report.passed = true;
} catch (error) {
  process.exitCode = 1;
  if (gui) {
    gui.report.passed = false;
    gui.report.error = String(error.stack).replace(/https?:\/\/\S+/g, "[URL omitted]");
  }
} finally {
  if (gui) {
    await gui.writeReport(); await gui.shutdown();
    console.log(JSON.stringify({ passed: gui.report.passed, checks: gui.report.checks, error: gui.report.error?.split("\n")[0], evidence: gui.evidence }));
  }
}
