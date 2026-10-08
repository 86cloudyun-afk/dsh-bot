import {runSimpleUiChecks} from './stock-simple-ui-checks.mjs';
import {stockGui, textReply} from './stock-gui-runtime.mjs';

let gui;
try {
  gui = await stockGui({stream: async function* () {yield* textReply('Simple workbench reply');}});
  await gui.boot();
  await runSimpleUiChecks(gui);
  gui.report.passed = true;
} catch (error) {
  process.exitCode = 1;
  if (gui) {gui.report.passed = false; gui.report.error = String(error.stack).replace(/https?:\/\/\S+/g, '[URL omitted]');}
} finally {
  if (gui) {
    await gui.writeReport(); await gui.shutdown();
    console.log(JSON.stringify({passed: gui.report.passed, checks: gui.report.checks, error: gui.report.error?.split('\n')[0], evidence: gui.evidence}));
  }
}
