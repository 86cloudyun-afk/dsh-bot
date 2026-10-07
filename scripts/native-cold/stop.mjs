// No imports, launches or ambient IO. Companion injects captured builtin APIs.
export const NATIVE_ADMISSION_EXIT=74;
export const NATIVE_CAPACITY_EXIT=73;
export const NATIVE_TERMINAL_COMMIT_FAILURE_EXIT=75;
const REASONS=new Set(['OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED','ADDON_ATTEMPT_RECORD_LIMIT_REFUSED']);

// Pin-specific builtin capability: reallyExit bypasses user exit listeners.
// The caller must prove this capability with a builtin-only child before SDK use.
export function captureImmediateExit(runtime){
 const captured=runtime.reallyExit,apply=Reflect.apply;
 if(typeof captured!=='function')throw Object.assign(new Error('IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'),{code:'IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'});
 return code=>apply(captured,runtime,[code]);
}

export function createNativeAdmissionStop({state,stamp,observeCounts,commit,exitImmediately}){
 if(typeof exitImmediately!=='function')throw Object.assign(new Error('IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'),{code:'IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'});
 let stopped=false,exitCode=NATIVE_TERMINAL_COMMIT_FAILURE_EXIT;
 function stop(reason){
  if(!stopped){
   stopped=true; // Set before any save/count callback can reenter the recorder.
   try{
    if(!REASONS.has(reason))throw Error('NATIVE_REASON_REFUSED');
    state.stage='NATIVE_ADMISSION_REFUSED';state.setupReady=false;state.endUTC=stamp();
    state.boundaryRefusals.push(reason);observeCounts();commit(state);
    exitCode=reason==='ADDON_ATTEMPT_RECORD_LIMIT_REFUSED'?NATIVE_CAPACITY_EXIT:NATIVE_ADMISSION_EXIT;
   }catch{exitCode=NATIVE_TERMINAL_COMMIT_FAILURE_EXIT;}
  }
  exitImmediately(exitCode);
  // Only injected fake exits may return. Actual captured reallyExit never does.
  throw Object.assign(new Error('IMMEDIATE_NATIVE_EXIT_RETURNED'),{code:'IMMEDIATE_NATIVE_EXIT_RETURNED'});
 }
 return Object.freeze({stop,isStopped:()=>stopped});
}
