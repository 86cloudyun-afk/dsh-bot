/** CI-only checks. No SDK is imported by this module. Outputs are exclusive. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {spawn} from 'node:child_process';

export const HERE=dirname(fileURLToPath(import.meta.url));
export const TOOL_PATHS=Object.freeze({installer:'scripts/install-v1.mjs',consumer:'scripts/assemble-distribution-runtime.mjs',
 guiInstaller:'scripts/install-bot-gui-profile.mjs',packageSnapshot:'scripts/package-snapshot.mjs',runtimeExporter:'tools/runtime-export/export.mjs'});
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ownErrors=new WeakSet(),safeExternalCodes=new Set(['ENOENT','EEXIST','EACCES','EPERM','ELOOP','ENOTDIR','EIO','ENOMEM',
 'MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_ACCESS_DENIED','SDK_INSTALL_STOP_UNKNOWN','SDK_INSTALL_TIMEOUT',
 'SDK_INSTALL_FAILED','SDK_INSTALL_SPAWN_FAILED','THIN_INSTALL_FAILED','PUBLIC_TOOL_STOP_UNKNOWN','PUBLIC_TOOL_TIMEOUT','PUBLIC_TOOL_FAILED','PUBLIC_TOOL_SPAWN_FAILED']);
export function requireThat(value,code){if(!value){const error=Object.assign(Error(code),{code});ownErrors.add(error);throw error;}}
export function redactError(cause){return (ownErrors.has(cause)||safeExternalCodes.has(cause?.code))
 &&typeof cause?.code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(cause.code)?cause.code:'FIRST_INSTALL_STAGE_REFUSED';}
export function assertRedacted(value){
 const forbidden=new Set(['home','cwd','path','directory','env','credentials','cookies','cookie','token','authUrl','rawLogs','stack','stdout','stderr']);
 const walk=v=>{
  requireThat(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'||typeof v==='object','RECEIPT_REDACTION_REQUIRED');
  if(typeof v==='string')requireThat(v.length<=512&&!/^(?:\/|[A-Za-z]:[\\/])|https?:\/\/|[?&]token=/i.test(v),'RECEIPT_REDACTION_REQUIRED');
  else if(typeof v==='number')requireThat(Number.isFinite(v),'RECEIPT_REDACTION_REQUIRED');
  else if(v&&typeof v==='object')for(const[k,item]of Object.entries(v)){
   requireThat(!forbidden.has(k)&&!/api.?key|password|secret/i.test(k),'RECEIPT_REDACTION_REQUIRED');walk(item);
  }
 };walk(value);
}
export function cleanEnvironment(state,kind='browser'){
 requireThat(['browser','server'].includes(kind),'ENVIRONMENT_KIND_REFUSED');
 const home=join(state.root,kind+'-home'),temp=join(state.root,kind+'-tmp');
 return {PATH:[dirname(state.nodeExecutable),'/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),HOME:home,TMPDIR:temp,
  XDG_CONFIG_HOME:join(home,'config'),XDG_CACHE_HOME:join(home,'cache'),LANG:'en_US.UTF-8',TZ:'UTC'};
}
const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink,s.uid].map(String).join(':');
export async function privateDirectory(path){
 requireThat(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'PRIVATE_DIRECTORY_REQUIRED');
 const before=await fs.lstat(path,{bigint:true});
 requireThat(before.isDirectory()&&(before.mode&0o7777n)===0o700n&&before.uid===BigInt(process.getuid()),'PRIVATE_DIRECTORY_REQUIRED');
 requireThat(await fs.realpath(path)===path,'PRIVATE_DIRECTORY_REQUIRED');
 const after=await fs.lstat(path,{bigint:true});
 requireThat(after.isDirectory()&&before.dev===after.dev&&before.ino===after.ino&&after.mode===before.mode&&after.uid===before.uid,'PRIVATE_DIRECTORY_REQUIRED');
 return after;
}
export async function safeRead(path,expected,{maxBytes=256*1024*1024}={}){
 requireThat(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=512*1024*1024,'REGULAR_FILE_SIZE_LIMIT_REFUSED');
 requireThat(isAbsolute(path)&&resolve(path)===path&&await fs.realpath(path)===path,'CANONICAL_REGULAR_REQUIRED');
 const before=await fs.lstat(path,{bigint:true});
 requireThat(before.isFile()&&before.nlink===1n&&before.size<=BigInt(maxBytes)&&!(before.mode&0o7000n),'CANONICAL_REGULAR_REQUIRED');
 const file=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  requireThat(fingerprint(before)===fingerprint(await file.stat({bigint:true})),'INPUT_CHANGED');
  const bytes=await file.readFile();
  requireThat(BigInt(bytes.length)===before.size&&fingerprint(before)===fingerprint(await file.stat({bigint:true}))
   &&fingerprint(before)===fingerprint(await fs.lstat(path,{bigint:true}))&&await fs.realpath(path)===path,'INPUT_CHANGED');
  const mode=Number(before.mode&0o777n);
  if(expected)requireThat(bytes.length===expected.bytes&&sha(bytes)===expected.sha256&&mode===expected.mode,'EXACT_FILE_PIN_REFUSED');
  return {bytes,mode,state:fingerprint(before),path};
 }finally{await file.close();}
}
export async function finalStates(records){
 for(const record of records)requireThat(fingerprint(await fs.lstat(record.path,{bigint:true}))===record.state
  &&await fs.realpath(record.path)===record.path,'INPUT_CHANGED');
}
export async function writePrivate(path,value){
 await privateDirectory(dirname(path));
 const file=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await file.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');await file.sync();}
 finally{await file.close();}
}
export async function writeReceipt(state,name,body){
 requireThat(/^[a-z0-9-]+\.json$/.test(name),'RECEIPT_NAME_REFUSED');
 const value={format:1,target:state.target,failedOutputsAutomaticallyRemoved:false,...body};assertRedacted(value);
 await writePrivate(join(state.root,'receipts',name),value);
}
export async function loadState(root){
 process.umask(0o077);await privateDirectory(root);
 const stateFile=await safeRead(join(root,'state.json')),state=JSON.parse(stateFile.bytes);
 const pinFile=await safeRead(join(HERE,'INPUT_PINS.json')),pins=JSON.parse(pinFile.bytes);
 requireThat(state.format===1&&state.root===root&&state.pinsSha256===sha(pinFile.bytes)&&pins.frozen===true,'FIRST_INSTALL_INPUT_NOT_FROZEN');
 requireThat(state.target===process.platform+'-'+process.arch&&process.versions.node==='24.19.0','FIRST_INSTALL_ACTUAL_NODE_TARGET_REQUIRED');
 requireThat(state.bundleDirectory===join(root,'bundle')&&state.descriptorPath===join(root,'bundle',pins.descriptor.path),'FIRST_INSTALL_STATE_REFUSED');
 const nodeExecutable=await fs.realpath(process.execPath),node=await safeRead(nodeExecutable),expected=pins.node[state.target];
 requireThat(expected&&node.bytes.length===expected.bytes&&sha(node.bytes)===expected.sha256,'PUBLIC_NODE_BINARY_PIN_REFUSED');
 await privateDirectory(state.bundleDirectory);
 await finalStates([stateFile,pinFile,node]);
 return {...state,pins,nodeExecutable,nodeSha256:sha(node.bytes)};
}
export async function capturedTools(state){
 const descriptorFile=await safeRead(state.descriptorPath,state.pins.descriptor),descriptor=JSON.parse(descriptorFile.bytes);
 requireThat(JSON.stringify(descriptor.tools)===JSON.stringify(TOOL_PATHS),'THIN_TOOL_MAP_REFUSED');
 const records=new Map(descriptor.files.map(item=>[item.path,item])),captured=new Map(),reads=[descriptorFile];
 for(const relative of Object.values(TOOL_PATHS)){
  const path=join(state.bundleDirectory,relative),read=await safeRead(path,records.get(relative));
  requireThat(records.has(relative),'THIN_REQUIRED_TOOL_MISSING');captured.set(pathToFileURL(path).href,Buffer.from(read.bytes));reads.push(read);
 }
 await finalStates(reads);
 const hook=registerHooks({
  resolve(specifier,context,next){
   if(specifier.startsWith('node:'))return next(specifier,context);
   if(captured.has(context.parentURL)){
    const url=new URL(specifier,context.parentURL).href;requireThat(captured.has(url),'THIN_CAPTURED_IMPORT_REFUSED');return {url,shortCircuit:true};
   }
   if(captured.has(specifier))return {url:specifier,shortCircuit:true};
   return next(specifier,context);
  },
  load(url,context,next){return captured.has(url)?{format:'module',source:captured.get(url),shortCircuit:true}:next(url,context);}
 });
 return {descriptor,records,reads,importTool:key=>{requireThat(Object.hasOwn(TOOL_PATHS,key),'THIN_TOOL_NAME_REFUSED');return import(pathToFileURL(join(state.bundleDirectory,TOOL_PATHS[key])).href);},close:()=>hook.deregister()};
}
export async function publicNpmEntry(state){
 const path=await fs.realpath(join(dirname(state.nodeExecutable),'..','lib','node_modules','npm','bin','npm-cli.js'));
 const read=await safeRead(path);return {path,read};
}
export async function ensureFreshDirectory(path){await privateDirectory(dirname(path));await fs.mkdir(path,{mode:0o700});await privateDirectory(path);}

/** Original detached child only. No positive-PID fallback, replacement retry or output deletion. */
export async function runPublicNode(state,args,{cwd,env,timeoutMs}){
 await privateDirectory(cwd);requireThat(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=300000,'PUBLIC_TOOL_TIMEOUT_REFUSED');
 return new Promise((resolvePromise,reject)=>{
  let child,pid,exited=false,code,timedOut=false,finished=false,deadline,poll,grace,confirmation;
  const finish=error=>{if(finished)return;finished=true;for(const timer of[deadline,poll,grace,confirmation])clearTimeout(timer);
   if(error?.code==='PUBLIC_TOOL_STOP_UNKNOWN')child?.unref();
   error?reject(error):resolvePromise({state:'STOPPED',exitCode:code,timeoutMs});};
  const unknown=()=>finish(Object.assign(Error('PUBLIC_TOOL_STOP_UNKNOWN'),{code:'PUBLIC_TOOL_STOP_UNKNOWN'}));
  const group=()=>{if(!Number.isInteger(pid))return undefined;try{process.kill(-pid,0);return true;}catch(cause){return cause.code==='ESRCH'?false:undefined;}};
  const signal=which=>{if(finished||exited||child.exitCode!==null||child.signalCode!==null||child.pid!==pid||group()!==true)return;
   try{process.kill(-pid,which);}catch(cause){if(cause.code!=='ESRCH')unknown();}};
  const confirm=()=>{if(finished)return;const present=group();if(present===false&&exited){finish(timedOut||code!==0?Object.assign(Error('PUBLIC_TOOL_FAILED'),{code:timedOut?'PUBLIC_TOOL_TIMEOUT':'PUBLIC_TOOL_FAILED'}):undefined);return;}
   if(present===undefined){unknown();return;}poll=setTimeout(confirm,25);};
  const begin=()=>{if(confirmation)return;confirmation=setTimeout(unknown,1000);confirm();};
  try{child=spawn(state.nodeExecutable,args,{cwd,env,stdio:'ignore',detached:true});pid=child.pid;}
  catch{finish(Object.assign(Error('PUBLIC_TOOL_SPAWN_FAILED'),{code:'PUBLIC_TOOL_SPAWN_FAILED'}));return;}
  child.once('error',()=>{if(!Number.isInteger(pid))finish(Object.assign(Error('PUBLIC_TOOL_SPAWN_FAILED'),{code:'PUBLIC_TOOL_SPAWN_FAILED'}));else unknown();});
  child.once('exit',value=>{exited=true;code=value;begin();});
  deadline=setTimeout(()=>{timedOut=true;begin();signal('SIGTERM');grace=setTimeout(()=>signal('SIGKILL'),250);},timeoutMs);
 });
}
