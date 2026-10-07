// Parent CI preparation only: offline pack/install, public SDK hashes, no SDK execution.
import fs from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {preparePackageSnapshot} from '../prepare-package-snapshot.mjs';
import {installProductPackage} from '../package-snapshot.mjs';
import {makeSDKInventory,assertSDKInventory,assertInstalledProduct,fixedFile} from './installed-identity.mjs';
const source=resolve(import.meta.dirname,'../..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=x=>{if(!x)throw Error('NATIVE_CURRENT_PREPARATION_REFUSED');};
export async function prepareCurrent(current,expectedHead){
 need(/^[a-f0-9]{40}$/.test(expectedHead));current=resolve(current);
 need(await fs.realpath(dirname(current))===dirname(current)&&!current.startsWith(source+'/'));
 await fs.mkdir(current,{mode:0o700});
 const snapshot=await preparePackageSnapshot({productRoot:source,temporaryRoot:current});
 const manifest=JSON.parse(fixedFile(snapshot.manifestPath,1024*1024).bytes);
 need(manifest.sourceHead===expectedHead&&manifest.sourceWorktreeClean===true);
 const product=join(current,'product');
 const installed=await installProductPackage({directory:product,productRoot:source,packagePlacement:'snapshot',packageSnapshot:snapshot});
 const partition=JSON.parse(fixedFile(join(source,'scripts/native-cold/partition.json'),1024*1024).bytes);
 const testFiles=[];
 for(const path of [...partition.migrations.map(m=>m.to),...Object.keys(partition.supportFiles),'scripts/test-safety.mjs']){
  const bytes=fixedFile(join(source,path),1024*1024).bytes;
  if(partition.supportFiles[path])need(hash(bytes)===partition.supportFiles[path]);
  const destination=join(product,path);await fs.mkdir(dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});
  testFiles.push({path,bytes:bytes.length,sha256:hash(bytes),mode:0o600});
 }
 await fs.symlink(join(source,'node_modules'),join(product,'node_modules'));
 const sdk=makeSDKInventory(source),sdkBytes=Buffer.from(JSON.stringify(sdk)+'\n');
 await fs.writeFile(join(current,'sdk-manifest.json'),sdkBytes,{flag:'wx',mode:0o600});
 const record={schemaVersion:1,scope:'CURRENT_NATIVE_PRODUCT_AND_SDK',sourceHead:manifest.sourceHead,sourceTree:manifest.sourceTree,sourceWorktreeClean:true,
  productDirectory:'product',sdkManifest:'sdk-manifest.json',sdkManifestSHA256:hash(sdkBytes),lockSHA256:sdk.lockSHA256,
  packageSHA256:installed.packageSHA256,fileIndexSHA256:installed.fileIndexSHA256,buildId:installed.buildId,installationId:installed.installationId,
  buildManifest:relative(current,snapshot.manifestPath).split('\\').join('/'),buildManifestSHA256:snapshot.manifestSHA256,
  tarball:relative(current,join(dirname(snapshot.manifestPath),manifest.tarball)).split('\\').join('/'),files:manifest.files,testFiles,
  SDKOrigin:'LOCKED_PACKAGE_METADATA_AND_INSTALLED_CONTENT_MANIFEST',actualSDKNativeExecuted:false};
 assertSDKInventory(source,sdk);assertInstalledProduct(product,record);
 const handle=await fs.open(join(current,'installation-record.json'),'wx',0o600);
 try{await handle.writeFile(JSON.stringify(record)+'\n');await handle.sync();}finally{await handle.close();}
 const directory=await fs.open(current,'r');try{await directory.sync();}finally{await directory.close();}
 return {sourceHead:record.sourceHead,sourceTree:record.sourceTree,packageSHA256:record.packageSHA256,sdkManifestSHA256:record.sdkManifestSHA256,
  buildId:record.buildId,installationId:record.installationId,productFiles:record.files.length,sdkFiles:sdk.files.length,actualSDKNativeExecuted:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await prepareCurrent(process.argv[2],process.argv[3]))+'\n');}
 catch{process.stdout.write(JSON.stringify({status:'BLOCKED',category:'NATIVE_CURRENT_PREPARATION_REFUSED',actualSDKNativeExecuted:false})+'\n');process.exitCode=1;}
}
