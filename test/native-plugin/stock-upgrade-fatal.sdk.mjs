import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {stockGui} from './stock-gui-runtime.mjs';

const root=resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const artifact=join(root,'dist',`${manifest.name}-${manifest.version}.tgz`);
const legacy=join(root,'dist/dsh-bot-1.1.3.tgz');
const sentinel='SECRET_UPGRADE_FATAL /private/credential https://private.invalid/token';

for(const phase of ['legacy-parent','fresh-target-child'])test(`actual upgrade ${phase} official SDK exit leaves only current known evidence`,{timeout:120000},async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-upgrade-fatal-proof-'));
  t.after(()=>rm(evidence,{recursive:true,force:true}));
  let existingRoot;
  if(phase==='fresh-target-child') {
    // Prepare a genuinely installed current package, as the original parent
    // does before starting this same runner in a fresh host process.
    const prepared=await stockGui({artifact,output:join(evidence,'preparation'),stream:async function*(){throw new Error('Fatal boot proof must not call a model');}});
    existingRoot=prepared.root;
    t.after(()=>rm(existingRoot,{recursive:true,force:true}));
  }
  const preload=join(evidence,'fatal-at-real-sdk-registration.mjs');
  await writeFile(preload,`import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {chromium} from ${JSON.stringify(import.meta.resolve('playwright-core'))};
    const originalOn=process.on;
    originalOn.call(process,'exit',()=>{
      let currentReport;
      try {currentReport=JSON.parse(readFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'stock-gui-report.json'),'utf8'));}
      catch(error){if(error.code!=='ENOENT')throw error;}
      writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'before-observer-exit.json'),JSON.stringify({currentReport}),{mode:0o600});
    });
    process.on=function(event,listener){
      const result=originalOn.call(this,event,listener);
      if(this===process&&event==='unhandledRejection'&&listener.name==='onRejection'){
        process.on=originalOn;
        writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'actual-sdk-registration.json'),JSON.stringify({listener:listener.name,rejectionListeners:process.listeners('unhandledRejection').map(listener=>listener.name),dshHome:process.env.DSH_HOME,existingRoot:process.argv[3]??null}),{mode:0o600});
      }
      return result;
    };
    // The actual SDK/app boot and provider registration have completed here.
    // Hold this public startup boundary before spawning a browser, so the native
    // fatal exit cannot race boot into another error or any task/model action.
    chromium.launch=async()=>{
      writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'actual-browser-entry.json'),JSON.stringify({reached:true}),{mode:0o600});
      setImmediate(()=>Promise.reject(new TypeError(${JSON.stringify(sentinel)})));
      await new Promise(()=>{});
    };`,{mode:0o600});
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const sourceTreeDirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim();
  const args=['--import',preload,join(root,'test/native-plugin/stock-upgrade-run.mjs'),artifact,...(existingRoot?[existingRoot]:[])];
  const child=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,
    env:{...process.env,DSH_BOT_UPGRADE_FROM:'1.1.3',DSH_BOT_GUI_OUTPUT:evidence}});
  await writeFile(join(evidence,'actual-upgrade-child-private.log'),`${child.stdout??''}\n${child.stderr??''}`,{mode:0o600});
  const witnessPath=join(evidence,'actual-sdk-registration.json');
  assert.equal(existsSync(witnessPath),true,'Actual upgrade entrypoint must reach official runProfile and install its native listener');
  const witness=JSON.parse(await readFile(witnessPath,'utf8'));
  assert.equal(witness.listener,'onRejection');
  assert.deepEqual(witness.rejectionListeners,['onRejection'],'The report observer must not handle the SDK rejection');
  assert.equal(witness.existingRoot,existingRoot??null);
  assert.deepEqual(JSON.parse(await readFile(join(evidence,'actual-browser-entry.json'),'utf8')),{reached:true},'The actual stock GUI must complete genuine SDK boot before the controlled startup boundary');
  if(!existingRoot) {
    const installedRoot=dirname(witness.dshHome);
    assert.match(basename(installedRoot),/^dsh-bot-stock-gui-/);
    assert.equal(dirname(installedRoot),tmpdir());
    t.after(()=>rm(installedRoot,{recursive:true,force:true}));
  }
  assert.equal(child.status,1,'The native SDK fatal exit must retain its failure status');
  assert.equal(child.signal,null);
  assert.ok(child.stderr.includes('fatal load failure'),'The real SDK, not the test, must own this direct exit');
  const reportPath=join(evidence,'stock-gui-report.json');
  assert.equal(existsSync(reportPath),true,'Both actual upgrade host entrypoints must preserve evidence on SDK direct exit');
  const bytes=await readFile(reportPath,'utf8'),report=JSON.parse(bytes);
  assert.equal(report.passed,false);assert.equal(report.testsPassed,false);assert.equal(report.teardownComplete,false);
  assert.equal(report.fatalExit,true);assert.deepEqual(report.processExit,{code:1});
  assert.equal(report.fatal,undefined,'A handled SDK rejection has no observed exception cause');
  const {currentReport}=JSON.parse(await readFile(join(evidence,'before-observer-exit.json'),'utf8'));
  // Preserve only errors that the actual runner already observed and wrote
  // before the exit observer; this held boundary has no such earlier error.
  assert.deepEqual(report.error,currentReport?.error);
  assert.deepEqual(report.teardownError,currentReport?.teardownError);
  assert.equal(currentReport,undefined);
  assert.notEqual(report.error?.messageHash,createHash('sha256').update(sentinel).digest('hex'),'The unobserved SDK rejection must not become a fabricated known cause');
  assert.equal(report.stage,'fatal-runner-exit');
  assert.deepEqual(report.checks,{});assert.equal(report.controlledRequests,0);assert.equal(report.realModelRequests,0);
  assert.equal(report.sourceCommit,sourceCommit);assert.equal(report.sourceTreeDirty,sourceTreeDirty);
  assert.equal(report.artifactSha256,createHash('sha256').update(await readFile(existingRoot?artifact:legacy)).digest('hex'));
  assert.equal(report.standardProfile,true);assert.equal(report.standardPluginInstall,true);assert.equal(report.controlledProvider,true);
  assert.deepEqual(report.browserErrors,[]);
  assert.equal((await stat(reportPath)).mode&0o777,0o600);
  for(const secret of ['SECRET_UPGRADE_FATAL','/private/credential','private.invalid','token'])assert.equal(bytes.includes(secret),false);
});

test('actual upgrade parent preserves the failed fresh child report and records only its own cleanup',{timeout:210000},async t=>{
  const evidence=await mkdtemp(join(tmpdir(),'dsh-upgrade-parent-proof-'));
  t.after(()=>rm(evidence,{recursive:true,force:true}));
  const reporter=new URL('./stock-fatal-report.mjs',import.meta.url).href,sdk=import.meta.resolve('@deepseek-ai/dsh-app-boot');
  // Seed an actual previous failed SDK run in this reused evidence path. The
  // parent must remove this one report before starting its new child.
  const oldRun=spawnSync(process.execPath,['--input-type=module','--eval',
    `import {installStockFatalReport} from ${JSON.stringify(reporter)};import {installFailLoud} from ${JSON.stringify(sdk)};
    installStockFatalReport(()=>undefined,{output:${JSON.stringify(evidence)}});installFailLoud('controlled-prior-run',process);Promise.reject(new Error('controlled prior failed run'));`],{encoding:'utf8'});
  assert.equal(oldRun.status,1);assert.equal(oldRun.signal,null);
  assert.equal(existsSync(join(evidence,'stock-gui-report.json')),true);
  const runner=join(root,'test/native-plugin/stock-upgrade-run.mjs'),preload=join(evidence,'fatal-only-in-real-fresh-child.mjs');
  await writeFile(preload,`import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {chromium} from ${JSON.stringify(import.meta.resolve('playwright-core'))};
    if(resolve(process.argv[1]??'')===${JSON.stringify(runner)}&&process.argv[3]){
      const originalOn=process.on;
      process.on=function(event,listener){
        const result=originalOn.call(this,event,listener);
        if(event==='unhandledRejection'&&listener.name==='onRejection'){
          process.on=originalOn;
          writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'actual-fresh-child-sdk.json'),JSON.stringify({listener:listener.name,installedRoot:process.argv[3]}),{mode:0o600});
        }
        return result;
      };
      chromium.launch=async()=>{
        writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'report-at-fresh-child-boot.json'),JSON.stringify({previousReportPresent:existsSync(join(process.env.DSH_BOT_GUI_OUTPUT,'stock-gui-report.json'))}),{mode:0o600});
        // Registered after the real runner's observer: capture its exact fatal
        // report before this same evidence path returns to the original parent.
        process.on('exit',()=>writeFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'actual-fresh-child-fatal.json'),readFileSync(join(process.env.DSH_BOT_GUI_OUTPUT,'stock-gui-report.json')),{mode:0o600}));
        setImmediate(()=>Promise.reject(new TypeError(${JSON.stringify(sentinel)})));
        await new Promise(()=>{});
      };
    }`,{mode:0o600});
  const executablePath=process.env.DSH_BOT_CHROMIUM || (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const parent=spawnSync(process.execPath,[runner,artifact],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,
    env:{...process.env,DSH_BOT_UPGRADE_FROM:'1.1.3',DSH_BOT_GUI_OUTPUT:evidence,
      NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${pathToFileURL(preload).href}`,
      ...(executablePath?{DSH_BOT_CHROMIUM:executablePath}:{})}});
  await writeFile(join(evidence,'actual-upgrade-parent-private.log'),`${parent.stdout??''}\n${parent.stderr??''}`,{mode:0o600});
  const witness=JSON.parse(await readFile(join(evidence,'actual-fresh-child-sdk.json'),'utf8'));
  assert.equal(witness.listener,'onRejection');
  assert.match(basename(witness.installedRoot),/^dsh-bot-stock-gui-/);assert.equal(dirname(witness.installedRoot),tmpdir());
  t.after(()=>rm(witness.installedRoot,{recursive:true,force:true}));
  assert.equal(parent.status,1);assert.equal(parent.signal,null);
  const child=JSON.parse(await readFile(join(evidence,'actual-fresh-child-fatal.json'),'utf8'));
  const bytes=await readFile(join(evidence,'stock-gui-report.json'),'utf8'),final=JSON.parse(bytes);
  assert.equal(child.teardownComplete,false);assert.equal(child.controlledRequests,0);assert.equal(child.realModelRequests,0);
  assert.equal(child.requests,undefined);assert.equal(child.fatal,undefined);assert.equal(child.error,undefined);
  assert.deepEqual(child.processExit,{code:1});assert.deepEqual(child.checks,{});
  assert.equal(final.teardownComplete,child.teardownComplete,'Parent cleanup cannot complete the failed child cleanup');
  assert.equal(final.requests,undefined,'The original parent model history must not leak into the current child report');
  assert.deepEqual(final.parentCleanup,{complete:true});
  assert.equal(final.parentError.type,'Error');assert.match(final.parentError.messageHash,/^[a-f\d]{64}$/);
  const {parentCleanup,parentError,...retainedChild}=final;
  assert.deepEqual(retainedChild,child,'Every original child fact must survive parent catch, cleanup and actual process exit');
  assert.deepEqual(JSON.parse(await readFile(join(evidence,'report-at-fresh-child-boot.json'),'utf8')),{previousReportPresent:false});
  const original=JSON.parse(await readFile(join(witness.installedRoot,'upgrade-legacy-state.json'),'utf8'));
  const fixture=JSON.parse(await readFile(join(witness.installedRoot,'upgrade-original.json'),'utf8'));
  assert.ok(fixture.legacyControlledRequests>0,'The real original native task must run before the fresh host starts');
  assert.ok(original.operations[fixture.request.operationId]);
  const documents=[];
  const inspect=async directory=>{
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory()&&!['node_modules','cache','packages'].includes(entry.name))await inspect(path);
      else if(entry.isFile()&&/^dsh_bot_v1(?:_[a-f0-9]{24})?\.json$/.test(entry.name)) {
        const document=JSON.parse(await readFile(path,'utf8'));
        if(document.tables?.state?.current?.storeId===original.storeId)documents.push(document.tables.state.current);
      }
    }
  };
  await inspect(witness.installedRoot);
  assert.equal(documents.length,1,'The genuinely restarted target keeps the original official KV store');
  for(const [id,receipt] of Object.entries(original.operations)) {
    assert.deepEqual(documents[0].operations[id],receipt,'Every original receipt retains its exact fingerprint and result');
  }
  const recoveries=Object.entries(documents[0].operations).filter(([id,receipt])=>!Object.hasOwn(original.operations,id)&&receipt.action==='recovery.reconcile');
  assert.ok(recoveries.length>0,'The actual target must reconcile its native startup state');
  for(const [,receipt] of recoveries)assert.equal(receipt.result.replayed,0,'Fatal host startup must not replay any original operation');
  for(const table of ['bots','sessions','memories','tasks','attempts','outbox','materials','schedules','occurrences','notices']) {
    for(const id of Object.keys(original[table]))assert.ok(Object.hasOwn(documents[0][table],id),`${table} original identity survives the actual restart`);
  }
  for(const secret of ['SECRET_UPGRADE_FATAL','/private/credential','private.invalid','token'])assert.equal(bytes.includes(secret),false);
});
