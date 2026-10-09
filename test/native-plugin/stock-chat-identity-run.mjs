import {stockGui,textReply} from './stock-gui-runtime.mjs';
import {runChatIdentityChecks} from './stock-chat-identity-checks.mjs';
import {finishStockGui,recordStockError} from './stock-report.mjs';
let gui;
try {
  gui=await stockGui({stream:async function*(){yield* textReply('你好，收到你的消息。');}});
  await gui.boot();gui.report.stage='chat-bot-identity';
  await runChatIdentityChecks(gui);gui.report.passed=true;
}catch(error){
  process.exitCode=1;
  if(gui){gui.report.passed=false;await recordStockError(gui.report,error,{evidence:gui.evidence});}
}finally{
  if(gui){if(!await finishStockGui(gui))process.exitCode=1;console.log(JSON.stringify({passed:gui.report.passed,checks:gui.report.checks,error:gui.report.error}));}
}
