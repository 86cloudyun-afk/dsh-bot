// Pure policy fixtures only; all loaders, identities, exits and exports are synthetic.
return function run(source,pins){
 const api=Function(source.replaceAll('export ','')+'\nreturn typeof createDualNativeGuard==="function"?createDualNativeGuard:null;')();
 const sourceRoot='/workspace/source',root='/tmp/dsh-native-cold-pure';
 const system=sourceRoot+'/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/glibc/system.node';
 const narb=sourceRoot+'/node_modules/node-addon-require-builtin-linux-x64-gnu/prebuilt/linux-x64-gnu-napi-v9.node';
 const cache=root+'/node-addon-native-custom-loader-1000/native-cache/node-addon-require-builtin-linux-x64-gnu/0.1.7/linux-x64-gnu/linux-x64-gnu-napi-v9.node';
 const check=x=>{if(!x)throw Error('FAKE_CHECK_FAILED');};
 function fixture(change={},fault){
  const state={nativeLoadAttempts:0,nativeLoads:0,nativeAttempts:[],systemLoads:0,narbLoads:0,narbInfoQueries:0,narbRequireCalls:0,narbCalls:[],terminalRefusalCategory:null};let loaded=0,info=0,required=0,allowed=0,stopReason=null;
  const identities={SYSTEM:{scope:'KNOWN_SOURCE',contentSHA256:'54a9c25c05186c17520f6b7a5ced5f005752c08044c3eb76524cd517287600bc',packageIdentity:'@deepseek-ai/node-addon-system-linux-x64',payloadIdentity:'SYSTEM_GLIBC',pathRelation:'EXACT_ALLOWED_PATH',isPathAlias:false,unknownReason:'NONE'},NARB:{scope:'KNOWN_SOURCE',contentSHA256:'864d3c453f1046fe20d76ed89023213d71aff61fd5a8d1daffd11c229d73935e',packageIdentity:'node-addon-require-builtin-linux-x64-gnu',payloadIdentity:'REQUIRE_BUILTIN_LINUX_NAPI9',pathRelation:'OTHER_FILE',isPathAlias:false,unknownReason:'NONE'}};
  const identify=p=>{const id=JSON.parse(JSON.stringify(identities[p===system?'SYSTEM':'NARB']));if(p===cache)id.scope='OWNED_ROOT';return Object.assign(id,change);};
  const stop=reason=>{stopReason=reason;throw Error('FAKE_IMMEDIATE_EXIT');};
  const g=api({state,identify,source:sourceRoot,root,cachePath:cache,pins,guardOnly:false,save(){if(fault==='save')throw Error('FAKE_SAVE_FAILURE');},stop});
  function load(p=narb,binding){const m={exports:binding||{requireBuiltin(id){required++;if(fault==='require')throw Error('FAKE_NATIVE_FAILURE');return {getOrInitializeCascadedLoader(){return {};}};},isAllowedInternalId(){allowed++;return true;},getNativeBindingInfo(){info++;if(fault==='info')throw Error('FAKE_NATIVE_FAILURE');return {mode:'runtime-probe',product:'require-builtin',backend:'napi',abi:'napi-v9'};}}};g.load(m,p,()=>{loaded++;if(fault==='loader')throw Error('FAKE_LOADER_FAILURE');},()=>{});return m.exports;}
  return {state,g,load,stats:()=>({loaded,info,required,allowed,stopReason})};
 }
 const tests={
  accepts_only_two_pinned_targets(){const f=fixture();f.load();f.load(system,{tryLock(){}});check(f.stats().loaded===2&&f.state.narbLoads===1&&f.state.systemLoads===1);},
  exact_cache_copy_identity(){const f=fixture();f.load(cache);check(f.state.nativeAttempts[0].identity.scope==='OWNED_ROOT'&&f.state.narbLoads===1);},
  arbitrary_same_hash_owned_path_denied(){const f=fixture();try{f.load(root+'/other.node');}catch{}check(f.stats().loaded===0&&f.stats().stopReason==='OTHER_ADDON_LOAD_REFUSED');},
  source_alias_denied(){const f=fixture();try{f.load(narb.replace('/prebuilt/','/./prebuilt/'));}catch{}check(f.stats().loaded===0);},
  unknown_hash_denied(){const f=fixture({contentSHA256:'f'.repeat(64)});try{f.load();}catch{}check(f.stats().loaded===0&&f.stats().stopReason==='PINNED_ADDON_HASH_REFUSED');},
  bad_identity_denied(){for(const change of [{unknownReason:'FILE_CHANGED'},{scope:'UNKNOWN'},{isPathAlias:true},{packageIdentity:'UNKNOWN'}]){const f=fixture(change);try{f.load();}catch{}check(f.stats().loaded===0);}},
  second_same_target_denied_before_loader(){const f=fixture();f.load();try{f.load();}catch{}check(f.stats().loaded===1&&f.stats().stopReason==='ADDON_LOAD_LIMIT_REFUSED');},
  builtin_mode_never_loads(){const f=fixture();const s=f.state;let calls=0;const g=api({state:s,identify:()=>({scope:'UNKNOWN',contentSHA256:null,packageIdentity:'UNKNOWN',payloadIdentity:'UNKNOWN',pathRelation:'UNKNOWN',isPathAlias:null,unknownReason:'OUT_OF_SCOPE'}),source:sourceRoot,root,cachePath:cache,pins,guardOnly:true,save(){},stop(){throw Error('FAKE_EXIT');}});try{g.load({},'/synthetic-only/refused.node',()=>calls++,()=>{});}catch{}check(calls===0&&s.nativeAttempts[0].admission==='DENY');},
  info_queries_at_most_two(){const f=fixture(),b=f.load();b.getNativeBindingInfo();b.getNativeBindingInfo();try{b.getNativeBindingInfo();}catch{}check(f.stats().info===2&&f.state.narbInfoQueries===2&&f.state.terminalRefusalCategory==='NARB_INFO_LIMIT_REFUSED');},
  require_only_one_fixed_module(){const f=fixture(),b=f.load();b.requireBuiltin('internal/modules/esm/loader');try{b.requireBuiltin('internal/modules/esm/loader');}catch{}check(f.stats().required===1&&f.state.narbRequireCalls===1);},
  other_internal_module_denied_before_native(){for(const id of ['internal/fs','fs',{},'internal/modules/esm/loader\0']){const f=fixture(),b=f.load();try{b.requireBuiltin(id);}catch{}check(f.stats().required===0);}},
  unapproved_export_api_denied(){const f=fixture(),b=f.load();try{b.isAllowedInternalId('fs');}catch{}check(f.stats().allowed===0&&f.state.terminalRefusalCategory==='NARB_API_REFUSED');},
  export_surface_rejected_before_api(){for(const b of [{requireBuiltin(){}},{requireBuiltin(){},isAllowedInternalId(){},getNativeBindingInfo(){},extra(){}}]){const f=fixture();try{f.load(narb,b);}catch{}check(f.state.terminalRefusalCategory==='NATIVE_EXPORT_SURFACE_REFUSED');}},
  loader_failure_stops_cannot_fallback(){const f=fixture({},'loader');try{f.load();}catch{}try{f.load(system,{tryLock(){}});}catch{}check(f.stats().loaded===1&&f.state.terminalRefusalCategory==='ORIGINAL_DLOPEN_FAILED');},
  info_failure_stops_cannot_continue(){const f=fixture({},'info'),b=f.load();try{b.getNativeBindingInfo();}catch{}try{b.requireBuiltin('internal/modules/esm/loader');}catch{}check(f.stats().info===1&&f.stats().required===0);},
  require_failure_stops_cannot_continue(){const f=fixture({},'require'),b=f.load();try{b.requireBuiltin('internal/modules/esm/loader');}catch{}try{b.getNativeBindingInfo();}catch{}check(f.stats().required===1&&f.stats().info===0);},
  observation_failure_never_enters_loader(){const f=fixture({},'save');try{f.load();}catch{}check(f.stats().loaded===0&&f.state.terminalRefusalCategory==='OBSERVATION_COMMIT_REFUSED');},
  denial_latch_survives_caller_catch(){const f=fixture();try{f.load('/outside/refused.node');}catch{}try{f.load();}catch{}check(f.stats().loaded===0&&f.state.nativeLoadAttempts===1);},
  injected_wrap_failure_is_immediate(){const f=fixture();const m={exports:{tryLock(){}}};try{f.g.load(m,system,()=>{},()=>{throw Error('WRAP_FAILED');});}catch{}check(f.state.terminalRefusalCategory==='NATIVE_WRAP_FAILED');}
 };
 const results=[];for(const [name,test] of Object.entries(tests)){try{test();results.push({name,passed:true});}catch{results.push({name,passed:false});}}
 return {tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).map(x=>x.name),results,engine:'NODE_PURE_POLICY_FIXTURE_ONLY',actualNodeChildren:0,actualNativeModelNetwork:0};
};
