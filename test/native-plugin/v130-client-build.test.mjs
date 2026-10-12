import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,cp,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../../',import.meta.url);
test('client build validates deterministic source markers and keeps one official loader factory',async()=>{
  const build=await readFile(new URL('scripts/build-client.mjs',root),'utf8').catch(()=>'');assert.ok(build,'deterministic builder exists');
  execFileSync(process.execPath,['scripts/build-client.mjs','--check'],{cwd:root,stdio:'pipe'});
  const source=await readFile(new URL('src/client/client.js',root),'utf8'),manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));assert.equal((source.match(/window\.__ModuleLoader__\.load\(/g)??[]).length,1);assert.ok(source.includes(`const pluginVersion = ${JSON.stringify(manifest.version)}, clientProtocol = 2;`),'frontend identity must match the packaged server');assert.match(source,/BEGIN GENERATED BOT SPACE/);assert.match(source,/BEGIN GENERATED BOT SPACE STYLES/);
});
test('build check rejects stale generated output without repairing it; rebuilding is byte deterministic',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'dsh-space-build-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await cp(new URL('src',root),join(directory,'src'),{recursive:true});await cp(new URL('scripts',root),join(directory,'scripts'),{recursive:true});
  await cp(new URL('package.json',root),join(directory,'package.json'));
  const path=join(directory,'src/client/client.js'),original=await readFile(path,'utf8');await writeFile(path,original.replace('BEGIN GENERATED BOT SPACE','BEGIN GENERATED BOT SPACE'));
  const helper=join(directory,'src/client/bot-space.js');await writeFile(helper,(await readFile(helper,'utf8'))+'\n// source drift witness\n');
  const result=spawnSync(process.execPath,['scripts/build-client.mjs','--check'],{cwd:directory,encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(await readFile(path,'utf8'),original);
  execFileSync(process.execPath,['scripts/build-client.mjs'],{cwd:directory});const first=await readFile(path,'utf8');execFileSync(process.execPath,['scripts/build-client.mjs'],{cwd:directory});assert.equal(await readFile(path,'utf8'),first);assert.notEqual(first,original);
});
test('build check refuses stale frontend release identity without changing bytes and rebuild aligns the manifest',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'dsh-space-version-build-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await cp(new URL('src',root),join(directory,'src'),{recursive:true});await cp(new URL('scripts',root),join(directory,'scripts'),{recursive:true});await cp(new URL('package.json',root),join(directory,'package.json'));
  const path=join(directory,'src/client/client.js'),original=await readFile(path,'utf8'),stale=original.replace(/const pluginVersion = "[^"]+", clientProtocol = 2;/,'const pluginVersion = "0.0.0", clientProtocol = 2;');assert.notEqual(stale,original);await writeFile(path,stale);
  const result=spawnSync(process.execPath,['scripts/build-client.mjs','--check'],{cwd:directory,encoding:'utf8'});assert.notEqual(result.status,0,'a deterministic factory does not make mismatched release identities valid');assert.equal(await readFile(path,'utf8'),stale,'check must never repair the candidate');
  execFileSync(process.execPath,['scripts/build-client.mjs'],{cwd:directory});const fixed=await readFile(path,'utf8'),manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));assert.ok(fixed.includes(`const pluginVersion = ${JSON.stringify(manifest.version)}, clientProtocol = 2;`));execFileSync(process.execPath,['scripts/build-client.mjs','--check'],{cwd:directory});
});
