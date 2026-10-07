import fs from 'node:fs';
import {createBuiltinObservationWriter} from './observer.mjs';
import {createDualNativeGuard} from './dual-guard.mjs';
import {installOfflineModelStop} from './model-stop.mjs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import child from 'node:child_process';
import worker from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {dirname,join,resolve as resolvePath,isAbsolute} from 'node:path';
import {createNativeAttemptRecorder} from './identity.mjs';
import {captureImmediateExit,createNativeAdmissionStop} from './stop.mjs';
import {fileURLToPath} from 'node:url';
import {fixedFile,assertSDKInventory,assertInstalledProduct} from './installed-identity.mjs';

const checkpoint=globalThis.__immediateBuiltinCheckpoint??(()=>{});
checkpoint('C_EXIT_CAPTURE');
const exitImmediately=captureImmediateExit(process);
const root=dirname(fileURLToPath(import.meta.url));
const {source,pins,installed}=JSON.parse(fs.readFileSync(join(root,'binding-config.json'),'utf8'));
const target=source+'/node_modules/'+pins.bindings[0].packageRelativeSDKFile;
const sha=pins.bindings[0].sha256;
const traceFile=join(root,'safe-runtime-trace.json');
const mode=new URL(import.meta.url).search;
const caseName=mode.slice(1);
const guardOnly=caseName==='builtin-dual';
const require=createRequire(import.meta.url);
let guardPreflightReady=false;
const now=()=>new Date().toISOString();
const state={pid:process.pid,startUTC:now(),endUTC:null,stage:'COMPANION_STARTED',setupReady:false,explicitApprovedAddonFlag:process.execArgv.includes('--allow-addons')&&process.execArgv.includes('--permission'),environmentRestricted:false,sqliteGuardVerified:false,resolveCalls:0,resolveCompleted:false,resolveStartUTC:null,resolveEndUTC:null,resolveAgentPresent:null,outerErrorCode:'UNRECORDED',nativeLoadAttempts:0,nativeLoads:0,nativeAttempts:[],nativeCalls:0,nativeCallStartUTC:null,nativeCallEndUTC:null,nativeCallbackErrno:null,nativeReturnCategory:'UNRECORDED',nativeFdOwned:false,nativeFdIdentity:null,nativeFdClosedBeforeExit:null,networkAttempts:0,spawnAttempts:0,workerAttempts:0,sqliteConstructAttempts:0,modelAttempts:null,boundaryRefusals:[],setupFailureCode:'NONE',targetSHA256:sha,systemLoads:0,narbLoads:0,narbInfoQueries:0,narbRequireCalls:0,narbCalls:[],terminalRefusalCategory:null};
state.installedIdentity=null;
state.preflightBoundary={status:'NOT_CHECKED',caseRecognized:null,permissionReady:null,environmentRestricted:null,platformMatches:null,architectureMatches:null};
let nativeFd;
const atomicSave=createBuiltinObservationWriter(fs,root,'TRACE',process.pid,caseName);
const save=()=>{try{atomicSave(state);}catch{exitImmediately(75);throw Error('OBSERVATION_COMMIT_REFUSED');}};
const refused=category=>{
 state.terminalRefusalCategory??=category;return nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');
};
const safeCodes=new Set(['gateway/internal','ERR_ACCESS_DENIED','ERR_DLOPEN_DISABLED','ERR_DLOPEN_FAILED','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_ASSERTION','ERR_TEST_FAILURE','SQLITE_GUARD_BINDING_REFUSED','SQLITE_GUARD_INSTALL_REFUSED','SQLITE_CONSTRUCTION_REFUSED']);
const fixedCode=error=>safeCodes.has(error?.code)?error.code:'UNRECORDED';
checkpoint('C_INITIAL_TRACE_COMMIT');save();
const observeCounts=()=>{
 try{const count=globalThis.__offlineIO?.model;state.modelAttempts=Number.isInteger(count)&&count>=0&&count<=64?count:null;}
 catch{state.modelAttempts=null;}
 if(nativeFd!==undefined){
  try{const current=fs.fstatSync(nativeFd);state.nativeFdClosedBeforeExit=current.dev!==state.nativeFdIdentity.device||current.ino!==state.nativeFdIdentity.inode;}
  catch(error){state.nativeFdClosedBeforeExit=error?.code==='EBADF';}
 }
};
const nativeStop=createNativeAdmissionStop({state,stamp:now,observeCounts,commit:atomicSave,exitImmediately});
const verifyInstalled=phase=>{
 try{
  const file=fixedFile(join(installed.current,'installation-record.json'),1024*1024);
  if(file.sha256!==installed.recordSHA256)refused('INSTALLED_CONTENT_IDENTITY_REFUSED');
  const record=JSON.parse(file.bytes),sdk=fixedFile(join(installed.current,record.sdkManifest),8*1024*1024);
  if(record.sourceHead!==installed.head||record.sourceTree!==installed.tree||record.packageSHA256!==installed.packageSHA256||sdk.sha256!==installed.sdkManifestSHA256||record.sdkManifestSHA256!==sdk.sha256)refused('INSTALLED_CONTENT_IDENTITY_REFUSED');
  assertSDKInventory(source,JSON.parse(sdk.bytes));
  assertInstalledProduct(join(installed.current,'product'),{...record,files:[...record.files,...record.testFiles]});
  if(!fs.lstatSync(join(installed.current,'product/node_modules')).isSymbolicLink()||fs.realpathSync(join(installed.current,'product/node_modules'))!==source+'/node_modules')refused('INSTALLED_CONTENT_IDENTITY_REFUSED');
  if(phase==='after'&&state.installedIdentity?.checkedBefore!==true)refused('INSTALLED_CONTENT_IDENTITY_REFUSED');
  state.installedIdentity={sdkManifestSHA256:sdk.sha256,packageSHA256:record.packageSHA256,sourceHead:record.sourceHead,sourceTree:record.sourceTree,checkedBefore:true,checkedAfter:phase==='after'};
 }catch{if(nativeStop.isStopped())nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');refused('INSTALLED_CONTENT_IDENTITY_REFUSED');}
};
const finalize=()=>{
 if(nativeStop.isStopped())return;
 if(!guardOnly)verifyInstalled('after');
 state.endUTC=now();state.stage=state.setupReady?'PROCESS_EXIT':guardPreflightReady?'GUARD_PREFLIGHT_COMPLETE':'SETUP_FAILED_EXIT';
 observeCounts();save();
};
process.on('exit',()=>{try{finalize();}catch{/* Missing final trace remains UNKNOWN in the parent. */}});
try{
 checkpoint('C_BOUNDARY_PREFLIGHT');
 const allowed=new Set(['DSH_HOME','DSH_BOT_TEST_ROOT','TMPDIR','TZ','LANG','NODE_TEST_CONTEXT']);
 state.environmentRestricted=Object.keys(process.env).every(key=>allowed.has(key));
 const permissionReady=guardOnly?process.execArgv.includes('--permission')&&!process.execArgv.includes('--allow-addons'):state.explicitApprovedAddonFlag;
 state.preflightBoundary={status:'CHECKED',caseRecognized:['builtin-dual','cold1','cold2'].includes(caseName),permissionReady,
  environmentRestricted:state.environmentRestricted,platformMatches:process.platform===pins.platform,architectureMatches:process.arch===pins.arch};
 save();
 if(!state.preflightBoundary.caseRecognized)refused('PREFLIGHT_BOUNDARY_REFUSED');
 if(!permissionReady||!state.environmentRestricted||process.platform!==pins.platform||process.arch!==pins.arch)refused('PREFLIGHT_BOUNDARY_REFUSED');
 if(!guardOnly)verifyInstalled('before');
 process.report.excludeEnv=true;

 const originalDlopen=process.dlopen;
 const identityReader=createNativeAttemptRecorder({fs,path:{resolve:resolvePath,isAbsolute},source,root,target,targetSHA:sha,inventory:pins.bindings,state,guardOnly,allocate:n=>Buffer.alloc(n),hashBytes:bytes=>createHash('sha256').update(bytes).digest('hex'),save,refuse:refused,abort:exitImmediately,terminateAdmission:nativeStop.stop});
 const narb=pins.bindings[1];
 const cachePath=join(root,'node-addon-native-custom-loader-'+process.getuid(),'native-cache',narb.package,narb.version,pins.cacheSuffix,narb.path.split('/').at(-1));
 const nativeRecorder=createDualNativeGuard({state,identify:identityReader.identify,source,root,cachePath,guardOnly,save,stop:nativeStop.stop,pins});
 checkpoint('C_DLOPEN_GUARD_INSTALL');
 Object.defineProperty(process,'dlopen',{configurable:false,writable:false,value:function(module,filename,...remaining){
  return nativeRecorder.load(module,filename,()=>Reflect.apply(originalDlopen,this,[module,filename,...remaining]),()=>{
  const binding=module.exports;
  if(typeof binding.tryLock!=='function'||Object.keys(binding).some(key=>key!=='tryLock'))refused('NATIVE_EXPORT_SURFACE_REFUSED');
  const originalLock=binding.tryLock;
  Object.defineProperty(binding,'tryLock',{configurable:false,writable:false,value:function(fd,callback){
   if(nativeStop.isStopped())return nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');
   try{
   if(state.nativeCalls!==0)refused('NATIVE_CALL_LIMIT_REFUSED');
   if(!Number.isSafeInteger(fd)||fd<0||fd>0x7fffffff||typeof callback!=='function')refused('NATIVE_ARGUMENT_REFUSED');
   const identity=fs.fstatSync(fd);
   let matches=false,inspected=0;
   const walk=directory=>{
    for(const name of fs.readdirSync(directory)){
     if(++inspected>128)refused('TEMP_FILE_INVENTORY_LIMIT_REFUSED');
     const path=join(directory,name),entry=fs.lstatSync(path);
     if(entry.isSymbolicLink())refused('TEMP_SYMLINK_REFUSED');
     if(entry.isDirectory())walk(path);
     else if(entry.isFile()&&entry.dev===identity.dev&&entry.ino===identity.ino)matches=true;
    }
   };
   walk(root);
   if(!identity.isFile()||!matches)refused('NON_SYNTHETIC_FD_REFUSED');
   state.nativeFdOwned=true;state.nativeFdIdentity={device:identity.dev,inode:identity.ino};nativeFd=fd;
   state.nativeCalls=1;state.nativeCallStartUTC=now();state.stage='ONE_NATIVE_LOCK_STARTED';save();
   return Reflect.apply(originalLock,binding,[fd,errno=>{
    if(nativeStop.isStopped())return nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');
    try{
    state.nativeCallEndUTC=now();state.nativeCallbackErrno=Number.isInteger(errno)?errno:null;state.nativeReturnCategory=errno===0?'LOCK_ACQUIRED':'SYSCALL_ERROR';save();
    if(errno!==0)refused('NATIVE_LOCK_RESULT_REFUSED');
    return callback(errno);
    }catch{if(nativeStop.isStopped())return nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');return refused('NATIVE_LOCK_CALLBACK_REFUSED');}
   }]);
   }catch{if(nativeStop.isStopped())return nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');return refused('NATIVE_LOCK_BOUNDARY_REFUSED');}
  }});
  });
 }});

 // Patch CJS before the first SQLite ESM facade. Public ESM synchronization
 // excludes scheme-only builtins; an already-created facade must be refused.
 checkpoint('C_SQLITE_CJS_IMPORT');
 const sqlite=require('node:sqlite');
 const descriptor=Object.getOwnPropertyDescriptor(sqlite,'DatabaseSync');
 checkpoint('C_SQLITE_DESCRIPTOR_REQUIRED');
 if(!descriptor||typeof descriptor.value!=='function'||(!descriptor.writable&&!descriptor.configurable))refused('SQLITE_GUARD_INSTALL_REFUSED');
 checkpoint('C_SQLITE_DENY_BINDING_INSTALL');
 function DatabaseDenied(){state.sqliteConstructAttempts++;return refused('SQLITE_CONSTRUCTION_REFUSED');}
 Object.defineProperty(DatabaseDenied,'guardKind',{value:'DSH_SQLITE_DENY_STUB',writable:false,configurable:false});
 Object.defineProperty(sqlite,'DatabaseSync',{value:DatabaseDenied,writable:false,configurable:false});
 checkpoint('C_IO_GUARDS_INSTALL');
 const networkDenied=()=>{state.networkAttempts++;return refused('NETWORK_OPERATION_REFUSED');};
 // DNS/c-ares does not pass through the JS net/dgram entry points below.
 // Patch both facades and inherited Resolver methods before SDK imports.
 try{
  for(const object of [dns,dnsPromises]){
   const Resolver=object.Resolver;
   if(typeof Resolver!=='function')refused('DNS_GUARD_INSTALL_REFUSED');
   for(let proto=Resolver.prototype;proto&&proto!==Object.prototype;proto=Object.getPrototypeOf(proto)){
    for(const name of Object.getOwnPropertyNames(proto))if(name!=='constructor'&&typeof Object.getOwnPropertyDescriptor(proto,name)?.value==='function')Object.defineProperty(proto,name,{value:networkDenied,configurable:false,writable:false});
   }
   for(const name of Object.keys(object))if(name!=='Resolver'&&typeof object[name]==='function')Object.defineProperty(object,name,{value:networkDenied,configurable:false,writable:false});
   Object.defineProperty(object,'Resolver',{value:new Proxy(Resolver,{construct:networkDenied}),configurable:false,writable:false});
  }
 }catch{if(nativeStop.isStopped())nativeStop.stop('OTHER_ADDON_LOAD_REFUSED');refused('DNS_GUARD_INSTALL_REFUSED');}
 globalThis.fetch=networkDenied;
 for(const [object,names] of [[net,['connect','createConnection','createServer']],[http,['request','get','createServer']],[https,['request','get','createServer']],[tls,['connect','createServer']],[dgram,['createSocket']],[http2,['connect','createServer','createSecureServer']]])for(const name of names)object[name]=networkDenied;
 net.Socket.prototype.connect=networkDenied;net.Server.prototype.listen=networkDenied;dgram.Socket.prototype.send=networkDenied;dgram.Socket.prototype.connect=networkDenied;
 for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=()=>{state.spawnAttempts++;return refused('CHILD_PROCESS_REFUSED');};
 const OriginalWorker=worker.Worker;
 worker.Worker=new Proxy(OriginalWorker,{construct(){state.workerAttempts++;return refused('WORKER_REFUSED');}});
 checkpoint('C_BUILTIN_EXPORT_SYNC');
 syncBuiltinESMExports();
 const dnsNamespace=await import('node:dns'),dnsPromiseNamespace=await import('node:dns/promises');
 for(const [object,namespace] of [[dns,dnsNamespace],[dnsPromises,dnsPromiseNamespace]])for(const name of Object.keys(object))if(typeof object[name]==='function'&&(namespace[name]!==object[name]||namespace.default[name]!==object[name]))refused('DNS_GUARD_BINDING_REFUSED');
 checkpoint('C_SQLITE_ESM_IMPORT');
 const namespace=await import('node:sqlite');
 state.sqliteGuardVerified=namespace.DatabaseSync===DatabaseDenied&&namespace.default.DatabaseSync===DatabaseDenied&&require('node:sqlite').DatabaseSync===DatabaseDenied&&DatabaseDenied.prototype.constructor===DatabaseDenied;
 checkpoint('C_SQLITE_BINDING_IDENTITY_REQUIRED');
 if(!state.sqliteGuardVerified)refused('SQLITE_GUARD_BINDING_REFUSED');

 if(!guardOnly){
 installOfflineModelStop({target:globalThis,state,save,stop:refused});
 const {default:Controller}=await import(source+'/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js');
 const originalResolve=Controller.prototype.resolveAgent;
 if(typeof originalResolve!=='function')refused('RESOLVE_GUARD_BINDING_REFUSED');
 Object.defineProperty(Controller.prototype,'resolveAgent',{configurable:false,writable:false,value:async function(...args){
  if(state.resolveCalls!==0)refused('RESOLVE_CALL_LIMIT_REFUSED');
  state.resolveCalls=1;state.resolveStartUTC=now();state.stage='ONE_EXISTING_RESOLVE_STARTED';save();
  try{
   const result=await Reflect.apply(originalResolve,this,args);
   state.resolveCompleted=true;state.resolveAgentPresent=Boolean(result&&'agent'in result);state.outerErrorCode=fixedCode(result?.error);return result;
  }finally{state.resolveEndUTC=now();save();}
 }});
 state.setupReady=true;state.stage='READY_FOR_ONE_ORIGINAL_TEST';save();
 }else{checkpoint('C_GUARD_READY_TRACE_COMMIT');guardPreflightReady=true;state.stage='GUARD_PREFLIGHT_COMPLETE';save();}
}catch(error){
 state.setupReady=false;guardPreflightReady=false;state.setupFailureCode=fixedCode(error);state.stage='COMPANION_SETUP_FAILED';
 try{finalize();}catch{/* Do not manufacture a successful or zero-count trace after a failed write. */}
 throw error;
}
