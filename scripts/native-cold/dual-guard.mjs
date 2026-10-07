// Pure policy around the unchanged v3 bounded identity reader. No imports or ambient IO.
export function createDualNativeGuard({state,identify,source,root,cachePath,guardOnly,save,stop,pins}) {
 const system=source+'/node_modules/'+pins.bindings[0].packageRelativeSDKFile;
 const narb=source+'/node_modules/'+pins.bindings[1].packageRelativeSDKFile;
 const hashes={SYSTEM:pins.bindings[0].sha256,NARB:pins.bindings[1].sha256};
 const reserved={SYSTEM:false,NARB:false};let blocked=false,firstReason;
 const unknown=()=>({scope:'UNKNOWN',contentSHA256:null,packageIdentity:'UNKNOWN',payloadIdentity:'UNKNOWN',pathRelation:'UNKNOWN',isPathAlias:null,unknownReason:'OUT_OF_SCOPE'});
 function refuse(category) {
  if(!blocked){blocked=true;state.terminalRefusalCategory=category;firstReason=['OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED'].includes(category)?category:'OTHER_ADDON_LOAD_REFUSED';}
  return stop(firstReason);
 }
 function persist(){try{save();}catch{return refuse('OBSERVATION_COMMIT_REFUSED');}}
 function apiCall(name,original,binding,args) {
  if(blocked)return stop(firstReason);
  const event={index:state.narbCalls.length+1,api:name,moduleId:name==='requireBuiltin'&&args[0]==='internal/modules/esm/loader'?'INTERNAL_ESM_LOADER':'NONE',admission:'DENY',outcome:'NOT_CALLED'};
  if(state.narbCalls.length>=4)return refuse('NARB_API_LIMIT_REFUSED');
  state.narbCalls.push(event);
  if(name==='getNativeBindingInfo'){
   if(args.length!==0)return refuse('NARB_ARGUMENT_REFUSED');
   if(state.narbInfoQueries>=2)return refuse('NARB_INFO_LIMIT_REFUSED');
   state.narbInfoQueries++;
  }else if(name==='requireBuiltin'){
   if(args.length!==1||args[0]!=='internal/modules/esm/loader')return refuse('NARB_MODULE_REFUSED');
   if(state.narbRequireCalls>=1)return refuse('NARB_REQUIRE_LIMIT_REFUSED');
   state.narbRequireCalls++;
  }else return refuse('NARB_API_REFUSED');
  event.admission='ALLOW';event.outcome='IN_PROGRESS';persist();
  let value;
  try{value=Reflect.apply(original,binding,args);}catch{event.outcome='CALL_FAILED';persist();return refuse('NARB_CALL_FAILED');}
  if(blocked)return stop(firstReason);
  if(name==='getNativeBindingInfo'){
   const field=k=>value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,k)?.value:undefined;
   if(typeof field('mode')!=='string'||field('mode').length>64||field('product')!=='require-builtin'||field('backend')!=='napi'||field('abi')!=='napi-v9')return refuse('NARB_BINDING_INFO_REFUSED');
  }else if(!value||typeof value.getOrInitializeCascadedLoader!=='function')return refuse('NARB_MODULE_RESULT_REFUSED');
  event.outcome='RETURNED';persist();return value;
 }
 function wrapNarb(binding){
  const names=['requireBuiltin','isAllowedInternalId','getNativeBindingInfo'];
  if(!binding||typeof binding!=='object'||Reflect.ownKeys(binding).some(k=>!names.includes(k)))return refuse('NATIVE_EXPORT_SURFACE_REFUSED');
  const original={};
  for(const name of names){const d=Object.getOwnPropertyDescriptor(binding,name);if(!d||typeof d.value!=='function'||(!d.writable&&!d.configurable))return refuse('NATIVE_EXPORT_SURFACE_REFUSED');original[name]=d.value;}
  for(const name of names)Object.defineProperty(binding,name,{configurable:false,writable:false,value:function(...args){return apiCall(name,original[name],binding,args);}});
 }
 function load(module,filename,invoke,wrapSystem){
  if(blocked)return stop(firstReason);
  if(state.nativeLoadAttempts>=3)return refuse('ADDON_LOAD_LIMIT_REFUSED');
  const entry={index:++state.nativeLoadAttempts,targetId:'UNKNOWN',admission:'PENDING',reason:'NONE',outcome:'NOT_CALLED',identity:unknown()};
  state.nativeAttempts.push(entry);persist();
  try{entry.identity=identify(filename);}catch{}
  persist();
  const deny=reason=>{entry.admission='DENY';entry.reason=reason;return refuse(reason);};
  const target=filename===system?'SYSTEM':filename===narb||filename===cachePath?'NARB':null;
  if(guardOnly||target===null)return deny('OTHER_ADDON_LOAD_REFUSED');
  entry.targetId=target;
  const id=entry.identity;
  const expectedScope=filename===cachePath?'OWNED_ROOT':'KNOWN_SOURCE';
  const expectedRelation=target==='SYSTEM'?'EXACT_ALLOWED_PATH':'OTHER_FILE';
  const row=pins.bindings[target==='SYSTEM'?0:1];
  const expectedPackage=row.package;
  const expectedPayload=row.payloadIdentity;
  if(id.scope!==expectedScope||id.contentSHA256!==hashes[target]||id.packageIdentity!==expectedPackage||id.payloadIdentity!==expectedPayload||id.pathRelation!==expectedRelation||id.isPathAlias!==false||id.unknownReason!=='NONE')return deny('PINNED_ADDON_HASH_REFUSED');
  if(reserved[target]||state.nativeLoads>=2)return deny('ADDON_LOAD_LIMIT_REFUSED');
  reserved[target]=true;entry.admission='ALLOW';entry.outcome='IN_PROGRESS';persist();
  let result;
  try{result=invoke();}catch{entry.reason='ORIGINAL_DLOPEN_FAILED';entry.outcome='LOAD_FAILED';persist();return refuse('ORIGINAL_DLOPEN_FAILED');}
  if(blocked)return stop(firstReason);
  state.nativeLoads++;state[target==='SYSTEM'?'systemLoads':'narbLoads']++;
  entry.reason='NATIVE_WRAP_FAILED';entry.outcome='LOADED_WRAP_FAILED';persist();
  try{
   if(target==='NARB')wrapNarb(module.exports);
   else{
    const binding=module.exports;
    if(!binding||typeof binding.tryLock!=='function'||Reflect.ownKeys(binding).some(k=>k!=='tryLock'))return refuse('NATIVE_EXPORT_SURFACE_REFUSED');
    wrapSystem(module);
   }
  }catch(error){if(blocked)throw error;return refuse('NATIVE_WRAP_FAILED');}
  if(blocked)return stop(firstReason);
  entry.reason='NONE';entry.outcome='LOADED';persist();return result;
 }
 return Object.freeze({load,refuse,isBlocked:()=>blocked});
}
