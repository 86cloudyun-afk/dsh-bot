/** Setup metadata fixtures only; actual native launch is separately verified. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
async function optional(path){try{return await import(path);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};}}
const setup=await optional('../scripts/install-owner-profile.mjs');
test('owner profile installer exists and creates an exclusive standalone zero-tool composition',async()=>{
 assert.equal(typeof setup.installOwnerProfile,'function');
 const root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'owner-profile-')),runtime=join(root,'runtime'),home=join(root,'home');
 await mkdir(join(runtime,'node_modules','@deepseek-ai','dsh','lib'),{recursive:true});await writeFile(join(runtime,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'// setup metadata fixture only');
 await writeFile(join(runtime,'owner-runtime-manifest.json'),JSON.stringify({format:1,officialDshVersion:'0.2.0-rc.2',coreCandidate:'3fbedc25d3626caf4e401b14c31a7f0326a19ec7'}));
 const result=await setup.installOwnerProfile({runtimeDirectory:runtime,homeDirectory:home});assert.equal(result.profile,'dsh-bot-owner');
 const manifest=JSON.parse(await readFile(join(home,'profiles','dsh-bot-owner','package.json'),'utf8'));assert.deepEqual(manifest.dsh.profile.bundles,[]);
 const patch=JSON.parse(await readFile(join(home,'profiles','dsh-bot-owner','cordis.patch.yml'),'utf8')),rows=patch[0].insert;
 assert.equal(rows.find(r=>r.id==='owner-startup').name,'dsh-bot/owner-startup');assert.equal(rows.find(r=>r.id==='owner-app').name,'dsh-bot/owner-app');
 assert.ok(rows.filter(r=>r.id!=='owner-startup').every(r=>r.inject.includes('dshBotOwnerStartup')));
 assert.ok(!JSON.stringify(patch).includes('BrowserAuth'));assert.ok(!JSON.stringify(patch).includes('dsh-base'));assert.ok(!JSON.stringify(patch).includes('dsh-tool-'));
 assert.equal(rows.find(r=>r.id==='provider').config.apiKeyEnv,'DEEPSEEK_API_KEY');assert.equal(rows.find(r=>r.id==='provider').config.baseURL,'https://api.deepseek.com/anthropic');
 assert.equal(rows.find(r=>r.id==='preset').config.plugins.length,0);
 const before=await readFile(join(home,'profiles','dsh-bot-owner','cordis.patch.yml'));await assert.rejects(()=>setup.installOwnerProfile({runtimeDirectory:runtime,homeDirectory:home}),{code:'EEXIST'});
 assert.deepEqual(await readFile(join(home,'profiles','dsh-bot-owner','cordis.patch.yml')),before);await assert.rejects(access(join(home,'owner-state')),{code:'ENOENT'});
});
