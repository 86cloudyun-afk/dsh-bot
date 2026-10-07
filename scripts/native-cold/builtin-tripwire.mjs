import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBuiltinObservationWriter} from './observer.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const exit=process.reallyExit,apply=Reflect.apply;
const ids=new Set(['T_EXIT_CAPABILITY_REQUIRED','T_SYNTHETIC_LOADER_INSTALL','C_EXIT_CAPTURE','C_INITIAL_TRACE_COMMIT','C_BOUNDARY_PREFLIGHT','C_DLOPEN_GUARD_INSTALL','C_SQLITE_CJS_IMPORT','C_SQLITE_DESCRIPTOR_REQUIRED','C_SQLITE_DENY_BINDING_INSTALL','C_IO_GUARDS_INSTALL','C_BUILTIN_EXPORT_SYNC','C_SQLITE_ESM_IMPORT','C_SQLITE_BINDING_IDENTITY_REQUIRED','C_GUARD_READY_TRACE_COMMIT','H_PROGRESS_WRITE','H_EXIT_LISTENER_INSTALL','H_PUBLIC_EXIT_POISON','H_FIRST_DENIED_DLOPEN','H_CALLER_CATCH_REACHED','H_SECOND_LOAD_ATTEMPT','H_FALLBACK_RETURNED']);
const fixedCodes=new Set(['ERR_ASSERTION','ERR_ACCESS_DENIED','ERR_DLOPEN_DISABLED','ERR_DLOPEN_FAILED','SQLITE_GUARD_BINDING_REFUSED','SQLITE_GUARD_INSTALL_REFUSED','IMMEDIATE_NATIVE_EXIT_UNAVAILABLE']);
createBuiltinObservationWriter(fs,root,'TARGET',process.pid,'builtin-dual')({pid:process.pid,version:process.version,case:'builtin-dual',targetId:'CATCH_FALLBACK_IMMEDIATE_STOP'});
const commit=createBuiltinObservationWriter(fs,root,'ASSERTION',process.pid,'builtin-dual');
const label={pid:process.pid,case:'builtin-dual',assertionId:'T_EXIT_CAPABILITY_REQUIRED',status:'IN_PROGRESS',errorCode:'UNRECORDED'};
commit(label);
Object.defineProperty(globalThis,'__immediateBuiltinCheckpoint',{configurable:false,writable:false,value:id=>{
 if(!ids.has(id))throw Error('BUILTIN_ASSERTION_ID_REFUSED');
 if(label.status==='UNCAUGHT_FAILURE')return;
 label.assertionId=id;commit(label);
}});
process.on('uncaughtExceptionMonitor',error=>{
 if(label.status==='UNCAUGHT_FAILURE')return;
 label.status='UNCAUGHT_FAILURE';label.errorCode=fixedCodes.has(error?.code)?error.code:'UNRECORDED';
 try{commit(label);}catch{/* Missing label remains UNKNOWN; never replace or handle the original error. */}
});
if(typeof exit!=='function')throw Error('IMMEDIATE_NATIVE_EXIT_UNAVAILABLE');
globalThis.__immediateBuiltinCheckpoint('T_SYNTHETIC_LOADER_INSTALL');
// Discard the real native loader before any companion/harness import.
Object.defineProperty(process,'dlopen',{configurable:true,writable:true,value:function(){
 fs.writeFileSync(join(root,'original-loader-tripwire.json'),JSON.stringify({pid:process.pid,called:true})+'\n');
 apply(exit,process,[99]);
}});
