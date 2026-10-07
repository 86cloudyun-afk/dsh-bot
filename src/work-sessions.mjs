/** Internal owner-only work contract. Native settlement requires the exact privately retained SDK source. */
import {SessionCreationDriver} from './session-creation.mjs';
import {prepareSessionCreate} from './session-mode.mjs';
import {ownedCreationProofKind,ownedGenerationSourceFor} from './adapter.mjs';
import {loadOwnedGenerationSdk,unknownGenerationObservation} from './owned-generation-bridge.mjs';
import {randomUUID} from 'node:crypto';
import {canonical,digest,requireValue,CommandError} from './errors.mjs';
const commands={queueMessage:'prepareWorkSessionDelivery',executeMessage:'prepareWorkSessionExecution',createSession:'prepareWorkSessionCreation',delegate:'delegateWorkSession',admit:'admitWorkSession',fence:'fenceWorkSession',resume:'resumeWorkSession'};
const names=new Set(Object.values(commands));
const key=(...parts)=>canonical(parts);
const positive=n=>Number.isSafeInteger(n)&&n>0;
function exact(p,keys,optional=[]){requireValue(p && Object.getPrototypeOf(p)===Object.prototype && Object.keys(p).every(k=>keys.includes(k)||optional.includes(k)) && keys.every(k=>Object.hasOwn(p,k)),'invalid_work_payload');}
function string(v,max=200){requireValue(typeof v==='string'&&v.trim().length>0&&v.length<=max,'invalid_work_payload');return v;}
function input(p){exact(p,['task_id','goal','completion_condition']);string(p.task_id);string(p.goal,500);string(p.completion_condition,4000);}
const clone=v=>structuredClone(v);
export const heldWorkSlots=(rows,botId)=>rows.filter(g=>g.botId===botId&&g.held===true).length;
export function validateChildLineage(parent,child){requireValue(parent.depth===0&&child.depth===1,'work_depth_exceeded');requireValue(child.botId===parent.botId&&child.parentTaskId===parent.taskId&&child.parentSessionId===parent.sessionId&&child.parentGeneration===parent.generation,'work_parent_conflict');}

export function createWorkSessionManager(host,{authorize,createTask,runtime}){
 const ledger=host.ledger,instanceId=randomUUID(),runs=new Map();let dispatch;
 if(runtime!==undefined){requireValue(runtime?.kind==='offline-synthetic'&&typeof runtime.start==='function'&&typeof runtime.inspect==='function','unsupported_work_runtime');string(runtime.sourceId);}
 // Retain source and function identities once; subsequent input mutation cannot replace them.
 const source=runtime===undefined?null:Object.freeze({sourceId:runtime.sourceId,start:runtime.start.bind(runtime),inspect:runtime.inspect.bind(runtime)});
 const creationRuns=new Map(),creationPorts=new Map(),deliveryRuns=new Set();
 const work=(botId,id)=>ledger.get('workTask',key(botId,id));
 const generation=(w,n=w.generation)=>ledger.get('workGeneration',key(w.botId,w.taskId,n));
 const saveWork=w=>ledger.put('workTask',key(w.botId,w.task_id),w);
 const saveGeneration=g=>ledger.put('workGeneration',key(g.botId,g.taskId,g.generation),g);
 function check(lease){
  requireValue(!lease.closed,'work_port_disposed');requireValue(!lease.fenced,'work_port_fenced');
  try{authorize(lease.caller);let live;try{live=lease.isCurrent();}catch{live=false;}if(live&&typeof live.then==='function')Promise.resolve(live).catch(()=>{});requireValue(live===true,'unauthorized');if(lease.producer){const active=lease.producer.isCurrent();if(active&&typeof active.then==='function')Promise.resolve(active).catch(()=>{});requireValue(active===true,'unauthorized');}
   const grant=ledger.get('grant','native-owner');requireValue(grant?.active===true&&grant.authority==='private-runtime-owner'&&grant.scope==='owned-text-sessions'&&grant.actor?.kind==='host'&&grant.actor.id===host.ledgerInstanceId&&grant.epoch===lease.authorityEpoch,'unauthorized');
   const b=host.object('bot',lease.botId);requireValue(b.ownerHumanId===host.ownerHumanId&&b.lifecycle==='active'&&b.epoch===lease.botEpoch,'owner_unavailable');requireValue(b.configVersion===lease.configVersion,'configuration_conflict');return b;
  }catch(error){lease.fenced=true;throw error;}
 }
 function checkTask(lease,w){check(lease);requireValue(w?.botId===lease.botId,'not_found');requireValue(w.configVersion===lease.configVersion&&w.authorityEpoch===lease.authorityEpoch&&w.botEpoch===lease.botEpoch,'work_binding_stale');const t=host.object('task',w.taskId);requireValue(t.ownerBotId===lease.botId&&t.ownerBotEpoch===lease.botEpoch&&t.epoch===w.taskEpoch&&t.revision===w.taskRevision&&t.stop.state==='none'&&!t.pendingRevision,'work_task_changed');return w;}
 function current(lease,id){string(id);return checkTask(lease,work(lease.botId,id));}
 function nativeObservation(g){const run=g.runtimeInstanceId===instanceId?runs.get(key(g.botId,g.taskId,g.generation)):null,native=run?.native;if(!native?.generation||canonical(run.binding)!==canonical(g.binding)||native.sdk.isOwnedGenerationSource(native.source,native.ownerCtx)!==true)return unknownGenerationObservation();const observation=native.observation??unknownGenerationObservation();if(observation.settlementVerified&&native.sdk.isOwnedGenerationReceipt(native.receipt,native.source,run.binding)!==true)return{...observation,remote:'UNKNOWN',settlementVerified:false};return observation;}
 function view(w){const g=generation(w),observation=g.evidenceKind==='native-sdk'?nativeObservation(g):g.generationObservation??unknownGenerationObservation();return clone({botId:w.botId,task_id:w.task_id,taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,revision:w.revision,taskEpoch:w.taskEpoch,goal:w.goal,completion_condition:w.completion_condition,delivery:(()=>{const d=ledger.get('workDelivery',key(w.botId,w.taskId,w.generation));return d?{operationId:d.operationId,messageId:d.message.id,sessionId:d.sessionId,generation:d.generation,state:d.state}:null;})(),creationOperationId:w.creationOperationId??null,creationReceipt:w.creationReceipt??null,sessionCreation:w.sessionCreation??{state:'none',proofKind:null},state:g.state,creationState:g.creationState,held:g.held,fence:g.fence,slotLease:g.slotLease,summary:g.summary,unsupported:g.unsupported,evidenceKind:g.evidenceKind,generationObservation:observation,nativeRuntimeVerified:g.evidenceKind==='native-sdk'&&observation.settlementVerified===true});}
 function snapshot(lease,p){check(lease);exact(p,[],['task_ids']);let rows;if(p.task_ids===undefined)rows=ledger.list('workTask').filter(w=>w.botId===lease.botId);else{requireValue(Array.isArray(p.task_ids)&&p.task_ids.length<=500&&Array.from(p.task_ids).every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=200)&&new Set(p.task_ids).size===p.task_ids.length,'invalid_work_query');rows=p.task_ids.map(id=>current(lease,id));}rows.forEach(w=>checkTask(lease,w));return {work:rows.map(view),held:heldWorkSlots(ledger.list('workGeneration'),lease.botId),limit:15,coverage:'owner-contract-ledger',nativeCoverageVerified:false};}
 function continuity(g){requireValue(g.runtimeInstanceId===instanceId&&runs.has(key(g.botId,g.taskId,g.generation)),'work_source_continuity_unsupported');return runs.get(key(g.botId,g.taskId,g.generation));}
 function preflight(actor,e,p){if(!names.has(e?.command))return;requireValue(dispatch&&dispatch.e===e&&dispatch.p===p&&actor?.kind==='host'&&actor.id===host.ledgerInstanceId,'unsupported_host_identity');const {lease}=dispatch;check(lease);
  requireValue(e.authorizationRef==='native-owner'&&e.expectedEpochs?.nativeOwner===lease.authorityEpoch,'unauthorized');requireValue(e.expectedEpochs.bot===lease.botEpoch,'epoch_conflict');requireValue(e.ledgerInstanceId===undefined||e.ledgerInstanceId===host.ledgerInstanceId,'ledger_identity_conflict');
  if(e.command===commands.delegate)input(p);else{exact(p,['task_id','generation'],e.command===commands.fence?['reason']:[]);string(p.task_id);requireValue(positive(p.generation),'invalid_work_payload');if(e.command===commands.fence)requireValue(['terminate','handoff'].includes(p.reason),'invalid_work_payload');}
  // Bot scope is retained authority, not a payload field in canonical-v1 Ledger receipts.
  // Check it even when this Bot has no mapping yet, before either operation or nonce replay.
  const cached=ledger.db.prepare('SELECT receipt FROM operations WHERE id=? OR (actor=? AND nonce=?)').all(e.operationId,canonical(actor),e.nonce);
  for(const row of cached)requireValue(JSON.parse(row.receipt).result?.botId===lease.botId,'work_bot_conflict');
  const w=work(lease.botId,p.task_id);if(w){checkTask(lease,w);for(const row of cached){const previous=JSON.parse(row.receipt).result;requireValue(previous?.taskId===w.taskId&&previous.generation===w.generation&&canonical(previous.fence)===canonical(generation(w).fence),'work_replay_stale');}if(e.command===commands.delegate)requireValue(w.instructionDigest===digest(p),'work_task_conflict');else{requireValue(p.generation===w.generation,'work_generation_conflict');requireValue(e.expectedEpochs.task===w.taskEpoch,'epoch_conflict');const g=generation(w);if(g.runtimeInstanceId!==null)continuity(g);if(e.command!==commands.fence)requireValue(g.fence===null,'work_generation_fenced');}}else requireValue(e.command===commands.delegate,'not_found');
 }
 function legacyBlocked(botId){const tasks=new Set(ledger.list('task').filter(t=>t.ownerBotId===botId).map(t=>t.taskId));const targets=new Set();for(const b of ledger.list('nativeBinding'))for(const [kind,row] of Object.entries(b.targets??{}))if(kind==='execution'&&(row.product?.botId===botId||tasks.has(row.product?.taskId)))targets.add(row.target?.id);
  if(ledger.list('attempt').some(a=>tasks.has(a.taskId)&&(!['settled','failed','queued'].includes(a.execution)||a.stop?.state && !['none','confirmed'].includes(a.stop.state)||a.execution==='queued'&&(a.sessionId!=null||a.runGeneration!=null))))return true;
  return ledger.list('nativeOperation').some(o=>o.kind!=='contact'&&(targets.has(o.targetId)||tasks.has(o.taskId))&&(o.native?.reservationHeld===true||!['prepared','blocked','settled'].includes(o.state)||o.state==='settled'&&o.native?.reservationHeld!==false));
 }
 function initial(w,n){return {botId:w.botId,taskId:w.taskId,sessionId:w.sessionId,generation:n,state:'queued',creationState:'reserved',held:false,fence:null,summary:null,unsupported:null,evidenceKind:'unsupported',runtimeInstanceId:null,binding:null,slotLease:null,receipts:{},sourceSeq:0};}
 function changed(w,g){saveGeneration(g);saveWork({...w,revision:w.revision+1});return view({...w,revision:w.revision+1});}
 function unknown(lease,w,g,code){
  checkTask(lease,w);
  // Observation failure belongs to the exact admitted execution, not just its generation number.
  requireValue(w.botId===g.botId&&w.taskId===g.taskId&&w.sessionId===g.sessionId,'work_receipt_binding_conflict');
  const latest=generation(w,g.generation);
  requireValue(latest&&latest.botId===g.botId&&latest.taskId===g.taskId&&latest.sessionId===g.sessionId
   &&latest.generation===g.generation&&latest.runtimeInstanceId===g.runtimeInstanceId
   &&canonical(latest.binding)===canonical(g.binding)&&canonical(latest.slotLease)===canonical(g.slotLease),'work_receipt_binding_conflict');
  const run=continuity(latest);
  requireValue(canonical(latest.binding)===canonical(run.binding),'work_receipt_binding_conflict');
  // Lack of a new observation cannot revoke proven nonexecution or overwrite a later generation.
  if(latest.fence!==null||w.generation!==g.generation
   ||(!latest.held&&['waiting','completed','failed','archived'].includes(latest.state)))return view(w);
  return changed(w,{...latest,state:'unknown',creationState:latest.creationState==='confirmed'?'confirmed':'unknown',unsupported:code});
 }
 function applyReceipt(lease,id,n,value){return ledger.transaction(()=>{const w=current(lease,id),g=generation(w,n);requireValue(g,'not_found');const run=continuity(g);exact(value,['receiptId','sourceId','sourceSeq','binding','state','execution','creation'],['summary']);string(value.receiptId);requireValue(value.sourceId===source.sourceId&&positive(value.sourceSeq)&&canonical(value.binding)===canonical(run.binding),'work_receipt_binding_conflict');requireValue(['running','settling','unknown','waiting','completed','failed','archived'].includes(value.state)&&['may-execute','quiescent'].includes(value.execution)&&['confirmed','unknown'].includes(value.creation),'invalid_work_receipt');if(value.summary!==undefined)string(value.summary,4000);
   requireValue(!['completed','failed','archived'].includes(value.state)||value.execution==='quiescent','invalid_work_receipt');requireValue(!['running','settling','unknown'].includes(value.state)||value.execution==='may-execute','invalid_work_receipt');
   const hash=digest(value),rk=key(value.receiptId),seen=g.receipts[rk];if(seen){requireValue(seen===hash,'work_receipt_conflict');return view(w);}if(value.sourceSeq<=g.sourceSeq)return view(w);
   // Once quiescent, an old generation can never reacquire execution by receipt.
   requireValue(g.held||value.execution==='quiescent','work_receipt_transition_conflict');
   requireValue(g.state!=='settling'||value.state!=='running','work_receipt_transition_conflict');
   const next={...g,sourceSeq:value.sourceSeq,receipts:{...g.receipts,[rk]:hash},held:value.execution==='quiescent'?false:g.held};
   if(g.fence!==null||w.generation!==n){saveGeneration(next);return view(w);}
   requireValue(!['completed','failed','archived'].includes(g.state),'work_receipt_transition_conflict');
   return changed(w,{...next,state:value.state,creationState:value.creation==='confirmed'?'confirmed':'unknown',summary:value.summary??null,unsupported:null,evidenceKind:'offline-synthetic'});
  });}
 function applyNativeObservation(lease,id,n,value){return ledger.transaction(()=>{
   const w=current(lease,id),g=generation(w,n);requireValue(g,'not_found');const run=continuity(g),native=run.native;
   requireValue(native&&native.generation&&native.sdk.isOwnedGenerationSource(native.source,native.ownerCtx)===true&&canonical(g.binding)===canonical(run.binding)&&canonical(value?.binding)===canonical(run.binding)&&value.inputMessageId===run.binding.inputMessageId&&canonical(g.slotLease)===canonical(run.binding.slotLease),'work_receipt_binding_conflict');
   requireValue(['pending','returned'].includes(value.local)&&['UNKNOWN','settled'].includes(value.remote)&&typeof value.usageKnown==='boolean','invalid_work_receipt');
   const known=value.usageKnown===true&&value.usage&&['inputTokens','outputTokens','totalTokens'].every(k=>Number.isSafeInteger(value.usage[k])&&value.usage[k]>=0)&&value.usage.totalTokens>=value.usage.inputTokens+value.usage.outputTokens;
   const settled=value.remote==='settled'&&known&&native.sdk.isOwnedGenerationReceipt(value.receipt,native.source,run.binding)===true;
   requireValue(value.remote!=='settled'||settled,'work_receipt_binding_conflict');
   const observation={local:value.local,remote:settled?'settled':'UNKNOWN',usageKnown:Boolean(known),usage:known?clone(value.usage):null,settlementVerified:Boolean(settled)};
   native.observation=clone(observation);native.receipt=settled?value.receipt:null;
   if(g.generationObservation?.settlementVerified===true&&!settled)return view(w);
   const next={...g,generationObservation:observation,held:settled?false:g.held};
   // Terminal evidence changes only its exact lease; a fence or newer generation keeps its result.
   if(g.fence!==null||w.generation!==n){if(canonical(g)!==canonical(next))saveGeneration(next);return view(w);}
   const projected={...next,state:settled?'waiting':value.local==='pending'?'running':'unknown',creationState:'confirmed',unsupported:settled?null:'work_receipt_unknown',evidenceKind:'native-sdk'};
   if(canonical(g)===canonical(projected))return view(w);return changed(w,projected);
  });}
 function schedule(lease,w,g){const run=runs.get(key(g.botId,g.taskId,g.generation));queueMicrotask(()=>{
   try{checkTask(lease,work(w.botId,w.task_id));const now=generation(w,g.generation);continuity(now);requireValue(now.fence===null&&work(w.botId,w.task_id).generation===g.generation,'work_generation_fenced');}
   catch{if(!run.started)ledger.transaction(()=>{const now=generation(w,g.generation);if(now?.runtimeInstanceId===instanceId)saveGeneration({...now,held:false,unsupported:'work_start_not_invoked'});});return;}
   run.started=true;
   let starting;try{starting=source.start(clone(run.binding),run.startAbort.signal);}catch(error){starting=Promise.reject(error);}
   Promise.resolve(starting).then(value=>{try{applyReceipt(lease,w.task_id,g.generation,clone(value));}catch{/* Invalid/lifetime-stale receipts do not settle. */}},()=>{try{ledger.transaction(()=>unknown(lease,current(lease,w.task_id),g,'work_start_unknown'));}catch{/* Revoked authority cannot project. */}});
  });}
 const handlers={
  executeMessage(p,e){const lease=dispatch.lease,w=current(lease,p.task_id),g=generation(w);requireValue(lease.producer?.execution===true,'unsupported_work_execution');const dk=key(w.botId,w.taskId,w.generation),previous=ledger.get('workDelivery',dk);if(previous){requireValue(previous.execution===true,'work_execution_delivery_conflict');return view(w);}
   requireValue(!legacyBlocked(w.botId),'legacy_work_unreconciled');requireValue(heldWorkSlots(ledger.list('workGeneration'),w.botId)<15,'capacity_exhausted');
   handlers.queueMessage(p,e);const delivery=ledger.get('workDelivery',dk);ledger.put('workDelivery',dk,{...delivery,execution:true});
   const slotLease={taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,operationId:e.operationId};
   if(dispatch.native){const binding={botId:w.botId,taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,botEpoch:w.botEpoch,taskEpoch:w.taskEpoch,taskRevision:w.taskRevision,authorityEpoch:w.authorityEpoch,configVersion:w.configVersion,operationId:e.operationId,nonce:e.nonce,inputMessageId:delivery.message.id,messageIdentity:digest(delivery.message),slotLease};
    runs.set(dk,{binding:clone(binding),started:false,lookup:null,native:{...dispatch.native,generation:null,cancelled:false}});
    return changed(w,{...g,state:'admitted',creationState:'confirmed',held:true,unsupported:null,slotLease,binding,runtimeInstanceId:instanceId,evidenceKind:'native-sdk',generationObservation:unknownGenerationObservation()});
   }
   return changed(w,{...g,state:'unknown',creationState:'confirmed',held:true,unsupported:'unsupported_work_generation_receipts',slotLease});
  },
  queueMessage(p,e){const lease=dispatch.lease,w=current(lease,p.task_id);requireValue(lease.producer && w.producerProvenance?.producerId===lease.producer.provenance.producerId,'unsupported_work_producer');requireValue(e.expectedRevision===w.revision,'revision_conflict');requireValue(w.sessionCreation?.state==='created','native_creation_unconfirmed');const dk=key(w.botId,w.taskId,w.generation);if(ledger.get('workDelivery',dk))return view(w);
   const binding={botId:w.botId,taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,operationId:e.operationId};const message=lease.producer.createMessage(Object.freeze(clone(binding)),Object.freeze(clone(w.producerProvenance)),`Goal: ${w.goal}\nCompletion condition: ${w.completion_condition}`);
   requireValue(message && typeof message.then!=='function' && typeof message.id==='string' && message.role==='user' && message.source?.kind==='dsh-bot','invalid_producer_message');
   for(const [k,v] of Object.entries({...w.producerProvenance,...binding}))requireValue(message.source[k]===v,'work_message_binding_conflict');
   ledger.put('workDelivery',dk,{...binding,message:clone(message),state:'prepared',deadline:e.deadline});return view(w);
  },
  createSession(p,e){const lease=dispatch.lease,w=current(lease,p.task_id);requireValue(lease.creation,'unsupported_work_creation');requireValue(e.expectedRevision===w.revision,'revision_conflict');
   if(w.creationOperationId){const i=ledger.get('creation',w.creationOperationId);requireValue(i && i.sessionId===w.sessionId && i.taskId===w.taskId && i.cwd===lease.creation.cwd,'work_creation_conflict');return view(w);}
   const request=prepareSessionCreate({cwd:lease.creation.cwd,agentPreset:ledger.get('config',w.configVersion).agentPreset},host.adapter.sessionModeCatalog()).request;
   const i={operationId:e.operationId,sessionId:w.sessionId,kind:'execution',botId:w.botId,botEpoch:w.botEpoch,taskId:w.taskId,taskEpoch:w.taskEpoch,taskRevision:w.taskRevision,configVersion:w.configVersion,authorizationRef:'native-owner',authorityEpoch:w.authorityEpoch,rootHumanInstructionRef:e.rootHumanInstructionRef,deadline:e.deadline,...request,state:'prepared',workBinding:{task_id:w.task_id,generation:w.generation}};
   ledger.put('creation',i.operationId,i);const next={...w,creationOperationId:i.operationId,revision:w.revision+1};saveWork(next);return view(next);
  },
  delegate(p,e){const lease=dispatch.lease,old=work(lease.botId,p.task_id);if(old)return view(old);requireValue(e.expectedRevision===null,'revision_conflict');const taskId=randomUUID(),t=createTask({ownerBotId:lease.botId,title:p.goal,acceptance:p.completion_condition,scope:{namespace:`work-session/${taskId}`,writeResources:[]}},taskId);
   const w={botId:lease.botId,task_id:p.task_id,taskId,sessionId:`session-${randomUUID()}`,generation:1,revision:1,taskEpoch:t.epoch,taskRevision:t.revision,botEpoch:lease.botEpoch,authorityEpoch:lease.authorityEpoch,configVersion:lease.configVersion,goal:p.goal,completion_condition:p.completion_condition,instructionDigest:digest(p),...lease.producer?{producerProvenance:clone(lease.producer.provenance)}:{},depth:0,parentTaskId:null};saveWork(w);saveGeneration(initial(w,1));return view(w);},
  admit(p,e){const lease=dispatch.lease,w=current(lease,p.task_id),g=generation(w);requireValue(e.expectedRevision===w.revision,'revision_conflict');if(g.runtimeInstanceId!==null){continuity(g);return view(w);}requireValue(g.state==='queued','work_state_conflict');let unsupported=!source?'unsupported_work_generation_receipts':legacyBlocked(w.botId)?'legacy_work_unreconciled':heldWorkSlots(ledger.list('workGeneration'),w.botId)>=15?'capacity_exhausted':null;if(unsupported)return changed(w,{...g,unsupported});
   const binding={botId:w.botId,taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,botEpoch:w.botEpoch,taskEpoch:w.taskEpoch,taskRevision:w.taskRevision,configVersion:w.configVersion,authorityEpoch:w.authorityEpoch,operationId:e.operationId};const next={...g,state:'admitted',held:true,evidenceKind:'offline-synthetic',unsupported:null,runtimeInstanceId:instanceId,binding,slotLease:{taskId:w.taskId,sessionId:w.sessionId,generation:w.generation,operationId:e.operationId}};saveGeneration(next);saveWork({...w,revision:w.revision+1});runs.set(key(w.botId,w.taskId,w.generation),{binding:clone(binding),started:false,startAbort:new AbortController(),lookup:null});dispatch.after=()=>schedule(lease,w,next);return view({...w,revision:w.revision+1});},
  fence(p,e){const w=current(dispatch.lease,p.task_id),g=generation(w);requireValue(e.expectedRevision===w.revision,'revision_conflict');if(g.fence!==null)return view(w);return changed(w,{...g,fence:{reason:p.reason,generation:w.generation,operationId:e.operationId},unsupported:g.held?'work_stop_unconfirmed':'work_generation_fenced'});},
  resume(p,e){const w=current(dispatch.lease,p.task_id),g=generation(w),run=continuity(g);requireValue(e.expectedRevision===w.revision,'revision_conflict');requireValue(g.state==='waiting'&&!g.held&&g.fence===null&&(!run.native||nativeObservation(g).settlementVerified),'work_resume_unconfirmed');requireValue(positive(w.generation+1),'work_generation_overflow');saveGeneration({...g,fence:{reason:'resumed',generation:g.generation,operationId:e.operationId}});const next={...w,generation:w.generation+1,revision:w.revision+1};saveWork(next);saveGeneration({...initial(next,next.generation),creationState:g.creationState,evidenceKind:g.evidenceKind});return view(next);}
 };
 for(const [method,name] of Object.entries(commands))host.extensions[name]=function(p,e,actor){preflight(actor,e,p);return handlers[method](p,e);};
 function invoke(lease,method,e,p,native=null){requireValue(!dispatch,'work_in_progress');requireValue(e?.command===commands[method],'unsupported_command');dispatch={lease,e,p,after:null,native};let after;try{const result=host.executeOwned(lease.caller,e,p);after=dispatch.after;return result;}finally{dispatch=undefined;after?.();}}
 async function stop(lease,e,p){p=Object.freeze(clone(p));invoke(lease,'fence',e,p);const w=current(lease,p.task_id),g=generation(w,p.generation);if(g.runtimeInstanceId===null)return view(w);const run=continuity(g);if(!run.native?.generation||run.native.cancelled)return view(w);
  run.native.cancelled=true;let result;try{result=await run.native.source.cancel(run.native.generation);}catch{checkTask(lease,current(lease,p.task_id));return view(current(lease,p.task_id));}checkTask(lease,current(lease,p.task_id));return applyNativeObservation(lease,p.task_id,p.generation,result);
 }
 async function collect(lease,p){check(lease);exact(p,['task_id','generation']);const target=Object.freeze({task_id:p.task_id,generation:p.generation});string(target.task_id);requireValue(positive(target.generation),'invalid_work_payload');const w=current(lease,target.task_id),g=generation(w,target.generation);requireValue(g,'not_found');if(g.runtimeInstanceId===null)return view(w);const run=continuity(g);requireValue(run.lookup===null,'work_lookup_in_progress');const abort=new AbortController();let timer,timedOut=false;
  if(run.native&&!run.native.generation)return view(w);
  const lookup=Promise.resolve().then(()=>{checkTask(lease,current(lease,target.task_id));continuity(g);return run.native?run.native.source.inspect(run.native.generation):source.inspect(clone(run.binding),abort.signal);});run.lookup=lookup;lookup.finally(()=>{if(run.lookup===lookup)run.lookup=null;}).catch(()=>{});
  try{let result;try{result=await Promise.race([lookup,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;abort.abort();resolve(null);},2000);})]);}catch{checkTask(lease,current(lease,target.task_id));return ledger.transaction(()=>unknown(lease,current(lease,target.task_id),g,'work_lookup_failed'));}checkTask(lease,current(lease,target.task_id));if(result===null)return ledger.transaction(()=>unknown(lease,current(lease,target.task_id),g,timedOut?'work_lookup_timeout':'work_receipt_unknown'));return run.native?applyNativeObservation(lease,target.task_id,target.generation,result):applyReceipt(lease,target.task_id,target.generation,clone(result));}
  finally{clearTimeout(timer);abort.abort();}
 }
 async function createSession(lease,e,p){p=Object.freeze(clone(p));const result=invoke(lease,'createSession',e,p).result;const w=current(lease,p.task_id),i=ledger.get('creation',w.creationOperationId);
  // Historical proof survives a new generation and a later nonblank inbox. Never rerun the old driver fence.
  if(w.sessionCreation?.state==='created'){requireValue(i.state==='created' && i.sessionId===w.sessionId,'work_creation_conflict');return view(w);}
  requireValue(i.workBinding.generation===w.generation,'work_generation_conflict');const runKey=i.operationId;requireValue(!creationRuns.has(runKey),'creation_in_progress');creationRuns.set(runKey,true);
  try{let retained=creationPorts.get(runKey);if(!retained){
    // A failed factory is also consumed. Retrying cannot silently replace its authority.
    retained={};creationPorts.set(runKey,retained);
    try{const prepared=clone(i);if(prepared.workBinding)Object.freeze(prepared.workBinding);const port=lease.creation.port??lease.creation.portFor(Object.freeze(prepared));
     if(port && typeof port.then==='function')Promise.resolve(port).catch(()=>{});
     requireValue(port && typeof port.then!=='function' && typeof port.createOwnedSession==='function' && typeof port.inspectOwnedCreation==='function','invalid_creation_port');
     retained.port=port;retained.methods=lease.creation.methods??Object.freeze({createOwnedSession:port.createOwnedSession.bind(port),inspectOwnedCreation:port.inspectOwnedCreation.bind(port)});
    }catch(error){retained.error=error;}
   }if(retained.error)throw retained.error;
   const live=()=>{const now=current(lease,p.task_id);return now.generation===i.workBinding.generation && generation(now).fence===null;};
   const created=await new SessionCreationDriver({host,caller:lease.caller,port:retained.methods,isCurrent:live}).run(lease.caller,i.operationId);
   return ledger.transaction(()=>{const now=current(lease,p.task_id);requireValue(now.generation===i.workBinding.generation && generation(now).fence===null,'work_generation_fenced');const latest=ledger.get('creation',i.operationId);requireValue(latest.sessionId===now.sessionId,'work_creation_conflict');const proofKind=latest.state==='created'?ownedCreationProofKind(retained.port,latest):null;
    const next={...now,revision:now.revision+1,sessionCreation:{state:latest.state==='created'?'created':'unknown',proofKind,operationId:i.operationId,sessionId:i.sessionId,agentPreset:i.agentPreset},creationReceipt:latest.state==='created'?clone(latest.proof):null};saveWork(next);return view(next);});
  }finally{creationRuns.delete(runKey);}
 }
 /** Reopen genuine sealed native history; original ledger rows remain selectors only. */
 async function restoreSession(lease,p){p=Object.freeze(clone(p));exact(p,['task_id','generation']);string(p.task_id);requireValue(positive(p.generation),'invalid_work_payload');const w=current(lease,p.task_id),g=generation(w,p.generation),i=ledger.get('creation',w.creationOperationId);
  requireValue(w.generation===p.generation&&w.depth===0&&g&&g.fence===null&&w.sessionCreation?.state==='created'&&i?.state==='created'&&i.sessionId===w.sessionId&&i.taskId===w.taskId&&lease.creation,'work_restore_unconfirmed');
  if(g.runtimeInstanceId===instanceId){continuity(g);return collect(lease,p);}
  requireValue(g.evidenceKind==='native-sdk'&&g.binding&&g.slotLease||g.runtimeInstanceId===null&&g.binding===null&&!g.held,'work_restore_unconfirmed');
  const originalBinding=clone(g.binding),originalLease=clone(g.slotLease),runKey=i.operationId;requireValue(!creationRuns.has(runKey),'creation_in_progress');creationRuns.set(runKey,true);
  const original=()=>{const now=current(lease,p.task_id),latest=generation(now,p.generation);requireValue(now.taskId===w.taskId&&now.sessionId===w.sessionId&&now.generation===p.generation&&latest.fence===null&&canonical(latest.binding)===canonical(originalBinding)&&canonical(latest.slotLease)===canonical(originalLease),'work_restore_binding_changed');return now;};
  try{let retained=creationPorts.get(runKey);if(!retained){retained={};creationPorts.set(runKey,retained);try{const port=lease.creation.port??lease.creation.portFor(Object.freeze(clone(i)));requireValue(port&&typeof port.then!=='function'&&typeof port.resumeOwnedSession==='function'&&typeof port.inspectOwnedCreation==='function','unsupported_owned_generation_restore');retained.port=port;retained.resume=port.resumeOwnedSession.bind(port);retained.inspect=port.inspectOwnedCreation.bind(port);}catch(error){retained.error=error;}}
   if(retained.error)throw retained.error;requireValue(retained.resume&&retained.inspect,'unsupported_owned_generation_restore');await retained.resume(Object.freeze(clone(i)));original();const proof=await retained.inspect(Object.freeze(clone(i)));original();requireValue(proof?.sessionId===w.sessionId&&proof.agentPreset===i.agentPreset&&proof.blank===false&&proof.globalTools===0&&proof.scopedTools===0,'work_restore_unconfirmed');
   const candidate=ownedGenerationSourceFor(retained.port,i),sdk=await loadOwnedGenerationSdk();original();requireValue(candidate&&sdk.isOwnedGenerationSource(candidate,host.adapter.context)===true,'unsupported_owned_generation_source');
   if(originalBinding===null)return view(original());requireValue(typeof candidate.restore==='function','unsupported_owned_generation_restore');const restored=await candidate.restore(Object.freeze(clone(originalBinding)));original();const value=await candidate.inspect(restored);original();
   requireValue(value?.remote==='settled'&&value.usageKnown===true&&value.inputMessageId===originalBinding.inputMessageId&&canonical(value.binding)===canonical(originalBinding)&&sdk.isOwnedGenerationReceipt(value.receipt,candidate,originalBinding)===true,'work_restore_unconfirmed');
   ledger.transaction(()=>{const now=original(),latest=generation(now,p.generation);runs.set(key(w.botId,w.taskId,p.generation),{binding:clone(originalBinding),started:true,lookup:null,native:{source:candidate,sdk,ownerCtx:host.adapter.context,generation:restored,cancelled:false}});saveGeneration({...latest,runtimeInstanceId:instanceId});});return applyNativeObservation(lease,p.task_id,p.generation,value);
  }finally{creationRuns.delete(runKey);}
 }
 async function queueMessage(lease,e,p,signal,execute=false){p=Object.freeze(clone(p));requireValue(!signal?.aborted,'cancelled');let native=null;
  requireValue(execute||lease.producer?.requireOwnedGeneration!==true,'unsupported_owned_generation_source');
  if(execute){const w=current(lease,p.task_id),i=ledger.get('creation',w.creationOperationId),retained=creationPorts.get(w.creationOperationId),candidate=retained?.port&&i?ownedGenerationSourceFor(retained.port,i):null;if(candidate){const sdk=await loadOwnedGenerationSdk();checkTask(lease,current(lease,p.task_id));requireValue(sdk.isOwnedGenerationSource(candidate,host.adapter.context)===true,'unsupported_owned_generation_source');native={source:candidate,sdk,ownerCtx:host.adapter.context};}}
  requireValue(native||lease.producer?.requireOwnedGeneration!==true,'unsupported_owned_generation_source');
  invoke(lease,execute?'executeMessage':'queueMessage',e,p,native);const initial=current(lease,p.task_id),dk=key(initial.botId,initial.taskId,p.generation);requireValue(!deliveryRuns.has(dk),'work_delivery_in_progress');deliveryRuns.add(dk);
  const valid=()=>{requireValue(!signal?.aborted,'cancelled');const w=current(lease,p.task_id),g=generation(w);requireValue(w.generation===p.generation && g.fence===null,'work_generation_fenced');const d=ledger.get('workDelivery',dk);requireValue(d && d.sessionId===w.sessionId && d.message.source.producerId===lease.producer.provenance.producerId,'work_message_binding_conflict');requireValue(d.deadline===null || Date.parse(d.deadline)>Date.now(),'deadline_expired');return {w,d};};
  try{let {w,d}=valid();if(d.state==='durably-queued')return view(w);const first=d.state==='prepared';
   if(first){ledger.transaction(()=>{const {d:latest}=valid();ledger.put('workDelivery',dk,{...latest,state:'sending'});});
    const g=generation(w),run=g.runtimeInstanceId===instanceId?continuity(g):null;
    if(run?.native){run.started=true;try{valid();requireValue(run.native.source===native?.source,'work_receipt_binding_conflict');const generationHandle=run.native.source.start(Object.freeze(clone(run.binding)),Object.freeze(clone(d.message)));requireValue(generationHandle&&typeof generationHandle==='object'&&typeof generationHandle.then!=='function','unsupported_owned_generation_source');run.native.generation=generationHandle;}catch{ledger.transaction(()=>unknown(lease,current(lease,p.task_id),g,'work_start_unknown'));}}
    else try{valid();await lease.producer.send(Object.freeze(clone(d)),Object.freeze(clone(d.message)),signal);}catch{/* Ambiguous effects are reconciled only by the original message identity. */}}
   valid();let proven=false;try{proven=await lease.producer.inspect(Object.freeze(clone(d)),Object.freeze(clone(d.message)),signal)===true;}catch{/* No receipt is proof of execution. */}
   const delivered=ledger.transaction(()=>{const {w:now,d:latest}=valid();ledger.put('workDelivery',dk,{...latest,state:proven?'durably-queued':'unknown'});return view(now);});
   const g=generation(current(lease,p.task_id));return execute&&g.runtimeInstanceId===instanceId&&continuity(g).native?.generation?collect(lease,p):delivered;
  }catch(error){ledger.transaction(()=>{const d=ledger.get('workDelivery',dk);if(d && !['durably-queued','fenced'].includes(d.state))ledger.put('workDelivery',dk,{...d,state:'unknown'});});throw error;}finally{deliveryRuns.delete(dk);}
 }
 function open(caller,options){authorize(caller);exact(options,['botId','botEpoch','authorityEpoch'],['isCurrent','creation','producer']);string(options.botId);requireValue(positive(options.botEpoch)&&positive(options.authorityEpoch)&&(options.isCurrent===undefined||typeof options.isCurrent==='function'),'invalid_work_options');const b=host.object('bot',options.botId),lease={caller,botId:b.botId,botEpoch:options.botEpoch,authorityEpoch:options.authorityEpoch,configVersion:b.configVersion,isCurrent:options.isCurrent??(()=>true),closed:false,fenced:false};
  if(options.creation){const c=options.creation;requireValue(c && typeof c.cwd==='string' && (c.port===undefined)!==(c.portFor===undefined),'invalid_creation_options');requireValue(c.portFor===undefined || typeof c.portFor==='function','invalid_creation_options');lease.creation={cwd:c.cwd,port:c.port,portFor:c.portFor};if(c.port!==undefined){requireValue(c.port && typeof c.port.createOwnedSession==='function' && typeof c.port.inspectOwnedCreation==='function','invalid_creation_port');lease.creation.methods=Object.freeze({createOwnedSession:c.port.createOwnedSession.bind(c.port),inspectOwnedCreation:c.port.inspectOwnedCreation.bind(c.port)});}}if(options.producer){const p=options.producer;requireValue(p && typeof p.provenance?.producerId==='string' && ['owner','bot-tool'].includes(p.provenance.ingress) && typeof p.provenance.originSessionId==='string' && ['isCurrent','createMessage','send','inspect'].every(k=>typeof p[k]==='function'),'invalid_work_producer');requireValue(p.requireOwnedGeneration===undefined||typeof p.requireOwnedGeneration==='boolean','invalid_work_producer');lease.producer={execution:p.execution===true,requireOwnedGeneration:p.requireOwnedGeneration===true,provenance:clone(p.provenance),...Object.fromEntries(['isCurrent','createMessage','send','inspect'].map(k=>[k,p[k].bind(p)]))};}check(lease);
  return Object.freeze({executeMessage:(e,p,signal)=>queueMessage(lease,e,p,signal,true),queueMessage:(e,p,signal)=>queueMessage(lease,e,p,signal),createSession:(e,p)=>createSession(lease,e,p),restoreSession:p=>restoreSession(lease,p),delegate:(e,p)=>invoke(lease,'delegate',e,p),admit:(e,p)=>invoke(lease,'admit',e,p),fence:(e,p)=>invoke(lease,'fence',e,p),stop:(e,p)=>stop(lease,e,p),resume:(e,p)=>invoke(lease,'resume',e,p),query:p=>snapshot(lease,p),collect:p=>collect(lease,p),dispose:()=>{lease.closed=true;},spawnChild:p=>{check(lease);exact(p,['parentTaskId','parentSessionId','parentGeneration','task_id','goal','completion_condition']);input({task_id:p.task_id,goal:p.goal,completion_condition:p.completion_condition});const w=ledger.list('workTask').find(w=>w.botId===lease.botId&&w.taskId===p.parentTaskId);checkTask(lease,w);validateChildLineage(w,{...p,botId:lease.botId,depth:w.depth+1});requireValue(generation(w).fence===null,'work_generation_fenced');return {status:'unsupported',code:'child_spawn_unsupported'};}});
 }
 return Object.freeze({open,preflight});
}
