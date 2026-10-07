/** Owned installation filesystem cases; run with test-bot-gui-profile.mjs, not the pure permission runner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, lstat,mkdir,writeFile,chmod,realpath,rmdir,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {packageSnapshotOptions} from '../test/package-snapshot-fixture.mjs';
import {applyEntryPatches,entryListSchema} from '@deepseek-ai/cordis-plugin-include';
import yaml from 'js-yaml';

async function installer() {
  const m = await import('./install-bot-gui-profile.mjs').catch(e => {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return {};
  });
  assert.equal(typeof m.installBotGuiProfile, 'function', 'missing installable authenticated GUI owner profile');
  return m.installBotGuiProfile;
}
async function options() {
  const root = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT, 'gui-profile-'));
  const runtimeRoot=await mkdtemp(join(root,'runtime-'));await mkdir(join(runtimeRoot,'node_modules'));
  return {directory:join(root,'installation'), productRoot:join(import.meta.dirname,'..'),
    runtimeRoot, cwd:join(root,'harmless'), ...(await packageSnapshotOptions())};
}

test('a relocated no-git GUI export resolves its private native SDK and Cordis from the same caller runtime without copying or editing either package',async()=>{
 const install=await installer(),o=await options(),modules=join(o.runtimeRoot,'node_modules'),names=['@deepseek-ai/dsh-experimental-native-run','@deepseek-ai/cordis'];
 // Resolution-only metadata fixtures. No SDK, model, Agent or native capability is executed here.
 for(const name of names){const directory=join(modules,name);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({name,type:'module',exports:{'.':'./index.mjs'}}));
  await writeFile(join(directory,'index.mjs'),'// resolution fixture only\n');
 }
 const source=join(await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-runtime-export-')),'source'),manifest=JSON.parse(await readFile(o.packageSnapshot.manifestPath));await mkdir(source);
 for(const file of manifest.files){const path=join(source,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(join(o.productRoot,file.path)),{mode:file.mode});await chmod(path,file.mode);}
 await assert.rejects(lstat(join(source,'.git')),{code:'ENOENT'});
 const before=await Promise.all(names.map(name=>readFile(join(modules,name,'package.json')))),result=await install({...o,productRoot:source,packageSourceMode:'verified-export'}),product=join(result.home,'profiles',result.profile,'node_modules','dsh-bot');
 const require=createRequire(join(product,'package.json'));
 for(const name of names)assert.equal(require.resolve(name),join(modules,name,'index.mjs'));
 assert.equal((await lstat(join(product,'node_modules'))).isSymbolicLink(),true);assert.equal(await realpath(join(product,'node_modules')),modules);
 assert.deepEqual(result.runtimeDependencyBinding,{kind:'same-runtime-node-modules',runtimeRoot:o.runtimeRoot,nodeModules:modules,productDependencyView:join(product,'node_modules')});
 assert.deepEqual(await Promise.all(names.map(name=>readFile(join(modules,name,'package.json')))),before);
 assert.deepEqual(await readdir(join(modules,'@deepseek-ai')),['cordis','dsh-experimental-native-run']);
 await assert.rejects(lstat(join(source,'node_modules')),{code:'ENOENT'});
 assert.equal(result.packageInstallation.recordedSourceRoot,manifest.sourceRoot);assert.equal(result.packageInstallation.verifiedExportRoot,source);
});

test('GUI installation refuses a missing or aliased runtime dependency tree before creating its Home',async()=>{
 const install=await installer();
 for(const alias of [false,true]){
  const o=await options(),modules=join(o.runtimeRoot,'node_modules');await rmdir(modules);
  if(alias){const elsewhere=await mkdtemp(join(dirname(o.runtimeRoot),'foreign-modules-'));await symlink(elsewhere,modules,'dir');}
  await assert.rejects(()=>install(o),{message:'gui_runtime_dependencies_required'});
  await assert.rejects(lstat(o.directory),{code:'ENOENT'});
 }
});

test('fresh GUI profile installs packed owner with real BrowserAuth and an empty tool preset', async () => {
  const install = await installer(), o = await options(), r = await install(o);
  const profileDir = join(r.home,'profiles',r.profile);
  const manifest = JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']);
  assert.equal((await lstat(join(profileDir,'node_modules','dsh-bot'))).isSymbolicLink(), false);
  const patch = JSON.parse(await readFile(join(profileDir,'cordis.patch.yml'),'utf8'));
  for (const id of ['preset-standard','preset-ptc','preset-minimal','preset-cordis','tool-goal','tool-bash','tool-fs','tool-subagent','session-title-llm','file-upload']) {
    assert.equal(patch.find(p => p.id === id)?.disabled, true, `${id} must not expose a model or secondary input path`);
  }
  assert.deepEqual(patch.find(p => p.id === 'agent-preset-registry').config, {default:'dsh-bot/empty'});
  assert.deepEqual(patch.find(p => p.id === 'connection').config.trustedHosts, []);
  const added = patch.flatMap(p => p.insert ?? []);
  assert.deepEqual(added.find(p => p.id === 'bot-gui-preset').config, {id:'dsh-bot/empty',plugins:[]});
  assert.equal(added.find(p => p.id === 'bot-gui-owner').name, 'dsh-bot/bot-gui-owner-app');
  assert.equal(added.find(p => p.id === 'bot-gui-protected-providers')?.name,'dsh-bot/owner-protected-provider',
    'protected preparation must look up the actual native provider directory; a route label cannot grant authority');
  assert.equal(added.find(p => p.id === 'dsh-bot').name, 'dsh-bot');
  assert.equal(added.find(p => p.id === 'bot-gui-surface')?.name,'dsh-bot-gui-surface');
  const surface=JSON.parse(await readFile(join(profileDir,'node_modules','dsh-bot-gui-surface','package.json'),'utf8'));
  assert.equal(surface.private,true);
  assert.deepEqual(surface.dsh.client,{platform:'web',inject:['dsh-bot']});
  assert.ok((await readFile(join(profileDir,'node_modules','dsh-bot-gui-surface','client.js'),'utf8')).includes("id:'dsh-bot-gui-surface'"));
  assert.equal(added.find(p => p.id === 'bot-gui-owner').config.homeDirectory, r.home);
  assert.equal(added.find(p => p.id === 'bot-gui-owner').config.cwd, r.cwd);
  assert.deepEqual(added.find(p => p.id === 'bot-gui-owner').config.initialMode,
    {permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'});
  assert.deepEqual(added.find(p => p.id === 'bot-gui-owner').config.delegationPolicy,
    {parentWorkTools:'delegate',childWorkTools:'none',maxDepth:1,workLimit:15});
  assert.deepEqual(patch.find(p => p.id === 'sandbox-policy')?.config,
    {mode:'workspace-write',workspaceRoot:r.cwd});
  assert.deepEqual(patch.find(p => p.id === 'approval')?.config,{policy:'ask'});
  assert.equal(patch.find(p => p.id === 'permission')?.config.defaultPreset,'workspace-write');
  assert.equal(patch.find(p => p.id === 'llm-deepseek').config.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.deepEqual(await readdir(r.cwd), []);
  assert.deepEqual(r.credentialReferences, ['DEEPSEEK_API_KEY']);
  assert.equal(r.credentialsCreated, false);
  assert.equal(r.coreSdkEdited, false);
  const bundleRoot=join(import.meta.dirname,'..','node_modules','@deepseek-ai');
  const base=yaml.load(await readFile(join(bundleRoot,'dsh-base','cordis.patch.yml'),'utf8'),{schema:entryListSchema});
  const webManifest=JSON.parse(await readFile(join(bundleRoot,'dsh-web-app','package.json'),'utf8'));
  const web=[];
  for(const path of webManifest.dsh.bundle.patch) web.push(...yaml.load(await readFile(join(bundleRoot,'dsh-web-app',path),'utf8'),{schema:entryListSchema}));
  let rows=applyEntryPatches([],base,()=>{});
  rows=applyEntryPatches(rows,web,()=>{});
  rows=applyEntryPatches(rows,patch,()=>{});
  assert.equal(rows.find(r=>r.id==='web-startup').disabled,true,'stock Web flags must not swallow owner enablement');
  assert.equal(rows.find(r=>r.id==='bot-gui-startup')?.name,'dsh-bot/bot-gui-startup');
  assert.equal(rows.find(r=>r.id==='session-controller').disabled,true,'stock client controller requires fileUpload; keep only its native host class');
  assert.equal(rows.find(r=>r.id==='bot-gui-session-controller')?.name,'dsh-bot/bot-gui-session-controller');
  for(const id of ['ui-session','ui-workspace','ui-conversation','ui-sidebar']) assert.equal(rows.find(r=>r.id===id).disabled,true,'single Bot surface must not depend on unrelated Session/fileUpload UI');
  for(const id of ['cordis-client-runner','workspace-controller']) assert.equal(rows.find(r=>r.id===id).disabled,true,'unrelated dynamic/workspace surfaces remain closed');
  assert.notEqual(rows.find(r=>r.id==='ui-settings').disabled,true,'stock locale/theme require configForms provided by the settings client');
  assert.notEqual(rows.find(r=>r.id==='config-editor').disabled,true,'stock locale/settings reads need their config service');
  assert.ok(rows.find(r=>r.id==='connection').inject.includes('webServer'),'stock RPC handler captures Connection activation and needs webServer there');
  assert.ok(rows.find(r=>r.id==='connection').config.maxRequestBodyBytes>=280668843,'respect stock aggregate attachment invariant');
});

test('GUI profile refuses reuse and source/runtime nesting before writes', async () => {
  const install = await installer(), o = await options();
  await install(o);
  await assert.rejects(() => install(o));
  await assert.rejects(() => install({...o,directory:join(o.productRoot,'unsafe-new-home')}));
  await assert.rejects(() => install({...o,cwd:join(o.directory,'inside-installation')}));
});

test('GUI verified export installs from a fresh moved no-git product while preserving the trusted recorded checkout',async()=>{
 const install=await installer(),o=await options(),source=join(await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-export-')),'source');
 const manifest=JSON.parse(await readFile(o.packageSnapshot.manifestPath));await mkdir(source);
 for(const file of manifest.files){const path=join(source,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(join(o.productRoot,file.path)),{mode:file.mode});await chmod(path,file.mode);}
 await assert.rejects(lstat(join(source,'.git')),{code:'ENOENT'});
 const installed=await install({...o,productRoot:source,packageSourceMode:'verified-export'});
 assert.equal(installed.packageInstallation.recordedSourceRoot,manifest.sourceRoot);
 assert.equal(installed.packageInstallation.verifiedExportRoot,source);
 assert.equal(installed.packageInstallation.packageSourceMode,'verified-export');
 assert.equal(installed.packageInstallation.sourceWorktreeClean,manifest.sourceWorktreeClean);
 assert.equal(installed.packageInstallation.packageSHA256,manifest.packageSHA256);
 assert.deepEqual(await readFile(join(installed.home,'profiles',installed.profile,'node_modules','dsh-bot','src/bot-gui-owner-app.mjs')),
   await readFile(join(o.productRoot,'src/bot-gui-owner-app.mjs')));
});
