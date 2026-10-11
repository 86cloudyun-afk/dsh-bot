import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'../..');
const target={packageName:'dsh-bot',packageVersion:'1.1.1',artifactSha256:'cf651bff75f9fa144e05b0db7fd6284038c50bcafb8a44ccfa8b0d4d66bb9c92',sourceCommit:'a'.repeat(40),officialVersion:'0.2.0-rc.2'};
async function validator() {
  const module=await import('./stock-qualification.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
  assert.equal(typeof module.validateStockReport,'function','The stock report gate needs the shared strict validator');
  return module;
}
function report(module,source='gui',expected=target) {
  const row={passed:true,testsPassed:true,teardownComplete:true,stage:'complete',sourceCommit:expected.sourceCommit,sourceTreeDirty:false,artifactSha256:expected.artifactSha256,officialVersion:expected.officialVersion,standardProfile:true,standardPluginInstall:true,controlledProvider:true,realModelRequests:0,browserErrors:[],requests:source==='gui'?[{}]:[],checks:Object.fromEntries(module.expectedStockChecks(source,expected.packageVersion).map(name=>[name,true]))};
  if(source!=='gui') {
    const previous=module.stockSources[source];
    Object.assign(row,{...(previous.bytes===undefined?{}:{previousArtifactBytes:previous.bytes}),previousArtifactSha256:previous.sha256,upgradeArtifactSha256:expected.artifactSha256,freshHostProcessAfterUpgrade:true});
    if(previous.schema===1)row.migration={fromSchema:1,toSchema:2,backupChecksum:'b'.repeat(64),backupPayloadMatchesOriginal:true,allOriginalReceiptIdentitiesPreserved:true,legacySnapshotReadFromClosedOfficialKv:true};
    else row.upgradeSchemaTwo={fromSchema:2,toSchema:2,existingMigrationBackupRetained:true,backupWasPresent:false,allOriginalReceiptIdentitiesPreserved:true,exactV11RowsRetained:true,sourceSnapshotReadFromClosedOfficialKv:true};
  }
  return row;
}

test('actual workflow gate rejects truncated reports previously marked Passed',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'stock-gate-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  for(const source of ['gui','upgrade','upgrade-v101','upgrade-v102','upgrade-v110','upgrade-v111','upgrade-v112','upgrade-v113','upgrade-v114','upgrade-v120']) {
    const dir=join(scratch,'qualification',source);await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'stock-gui-report.json'),JSON.stringify({passed:true,teardownComplete:true,checks:{oneArbitraryCheck:true}}));
  }
  const workflow=await readFile(join(root,'.github/workflows/ci.yml'),'utf8');
  const gate=workflow.slice(workflow.indexOf('- name: Require all'),workflow.indexOf('- name: Sanitized GUI'));
  const legacy=/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/.exec(gate);
  const invocation=/node (test\/native-plugin\/stock-qualification\.mjs) (\S+)/.exec(gate);
  assert.ok(legacy||invocation,'The workflow must execute its report validator');
  const args=legacy?['--input-type=module']:[join(root,invocation[1]),join(scratch,invocation[2])];
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',input:legacy?legacy[1].replace(/^ {10}/gm,'').replaceAll('qualification/',`${scratch}/qualification/`):undefined,env:{...process.env,GITHUB_SHA:target.sourceCommit,GITHUB_STEP_SUMMARY:join(scratch,'summary.md')}});
  assert.notEqual(result.status,0,'An arbitrary single-check report must not pass the actual CI gate');
});

test('actual shared CLI gate accepts complete reports and rejects lost checks or provenance',async t=>{
  const module=await validator(),expected=await module.readStockTarget({root,sourceCommit:target.sourceCommit});
  const scratch=await mkdtemp(join(tmpdir(),'stock-strict-gate-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const directory=join(scratch,'qualification');
  const write=async(source,row)=>writeFile(join(directory,source,'stock-gui-report.json'),JSON.stringify(row));
  for(const source of Object.keys(module.stockSources)) {
    await mkdir(join(directory,source),{recursive:true});await write(source,report(module,source,expected));
  }
  const run=()=>spawnSync(process.execPath,[join(root,'test/native-plugin/stock-qualification.mjs'),directory],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_SHA:expected.sourceCommit,GITHUB_STEP_SUMMARY:join(scratch,'summary.md')}});
  assert.equal(run().status,0,'Complete named reports with frozen provenance must remain accepted');
  for(const mutate of [
    row=>{delete row.checks.nativeAuthenticationRequired;},
    row=>{delete row.checks.nativeAuthenticationRequired;row.checks.anArbitraryCheck=true;},
    row=>{row.artifactSha256='0'.repeat(64);},
    row=>{row.sourceCommit='0'.repeat(40);},
    row=>{row.teardownComplete=false;},
  ]) {
    const invalid=report(module,'gui',expected);mutate(invalid);await write('gui',invalid);
    assert.notEqual(run().status,0,'The real CLI must reject incomplete or mismatched qualification');
  }
  await write('gui',report(module,'gui',expected));
  await rm(join(directory,'upgrade-v120','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The immutable v1.2.0 ninth upgrade is mandatory');
  await write('upgrade-v120',report(module,'upgrade-v120',expected));
  await rm(join(directory,'upgrade-v114','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The current stable immutable upgrade source is mandatory');
  await write('upgrade-v114',report(module,'upgrade-v114',expected));
  await rm(join(directory,'upgrade-v113','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The seventh immutable upgrade source is mandatory');
  await write('upgrade-v113',report(module,'upgrade-v113',expected));
  await rm(join(directory,'upgrade-v112','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The sixth immutable upgrade source is mandatory');
  await write('upgrade-v112',report(module,'upgrade-v112',expected));
  await rm(join(directory,'upgrade-v111','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The new fifth immutable upgrade source is mandatory');
});

test('complete named reports retain all supported stock and schema upgrade paths',async()=>{
  const module=await validator();
  assert.deepEqual(Object.keys(module.stockSources),['gui','upgrade','upgrade-v101','upgrade-v102','upgrade-v110','upgrade-v111','upgrade-v112','upgrade-v113','upgrade-v114','upgrade-v120']);
  assert.equal(module.stockSources['upgrade-v111'].sha256,target.artifactSha256);
  assert.equal(module.stockSources['upgrade-v112'].sha256,'426a244ae02927129e315420907ab4b2f9acf16414144e0e6792b7f25bfe48ff');
  assert.equal(module.stockSources['upgrade-v113'].sha256,'55c192a3837d36ff6dd78fa5f34c36d2375a648258ddd499f793d6e3a47ae289');
  for(const source of Object.keys(module.stockSources))assert.doesNotThrow(()=>module.validateStockReport(report(module,source),{source,target}));
  const readable=report(module,'upgrade-v110');delete readable.requests;readable.controlledRequests=0;
  assert.doesNotThrow(()=>module.validateStockReport(readable,{source:'upgrade-v110',target}),'The existing readable report projection remains valid');
});

test('named GUI contract includes every check in the installed runner import graph',async()=>{
  const module=await validator(),pending=['stock-gui-run.mjs'],visited=new Set(),names=new Set();
  while(pending.length) {
    const file=pending.pop();if(visited.has(file))continue;visited.add(file);
    const source=await readFile(new URL(`./${file}`,import.meta.url),'utf8');
    for(const match of source.matchAll(/\bgui\.check\(\s*['"]([a-zA-Z\d]+)['"]/g))names.add(match[1]);
    for(const match of source.matchAll(/\bfrom\s+['"]\.\/(stock-[a-z\d-]+\.mjs)['"]/g))pending.push(match[1]);
  }
  assert.deepEqual([...names].sort(),[...module.guiCheckNames].sort(),'Added installed assertions must be mandatory, and removed assertions must fail qualification');
});

for(const [name,mutate] of [
  ['missing required named check',row=>{delete row.checks.nativeAuthenticationRequired;}],
  ['arbitrary replacement at the same count',row=>{delete row.checks.nativeAuthenticationRequired;row.checks.anArbitraryCheck=true;}],
  ['extra arbitrary check',row=>{row.checks.anArbitraryCheck=true;}],
  ['false required check',row=>{row.checks.nativeAuthenticationRequired=false;}],
  ['string true check',row=>{row.checks.nativeAuthenticationRequired='true';}],
  ['failed tests',row=>{row.testsPassed=false;}],
  ['failed report',row=>{row.passed=false;}],
  ['incomplete teardown',row=>{row.teardownComplete=false;}],
  ['wrong artifact',row=>{row.artifactSha256='0'.repeat(64);}],
  ['wrong source',row=>{row.sourceCommit='0'.repeat(40);}],
  ['dirty source',row=>{row.sourceTreeDirty=true;}],
  ['wrong package version',row=>{row.artifactPackageVersion='0.0.0';}],
  ['wrong official version',row=>{row.officialVersion='0.0.0';}],
  ['nonstandard profile',row=>{row.standardProfile=false;}],
  ['nonstandard install',row=>{row.standardPluginInstall=false;}],
  ['external provider',row=>{row.controlledProvider=false;}],
  ['external model request',row=>{row.realModelRequests=1;}],
  ['browser failure',row=>{row.browserErrors=[{type:'Error',messageHash:'b'.repeat(64)}];}],
  ['public error',row=>{row.error={type:'Error',messageHash:'b'.repeat(64)};}],
])test(`shared validator rejects ${name}`,async()=>{
  const module=await validator(),row=report(module);mutate(row);
  assert.throws(()=>module.validateStockReport(row,{source:'gui',target}));
});

for(const [name,mutate] of [
  ['wrong immutable source hash',row=>{row.previousArtifactSha256='0'.repeat(64);}],
  ['wrong upgrade target hash',row=>{row.upgradeArtifactSha256='0'.repeat(64);}],
  ['missing fresh host process',row=>{delete row.freshHostProcessAfterUpgrade;}],
  ['target model request',row=>{row.requests=[{}];}],
  ['hidden readable target request',row=>{row.controlledRequests=1;}],
  ['incorrect migration schema',row=>{row.migration.fromSchema=2;}],
  ['unverified migration backup',row=>{row.migration.backupPayloadMatchesOriginal=false;}],
])test(`shared validator rejects upgrade ${name}`,async()=>{
  const module=await validator(),row=report(module,'upgrade');mutate(row);
  assert.throws(()=>module.validateStockReport(row,{source:'upgrade',target}));
});

test('schema-two v1.1.1 upgrade cannot replace exact original rows with a schema-one proof',async()=>{
  const module=await validator(),row=report(module,'upgrade-v111');row.upgradeSchemaTwo.exactV11RowsRetained=false;
  assert.throws(()=>module.validateStockReport(row,{source:'upgrade-v111',target}));
  assert.throws(()=>module.validateStockReport(report(module),{source:'upgrade-v999',target}));
});

test('schema-two v1.1.2 upgrade requires exact retained rows and its immutable source',async()=>{
  const module=await validator(),row=report(module,'upgrade-v112');
  assert.doesNotThrow(()=>module.validateStockReport(row,{source:'upgrade-v112',target}));
  row.upgradeSchemaTwo.exactV11RowsRetained=false;
  assert.throws(()=>module.validateStockReport(row,{source:'upgrade-v112',target}));
  const foreign=report(module,'upgrade-v112');foreign.previousArtifactSha256=module.stockSources['upgrade-v111'].sha256;
  assert.throws(()=>module.validateStockReport(foreign,{source:'upgrade-v112',target}));
});

test('schema-two v1.1.3 candidate upgrade retains exact original rows and immutable candidate bytes',async()=>{
  const module=await validator(),row=report(module,'upgrade-v113');
  assert.doesNotThrow(()=>module.validateStockReport(row,{source:'upgrade-v113',target}));
  row.upgradeSchemaTwo.exactV11RowsRetained=false;
  assert.throws(()=>module.validateStockReport(row,{source:'upgrade-v113',target}));
  const foreign=report(module,'upgrade-v113');foreign.previousArtifactSha256=module.stockSources['upgrade-v112'].sha256;
  assert.throws(()=>module.validateStockReport(foreign,{source:'upgrade-v113',target}));
});

test('schema-two v1.1.4 stable upgrade is mandatory and retains immutable source bytes',async()=>{
  const module=await validator();
  assert.deepEqual(module.stockSources['upgrade-v114'],{
    version:'1.1.4',sha256:'3fb396f44120881c5f9fbf6d40b278e8614ffa765e29c04a6c49ccf8000f5677',schema:2,
  });
  const row=report(module,'upgrade-v114');
  assert.doesNotThrow(()=>module.validateStockReport(row,{source:'upgrade-v114',target}));
  row.upgradeSchemaTwo.exactV11RowsRetained=false;
  assert.throws(()=>module.validateStockReport(row,{source:'upgrade-v114',target}));
  const foreign=report(module,'upgrade-v114');foreign.previousArtifactSha256=module.stockSources['upgrade-v113'].sha256;
  assert.throws(()=>module.validateStockReport(foreign,{source:'upgrade-v114',target}));
});

test('frozen package identity binds target version as well as checksum',async t=>{
  const module=await validator(),actual=await module.readStockTarget({root,sourceCommit:target.sourceCommit});
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(actual.packageVersion,manifest.version);
  const scratch=await mkdtemp(join(tmpdir(),'stock-package-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  await mkdir(join(scratch,'dist'));await writeFile(join(scratch,'package.json'),JSON.stringify({...manifest,version:'0.0.0'}));
  await writeFile(join(scratch,'dist','dsh-bot-0.0.0.tgz'),await readFile(join(root,'dist',`dsh-bot-${manifest.version}.tgz`)));
  await assert.rejects(module.readStockTarget({root:scratch,sourceCommit:target.sourceCommit}),'Renaming an old tgz must not manufacture a new package version');
});


const v130Names=[
  'v130DedicatedSpaceOpensWithoutModelRequestOrMainNavigation',
  'v130ExistingPrivateHistoryUsesOriginalSessionAndOwnedReference',
  'v130TwoSameNameBotsKeepSeparateIdentityHistoryAndDrafts',
  'v130NewConversationKeepsReceiptSessionWithoutMainNavigation',
  'v130EmbeddedNativeComposerUsesSelectedBotModel',
  'v130EmbeddedNativeToolApprovalHasOriginalAuditPair',
  'v130SpaceCreatesTwoMemberGroupWithoutModelRequest',
  'v130GroupRepliesComeFromActualIndependentNativeMembers',
  'v130HeldGroupStopSettlesOriginalChannelAndPreventsNextMember',
  'v130GroupDraftPreservesImeAndFailedOriginalSubmission',
  'v130GroupPendingSubmitClearsOnlyOriginalUneditedDraft',
  'v130PrivateTaskRunsWhileSelectedChatRemainsResponsive',
  'v130GroupContextShowsOnlyMeetingActionTasks',
  'v130MeetingIndependentOpinionsRemainSealedUntilAdvance',
  'v130MeetingAdvancesRealPhasesAndCreatesLinkedActionTask',
  'v130NarrowSpaceControlsRemainReachable',
  'v130SpaceModalEscapeRestoresTriggerFocus',
  'v130NativeReferencesReleaseOnSwitchAndDisable',
  'v130SpaceDisablePreservesUnrelatedNativeConversation',
  'v130SpaceLightDarkPrivateGroupCooperationScreenshots',
  'v130SpaceUsesNoExternalModelRequests',
  'v130GroupApprovalUsesExactNativeChannelAndAuditedContinuation',
  'v130IndependentMeetingApprovalRejectsExactToolWithoutOpinionLeak',
  'v130ResolvedChannelApprovalUnmountsBeforeDraftFallback',
  'v130GroupNativeQuestionUsesExactChannelAndOriginalToolResult',
  'v130MeetingDiscussionPlanReviewUsesExactChannelAndOriginalToolResult',
  'v130ChannelQuestionCloseUnmountsWithoutFallbackOrLease',
  'v130ChannelQuestionRemovalUnmountsAndPreservesOriginalGeneration',
  'v130CancelledUnrevealedMeetingKeepsOpinionsSealedAndHistory',
  'v130NarrowDrawersEscapeRestoreFocus',
  'v130KeyedPlanReviewHideReopensSameOriginalCarrier',
  'v130TimedQuestionLateReplyPreservesOriginalCallAndCurrentChannel',
  'v130QuestionReconnectDiscardsCarrierAndRestoresCurrentProjection',
  'v130SettledChannelQuestionCannotReactivateAfterCompletion',
  'v130ManagementOpensExactSelectedBotAndGroupTargets',
];
test('v1.3 space qualification keeps all 128 old checks and makes every real space flow mandatory',async()=>{
  const module=await validator();
  assert.equal(module.guiCheckNames.slice(0,128).length,128);
  assert.equal(createHash('sha256').update(JSON.stringify(module.guiCheckNames.slice(0,128))).digest('hex'),'4a33eef94e85166c43ad4806342ab6392ccbf99207f1de163f5be515ffea48ba','The original 128 qualification names and their order remain immutable');
  assert.equal(createHash('sha256').update(JSON.stringify(module.guiCheckNames.slice(0,152))).digest('hex'),'64727f9506e448bcc6ddabd384631a1da2a7ca17f4a896ed003984ce636a9405','The original 128 plus initial 24 space contracts remain mandatory in order');
  assert.deepEqual(module.guiCheckNames.slice(128),v130Names);
  for(const name of v130Names) {
    const row=report(module);delete row.checks[name];
    assert.throws(()=>module.validateStockReport(row,{source:'gui',target}),`Missing actual space witness ${name} cannot qualify`);
  }
});
test('v1.2.0 predecessor uses immutable original SHA256 and byte length and requires fresh schema-two proof',async()=>{
  const module=await validator();
  assert.deepEqual(module.stockSources['upgrade-v120'],{version:'1.2.0',sha256:'43e837624194596a9ff679e86b68f416ea7977152f480191c208fc5eae726d94',schema:2,bytes:147662});
  const row=report(module,'upgrade-v120');
  row.previousArtifactBytes=147662;
  assert.doesNotThrow(()=>module.validateStockReport(row,{source:'upgrade-v120',target}));
  for(const mutate of [value=>{value.previousArtifactBytes=147661;},value=>{value.previousArtifactSha256=module.stockSources['upgrade-v114'].sha256;},value=>{value.freshHostProcessAfterUpgrade=false;},value=>{value.requests=[{}];},value=>{value.upgradeSchemaTwo.exactV11RowsRetained=false;}]) {
    const invalid=structuredClone(row);mutate(invalid);
    assert.throws(()=>module.validateStockReport(invalid,{source:'upgrade-v120',target}));
  }
});
test('v1.3 workflow runs and projects the ninth original source as the tenth report',async()=>{
  const workflow=await readFile(join(root,'.github/workflows/ci.yml'),'utf8');
  assert.match(workflow,/DSH_BOT_UPGRADE_FROM: '1\.2\.0'/);
  assert.match(workflow,/Require all ten complete stock qualification reports/);
  assert.match(workflow,/\['upgrade-v120','upgradeV120'\]/);
  assert.match(workflow,/qualification\/upgrade-v120\/stock-gui-report\.json/);
});

test('qualification context observation preserves original factory, plugin object, apply calls and service faces',async()=>{
  const source=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  const observation=source.slice(source.indexOf('export function observeInstalledClientContext()'),source.indexOf('async function clientFacts')).replace('export function','function');
  const window={},sandbox={window};vm.runInNewContext(`${observation};observeInstalledClientContext();`,sandbox);
  const calls=[],result={original:true},ctx={sessions:{original:'sessions'},layout:{original:'layout'},uiSession:{original:'uiSession'}},plugin={apply(...args){calls.push(['apply',this,args]);return result;}},exports={'./client':plugin};
  const facade={load(record){calls.push(['load',this,record.id]);return record.factory('original-require');}};
  window.__ModuleLoader__=facade;
  const actual=facade.load({id:'dsh-bot',factory(require){calls.push(['factory',require]);return exports;}});
  assert.equal(actual,exports);assert.equal(actual['./client'],plugin);
  assert.equal(plugin.apply.call(plugin,ctx,'original-option'),result);
  assert.deepEqual(calls.map(row=>row[0]),['load','factory','apply']);
  assert.equal(calls[0][1],facade);assert.equal(calls[1][1],'original-require');assert.equal(calls[2][1],plugin);assert.deepEqual(calls[2][2],[ctx,'original-option']);
  assert.equal(window.__stockV130ClientCtx,ctx);assert.equal(window.__stockV130ClientServices.sessions,ctx.sessions);assert.equal(window.__stockV130ClientServices.layout,ctx.layout);assert.equal(window.__stockV130ClientServices.uiSession,ctx.uiSession);
  // This unit fixture is an instrumentation contract, never installed GUI
  // evidence. Other package factories pass through without interception.
  const other={apply(){}};assert.equal(facade.load({id:'ordinary',factory:()=>other}),other);assert.equal(other.apply.name,'apply');
});

test('qualification context observation survives actual SDK queue to live registration and direct plugin exports',async()=>{
  const source=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  const observation=source.slice(source.indexOf('export function observeInstalledClientContext()'),source.indexOf('async function clientFacts')).replace('export function','function');
  const window={},sandbox={window};vm.runInNewContext(`${observation};observeInstalledClientContext();`,sandbox);
  const queue=[],registered=[],calls=[],ctx={sessions:{},layout:{},uiSession:{}},result={original:true};
  const plugin={apply(...args){calls.push(['apply',this,args]);return result;}};
  const facade={mode:'queue',load(record){queue.push(record);},create(){const pending=queue.splice(0);this.mode='live';this.load=function(record){registered.push(record);};for(const record of pending)this.load(record);}};
  window.__ModuleLoader__=facade;
  const factory=()=>{calls.push(['factory']);return plugin;};
  facade.load({id:'dsh-bot',factory});facade.create();
  const actual=registered[0].factory('actual-sdk-require');assert.equal(actual,plugin);
  assert.equal(actual.apply.call(plugin,ctx,'actual-sdk-config'),result);
  assert.equal(window.__stockV130ClientCtx,ctx);
  assert.deepEqual(calls.map(row=>row[0]),['factory','apply']);
  assert.equal(calls[1][1],plugin);assert.deepEqual(calls[1][2],[ctx,'actual-sdk-config']);
  // Lazy application bundles register after create has replaced target.load.
  const later={apply(seen){calls.push(['later']);assert.equal(seen,ctx);return result;}};
  facade.load({id:'dsh-bot/client',factory:()=>later});assert.equal(registered[1].factory(),later);
  assert.equal(later.apply(ctx),result);assert.equal(window.__stockV130ClientServices.sessions,ctx.sessions);
});

test('qualification context observation works with the unchanged official SDK module bootstrap',async()=>{
  const {bootInjections}=await import('@deepseek-ai/dsh-client-modules');
  const source=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  const observation=source.slice(source.indexOf('export function observeInstalledClientContext()'),source.indexOf('async function clientFacts')).replace('export function','function');
  const window={},sandbox={window};vm.createContext(sandbox);vm.runInContext(`${observation};observeInstalledClientContext();`,sandbox);
  const graph={rev:'qualification',entries:[],batches:[]};vm.runInContext(bootInjections(graph)[0].text,sandbox);
  const sdkRoot=resolve(import.meta.dirname,'../../node_modules/@deepseek-ai/dsh-client-modules/lib/client.js');
  vm.runInContext(await readFile(sdkRoot,'utf8'),sandbox);
  const modules=window.__ModuleLoader__.create({boot:graph,staticModules:{}}),ctx={sessions:{},layout:{},uiSession:{}};
  let factoryCalls=0,applyCalls=0;const result={},plugin={apply(seen){applyCalls++;assert.equal(seen,ctx);return result;}};
  window.__ModuleLoader__.load({id:'dsh-bot',factory(){factoryCalls++;return plugin;}});
  const actual=await modules.import('dsh-bot');assert.equal(actual,plugin);assert.equal(actual.apply(ctx),result);
  assert.equal(factoryCalls,1);assert.equal(applyCalls,1);assert.equal(window.__stockV130ClientCtx,ctx);
});

test('independent approval fixture admits only original receipt meeting and current epoch member channel',async()=>{
  const {isCurrentIndependentApprovalProbe:eligible}=await import('./stock-v130-bot-space-checks.mjs');
  assert.equal(typeof eligible,'function','The real controlled stream needs a receipt-bound independent fixture gate');
  const participant={botId:'bot-a',active:true,memberEpoch:3,sessionId:'target-channel'},meeting={meetingId:'target-meeting',groupId:'group',phase:'independent',epoch:7,participants:[participant]};
  const state={operations:{'original-operation':{action:'meeting.start',result:structuredClone(meeting)}},meetings:{'target-meeting':structuredClone(meeting),'other-meeting':{...structuredClone(meeting),meetingId:'other-meeting',participants:[{...participant,sessionId:'other-channel'}]}},groups:{group:{members:[{botId:'bot-a',active:true,epoch:3}]}}};
  const binding={sessionId:'target-channel',botId:'bot-a',purpose:'independent',state:'ready',lineage:{sessionId:'target-channel',botId:'bot-a',groupId:'group',meetingId:'target-meeting',phase:'independent',epoch:7,memberEpoch:3}},target={operationId:'original-operation',groupId:'group'};
  assert.equal(eligible(state,binding,target),true);
  for(const [name,mutate] of [
    ['concurrent same-group meeting',(s,b)=>{b.sessionId=b.lineage.sessionId='other-channel';b.lineage.meetingId='other-meeting';}],
    ['missing initiating receipt',s=>{delete s.operations['original-operation'];}],
    ['different receipt action',s=>{s.operations['original-operation'].action='meeting.advance';}],
    ['different receipt group',s=>{s.operations['original-operation'].result.groupId='other-group';}],
    ['advanced current epoch',s=>{s.meetings['target-meeting'].epoch++;}],
    ['advanced receipt epoch',s=>{s.operations['original-operation'].result.epoch++;}],
    ['advanced phase',s=>{s.meetings['target-meeting'].phase='discussion';}],
    ['stale binding epoch',(_s,b)=>{b.lineage.epoch--;}],
    ['stale member epoch',s=>{s.groups.group.members[0].epoch++;}],
    ['replaced participant channel',s=>{s.meetings['target-meeting'].participants[0].sessionId='replacement';}],
    ['inactive current member',s=>{s.groups.group.members[0].active=false;}],
    ['inactive participant',s=>{s.meetings['target-meeting'].participants[0].active=false;}],
    ['stale participant epoch',s=>{s.meetings['target-meeting'].participants[0].memberEpoch++;}],
    ['settled original binding',(_s,b)=>{b.state='settled';}],
  ]){const s=structuredClone(state),b=structuredClone(binding);mutate(s,b);assert.equal(eligible(s,b,target),false,name);}
  const runner=await readFile(new URL('./stock-gui-run.mjs',import.meta.url),'utf8');assert.match(runner,/isCurrentIndependentApprovalProbe\(service\.store\.read\(\),binding,/,'The actual installed runner must invoke this receipt/current-lineage gate');
});

test('main selection baseline waits for public catalog and original binding restoration',async()=>{
  const {observeOriginalMainReadiness:observe}=await import('./stock-v130-bot-space-checks.mjs');assert.equal(typeof observe,'function');
  let roster={phase:'pending',byId:{}},workspace={phase:'pending'},session={openState:'loading',removed:false};
  let retained=0,navigated=0;const sessions={list:{getSnapshot:()=>roster},binding:()=>({session:{getSnapshot:()=>session}}),retain:()=>{retained++;}};
  const window={__stockV130ClientServices:{sessions,workspaces:{list:{getSnapshot:()=>workspace}},uiWorkspace:{openSession:()=>{navigated++;}}}};
  const sandbox={window};vm.createContext(sandbox);vm.runInContext(`const observe=${observe.toString()};`,sandbox);
  const facts=()=>JSON.parse(JSON.stringify(vm.runInContext('observe()',sandbox)));
  assert.equal(facts().ready,false,'pre-catalog empty refs cannot become the baseline');
  roster={phase:'ready',byId:{}};workspace={phase:'ready'};assert.equal(facts().ready,false,'ready catalogs still await original main restoration');
  roster.byId.original={id:'original',retainedBy:{mainView:1}};assert.equal(facts().ready,false,'main retain before binding opens is not complete restoration');
  session={openState:'open',removed:false};const baseline=facts();assert.equal(baseline.ready,true);assert.deepEqual(baseline.mainIds,['original']);
  for(const change of [()=>{workspace={phase:'pending'};},()=>{workspace={phase:'ready'};roster.phase='pending';},()=>{roster.phase='ready';session.removed=true;},()=>{session.removed=false;roster.byId.other={id:'other',retainedBy:{mainView:1}};}]){change();assert.equal(facts().ready,false);}
  assert.deepEqual(baseline.mainIds,['original'],'later facts do not rewrite the captured exact original baseline');assert.equal(retained,0);assert.equal(navigated,0);
  const helper=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  assert.ok(helper.indexOf('page.evaluate(observeOriginalMainReadiness)')<helper.indexOf('const main='),'restoration must be awaited before actual main equality baseline capture');
});

test('qualification context reads optional workspace through public actual Cordis lookup',async()=>{
  const {Context}=await import('@deepseek-ai/cordis'),{observeOriginalMainReadiness:observe}=await import('./stock-v130-bot-space-checks.mjs');
  const root=new Context(),roster={phase:'ready',byId:{original:{id:'original',retainedBy:{mainView:1}}}};
  const services={sessions:{list:{getSnapshot:()=>roster},binding:()=>({session:{getSnapshot:()=>({openState:'open',removed:false})}})},layout:{},uiSession:{},connection:{}};
  const provider=root.plugin({name:'qualification-service-provider',apply(ctx){for(const [name,value] of Object.entries(services))ctx.provide(name,value);}});await provider.await();
  const source=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  const observation=source.slice(source.indexOf('export function observeInstalledClientContext()'),source.indexOf('async function clientFacts')).replace('export function','function');
  const window={},sandbox={window};vm.createContext(sandbox);vm.runInContext(`${observation};observeInstalledClientContext();const readiness=${observe.toString()};`,sandbox);
  let owner,factoryCalls=0,applyCalls=0,workspaceProvider;
  const inject=['sessions','layout','uiSession','connection'],plugin={name:'qualification-observed-bot',inject,apply(ctx){applyCalls++;owner=ctx;}};
  window.__ModuleLoader__={load:record=>record.factory()};
  const actual=window.__ModuleLoader__.load({id:'dsh-bot',factory(){factoryCalls++;return plugin;}}),fork=root.plugin(actual);
  const facts=()=>JSON.parse(JSON.stringify(vm.runInContext('readiness()',sandbox)));
  try {
    await fork.await();assert.equal(actual,plugin);assert.equal(actual.inject,inject);assert.equal(factoryCalls,1);assert.equal(applyCalls,1);
    assert.throws(()=>owner.workspaces,/cannot get property "workspaces" without inject/,'actual Cordis scoped property access must remain guarded');
    assert.equal(owner.get('workspaces'),undefined);assert.equal(facts().ready,false,'absent optional public service cannot complete main restoration');
    workspaceProvider=root.plugin({name:'qualification-workspace-provider',apply(ctx){ctx.provide('workspaces',{list:{getSnapshot:()=>({phase:'ready'})}});}});await workspaceProvider.await();
    assert.throws(()=>owner.workspaces,/without inject/,'fixture must not alter original inject metadata');
    assert.equal(owner.get('workspaces').list.getSnapshot().phase,'ready');assert.deepEqual(facts(),{ready:true,mainIds:['original']});
    await workspaceProvider.dispose();workspaceProvider=undefined;assert.equal(owner.get('workspaces'),undefined);assert.equal(facts().ready,false,'inactive service must not leave a captured stale readiness face');
    assert.equal(factoryCalls,1);assert.equal(applyCalls,1);
  } finally {await workspaceProvider?.dispose();await fork.dispose();await provider.dispose();}
});
