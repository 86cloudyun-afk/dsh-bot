import {stockGui,textReply} from './stock-gui-runtime.mjs';
import {runChatIdentityChecks} from './stock-chat-identity-checks.mjs';
import {finishStockGui} from './stock-report.mjs';
let gui;
try {
  gui=await stockGui({stream:async function*(){yield* textReply('你好，收到你的消息。');}});
  await gui.boot();gui.report.stage='chat-bot-identity';
  await runChatIdentityChecks(gui);gui.report.passed=true;
}catch(error){
  process.exitCode=1;
  if(gui){gui.report.passed=false;gui.report.error=String(error.stack).replace(/https?:\/\/\S+/g,'[URL omitted]');}
}finally{
  if(gui){if(!await finishStockGui(gui))process.exitCode=1;console.log(JSON.stringify({passed:gui.report.passed,checks:gui.report.checks,error:gui.report.error?.split('\n')[0],evidence:gui.evidence}));}
}
