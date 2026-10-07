/** Caller-pinned thin installer. Requires a trusted, exclusively used local directory.
 * Pathname checkpoints do not provide atomic inode-bound writes under concurrent mutation. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {spawn} from 'node:child_process';

const CLI_VERSION='0.2.0-rc.2',NODE_VERSION='24.19.0',ownErrors=new WeakSet();
const TERM_GRACE_MS=250,STOP_CONFIRMATION_MS=750;
const outputContract=Object.freeze({outputWritesAtomic:false,concurrentOutputMutationSupported:false});
const ioErrors=new Set(['ENOENT','EACCES','EPERM','EEXIST','ENOTDIR','EIO','ENOMEM','ELOOP','ERR_ACCESS_DENIED']),failurePreservations=new WeakMap();
const fail=code=>{const cause=Object.assign(new Error(code),{code});ownErrors.add(cause);return cause;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const prohibited=path=>path.split(/[\\/]/).some(part=>['.git','.env','.aws','.ssh','.codex','.agents','.npmrc','Home','credentials','credentials.json','auth.json'].includes(part)||part.startsWith('.env.'));
const safe=path=>typeof path==='string'&&path!==''&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(part=>part===''||part==='.'||part==='..'||part==='node_modules')&&!prohibited(path);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const parseJson=bytes=>{try{return JSON.parse(bytes.toString('utf8'));}catch{throw fail('THIN_ARTIFACT_JSON_INVALID');}};
const tools=Object.freeze({installer:'scripts/install-v1.mjs',consumer:'scripts/assemble-distribution-runtime.mjs',guiInstaller:'scripts/install-bot-gui-profile.mjs',packageSnapshot:'scripts/package-snapshot.mjs',runtimeExporter:'tools/runtime-export/export.mjs'});
function capturedExecution(captured,records){
 const namespace=new URL('file:///__dsh_v1_captured__/'+randomUUID()+'/'),sources=new Map(),loaded=new Set(),index=[];
 for(const path of Object.values(tools)){
  const bytes=captured.get(path),record=records.get(path),source=bytes.toString('utf8'),url=new URL(path,namespace).href;
  if(!Buffer.from(source,'utf8').equals(bytes))throw fail('THIN_TOOL_ENCODING_INVALID');
  sources.set(url,source);index.push(Object.freeze({path,bytes:record.bytes,sha256:record.sha256,mode:record.mode,url}));
 }
 const hook=registerHooks({
  resolve(specifier,context,nextResolve){
   if(sources.has(specifier))return{url:specifier,shortCircuit:true};
   if(context.parentURL?.startsWith(namespace.href)){
    if(specifier.startsWith('node:'))return nextResolve(specifier,context);
    let url;try{url=new URL(specifier,context.parentURL).href;}catch{throw fail('THIN_HELPER_IMPORT_UNDECLARED');}
    if(!sources.has(url))throw fail('THIN_HELPER_IMPORT_UNDECLARED');
    return{url,shortCircuit:true};
   }
   if(specifier.startsWith(namespace.href))throw fail('THIN_HELPER_IMPORT_UNDECLARED');
   return nextResolve(specifier,context);
  },
  load(url,context,nextLoad){
   if(url.startsWith(namespace.href)){
    if(!sources.has(url))throw fail('THIN_HELPER_IMPORT_UNDECLARED');
    loaded.add(url);return{format:'module',source:sources.get(url),shortCircuit:true};
   }
   return nextLoad(url,context);
  }
 });
 return Object.freeze({importTool:key=>import(new URL(tools[key],namespace).href),close:()=>hook.deregister(),evidence:()=>({mode:'CAPTURED_DESCRIPTOR_PINNED_SOURCES',mappedTools:index,capturedSourceIndexSha256:sha(JSON.stringify(index.map(({url,...record})=>record))),executionMapSha256:sha(JSON.stringify(index)),loadedTools:index.filter(record=>loaded.has(record.url)).map(record=>record.path)})});
}
async function canonical(path,directory=false){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.includes('\0')||prohibited(path))throw fail('CANONICAL_INPUT_REQUIRED');
 const stat=await fs.lstat(path);
 if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||await fs.realpath(path)!==path)throw fail('CANONICAL_INPUT_REQUIRED');
 return stat;
}
const sameState=(a,b)=>a.isFile()&&b.isFile()&&a.ino===b.ino&&a.dev===b.dev&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&(a.mode&0o7777)===(b.mode&0o7777);
async function readSafe(path,record){
 const before=await canonical(path);if(before.mode&0o7000)throw fail('THIN_FILE_HASH_MODE_MISMATCH');
 const handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=await handle.stat(),current=await canonical(path);if(!sameState(before,opened)||!sameState(opened,current))throw fail('THIN_INPUT_CHANGED');
  const bytes=await handle.readFile(),after=await handle.stat(),final=await canonical(path);
  if(bytes.length!==opened.size||!sameState(opened,after)||!sameState(after,final))throw fail('THIN_INPUT_CHANGED');
  if(record&&(bytes.length!==record.bytes||sha(bytes)!==record.sha256||(after.mode&0o777)!==record.mode))throw fail('THIN_FILE_HASH_MODE_MISMATCH');
  return{bytes,stat:after};
 }finally{await handle.close();}
}
function validateDescriptor(descriptor){
 if(descriptor?.runtime?.nodeVersion!==NODE_VERSION)throw fail('NODE_VERSION_UNQUALIFIED');
 if(descriptor?.format!==1||descriptor.classification!=='DSH_BOT_V1_THIN_INSTALL_BUNDLE'||descriptor.publicReleaseQualified!==false||!Array.isArray(descriptor.files)||!descriptor.files.length||!Array.isArray(descriptor.targets)||!descriptor.targets.length||descriptor.officialSdk?.cliVersion!==CLI_VERSION||typeof descriptor.product?.buildId!=='string'||!descriptor.product.buildId)throw fail('THIN_DESCRIPTOR_INVALID');
 if(!descriptor.tools||Object.keys(descriptor.tools).length!==Object.keys(tools).length||Object.entries(tools).some(([key,path])=>descriptor.tools[key]!==path))throw fail('THIN_TOOL_LAYOUT_INVALID');
 const ids=new Set();
 for(const target of descriptor.targets){
  if(!target||!['linux-x64','darwin-arm64'].includes(target.id)||target.id!==target.platform+'-'+target.arch||ids.has(target.id)||!['overlayDirectory','sourceIdentity','sourceLock','sourcePacket','buildRecipe'].every(key=>safe(target[key])))throw fail('THIN_DESCRIPTOR_INVALID');
  ids.add(target.id);
 }
 for(const file of descriptor.files)if(!file||!safe(file.path))throw fail('THIN_FILE_PATH_INVALID');
 const indexed=new Map();
 for(const file of descriptor.files){
  if(indexed.has(file.path)||!digest(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!Number.isInteger(file.mode)||file.mode<0||file.mode>0o777||file.target!=='common'&&!ids.has(file.target))throw fail('THIN_FILE_INDEX_INVALID');
  indexed.set(file.path,file);
 }
 const target=descriptor.targets.find(item=>item.platform===process.platform&&item.arch===process.arch);
 if(!target)throw fail('THIN_TARGET_UNAVAILABLE');
 const selected=descriptor.files.filter(file=>file.target==='common'||file.target===target.id).sort((a,b)=>a.path.localeCompare(b.path)),records=new Map(selected.map(file=>[file.path,file]));
 const required=[...Object.values(tools),descriptor.officialSdk.lock,descriptor.product.manifest,descriptor.product.archive,descriptor.registry?.receipts,...['public','native','muslCopyright','muslSourceNotices'].map(key=>descriptor.licenses?.[key]),target.sourceIdentity,target.sourceLock,target.sourcePacket,target.buildRecipe,target.overlayDirectory+'/artifact-manifest.json'];
 if(required.some(path=>!safe(path)||!records.has(path))||!safe(descriptor.registry?.directory)||!selected.some(file=>file.path.startsWith(descriptor.registry.directory+'/')))throw fail('THIN_REQUIRED_FILE_MISSING');
 if(dirname(descriptor.product.manifest)!==dirname(descriptor.product.archive))throw fail('THIN_PRODUCT_LAYOUT_INVALID');
 return{target,selected,records};
}
async function writeRecord(root,file,bytes){
 const path=join(root,file.path);await fs.mkdir(dirname(path),{recursive:true,mode:0o700});await fs.writeFile(path,bytes,{flag:'wx',mode:file.mode});await fs.chmod(path,file.mode);
}
function officialProject(lock){
 const root=lock?.packages?.[''];
 if(lock?.lockfileVersion!==3||!root||root.devDependencies?.['@deepseek-ai/dsh']!==CLI_VERSION||lock.packages['node_modules/@deepseek-ai/dsh']?.version!==CLI_VERSION)throw fail('OFFICIAL_SDK_LOCK_INVALID');
 for(const[path,item]of Object.entries(lock.packages)){
  if(!path)continue;
  if(!/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(path)||path.split('/').some(part=>part==='.'||part==='..')||prohibited(path)||item.link||typeof item.version!=='string'||!/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(item.integrity??''))throw fail('OFFICIAL_SDK_LOCK_INVALID');
  let url;try{url=new URL(item.resolved);}catch{throw fail('OFFICIAL_SDK_LOCK_INVALID');}
  if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.port||url.username||url.password)throw fail('OFFICIAL_SDK_LOCK_INVALID');
 }
 const project={name:root.name??lock.name??'private-dsh-v1-sdk',version:root.version??lock.version??'0.1.0',private:true};
 for(const section of ['dependencies','devDependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'])if(root[section]!==undefined)project[section]=root[section];
 return project;
}
async function npmEnvironment(output,checkOwnership){
 const environment={PATH:process.env.PATH||dirname(process.execPath)+':/usr/bin:/bin',LANG:process.env.LANG||'C',TZ:'UTC',HOME:join(output,'npm-home'),TMPDIR:join(output,'npm-tmp'),XDG_CONFIG_HOME:join(output,'npm-home/config')};
 for(const name of ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'])if(process.env[name]!==undefined)environment[name]=process.env[name];
 for(const name of ['NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'])if(process.env[name]!==undefined){
  const{bytes}=await readSafe(process.env[name]);await checkOwnership();
  const path=join(output,'certificates',name+'.pem');await fs.mkdir(dirname(path),{recursive:true,mode:0o700});await fs.writeFile(path,bytes,{flag:'wx',mode:0o600});
  await readSafe(path,{bytes:bytes.length,sha256:sha(bytes),mode:0o600});environment[name]=path;
 }
 return environment;
}
async function runNpmChild({outputIdentity,arguments_,environment,sdk,timeout}){
 return new Promise((resolvePromise,reject)=>{
  let child,pid,timer,killTimer,confirmationTimer,pollTimer,confirming=false,timedOut=false,finished=false,leaderExited=false,exitCode,reason='GROUP_REMAINS',spawnFailed=false;
  const finish=cause=>{
   if(finished)return;finished=true;for(const token of [timer,killTimer,confirmationTimer,pollTimer])clearTimeout(token);
   if(cause?.code==='SDK_INSTALL_STOP_UNKNOWN')try{child?.unref();}catch{}
   cause?reject(cause):resolvePromise(Object.freeze({pid,processGroupId:pid,state:'STOPPED',leaderExitObserved:true,processGroupEmpty:true,confirmationBoundMs:STOP_CONFIRMATION_MS}));
  };
  const unknown=why=>{
   const cause=fail('SDK_INSTALL_STOP_UNKNOWN');cause.stopConfirmation=Object.freeze({state:'UNKNOWN',reason:why,pid:Number.isInteger(pid)?pid:null,processGroupId:Number.isInteger(pid)?pid:null,confirmationBoundMs:STOP_CONFIRMATION_MS,outputIdentity:Object.freeze({...outputIdentity})});finish(cause);
  };
  const identityMatches=()=>{
   try{if(Number.isInteger(pid)&&pid>0&&child.pid===pid)return true;}catch{}
   unknown('PROCESS_IDENTITY_CHANGED');return false;
  };
  const probeGroup=()=>{
   if(!identityMatches())return null;
   try{process.kill(-pid,0);return true;}catch(cause){if(cause.code==='ESRCH')return false;unknown('GROUP_QUERY_DENIED');return null;}
  };
  const poll=()=>{
   if(finished)return;const remains=probeGroup();if(finished)return;
   if(remains===false&&leaderExited){finish(timedOut?fail('SDK_INSTALL_TIMEOUT'):spawnFailed?fail('SDK_INSTALL_SPAWN_FAILED'):exitCode===0?null:fail('SDK_INSTALL_FAILED'));return;}
   pollTimer=setTimeout(poll,25);
  };
  const beginConfirmation=()=>{
   if(confirming||finished)return;confirming=true;
   confirmationTimer=setTimeout(()=>unknown(reason),STOP_CONFIRMATION_MS);poll();
  };
  const signalOwned=signal=>{
   if(finished||!identityMatches())return;
   if(finished||!identityMatches()||leaderExited||child.exitCode!==null||child.signalCode!==null)return;
   const remains=probeGroup();if(finished||remains!==true)return;
   // A live original leader anchors this group. Do not follow mutable PID
   // metadata, use a positive-PID fallback, or signal after that anchor exits.
   try{process.kill(-pid,signal);}catch(cause){if(cause.code!=='ESRCH')reason='STOP_SIGNAL_DENIED';}
  };
  const stopOwned=()=>{
   beginConfirmation();if(finished)return;signalOwned('SIGTERM');killTimer=setTimeout(()=>signalOwned('SIGKILL'),TERM_GRACE_MS);
  };
  try{child=spawn(process.execPath,arguments_,{cwd:sdk,env:environment,stdio:'ignore',detached:true});}catch{finish(fail('SDK_INSTALL_SPAWN_FAILED'));return;}
  child.once('error',()=>{if(finished)return;if(!Number.isInteger(pid)){finish(fail('SDK_INSTALL_SPAWN_FAILED'));return;}spawnFailed=true;stopOwned();});
  child.once('exit',code=>{leaderExited=true;exitCode=code;beginConfirmation();});
  try{pid=child.pid;}catch{unknown('PROCESS_IDENTITY_CHANGED');return;}
  timer=setTimeout(()=>{timedOut=true;stopOwned();},timeout);
 });
}
async function installSdk({output,outputIdentity,npmCliPath,npmCliBytes,lockBytes,lock,timeout,checkOwnership}){
 const sdk=join(output,'sdk'),cache=join(output,'npm-cache'),userconfig=join(output,'empty-user.npmrc'),globalconfig=join(output,'empty-global.npmrc');
 for(const path of [sdk,cache,join(output,'npm-home'),join(output,'npm-home/config'),join(output,'npm-tmp')]){await checkOwnership();await fs.mkdir(path,{mode:0o700});}
 const writePrivate=async(path,bytes)=>{await checkOwnership();await fs.writeFile(path,bytes,{flag:'wx',mode:0o600});};
 await writePrivate(join(sdk,'package.json'),JSON.stringify(officialProject(lock),null,2)+'\n');await writePrivate(join(sdk,'package-lock.json'),lockBytes);
 await writePrivate(userconfig,'');await writePrivate(globalconfig,'');
 const wrapper=join(output,'npm-entry.mjs');
 // Execute the safely read CommonJS npm entry bytes, retaining its original
 // filename for public npm's relative module resolution. Node never rereads
 // the caller-controlled entry pathname after the canonical descriptor read.
 const source=`import Module from 'node:module';\nimport {dirname} from 'node:path';\nconst filename=${JSON.stringify(npmCliPath)};\nconst entry=new Module(filename);entry.filename=filename;entry.paths=Module._nodeModulePaths(dirname(filename));process.argv=[process.execPath,filename,...process.argv.slice(2)];process.mainModule=entry;Module._cache[filename]=entry;entry._compile(Buffer.from(${JSON.stringify(npmCliBytes.toString('base64'))},'base64').toString('utf8'),filename);entry.loaded=true;\n`;
 await writePrivate(wrapper,source);await checkOwnership();
 const environment=await npmEnvironment(output,checkOwnership),arguments_=[wrapper,'ci','--ignore-scripts','--no-audit','--no-fund','--strict-ssl=true','--userconfig',userconfig,'--globalconfig',globalconfig,'--cache',cache,'--registry','https://registry.npmjs.org/','--include=dev','--include=optional'];
 const npmProcess=await runNpmChild({outputIdentity,arguments_,environment,sdk,timeout});
 await checkOwnership();
 await readSafe(join(sdk,'package-lock.json'),{bytes:lockBytes.length,sha256:sha(lockBytes),mode:0o600});
 return{sdk,evidence:{cliVersion:CLI_VERSION,lockSha256:sha(lockBytes),npmCliSha256:sha(npmCliBytes),freshCache:true,emptyConfigs:true,strictTls:true,registry:'https://registry.npmjs.org/',lifecycleScriptsExecuted:false,timeoutMs:timeout,npmProcess}};
}
async function unpackProduct({materials,descriptor,records,output,checkOwnership,execution}){
 await checkOwnership();const metadata=await execution.importTool('packageSnapshot');await checkOwnership();
 const{bytes:manifestBytes}=await readSafe(join(materials,descriptor.product.manifest),records.get(descriptor.product.manifest)),manifest=parseJson(manifestBytes);
 const{bytes:archive}=await readSafe(join(materials,descriptor.product.archive),records.get(descriptor.product.archive));
 if(manifest.format!==1||manifest.buildId!==descriptor.product.buildId||manifest.packageSourceClean!==true||manifest.tarball!==relative(dirname(descriptor.product.manifest),descriptor.product.archive)||manifest.packageSHA256!==sha(archive)||!Array.isArray(manifest.files)||!['sourceHead','sourceTree'].every(key=>/^[a-f0-9]{40}$/.test(manifest[key]??''))||typeof manifest.sourceRoot!=='string'||!isAbsolute(manifest.sourceRoot)||resolve(manifest.sourceRoot)!==manifest.sourceRoot)throw fail('PRODUCT_SNAPSHOT_INVALID');
 let files;try{files=metadata.decodePackageArchive(archive);metadata.validatePackageClosure(files);}catch{throw fail('PRODUCT_ARCHIVE_INVALID');}
 const index=[...files.keys()].sort().map(path=>({path,bytes:files.get(path).length,sha256:sha(files.get(path)),mode:files.modes.get(path)}));
 if(index.some(file=>!safe(file.path))||JSON.stringify(index)!==JSON.stringify(manifest.files))throw fail('PRODUCT_SNAPSHOT_INVALID');
 await checkOwnership();const product=join(output,'product');await fs.mkdir(product,{mode:0o700});
 for(const file of index){await checkOwnership();await writeRecord(product,file,files.get(file.path));}
 return{product,manifest,manifestBytes,packageSnapshot:Object.freeze({manifestPath:join(materials,descriptor.product.manifest),manifestSHA256:sha(manifestBytes),buildId:descriptor.product.buildId})};
}

export async function installV1(options){
 if(process.versions.node!==NODE_VERSION)throw fail('NODE_VERSION_UNQUALIFIED');
 if(!['linux-x64','darwin-arm64'].includes(process.platform+'-'+process.arch))throw fail('THIN_TARGET_UNAVAILABLE');
 if(!digest(options.expectedDescriptorSha256))throw fail('TRUSTED_DESCRIPTOR_PIN_REQUIRED');
 const timeout=options.npmTimeoutMs??120000;if(!Number.isInteger(timeout)||timeout<1000||timeout>300000)throw fail('NPM_TIMEOUT_INVALID');
 await canonical(options.bundleDirectory,true);
 if(typeof options.descriptorPath!=='string'||!inside(options.bundleDirectory,options.descriptorPath)||!safe(relative(options.bundleDirectory,options.descriptorPath)))throw fail('THIN_DESCRIPTOR_PATH_INVALID');
 const{bytes:descriptorBytes,stat:descriptorStat}=await readSafe(options.descriptorPath);if(sha(descriptorBytes)!==options.expectedDescriptorSha256)throw fail('THIN_DESCRIPTOR_HASH_MISMATCH');
 const descriptorRecord={bytes:descriptorBytes.length,sha256:options.expectedDescriptorSha256,mode:descriptorStat.mode&0o777};
 const descriptor=parseJson(descriptorBytes),selection=validateDescriptor(descriptor),output=options.outputDirectory;
 if(typeof output!=='string'||!isAbsolute(output)||resolve(output)!==output||output.includes('\0'))throw fail('CANONICAL_OUTPUT_REQUIRED');
 await canonical(dirname(output),true);await canonical(options.npmCliPath);
 if([options.bundleDirectory,options.npmCliPath].some(path=>inside(path,output)||inside(output,path)))throw fail('EXCLUSIVE_OUTPUT_OUTSIDE_INPUTS_REQUIRED');
 try{await fs.lstat(output);throw fail('OUTPUT_ALREADY_EXISTS');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
 const capturedTools=new Map();for(const file of selection.selected){const{bytes}=await readSafe(join(options.bundleDirectory,file.path),file);if(Object.values(tools).includes(file.path))capturedTools.set(file.path,Buffer.from(bytes));}
 const{bytes:npmCliBytes,stat:npmCliStat}=await readSafe(options.npmCliPath),npmCliRecord={bytes:npmCliBytes.length,sha256:sha(npmCliBytes),mode:npmCliStat.mode&0o777};
 let claimed,created=false,execution;
 const matchesOwnership=stat=>claimed&&stat.isDirectory()&&!stat.isSymbolicLink()&&stat.ino===claimed.ino&&stat.dev===claimed.dev&&(stat.mode&0o7777)===0o700&&(claimed.mode&0o7777)===0o700;
 const checkOwnership=async()=>{const before=await fs.lstat(output);if(!matchesOwnership(before))throw fail('OUTPUT_OWNERSHIP_CHANGED');const actual=await fs.realpath(output),after=await fs.lstat(output);if(actual!==output||!matchesOwnership(after)||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fail('OUTPUT_OWNERSHIP_CHANGED');};
 try{
  try{await fs.mkdir(output,{mode:0o700});}catch(cause){if(cause.code==='EEXIST')throw fail('OUTPUT_ALREADY_EXISTS');throw cause;}created=true;claimed=await fs.lstat(output);await checkOwnership();
  const materials=join(output,'materials');await fs.mkdir(materials,{mode:0o700});
  for(const file of selection.selected){const{bytes}=await readSafe(join(options.bundleDirectory,file.path),file);await checkOwnership();await writeRecord(materials,file,bytes);}
  await readSafe(options.descriptorPath,descriptorRecord);await readSafe(options.npmCliPath,npmCliRecord);
  await checkOwnership();
  for(const file of selection.selected)await readSafe(join(materials,file.path),file);
  const self=await readSafe(fileURLToPath(import.meta.url));if(sha(self.bytes)!==selection.records.get(tools.installer).sha256)throw fail('THIN_INSTALLER_IDENTITY_MISMATCH');
  execution=capturedExecution(capturedTools,selection.records);
  const target=selection.target,overlayManifestPath=target.overlayDirectory+'/artifact-manifest.json',overlay=parseJson((await readSafe(join(materials,overlayManifestPath),selection.records.get(overlayManifestPath))).bytes);
  if(overlay.format!==2||overlay.platform!==process.platform||overlay.arch!==process.arch||overlay.corePackageCount!==74||overlay.packages?.length!==74||overlay.externalPackages?.length!==28)throw fail('THIN_OVERLAY_INVALID');
  const product=await unpackProduct({materials,descriptor,records:selection.records,output,checkOwnership,execution});
  const lockFile=selection.records.get(descriptor.officialSdk.lock),{bytes:lockBytes}=await readSafe(join(materials,lockFile.path),lockFile),lock=parseJson(lockBytes);
  const{sdk,evidence:sdkInstallation}=await installSdk({output,outputIdentity:{directory:output,ino:claimed.ino,dev:claimed.dev,mode:claimed.mode&0o777},npmCliPath:options.npmCliPath,npmCliBytes,lockBytes,lock,timeout,checkOwnership});
  const path=key=>join(materials,key),pin=key=>selection.records.get(key).sha256;await checkOwnership();const consumer=await execution.importTool('consumer');
  await checkOwnership();
  const runtime=await consumer.assembleDistributionRuntime({officialRoot:sdk,officialLockPath:join(sdk,'package-lock.json'),expectedOfficialLockSha256:sha(lockBytes),overlayDirectory:path(target.overlayDirectory),expectedManifestSha256:pin(overlayManifestPath),sourceIdentityPath:path(target.sourceIdentity),expectedSourceIdentitySha256:pin(target.sourceIdentity),sourceLockPath:path(target.sourceLock),registryDirectory:path(descriptor.registry.directory),registryReceiptsPath:path(descriptor.registry.receipts),productRoot:product.product,outputDirectory:join(output,'runtime'),publicLicensePath:path(descriptor.licenses.public),expectedPublicLicenseSha256:pin(descriptor.licenses.public),nativeLicensePath:path(descriptor.licenses.native),expectedNativeLicenseSha256:pin(descriptor.licenses.native),muslCopyrightPath:path(descriptor.licenses.muslCopyright),expectedMuslCopyrightSha256:pin(descriptor.licenses.muslCopyright),muslSourceNoticesPath:path(descriptor.licenses.muslSourceNotices),expectedMuslSourceNoticesSha256:pin(descriptor.licenses.muslSourceNotices)});
  await checkOwnership();await consumer.verifyDistributionRuntime({directory:runtime.runtimeDirectory,expectedManifestSha256:runtime.manifestSha256});
  await checkOwnership();const helper=await execution.importTool('guiInstaller');await checkOwnership();
  const gui=await helper.installBotGuiProfile({directory:join(output,'profile'),productRoot:product.product,runtimeRoot:runtime.runtimeDirectory,cwd:join(output,'work'),packagePlacement:'snapshot',packageSnapshot:product.packageSnapshot,packageSourceMode:'verified-export'});
  await checkOwnership();
  for(const file of selection.selected){await readSafe(join(options.bundleDirectory,file.path),file);await readSafe(join(materials,file.path),file);}
  await readSafe(options.descriptorPath,descriptorRecord);await readSafe(options.npmCliPath,npmCliRecord);
  const result={format:1,classification:'PRIVATE_LOCAL_THIN_INSTALLATION',...outputContract,installationDirectory:output,bundleDescriptorSha256:options.expectedDescriptorSha256,target:target.id,nodeVersion:NODE_VERSION,platform:process.platform,arch:process.arch,runtimeDirectory:runtime.runtimeDirectory,runtimeManifestPath:runtime.manifestPath,runtimeManifestSha256:runtime.manifestSha256,profileDirectory:join(output,'profile'),home:gui.home,cwd:gui.cwd,profile:gui.profile,dsh:gui.dsh,configPath:join(gui.home,'profiles',gui.profile,'cordis.patch.yml'),corePackageCount:74,externalPackageCount:28,gui,sdkInstallation,helperExecution:execution.evidence(),selectedInputFileCount:selection.selected.length,selectedInputFileIndexSha256:sha(JSON.stringify(selection.selected)),productManifestSha256:sha(product.manifestBytes),modelsEnabled:false,credentialReferences:['DEEPSEEK_API_KEY'],credentialsCreated:false,publicReleaseQualified:false,sandboxEnforcementVerified:false,manualStartup:{executable:process.execPath,arguments:[gui.dsh,'--profile',gui.profile,'--port','3080','--no-open'],environment:{DSH_HOME:gui.home}}};
  const resultBytes=Buffer.from(JSON.stringify(result,null,2)+'\n'),manifestPath=join(output,'installation-manifest.json');await checkOwnership();await fs.writeFile(manifestPath,resultBytes,{flag:'wx',mode:0o600});await checkOwnership();
  return{...result,installationManifestPath:manifestPath,installationManifestSha256:sha(resultBytes),ownership:{ino:claimed.ino,dev:claimed.dev}};
 }catch(cause){
  if(!created)throw cause;
  const code=ownErrors.has(cause)?cause.code:ioErrors.has(cause?.code)?cause.code:'THIN_INSTALL_FAILED',failure=Object.assign(new Error(code),{code});if(ownErrors.has(cause))ownErrors.add(failure);
  const preservation=Object.freeze({state:'PRESERVED_AFTER_FAILURE',...outputContract,automaticRecursiveDeletion:false,identityKnown:Boolean(claimed),outputIdentity:Object.freeze({directory:output,ino:claimed?.ino??null,dev:claimed?.dev??null,mode:claimed?claimed.mode&0o777:null})});failure.failurePreservation=preservation;failurePreservations.set(failure,preservation);
  if(ownErrors.has(cause)&&cause.code==='SDK_INSTALL_STOP_UNKNOWN'){failure.cleanupErrorCategory='SDK_CHILD_STOP_UNKNOWN';failure.stopConfirmation=cause.stopConfirmation;}
  throw failure;
 }finally{execution?.close();}
}
export function parseV1InstallArguments(values){
 const flags={'--bundle':'bundleDirectory','--descriptor':'descriptorPath','--descriptor-sha256':'expectedDescriptorSha256','--output':'outputDirectory','--npm-cli':'npmCliPath','--npm-timeout-ms':'npmTimeoutMs'},options={npmTimeoutMs:120000},seen=new Set();
 if(!Array.isArray(values)||!values.every(value=>typeof value==='string'))throw fail('INVALID_EXPLICIT_FLAGS');
 for(let at=0;at<values.length;at+=2){const key=flags[values[at]],value=values[at+1];if(!key||seen.has(key)||!value||value.startsWith('--'))throw fail('INVALID_EXPLICIT_FLAGS');seen.add(key);options[key]=value;}
 if(!['bundleDirectory','descriptorPath','expectedDescriptorSha256','outputDirectory','npmCliPath'].every(key=>seen.has(key)))throw fail('INVALID_EXPLICIT_FLAGS');
 options.npmTimeoutMs=Number(options.npmTimeoutMs);if(!Number.isInteger(options.npmTimeoutMs)||options.npmTimeoutMs<1000||options.npmTimeoutMs>300000)throw fail('INVALID_EXPLICIT_FLAGS');
 return Object.freeze(options);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await installV1(parseV1InstallArguments(process.argv.slice(2))))+'\n');}
 catch(cause){const errorCategory=ownErrors.has(cause)?cause.code:ioErrors.has(cause?.code)?'THIN_IO_FAILED':'THIN_INSTALL_FAILED',stopUnknown=ownErrors.has(cause)&&cause.code==='SDK_INSTALL_STOP_UNKNOWN',preservation=failurePreservations.get(cause),message=JSON.stringify({errorCategory,...preservation?{failurePreservation:preservation}:{},...stopUnknown?{cleanupErrorCategory:'SDK_CHILD_STOP_UNKNOWN',stopConfirmation:cause.stopConfirmation}:{}})+'\n';if(stopUnknown){const deadline=setTimeout(()=>process.exit(1),100);process.stderr.write(message,()=>{clearTimeout(deadline);process.exit(1);});}else{process.stderr.write(message);process.exitCode=1;}}
}
