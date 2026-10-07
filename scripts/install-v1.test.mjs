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
import {planRuntime,exportRuntime} from '../tools/runtime-export/export.mjs';

const module=await import('./install-v1.mjs').catch(cause=>{if(cause.code==='ERR_MODULE_NOT_FOUND')return {};throw cause;});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sri=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
const write=async(path,bytes,mode=0o644)=>{await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,bytes,{mode});await fs.chmod(path,mode);};
const json=(path,value)=>write(path,JSON.stringify(value,null,2)+'\n');
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
 const{options,productManifest}=await fullFixture(t),result=await module.installV1(options);
 assert.equal(result.modelsEnabled,false);assert.deepEqual(result.credentialReferences,['DEEPSEEK_API_KEY']);assert.equal(result.credentialsCreated,false);assert.equal(result.publicReleaseQualified,false);
 assert.equal(result.corePackageCount,74);assert.equal(result.externalPackageCount,28);assert.equal(result.gui.packageInstallation.packageSourceMode,'verified-export');assert.equal(result.gui.packageInstallation.recordedSourceRoot,productManifest.sourceRoot);assert.equal(result.gui.packageInstallation.sourceHead,productManifest.sourceHead);assert.equal(result.gui.packageInstallation.sourceTree,productManifest.sourceTree);
 assert.deepEqual(result.manualStartup.arguments.slice(1),['--profile','dsh-bot-gui','--port','3080','--no-open']);assert.equal(result.manualStartup.environment.DSH_HOME,result.home);assert.equal(result.manualStartup.arguments.includes('--enable-model-requests'),false);
 const observation=JSON.parse(await fs.readFile(join(result.installationDirectory,'sdk/npm-install-observation.json')));assert.equal(observation.cacheInitiallyEmpty,true);assert.equal(observation.emptyConfigs,true);assert.equal(observation.envNames.includes('NODE_OPTIONS'),false);
 const startup=await import(pathToFileURL(join(result.installationDirectory,'product/src/bot-gui-startup.mjs')));assert.equal(startup.parseBotGuiArguments([]).modelRequestsEnabled,false);assert.equal(startup.parseBotGuiArguments(['--enable-model-requests']).modelRequestsEnabled,true);
 const consumer=await import(pathToFileURL(join(result.installationDirectory,'materials/scripts/assemble-distribution-runtime.mjs')));assert.equal((await consumer.verifyDistributionRuntime({directory:result.runtimeDirectory,expectedManifestSha256:result.runtimeManifestSha256})).verified,true);
 await assert.rejects(fs.lstat(join(result.installationDirectory,'product/.git')),{code:'ENOENT'});await assert.rejects(fs.lstat(join(result.installationDirectory,'lifecycle-was-run')),{code:'ENOENT'});
});
test('unselected platform files are never read or required',async t=>{
 const{options,descriptor,refresh}=await fullFixture(t),other=process.platform==='linux'?{id:'darwin-arm64',platform:'darwin',arch:'arm64'}:{id:'linux-x64',platform:'linux',arch:'x64'};
 descriptor.targets.push({...other,overlayDirectory:'host/other/overlay',sourceIdentity:'host/other/identity.json',sourceLock:'host/other/lock.json',sourcePacket:'source/other.tgz',buildRecipe:'source/other.mjs'});descriptor.files.push({path:'host/other/missing-file',bytes:7,sha256:sha('PRIVXYZ'),mode:0o644,target:other.id});await refresh();
 const reads=observeReads(t);await module.installV1(options);reads.restore();assert.equal(reads.paths.some(path=>path.includes('/host/other/')),false);
});
test('authenticated product archive traversal is refused before npm is started',async t=>{
 const{options,root}=await fullFixture(t,{unsafeProduct:true});await assert.rejects(module.installV1(options),{code:'PRODUCT_ARCHIVE_INVALID'});await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});await assert.rejects(fs.lstat(join(root,'owned-escape.txt')),{code:'ENOENT'});
});
test('failed npm child reports a bounded category and cleans the owned output',async t=>{
 const{options}=await fullFixture(t,{failure:true});await assert.rejects(module.installV1(options),{code:'SDK_INSTALL_FAILED'});await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('npm timeout terminates its owned child even when SIGTERM is ignored',async t=>{
 const{options}=await fullFixture(t,{hang:true}),start=Date.now();await assert.rejects(module.installV1(options),{code:'SDK_INSTALL_TIMEOUT'});assert.ok(Date.now()-start<6000);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('npm-stage output replacement is preserved by inode cleanup',async t=>{
 const{options}=await fullFixture(t,{replaceOutput:true});const cause=await module.installV1(options).then(()=>assert.fail('replacement must fail'),cause=>cause);assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(cause.cleanupErrorCategory,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(await fs.readFile(join(options.outputDirectory,'caller.txt'),'utf8'),'CALLER_REPLACEMENT_REMAINS');
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
 await assert.rejects(module.installV1(options),{code:'OFFICIAL_SDK_LOCK_INVALID'});assert.equal(spawns,0);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('changed installation directory mode is refused and preserved during cleanup',async t=>{
 const{options}=await fullFixture(t,{changeOutputMode:true}),cause=await module.installV1(options).then(()=>assert.fail('output mode drift must fail'),cause=>cause);
 assert.equal(cause.code,'OUTPUT_OWNERSHIP_CHANGED');assert.equal(cause.cleanupErrorCategory,'OUTPUT_OWNERSHIP_CHANGED');assert.equal((await fs.stat(options.outputDirectory)).mode&0o777,0o755);
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
 await assert.rejects(module.installV1(options));reads.restore();assert.equal(replaced,true);assert.equal(spawns,0);assert.equal(reads.paths.includes(outside),false);assert.equal(reads.paths.includes(certificate),false);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('late npm entry mode drift cannot retain its first verified input identity',async t=>{
 const{options}=await fullFixture(t);let changed=false;
 const reads=observeReads(t,async path=>{if(changed||!path.endsWith('/sdk/node_modules/@deepseek-ai/dsh/package.json'))return;changed=true;await fs.chmod(options.npmCliPath,0o600);});
 await assert.rejects(module.installV1(options),{code:'THIN_FILE_HASH_MODE_MISMATCH'});reads.restore();assert.equal(changed,true);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('late descriptor mode drift cannot retain its first verified input identity',async t=>{
 const{options}=await fullFixture(t);let changed=false;
 const reads=observeReads(t,async path=>{if(changed||!path.endsWith('/sdk/node_modules/@deepseek-ai/dsh/package.json'))return;changed=true;await fs.chmod(options.descriptorPath,0o600);});
 await assert.rejects(module.installV1(options),{code:'THIN_FILE_HASH_MODE_MISMATCH'});reads.restore();assert.equal(changed,true);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
test('CLI sanitizes unknown delegated errors even when their code imitates an installer category',async t=>{
 const{options,descriptor,refresh}=await fullFixture(t),path=descriptor.tools.consumer,bytes=Buffer.from("export async function assembleDistributionRuntime(){const cause=new Error('PRIVXYZ');cause.code='THIN_FILE_HASH_MODE_MISMATCH';throw cause;}\n");
 await write(join(options.bundleDirectory,path),bytes);Object.assign(descriptor.files.find(file=>file.path===path),{bytes:bytes.length,sha256:sha(bytes)});await refresh();
 const flags={'--bundle':'bundleDirectory','--descriptor':'descriptorPath','--descriptor-sha256':'expectedDescriptorSha256','--output':'outputDirectory','--npm-cli':'npmCliPath','--npm-timeout-ms':'npmTimeoutMs'},args=[join(import.meta.dirname,'install-v1.mjs'),...Object.entries(flags).flatMap(([flag,key])=>[flag,String(options[key])])];
 const result=spawnSync(process.execPath,args,{env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:15000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.deepEqual(JSON.parse(result.stderr),{errorCategory:'THIN_INSTALL_FAILED'});assert.equal(result.stderr.includes('PRIVXYZ'),false);await assert.rejects(fs.lstat(options.outputDirectory),{code:'ENOENT'});
});
