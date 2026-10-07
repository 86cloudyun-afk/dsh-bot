/** Private Loader owner composition. No caller, Host, ledger, or capability is a public service. */
import {Context,symbols} from '@deepseek-ai/cordis';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {randomUUID} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {Host} from './host.mjs';
import {Ledger} from './ledger.mjs';
import {DshAdapter} from './adapter.mjs';
import {SessionCreationDriver} from './session-creation.mjs';
import {prepareOwnedBotProducer} from './bot-producer.mjs';
import {installSelectedBotContactOwner} from './selected-bot-contact-owner.mjs';
import {installExplicitOperatorReadBinding} from './explicit-operator-read-binding.mjs';
import {canonical,digest,requireValue,text} from './errors.mjs';
import {freezeInitialSessionMode,isBlankInitialSessionEvents} from './initial-session-blank.mjs';
import {createGuiGenerationPreparation} from './bot-gui-generation-preparation.mjs';
import {loadOwnedGenerationSdk} from './owned-generation-bridge.mjs';
import {freezeGuiDelegationPolicy} from './bot-gui-delegation-policy.mjs';
import {installBotGuiColdOwner} from './bot-gui-cold-owner.mjs';
import {isOwnedBotLifecycleRestoreGrant,describeOwnedBotLifecycleRestore} from './owned-bot-lifecycle.mjs';

export const name='dsh-bot-gui-owner-app';
export const inject=['appReady','appExit','dshBotGuiStartup','connection','webServer','llm','deepseekProtectedProviders','sessions',
  'sessionProjections','sessionPersistence','tools','agents','agentPresets','sessionQuery','sessionController','agentDefaultModel','workspaceRegistry'];
const identity = service => service?.[symbols.original] ?? service;
const active = fiber => fiber?.state === 2 && fiber?.uid !== null;
const exact = (value,keys) => requireValue(value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k)), 'gui_payload_invalid');
const operationId = value => requireValue(typeof value === 'string' && value.length > 0 && value.length <= 128,'gui_payload_invalid');
const creationView = row => row ? {version:1,operationId:row.operationId,nonce:row.nonce,state:row.state === 'created'?'created':'unknown',
  botId:row.botId ?? null,sessionId:row.sessionId ?? null,preciseNativeSettlementVerified:false} : null;

export async function installBotGuiOwner({ownerCtx,homeDirectory,cwd,agentPreset='dsh-bot/empty',
  route={provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'},modelRequestsEnabled=false,initialMode,delegationPolicy}) {
  requireValue(ownerCtx instanceof Context && [homeDirectory,cwd].every(v => typeof v === 'string' && isAbsolute(v)), 'gui_owner_required');
  const owner=ownerCtx.fiber, connection=identity(ownerCtx.get('connection')), peer=connection?.operator;
  requireValue(connection instanceof HostConnectionService && peer?.ctx instanceof Context && scopeOf(peer.ctx) === peer,'gui_actual_operator_required');
  requireValue(typeof modelRequestsEnabled === 'boolean','gui_model_gate_required');
  text(agentPreset,'agentPreset',200);
  exact(route,['provider','model','reasoning']);
  const modelRoute=Object.freeze({provider:text(route.provider,'provider',100),model:text(route.model,'model',200),reasoning:text(route.reasoning,'reasoning',40)});
  const initialization=initialMode===undefined?undefined:freezeInitialSessionMode(initialMode);
  const delegation=freezeGuiDelegationPolicy(delegationPolicy);
  const ledger=new Ledger(join(homeDirectory,'bot-gui.sqlite'));
  const host=new Host({ledger,ownerHumanId:'this-home-authenticated-gui-owner',ownerCapability:owner,adapter:new DshAdapter(ownerCtx)});
  const authorityEpoch=ledger.get('grant','native-owner')?.epoch;
  const generation=Object.freeze({activation:randomUUID()});
  let closed=false,selected=null,contactOwner=null,producer=null,creationTail=Promise.resolve(),readBinding=null,mainGenerationSource=null,generationSdk=null,closePromise=null,lifecyclePort=null;
  const mainPorts=new Map(),pendingActions=new Set(),restoreStages=new WeakMap();
  let stagedMain=null;
  let contactIsCold=false;
  // Only an exact SDK-minted, privately retained source may enable this main dialog.
  const nativeSourceAvailable=()=>mainGenerationSource!==null&&generationSdk?.isOwnedGenerationSource(mainGenerationSource,ownerCtx)===true;
  const delegationConfirmed=()=>selected!==null&&ledger.list('guiCreationOperation').some(row=>row.botId===selected.botId
    &&row.sessionId===selected.sessionId&&canonical(row.initialDelegationPolicy??null)===canonical(delegation));
  const modelStatus=()=>!modelRequestsEnabled?'disabled':nativeSourceAvailable()&&delegationConfirmed()&&dispatchCurrent()?'available':'unconfirmed';
  const currentGeneration=()=>!closed && identity(ownerCtx.get('connection')) === connection && connection.operator === peer ? generation : null;
  function lifetime(actualPeer=peer,signal) {
    requireValue(!closed && active(owner) && active(peer.ctx.fiber) && actualPeer === peer && currentGeneration() === generation,'gui_owner_stale');
    requireValue(!signal?.aborted,'gui_cancelled');
    const grant=ledger.get('grant','native-owner');
    requireValue(grant?.active && grant.epoch === authorityEpoch && grant.actor?.id === host.ledgerInstanceId,'gui_authority_changed');
  }
  function current(actualPeer=peer,signal) {
    lifetime(actualPeer,signal);
    if(selected) {
      const bot=host.object('bot',selected.botId);
      requireValue(bot.epoch === selected.botEpoch && bot.configVersion === selected.configVersion
        && bot.contactSessionId === selected.sessionId && bot.lifecycle === 'active','gui_binding_changed');
    }
  }
  function dispatchCurrent(){try{current();return true;}catch{return false;}}
  const generationPreparation=createGuiGenerationPreparation({ownerCtx,host,homeDirectory,cwd,agentPreset,route:modelRoute,initialization,
    isOwnerCurrent:()=>{try{lifetime();return true;}catch{return false;}},canModelDispatch:()=>modelStatus()==='available'});
  function envelope(command,payload,row,revision=null,epochs={}) {
    return {operationId:row.operationId,nonce:row.nonce,command,payloadDigest:digest(payload),expectedRevision:revision,
      expectedEpochs:{nativeOwner:authorityEpoch,...epochs},rootHumanInstructionRef:'authenticated-single-bot-gui-owner',
      authorizationRef:'native-owner',createdAt:row.createdAt,deadline:null};
  }
  function execute(command,payload,row,revision=null,epochs={}) {
    current();return host.executeOwned(owner,envelope(command,payload,row,revision,epochs),payload).result;
  }
  const readPort=host.createOwnedBotTaskReadPort(owner,{isCurrent:()=>{try{lifetime();return true;}catch{return false;}}});
  readBinding=installExplicitOperatorReadBinding({ownerCtx,expectedHost:host,readPort});
  const selectRead=botId=>readBinding.select({audience:'this-host-authenticated-operator',botIds:botId?[botId]:[],taskIds:[]});
  selectRead(null);
  function boundInitialMode(row) {
    requireValue(canonical(row.initialMode??null)===canonical(initialization??null),'gui_initial_mode_changed');
    return row.initialMode==null?undefined:freezeInitialSessionMode(row.initialMode);
  }
  function boundDelegationPolicy(row){requireValue(canonical(row.initialDelegationPolicy??null)===canonical(delegation),'gui_delegation_policy_changed');}
  function mainPort(intent,row) {
    boundDelegationPolicy(row);
    let port=mainPorts.get(intent.operationId);
    if(!port) {
      port=host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'main',initialization:boundInitialMode(row),
        isCurrent:()=>{try{current();return true;}catch{return false;}},
        prepareGeneration:(original,options)=>generationPreparation.prepare(original,{role:'main',create:options.mode==='create',
          mainSessionId:original.sessionId,...(options.delegateTool?{delegateTool:options.delegateTool}:{})})});
      mainPorts.set(intent.operationId,port);
    }
    return port;
  }
  const modelGate=ownerCtx.on('agent/pre-step', (event,next) => {
    current();
    requireValue(modelStatus()==='available','gui_model_requests_disabled');
    const id=event.agent?.id;
    requireValue(selected && (id === selected.sessionId || ledger.list('workTask').some(w => w.botId === selected.botId && w.sessionId === id)),'gui_agent_scope_denied');
    requireValue(ownerCtx.tools.schemas().length === 0,'gui_global_tools_denied');
    const tools=ownerCtx.tools.schemas(event.agent).map(t=>t.name);
    requireValue(id === selected.sessionId ? canonical(tools) === canonical(['dsh_bot_delegate'])
      :producer?.assertWorkAgentTools(event.agent)===true,'gui_agent_tools_denied');
    return next();
  });
  function prepareProducer(intent,port,botEpoch,mode,lifecycleRestoreGrant){
    return prepareOwnedBotProducer({ownerCtx,host,caller:owner,originSessionId:intent.sessionId,botId:intent.botId,botEpoch,
      authorityEpoch,cwd,rootInstructionRef:'authenticated-single-bot-main-goal',...(lifecycleRestoreGrant?{lifecycleRestoreGrant}:{}),
      execution:{isCurrent:dispatchCurrent,canExecute:()=>dispatchCurrent()&&modelStatus()==='available',beforeExecute:async()=>{current();},
        generationControl:{initialization:mode,
          prepareWorkGeneration:(work,options)=>generationPreparation.prepare(work,{role:'work',create:options.mode==='create',mainSessionId:intent.sessionId,
            ...(options.delegateTool?{delegateTool:options.delegateTool}:{}),...(options.plannedBinding?{plannedBinding:options.plannedBinding}:{})}),
          prepareChildGeneration:(work,options)=>generationPreparation.prepareChild(work,{create:options.mode==='create',mainSessionId:intent.sessionId,
            parentSource:options.parentSource,parentGeneration:options.parentGeneration,parentBinding:options.parentBinding,plannedBinding:options.plannedBinding}),
          bindMainDelegateTool:definition=>{current();const source=host.adapter.bindOwnedMainGeneration(port,intent,definition);
            requireValue(generationSdk?.isOwnedGenerationSource(source,ownerCtx)===true,'gui_owned_source_required');mainGenerationSource=source;return source;}}}});
  }
  function installContact(agent,bot){
    contactOwner?.dispose();
    contactOwner=installSelectedBotContactOwner({ownerCtx,expectedHost:host,connection,peer,connectionGeneration:generation,
      getConnectionGeneration:currentGeneration,selectedBotId:bot.botId,botEpoch:bot.epoch,authorityEpoch,contactAgent:agent,
      requireOwnedGeneration:true,generationSource:mainGenerationSource,canSend:()=>{current();return modelStatus()==='available';}});
    contactIsCold=false;
  }
  function coldRead(bot,{keepProducer=false,keepLifecycle=true}={}){
    lifetime();if(!keepProducer){producer?.dispose();producer=null;}
    if(!keepLifecycle){lifecyclePort?.dispose?.();lifecyclePort=null;}
    mainGenerationSource=null;
    if(contactIsCold&&selected?.botId===bot.botId&&selected.botEpoch===bot.epoch&&selected.sessionId===bot.contactSessionId)return;
    contactOwner?.dispose();
    selected=Object.freeze({botId:bot.botId,botEpoch:bot.epoch,configVersion:bot.configVersion,sessionId:bot.contactSessionId});selectRead(bot.botId);
    contactOwner=installBotGuiColdOwner({ownerCtx,host,connection,peer,connectionGeneration:generation,getConnectionGeneration:currentGeneration,
      botId:bot.botId,mainSessionId:bot.contactSessionId,isOwnerCurrent:()=>{try{lifetime();return true;}catch{return false;}}});
    contactIsCold=true;
  }
  async function prepareRestore(intent,options){
    lifetime();requireValue(selected?.botId===intent.botId&&isOwnedBotLifecycleRestoreGrant(options.grant,host,owner,intent)===true,'gui_restore_grant_required');
    const future=describeOwnedBotLifecycleRestore(options.grant,host,owner,intent);
    const original=ledger.list('guiCreationOperation').find(row=>row.botId===intent.botId&&row.sessionId===future.mainSessionId);
    requireValue(original,'gui_original_receipt_required');boundDelegationPolicy(original);const mode=boundInitialMode(original);
    let stage=restoreStages.get(options.grant),port;
    if(options.role==='main'){
      requireValue(!stage&&intent.sessionId===future.mainSessionId,'gui_restore_binding_changed');
      stage={grant:options.grant,future,intent,port:null,preparation:null,source:null};
      port=host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'main',initialization:mode,
        isCurrent:()=>{try{lifetime();return isOwnedBotLifecycleRestoreGrant(options.grant,host,owner,intent)===true;}catch{return false;}},
        prepareGeneration:(actual,preparedOptions)=>generationPreparation.prepareRestore(actual,{...options,delegateTool:preparedOptions.delegateTool})});
      stage.port=port;stage.preparation=prepareProducer(intent,port,future.botEpoch,mode,options.grant);restoreStages.set(options.grant,stage);
      const definition=stage.preparation.delegateTool;
      return Object.freeze({port,delegateTool:definition,bindDelegate:()=>{lifetime();
        const source=stage.preparation.bindRestoredDelegate(ownerCtx.agents.get(intent.sessionId),intent,port);
        requireValue(generationSdk?.isOwnedGenerationSource(source,ownerCtx)===true,'gui_owned_source_required');stage.source=source;stagedMain=stage;return source;}});
    }
    requireValue(stage&&stage.future.mainSessionId===options.mainSessionId&&stage.future.botEpoch===future.botEpoch,'gui_restore_binding_changed');
    const definition=intent.workDepth===0?stage.preparation.workDelegateFor(intent):undefined;
    port=host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'work',initialization:mode,...definition?{delegateTool:definition}:{},
      isCurrent:()=>{try{lifetime();return isOwnedBotLifecycleRestoreGrant(options.grant,host,owner,intent)===true;}catch{return false;}},
      prepareGeneration:actual=>generationPreparation.prepareRestore(actual,{...options,...definition?{delegateTool:definition}:{}})});
    return Object.freeze({port,...definition?{delegateTool:definition,bindDelegate:()=>{lifetime();return stage.preparation.bindRestoredDelegate(ownerCtx.agents.get(intent.sessionId),intent,port);}}:{}});
  }
  async function releaseArchivedSessions(grant){
    lifetime();const bot=host.object('bot',selected.botId),intent=ledger.get('creation',bot.creationIntentId);
    requireValue(isOwnedBotLifecycleRestoreGrant(grant,host,owner,intent)===true,'gui_restore_grant_required');
    // Cold preflight already owns the new exclusive journal and selectors; those remain unchanged.
    if(describeOwnedBotLifecycleRestore(grant,host,owner,intent).cold)return;
    const port=mainPorts.get(intent.operationId);requireValue(port,'gui_original_receipt_required');
    await host.adapter.closeOwnedGenerationSession(port,intent,grant);lifetime();
    producer?.dispose();producer=null;mainGenerationSource=null;
    await generationPreparation.releaseArchivedJournals(grant);lifetime();
  }
  async function openLifecycle(bot,{port,intent}={}){
    lifetime();requireValue(typeof host.openOwnedBotLifecyclePort==='function','gui_control_unavailable');
    generationSdk??=await loadOwnedGenerationSdk();lifetime();
    lifecyclePort=await host.openOwnedBotLifecyclePort(owner,{botId:bot.botId,botEpoch:bot.epoch,authorityEpoch,
      isOwnerCurrent:()=>{try{lifetime();return true;}catch{return false;}},...port?{mainCreationPort:port,mainCreationIntent:intent}:{},
      readOriginalCreation:original=>generationPreparation.readOriginalCreation(original),
      inspectOriginalHistory:(original,options)=>generationPreparation.inspectOriginalHistory(original,options),
      releaseArchivedSessions,prepareRestore});lifetime();
  }
  function activateRestoredMain(){
    lifetime();const stage=stagedMain;requireValue(stage&&stage.source&&generationSdk?.isOwnedGenerationSource(stage.source,ownerCtx)===true,'gui_owned_source_required');
    const bot=host.object('bot',stage.intent.botId),agent=ownerCtx.agents.get(stage.intent.sessionId);
    requireValue(bot.lifecycle==='active'&&bot.epoch===stage.future.botEpoch&&bot.configVersion===stage.future.configVersion
      &&bot.contactSessionId===stage.intent.sessionId&&agent?.id===bot.contactSessionId&&agent.session?.id===bot.contactSessionId
      &&scopeOf(agent.ctx)===agent&&ownerCtx.tools.schemas().length===0&&ownerCtx.tools.schemas(agent).length===1
      &&ownerCtx.tools.get('dsh_bot_delegate',agent)===stage.preparation.delegateTool,'gui_restore_binding_changed');
    selected=Object.freeze({botId:bot.botId,botEpoch:bot.epoch,configVersion:bot.configVersion,sessionId:agent.id});current();
    mainGenerationSource=stage.source;producer=stage.preparation.attach(agent);requireValue(nativeSourceAvailable(),'gui_owned_source_required');
    installContact(agent,bot);mainPorts.set(stage.intent.operationId,stage.port);selectRead(bot.botId);
    ledger.put('guiOwner','selected',{botId:bot.botId,sessionId:agent.id,configVersion:bot.configVersion,botEpoch:bot.epoch});stagedMain=null;
  }
  async function bindMain(bot,checkpoint,{fresh=false}={}) {
    checkpoint();
    requireValue(bot.lifecycle === 'active' && bot.contactSessionId && ledger.get('config',bot.configVersion)?.agentPreset === agentPreset,'gui_main_binding_unconfirmed');
    if(selected) {requireValue(selected.botId === bot.botId && selected.sessionId === bot.contactSessionId,'gui_single_bot_required');requireValue(contactOwner&&producer&&nativeSourceAvailable(),'gui_main_binding_unconfirmed');return;}
    const log=await ownerCtx.sessionController.inspect(bot.contactSessionId);checkpoint();
    requireValue(log?.meta?.id === bot.contactSessionId && log.meta.cwd === cwd && log.meta.agentPreset === agentPreset
      && log.meta.isSeeded === false && Array.isArray(log.events),'gui_main_log_unconfirmed');
    const original=ledger.list('guiCreationOperation').find(row=>row.botId===bot.botId&&row.sessionId===bot.contactSessionId);
    requireValue(original,'gui_original_receipt_required');
    boundDelegationPolicy(original);
    const intent=ledger.get('creation',original.creationOperation?.operationId);
    requireValue(intent?.state==='created'&&intent.sessionId===bot.contactSessionId&&intent.botId===bot.botId,'gui_original_receipt_required');
    const mode=boundInitialMode(original),prefixLength=mode?3:0;
    requireValue(isBlankInitialSessionEvents(log.events.slice(0,prefixLength),mode)
      && !log.events.slice(prefixLength).some(event=>['permission/preset','sandbox/mode','approval/policy'].includes(event.type)),'gui_initial_mode_changed');
    if(fresh) requireValue(isBlankInitialSessionEvents(log.events,mode),'gui_main_not_blank');
    const port=mainPort(intent,original);
    const preparedProducer=prepareProducer(intent,port,bot.epoch,mode);
    if(!fresh) {
      requireValue(ownerCtx.agents.get(intent.sessionId)===undefined,'gui_unprotected_main_active');
      await port.resumeOwnedSession(intent,{delegateTool:preparedProducer.delegateTool});checkpoint();
    }
    const proof=await port.inspectOwnedCreation(intent);checkpoint();
    requireValue(proof?.sessionId===intent.sessionId&&proof.agentPreset===agentPreset&&proof.globalTools===0&&proof.scopedTools===0
      &&proof.blank===fresh,'gui_main_scope_unconfirmed');
    generationSdk=await loadOwnedGenerationSdk();checkpoint();
    const agent=ownerCtx.agents.get(intent.sessionId);
    requireValue(agent?.id === bot.contactSessionId && agent.session?.id === bot.contactSessionId
      && ownerCtx.agents.get(agent.id) === agent && scopeOf(agent.ctx) === agent
      && ownerCtx.tools.schemas().length === 0 && ownerCtx.tools.schemas(agent).length === 0,'gui_main_scope_unconfirmed');
    if(fresh) requireValue(isBlankInitialSessionEvents(agent.session.snapshotEvents(),mode,agent.session.seq),'gui_main_not_blank');
    selected=Object.freeze({botId:bot.botId,botEpoch:bot.epoch,configVersion:bot.configVersion,sessionId:agent.id});
    current();
    producer=preparedProducer.attach(agent);
    requireValue(nativeSourceAvailable(),'gui_owned_source_required');
    installContact(agent,bot);
    await openLifecycle(bot,{port,intent});checkpoint();
    selectRead(bot.botId);
    ledger.put('guiOwner','selected',{botId:bot.botId,sessionId:agent.id,configVersion:bot.configVersion,botEpoch:bot.epoch});
  }
  function rowFor(payload) {
    const row=ledger.get('guiCreationOperation',payload.operationId);
    requireValue(row && row.nonce === payload.nonce,'gui_original_receipt_required');
    boundInitialMode(row);
    boundDelegationPolicy(row);
    return row;
  }
  async function finishCreation(original,checkpoint) {
    checkpoint();let row=rowFor(original);
    // The product effects replay their original immutable envelopes; native creation uses its original intent.
    if(!row.botId) {
      requireValue(ledger.list('bot').length === 0 || ledger.list('bot').length === 1,'gui_single_bot_required');
      const payload={name:row.name,config:{contact:modelRoute,execution:modelRoute,agentPreset}};
      const bot=execute('createBot',payload,row.botOperation);
      checkpoint();row={...row,botId:bot.botId};ledger.put('guiCreationOperation',row.operationId,row);
    }
    let bot=host.object('bot',row.botId);
    requireValue(ledger.list('bot').length === 1 && bot.lifecycle === 'active','gui_single_bot_required');
    if(!row.creationOperation) {
      row={...row,creationOperation:{operationId:randomUUID(),nonce:randomUUID(),createdAt:row.createdAt,revision:bot.revision,botEpoch:bot.epoch}};
      ledger.put('guiCreationOperation',row.operationId,row);
    }
    if(!row.sessionId) {
      const payload={botId:bot.botId,cwd},intent=execute('prepareContactSession',payload,row.creationOperation,row.creationOperation.revision,{bot:row.creationOperation.botEpoch});
      checkpoint();row={...row,sessionId:intent.sessionId};ledger.put('guiCreationOperation',row.operationId,row);
    }
    const creation=ledger.get('creation',row.creationOperation.operationId);
    requireValue(creation?.sessionId === row.sessionId && creation.botId === row.botId,'gui_creation_binding_unconfirmed');
    if(creation.state !== 'created') {
      await new SessionCreationDriver({host,caller:owner,port:mainPort(creation,row),
        isCurrent:()=>{try{checkpoint();return true;}catch{return false;}}}).run(owner,creation.operationId);
      checkpoint();
    }
    if(ledger.get('creation',creation.operationId)?.state !== 'created') return creationView(row);
    bot=host.object('bot',row.botId);
    await bindMain(bot,checkpoint,{fresh:ownerCtx.agents.get(row.sessionId)!==undefined&&row.state!=='created'});checkpoint();
    row={...row,state:'created'};ledger.put('guiCreationOperation',row.operationId,row);
    return creationView(row);
  }
  function bootstrap() {
    lifetime();
    const rows=ledger.list('guiCreationOperation');
    requireValue(rows.length <= 1 && ledger.list('bot').length <= 1,'gui_single_bot_required');
    return {version:1,status:'ready',ledgerId:host.ledgerInstanceId,selectedBotId:selected?.botId ?? null,
      contactSessionId:selected?.sessionId ?? null,modelRequestsEnabled:modelStatus()==='available',modelDispatchStatus:modelStatus(),creation:creationView(rows[0]),nativeGenerationTerminalSupported:nativeSourceAvailable(),controls:controlsView()};
  }
  const syncTrue=fn=>{try{const result=fn();if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});return result===true;}catch{return false;}};
  function controlsView(){
    lifetime();if(!selected)return null;const bot=host.object('bot',selected.botId);
    let native={botEpoch:bot.epoch,lifecycle:bot.lifecycle,canArchive:false,canRestore:false};
    if(lifecyclePort)try{const query=lifecyclePort.query();lifetime();requireValue(query?.botEpoch===bot.epoch&&query.lifecycle===bot.lifecycle
      &&typeof query.canArchive==='boolean'&&typeof query.canRestore==='boolean','gui_lifecycle_unconfirmed');native=query;}catch{lifetime();}
    const work=ledger.list('workTask').filter(row=>row.botId===selected.botId);requireValue(work.length<=500,'gui_read_scope_exceeded');
    return{version:1,botId:bot.botId,botEpoch:bot.epoch,lifecycle:bot.lifecycle,
      canArchive:bot.lifecycle==='active'&&native.canArchive===true,canRestore:bot.lifecycle==='archived'&&native.canRestore===true,
      work:work.map(row=>({taskId:row.taskId,sessionId:row.sessionId,generation:row.generation,
        canContinue:modelStatus()==='available'&&syncTrue(()=>producer?.canContinueOriginalWork({taskId:row.taskId,sessionId:row.sessionId,generation:row.generation}))}))};
  }
  async function controlAction(endpoint,payload,signal,checkpoint){
    requireValue(selected&&payload.botId===selected.botId,'gui_control_scope_denied');
    if(['continueWork','inspectWorkContinuation'].includes(endpoint)){
      exact(payload,['operationId','nonce','botId','taskId','sessionId','generation']);operationId(payload.operationId);operationId(payload.nonce);
      text(payload.taskId,'taskId',200);text(payload.sessionId,'sessionId',200);requireValue(Number.isSafeInteger(payload.generation)&&payload.generation>0,'gui_payload_invalid');
      const request={operationId:payload.operationId,nonce:payload.nonce,taskId:payload.taskId,sessionId:payload.sessionId,generation:payload.generation};
      const method=endpoint==='continueWork'?'continueOriginalWork':'inspectOriginalWorkContinuation';
      requireValue(producer&&typeof producer[method]==='function','gui_control_unavailable');
      if(endpoint==='continueWork')requireValue(modelStatus()==='available','gui_model_requests_disabled');
      checkpoint();const value=await producer[method](Object.freeze(request),signal);checkpoint();
      requireValue(value?.botId===selected.botId&&value.operationId===request.operationId&&value.nonce===request.nonce
        &&value.taskId===request.taskId&&value.sessionId===request.sessionId&&value.originalGeneration===request.generation,'gui_control_unconfirmed');
      return{version:1,operationId:value.operationId,nonce:value.nonce,botId:value.botId,taskId:value.taskId,sessionId:value.sessionId,
        originalGeneration:value.originalGeneration,generation:value.generation,state:value.state,generationObservation:value.generationObservation,
        preciseNativeSettlementVerified:value.preciseNativeSettlementVerified};
    }
    const inspect=endpoint==='inspectBotLifecycle';
    exact(payload,inspect?['operationId','nonce','botId']:['operationId','nonce','botId','botEpoch']);operationId(payload.operationId);operationId(payload.nonce);
    if(!inspect)requireValue(Number.isSafeInteger(payload.botEpoch)&&payload.botEpoch>0,'gui_payload_invalid');
    const method=inspect?'inspectOriginalBotLifecycle':endpoint==='archiveBot'?'archiveOriginalBot':'restoreOriginalBot';
    requireValue(lifecyclePort&&typeof lifecyclePort[method]==='function','gui_control_unavailable');
    let value;
    try{
      checkpoint();value=await lifecyclePort[method](Object.freeze({...payload}),signal);checkpoint();
      requireValue(value?.operationId===payload.operationId&&value.nonce===payload.nonce&&value.botId===selected.botId,'gui_control_unconfirmed');
      if(value.state==='accepted'&&value.nativeRestoreVerified===true&&stagedMain)activateRestoredMain();
    }finally{
      lifetime();const live=host.object('bot',selected.botId);
      if(live.lifecycle==='archived')coldRead(live,{keepProducer:true});
    }
    const bot=host.object('bot',selected.botId);
    return{version:1,operationId:payload.operationId,nonce:payload.nonce,botId:bot.botId,botEpoch:bot.epoch,lifecycle:bot.lifecycle,
      state:value.state==='accepted'?'accepted':'unknown',preciseNativeSettlementVerified:false};
  }
  const handler=async(endpoint,payload,signal,actualPeer)=>{
    const lifecycle=['archiveBot','restoreBot','inspectBotLifecycle'].includes(endpoint);
    const checkpoint=()=>endpoint==='bootstrap'||lifecycle?lifetime(actualPeer,signal):current(actualPeer,signal);
    try {
      checkpoint();
      if(endpoint === 'bootstrap') {exact(payload,[]);return {ok:true,value:bootstrap()};}
      if(['continueWork','inspectWorkContinuation','archiveBot','restoreBot','inspectBotLifecycle'].includes(endpoint)){
        const action=controlAction(endpoint,payload,signal,checkpoint);pendingActions.add(action);
        try{return{ok:true,value:await action};}finally{pendingActions.delete(action);}
      }
      requireValue(['createBot','reconcileCreate'].includes(endpoint),'gui_endpoint_unsupported');
      if(endpoint === 'createBot') {exact(payload,['operationId','nonce','name']);text(payload.name,'name',100);}
      else exact(payload,['operationId','nonce']);
      operationId(payload.operationId);operationId(payload.nonce);
      const work=async()=>{
        checkpoint();
        if(endpoint === 'createBot') {
          let row=ledger.get('guiCreationOperation',payload.operationId);
          if(row) requireValue(row.nonce === payload.nonce && row.binding === digest(payload),'gui_create_conflict');
          else {
            requireValue(ledger.list('guiCreationOperation').length === 0 && ledger.list('bot').length === 0,'gui_single_bot_required');
            row={operationId:payload.operationId,nonce:payload.nonce,binding:digest(payload),name:payload.name,
              initialMode:initialization??null,initialDelegationPolicy:delegation,state:'unknown',createdAt:new Date().toISOString(),botOperation:{operationId:randomUUID(),nonce:randomUUID(),createdAt:new Date().toISOString()}};
            ledger.put('guiCreationOperation',row.operationId,row);
          }
        }
        const row=rowFor(payload);
        return finishCreation(row,checkpoint);
      };
      const result=creationTail.then(work);
      creationTail=result.catch(()=>{});
      const value=await result;checkpoint();return {ok:true,value};
    } catch {
      return {ok:false,error:{code:'dsh-bot-gui/action-unconfirmed',message:'action-unconfirmed',details:{}}};
    }
  };
  const unregister=ownerCtx.get('connection').rpc.handle('/dsh-bot-gui',handler);
  const dispose=()=>{
    if(closePromise)return closePromise;closed=true;
    contactOwner?.dispose();producer?.dispose();lifecyclePort?.dispose?.();readBinding?.close();modelGate();void unregister?.();
    // In-flight native operations observe closed before touching the database again.
    closePromise=Promise.allSettled([creationTail,...pendingActions]).then(async()=>{await generationPreparation.close();ledger.close();});return closePromise;
  };
  ownerCtx.effect(()=>()=>dispose());
  try {
    current();await host.adapter.refreshSessionModeCatalog();current();
    for(const original of ledger.list('guiCreationOperation')){boundInitialMode(original);if(original.initialDelegationPolicy!==undefined)boundDelegationPolicy(original);}
    const saved=ledger.get('guiOwner','selected');
    if(saved) {
      const bot=host.object('bot',saved.botId);
      requireValue(saved.sessionId === bot.contactSessionId && saved.configVersion === bot.configVersion
        && Number.isSafeInteger(saved.botEpoch)&&saved.botEpoch>0&&saved.botEpoch<=bot.epoch,'gui_saved_identity_changed');
      try{generationSdk=await loadOwnedGenerationSdk();lifetime();}catch{lifetime();}
      if(typeof generationSdk?.selectOwnedGenerationHistory==='function'){
        // Complete original tree preflight precedes every native resume; an UNKNOWN descendant keeps the entire Bot read-only.
        coldRead(bot);
        try{
          await openLifecycle(bot);
          if(bot.lifecycle==='active'){
            const recovered=await lifecyclePort.recoverOriginalBot();lifetime();
            requireValue(recovered?.botId===bot.botId&&recovered.botEpoch===bot.epoch&&recovered.lifecycle==='active'&&recovered.state==='accepted','gui_recovery_unconfirmed');
            activateRestoredMain();
          }
        }catch{coldRead(host.object('bot',bot.botId));}
      }else if(bot.lifecycle==='active'&&saved.botEpoch===bot.epoch){
        // Earlier journal SDKs remain internal diagnostics; they do not qualify the final M2 owner path.
        try {await bindMain(bot,()=>current());current();}
        catch {coldRead(bot);}
      }else coldRead(bot);
    }
    bootstrap();
    return Object.freeze({dispose});
  } catch(error) {dispose();throw error;}
}

export function apply(ctx,config={}) {
  requireValue(ctx instanceof Context,'gui_loader_owner_required');
  ctx.appReady.onReady(()=>{
    void installBotGuiOwner({ownerCtx:ctx,...config,modelRequestsEnabled:ctx.dshBotGuiStartup.modelRequestsEnabled})
      .catch(()=>{process.stderr.write('dsh-bot GUI: owner startup unconfirmed; preserved original state\n');ctx.appExit(1);});
  });
}
