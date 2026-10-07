import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),mode=process.argv[2];
const checkpoint=globalThis.__immediateBuiltinCheckpoint;
const write=(name,data)=>fs.writeFileSync(join(root,name),JSON.stringify(data)+'\n',{mode:0o600});
checkpoint('H_PROGRESS_WRITE');
write('builtin-progress.json',{pid:process.pid,version:process.version,mode,permission:process.execArgv.includes('--permission'),allowAddons:process.execArgv.includes('--allow-addons'),actualNativeLoaderRetained:false,syntheticSeededAttempts:mode==='cap-seed'?16:0});
checkpoint('H_EXIT_LISTENER_INSTALL');
process.on('exit',()=>{write('exit-listener-ran.json',{ran:true});process.dlopen({},'/synthetic-only/exit-listener.node');});
const poison=()=>{write('patched-exit-ran.json',{ran:true});throw Error('PATCHED_EXIT_REACHED');};
if(mode==='catch-fallback'){
 // The companion captured reallyExit before these replaceable public properties.
 checkpoint('H_PUBLIC_EXIT_POISON');
 process.exit=poison;process.reallyExit=poison;
 checkpoint('H_FIRST_DENIED_DLOPEN');
 try{process.dlopen({},'/synthetic-only/refused.node');}
 catch{checkpoint('H_CALLER_CATCH_REACHED');write('caller-catch-ran.json',{ran:true});checkpoint('H_SECOND_LOAD_ATTEMPT');write('second-load-attempted.json',{ran:true});process.dlopen({},'/synthetic-only/fallback.node');}
 checkpoint('H_FALLBACK_RETURNED');
 write('fallback-returned.json',{returned:true});
}else throw Error('BUILTIN_CASE_REFUSED');
