import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {stockGui,textReply,controlledProvider} from './stock-gui-runtime.mjs';

let gui;
try {
  const patch=resolve(process.argv[2]),previous=resolve('dist/dsh-bot-1.0.0.tgz');
  assert.equal(createHash('sha256').update(await readFile(previous)).digest('hex'),'1a8cab4c29db54ace76160d1e6e1ac9dfc7a4e291f77b65f974bab30fbaa1724');
  const existingRoot=process.argv[3];
  gui=await stockGui({artifact:existingRoot?patch:previous,existingRoot,stream:async function*(){yield* textReply('Retained native history');}});
  if (!existingRoot) {
  await gui.boot();
  let service=gui.app.ctx.dshBot,actor=service.policy.fromPeer(gui.app.ctx.connection.operator);
  const request={operationId:'upgrade-original-first-bot',action:'bot.create',input:{name:'保留的第一个 Bot',contact:{provider:controlledProvider,model:'model-a'}}};
  const bot=await service.dispatch(actor,request);
  const contact=await service.dispatch(actor,{operationId:'upgrade-contact',action:'session.create',input:{botId:bot.botId}});
  const memory=await service.dispatch(actor,{operationId:'upgrade-memory',action:'memory.write',input:{botId:bot.botId,text:'升级保留的长期记忆'}});
  const task=await service.dispatch(actor,{operationId:'upgrade-task',action:'task.create',input:{botId:bot.botId,title:'未开始的保留任务',goal:'Keep the original task',criteria:[]}});
  await writeFile(join(gui.root,'upgrade-original.json'),JSON.stringify({request,bot,contact,memory,task}),{mode:0o600});
  await gui.shutdown();gui.uninstall();gui.reinstall(patch);
  // Node's ESM resolution cache survives app.shutdown in one process. A real
  // full host restart uses a new Node process, as the upgrade instructions do.
  const log=openSync(join(gui.evidence,'upgrade-fresh-host-private.log'),'w',0o600);
  try {execFileSync(process.execPath,[resolve(import.meta.filename),patch,gui.root],{
    env:{...process.env,DSH_BOT_GUI_OUTPUT:gui.evidence},stdio:['ignore',log,log],timeout:120000,
  });} finally {closeSync(log);}
  Object.assign(gui.report,JSON.parse(await readFile(join(gui.evidence,'stock-gui-report.json'),'utf8')));
  } else {
  await gui.boot();
  const service=gui.app.ctx.dshBot,actor=service.policy.fromPeer(gui.app.ctx.connection.operator);
  const {request,bot,contact,memory,task}=JSON.parse(await readFile(join(gui.root,'upgrade-original.json'),'utf8'));
  gui.report.previousArtifactSha256=createHash('sha256').update(await readFile(previous)).digest('hex');
  gui.report.upgradeArtifactSha256=createHash('sha256').update(await readFile(patch)).digest('hex');
  gui.report.freshHostProcessAfterUpgrade=true;
  const snapshot=service.snapshot(actor);
  assert.equal(snapshot.pluginVersion,'1.0.1');
  assert.equal(snapshot.bots.find(row=>row.botId===bot.botId)?.name,bot.name);
  assert.equal(snapshot.memories.find(row=>row.memoryId===memory.memoryId)?.text,memory.text);
  assert.equal(snapshot.tasks.find(row=>row.taskId===task.taskId)?.state,'queued');
  assert.equal(snapshot.sessions.find(row=>row.sessionId===contact.sessionId)?.botId,bot.botId);
  gui.check('v100ToV101StandardUpgradePreservesOriginalIdentities',true);
  await gui.workbench('Bots');
  await gui.page.evaluate(({storeId,request})=>{
    localStorage.setItem(`dsh-bot.pending.v1.${storeId}`,JSON.stringify([request]));
  },{storeId:snapshot.storeId,request});
  await gui.page.reload({waitUntil:'networkidle'});await gui.workbench('Bots');
  const pending=gui.card('待查回的原始操作').locator('div.actions').filter({hasText:request.operationId});
  const before=service.store.read().revision;
  await pending.getByRole('button',{name:'查回原始操作',exact:true}).click();
  await pending.waitFor({state:'hidden'});
  assert.equal(service.store.read().revision,before);
  assert.equal(service.snapshot(actor).bots.filter(row=>row.name===bot.name).length,1);
  gui.check('upgradedOriginalReceiptLookupNeverRecreatesBot',true);
  const editor=gui.card('创建具名 Bot');
  await editor.getByLabel('名称',{exact:true}).fill('升级后的新 Bot');
  await editor.getByRole('button',{name:'创建 Bot',exact:true}).click();
  await gui.until(state=>state.bots.some(row=>row.name==='升级后的新 Bot'),'first creation after upgrade');
  gui.check('upgradedStockGuiCreatesNextBot',true);
  gui.check('upgradeAndReceiptLookupIssueNoModelRequests',gui.report.requests.length===0);
  gui.report.passed=true;
  }
} catch(error) {
  process.exitCode=1;
  if(gui){gui.report.passed=false;gui.report.error=String(error.stack).replace(/https?:\/\/\S+/g,'[URL omitted]');}
} finally {
  if(gui){await gui.writeReport();await gui.shutdown();console.log(JSON.stringify({passed:gui.report.passed,checks:gui.report.checks,error:gui.report.error?.split('\n')[0],evidence:gui.evidence}));}
}
