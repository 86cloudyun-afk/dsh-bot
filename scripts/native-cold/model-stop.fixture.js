// Pure injected counter/stop checks. No Node, native code, model or network.
return function run(source){
 const install=Function(source.replaceAll('export ','')+'\nreturn typeof installOfflineModelStop==="function"?installOfflineModelStop:null;')();
 const check=(x,m)=>{if(!x)throw Error(m);};
 const definitions=[
 ['original_model_zero_binding_preserved',f=>{f.target.__offlineIO={model:0};check(f.target.__offlineIO.model===0&&f.state.modelAttempts===0&&f.saves===1,'BIND_ZERO');}],
 ['original_fixture_increment_enters_stop_first',f=>{f.target.__offlineIO={model:0};let fixtureError=false;try{f.target.__offlineIO.model++;fixtureError=true;}catch{}check(!fixtureError&&f.exits[0]==='MODEL_OPERATION_REFUSED'&&f.state.modelAttempts===1,'MODEL_IMMEDIATE');}],
 ['second_global_binding_refused',f=>{f.target.__offlineIO={model:0};try{f.target.__offlineIO={model:0};}catch{}check(f.exits[0]==='MODEL_GUARD_BINDING_REFUSED','REBIND');}],
 ['nonzero_initial_counter_refused',f=>{try{f.target.__offlineIO={model:1};}catch{}check(f.exits[0]==='MODEL_GUARD_BINDING_REFUSED'&&f.state.modelAttempts===null,'NONZERO');}],
 ['extra_initial_field_refused',f=>{try{f.target.__offlineIO={model:0,extra:true};}catch{}check(f.exits[0]==='MODEL_GUARD_BINDING_REFUSED','EXTRA');}],
 ['getter_initial_counter_never_evaluated',f=>{let got=false;try{f.target.__offlineIO={get model(){got=true;return 0;}};}catch{}check(!got&&f.exits.length===1,'GETTER');}],
 ['model_counter_cannot_be_redefined',f=>{f.target.__offlineIO={model:0};let failed=false;try{Object.defineProperty(f.target.__offlineIO,'model',{value:0});}catch{failed=true;}check(failed&&f.target.__offlineIO.model===0,'SEALED');}],
 ['every_model_write_is_refused',f=>{f.target.__offlineIO={model:0};try{f.target.__offlineIO.model=0;}catch{}check(f.exits[0]==='MODEL_OPERATION_REFUSED'&&f.state.modelAttempts===1,'WRITE');}],
 ['blocked_latch_keeps_original_reason',f=>{f.target.__offlineIO={model:0};try{f.target.__offlineIO.model++;}catch{}try{f.target.__offlineIO={model:0};}catch{}check(f.exits.length===2&&f.exits.every(x=>x==='MODEL_OPERATION_REFUSED'),'LATCH');}],
 ['observation_failure_stops_before_binding_return',f=>{f.failSave=true;try{f.target.__offlineIO={model:0};}catch{}check(f.exits[0]==='OBSERVATION_COMMIT_REFUSED','COMMIT');}]
 ];
 const results=definitions.map(([name,test])=>{try{check(typeof install==='function','MODEL_STOP_HELPER_MISSING');const f={target:{},state:{modelAttempts:null},exits:[],saves:0,failSave:false};install({target:f.target,state:f.state,save:()=>{f.saves++;if(f.failSave)throw Error('FAKE_IO');},stop:reason=>{f.exits.push(reason);throw Error('FAKE_CAPTURED_HALT');}});test(f);return{name,passed:true};}catch(e){return{name,passed:false,error:e.message};}});
 return{tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed),results,engine:'TOOL_V8_SYNTHETIC_MODEL_COUNTER_ONLY',actualNodeChildren:0,actualNativeModelNetwork:0};
};
