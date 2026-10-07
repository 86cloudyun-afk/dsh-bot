/** Invoke only captured descriptor-pinned installer bytes; independently reread output. */
import * as fs from 'node:fs/promises';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadState,capturedTools,safeRead,sha,requireThat,privateDirectory,writePrivate,writeReceipt,
 publicNpmEntry,redactError,finalStates,cleanEnvironment} from './common.mjs';

const inside=(root,path)=>path===root||path.startsWith(root+'/');
async function inventory(root,{skip=new Set(),dependencyLink}={}){
 const files=[],reads=[],directories=[],links=[];
 const walk=async at=>{
  for(const item of(await fs.readdir(join(root,at),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const path=at?at+'/'+item.name:item.name;if(skip.has(path))continue;
   const full=join(root,path),value=await fs.lstat(full);
   if(value.isSymbolicLink()){
    const target=await fs.readlink(full),actual=await fs.realpath(full);
    if(dependencyLink)requireThat(path===dependencyLink.path&&actual===dependencyLink.target,'PRODUCT_DEPENDENCY_VIEW_REFUSED');
    else requireThat(!isAbsolute(target)&&inside(root,actual),'RUNTIME_LINK_REFUSED');
    links.push({path,target,resolvesTo:relative(root,actual)});
   }else if(value.isDirectory()){
    requireThat(await fs.realpath(full)===full,'INVENTORY_DIRECTORY_ALIAS_REFUSED');directories.push(path);await walk(path);
   }else{
    const read=await safeRead(full);reads.push({path:read.path,state:read.state});files.push({path,bytes:read.bytes.length,sha256:sha(read.bytes),mode:read.mode});
   }
  }
 };await walk('');await finalStates(reads);return{files,reads,directories,links};
}
const sorted=rows=>[...rows].sort((a,b)=>a.path.localeCompare(b.path));
const expectedDirectories=rows=>new Set(rows.flatMap(row=>row.path.split('/').slice(0,-1).map((_,i)=>row.path.split('/').slice(0,i+1).join('/'))));
async function exactProduct(root,rows,dependencyLink){
 const actual=await inventory(root,{dependencyLink});
 requireThat(JSON.stringify(sorted(actual.files))===JSON.stringify(sorted(rows)),'INSTALLED_PRODUCT_BYTES_MODES_REFUSED');
 const expectedDirs=expectedDirectories(rows);
 requireThat(JSON.stringify([...expectedDirs].sort())===JSON.stringify([...actual.directories].sort()),'INSTALLED_PRODUCT_DIRECTORY_SET_REFUSED');
 requireThat(dependencyLink?actual.links.length===1:actual.links.length===0,'INSTALLED_PRODUCT_LINK_SET_REFUSED');
 return actual;
}
export async function verifyInstalled(state,{installationManifestSha256,runtimeManifestSha256,profileSha256}={},execution){
 const own=execution??await capturedTools(state);
 try{
  const output=join(state.root,'installation');await privateDirectory(output);
  const manifestFile=await safeRead(join(output,'installation-manifest.json'));
  requireThat(sha(manifestFile.bytes)===installationManifestSha256,'INSTALLATION_MANIFEST_PIN_REFUSED');
  const manifest=JSON.parse(manifestFile.bytes),descriptor=own.descriptor,target=descriptor.targets.find(x=>x.id===state.target),records=own.records;
  requireThat(manifest.classification==='PRIVATE_LOCAL_THIN_INSTALLATION'&&manifest.target===state.target
   &&manifest.nodeVersion==='24.19.0'&&manifest.bundleDescriptorSha256===state.pins.descriptor.sha256
   &&manifest.runtimeManifestSha256===runtimeManifestSha256&&manifest.modelsEnabled===false&&manifest.credentialsCreated===false
   &&manifest.outputWritesAtomic===false&&manifest.concurrentOutputMutationSupported===false
   &&manifest.corePackageCount===74&&manifest.externalPackageCount===28
   &&manifest.gui.packageInstallation.sourceHead===state.pins.sourceHead
   &&manifest.gui.packageInstallation.sourceTree===state.pins.sourceTree
   &&manifest.gui.packageInstallation.buildId===state.pins.productBuildId,'INSTALLATION_METADATA_REFUSED');
  const runtime=join(output,'runtime'),materials=join(output,'materials'),product=join(output,'product'),home=join(output,'profile','home');
  requireThat(manifest.installationDirectory===output&&manifest.runtimeDirectory===runtime&&manifest.home===home
   &&manifest.cwd===join(output,'work')&&manifest.dsh===join(runtime,'node_modules','@deepseek-ai','dsh','lib','bin.js')
   &&manifest.profile==='dsh-bot-gui'&&manifest.configPath===join(home,'profiles','dsh-bot-gui','cordis.patch.yml')
   &&manifest.runtimeManifestPath===join(runtime,'distribution-runtime-manifest.json'),'INSTALLATION_CANONICAL_LAYOUT_REFUSED');
  await privateDirectory(home);await privateDirectory(manifest.cwd);
  const runtimeFile=await safeRead(manifest.runtimeManifestPath),runtimeManifest=JSON.parse(runtimeFile.bytes);
  requireThat(sha(runtimeFile.bytes)===runtimeManifestSha256,'RUNTIME_MANIFEST_PIN_REFUSED');
  const consumer=await own.importTool('consumer'),verification=await consumer.verifyDistributionRuntime({directory:runtime,expectedManifestSha256:runtimeManifestSha256});
  requireThat(verification.verified===true&&verification.corePackageCount===74&&verification.externalPackageCount===28,'COMPLETE_RUNTIME_VERIFICATION_REFUSED');
  const runtimeScan=await inventory(runtime,{skip:new Set(['distribution-runtime-manifest.json'])});
  requireThat(JSON.stringify(runtimeScan.files)===JSON.stringify(runtimeManifest.files)
   &&JSON.stringify(runtimeScan.directories)===JSON.stringify(runtimeManifest.directories)
   &&JSON.stringify(runtimeScan.links)===JSON.stringify(runtimeManifest.links),'INDEPENDENT_RUNTIME_INVENTORY_REFUSED');
  const originalSdk=await inventory(join(output,'sdk'),{skip:new Set(['package.json','package-lock.json','node_modules/.package-lock.json'])});
  // npm .bin links are regenerated by the consumer; inventory hash covers every original regular file.
  const publicRows=sorted(originalSdk.files.filter(row=>row.path.startsWith('node_modules/')));
  requireThat(publicRows.length===runtimeManifest.officialInputFileCount
   &&sha(JSON.stringify(publicRows))===runtimeManifest.officialInputFileIndexSha256,'ORIGINAL_OFFICIAL_SDK_INVENTORY_REFUSED');
  const inputReads=[];
  const bundleScan=await inventory(state.bundleDirectory);
  const wholeInputRows=[...descriptor.files.map(({path,bytes,sha256,mode})=>({path,bytes,sha256,mode})),
   {path:state.pins.descriptor.path,bytes:state.pins.descriptor.bytes,sha256:state.pins.descriptor.sha256,mode:state.pins.descriptor.mode}];
  requireThat(JSON.stringify(sorted(bundleScan.files))===JSON.stringify(sorted(wholeInputRows))&&bundleScan.links.length===0
   &&JSON.stringify([...expectedDirectories(wholeInputRows)].sort())===JSON.stringify([...bundleScan.directories].sort()),
   'WHOLE_EXTERNAL_BUNDLE_READBACK_REFUSED');
  for(const row of descriptor.files.filter(row=>row.target==='common'||row.target===state.target)){
   for(const root of[state.bundleDirectory,materials]){const read=await safeRead(join(root,row.path),row);inputReads.push({path:read.path,state:read.state});}
  }
  const selected=descriptor.files.filter(row=>row.target==='common'||row.target===state.target).sort((a,b)=>a.path.localeCompare(b.path));
  requireThat(manifest.selectedInputFileCount===selected.length&&manifest.selectedInputFileIndexSha256===sha(JSON.stringify(selected)),
   'SELECTED_INPUT_INVENTORY_REFUSED');
  const selectedMaterial=await inventory(materials);
  requireThat(JSON.stringify(sorted(selectedMaterial.files))===JSON.stringify(sorted(selected.map(({path,bytes,sha256,mode})=>({path,bytes,sha256,mode}))))
   &&selectedMaterial.links.length===0
   &&JSON.stringify([...expectedDirectories(selected)].sort())===JSON.stringify([...selectedMaterial.directories].sort()),'COPIED_MATERIAL_CLOSURE_REFUSED');
  const identityFile=await safeRead(join(materials,target.sourceIdentity),records.get(target.sourceIdentity)),identity=JSON.parse(identityFile.bytes);
  const overlayFile=await safeRead(join(materials,target.overlayDirectory,'artifact-manifest.json'),records.get(target.overlayDirectory+'/artifact-manifest.json')),
   overlay=JSON.parse(overlayFile.bytes);
  requireThat(identity.sourceFiles.length===4074&&sha(JSON.stringify(identity.sourceFiles))===state.pins.sourceIndexSha256
   &&overlay.sourceFileIndexSha256===state.pins.sourceIndexSha256&&overlay.verifiedSourceFileCount===4074
   &&overlay.platform===process.platform&&overlay.arch===process.arch&&overlay.corePackageCount===74
   &&runtimeManifest.sourceIdentitySha256===sha(identityFile.bytes)&&runtimeManifest.overlayManifestSha256===sha(overlayFile.bytes)
   &&runtimeManifest.sourceFileIndexSha256===state.pins.sourceIndexSha256,'FINAL_M3_SOURCE_BINDING_REFUSED');
  const lock=await safeRead(join(materials,target.sourceLock),records.get(target.sourceLock));
  requireThat(sha(lock.bytes)===identity.dependencyLockSha256&&runtimeManifest.sourceLockSha256===sha(lock.bytes),'SOURCE_LOCK_BINDING_REFUSED');
  const packet=await safeRead(join(materials,target.sourcePacket),records.get(target.sourcePacket));
  const productManifest=await safeRead(join(materials,descriptor.product.manifest),records.get(descriptor.product.manifest)),packageManifest=JSON.parse(productManifest.bytes);
  const productArchive=await safeRead(join(materials,descriptor.product.archive),records.get(descriptor.product.archive));
  requireThat(packageManifest.sourceHead===state.pins.sourceHead&&packageManifest.sourceTree===state.pins.sourceTree
   &&packageManifest.buildId===state.pins.productBuildId&&sha(productArchive.bytes)===packageManifest.packageSHA256,'FINAL_PRODUCT_SOURCE_BINDING_REFUSED');
  const snapshot=await own.importTool('packageSnapshot'),decoded=snapshot.decodePackageArchive(productArchive.bytes);snapshot.validatePackageClosure(decoded);
  const productRows=[...decoded.keys()].sort().map(path=>({path,bytes:decoded.get(path).length,sha256:sha(decoded.get(path)),mode:decoded.modes.get(path)}));
  requireThat(JSON.stringify(productRows)===JSON.stringify(packageManifest.files),'PRODUCT_ARCHIVE_INDEX_REFUSED');
  await exactProduct(product,productRows);
  const installedProduct=join(home,'profiles','dsh-bot-gui','node_modules','dsh-bot');
  await exactProduct(installedProduct,productRows,{path:'node_modules',target:join(runtime,'node_modules')});
  requireThat(manifest.gui.runtimeDependencyBinding.kind==='same-runtime-node-modules'
   &&manifest.gui.runtimeDependencyBinding.nodeModules===join(runtime,'node_modules')
   &&await fs.realpath(join(installedProduct,'node_modules'))===join(runtime,'node_modules'),'SAME_RUNTIME_PRODUCT_BINDING_REFUSED');
  const profile=await safeRead(manifest.configPath);
  if(profileSha256)requireThat(sha(profile.bytes)===profileSha256,'DOCUMENTED_PROFILE_CHANGED');
  const profileConfig=JSON.parse(profile.bytes),plugins=profileConfig.flatMap(item=>item.insert??[item]);
  requireThat(plugins.find(item=>item.id==='agent-loop')?.config?.agents?.length===0
   &&plugins.find(item=>item.id==='bot-gui-session-controller')?.config?.nativeOpen===false
   &&manifest.sdkInstallation.freshCache===true&&manifest.sdkInstallation.strictTls===true
   &&manifest.sdkInstallation.lifecycleScriptsExecuted===false&&manifest.sdkInstallation.timeoutMs===120000
   &&manifest.sdkInstallation.npmProcess.state==='STOPPED','DOCUMENTED_DISABLED_MODEL_PROFILE_REFUSED');
  const officialLock=await safeRead(join(materials,descriptor.officialSdk.lock),records.get(descriptor.officialSdk.lock));
  requireThat(sha(officialLock.bytes)===runtimeManifest.officialLockSha256&&sha(officialLock.bytes)===manifest.sdkInstallation.lockSha256,'FRESH_OFFICIAL_LOCK_BINDING_REFUSED');
  await finalStates([manifestFile,runtimeFile,profile,identityFile,overlayFile,lock,packet,productManifest,productArchive,officialLock,
   ...inputReads,...runtimeScan.reads,...originalSdk.reads,...selectedMaterial.reads,...bundleScan.reads,...own.reads]);
  return {manifest,proof:{installationManifestSha256,runtimeManifestSha256,profileSha256:sha(profile.bytes),
   descriptorSha256:state.pins.descriptor.sha256,productSourceHead:state.pins.sourceHead,productSourceTree:state.pins.sourceTree,
   productBuildId:state.pins.productBuildId,productFileCount:productRows.length,sourceIndexSha256:state.pins.sourceIndexSha256,
   sourceFiles:4074,sourcePacketSha256:sha(packet.bytes),sourceLockSha256:sha(lock.bytes),selectedInputFiles:selected.length,
   runtimeFiles:verification.fileCount,originalOfficialSdkFiles:publicRows.length,corePackages:74,externalPackages:28,
   completeRuntimeBytesModesLinksBindingsVerified:true,completeOriginalSdkReadbackVerified:true,
   copiedMaterialsBytesModesVerified:true,wholeExternalBundleReadbackFiles:wholeInputRows.length,
   productBytesModesVerified:true,sameRuntimeDependencyView:true,
   lifecycleScriptsExecuted:false,modelsRequested:0,outputWritesAtomic:false,concurrentOutputMutationSupported:false}};
 }finally{if(!execution)own.close();}
}
export async function installFresh(state){
 // No old Home, inherited provider key, NODE_OPTIONS or previous npm config is an input.
 const environment=cleanEnvironment(state,'server');for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,environment);
 const execution=await capturedTools(state);
 try{
  const npm=await publicNpmEntry(state),installer=await execution.importTool('installer');
  const result=await installer.installV1({bundleDirectory:state.bundleDirectory,descriptorPath:state.descriptorPath,
   expectedDescriptorSha256:state.pins.descriptor.sha256,outputDirectory:join(state.root,'installation'),npmCliPath:npm.path,npmTimeoutMs:120000});
  const readback=await verifyInstalled(state,{installationManifestSha256:result.installationManifestSha256,runtimeManifestSha256:result.runtimeManifestSha256},execution);
  await finalStates([npm.read]);
  await writePrivate(join(state.root,'installation-state.json'),readback.proof);
  await writeReceipt(state,'installation-readback.json',{classification:'FRESH_THIN_COMPLETE_INDEPENDENT_READBACK',status:'PASS',
   ...readback.proof,officialNpmEntrySha256:sha(npm.read.bytes),npmTimeoutMs:120000,modelRequestsEnabled:false,
   publicReleaseQualified:false,sandboxEnforcementClaimed:false});
 }finally{execution.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let state;try{state=await loadState(process.argv[2]);await installFresh(state);}
 catch(cause){if(state)await writeReceipt(state,'installation-failure.json',{classification:'FRESH_THIN_INSTALLATION_FAILURE',status:'FAIL',
  errorCategory:redactError(cause),npmStopUnknown:cause?.code==='SDK_INSTALL_STOP_UNKNOWN',automaticRecursiveDeletion:false});
  const diagnostic=JSON.stringify({errorCategory:redactError(cause)})+'\n';
  if(cause?.code==='SDK_INSTALL_STOP_UNKNOWN'){
   // Retain the uncertain writer/output; bound only this failing parent, as the reviewed CLI does.
   const deadline=setTimeout(()=>process.exit(1),100);
   process.stderr.write(diagnostic,()=>{clearTimeout(deadline);process.exit(1);});
  }else{process.stderr.write(diagnostic);process.exitCode=1;}}
}
