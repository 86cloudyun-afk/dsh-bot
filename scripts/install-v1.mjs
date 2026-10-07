/** Caller-pinned thin installer. Fetches public SDK bytes into a fresh private installation. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const CLI_VERSION='0.2.0-rc.2',ownErrors=new WeakSet();
const fail=code=>{const cause=Object.assign(new Error(code),{code});ownErrors.add(cause);return cause;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const prohibited=path=>path.split(/[\\/]/).some(part=>['.git','.env','.aws','.ssh','.codex','.agents','.npmrc','Home','credentials','credentials.json','auth.json'].includes(part)||part.startsWith('.env.'));
const safe=path=>typeof path==='string'&&path!==''&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(part=>part===''||part==='.'||part==='..'||part==='node_modules')&&!prohibited(path);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const parseJson=bytes=>{try{return JSON.parse(bytes.toString('utf8'));}catch{throw fail('THIN_ARTIFACT_JSON_INVALID');}};
const tools=Object.freeze({installer:'scripts/install-v1.mjs',consumer:'scripts/assemble-distribution-runtime.mjs',guiInstaller:'scripts/install-bot-gui-profile.mjs',packageSnapshot:'scripts/package-snapshot.mjs',runtimeExporter:'tools/runtime-export/export.mjs'});
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

export async function installV1(options){
 if(!digest(options.expectedDescriptorSha256))throw fail('TRUSTED_DESCRIPTOR_PIN_REQUIRED');
 const timeout=options.npmTimeoutMs??120000;if(!Number.isInteger(timeout)||timeout<1000||timeout>300000)throw fail('NPM_TIMEOUT_INVALID');
 await canonical(options.bundleDirectory,true);
 if(!inside(options.bundleDirectory,options.descriptorPath)||!safe(relative(options.bundleDirectory,options.descriptorPath)))throw fail('THIN_DESCRIPTOR_PATH_INVALID');
 const{bytes:descriptorBytes}=await readSafe(options.descriptorPath);if(sha(descriptorBytes)!==options.expectedDescriptorSha256)throw fail('THIN_DESCRIPTOR_HASH_MISMATCH');
 const descriptor=parseJson(descriptorBytes),selection=validateDescriptor(descriptor),output=options.outputDirectory;
 if(typeof output!=='string'||!isAbsolute(output)||resolve(output)!==output||output.includes('\0'))throw fail('CANONICAL_OUTPUT_REQUIRED');
 await canonical(dirname(output),true);await canonical(options.npmCliPath);
 if([options.bundleDirectory,options.npmCliPath].some(path=>inside(path,output)||inside(output,path)))throw fail('EXCLUSIVE_OUTPUT_OUTSIDE_INPUTS_REQUIRED');
 try{await fs.lstat(output);throw fail('OUTPUT_ALREADY_EXISTS');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
 for(const file of selection.selected)await readSafe(join(options.bundleDirectory,file.path),file);
 const{bytes:npmCliBytes}=await readSafe(options.npmCliPath);
 let claimed,created=false;
 const checkOwnership=async()=>{const stat=await fs.lstat(output);if(!claimed||!stat.isDirectory()||stat.isSymbolicLink()||stat.ino!==claimed.ino||stat.dev!==claimed.dev||await fs.realpath(output)!==output)throw fail('OUTPUT_OWNERSHIP_CHANGED');};
 try{
  try{await fs.mkdir(output,{mode:0o700});}catch(cause){if(cause.code==='EEXIST')throw fail('OUTPUT_ALREADY_EXISTS');throw cause;}created=true;claimed=await fs.lstat(output);await checkOwnership();
  const materials=join(output,'materials');await fs.mkdir(materials,{mode:0o700});
  for(const file of selection.selected){const{bytes}=await readSafe(join(options.bundleDirectory,file.path),file);await checkOwnership();await writeRecord(materials,file,bytes);}
  const finalDescriptor=await readSafe(options.descriptorPath);if(sha(finalDescriptor.bytes)!==options.expectedDescriptorSha256)throw fail('THIN_INPUT_CHANGED');
  if(sha((await readSafe(options.npmCliPath)).bytes)!==sha(npmCliBytes))throw fail('THIN_INPUT_CHANGED');
  await checkOwnership();
  throw fail('THIN_INSTALL_NOT_READY');
 }catch(cause){
  if(created&&!claimed)cause.cleanupErrorCategory='OUTPUT_OWNERSHIP_UNAVAILABLE';
  if(claimed)try{await checkOwnership();await fs.rm(output,{recursive:true,force:true});}catch(cleanup){if(cleanup.code!=='ENOENT')cause.cleanupErrorCategory=cleanup.code==='OUTPUT_OWNERSHIP_CHANGED'?cleanup.code:'CLEANUP_FAILED';}
  throw cause;
 }
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
 catch(cause){const io=new Set(['ENOENT','EACCES','EPERM','EEXIST','ENOTDIR','EIO','ENOMEM','ELOOP','ERR_ACCESS_DENIED']);const errorCategory=ownErrors.has(cause)?cause.code:io.has(cause?.code)?'THIN_IO_FAILED':'THIN_INSTALL_FAILED';const cleanupErrorCategory=cause?.cleanupErrorCategory===undefined?undefined:['OUTPUT_OWNERSHIP_UNAVAILABLE','OUTPUT_OWNERSHIP_CHANGED','CLEANUP_FAILED'].includes(cause.cleanupErrorCategory)?cause.cleanupErrorCategory:'CLEANUP_FAILED';process.stderr.write(JSON.stringify({errorCategory,cleanupErrorCategory})+'\n');process.exitCode=1;}
}
