// Test-only synthetic model counter boundary. No imports or ambient IO.
export function installOfflineModelStop({target,state,save,stop}) {
 let bound,model=0,blocked=false,reason;
 function refuse(category){
  if(!blocked){blocked=true;reason=category;}
  stop(reason);throw Error('IMMEDIATE_MODEL_STOP_RETURNED');
 }
 if(Object.getOwnPropertyDescriptor(target,'__offlineIO'))return refuse('MODEL_GUARD_BINDING_REFUSED');
 Object.defineProperty(target,'__offlineIO',{configurable:false,enumerable:true,get(){return bound;},set(value){
  if(blocked)return refuse(reason);
  if(bound||!value||typeof value!=='object'||Reflect.ownKeys(value).length!==1)return refuse('MODEL_GUARD_BINDING_REFUSED');
  const d=Object.getOwnPropertyDescriptor(value,'model');
  if(!d||d.value!==0||!d.configurable||!d.writable)return refuse('MODEL_GUARD_BINDING_REFUSED');
  Object.defineProperty(value,'model',{configurable:false,enumerable:d.enumerable,get(){return model;},set(){
   if(blocked)return refuse(reason);
   model=1;state.modelAttempts=1;return refuse('MODEL_OPERATION_REFUSED');
  }});
  bound=value;state.modelAttempts=0;
  try{save();}catch{return refuse('OBSERVATION_COMMIT_REFUSED');}
 }});
}
