import {finishStockGui,recordStockError} from './stock-report.mjs';
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
  if (process.env.DSH_BOT_UI_ACTIVE_POLL === '1') {
    // Reproduce a live native page: successful read-only RPCs need not go idle.
    gui.context.setDefaultNavigationTimeout(8000);
    gui.report.activePollingProbe = true;
    await gui.context.addInitScript(() => {
      window.__dshBotReadinessResponses = 0;
      setInterval(async () => {
        try {
          const response = await fetch('/api/dsh.bot/snapshot', {
            method:'POST', headers:{'content-type':'application/json'},
            body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'dsh.bot/snapshot',payload:{}}),
          });
          if ((await response.json()).result?.ok) window.__dshBotReadinessResponses++;
        } catch {}
      }, 100);
    });
  }
  await runUiRegressions(gui);
  gui.check("noBrowserScriptErrors", gui.errors.length === 0);
  gui.report.passed = true;
} catch (error) {
  process.exitCode = 1;
  if (gui) {
    gui.report.passed = false;
    await recordStockError(gui.report,error,{evidence:gui.evidence});
  }
} finally {
  if (gui) {
    if(!await finishStockGui(gui))process.exitCode=1;
    console.log(JSON.stringify({ passed: gui.report.passed, checks: gui.report.checks, error: gui.report.error }));
  }
}
