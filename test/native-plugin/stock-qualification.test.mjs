import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

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
    Object.assign(row,{previousArtifactSha256:previous.sha256,upgradeArtifactSha256:expected.artifactSha256,freshHostProcessAfterUpgrade:true});
    if(previous.schema===1)row.migration={fromSchema:1,toSchema:2,backupChecksum:'b'.repeat(64),backupPayloadMatchesOriginal:true,allOriginalReceiptIdentitiesPreserved:true,legacySnapshotReadFromClosedOfficialKv:true};
    else row.upgradeSchemaTwo={fromSchema:2,toSchema:2,existingMigrationBackupRetained:true,backupWasPresent:false,allOriginalReceiptIdentitiesPreserved:true,exactV11RowsRetained:true,sourceSnapshotReadFromClosedOfficialKv:true};
  }
  return row;
}

test('actual workflow gate rejects truncated reports previously marked Passed',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'stock-gate-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  for(const source of ['gui','upgrade','upgrade-v101','upgrade-v102','upgrade-v110','upgrade-v111','upgrade-v112']) {
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
  await rm(join(directory,'upgrade-v112','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The sixth immutable upgrade source is mandatory');
  await write('upgrade-v112',report(module,'upgrade-v112',expected));
  await rm(join(directory,'upgrade-v111','stock-gui-report.json'));
  assert.notEqual(run().status,0,'The new fifth immutable upgrade source is mandatory');
});

test('complete named reports retain all supported stock and schema upgrade paths',async()=>{
  const module=await validator();
  assert.deepEqual(Object.keys(module.stockSources),['gui','upgrade','upgrade-v101','upgrade-v102','upgrade-v110','upgrade-v111','upgrade-v112']);
  assert.equal(module.stockSources['upgrade-v111'].sha256,target.artifactSha256);
  assert.equal(module.stockSources['upgrade-v112'].sha256,'426a244ae02927129e315420907ab4b2f9acf16414144e0e6792b7f25bfe48ff');
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

test('frozen package identity binds target version as well as checksum',async t=>{
  const module=await validator(),actual=await module.readStockTarget({root,sourceCommit:target.sourceCommit});
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(actual.packageVersion,manifest.version);
  const scratch=await mkdtemp(join(tmpdir(),'stock-package-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  await mkdir(join(scratch,'dist'));await writeFile(join(scratch,'package.json'),JSON.stringify({...manifest,version:'0.0.0'}));
  await writeFile(join(scratch,'dist','dsh-bot-0.0.0.tgz'),await readFile(join(root,'dist',`dsh-bot-${manifest.version}.tgz`)));
  await assert.rejects(module.readStockTarget({root:scratch,sourceCommit:target.sourceCommit}),'Renaming an old tgz must not manufacture a new package version');
});

