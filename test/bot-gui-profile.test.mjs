import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, lstat,mkdir,writeFile,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {packageSnapshotOptions} from './package-snapshot-fixture.mjs';
import {applyEntryPatches,entryListSchema} from '@deepseek-ai/cordis-plugin-include';
import yaml from 'js-yaml';
import {SessionController} from '@deepseek-ai/dsh-api-session-controller';

async function installer() {
  const m = await import('../scripts/install-bot-gui-profile.mjs').catch(e => {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return {};
  });
  assert.equal(typeof m.installBotGuiProfile, 'function', 'missing installable authenticated GUI owner profile');
  return m.installBotGuiProfile;
}
async function options() {
  const root = await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT, 'gui-profile-'));
  return {directory:join(root,'installation'), productRoot:join(import.meta.dirname,'..'),
    runtimeRoot:await mkdtemp(join(root,'runtime-')), cwd:join(root,'harmless'), ...(await packageSnapshotOptions())};
}

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

test('GUI native-only controller uses the exact stock SessionController class', async () => {
  const shim=await import('../src/bot-gui-session-controller.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
  assert.equal(shim.default,SessionController,'do not substitute native Session lifecycle behavior');
  const product=JSON.parse(await readFile(join(import.meta.dirname,'..','package.json'),'utf8'));
  assert.equal(product.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'),false);
});

test('GUI profile refuses reuse and source/runtime nesting before writes', async () => {
  const install = await installer(), o = await options();
  await install(o);
  await assert.rejects(() => install(o));
  await assert.rejects(() => install({...o,directory:join(o.productRoot,'unsafe-new-home')}));
  await assert.rejects(() => install({...o,cwd:join(o.directory,'inside-installation')}));
});

test('GUI installer parses an explicit verified-export boolean without consuming a following path flag',async()=>{
 const module=await import('../scripts/install-bot-gui-profile.mjs');
 assert.equal(typeof module.parseBotGuiInstallArguments,'function');
 const flags=['--verified-export','--directory','/fresh/install','--product','/relocated/export','--runtime','/frozen/runtime','--cwd','/fresh/work',
   '--snapshot-manifest','/trusted/manifest.json','--snapshot-digest','a'.repeat(64),'--snapshot-build-id','trusted-build'];
 const parsed=module.parseBotGuiInstallArguments(flags);
 assert.equal(parsed.verifiedExport,true);assert.equal(parsed.directory,'/fresh/install');assert.equal(parsed.product,'/relocated/export');
 for(const bad of [flags.slice(0,-2),[...flags,'--verified-export'],[...flags,'--unrecognized'],['--verified-export','true',...flags.slice(1)],['--directory','--product']])
  assert.throws(()=>module.parseBotGuiInstallArguments(bad));
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
