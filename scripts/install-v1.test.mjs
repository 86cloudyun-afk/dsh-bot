import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import mutableFs from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';

const module=await import('./install-v1.mjs').catch(cause=>{if(cause.code==='ERR_MODULE_NOT_FOUND')return {};throw cause;});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=async(path,bytes,mode=0o644)=>{await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,bytes,{mode});await fs.chmod(path,mode);};
const json=(path,value)=>write(path,JSON.stringify(value,null,2)+'\n');
const toolPaths={installer:'scripts/install-v1.mjs',consumer:'scripts/assemble-distribution-runtime.mjs',guiInstaller:'scripts/install-bot-gui-profile.mjs',packageSnapshot:'scripts/package-snapshot.mjs',runtimeExporter:'tools/runtime-export/export.mjs'};
async function fixture(t){
 const parent=process.env.DSH_BOT_TEST_ROOT||'/workspace/dsh-v1-evidence/distribution-consumer';await fs.mkdir(parent,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(join(parent,'thin-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bundleDirectory=join(root,'bundle');await fs.mkdir(bundleDirectory);
 const target={id:process.platform+'-'+process.arch,platform:process.platform,arch:process.arch,overlayDirectory:'host/current/overlay',sourceIdentity:'host/current/identity.json',sourceLock:'host/current/lock.json',sourcePacket:'source/host-source.tgz',buildRecipe:'source/build-host.mjs'};
 const descriptor={format:1,classification:'DSH_BOT_V1_THIN_INSTALL_BUNDLE',publicReleaseQualified:false,
  officialSdk:{lock:'sdk/package-lock.json',cliVersion:'0.2.0-rc.2'},product:{manifest:'product/manifest.json',archive:'product/dsh-bot.tgz',buildId:'fixture-reviewed-build'},registry:{directory:'registry',receipts:'registry-receipts.json'},
  licenses:{public:'licenses/public-MIT.txt',native:'licenses/native-BSD.txt',muslCopyright:'licenses/musl-COPYRIGHT.txt',muslSourceNotices:'licenses/musl-source-notices.txt'},tools:{...toolPaths},targets:[target],files:[]};
 const paths=[...Object.values(toolPaths),descriptor.officialSdk.lock,descriptor.product.manifest,descriptor.product.archive,descriptor.registry.receipts,...Object.values(descriptor.licenses),target.sourceIdentity,target.sourceLock,target.sourcePacket,target.buildRecipe,target.overlayDirectory+'/artifact-manifest.json','registry/fixture.tgz'];
 for(const path of paths){const bytes=path===toolPaths.installer?await fs.readFile(join(import.meta.dirname,'install-v1.mjs')).catch(()=>Buffer.from('missing installer')):Buffer.from('owned thin fixture '+path+'\n');await write(join(bundleDirectory,path),bytes);descriptor.files.push({path,bytes:bytes.length,sha256:sha(bytes),mode:0o644,target:'common'});}
 const descriptorPath=join(bundleDirectory,'thin-bundle.json');await json(descriptorPath,descriptor);
 const npmCliPath=join(root,'npm-cli.mjs');await write(npmCliPath,'process.exitCode=91;\n');
 const options={bundleDirectory,descriptorPath,expectedDescriptorSha256:sha(await fs.readFile(descriptorPath)),outputDirectory:join(root,'installation'),npmCliPath,npmTimeoutMs:1000};
 const refresh=async()=>{await json(descriptorPath,descriptor);options.expectedDescriptorSha256=sha(await fs.readFile(descriptorPath));};
 return{root,options,descriptor,target,refresh};
}
function observeReads(t,afterRead){
 const paths=[],readFile=mutableFs.readFile,open=mutableFs.open;
 const observed=async(path,bytes)=>{paths.push(String(path));await afterRead?.(String(path),bytes);return bytes;};
 t.mock.method(mutableFs,'readFile',async(path,...args)=>observed(path,await readFile(path,...args)));
 t.mock.method(mutableFs,'open',async(path,...args)=>{const handle=await open(path,...args),read=handle.readFile.bind(handle);handle.readFile=async(...values)=>observed(path,await read(...values));return handle;});
 syncBuiltinESMExports();const restore=()=>{t.mock.restoreAll();syncBuiltinESMExports();};t.after(restore);return{paths,restore};
}
test('thin descriptor requires an explicit caller pin before creating output',async t=>{
 const{options}=await fixture(t);
 await assert.rejects(async()=>module.installV1({...options,expectedDescriptorSha256:undefined}),{code:'TRUSTED_DESCRIPTOR_PIN_REQUIRED'});
 await assert.rejects(async()=>module.installV1({...options,expectedDescriptorSha256:'0'.repeat(64)}),{code:'THIN_DESCRIPTOR_HASH_MISMATCH'});
 await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('thin descriptor accepts only its actual supported platform target',async t=>{
 const{options,descriptor,target,refresh}=await fixture(t);target.platform=process.platform==='linux'?'darwin':'linux';target.arch=target.platform==='linux'?'x64':'arm64';target.id=target.platform+'-'+target.arch;await refresh();
 const reads=observeReads(t);await assert.rejects(async()=>module.installV1(options),{code:'THIN_TARGET_UNAVAILABLE'});reads.restore();
 assert.deepEqual(reads.paths,[options.descriptorPath]);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
for(const path of ['../outside.txt','.env','.aws/credentials','Home/config.yml','sdk/node_modules/key.txt'])test('unsafe thin declaration is refused before reading '+path,async t=>{
 const{options,descriptor,refresh}=await fixture(t);descriptor.files.push({path,bytes:7,sha256:sha('PRIVXYZ'),mode:0o644,target:'common'});await refresh();
 const reads=observeReads(t);await assert.rejects(async()=>module.installV1(options),{code:'THIN_FILE_PATH_INVALID'});reads.restore();
 assert.deepEqual(reads.paths,[options.descriptorPath]);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
for(const kind of ['descriptor','selected'])test('linked '+kind+' input is refused without reading its target',async t=>{
 const{root,options,target}=await fixture(t),outside=join(root,'owned-outside-json');await write(outside,'PRIVXYZ');
 const selected=kind==='descriptor'?options.descriptorPath:join(options.bundleDirectory,target.sourcePacket);await fs.unlink(selected);await fs.symlink(outside,selected);
 const reads=observeReads(t);await assert.rejects(async()=>module.installV1(options),{code:'CANONICAL_INPUT_REQUIRED'});reads.restore();
 assert.equal(reads.paths.includes(selected),false);assert.equal(reads.paths.includes(outside),false);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
for(const kind of ['bytes','mode'])test('selected file '+kind+' is bound before output creation',async t=>{
 const{options,target}=await fixture(t),selected=join(options.bundleDirectory,target.sourcePacket);
 if(kind==='bytes')await fs.appendFile(selected,'drift');else await fs.chmod(selected,0o600);
 await assert.rejects(async()=>module.installV1(options),{code:'THIN_FILE_HASH_MODE_MISMATCH'});await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('input mutation during its actual descriptor read is refused',async t=>{
 const{options}=await fixture(t);let changed=false;
 const reads=observeReads(t,async(path)=>{if(path!==options.descriptorPath||changed)return;changed=true;await fs.appendFile(path,' ');});
 await assert.rejects(async()=>module.installV1(options),{code:'THIN_INPUT_CHANGED'});reads.restore();assert.equal(changed,true);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('input mutation between initial verification and the actual copy is refused',async t=>{
 const{options,target}=await fixture(t),selected=join(options.bundleDirectory,target.sourcePacket);let count=0,changed=false;
 const reads=observeReads(t,async path=>{if(path!==selected||++count!==2)return;changed=true;await fs.appendFile(path,'changed during copy');});
 await assert.rejects(async()=>module.installV1(options),{code:'THIN_INPUT_CHANGED'});reads.restore();assert.equal(changed,true);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('existing caller output remains untouched',async t=>{
 const{options}=await fixture(t);await fs.mkdir(options.outputDirectory);await write(join(options.outputDirectory,'caller.txt'),'CALLER_REMAINS');
 await assert.rejects(async()=>module.installV1(options),{code:'OUTPUT_ALREADY_EXISTS'});assert.equal(await fs.readFile(join(options.outputDirectory,'caller.txt'),'utf8'),'CALLER_REMAINS');
});
test('fixed helper layout and required selected references must be inventoried',async t=>{
 const{options,descriptor,refresh}=await fixture(t);descriptor.tools.consumer='scripts/not-reviewed.mjs';await refresh();
 await assert.rejects(async()=>module.installV1(options),{code:'THIN_TOOL_LAYOUT_INVALID'});
 descriptor.tools={...toolPaths};descriptor.files=descriptor.files.filter(file=>file.path!==descriptor.licenses.muslCopyright);await refresh();
 await assert.rejects(async()=>module.installV1(options),{code:'THIN_REQUIRED_FILE_MISSING'});
});
test('CLI flags are explicit, unique and bounded',()=>{
 const values=['--bundle','/bundle','--descriptor','/bundle/manifest.json','--descriptor-sha256','a'.repeat(64),'--output','/new','--npm-cli','/npm.mjs'];
 const result=module.parseV1InstallArguments(values);assert.equal(result.npmTimeoutMs,120000);assert.equal(result.outputDirectory,'/new');
 for(const tail of [['--enable-model-requests'],['--bundle','/other'],['--npm-timeout-ms','0'],['--npm-timeout-ms','300001']])assert.throws(()=>module.parseV1InstallArguments([...values,...tail]),{code:'INVALID_EXPLICIT_FLAGS'});
});
