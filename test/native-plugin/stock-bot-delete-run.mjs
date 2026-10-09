import {stockGui,textReply} from './stock-gui-runtime.mjs';
import {runBotDeleteChecks} from './stock-bot-delete-checks.mjs';
import {finishStockGui} from './stock-report.mjs';
let gui;
try{
  gui=await stockGui({stream:async function*(){yield* textReply('恢复后的聊天答复');}});
  await gui.boot();gui.report.stage='bot-delete-and-restore';
  await runBotDeleteChecks(gui);gui.report.passed=true;
}catch(error){process.exitCode=1;if(gui){gui.report.passed=false;gui.report.error=String(error.stack).replace(/https?:\/\/\S+/g,'[URL omitted]');}}
finally{if(gui){if(!await finishStockGui(gui))process.exitCode=1;console.log(JSON.stringify({passed:gui.report.passed,checks:gui.report.checks,error:gui.report.error?.split('\n')[0],evidence:gui.evidence}));}}
