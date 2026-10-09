import {finishStockGui,recordStockError} from './stock-report.mjs';
import {runSimpleUiChecks} from './stock-simple-ui-checks.mjs';
import {runRepairChecks} from './stock-repair-checks.mjs';
import {stockGui, textReply} from './stock-gui-runtime.mjs';

let gui;
try {
  gui = await stockGui({stream: async function* () {yield* textReply('Simple workbench reply');}});
  await gui.boot();
  await runSimpleUiChecks(gui);
  await runRepairChecks(gui);
  gui.report.passed = true;
} catch (error) {
  process.exitCode = 1;
  if (gui) {gui.report.passed = false; await recordStockError(gui.report,error,{evidence:gui.evidence});}
} finally {
  if (gui) {
    if(!await finishStockGui(gui))process.exitCode=1;
    console.log(JSON.stringify({passed: gui.report.passed, checks: gui.report.checks, error: gui.report.error}));
  }
}
