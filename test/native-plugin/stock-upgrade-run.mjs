import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {stockGui,textReply,controlledProvider,waitFor} from './stock-gui-runtime.mjs';
import {finishStockGui} from './stock-report.mjs';

let gui;
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const stateChecksum=value=>createHash('sha256').update(canonical(value)).digest('hex');
try {
  const previousVersion=process.env.DSH_BOT_UPGRADE_FROM??'1.0.0',
    targetVersion=JSON.parse(await readFile('package.json','utf8')).version,
    previousHashes={'1.0.0':'1a8cab4c29db54ace76160d1e6e1ac9dfc7a4e291f77b65f974bab30fbaa1724','1.0.1':'e3eca64ca596c1609e5f447e2c0ba8e2e4a778bf0e583e22a07623e00c3fa1dd','1.0.2':'c0e72fe808dddd31d74ad4907dcfb30f7736a7782a83bb307a6d4ca6587de822'};
  assert.ok(Object.hasOwn(previousHashes,previousVersion),'Upgrade source must be an immutable previous release');
  const patch=resolve(process.argv[2]),previous=resolve(`dist/dsh-bot-${previousVersion}.tgz`);
  assert.equal(createHash('sha256').update(await readFile(previous)).digest('hex'),previousHashes[previousVersion]);
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
  const completed=await service.dispatch(actor,{operationId:'upgrade-result-task',action:'task.create',input:{botId:bot.botId,title:'已结算的保留任务',goal:'Give one harmless native result before upgrade',criteria:[],originSessionId:contact.sessionId}});
  const attempt=await service.dispatch(actor,{operationId:'upgrade-result-attempt',action:'task.start',input:{taskId:completed.taskId,expectedVersion:completed.version}});
  await waitFor(()=>{
    const state=service.store.read(),row=state.attempts[attempt.attemptId];
    return row?.result&&!row.reservationHeld&&Object.values(state.outbox).some(out=>out.attemptId===attempt.attemptId&&out.state==='accepted');
  },'real legacy native result and accepted outbox before upgrade');
  const events=await gui.original(contact.sessionId),eventProof=events.map(event=>({seq:event.seq,type:event.type,checksum:stateChecksum(event)}));
  assert.ok(events.some(event=>event.type==='user/message'&&event.data.id===attempt.resultMessageId));
  await writeFile(join(gui.root,'upgrade-original.json'),JSON.stringify({request,bot,contact,memory,task,completed,attempt,eventProof,legacyControlledRequests:gui.report.requests.length}),{mode:0o600});
  await service.store.drain();
  const originalStoreId=service.store.read().storeId,jsonRoot=gui.app.ctx.storage.backend.get('json').root;
  await gui.shutdown();
  // The official backend is closed now. Read its actual atomic KV document,
  // so any graceful-shutdown writes are included in the migration proof.
  const documents=[];
  for(const file of await readdir(jsonRoot))if(/^dsh_bot_v1(?:_[a-f0-9]{24})?\.json$/.test(file)) {
    const document=JSON.parse(await readFile(join(jsonRoot,file),'utf8'));
    if(document.tables?.state?.current?.storeId===originalStoreId)documents.push(document);
  }
  assert.equal(documents.length,1,'One closed official plugin KV document must retain the original store');
  assert.equal(documents[0].unit.version,1);
  const legacyState=documents[0].tables.state.current;
  assert.equal(legacyState.schema,1);
  await writeFile(join(gui.root,'upgrade-legacy-state.json'),JSON.stringify(legacyState),{mode:0o600});
  await writeFile(join(gui.root,'upgrade-closed-kv-document.json'),JSON.stringify(documents[0]),{mode:0o600});
  gui.uninstall();gui.reinstall(patch);
  // Node's ESM resolution cache survives app.shutdown in one process. A real
  // full host restart uses a new Node process, as the upgrade instructions do.
  const log=openSync(join(gui.evidence,'upgrade-fresh-host-private.log'),'w',0o600);
  try {execFileSync(process.execPath,[resolve(import.meta.filename),patch,gui.root],{
    env:{...process.env,DSH_BOT_GUI_OUTPUT:gui.evidence},stdio:['ignore',log,log],timeout:120000,
  });} catch(error) {
    try {Object.assign(gui.report,JSON.parse(await readFile(join(gui.evidence,'stock-gui-report.json'),'utf8')));} catch {}
    throw error;
  } finally {closeSync(log);}
  Object.assign(gui.report,JSON.parse(await readFile(join(gui.evidence,'stock-gui-report.json'),'utf8')));
  } else {
  await gui.boot();
  const service=gui.app.ctx.dshBot,actor=service.policy.fromPeer(gui.app.ctx.connection.operator);
  const {request,bot,contact,memory,task,completed,attempt,eventProof,legacyControlledRequests}=JSON.parse(await readFile(join(gui.root,'upgrade-original.json'),'utf8'));
  gui.report.previousArtifactSha256=createHash('sha256').update(await readFile(previous)).digest('hex');
  gui.report.upgradeArtifactSha256=createHash('sha256').update(await readFile(patch)).digest('hex');
  gui.report.freshHostProcessAfterUpgrade=true;
  const snapshot=service.snapshot(actor);
  const migrated=service.store.read(),legacyState=JSON.parse(await readFile(join(gui.root,'upgrade-legacy-state.json'),'utf8'));
  assert.equal(migrated.schema,2);
  assert.equal(snapshot.clientProtocol,2);
  assert.equal(migrated.storeId,legacyState.storeId);
  assert.equal(migrated.migrationBackup.schema,1);
  assert.deepEqual(migrated.migrationBackup.payload,legacyState);
  assert.equal(migrated.migrationBackup.checksum,stateChecksum(legacyState));
  for(const table of ['bots','sessions','memories','grants','tasks','attempts','groups','meetings','operations','outbox']) {
    for(const id of Object.keys(legacyState[table]))assert.ok(Object.hasOwn(migrated[table],id),`${table} original identity must survive migration`);
  }
  for(const [id,operation] of Object.entries(legacyState.operations))assert.deepEqual(migrated.operations[id],operation,'Original receipts must retain their exact fingerprint and result');
  for(const table of ['materials','schedules','occurrences','taskInputs'])assert.deepEqual(migrated[table],{});
  for(const row of Object.values(migrated.memories)){assert.equal(row.pinned,false);assert.equal(row.inactive,false);}
  for(const row of Object.values(migrated.tasks)){assert.deepEqual(row.dependsOn,[]);assert.deepEqual(row.handoffs,[]);}
  for(const row of Object.values(migrated.bots)){assert.equal(row.memoryRevision,0);assert.deepEqual(row.share.scope.materials,[]);}
  gui.report.migration={fromSchema:1,toSchema:2,backupChecksum:migrated.migrationBackup.checksum,backupPayloadMatchesOriginal:true,allOriginalReceiptIdentitiesPreserved:true,legacySnapshotReadFromClosedOfficialKv:true};
  gui.check('upgradeSchemaTwoAndVerifiedExactSchemaOneBackup',true);
  gui.check('upgradePreservesEveryOriginalIdentityAndReceipt',true);
  const retained=migrated.attempts[attempt.attemptId],outbox=Object.values(migrated.outbox).find(row=>row.attemptId===attempt.attemptId);
  assert.equal(migrated.tasks[completed.taskId].currentAttemptId,attempt.attemptId);
  assert.equal(migrated.tasks[completed.taskId].state,legacyState.tasks[completed.taskId].state);
  assert.equal(migrated.tasks[completed.taskId].acceptance,legacyState.tasks[completed.taskId].acceptance);
  assert.equal(retained.taskId,completed.taskId);
  assert.equal(retained.sessionId,legacyState.attempts[attempt.attemptId].sessionId);
  assert.equal(retained.resultMessageId,legacyState.attempts[attempt.attemptId].resultMessageId);
  assert.deepEqual(retained.result,legacyState.attempts[attempt.attemptId].result);
  assert.equal(retained.reservationHeld,false);
  assert.equal(outbox.state,'accepted');
  assert.equal(outbox.outboxId,legacyState.outbox[outbox.outboxId].outboxId);
  assert.equal(outbox.message.id,retained.resultMessageId);
  assert.deepEqual(outbox.message,legacyState.outbox[outbox.outboxId].message);
  const nativeAfter=await gui.original(contact.sessionId);
  for(const proof of eventProof){const event=nativeAfter.find(row=>row.seq===proof.seq);assert.ok(event);assert.equal(event.type,proof.type);assert.equal(stateChecksum(event),proof.checksum);}
  gui.report.legacyControlledRequests=legacyControlledRequests;
  gui.check('upgradePreservesRealSettledAttemptOutboxAndOriginalNativeLog',true);
  assert.equal(snapshot.pluginVersion,targetVersion);
  assert.equal(snapshot.bots.find(row=>row.botId===bot.botId)?.name,bot.name);
  assert.equal(snapshot.memories.find(row=>row.memoryId===memory.memoryId)?.text,memory.text);
  assert.equal(snapshot.tasks.find(row=>row.taskId===task.taskId)?.state,'queued');
  assert.equal(snapshot.sessions.find(row=>row.sessionId===contact.sessionId)?.botId,bot.botId);
  gui.check(`v${previousVersion.replaceAll('.','')}ToV${targetVersion.replaceAll('.','')}StandardUpgradePreservesOriginalIdentities`,true);
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
  if(gui){gui.report.passed=false;gui.report.error??=String(error.stack).replace(/https?:\/\/\S+/g,'[URL omitted]');}
} finally {
  if(gui){if(!await finishStockGui(gui))process.exitCode=1;console.log(JSON.stringify({passed:gui.report.passed,checks:gui.report.checks,error:gui.report.error?.split('\n')[0],evidence:gui.evidence}));}
}
