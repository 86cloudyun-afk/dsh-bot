import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
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
  assert.equal(added.find(p => p.id === 'dsh-bot').name, 'dsh-bot');
  assert.equal(added.find(p => p.id === 'bot-gui-surface')?.name,'dsh-bot-gui-surface');
  const surface=JSON.parse(await readFile(join(profileDir,'node_modules','dsh-bot-gui-surface','package.json'),'utf8'));
  assert.equal(surface.private,true);
  assert.deepEqual(surface.dsh.client,{platform:'web',inject:['dsh-bot']});
  assert.ok((await readFile(join(profileDir,'node_modules','dsh-bot-gui-surface','client.js'),'utf8')).includes("id:'dsh-bot-gui-surface'"));
  assert.equal(added.find(p => p.id === 'bot-gui-owner').config.homeDirectory, r.home);
  assert.equal(added.find(p => p.id === 'bot-gui-owner').config.cwd, r.cwd);
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
  for(const id of ['cordis-client-runner','workspace-controller','ui-settings']) assert.equal(rows.find(r=>r.id===id).disabled,true,'unrelated public configuration/workspace surfaces remain closed');
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
