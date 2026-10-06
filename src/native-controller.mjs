/** Private owner-only product bridge to the isolated protected native candidate. Never mount as a public service. */
import { Context } from '@deepseek-ai/cordis';
import { isDeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek';
import { NativeRunHost,NativeSessionDriver,NativeOperationId,NativeTargetId,NativeControlId } from '@deepseek-ai/dsh-experimental-native-run';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { SessionId } from '@deepseek-ai/dsh-session';
import { randomUUID } from 'node:crypto';
import { Host } from './host.mjs';
import { DshAdapter } from './adapter.mjs';
import { SessionCreationDriver } from './session-creation.mjs';
import { prepareSessionCreate } from './session-mode.mjs';
import { canonical,digest,requireValue,text } from './errors.mjs';
import { buildWorkingSet,renderWorkingSet } from './working-set.mjs';
import {installExplicitOperatorReadBinding} from './explicit-operator-read-binding.mjs';

export class OwnedNativeController {
 #ctx;#host;#caller;#directory;#capacity;#native;#binding;#drivers=new Map();#pending=new Map();#dispatching=new Map();
 #durableCreations=new Set();#closed=false;#closing=false;#opening;#closePromise;#acceptanceGuard;
 #workingSetEnabled;#workingSetPhase='dispatch';#recoveryWorkingSets;
 constructor({ctx,ledger,ownerLabel,directory,capacity,acceptanceGuard,workingSetEnabled=false}) {
  requireValue(ctx instanceof Context && ctx.fiber && ctx.get('llm') && ctx.get('sessionPersistence'),'unsupported_host_identity');
  requireValue(directory.startsWith('/'),'invalid_native_directory');
  requireValue(acceptanceGuard===undefined || typeof acceptanceGuard==='function','invalid_acceptance_guard');this.#acceptanceGuard=acceptanceGuard;
  requireValue(typeof workingSetEnabled==='boolean','invalid_working_set');
  requireValue(!workingSetEnabled || acceptanceGuard===undefined,'working_set_guard_conflict');this.#workingSetEnabled=workingSetEnabled;
  this.#ctx=ctx;this.#caller=ctx.fiber;this.#directory=directory;this.#capacity=structuredClone(capacity);
  this.#host=new Host({ledger,ownerHumanId:ownerLabel,adapter:new DshAdapter(ctx),ownerCapability:this.#caller});
  Object.assign(this.#host.extensions,{
   prepareExecutionSession:(p,e)=>this.#prepareExecution(p,e),
   prepareNativeTextOperation:(p,e)=>this.#prepareOperation(p,e),
   stopNativeTextOperation:(p,e)=>this.#prepareStop(p,e),
  });
  ctx.effect(()=>()=>this.#dispose());
 }
 #owner(caller){requireValue(caller===this.#caller,'unsupported_host_identity');requireValue(!this.#closed && !this.#closing,'native_controller_closed');}
 command(caller,envelope,payload){this.#owner(caller);return this.#host.executeOwned(caller,envelope,payload);}
 controlPort(caller,options){this.#owner(caller);const isCurrent=options?.isCurrent;
  requireValue(isCurrent===undefined || typeof isCurrent==='function','invalid_control_session');
  return this.#host.openOwnedControlSession(caller,{...options,isCurrent:()=>!this.#closed && !this.#closing
   && this.#ctx.fiber===this.#caller && this.#ctx.fiber.uid!==null && this.#ctx.fiber.state===2
   && (isCurrent===undefined || isCurrent())});
 }
 workPort(caller,options){this.#owner(caller);const isCurrent=options?.isCurrent;return this.#host.openOwnedWorkSessionPort(caller,{...options,isCurrent:()=>!this.#closed&&!this.#closing&&this.#ctx.fiber===this.#caller&&this.#ctx.fiber.uid!==null&&this.#ctx.fiber.state===2&&(isCurrent===undefined||isCurrent())});}
 readPort(caller){this.#owner(caller);return this.#host.createOwnedBotTaskReadPort(caller,{isCurrent:()=>!this.#closed && !this.#closing && this.#ctx.fiber.uid!==null && this.#ctx.fiber.state===2});}
 installReadSource(caller){this.#owner(caller);return installExplicitOperatorReadBinding({ownerCtx:this.#ctx,expectedHost:this.#host,readPort:this.readPort(caller)});}
 async refreshModes(caller){this.#owner(caller);return this.#host.adapter.refreshSessionModeCatalog();}
 snapshot(caller){this.#owner(caller);return {authority:'private-runtime-owner',publicHumanAuthorityVerified:false,
  nativeRuntimeVerified:false,releaseReady:false,privateProductPathVerified:this.#host.ledger.list('nativeOperation').some(p=>p.state==='settled'),
  nativeOperations:this.#host.ledger.list('nativeOperation'),
  ...this.#recoveryWorkingSets===undefined?{}:{recoveryWorkingSets:structuredClone(this.#recoveryWorkingSets)}};}
 #prepareExecution(p,e) {
  const h=this.#host,b=h.object('bot',p.botId,e),task=h.object('task',p.taskId);
  requireValue(b.lifecycle==='active' && task.ownerBotId===b.botId && task.ownerBotEpoch===b.epoch,'owner_unavailable');
  requireValue(task.stop.state==='none' && !task.pendingRevision,'task_stopped');
  requireValue(!h.ledger.list('creation').some(i=>i.kind==='execution' && i.taskId===task.taskId),'execution_creation_exists');
  const cfg=h.ledger.get('config',b.configVersion),request=prepareSessionCreate({cwd:p.cwd,agentPreset:cfg.agentPreset ?? null},h.adapter.sessionModeCatalog()).request;
  const grant=h.ledger.get('grant',e.authorizationRef);
  const intent={operationId:e.operationId,sessionId:`session-${randomUUID()}`,kind:'execution',botId:b.botId,botEpoch:b.epoch,
   taskId:task.taskId,taskEpoch:task.epoch,taskRevision:task.revision,configVersion:b.configVersion,authorizationRef:e.authorizationRef,
   authorityEpoch:grant.epoch,rootHumanInstructionRef:e.rootHumanInstructionRef,deadline:e.deadline,...request,state:'prepared'};
  h.ledger.put('creation',intent.operationId,intent);return intent;
 }
 open(caller,options){this.#owner(caller);requireValue(!this.#opening,'native_controller_already_open');
  const pending=this.#open(caller,options).finally(()=>{if(this.#opening===pending)this.#opening=undefined;});this.#opening=pending;return pending;
 }
 async #open(caller,{contactCreationId,executionCreationId,create,maxTokens}) {
  this.#owner(caller);requireValue(!this.#native,'native_controller_already_open');
  const h=this.#host,key='protected-text-owner';
  if(create){
   requireValue(!h.ledger.get('nativeBinding',key),'native_binding_exists');
   const intents={contact:h.ledger.get('creation',contactCreationId),execution:h.ledger.get('creation',executionCreationId)};
   requireValue(intents.contact?.state==='prepared' && intents.execution?.state==='prepared','native_creation_not_prepared');
   requireValue(intents.execution.kind==='execution' && intents.contact.botId===intents.execution.botId
    && intents.contact.configVersion===intents.execution.configVersion,'native_binding_conflict');
   const targets={};
   for(const [kind,i] of Object.entries(intents)){
    const cfg=h.ledger.get('config',i.configVersion),route=cfg[kind],task=h.ledger.get('task',intents.execution.taskId);
    requireValue(route.provider==='deepseek-official' && route.model==='deepseek-flash' && route.reasoning==='off','unsupported_native_route');
    requireValue(Number.isSafeInteger(maxTokens?.[kind]) && maxTokens[kind]>0,'invalid_native_budget');
    targets[kind]={creationId:i.operationId,kind,product:{botId:i.botId,botEpoch:i.botEpoch,taskId:task.taskId,
     taskEpoch:task.epoch,taskRevision:task.revision,configVersion:i.configVersion,authorityEpoch:i.authorityEpoch,authorizationRef:i.authorizationRef,
     ...this.#workingSetEnabled?{workingSetNamespace:task.scope.namespace}:{}},
     target:{id:NativeTargetId(`product-${kind}`),runGeneration:1,botEpoch:i.botEpoch,taskEpoch:task.epoch,taskRevision:task.revision,
      authorityEpoch:i.authorityEpoch,membershipGeneration:1,configVersion:1,scopeRef:'text-only',provider:'deepseek-official',model:route.model,
      maxTokens:maxTokens[kind],reasoningEffort:'off',endpoint:'https://api.deepseek.com/anthropic/v1/messages',state:'active',
      sessionBinding:{sessionId:i.sessionId,agentPreset:i.agentPreset,controlConfigId:i.configVersion,cwd:i.cwd}}};
   }
   // Cross-journal identity is durable before opening the native writer or creating either Session.
   this.#binding=h.ledger.transaction(()=>h.ledger.put('nativeBinding',key,{id:key,directory:this.#directory,
    hostId:h.ledgerInstanceId,capacity:this.#capacity,targets,state:'linked'}));
  }else{
   this.#binding=h.ledger.get('nativeBinding',key);requireValue(this.#binding,'native_binding_missing');
   requireValue(this.#binding.directory===this.#directory && this.#binding.hostId===h.ledgerInstanceId
    && canonical(this.#binding.capacity)===canonical(this.#capacity),'native_binding_conflict');
   requireValue(this.#binding.targets.contact.creationId===contactCreationId && this.#binding.targets.execution.creationId===executionCreationId,'native_binding_conflict');
  }
  try{this.#native=await NativeRunHost.open({directory:this.#directory,create,hostId:h.ledgerInstanceId,
   targets:Object.values(this.#binding.targets).map(row=>row.target),capacity:this.#capacity,
   authorize:(owner,action,targetId)=>{
    if(owner!==this.#caller || this.#closed)return false;
    if(action==='inspect' || action==='control')return true;
    if(this.#closing)return false;
    try{const grant=h.ledger.get('grant','native-owner');requireValue(grant?.active,'authority_changed');
     if(targetId!==undefined)this.#check(this.#row(targetId));return true;
    }catch{return false;}
   }});
  this.#owner(caller);
  const factory=this.#ctx.deepseekProtectedProviders?.lookup('deepseek-official');
  requireValue(isDeepSeekProviderFactory(factory,this.#ctx.get('llm')),'native_provider_factory_required');
  if(!create)for(const row of Object.values(this.#binding.targets)){
   requireValue(h.ledger.get('creation',row.creationId)?.state==='created','creation_outcome_unknown');
   const actual=this.#native.target(this.#caller,row.target.id);requireValue(canonical(actual)===canonical(row.target),'native_binding_conflict');
   this.#drivers.set(row.target.id,await NativeSessionDriver.resumeOwned(this.#ctx,this.#native,row.target.id,factory));
   this.#owner(caller);this.#durableCreations.add(row.target.id);
  }
  // Project the authoritative journal before admitting any new product work after startup.
  for(const p of h.ledger.list('nativeOperation'))if(p.state!=='prepared')this.inspect(caller,p.operationId);
  if(!create && this.#workingSetEnabled){this.#workingSetPhase='resume';
   this.#recoveryWorkingSets=Object.fromEntries(Object.entries(this.#binding.targets).map(([kind,row])=>[kind,this.#workset(row,'resume')]));}
  }catch(error){await this.#native?.close();this.#native=undefined;this.#drivers.clear();this.#durableCreations.clear();throw error;}
 }
 #row(targetId){const row=Object.values(this.#binding?.targets ?? {}).find(row=>row.target.id===targetId);requireValue(row,'native_binding_missing');return row;}
 #check(row) {
  const h=this.#host,p=row.product,b=h.ledger.get('bot',p.botId),task=h.ledger.get('task',p.taskId),grant=h.ledger.get('grant',p.authorizationRef);
  requireValue(grant?.active && grant.epoch===p.authorityEpoch && h.isCreationOwnerGrant(grant),'authority_changed');
  requireValue(b?.lifecycle==='active' && b.epoch===p.botEpoch,'bot_changed');requireValue(b.configVersion===p.configVersion,'config_changed');
  requireValue(task?.epoch===p.taskEpoch && task.revision===p.taskRevision && task.ownerBotId===b.botId && task.ownerBotEpoch===b.epoch
   && task.stop.state==='none' && !task.pendingRevision,'task_changed');
  requireValue(h.ledger.get('creation',row.creationId)?.state==='created','native_creation_unconfirmed');
  requireValue(!h.ledger.get('nativeFence',`${row.target.id}/${row.target.runGeneration}`),'generation_stopped');
  requireValue(!h.ledger.list('nativeOperation').some(op=>op.targetId===row.target.id && op.state==='unknown'),'outcome_unknown');
  requireValue(!this.#native.sessionOperations(this.#caller,row.target.sessionBinding.sessionId).some(op=>op.state==='unknown'
   || op.attempts.some(attempt=>attempt.state!=='observed')),'outcome_unknown');
  const active=this.#dispatching.get(row.target.id);if(active!==undefined){const p=this.#operation(active.operationId);this.#deadline(p);
   this.#checkWorkset(p,active);
   if(this.#acceptanceGuard){requireValue(typeof p.acceptanceSourceVersion==='string','candidate_unbound');
    const version=this.#acceptanceGuard({phase:'dispatch',operationId:p.operationId,kind:p.kind,steps:p.steps,acceptanceSourceVersion:p.acceptanceSourceVersion});
    requireValue(version===p.acceptanceSourceVersion,'candidate_source_changed');}}
 }
 #workset(row,phase){
  const h=this.#host,p=row.product;requireValue(typeof p.workingSetNamespace==='string','working_set_scope_unbound');
  return buildWorkingSet({task:h.ledger.get('task',p.taskId),bot:h.ledger.get('bot',p.botId),namespace:p.workingSetNamespace,
   plans:h.ledger.list('progress'),attempts:h.ledger.list('attempt'),projections:h.ledger.list('projection'),
   nativeOperations:h.ledger.list('nativeOperation').filter(op=>op.targetId===row.target.id).map(op=>({...op,taskId:p.taskId})),
   authorityEpoch:h.ledger.get('grant',p.authorizationRef).epoch,phase});
 }
 #checkWorkset(p,expected={}){const row=this.#row(p.targetId);
  if(row.product.workingSetNamespace===undefined && p.workingSetVersion===undefined)return;
  requireValue(this.#workingSetEnabled,'working_set_disabled');
  const operationId=expected.operationId ?? p.operationId;
  requireValue(p.operationId===operationId
   && p.nativeOperationId===`product-${digest({ledgerInstanceId:this.#host.ledgerInstanceId,operationId})}`
   && (expected.targetId===undefined || p.targetId===expected.targetId)
   && (expected.nativeOperationId===undefined || p.nativeOperationId===expected.nativeOperationId),'working_set_identity_changed');
  requireValue(typeof p.workingSetVersion==='string' && /^[a-f0-9]{64}$/.test(p.workingSetVersion)
   && ['dispatch','resume'].includes(p.workingSetPhase),'working_set_unbound');
  if(expected.nativeOperationId!==undefined || p.state!=='prepared'){
   const native=this.#native.inspect(this.#caller,NativeOperationId(expected.nativeOperationId ?? p.nativeOperationId));
   requireValue(canonical(native.steps)===canonical(p.steps) && canonical(native.binding)===canonical(p.binding),'working_set_input_changed');}
  const current=this.#workset(row,p.workingSetPhase);
  requireValue(current.context.status==='current' && current.version===p.workingSetVersion
   && p.steps[0].startsWith(`DSH_WORKING_SET\n${current.text}\nEXPLICIT_INPUT\n`),'working_set_changed');
 }
 #deadline(p){requireValue(p.deadline===null || Date.parse(p.deadline)>Date.now(),'deadline_expired');}
 #creationPort(){return Object.freeze({
  createOwnedSession:async i=>{
   const row=Object.values(this.#binding.targets).find(row=>row.creationId===i.operationId);requireValue(row && i.sessionId===row.target.sessionBinding.sessionId,'native_binding_conflict');
   requireValue(!this.#drivers.has(row.target.id),'native_creation_exists');
   const factory=this.#ctx.deepseekProtectedProviders.lookup('deepseek-official');
   const driver=await NativeSessionDriver.createOwned(this.#ctx,this.#native,row.target.id,factory);
   this.#drivers.set(row.target.id,driver);
   const session=this.#ctx.sessions.get(SessionId(i.sessionId));
   requireValue(await this.#ctx.sessions.flush(session),'native_creation_not_durable');
   const stored=await this.#ctx.sessionPersistence.open(SessionId(i.sessionId),'read');
   try{const read=await stored.read();requireValue(stored.header.id===i.sessionId && stored.header.agentPreset===i.agentPreset
    && stored.header.cwd===i.cwd && read.events.length===0,'native_creation_not_durable');}finally{await stored.close();}
   this.#durableCreations.add(row.target.id);
   return {sessionId:i.sessionId};
  },
  inspectOwnedCreation:async i=>{
   const row=Object.values(this.#binding.targets).find(row=>row.creationId===i.operationId),driver=row && this.#drivers.get(row.target.id);
   if(!driver || !driver.hasNativeOwner() || !this.#durableCreations.has(row.target.id))return null;
   driver.validateSessionBinding(this.#native.target(this.#caller,row.target.id));
   const session=this.#ctx.sessions.get(SessionId(i.sessionId)),agent=this.#ctx.agents.get(SessionId(i.sessionId));
   requireValue(session && agent?.session===session && scopeOf(agent.ctx)===agent,'native_binding_conflict');
   const stored=await this.#ctx.sessionPersistence.open(SessionId(i.sessionId),'read');
   try{const read=await stored.read();requireValue(stored.header.id===i.sessionId && stored.header.agentPreset===i.agentPreset
    && stored.header.cwd===i.cwd && read.events.length===0,'native_creation_not_durable');}finally{await stored.close();}
   return {sessionId:session.id,agentPreset:this.#ctx.sessionProjections.stateOf(session,'agentPreset'),blank:session.seq===0,
    globalTools:this.#ctx.tools.schemas().length,scopedTools:this.#ctx.tools.schemas(agent).length};
  },
 });}
 async createSession(caller,creationId){this.#owner(caller);requireValue(this.#native,'native_binding_missing');
  return new SessionCreationDriver({host:this.#host,caller:this.#caller,port:this.#creationPort()}).run(caller,creationId);
 }
 #prepareOperation(p,e){
  requireValue(['contact','execution'].includes(p.kind),'invalid_native_kind');const row=this.#binding?.targets[p.kind];requireValue(row && this.#drivers.has(row.target.id),'native_binding_missing');this.#check(row);
  requireValue(row.product.workingSetNamespace===undefined || this.#workingSetEnabled,'working_set_disabled');
  requireValue(Array.isArray(p.steps) && p.steps.length===1 && typeof p.steps[0]==='string' && p.steps[0].trim().length>0
   && Buffer.byteLength(p.steps[0])<=4096,'invalid_native_input');
  const acceptanceSourceVersion=this.#acceptanceGuard?.({phase:'prepare',operationId:e.operationId,kind:p.kind,steps:p.steps});
  if(this.#acceptanceGuard)requireValue(typeof acceptanceSourceVersion==='string' && /^[a-f0-9]{64}$/.test(acceptanceSourceVersion),'candidate_unbound');
  let steps=structuredClone(p.steps),workset;
  if(this.#workingSetEnabled){workset=this.#workset(row,this.#workingSetPhase);requireValue(workset.context.status==='current','working_set_stale');
   steps=[renderWorkingSet(workset,steps[0])];}
  const result={operationId:e.operationId,nativeOperationId:`product-${digest({ledgerInstanceId:this.#host.ledgerInstanceId,operationId:e.operationId})}`,
   targetId:row.target.id,kind:p.kind,steps,deadline:e.deadline,
   inputDigest:digest(steps),binding:structuredClone(row.target),state:'prepared',native:null,stop:null,
   ...workset===undefined?{}:{workingSetVersion:workset.version,workingSetPhase:this.#workingSetPhase},
   ...acceptanceSourceVersion===undefined?{}:{acceptanceSourceVersion}};
  this.#host.ledger.put('nativeOperation',e.operationId,result);return result;
 }
 #operation(id){const p=this.#host.ledger.get('nativeOperation',id);requireValue(p,'not_found');
  if(this.#workingSetEnabled || p.workingSetVersion!==undefined
   || Object.values(this.#binding?.targets ?? {}).some(row=>row.product.workingSetNamespace!==undefined)){
   requireValue(p.operationId===id
    && p.nativeOperationId===`product-${digest({ledgerInstanceId:this.#host.ledgerInstanceId,operationId:id})}`,'working_set_identity_changed');}
  return p;
 }
 #save(p){return this.#host.ledger.transaction(()=>this.#host.ledger.put('nativeOperation',p.operationId,p));}
 #project(p,native){return this.#host.ledger.transaction(()=>{
  const current=this.#operation(p.operationId);
  requireValue(native.id===current.nativeOperationId && p.nativeOperationId===current.nativeOperationId,'working_set_identity_changed');
  return this.#host.ledger.put('nativeOperation',p.operationId,
   {...current,state:native.state==='admitted' && native.failureCode?'blocked':native.state,native:structuredClone(native)});
 });}
 inspect(caller,id){this.#owner(caller);const p=this.#operation(id);
  if(p.state==='prepared')return p;
  try{return this.#project(p,this.#native.inspect(caller,NativeOperationId(p.nativeOperationId)));}
  catch{return this.#save({...p,state:'unknown',errorCategory:'native_lookup_unconfirmed'});}
 }
 async admit(caller,id){this.#owner(caller);const p=this.#operation(id);if(p.state!=='prepared')return this.inspect(caller,id);
  this.#deadline(p);this.#check(this.#row(p.targetId));this.#checkWorkset(p,{operationId:id});this.#save({...p,state:'admitting'});
  try{const native=await this.#native.admit(caller,{id:NativeOperationId(p.nativeOperationId),targetId:NativeTargetId(p.targetId),
   kind:p.kind,binding:p.binding,steps:p.steps});return this.#project(this.#operation(id),native);}
  catch(error){const code=typeof error?.code==='string'?error.code:'native_admission_unconfirmed';
   return this.#save({...this.#operation(id),state:'unknown',errorCategory:code});}
 }
 async drive(caller,id){this.#owner(caller);if(this.#pending.has(id))return this.#pending.get(id);
  const p=this.inspect(caller,id);if(p.state!=='admitted' || p.native?.failureCode)return p;
  const active=Object.freeze({operationId:id,nativeOperationId:p.nativeOperationId,targetId:p.targetId});
  this.#deadline(p);this.#check(this.#row(p.targetId));this.#checkWorkset(p,active);requireValue(!this.#dispatching.has(p.targetId),'native_session_busy');
  this.#save({...p,state:'driving'});this.#dispatching.set(p.targetId,active);
  const driver=this.#drivers.get(p.targetId);requireValue(driver,'native_driver_missing');
  const pending=(async()=>{try{return this.#project(this.#operation(id),await driver.drive(caller,NativeOperationId(p.nativeOperationId)));}
   catch(error){const inspected=this.inspect(caller,id),code=typeof error?.code==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(error.code)?error.code:'native_drive_unconfirmed';
    return this.#save({...inspected,errorCategory:inspected.errorCategory ?? inspected.native?.failureCode ?? code});
   }finally{this.#pending.delete(id);this.#dispatching.delete(p.targetId);}})();this.#pending.set(id,pending);return pending;
 }
 #prepareStop(p,e){const op=this.#operation(p.operationId);requireValue(op.native!==null,'native_admission_unconfirmed');
  const fence={controlId:e.operationId,nativeControlId:`product-${digest({ledgerInstanceId:this.#host.ledgerInstanceId,controlId:e.operationId})}`,
   operationId:op.operationId,nativeOperationId:op.nativeOperationId,targetId:op.targetId,generation:op.binding.runGeneration,state:'fenced'};
  this.#host.ledger.put('nativeFence',`${op.targetId}/${fence.generation}`,fence);this.#host.ledger.put('nativeStop',e.operationId,fence);
  this.#host.ledger.put('nativeOperation',op.operationId,{...op,stop:fence});return fence;
 }
 async stop(caller,controlId){this.#owner(caller);const stop=this.#host.ledger.get('nativeStop',controlId);requireValue(stop,'native_stop_fence_required');
  const p=this.#operation(stop.operationId);requireValue(p.targetId===stop.targetId && p.binding.runGeneration===stop.generation,'native_binding_conflict');
  const driver=this.#drivers.get(p.targetId);requireValue(driver,'native_driver_missing');
  try{return this.#project(this.#operation(p.operationId),await driver.stop(caller,NativeControlId(stop.nativeControlId),NativeOperationId(p.nativeOperationId)));}
  catch{return this.#save({...this.#operation(p.operationId),state:'unknown',errorCategory:'native_stop_unconfirmed'});}
 }
 #dispose(){if(this.#closePromise)return this.#closePromise;this.#closing=true;
  const pending=(async()=>{try{await this.#opening;}catch{/* Failed startup already rolls back its acquired host. */}
   await this.#native?.close();this.#native=undefined;this.#closed=true;})();this.#closePromise=pending;
  // A missed local drain bound keeps authority denied and the writer held; retry only safe native cleanup.
  void pending.catch(()=>{if(this.#closePromise===pending)this.#closePromise=undefined;});return pending;
 }
 close(caller){requireValue(caller===this.#caller,'unsupported_host_identity');return this.#dispose();}
}
