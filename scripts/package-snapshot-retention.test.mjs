import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {installProductPackage,decodePackageArchive,currentPackageIndex} from './package-snapshot.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oct=(n,length)=>n.toString(8).padStart(length-1,'0')+'\0';
function archive(files){
 const blocks=[];
 for(const [path,value]of Object.entries(files)){
  const bytes=Buffer.from(value),header=Buffer.alloc(512);
  header.write('package/'+path);header.write(oct(0o644,8),100);header.write(oct(bytes.length,12),124);
  header.fill(32,148,156);header.write('0',156);header.write(oct(header.reduce((a,b)=>a+b,0),7)+' ',148);
  blocks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
 }
 return Buffer.concat([...blocks,Buffer.alloc(1024)]);
}
async function fixture(t){
 const parent='/workspace/dsh-v1-evidence/distribution-consumer/package-retention';
 await fs.mkdir(parent,{recursive:true,mode:0o700});
 const root=await fs.realpath(await fs.mkdtemp(join(parent,'fixture-'))),source=join(root,'source');
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const payload={'package.json':JSON.stringify({name:'dsh-bot',version:'0.1.0-alpha.1',private:true,type:'module',files:['src','cordis.patch.yml','README.md'],exports:{'.':'./src/main.mjs'}}),
  'README.md':'Synthetic package for filesystem retention testing.\n','cordis.patch.yml':'[]\n','src/main.mjs':'export const fixture=true;\n'};
 for(const [path,value]of Object.entries(payload)){
  const absolute=join(source,path);await fs.mkdir(dirname(absolute),{recursive:true});await fs.writeFile(absolute,value,{mode:0o644});await fs.chmod(absolute,0o644);
 }
 const bytes=archive(payload),tarball='synthetic-package.tgz';await fs.writeFile(join(root,tarball),bytes,{mode:0o600});
 const manifest={format:1,buildId:'synthetic-retention-build',sourceRoot:source,sourceHead:'a'.repeat(40),sourceTree:'b'.repeat(40),
  packageSourceClean:true,sourceWorktreeClean:true,tarball,packageSHA256:sha(bytes),files:await currentPackageIndex(source,decodePackageArchive(bytes))};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)),manifestPath=join(root,'manifest.json');await fs.writeFile(manifestPath,manifestBytes,{mode:0o600});
 return {root,options:{directory:join(root,'installed'),productRoot:source,packagePlacement:'snapshot',packageSnapshot:{manifestPath,manifestSHA256:sha(manifestBytes),buildId:manifest.buildId}}};
}
function failOwnedWrite(t,output){
 const write=fs.writeFile;let failed=false;
 t.mock.method(fs,'writeFile',async(path,...args)=>{
  const result=await write(path,...args);
  if(String(path).startsWith(output+'/')&&!failed){failed=true;throw Object.assign(new Error('synthetic disk write failure'),{code:'EIO'});}
  return result;
 });
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return ()=>failed;
}

test('package write failure retains partial private output and original error',async t=>{
 const {options}=await fixture(t),failed=failOwnedWrite(t,options.directory);
 await assert.rejects(installProductPackage(options),{code:'EIO',failureOutputPolicy:'RETAINED_NO_AUTOMATIC_REMOVAL'});
 assert.equal(failed(),true);assert.equal((await fs.lstat(options.directory)).mode&0o777,0o700);
 assert.ok((await fs.readdir(options.directory)).length>0);
});

test('package failure never deletes a caller replacement after ownership admission',async t=>{
 const {root,options}=await fixture(t),failed=failOwnedWrite(t,options.directory),remove=fs.rm;
 let replaced=false;
 t.mock.method(fs,'rm',async(path,...args)=>{
  if(path===options.directory&&!replaced){
   // This real replacement happens after earlier lstat ownership checks and
   // before asynchronous recursive removal reaches the owned fixture.
   replaced=true;await fs.rename(path,join(root,'original-output'));await fs.mkdir(path,{mode:0o700});
   await fs.writeFile(join(path,'caller.txt'),'CALLER_PACKAGE_REPLACEMENT',{mode:0o600});
  }
  return remove(path,...args);
 });
 syncBuiltinESMExports();
 await assert.rejects(installProductPackage(options),{code:'EIO'});assert.equal(failed(),true);
 if(replaced)assert.equal(await fs.readFile(join(options.directory,'caller.txt'),'utf8'),'CALLER_PACKAGE_REPLACEMENT');
 else assert.equal((await fs.lstat(options.directory)).isDirectory(),true);
});

test('package install refuses an existing caller directory without removing its bytes',async t=>{
 const {options}=await fixture(t);await fs.mkdir(options.directory,{mode:0o700});await fs.writeFile(join(options.directory,'caller.txt'),'CALLER_EXISTING');
 await assert.rejects(installProductPackage(options),{code:'EEXIST'});
 assert.equal(await fs.readFile(join(options.directory,'caller.txt'),'utf8'),'CALLER_EXISTING');
});

test('retention policy preserves successful source identity, regular bytes and modes',async t=>{
 const {options}=await fixture(t),receipt=await installProductPackage(options);
 assert.equal(receipt.fileCount,4);assert.equal(receipt.packagePlacement,'snapshot');assert.equal(receipt.recordedSourceRoot,options.productRoot);
 assert.equal(receipt.sourceHead,'a'.repeat(40));assert.equal(receipt.sourceTree,'b'.repeat(40));
 assert.deepEqual(await fs.readFile(join(options.directory,'src/main.mjs')),await fs.readFile(join(options.productRoot,'src/main.mjs')));
 assert.equal((await fs.lstat(join(options.directory,'src/main.mjs'))).mode&0o777,0o644);
});
