/** Observe the existing result only; never print error messages, paths, IDs or stacks. */
export function coldResultDiagnostic(result){
 const categories={'gateway/internal':'GATEWAY_INTERNAL',ERR_ACCESS_DENIED:'FILESYSTEM_ACCESS_DENIED',ERR_DLOPEN_DISABLED:'ADDON_LOADING_DISABLED',ERR_DLOPEN_FAILED:'NATIVE_LOADING_FAILED'};
 const code=result?.error?.code;
 return {stage:'existing-cold-resolve',agentPresent:Boolean(result&&typeof result==='object'&&'agent'in result),errorCode:Object.hasOwn(categories,code)?code:'UNRECORDED',errorCategory:Object.hasOwn(categories,code)?categories[code]:'UNKNOWN'};
}
