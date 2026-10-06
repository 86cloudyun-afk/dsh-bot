/** Process-private OS/runtime-owner app over native cmdline and the existing protected controller. */
import { Context } from '@deepseek-ai/cordis';
import { isDeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek';
import { SessionId } from '@deepseek-ai/dsh-session';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OwnedNativeController } from './native-controller.mjs';
import { Ledger } from './ledger.mjs';
import { CommandError,requireValue,canonical,digest } from './errors.mjs';
import { parseOwnerCommand,listenOwnerLines } from './owner-input.mjs';
import { ownerState,OWNER_LABEL } from './owner-state.mjs';
import { verifyConfiguredCandidate,observeExecutingRuntime } from './acceptance-source-files.mjs';
import { explainOperation } from './operation-explanation.mjs';
export const name='dsh-bot-owner-app';
export const inject=['dshBotOwnerStartup','appReady','appExit','llm','sessions','sessionProjections','sessionPersistence','tools','agents','agentPresets','deepseekProtectedProviders'];
const defaultCapacity={executionSlots:1,contactSlots:1,executionTokens:40000,contactTokens:40000,tokenReservationPerStep:20000,maxSteps:1,admissionDeadlineMs:2000,settlementDeadlineMs:7000};
function safeOperation(p){const n=p.native,code=p.errorCategory ?? n?.failureCode;return {operationId:p.operationId,nativeOperationId:p.nativeOperationId,state:p.state,
 errorCategory:code==null?null:errorCategory({code}),reservationHeld:n?.reservationHeld ?? null,localTransport:n?.localTransport ?? null,
 remoteExecution:n?.remoteExecution ?? null,usage:n?.usage ?? null,answers:n?.answers ?? [],attemptCount:n?.attempts.length ?? 0,
 receipt:n?.attempts.at(-1)?.sessionReceipt ?? null,stopControlId:p.stop?.controlId ?? null,explanation:explainOperation(p)};}
function errorCategory(error){return typeof error?.code==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(error.code)?error.code:'owner_runtime_unconfirmed';}
export async function apply(ctx,config={}){
 requireValue(ctx instanceof Context && ctx.fiber && ctx.get('llm') && ctx.get('sessionPersistence'),'unsupported_host_identity');
 const startup=ctx.get('dshBotOwnerStartup'),ready=ctx.get('appReady'),exit=ctx.get('appExit');
 requireValue(startup && typeof ready?.onReady==='function' && typeof exit==='function','unsupported_host_identity');
 requireValue(ctx.tools.schemas().length===0,'owner_tools_not_empty');
 const preset=config.agentPreset ?? 'owner/empty',maxTokens=config.maxTokens ?? {contact:160,execution:600};
 requireValue(typeof preset==='string' && preset.trim().length>0 && ['contact','execution'].every(kind=>Number.isSafeInteger(maxTokens[kind]) && maxTokens[kind]>0),'invalid_owner_config');
 const factory=ctx.deepseekProtectedProviders.lookup('deepseek-official');requireValue(isDeepSeekProviderFactory(factory,ctx.get('llm')),'native_provider_factory_required');
 const acceptanceRuntime=config.acceptanceSource===undefined?undefined:observeExecutingRuntime({launcher:process.argv[1],
  native:fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-experimental-native-run')),owner:fileURLToPath(import.meta.url),
  controller:fileURLToPath(import.meta.resolve('./native-controller.mjs'))});
 const state=await ownerState(config.homeDirectory,startup.mode),capacity=startup.mode==='resume'?state.binding.capacity:structuredClone(config.capacity ?? defaultCapacity);
 if(startup.mode==='resume')for(const kind of ['contact','execution']){
  let stored;try{stored=await ctx.sessionPersistence.stat(SessionId(state.entry.sessions[kind]));}catch{requireValue(false,'owner_state_incomplete');}
  const binding=state.binding.targets[kind].target.sessionBinding;
  requireValue(stored?.header.id===binding.sessionId && stored.header.cwd===state.home
   && stored.header.agentPreset===binding.agentPreset && stored.sizeBytes>0,'owner_state_incomplete');
 }
 const input=config.input ?? process.stdin,output=config.output ?? process.stdout,caller=ctx.fiber;
 const acceptanceGuard=config.acceptanceSource===undefined?undefined:({operationId,kind,steps,acceptanceSourceVersion})=>{
  const verified=verifyConfiguredCandidate(config.acceptanceSource,acceptanceRuntime);
  requireValue(operationId===verified.prepareFrame.operationId && kind===verified.prepareFrame.kind && steps.length===1 && steps[0]===verified.text,'candidate_input_changed');
  if(acceptanceSourceVersion!==undefined)requireValue(acceptanceSourceVersion===verified.sourceVersion,'candidate_source_changed');
  return verified.sourceVersion;
 };
 let ledger,controller,entry,closed=false,detach=()=>{},removeReady=()=>{},bootPromise,cleanupPromise;
 const pending=new Map(),running=new Map();
 const emit=value=>output.write(JSON.stringify(value)+'\n');
 const fail=(error,command)=>emit({event:'error',...command?{command:command.command,...command.operationId?{operationId:command.operationId}:{}}:{},errorCategory:errorCategory(error)});
 const cleanup=()=>cleanupPromise ??= (async()=>{try{await bootPromise;}catch{/* Failed startup retains its own data; native cleanup still owns acquired resources. */}
  await controller?.close(caller);ledger?.close();})();
 const requestExit=code=>{if(closed)return;closed=true;detach();
  void (async()=>{let timer;try{await Promise.race([cleanup(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CommandError('owner_cleanup_timeout')),5000);})]);exit(code);}
   catch(error){fail(error,{command:'close'});exit(code || 1);}finally{clearTimeout(timer);}})();
 };
 ctx.effect(()=>async()=>{closed=true;detach();removeReady();await cleanup();});
 function command(name,payload={},expectedRevision=null,id=randomUUID()){
  const prior=ledger.get('ownerCommand',id);let envelope;
  if(prior){requireValue(prior.envelope.command===name && prior.envelope.expectedRevision===expectedRevision && canonical(prior.payload)===canonical(payload),'owner_operation_conflict');envelope=prior.envelope;}
  else{envelope={operationId:id,nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision,expectedEpochs:{},
    rootHumanInstructionRef:'explicit-os-runtime-owner-input',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline:null};
   ledger.transaction(()=>ledger.put('ownerCommand',id,{envelope,payload:structuredClone(payload)}));}
  return controller.command(caller,envelope,payload);
 }
 const reply=(frame,p)=>emit({event:'result',command:frame.command,operation:safeOperation(p)});
 function ownedTask(){
  const creation=ledger.get('creation',entry.executionCreationId),task=creation && ledger.get('task',creation.taskId);
  requireValue(task && creation.sessionId===entry.sessions.execution,'owner_state_incomplete');return task;
 }
 const progressView=p=>{const {configSnapshot,policySnapshot,...view}=p;return view;};
 async function handle(frame){
  // Native FiberState.ACTIVE is the fixed runtime const-enum value 2. Disposal
  // changes it synchronously, before Cordis starts awaiting cleanup effects.
  requireValue(!closed && caller.state===2,'owner_entry_closed');
  if(frame.command==='close'){emit({event:'result',command:'close',state:'closing'});requestExit(0);return;}
  if(frame.command==='status'){emit({event:'result',command:'status',authority:'private-runtime-owner',publicHumanAuthorityVerified:false,
    modelRequestsEnabled:startup.modelRequestsEnabled,sessions:entry.sessions,operations:controller.snapshot(caller).nativeOperations.map(safeOperation)});return;}
  if(frame.command==='progress'){const task=ownedTask();emit({event:'result',command:'progress',authority:'private-runtime-owner',publicHumanAuthorityVerified:false,
   authorityEpoch:ledger.get('grant','native-owner')?.epoch ?? null,task,progress:ledger.list('progress').filter(p=>p.taskId===task.taskId).map(progressView),
   operations:controller.snapshot(caller).nativeOperations.map(safeOperation)});return;}
  const id=frame.operationId;requireValue(!pending.has(id),'owner_operation_busy');
  if(['plan','advance','submit','accept'].includes(frame.command)){
   const task=ownedTask();let result;
   if(frame.command==='plan')result=command('createProgressPlan',{taskId:task.taskId,steps:frame.steps},frame.expectedRevision,id).result;
   else if(frame.command==='advance'){
    requireValue(ledger.get('progress',frame.planId)?.taskId===task.taskId,'scope_denied');
    result=command('advanceTask',{planId:frame.planId,eventId:id,cursor:frame.cursor,trigger:'authorized_check'},frame.expectedRevision,id).result;
   }else if(frame.command==='submit')result=command('submitTask',{taskId:task.taskId,artifactDigest:frame.artifactDigest,evidence:frame.evidence,
    expectedAuthorityEpoch:frame.expectedAuthorityEpoch},frame.expectedRevision,id).result;
   else result=command('acceptTask',{taskId:task.taskId,artifactDigest:frame.artifactDigest,acceptanceVersion:frame.acceptanceVersion,outcome:frame.outcome},frame.expectedRevision,id).result;
   emit({event:'result',command:frame.command,operationId:id,authority:'private-runtime-owner',publicHumanAuthorityVerified:false,
    ...['plan','advance'].includes(frame.command)?{progress:progressView(result)}:{task:result}});return;
  }
  if(frame.command==='prepare'){reply(frame,command('prepareNativeTextOperation',{kind:frame.kind,steps:[frame.text]},null,id).result);return;}
  if(frame.command==='inspect'){reply(frame,controller.inspect(caller,id));return;}
  if(frame.command==='run'){
   requireValue(startup.modelRequestsEnabled,'owner_model_requests_disabled');
   if(running.has(id)){emit({event:'started',command:'run',operationId:id});return;}
   const existing=controller.inspect(caller,id);requireValue(existing.state!=='prepared','owner_operation_not_admitted');
   if(existing.state!=='admitted'){reply(frame,existing);return;}
   emit({event:'started',command:'run',operationId:id});
   const work=controller.drive(caller,id).then(p=>{if(!closed)reply(frame,p);},error=>{if(!closed)fail(error,frame);}).finally(()=>running.delete(id));running.set(id,work);return;
  }
  const work=(async()=>{
   if(frame.command==='admit')return controller.admit(caller,id);
   requireValue(frame.command==='stop','invalid_owner_command');
   // Slash is excluded from caller IDs, keeping internal controls disjoint.
   const stop=command('stopNativeTextOperation',{operationId:id},null,`owner-stop/${id}`);return controller.stop(caller,stop.operationId);
  })();pending.set(id,work);
  try{const p=await work;if(!closed)reply(frame,p);}finally{pending.delete(id);}
 }
 async function boot(){
  ledger=new Ledger(state.database);controller=new OwnedNativeController({ctx,ledger,ownerLabel:OWNER_LABEL,directory:state.journal,capacity,acceptanceGuard});
  await controller.refreshModes(caller);requireValue(!closed,'owner_entry_closed');
  if(startup.mode==='init'){
   const bot=command('createBot',{name:'Native owner Bot',config:{contact:{provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'},agentPreset:preset}}).result;
   const task=command('createTask',{ownerBotId:bot.botId,title:'Explicit owner text work',scope:{namespace:'owner-text-only',writeResources:[]},acceptance:'Inspect actual original-ID text receipt'}).result;
   const contact=command('prepareContactSession',{botId:bot.botId,cwd:state.home},ledger.get('bot',bot.botId).revision).result;
   const execution=command('prepareExecutionSession',{botId:bot.botId,taskId:task.taskId,cwd:state.home},ledger.get('bot',bot.botId).revision).result;
   entry={format:1,home:state.home,ledgerInstanceId:ledger.get('meta','instance').id,contactCreationId:contact.operationId,executionCreationId:execution.operationId,
    sessions:{contact:contact.sessionId,execution:execution.sessionId}};
   await controller.open(caller,{contactCreationId:contact.operationId,executionCreationId:execution.operationId,create:true,maxTokens});
   for(const id of [contact.operationId,execution.operationId]){requireValue(!closed,'owner_entry_closed');requireValue((await controller.createSession(caller,id)).state==='created','owner_creation_unconfirmed');}
   requireValue(!closed,'owner_entry_closed');await writeFile(state.entryPath,JSON.stringify(entry)+'\n',{flag:'wx',mode:0o600});
  }else{entry=state.entry;await controller.open(caller,{contactCreationId:entry.contactCreationId,executionCreationId:entry.executionCreationId,create:false});}
  requireValue(!closed,'owner_entry_closed');
 }
 bootPromise=boot();await bootPromise;
 removeReady=ready.onReady(()=>{
  if(closed)return;emit({event:'ready',authority:'private-runtime-owner',publicHumanAuthorityVerified:false,modelRequestsEnabled:startup.modelRequestsEnabled,
   requestedProvider:'deepseek-official',requestedModel:'deepseek-flash',modelTools:ctx.tools.schemas().length,sessions:entry.sessions});
  detach=listenOwnerLines(input,line=>{let frame;try{frame=parseOwnerCommand(line);}catch(error){fail(error);return;}
   void handle(frame).catch(error=>{if(!closed)fail(error,frame);});},error=>fail(error),requestExit);
 });
}
