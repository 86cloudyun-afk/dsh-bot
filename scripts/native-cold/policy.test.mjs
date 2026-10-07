import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import child from 'node:child_process';
import worker from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';
import './preflight.test.mjs';

// Every native loader, exit, model and filesystem operation in these fixtures is fake.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const platforms = JSON.parse(read('platforms.json'));
test('actual companion bodies stop SYSTEM failures and every DNS entry before continuation',()=>{
  const result=Function(read('boundary.fixture.js'))()(read('companion.mjs'));
  assert.equal(result.tests,14);
  assert.equal(result.passed,14,JSON.stringify(result.failed));
});
const installedIdentity=await import('./installed-identity.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function syntheticSDK(t){
 const root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'sdk-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'node_modules','synthetic-sdk');await mkdir(directory,{recursive:true});
 await writeFile(join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/synthetic-sdk':{version:'1.0.0',integrity:'sha512-synthetic-fixture'}}}));
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'synthetic-sdk',version:'1.0.0'}));await writeFile(join(directory,'index.js'),'export const synthetic=true;\n');
 return {root,directory};
}
test('SDK identity rejects same-version JS drift before or after a child',async t=>{
 assert.equal(typeof installedIdentity.makeSDKInventory,'function');
 const {root,directory}=await syntheticSDK(t),inventory=await installedIdentity.makeSDKInventory(root);
 await installedIdentity.assertSDKInventory(root,inventory);
 await writeFile(join(directory,'index.js'),'export const synthetic=false;\n');
 await assert.rejects(async()=>installedIdentity.assertSDKInventory(root,inventory));
});
test('SDK identity rejects additions deletion and lock drift',async t=>{
 assert.equal(typeof installedIdentity.makeSDKInventory,'function');
 for(const fault of ['addition','deletion','lock']){
  const {root,directory}=await syntheticSDK(t),inventory=await installedIdentity.makeSDKInventory(root);
  if(fault==='addition')await writeFile(join(directory,'added.js'),'export {};');
  if(fault==='deletion')await rm(join(directory,'index.js'));
  if(fault==='lock')await writeFile(join(root,'package-lock.json'),'{}');
  await assert.rejects(async()=>installedIdentity.assertSDKInventory(root,inventory),fault);
 }
});
test('installed current product identity rejects copied-file mutation',async t=>{
 assert.equal(typeof installedIdentity.assertInstalledProduct,'function');
 const root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'product-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));
 const bytes=Buffer.from('export const synthetic=true;\n');await writeFile(join(root,'src','synthetic.mjs'),bytes,{mode:0o644});
 await chmod(join(root,'src','synthetic.mjs'),0o644);
 const receipt={sourceHead:'a'.repeat(40),sourceTree:'b'.repeat(40),files:[{path:'src/synthetic.mjs',bytes:bytes.length,sha256:hash(bytes),mode:0o644}]};
 await installedIdentity.assertInstalledProduct(root,receipt);
 await writeFile(join(root,'src','synthetic.mjs'),'export const synthetic=false;\n');await assert.rejects(async()=>installedIdentity.assertInstalledProduct(root,receipt));
});
for (const [group, count] of [['dual-guard',19],['observer',12],['model-stop',10]]) {
  const fixture = Function(read(group+'.fixture.js'))();
  const source = read(group+'.mjs');
  const result = group==='dual-guard' ? fixture(source,platforms['linux-x64']) : group==='observer' ? fixture(source,read('stop.mjs')) : fixture(source);
  test(group+' pure fixtures preserve refusal and observation boundaries',()=>{
    assert.equal(result.tests,count);
    assert.equal(result.passed,count,JSON.stringify(result.failed));
  });
}
const fixture = read('dual-guard.fixture.js');
const macFixture = fixture
  .replaceAll('@deepseek-ai/node-addon-system-linux-x64/bin/glibc/system.node','@deepseek-ai/node-addon-system-darwin-arm64/bin/system.node')
  .replaceAll('@deepseek-ai/node-addon-system-linux-x64','@deepseek-ai/node-addon-system-darwin-arm64')
  .replaceAll('node-addon-require-builtin-linux-x64-gnu','node-addon-require-builtin-darwin-arm64')
  .replaceAll('linux-x64-gnu-napi-v9.node','darwin-arm64-napi-v9.node')
  .replaceAll('/linux-x64-gnu/','/darwin-arm64/')
  .replaceAll('54a9c25c05186c17520f6b7a5ced5f005752c08044c3eb76524cd517287600bc',platforms['darwin-arm64'].bindings[0].sha256)
  .replaceAll('864d3c453f1046fe20d76ed89023213d71aff61fd5a8d1daffd11c229d73935e',platforms['darwin-arm64'].bindings[1].sha256)
  .replaceAll('SYSTEM_GLIBC','SYSTEM_DARWIN_ARM64')
  .replaceAll('REQUIRE_BUILTIN_LINUX_NAPI9','REQUIRE_BUILTIN_DARWIN_ARM64_NAPI9');
test('macOS pins independently enforce all 19 native policy fixtures',()=>{
  const result=Function(macFixture)()(read('dual-guard.mjs'),platforms['darwin-arm64']);
  assert.equal(result.passed,19,JSON.stringify(result.failed));
});
test('DNS CJS and both ESM facades share denied functions without a DNS request',async()=>{
 const source=read('companion.mjs'),start=source.indexOf(' const networkDenied=()=>'),end=source.indexOf(" checkpoint('C_BUILTIN_EXPORT_SYNC');",start);
 assert.ok(start>=0&&end>start);
 const state={networkAttempts:0,spawnAttempts:0,workerAttempts:0};
 const refused=()=>{throw Error('SYNTHETIC_CAPTURED_STOP');};
 Function('state','refused','net','http','https','tls','dgram','http2','child','worker','dns','dnsPromises',source.slice(start,end))(state,refused,net,http,https,tls,dgram,http2,child,worker,dns,dnsPromises);
 syncBuiltinESMExports();
 for(const [object,namespace] of [[dns,await import('node:dns')],[dnsPromises,await import('node:dns/promises')]])for(const name of Object.keys(object))if(typeof object[name]==='function')assert.equal(namespace[name],object[name],name);
 assert.equal(state.networkAttempts,0);
});
