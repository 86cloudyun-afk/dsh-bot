/** Observe the existing result only; never print error messages, paths, IDs or stacks. */
export function coldResultDiagnostic(result){
 const categories={'gateway/internal':'GATEWAY_INTERNAL',ERR_ACCESS_DENIED:'FILESYSTEM_ACCESS_DENIED',ERR_DLOPEN_DISABLED:'ADDON_LOADING_DISABLED',ERR_DLOPEN_FAILED:'NATIVE_LOADING_FAILED'};
 const code=result?.error?.code;
 return {stage:'existing-cold-resolve',agentPresent:Boolean(result&&typeof result==='object'&&'agent'in result),errorCode:Object.hasOwn(categories,code)?code:'UNRECORDED',errorCategory:Object.hasOwn(categories,code)?categories[code]:'UNKNOWN'};
}

const errorLayers=Object.freeze({
 ERR_DLOPEN_DISABLED:'NATIVE_ADDON_PERMISSION',
 ERR_DLOPEN_FAILED:'NATIVE_ADDON_LOAD_FAILED',
 ERR_ACCESS_DENIED:'FILESYSTEM_PERMISSION',
 ERR_MODULE_NOT_FOUND:'DEPENDENCY_RESOLUTION',
 MODULE_NOT_FOUND:'DEPENDENCY_RESOLUTION',
 ERR_FLOCK_UNSUPPORTED_PLATFORM:'HOST_PLATFORM_CAPABILITY',
 SESSION_QUERY_CORRUPT_SESSION:'SYNTHETIC_FIXTURE_FORMAT',
});
/** Diagnostic only: never call runtime methods or expose messages, paths, stacks or IDs. */
export function coldResultLayers(result){
 const error=result?.error;
 const structuredCauseRetained=Boolean(error&&Object.hasOwn(error,'cause'));
 const unknown={errorLayer:'UNKNOWN',innerCodeMarker:'UNRECORDED',innerEvidence:'UNRECORDED',structuredCauseRetained};
 if(error?.code!=='gateway/internal')return unknown;
 const classified=(code,evidence)=>({errorLayer:errorLayers[code],innerCodeMarker:code,innerEvidence:evidence,structuredCauseRetained});
 const causeCode=error.cause?.code;
 if(Object.hasOwn(errorLayers,causeCode))return classified(causeCode,'STRUCTURED_CAUSE_CODE');
 // rc.2 Controller discards cause and wraps String(error). These are fixed markers,
 // not recovered structured errors; unmatched or ambiguous summaries stay UNKNOWN.
 const text=typeof error.message==='string'?/^resume failed for session "[^"\r\n]{1,256}": ([\s\S]*)$/.exec(error.message.slice(0,4096))?.[1]:undefined;
 if(text===undefined)return unknown;
 const nodeCode=/^(?:Error|TypeError) \[([A-Z_]+)\]:/.exec(text)?.[1];
 if(Object.hasOwn(errorLayers,nodeCode))return classified(nodeCode,'SDK_STRINGIFIED_ERROR_MARKER');
 if(text==='Error: Cannot load native addon because loading addons is disabled.')return {errorLayer:'NATIVE_ADDON_PERMISSION',innerCodeMarker:'UNRECORDED',innerEvidence:'SDK_STRINGIFIED_ERROR_MARKER',structuredCauseRetained};
 if(/^Error: Cannot find module '[^'\r\n]+'(?:\r?\nRequire stack:|$)/.test(text))return classified('MODULE_NOT_FOUND','SDK_STRINGIFIED_ERROR_MARKER');
 if(/^Error: flock is not supported on (?:win32|aix|android|freebsd|openbsd|sunos)-(?:x64|arm64|arm|ia32|ppc64|s390x|riscv64)$/.test(text))return classified('ERR_FLOCK_UNSUPPORTED_PLATFORM','SDK_STRINGIFIED_ERROR_MARKER');
 if(/^SessionPersistenceCorruptionError:/.test(text)||/^SessionQueryError: (?:stored session "[^"\r\n]{1,256}" is corrupt:|failed to project session "[^"\r\n]{1,256}":)/.test(text))return {errorLayer:'SYNTHETIC_FIXTURE_FORMAT',innerCodeMarker:'UNRECORDED',innerEvidence:'SDK_STRINGIFIED_ERROR_MARKER',structuredCauseRetained};
 return unknown;
}
