import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const mod = await import('../scripts/package-snapshot.mjs').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const sha = b => createHash('sha256').update(b).digest('hex');
const context = async () => JSON.parse(await readFile(join(process.env.DSH_BOT_TEST_ROOT,'current-package-snapshot.json'),'utf8'));
const productRoot = join(import.meta.dirname,'..');
async function target(){return join(await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'package-snapshot-')),'dsh-bot');}
test('snapshot installs the fresh real package as regular files and binds source/build hashes',async()=>{
 assert.equal(typeof mod.installProductPackage,'function');const directory=await target(),receipt=await mod.installProductPackage({directory,productRoot,packagePlacement:'snapshot',packageSnapshot:await context()});
 assert.equal(receipt.packagePlacement,'snapshot');assert.match(receipt.sourceHead,/^[a-f0-9]{40}$/);assert.match(receipt.sourceTree,/^[a-f0-9]{40}$/);assert.match(receipt.packageSHA256,/^[a-f0-9]{64}$/);assert.equal(receipt.buildId,(await context()).buildId);
 assert.equal((await lstat(directory)).isSymbolicLink(),false);assert.deepEqual(await readFile(join(directory,'src/bot-chain-intake.mjs')),await readFile(join(productRoot,'src/bot-chain-intake.mjs')));
 assert.equal((await readdir(directory)).includes('scripts'),false);await assert.rejects(mod.installProductPackage({directory,productRoot,packagePlacement:'snapshot',packageSnapshot:await context()}),{code:'EEXIST'});
});
test('snapshot refuses absent package provenance and stale build identity without writes',async()=>{
 assert.equal(typeof mod.installProductPackage,'function');for(const packageSnapshot of [undefined,{...await context(),buildId:'old-cached-build'},{...await context(),manifestSHA256:'0'.repeat(64)}]){
  const directory=await target();await assert.rejects(mod.installProductPackage({directory,productRoot,packagePlacement:'snapshot',packageSnapshot}));await assert.rejects(lstat(directory),{code:'ENOENT'});
 }
});
test('snapshot rejects unknown placement rather than falling back to a link',async()=>{
 assert.equal(typeof mod.installProductPackage,'function');const directory=await target();await assert.rejects(mod.installProductPackage({directory,productRoot,packagePlacement:'cached',packageSnapshot:await context()}),{message:'package_placement_invalid'});await assert.rejects(lstat(directory),{code:'ENOENT'});
});
async function syntheticSource(){
 const original=await context(),manifest=JSON.parse(await readFile(original.manifestPath)),root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'synthetic-source-snapshot-')),source=join(root,'source');await mkdir(source);
 for(const file of manifest.files){const path=join(source,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(join(productRoot,file.path)),{mode:file.mode});}
 await writeFile(join(root,manifest.tarball),await readFile(join(dirname(original.manifestPath),manifest.tarball)));
 manifest.sourceRoot=source;const bytes=JSON.stringify(manifest),manifestPath=join(root,'manifest.json');await writeFile(manifestPath,bytes);
 return {source,directory:join(root,'installed'),manifest,packageSnapshot:{...original,manifestPath,manifestSHA256:sha(bytes)}};
}
test('synthetic snapshot descriptor refuses changed current source and missing package before install',async()=>{
 for(const missing of [false,true]){const f=await syntheticSource();if(missing)await (await import('node:fs/promises')).unlink(join(f.source,'package.json'));else await writeFile(join(f.source,'src/bot-chain-intake.mjs'),'changed synthetic source');
  await assert.rejects(mod.installProductPackage({directory:f.directory,productRoot:f.source,packagePlacement:'snapshot',packageSnapshot:f.packageSnapshot}));await assert.rejects(lstat(f.directory),{code:'ENOENT'});
 }
});
test('snapshot refuses changed archive bytes without installing a cached substitute',async()=>{
 const f=await syntheticSource();await writeFile(join(dirname(f.packageSnapshot.manifestPath),f.manifest.tarball),'changed synthetic archive');await assert.rejects(mod.installProductPackage({directory:f.directory,productRoot:f.source,packagePlacement:'snapshot',packageSnapshot:f.packageSnapshot}),{message:'package_snapshot_archive_changed'});await assert.rejects(lstat(f.directory),{code:'ENOENT'});
});
test('snapshot refuses a destination inside package source without writing it',async()=>{
 const f=await syntheticSource(),directory=join(f.source,'installed');await assert.rejects(mod.installProductPackage({directory,productRoot:f.source,packagePlacement:'snapshot',packageSnapshot:f.packageSnapshot}),{message:'package_snapshot_destination_invalid'});await assert.rejects(lstat(directory),{code:'ENOENT'});
});
test('snapshot archive rejects path escape, links and special modes before extraction',()=>{
 assert.equal(typeof mod.decodePackageArchive,'function');
 const archive=(path,type='0',mode=0o644)=>{const h=Buffer.alloc(512);h.write(path);h.write(mode.toString(8).padStart(7,'0')+'\0',100);h.write('00000000001\0',124);h.fill(32,148,156);h[156]=type.charCodeAt();const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return Buffer.concat([h,Buffer.from('x'),Buffer.alloc(511),Buffer.alloc(1024)]);};
 const regular=archive('package/src/example.mjs');
 for(const bytes of [archive('package/../escape'),archive('/absolute'),archive('package/link','2'),archive('package/src/special','0',0o4644),archive('package/unapproved.txt'),archive('package/src/.env'),Buffer.concat([regular.subarray(0,-1024),regular]),regular.subarray(0,600)])assert.throws(()=>mod.decodePackageArchive(bytes));
});
test('snapshot closure refuses missing exports and missing relative runtime modules',()=>{
 assert.equal(typeof mod.validatePackageClosure,'function');const files=new Map([['package.json',Buffer.from(JSON.stringify({name:'dsh-bot',version:'0.1.0-alpha.1',private:true,files:['src','cordis.patch.yml','README.md'],exports:{'.':'./src/main.mjs'}}))],['README.md',Buffer.from('synthetic')],['cordis.patch.yml',Buffer.from('[]')]]);
 assert.throws(()=>mod.validatePackageClosure(files),{message:'package_snapshot_closure_incomplete'});files.set('src/main.mjs',Buffer.from('export const fixture = true;'));assert.equal(mod.validatePackageClosure(files).name,'dsh-bot');files.set('src/main.mjs',Buffer.from("import './missing.mjs';"));assert.throws(()=>mod.validatePackageClosure(files),{message:'package_snapshot_closure_incomplete'});
});
