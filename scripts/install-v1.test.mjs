import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import mutableFs from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import mutableChild from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {planRuntime,exportRuntime} from '../tools/runtime-export/export.mjs';

const module=await import('./install-v1.mjs').catch(cause=>{if(cause.code==='ERR_MODULE_NOT_FOUND')return {};throw cause;});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sri=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
const write=async(path,bytes,mode=0o644)=>{await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,bytes,{mode});await fs.chmod(path,mode);};
const json=(path,value)=>write(path,JSON.stringify(value,null,2)+'\n');
async function preservedFailure(promise,options,code){
 const cause=await promise.then(()=>assert.fail('installation must fail'),cause=>cause);if(code)assert.equal(cause.code,code);
 const record=cause.failurePreservation;assert.equal(record.state,'PRESERVED_AFTER_FAILURE');assert.equal(record.automaticRecursiveDeletion,false);assert.equal(record.outputWritesAtomic,false);assert.equal(record.concurrentOutputMutationSupported,false);assert.equal(record.identityKnown,true);const stat=await fs.stat(options.outputDirectory);assert.equal(stat.ino,record.outputIdentity.ino);assert.equal(stat.dev,record.outputIdentity.dev);assert.equal(stat.mode&0o777,0o700);return cause;
}
const toolPaths={installer:'scripts/install-v1.mjs',consumer:'scripts/assemble-distribution-runtime.mjs',guiInstaller:'scripts/install-bot-gui-profile.mjs',packageSnapshot:'scripts/package-snapshot.mjs',runtimeExporter:'tools/runtime-export/export.mjs'};
async function fixture(t){
 const parent=process.env.DSH_BOT_TEST_ROOT||'/workspace/dsh-v1-evidence/distribution-consumer';await fs.mkdir(parent,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(join(parent,'thin-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bundleDirectory=join(root,'bundle');await fs.mkdir(bundleDirectory);
 const target={id:process.platform+'-'+process.arch,platform:process.platform,arch:process.arch,overlayDirectory:'host/current/overlay',sourceIdentity:'host/current/identity.json',sourceLock:'host/current/lock.json',sourcePacket:'source/host-source.tgz',buildRecipe:'source/build-host.mjs'};
 const descriptor={format:1,classification:'DSH_BOT_V1_THIN_INSTALL_BUNDLE',publicReleaseQualified:false,runtime:{nodeVersion:'24.19.0'},
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
function observeReads(t,afterRead,afterRealpath){
 const paths=[],readFile=mutableFs.readFile,open=mutableFs.open,realpath=mutableFs.realpath;
 const observed=async(path,bytes)=>{paths.push(String(path));await afterRead?.(String(path),bytes);return bytes;};
 t.mock.method(mutableFs,'readFile',async(path,...args)=>observed(path,await readFile(path,...args)));
 t.mock.method(mutableFs,'open',async(path,...args)=>{const handle=await open(path,...args),read=handle.readFile.bind(handle);handle.readFile=async(...values)=>observed(path,await read(...values));return handle;});
 if(afterRealpath)t.mock.method(mutableFs,'realpath',async(path,...args)=>{const value=await realpath(path,...args);await afterRealpath(String(path));return value;});
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
test('unqualified actual Node is refused before artifact bytes or output are touched',async t=>{
 const{options}=await fixture(t),original=Object.getOwnPropertyDescriptor(process.versions,'node'),reads=observeReads(t);
 Object.defineProperty(process.versions,'node',{...original,value:'24.20.0'});t.after(()=>Object.defineProperty(process.versions,'node',original));
 await assert.rejects(async()=>module.installV1(options),{code:'NODE_VERSION_UNQUALIFIED'});Object.defineProperty(process.versions,'node',original);reads.restore();
 assert.deepEqual(reads.paths,[]);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('descriptor must bind the exact qualified Node version',async t=>{
 const{options,descriptor,refresh}=await fixture(t);descriptor.runtime.nodeVersion='24.20.0';await refresh();
 const reads=observeReads(t);await assert.rejects(async()=>module.installV1(options),{code:'NODE_VERSION_UNQUALIFIED'});reads.restore();assert.deepEqual(reads.paths,[options.descriptorPath]);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
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
 await preservedFailure(module.installV1(options),options,'THIN_INPUT_CHANGED');reads.restore();assert.equal(changed,true);
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

const octal=(value,length)=>value.toString(8).padStart(length-1,'0')+'\0';
function archive(entries){
 const blocks=[];
 for(const[path,value,mode=0o644]of entries){const bytes=Buffer.from(value),header=Buffer.alloc(512);header.write('package/'+path);header.write(octal(mode,8),100);header.write(octal(0,8),108);header.write(octal(0,8),116);header.write(octal(bytes.length,12),124);header.write(octal(0,12),136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write(octal(header.reduce((sum,n)=>sum+n,0),7)+' ',148);blocks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}
 return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
async function fullFixture(t,{failure=false,hang=false,replaceOutput=false,changeOutputMode=false,unsafeProduct=false}={}){
 const base=await fixture(t),{root,options,descriptor,target,refresh}=base,bundle=options.bundleDirectory;
 const set=async(path,bytes,mode=0o644,label='common')=>{await write(join(bundle,path),bytes,mode);const record={path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),mode,target:label},at=descriptor.files.findIndex(file=>file.path===path);at<0?descriptor.files.push(record):descriptor.files[at]=record;};
 const consumer=await fs.readFile('/workspace/dsh-bot-distribution-v1/scripts/assemble-distribution-runtime.mjs');assert.equal(sha(consumer),'095cbc714535c063b5902d6f4d013948425925dba1a9912918622818606e31a0');
 await set(toolPaths.consumer,consumer);
 for(const key of ['guiInstaller','packageSnapshot','runtimeExporter'])await set(toolPaths[key],await fs.readFile(resolve(import.meta.dirname,'..',toolPaths[key])));
 descriptor.files=descriptor.files.filter(file=>file.path!=='registry/fixture.tgz');await fs.unlink(join(bundle,'registry/fixture.tgz'));
 const externals=[],lock={importers:{},packages:{},snapshots:{}},sourceFiles=[],source=join(root,'host-source');
 for(let i=0;i<28;i++){
  const name=i<2?'color-fixture':'fixture-external-'+i,version=i===1?'2.0.0':'1.0.0',meta={name,version,main:'index.js',scripts:{install:'node -e "throw Error(\'lifecycle forbidden\')"'}},raw=archive([['package.json',JSON.stringify(meta)],['index.js',`module.exports=${JSON.stringify(version)};\n`],['LICENSE','fixture public notice\n']]),integrity=sri(raw),nameVersion=name+'@'+version,metadata=JSON.stringify({...meta,dist:{integrity}},null,2)+'\n';
  await set('registry/'+nameVersion+'.tgz',raw);await set('registry/'+nameVersion+'.metadata.json',metadata);
  externals.push({name,version,integrity,actualIntegrity:integrity,tarballPath:'registry/'+nameVersion+'.tgz',metadataPath:'registry/'+nameVersion+'.metadata.json',bytes:raw.length,tarballSha256:sha(raw),metadataSha256:sha(metadata)});lock.packages[nameVersion]={resolution:{integrity}};lock.snapshots[nameVersion]={};
 }
 const roots=[];
 for(let i=0;i<74;i++){
  const name=i===0?'@deepseek-ai/cordis':i===1?'@deepseek-ai/dsh-agent':'@deepseek-ai/fixture-peer-'+String(i).padStart(3,'0'),version=i===0?'4.0.4':'0.2.0-rc.2',sourcePath='packages/peer-'+i,dependencies={};
  if(i<28)dependencies[externals[i].name]='^'+externals[i].version;if(i===1)dependencies['@deepseek-ai/cordis']='workspace:*';
  const meta={name,version,main:'lib/index.js',files:['lib'],dependencies};roots.push(name);lock.importers[sourcePath]={dependencies:{}};
  for(const[dependency,specifier]of Object.entries(dependencies))lock.importers[sourcePath].dependencies[dependency]={specifier,version:dependency.startsWith('@')?'link:../peer-0':externals[i].version};
  await json(join(source,sourcePath,'package.json'),meta);await write(join(source,sourcePath,'lib/index.js'),i===1?"module.exports=[require('@deepseek-ai/cordis'),require('color-fixture')];\n":i===0?"module.exports=require('color-fixture');\n":'module.exports=true;\n',0o755);
  for(const file of ['package.json','lib/index.js']){const path=sourcePath+'/'+file,bytes=await fs.readFile(join(source,path));sourceFiles.push({path,bytes:bytes.length,sha256:sha(bytes)});}
 }
 const lockBytes=Buffer.from(JSON.stringify(lock,null,2)+'\n');await set(target.sourceLock,lockBytes);
 const identity={publicBaseCommit:'a'.repeat(40),sourceMaterialCommit:'b'.repeat(40),supplementCommit:'c'.repeat(40),declaredLocalHead:'d'.repeat(40),declaredLocalHeadIsBuiltIdentity:false,sourceMode:'public-base-plus-verified-overlay',localPatchRights:'UNKNOWN',dependencyLockSha256:sha(lockBytes),sourceFiles};await set(target.sourceIdentity,JSON.stringify(identity,null,2)+'\n');
 await fs.rm(join(bundle,target.overlayDirectory),{recursive:true,force:true});descriptor.files=descriptor.files.filter(file=>!file.path.startsWith(target.overlayDirectory+'/'));
 const plan=await planRuntime({sourceRoot:source,lock,roots,identity});assert.deepEqual(plan.issues,[]);assert.equal(plan.packages.length,74);assert.equal(plan.externalPackages.length,28);await exportRuntime({plan,outputDirectory:join(bundle,target.overlayDirectory)});
 const index=async at=>{for(const item of await fs.readdir(join(bundle,at),{withFileTypes:true})){const path=at+'/'+item.name;if(item.isDirectory())await index(path);else{const bytes=await fs.readFile(join(bundle,path)),stat=await fs.stat(join(bundle,path));descriptor.files.push({path,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&0o777,target:target.id});}}};await index(target.overlayDirectory);
 await set(descriptor.registry.receipts,JSON.stringify({receipts:externals,scriptsExecuted:false},null,2)+'\n');
 for(const path of Object.values(descriptor.licenses))await set(path,'complete owned public license notice '+path+'\n');
 const productMeta={name:'dsh-bot',version:'0.1.0-alpha.1',private:true,type:'module',main:'./src/plugin.mjs',files:['src','cordis.patch.yml','README.md'],exports:{'.':'./src/plugin.mjs','./bot-gui-startup':'./src/bot-gui-startup.mjs'}};
 const entries=[['README.md','owned reviewed product\n'],['cordis.patch.yml','name: dsh-bot\n'],['package.json',JSON.stringify(productMeta,null,2)+'\n'],['src/plugin.mjs','export function apply() {}\n'],['src/bot-gui-startup.mjs',await fs.readFile(resolve(import.meta.dirname,'../src/bot-gui-startup.mjs'))],['src/errors.mjs',await fs.readFile(resolve(import.meta.dirname,'../src/errors.mjs'))]].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const raw=archive([...entries,...unsafeProduct?[['../owned-escape.txt','PRIVXYZ']]:[]]),productManifest={format:1,buildId:descriptor.product.buildId,sourceRoot:'/original/reviewed-bot-source',sourceHead:'e'.repeat(40),sourceTree:'f'.repeat(40),sourceWorktreeClean:true,packageSourceClean:true,packageSHA256:sha(raw),tarball:'dsh-bot.tgz',files:entries.map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes),mode:0o644}))};
 await set(descriptor.product.archive,raw);await set(descriptor.product.manifest,JSON.stringify(productManifest,null,2)+'\n');
 const specs=[{name:'@deepseek-ai/dsh',version:'0.2.0-rc.2',bin:{dsh:'lib/bin.js'},dependencies:{'@deepseek-ai/dsh-agent':'0.2.0-rc.2','color-fixture':'^9.0.0'},files:{'lib/bin.js':'#!/usr/bin/env node\nconsole.log("owned fixture launcher");\n'}},{name:'@deepseek-ai/dsh-agent',version:'0.2.0-rc.2',main:'index.js',files:{'index.js':'module.exports="old";\n'}},{name:'@deepseek-ai/cordis',version:'4.0.4',main:'index.js',files:{'index.js':'module.exports="old";\n'}},{name:'color-fixture',version:'9.0.0',main:'index.js',files:{'index.js':'module.exports="9.0.0";\n'}}],publicLock={name:'dsh-bot',version:'0.1.0-alpha.1',lockfileVersion:3,packages:{'':{name:'dsh-bot',version:'0.1.0-alpha.1',devDependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}}};
 for(const{files,...meta}of specs)publicLock.packages['node_modules/'+meta.name]={version:meta.version,resolved:`https://registry.npmjs.org/${meta.name}/-/${meta.name.split('/').at(-1)}-${meta.version}.tgz`,integrity:sri(Buffer.from(meta.name)),dependencies:meta.dependencies,bin:meta.bin};await set(descriptor.officialSdk.lock,JSON.stringify(publicLock,null,2)+'\n');
 await write(options.npmCliPath,`const fs=require('node:fs/promises'),assert=require('node:assert/strict'),path=require('node:path');\n(async()=>{const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];assert.equal(args[0],'ci');for(const flag of ['--ignore-scripts','--no-audit','--no-fund','--strict-ssl=true'])assert.ok(args.includes(flag));assert.equal(value('--registry'),'https://registry.npmjs.org/');const cache=value('--cache'),user=value('--userconfig'),global=value('--globalconfig'),sdk=process.cwd(),installation=path.dirname(sdk);assert.ok([cache,user,global,process.env.HOME,process.env.TMPDIR].every(p=>p.startsWith(installation+'/')));assert.deepEqual(await fs.readdir(cache),[]);assert.equal((await fs.readFile(user)).length,0);assert.equal((await fs.readFile(global)).length,0);const envNames=Object.keys(process.env);assert.ok(!envNames.some(n=>/^NPM_CONFIG_/i.test(n)||['DEEPSEEK_API_KEY','OPENAI_API_KEY','NODE_OPTIONS','DSH_HOME'].includes(n)));await fs.writeFile(path.join(sdk,'npm-install-observation.json'),JSON.stringify({args,envNames,cacheInitiallyEmpty:true,emptyConfigs:true,home:process.env.HOME,caPaths:Object.fromEntries(['NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'].filter(n=>process.env[n]).map(n=>[n,process.env[n]]))}));${hang?"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);return;":''}${failure?'process.exitCode=23;return;':''}for(const {files,...meta} of ${JSON.stringify(specs)}){const directory=path.join(sdk,'node_modules',meta.name);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(meta)+'\\n');for(const [name,bytes] of Object.entries(files)){const target=path.join(directory,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{mode:0o755});await fs.chmod(target,0o755);}}${replaceOutput?`await fs.rename(installation,${JSON.stringify(join(root,'owned-installation-retained'))});await fs.mkdir(installation);await fs.writeFile(path.join(installation,'caller.txt'),'CALLER_REPLACEMENT_REMAINS');`:''}${changeOutputMode?"await fs.chmod(installation,0o755);":''}})().catch(()=>{process.exitCode=92;});\n`);
 await refresh();return{...base,productManifest};
}
test('thin files install an actual coherent private runtime and relocated GUI export without Git',async t=>{
 const{options,descriptor,productManifest}=await fullFixture(t),result=await module.installV1(options);
 assert.equal(result.modelsEnabled,false);assert.deepEqual(result.credentialReferences,['DEEPSEEK_API_KEY']);assert.equal(result.credentialsCreated,false);assert.equal(result.publicReleaseQualified,false);
 assert.equal(result.outputWritesAtomic,false);assert.equal(result.concurrentOutputMutationSupported,false);const installationManifest=JSON.parse(await fs.readFile(result.installationManifestPath));assert.equal(installationManifest.outputWritesAtomic,false);assert.equal(installationManifest.concurrentOutputMutationSupported,false);
 assert.equal(result.corePackageCount,74);assert.equal(result.externalPackageCount,28);assert.equal(result.gui.packageInstallation.packageSourceMode,'verified-export');assert.equal(result.gui.packageInstallation.recordedSourceRoot,productManifest.sourceRoot);assert.equal(result.gui.packageInstallation.sourceHead,productManifest.sourceHead);assert.equal(result.gui.packageInstallation.sourceTree,productManifest.sourceTree);
 assert.deepEqual(result.manualStartup.arguments.slice(1),['--profile','dsh-bot-gui','--port','3080','--no-open']);assert.equal(result.manualStartup.environment.DSH_HOME,result.home);assert.equal(result.manualStartup.arguments.includes('--enable-model-requests'),false);
 const observation=JSON.parse(await fs.readFile(join(result.installationDirectory,'sdk/npm-install-observation.json')));assert.equal(observation.cacheInitiallyEmpty,true);assert.equal(observation.emptyConfigs,true);assert.equal(observation.envNames.includes('NODE_OPTIONS'),false);
 const startup=await import(pathToFileURL(join(result.installationDirectory,'product/src/bot-gui-startup.mjs')));assert.equal(startup.parseBotGuiArguments([]).modelRequestsEnabled,false);assert.equal(startup.parseBotGuiArguments(['--enable-model-requests']).modelRequestsEnabled,true);
 const consumer=await import(pathToFileURL(join(result.installationDirectory,'materials/scripts/assemble-distribution-runtime.mjs')));assert.equal((await consumer.verifyDistributionRuntime({directory:result.runtimeDirectory,expectedManifestSha256:result.runtimeManifestSha256})).verified,true);
 assert.equal(result.helperExecution.mode,'CAPTURED_DESCRIPTOR_PINNED_SOURCES');assert.deepEqual(result.helperExecution.loadedTools,Object.values(toolPaths).filter(path=>path!==toolPaths.installer));assert.equal(result.helperExecution.mappedTools.length,5);
 for(const record of result.helperExecution.mappedTools){const pinned=descriptor.files.find(file=>file.path===record.path);assert.equal(record.sha256,pinned.sha256);assert.equal(record.bytes,pinned.bytes);assert.equal(record.mode,pinned.mode);assert.match(record.url,/^file:\/\/\/__dsh_v1_captured__\/[a-f0-9-]{36}\//);await assert.rejects(fs.lstat(new URL(record.url)),{code:'ENOENT'});}
 assert.equal(result.helperExecution.executionMapSha256,sha(JSON.stringify(result.helperExecution.mappedTools)));assert.equal(result.helperExecution.capturedSourceIndexSha256,sha(JSON.stringify(result.helperExecution.mappedTools.map(({url,...record})=>record))));
 await assert.rejects(fs.lstat(join(result.installationDirectory,'product/.git')),{code:'ENOENT'});await assert.rejects(fs.lstat(join(result.installationDirectory,'lifecycle-was-run')),{code:'ENOENT'});
});
test('unselected platform files are never read or required',async t=>{
 const{options,descriptor,refresh}=await fullFixture(t),other=process.platform==='linux'?{id:'darwin-arm64',platform:'darwin',arch:'arm64'}:{id:'linux-x64',platform:'linux',arch:'x64'};
 descriptor.targets.push({...other,overlayDirectory:'host/other/overlay',sourceIdentity:'host/other/identity.json',sourceLock:'host/other/lock.json',sourcePacket:'source/other.tgz',buildRecipe:'source/other.mjs'});descriptor.files.push({path:'host/other/missing-file',bytes:7,sha256:sha('PRIVXYZ'),mode:0o644,target:other.id});await refresh();
 const reads=observeReads(t);await module.installV1(options);reads.restore();assert.equal(reads.paths.some(path=>path.includes('/host/other/')),false);
});
test('authenticated product archive traversal is refused before npm is started',async t=>{
 const{options,root}=await fullFixture(t,{unsafeProduct:true});await preservedFailure(module.installV1(options),options,'PRODUCT_ARCHIVE_INVALID');await assert.rejects(fs.lstat(join(root,'owned-escape.txt')),{code:'ENOENT'});
});
test('failed npm child reports a bounded category and preserves the failed output',async t=>{
 const{options}=await fullFixture(t,{failure:true});await preservedFailure(module.installV1(options),options,'SDK_INSTALL_FAILED');
});
test('npm timeout terminates its owned child even when SIGTERM is ignored',async t=>{
 const{options}=await fullFixture(t,{hang:true}),start=Date.now();await preservedFailure(module.installV1(options),options,'SDK_INSTALL_TIMEOUT');assert.ok(Date.now()-start<6000);
});
test('npm-stage output replacement is preserved without automatic deletion',async t=>{
 const{options}=await fullFixture(t,{replaceOutput:true});const cause=await module.installV1(options).then(()=>assert.fail('replacement must fail'),cause=>cause);assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);assert.equal(await fs.readFile(join(options.outputDirectory,'caller.txt'),'utf8'),'CALLER_REPLACEMENT_REMAINS');
});
test('CLI isolates synthetic credential/config environment without printing it',async t=>{
 const{options,root}=await fullFixture(t),sentinel='OWNED_SYNTHETIC_PRIVATE_VALUE';await write(join(root,'owned-user.npmrc'),'not to be read');
 const flags={'--bundle':'bundleDirectory','--descriptor':'descriptorPath','--descriptor-sha256':'expectedDescriptorSha256','--output':'outputDirectory','--npm-cli':'npmCliPath','--npm-timeout-ms':'npmTimeoutMs'},args=[join(import.meta.dirname,'install-v1.mjs'),...Object.entries(flags).flatMap(([flag,key])=>[flag,String(options[key])])];
 const result=spawnSync(process.execPath,args,{env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C',DEEPSEEK_API_KEY:sentinel,OPENAI_API_KEY:sentinel,NODE_OPTIONS:'--trace-warnings',NPM_CONFIG_USERCONFIG:join(root,'owned-user.npmrc'),DSH_HOME:join(root,'old-home')},encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.includes(sentinel),false);assert.equal(result.stderr.includes(sentinel),false);const receipt=JSON.parse(result.stdout);assert.equal(receipt.modelsEnabled,false);assert.equal(receipt.credentialsCreated,false);
});
test('unsupported actual platform is refused before artifact bytes or output are touched',async t=>{
 const{options}=await fixture(t),original=Object.getOwnPropertyDescriptor(process,'platform'),reads=observeReads(t);
 Object.defineProperty(process,'platform',{...original,value:'win32'});t.after(()=>Object.defineProperty(process,'platform',original));
 await assert.rejects(module.installV1(options),{code:'THIN_TARGET_UNAVAILABLE'});Object.defineProperty(process,'platform',original);reads.restore();assert.deepEqual(reads.paths,[]);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
for(const kind of ['unsafe-path','registry-port'])test('official lock '+kind+' is refused before npm runs',async t=>{
 const{options,descriptor,refresh}=await fullFixture(t),path=descriptor.officialSdk.lock,lock=JSON.parse(await fs.readFile(join(options.bundleDirectory,path))),binding={version:'1.0.0',resolved:'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',integrity:sri('fixture')};
 if(kind==='unsafe-path')lock.packages['node_modules/../node_modules/fixture']=binding;else lock.packages['node_modules/fixture']={...binding,resolved:'https://registry.npmjs.org:8443/fixture/-/fixture-1.0.0.tgz'};
 const bytes=Buffer.from(JSON.stringify(lock,null,2)+'\n');await write(join(options.bundleDirectory,path),bytes);Object.assign(descriptor.files.find(file=>file.path===path),{bytes:bytes.length,sha256:sha(bytes)});await refresh();
 let spawns=0;const original=mutableChild.spawn;t.mock.method(mutableChild,'spawn',(...args)=>{spawns++;return original(...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await preservedFailure(module.installV1(options),options,'OFFICIAL_SDK_LOCK_INVALID');assert.equal(spawns,0);
});
test('changed installation directory mode is refused and preserved without automatic deletion',async t=>{
 const{options}=await fullFixture(t,{changeOutputMode:true}),cause=await module.installV1(options).then(()=>assert.fail('output mode drift must fail'),cause=>cause);
 assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);assert.equal((await fs.stat(options.outputDirectory)).mode&0o777,0o755);
});
test('legitimate public CA inputs are safely copied for the npm child',async t=>{
 const{options,root}=await fullFixture(t),certificate=join(root,'owned-public-ca.pem');await write(certificate,'owned synthetic certificate\n');
 const previous=process.env.NODE_EXTRA_CA_CERTS;process.env.NODE_EXTRA_CA_CERTS=certificate;t.after(()=>{if(previous===undefined)delete process.env.NODE_EXTRA_CA_CERTS;else process.env.NODE_EXTRA_CA_CERTS=previous;});
 const result=await module.installV1(options),observation=JSON.parse(await fs.readFile(join(result.installationDirectory,'sdk/npm-install-observation.json')));
 assert.ok(observation.caPaths.NODE_EXTRA_CA_CERTS.startsWith(result.installationDirectory+'/'));assert.notEqual(observation.caPaths.NODE_EXTRA_CA_CERTS,certificate);assert.equal(await fs.readFile(observation.caPaths.NODE_EXTRA_CA_CERTS,'utf8'),'owned synthetic certificate\n');
});
test('replaced public CA input is refused before delegated Node reads or npm spawn',async t=>{
 const{options,root}=await fullFixture(t),certificate=join(root,'owned-public-ca.pem'),outside=join(root,'owned-linked-ca-target');await write(certificate,'owned synthetic certificate\n');await write(outside,'PRIVXYZ');
 const previous=process.env.NODE_EXTRA_CA_CERTS;process.env.NODE_EXTRA_CA_CERTS=certificate;t.after(()=>{if(previous===undefined)delete process.env.NODE_EXTRA_CA_CERTS;else process.env.NODE_EXTRA_CA_CERTS=previous;});
 let replaced=false,spawns=0;const reads=observeReads(t,null,async path=>{if(path!==certificate||replaced)return;replaced=true;await fs.unlink(certificate);await fs.symlink(outside,certificate);});
 const original=mutableChild.spawn;t.mock.method(mutableChild,'spawn',(...args)=>{spawns++;return original(...args);});syncBuiltinESMExports();
 await preservedFailure(module.installV1(options),options);reads.restore();assert.equal(replaced,true);assert.equal(spawns,0);assert.equal(reads.paths.includes(outside),false);assert.equal(reads.paths.includes(certificate),false);
});
test('late npm entry mode drift cannot retain its first verified input identity',async t=>{
 const{options}=await fullFixture(t);let changed=false;
 const reads=observeReads(t,async path=>{if(changed||!path.endsWith('/sdk/node_modules/@deepseek-ai/dsh/package.json'))return;changed=true;await fs.chmod(options.npmCliPath,0o600);});
 await preservedFailure(module.installV1(options),options,'THIN_FILE_HASH_MODE_MISMATCH');reads.restore();assert.equal(changed,true);
});
test('late descriptor mode drift cannot retain its first verified input identity',async t=>{
 const{options}=await fullFixture(t);let changed=false;
 const reads=observeReads(t,async path=>{if(changed||!path.endsWith('/sdk/node_modules/@deepseek-ai/dsh/package.json'))return;changed=true;await fs.chmod(options.descriptorPath,0o600);});
 await preservedFailure(module.installV1(options),options,'THIN_FILE_HASH_MODE_MISMATCH');reads.restore();assert.equal(changed,true);
});
test('CLI sanitizes unknown delegated errors even when their code imitates an installer category',async t=>{
 const{options,descriptor,refresh}=await fullFixture(t),path=descriptor.tools.consumer,bytes=Buffer.from("export async function assembleDistributionRuntime(){const cause=new Error('PRIVXYZ');cause.code='THIN_FILE_HASH_MODE_MISMATCH';throw cause;}\n");
 await write(join(options.bundleDirectory,path),bytes);Object.assign(descriptor.files.find(file=>file.path===path),{bytes:bytes.length,sha256:sha(bytes)});await refresh();
 const flags={'--bundle':'bundleDirectory','--descriptor':'descriptorPath','--descriptor-sha256':'expectedDescriptorSha256','--output':'outputDirectory','--npm-cli':'npmCliPath','--npm-timeout-ms':'npmTimeoutMs'},args=[join(import.meta.dirname,'install-v1.mjs'),...Object.entries(flags).flatMap(([flag,key])=>[flag,String(options[key])])];
 const result=spawnSync(process.execPath,args,{env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:15000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');const report=JSON.parse(result.stderr);assert.equal(report.errorCategory,'THIN_INSTALL_FAILED');assert.equal(report.failurePreservation.state,'PRESERVED_AFTER_FAILURE');assert.equal(report.failurePreservation.automaticRecursiveDeletion,false);assert.equal(result.stderr.includes('PRIVXYZ'),false);assert.equal((await fs.stat(options.outputDirectory)).ino,report.failurePreservation.outputIdentity.ino);
});

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OWNED_TEST_BOUND_EXCEEDED')),ms);})]);}finally{clearTimeout(timer);}}
async function guardedNpmHarness(t,f,{live=false}={}){
 if(live)await write(f.options.npmCliPath,"const fs=require('node:fs');const path=require('node:path');process.on('SIGTERM',()=>{});fs.writeFileSync(path.join(process.cwd(),'owned-npm-running.json'),JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);\n");
 const guard=join(f.root,'owned-stop-child-guard.mjs'),observation=join(f.options.outputDirectory,'sdk/owned-stop-guard.json');
 await write(guard,`import fs from 'node:fs';import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';import child from 'node:child_process';import dgram from 'node:dgram';import http2 from 'node:http2';import {syncBuiltinESMExports} from 'node:module';
 const counters={network:0,model:0,native:0,extraChild:0};const save=()=>fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({guardLoaded:true,pid:process.pid,counters}));const deny=kind=>()=>{counters[kind]++;save();throw Error('OWNED_CHILD_SIDE_EFFECT_DENIED');};globalThis.fetch=deny('model');process.dlopen=deny('native');
 for(const[mod,names]of [[net,['connect','createConnection','createServer']],[http,['request','get','createServer']],[https,['request','get','createServer']],[tls,['connect','createServer']],[dgram,['createSocket']],[http2,['connect','createServer','createSecureServer']]])for(const name of names)mod[name]=deny('network');net.Socket.prototype.connect=deny('network');net.Server.prototype.listen=deny('network');dgram.Socket.prototype.send=deny('network');dgram.Socket.prototype.connect=deny('network');for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny('extraChild');syncBuiltinESMExports();save();\n`);
 const spawn=mutableChild.spawn,realKill=process.kill.bind(process);let captured,exited,resolveSpawn;const spawned=new Promise(resolve=>resolveSpawn=resolve);
 t.mock.method(mutableChild,'spawn',(executable,args,options)=>{
  assert.equal(captured,undefined);assert.equal(executable,process.execPath);assert.equal(args[0],join(f.options.outputDirectory,'npm-entry.mjs'));assert.equal(options.cwd,join(f.options.outputDirectory,'sdk'));assert.equal(options.detached,true);assert.equal(options.stdio,'ignore');
  const child=spawn(executable,['--permission','--allow-fs-read='+f.root,'--allow-fs-write='+f.options.outputDirectory,'--import',guard,...args],options),pid=child.pid;
  captured={child,pid,spawnedAt:Date.now()};exited=once(child,'exit');resolveSpawn(captured);return child;
 });syncBuiltinESMExports();
 const stop=async()=>{
  if(!captured)return;try{realKill(-captured.pid,'SIGKILL');}catch(cause){if(cause.code!=='ESRCH')throw cause;}await bounded(exited,3000);
  let groupGone=false;try{realKill(-captured.pid,0);}catch(cause){if(cause.code==='ESRCH')groupGone=true;else throw cause;}assert.equal(groupGone,true,'owned group must be gone before fixture teardown');
  process.stdout.write(JSON.stringify({ownedNpmTeardown:{pid:captured.pid,groupGone,network:0,model:0,native:0,extraChild:0}})+'\n');
 };
 const ready=async()=>{await bounded(spawned,5000);for(let i=0;i<100;i++){try{const record=JSON.parse(await fs.readFile(observation));assert.equal(record.pid,captured.pid);assert.deepEqual(record.counters,{network:0,model:0,native:0,extraChild:0});if(live)assert.equal(JSON.parse(await fs.readFile(join(f.options.outputDirectory,'sdk/owned-npm-running.json'))).pid,captured.pid);return captured;}catch(cause){if(cause.code!=='ENOENT')throw cause;await delay(10);}}throw Error('OWNED_GUARD_NOT_READY');};
 return{ready,stop,realKill,get captured(){return captured;}};
}
test('denied npm termination returns bounded STOP_UNKNOWN and preserves the live-child output',async t=>{
 const f=await fullFixture(t,{hang:true}),h=await guardedNpmHarness(t,f,{live:true}),signals=[],originalKill=process.kill;let pending;
 process.kill=(pid,signal)=>{if(h.captured&&pid===-h.captured.pid&&signal!==0){signals.push(signal);throw Object.assign(Error('owned synthetic denial'),{code:'EPERM'});}return h.realKill(pid,signal);};
 try{
  pending=module.installV1(f.options).then(()=>assert.fail('live child cannot pass'),cause=>cause);const child=await h.ready();t.mock.method(child.child,'kill',()=>{throw Object.assign(Error('owned synthetic child denial'),{code:'EPERM'});});const cause=await bounded(pending,2300);
  assert.equal(cause.code,'SDK_INSTALL_STOP_UNKNOWN');assert.equal(cause.cleanupErrorCategory,'SDK_CHILD_STOP_UNKNOWN');assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.ok(Date.now()-child.spawnedAt<2300);
  assert.equal(cause.stopConfirmation.pid,child.pid);assert.equal(cause.stopConfirmation.processGroupId,child.pid);assert.equal(cause.stopConfirmation.state,'UNKNOWN');assert.equal((await fs.stat(f.options.outputDirectory)).mode&0o777,0o700);h.realKill(child.pid,0);
 }finally{process.kill=originalKill;await h.stop();await pending;}
});
test('leader exit with a still-present group is STOP_UNKNOWN and cannot trigger output cleanup',async t=>{
 const f=await fullFixture(t,{failure:true}),h=await guardedNpmHarness(t,f),originalKill=process.kill,signals=[];let pending;
 process.kill=(pid,signal)=>{if(h.captured&&pid===-h.captured.pid){signals.push(signal);if(signal===0)return true;throw Error('leader exited: destructive signal forbidden');}return h.realKill(pid,signal);};
 try{
  pending=module.installV1(f.options).then(()=>assert.fail('group presence cannot pass'),cause=>cause);const child=await h.ready(),cause=await bounded(pending,2300);
  assert.equal(cause.code,'SDK_INSTALL_STOP_UNKNOWN');assert.equal(cause.cleanupErrorCategory,'SDK_CHILD_STOP_UNKNOWN');assert.equal(cause.stopConfirmation.pid,child.pid);assert.ok(signals.length>0);assert.equal(signals.every(signal=>signal===0),true);assert.equal((await fs.stat(f.options.outputDirectory)).mode&0o777,0o700);
 }finally{process.kill=originalKill;await h.stop();await pending;}
});
for(const kind of ['changed','unavailable'])test(kind+' npm PID metadata never redirects a signal to a foreign process',async t=>{
 const f=await fullFixture(t,{hang:true}),h=await guardedNpmHarness(t,f,{live:true}),originalKill=process.kill,signals=[];let pending;
 process.kill=(pid,signal)=>{signals.push({pid,signal});if(pid===process.pid||pid===-process.pid)throw Error('FOREIGN_PROCESS_SIGNAL_FORBIDDEN');return h.realKill(pid,signal);};
 try{
  pending=module.installV1(f.options).then(()=>assert.fail('changed process identity cannot pass'),cause=>cause);const child=await h.ready();if(kind==='changed')child.child.pid=process.pid;else Object.defineProperty(child.child,'pid',{configurable:true,get(){throw Error('PRIVXYZ');}});const cause=await bounded(pending,2300);
  assert.equal(cause.code,'SDK_INSTALL_STOP_UNKNOWN');assert.equal(cause.stopConfirmation.pid,child.pid);assert.equal(signals.some(item=>item.pid===process.pid||item.pid===-process.pid),false);assert.equal(signals.some(item=>item.signal!==0),false);assert.equal((await fs.stat(f.options.outputDirectory)).mode&0o777,0o700);
 }finally{process.kill=originalKill;await h.stop();await pending;}
});
test('a replaced output is preserved while its original live npm group is stopped',async t=>{
 const f=await fullFixture(t,{hang:true}),h=await guardedNpmHarness(t,f,{live:true}),originalKill=process.kill,signals=[];let pending;
 process.kill=(pid,signal)=>{signals.push({pid,signal});return h.realKill(pid,signal);};
 try{
  pending=module.installV1(f.options).then(()=>assert.fail('changed output cannot pass'),cause=>cause);await h.ready();await fs.rename(f.options.outputDirectory,f.options.outputDirectory+'.owned-retained');await fs.mkdir(f.options.outputDirectory,{mode:0o700});await write(join(f.options.outputDirectory,'caller.txt'),'CALLER_FOREIGN_OUTPUT_REMAINS');
  const cause=await bounded(pending,2300);assert.equal(cause.code,'SDK_INSTALL_TIMEOUT');assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);assert.deepEqual(signals.filter(item=>item.signal!==0).map(item=>item.signal),['SIGTERM','SIGKILL']);assert.equal(signals.every(item=>item.pid===-h.captured.pid),true);assert.equal(await fs.readFile(join(f.options.outputDirectory,'caller.txt'),'utf8'),'CALLER_FOREIGN_OUTPUT_REMAINS');assert.equal((await fs.stat(f.options.outputDirectory+'.owned-retained')).mode&0o777,0o700);assert.equal(cause.failurePreservation.outputIdentity.ino,(await fs.stat(f.options.outputDirectory+'.owned-retained')).ino);
 }finally{process.kill=originalKill;await h.stop();await pending;}
});
test('actual CLI exits bounded on STOP_UNKNOWN while retaining its guarded live npm child and output',{skip:process.platform!=='linux'?'owned Linux process-start identity teardown is qualified on Linux only':false},async t=>{
 const f=await fullFixture(t),guard=join(f.root,'owned-cli-launcher-guard.mjs'),childGuard=join(f.root,'owned-cli-child-guard.mjs'),identityPath=join(f.root,'owned-cli-child-identity.json'),observation=join(f.options.outputDirectory,'sdk/owned-cli-child-guard.json');
 await write(f.options.npmCliPath,"const fs=require('node:fs');const path=require('node:path');process.on('SIGTERM',()=>{});fs.writeFileSync(path.join(process.cwd(),'owned-npm-running.json'),JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);\n");
 const sideEffectGuard=`import fs from 'node:fs';import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';import child from 'node:child_process';import dgram from 'node:dgram';import http2 from 'node:http2';import {syncBuiltinESMExports} from 'node:module';
 const counters={network:0,model:0,native:0,extraChild:0};const deny=kind=>()=>{counters[kind]++;throw Error('OWNED_CLI_SIDE_EFFECT_DENIED');};globalThis.fetch=deny('model');process.dlopen=deny('native');for(const[mod,names]of [[net,['connect','createConnection','createServer']],[http,['request','get','createServer']],[https,['request','get','createServer']],[tls,['connect','createServer']],[dgram,['createSocket']],[http2,['connect','createServer','createSecureServer']]])for(const name of names)mod[name]=deny('network');net.Socket.prototype.connect=deny('network');net.Server.prototype.listen=deny('network');dgram.Socket.prototype.send=deny('network');dgram.Socket.prototype.connect=deny('network');`;
 await write(childGuard,sideEffectGuard+`for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny('extraChild');syncBuiltinESMExports();fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({guardLoaded:true,pid:process.pid,counters}));\n`);
 await write(guard,sideEffectGuard+`const realSpawn=child.spawn,realKill=process.kill.bind(process);let captured;child.spawn=(exe,args,options)=>{if(captured||exe!==process.execPath||args[0]!==${JSON.stringify(join(f.options.outputDirectory,'npm-entry.mjs'))}||options.cwd!==${JSON.stringify(join(f.options.outputDirectory,'sdk'))}||options.detached!==true||options.stdio!=='ignore')return deny('extraChild')();const owned=realSpawn(exe,['--permission','--allow-fs-read='+${JSON.stringify(f.root)},'--allow-fs-write='+${JSON.stringify(f.options.outputDirectory)},'--import',${JSON.stringify(childGuard)},...args],options);captured=owned.pid;const stat=fs.readFileSync('/proc/'+captured+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');fs.writeFileSync(${JSON.stringify(identityPath)},JSON.stringify({pid:captured,group:Number(fields[2]),start:fields[19],counters}));owned.kill=()=>{throw Object.assign(Error('owned child stop denied'),{code:'EPERM'});};return owned;};process.kill=(pid,signal)=>{if(pid===-captured&&signal!==0)throw Object.assign(Error('owned group stop denied'),{code:'EPERM'});return realKill(pid,signal);};for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny('extraChild');syncBuiltinESMExports();\n`);
 const flags={'--bundle':'bundleDirectory','--descriptor':'descriptorPath','--descriptor-sha256':'expectedDescriptorSha256','--output':'outputDirectory','--npm-cli':'npmCliPath','--npm-timeout-ms':'npmTimeoutMs'},args=['--no-warnings','--permission','--allow-fs-read='+f.root,'--allow-fs-read=/proc','--allow-fs-write='+f.root,'--allow-child-process','--import',guard,join(f.options.bundleDirectory,'scripts/install-v1.mjs'),...Object.entries(flags).flatMap(([flag,key])=>[flag,String(f.options[key])])];
 let identity;
 const ownState=async()=>{try{const text=await fs.readFile('/proc/'+identity.pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');assert.equal(fields[19],identity.start,'only the captured process start identity may be stopped');assert.equal(Number(fields[2]),identity.group);return fields[0];}catch(cause){if(cause.code==='ENOENT')return 'GONE';throw cause;}};
 try{
  const start=Date.now(),result=spawnSync(process.execPath,args,{env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:5000});identity=JSON.parse(await fs.readFile(identityPath));
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.ok(Date.now()-start<4500);assert.equal(result.stdout,'');const report=JSON.parse(result.stderr);assert.equal(report.errorCategory,'SDK_INSTALL_STOP_UNKNOWN');assert.equal(report.cleanupErrorCategory,'SDK_CHILD_STOP_UNKNOWN');assert.equal(report.stopConfirmation.pid,identity.pid);assert.equal(report.stopConfirmation.outputIdentity.directory,f.options.outputDirectory);assert.deepEqual(identity.counters,{network:0,model:0,native:0,extraChild:0});
  assert.equal((await fs.stat(f.options.outputDirectory)).mode&0o777,0o700);assert.equal(JSON.parse(await fs.readFile(observation)).guardLoaded,true);assert.equal(JSON.parse(await fs.readFile(join(f.options.outputDirectory,'sdk/owned-npm-running.json'))).pid,identity.pid);assert.notEqual(await ownState(),'GONE');assert.notEqual(await ownState(),'Z');
 }finally{
  identity??=JSON.parse(await fs.readFile(identityPath));assert.equal(identity.pid,identity.group);const before=await ownState();if(before!=='GONE'&&before!=='Z')process.kill(-identity.pid,'SIGKILL');let stopped=false,state;
  for(let i=0;i<150;i++){state=await ownState();if(state==='GONE'||state==='Z'){stopped=true;break;}await delay(20);}assert.equal(stopped,true,'external harness must confirm the exact guarded child can no longer write');
  process.stdout.write(JSON.stringify({ownedCliNpmTeardown:{pid:identity.pid,group:identity.group,startIdentityMatched:true,state,stopped,network:0,model:0,native:0,extraChild:0}})+'\n');
 }
});
test('failure always preserves the newly claimed output without a recursive delete attempt',async t=>{
 const f=await fixture(t),selected=join(f.options.outputDirectory,'materials',f.target.sourcePacket),open=mutableFs.open,rm=mutableFs.rm;let fault=false,originalIdentity,deleteAttempts=0;
 t.mock.method(mutableFs,'open',async(path,...args)=>{if(path===selected&&!fault){fault=true;originalIdentity=await fs.stat(f.options.outputDirectory);throw Object.assign(Error('owned I2 read failure'),{code:'EIO'});}return open(path,...args);});
 t.mock.method(mutableFs,'rm',async(path,...args)=>{if(path===f.options.outputDirectory)deleteAttempts++;return rm(path,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const cause=await module.installV1(f.options).then(()=>assert.fail('owned fault must fail'),cause=>cause);assert.equal(fault,true);assert.equal(cause.code,'EIO');const after=await fs.stat(f.options.outputDirectory);
 assert.equal(after.ino,originalIdentity.ino);assert.equal(after.dev,originalIdentity.dev);assert.equal(after.mode&0o777,0o700);assert.equal(deleteAttempts,0);assert.equal(cause.failurePreservation.state,'PRESERVED_AFTER_FAILURE');assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);assert.equal(cause.failurePreservation.outputIdentity.ino,originalIdentity.ino);
});
test('replacement observed at the canonical checkpoint is refused before material writes',async t=>{
 const f=await fixture(t),output=f.options.outputDirectory,realpath=mutableFs.realpath;let mutationTriggered=false,originalIdentity,replacementIdentity;
 t.mock.method(mutableFs,'realpath',async(path,...args)=>{const value=await realpath(path,...args);if(path===output&&!mutationTriggered){mutationTriggered=true;originalIdentity=await fs.stat(output);await fs.rename(output,output+'.owned-retained');await fs.mkdir(output,{mode:0o700});await write(join(output,'caller.txt'),'CALLER_CANONICAL_RACE_REMAINS',0o600);replacementIdentity=await fs.stat(output);}return value;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const cause=await module.installV1(f.options).then(()=>assert.fail('replaced root must fail'),cause=>cause);assert.equal(mutationTriggered,true);assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(await fs.readFile(join(output,'caller.txt'),'utf8'),'CALLER_CANONICAL_RACE_REMAINS');assert.deepEqual(await fs.readdir(output),['caller.txt']);
 assert.equal((await fs.stat(output)).ino,replacementIdentity.ino);assert.equal((await fs.stat(join(output,'caller.txt'))).mode&0o777,0o600);assert.equal(cause.failurePreservation.outputIdentity.ino,originalIdentity.ino);assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);
});
test('caller bytes modes and inode survive a triggered replacement and source fault',async t=>{
 const f=await fixture(t),output=f.options.outputDirectory,selected=join(output,'materials',f.target.sourcePacket),open=mutableFs.open,rm=mutableFs.rm;let mutationTriggered=false,originalIdentity,replacementIdentity,deleteAttempts=0;
 t.mock.method(mutableFs,'open',async(path,...args)=>{if(path===selected&&!mutationTriggered){mutationTriggered=true;originalIdentity=await fs.stat(output);await fs.rename(output,output+'.owned-retained');await fs.mkdir(output,{mode:0o750});await fs.chmod(output,0o750);await write(join(output,'caller.txt'),'CALLER_FAILURE_RACE_REMAINS',0o640);replacementIdentity=await fs.stat(output);throw Object.assign(Error('owned I2 source failure'),{code:'EIO'});}return open(path,...args);});
 t.mock.method(mutableFs,'rm',async(path,...args)=>{if(path===output)deleteAttempts++;return rm(path,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const cause=await module.installV1(f.options).then(()=>assert.fail('source fault must fail'),cause=>cause);assert.equal(mutationTriggered,true);assert.equal(cause.code,'EIO');assert.equal(deleteAttempts,0);assert.equal(await fs.readFile(join(output,'caller.txt'),'utf8'),'CALLER_FAILURE_RACE_REMAINS');assert.equal((await fs.stat(join(output,'caller.txt'))).mode&0o777,0o640);const after=await fs.stat(output);assert.equal(after.ino,replacementIdentity.ino);assert.equal(after.dev,replacementIdentity.dev);assert.equal(after.mode&0o777,0o750);assert.equal(cause.failurePreservation.outputIdentity.ino,originalIdentity.ino);assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);
});
test('a late replaced output is refused before importing an unreviewed consumer',async t=>{
 const{options}=await fullFixture(t),retained=options.outputDirectory+'.owned-retained',marker=join(options.outputDirectory,'unreviewed-import-executed');let canonicalReads=0,mutationTriggered=false,originalIdentity,replacementIdentity,sentinelIdentity;
 const reads=observeReads(t,null,async path=>{
  if(path!==join(options.outputDirectory,'sdk/package-lock.json')||++canonicalReads!==3)return;
  originalIdentity=await fs.stat(options.outputDirectory);await fs.rename(options.outputDirectory,retained);await fs.mkdir(options.outputDirectory,{mode:0o700});await write(join(options.outputDirectory,'caller.txt'),'CALLER_LATE_REPLACEMENT',0o600);
  await write(join(options.outputDirectory,'materials/scripts/assemble-distribution-runtime.mjs'),`import fs from 'node:fs/promises';\nawait fs.writeFile(${JSON.stringify(marker)},'UNREVIEWED_IMPORT_EXECUTED',{flag:'wx',mode:0o600});\nexport async function assembleDistributionRuntime(){throw Error('ASSEMBLY_MUST_NOT_EXECUTE');}\n`);
  replacementIdentity=await fs.stat(options.outputDirectory);sentinelIdentity=await fs.stat(join(options.outputDirectory,'caller.txt'));mutationTriggered=true;
 });
 const cause=await module.installV1(options).then(()=>assert.fail('replacement must refuse installation'),cause=>cause);reads.restore();assert.equal(mutationTriggered,true);assert.equal(canonicalReads,3);assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');
 assert.equal(cause.failurePreservation.outputIdentity.ino,originalIdentity.ino);assert.equal(cause.failurePreservation.outputIdentity.dev,originalIdentity.dev);assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);
 const after=await fs.stat(options.outputDirectory),sentinelAfter=await fs.stat(join(options.outputDirectory,'caller.txt'));assert.equal(after.ino,replacementIdentity.ino);assert.equal(after.dev,replacementIdentity.dev);assert.equal(after.mode&0o777,0o700);assert.equal(sentinelAfter.ino,sentinelIdentity.ino);assert.equal(sentinelAfter.dev,sentinelIdentity.dev);assert.equal(sentinelAfter.mode&0o777,0o600);assert.equal(await fs.readFile(join(options.outputDirectory,'caller.txt'),'utf8'),'CALLER_LATE_REPLACEMENT');
 await assert.rejects(fs.lstat(marker),{code:'ENOENT'});assert.deepEqual((await fs.readdir(options.outputDirectory)).sort(),['caller.txt','materials']);
});
test('replacement after the ownership check never executes pathname helper bytes',async t=>{
 const{options}=await fullFixture(t),retained=options.outputDirectory+'.owned-retained',marker=join(options.outputDirectory,'unreviewed-import-executed');let canonicalReads=0,ownershipStats=0,phaseReady=false,mutationTriggered=false,originalIdentity,replacementIdentity;
 const reads=observeReads(t,null,async path=>{if(path===join(options.outputDirectory,'sdk/package-lock.json')&&++canonicalReads===3)phaseReady=true;});
 const lstat=mutableFs.lstat;t.mock.method(mutableFs,'lstat',async(path,...args)=>{const stat=await lstat(path,...args);if(String(path)!==options.outputDirectory||!phaseReady||++ownershipStats!==2)return stat;originalIdentity=stat;await fs.rename(options.outputDirectory,retained);await fs.mkdir(options.outputDirectory,{mode:0o700});await write(join(options.outputDirectory,'caller.txt'),'CALLER_AFTER_OWNERSHIP_CHECK',0o600);await write(join(options.outputDirectory,'materials/scripts/assemble-distribution-runtime.mjs'),`import fs from 'node:fs/promises';\nawait fs.writeFile(${JSON.stringify(marker)},'UNREVIEWED_IMPORT_EXECUTED',{flag:'wx',mode:0o600});\nexport async function assembleDistributionRuntime(){throw Error('ASSEMBLY_MUST_NOT_EXECUTE');}\n`);replacementIdentity=await fs.stat(options.outputDirectory);mutationTriggered=true;return stat;});syncBuiltinESMExports();
 const cause=await module.installV1(options).then(()=>assert.fail('replacement must refuse installation'),cause=>cause);reads.restore();assert.equal(mutationTriggered,true);assert.equal(canonicalReads,3);assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');
 await assert.rejects(fs.lstat(marker),{code:'ENOENT'});const after=await fs.stat(options.outputDirectory);assert.equal(after.ino,replacementIdentity.ino);assert.equal(after.dev,replacementIdentity.dev);assert.equal(after.mode&0o777,0o700);assert.equal(await fs.readFile(join(options.outputDirectory,'caller.txt'),'utf8'),'CALLER_AFTER_OWNERSHIP_CHECK');assert.equal(cause.failurePreservation.outputIdentity.ino,originalIdentity.ino);assert.equal(cause.failurePreservation.automaticRecursiveDeletion,false);assert.deepEqual((await fs.readdir(options.outputDirectory)).sort(),['caller.txt','materials']);
});
test('captured helpers cannot execute an undeclared source file',async t=>{
 const{options,root,descriptor,refresh}=await fullFixture(t),unreviewed=join(root,'unreviewed-helper.mjs'),marker=join(root,'unreviewed-helper-executed');await write(unreviewed,`import fs from 'node:fs/promises';await fs.writeFile(${JSON.stringify(marker)},'UNREVIEWED_EXECUTED',{flag:'wx'});\n`);
 const bytes=Buffer.from(`import ${JSON.stringify(pathToFileURL(unreviewed).href)};\nexport async function assembleDistributionRuntime(){throw Error('ASSEMBLY_MUST_NOT_EXECUTE');}\n`);await write(join(options.bundleDirectory,toolPaths.consumer),bytes);Object.assign(descriptor.files.find(file=>file.path===toolPaths.consumer),{bytes:bytes.length,sha256:sha(bytes)});await refresh();
 const reads=observeReads(t);await preservedFailure(module.installV1(options),options,'THIN_HELPER_IMPORT_UNDECLARED');reads.restore();assert.equal(reads.paths.includes(unreviewed),false);await assert.rejects(fs.lstat(marker),{code:'ENOENT'});
});
