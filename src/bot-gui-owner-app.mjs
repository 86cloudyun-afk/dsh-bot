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

export const name='dsh-bot-gui-owner-app';
export const inject=['appReady','appExit','dshBotGuiStartup','connection','webServer','llm','deepseekProtectedProviders','sessions',
  'sessionProjections','sessionPersistence','tools','agents','agentPresets','sessionQuery','sessionController','agentDefaultModel'];
const identity = service => service?.[symbols.original] ?? service;
const active = fiber => fiber?.state === 2 && fiber?.uid !== null;
const exact = (value,keys) => requireValue(value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k)), 'gui_payload_invalid');
const operationId = value => requireValue(typeof value === 'string' && value.length > 0 && value.length <= 128,'gui_payload_invalid');
const creationView = row => row ? {version:1,operationId:row.operationId,nonce:row.nonce,state:row.state === 'created'?'created':'unknown',
  botId:row.botId ?? null,sessionId:row.sessionId ?? null,preciseNativeSettlementVerified:false} : null;

export async function installBotGuiOwner({ownerCtx,homeDirectory,cwd,agentPreset='dsh-bot/empty',
  route={provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'},modelRequestsEnabled=false,initialMode}) {
  requireValue(ownerCtx instanceof Context && [homeDirectory,cwd].every(v => typeof v === 'string' && isAbsolute(v)), 'gui_owner_required');
  const owner=ownerCtx.fiber, connection=identity(ownerCtx.get('connection')), peer=connection?.operator;
  requireValue(connection instanceof HostConnectionService && peer?.ctx instanceof Context && scopeOf(peer.ctx) === peer,'gui_actual_operator_required');
  requireValue(typeof modelRequestsEnabled === 'boolean','gui_model_gate_required');
  text(agentPreset,'agentPreset',200);
  exact(route,['provider','model','reasoning']);
  const modelRoute=Object.freeze({provider:text(route.provider,'provider',100),model:text(route.model,'model',200),reasoning:text(route.reasoning,'reasoning',40)});
  const initialization=initialMode===undefined?undefined:freezeInitialSessionMode(initialMode);
  const ledger=new Ledger(join(homeDirectory,'bot-gui.sqlite'));
  const host=new Host({ledger,ownerHumanId:'this-home-authenticated-gui-owner',ownerCapability:owner,adapter:new DshAdapter(ownerCtx)});
  const authorityEpoch=ledger.get('grant','native-owner')?.epoch;
  const generation=Object.freeze({activation:randomUUID()});
  let closed=false,selected=null,contactOwner=null,producer=null,creationTail=Promise.resolve(),readBinding=null,mainGenerationSource=null,generationSdk=null,closePromise=null;
  const mainPorts=new Map();
  // Only an exact SDK-minted, privately retained source may enable this main dialog.
  const nativeSourceAvailable=()=>mainGenerationSource!==null&&generationSdk?.isOwnedGenerationSource(mainGenerationSource,ownerCtx)===true;
  const modelStatus=()=>!modelRequestsEnabled?'disabled':nativeSourceAvailable()?'available':'unconfirmed';
  const currentGeneration=()=>!closed && identity(ownerCtx.get('connection')) === connection && connection.operator === peer ? generation : null;
  function current(actualPeer=peer,signal) {
    requireValue(!closed && active(owner) && active(peer.ctx.fiber) && actualPeer === peer && currentGeneration() === generation,'gui_owner_stale');
    requireValue(!signal?.aborted,'gui_cancelled');
    const grant=ledger.get('grant','native-owner');
    requireValue(grant?.active && grant.epoch === authorityEpoch && grant.actor?.id === host.ledgerInstanceId,'gui_authority_changed');
    if(selected) {
      const bot=host.object('bot',selected.botId);
      requireValue(bot.epoch === selected.botEpoch && bot.configVersion === selected.configVersion
        && bot.contactSessionId === selected.sessionId && bot.lifecycle === 'active','gui_binding_changed');
    }
  }
  const generationPreparation=createGuiGenerationPreparation({ownerCtx,host,homeDirectory,cwd,agentPreset,route:modelRoute,initialization,
    isOwnerCurrent:()=>{try{current();return true;}catch{return false;}},canModelDispatch:()=>modelStatus()==='available'});
  function envelope(command,payload,row,revision=null,epochs={}) {
    return {operationId:row.operationId,nonce:row.nonce,command,payloadDigest:digest(payload),expectedRevision:revision,
      expectedEpochs:{nativeOwner:authorityEpoch,...epochs},rootHumanInstructionRef:'authenticated-single-bot-gui-owner',
      authorizationRef:'native-owner',createdAt:row.createdAt,deadline:null};
  }
  function execute(command,payload,row,revision=null,epochs={}) {
    current();return host.executeOwned(owner,envelope(command,payload,row,revision,epochs),payload).result;
  }
  const readPort=host.createOwnedBotTaskReadPort(owner,{isCurrent:()=>{try{current();return true;}catch{return false;}}});
  readBinding=installExplicitOperatorReadBinding({ownerCtx,expectedHost:host,readPort});
  const selectRead=botId=>readBinding.select({audience:'this-host-authenticated-operator',botIds:botId?[botId]:[],taskIds:[]});
  selectRead(null);
  function boundInitialMode(row) {
    requireValue(canonical(row.initialMode??null)===canonical(initialization??null),'gui_initial_mode_changed');
    return row.initialMode==null?undefined:freezeInitialSessionMode(row.initialMode);
  }
  function mainPort(intent,row) {
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
  const modelGate=ownerCtx.on('agent/pre-step', event => {
    current();
    requireValue(modelStatus()==='available','gui_model_requests_disabled');
    const id=event.agent?.id;
    requireValue(selected && (id === selected.sessionId || ledger.list('workTask').some(w => w.botId === selected.botId && w.sessionId === id)),'gui_agent_scope_denied');
    requireValue(ownerCtx.tools.schemas().length === 0,'gui_global_tools_denied');
    const tools=ownerCtx.tools.schemas(event.agent).map(t=>t.name);
    requireValue(id === selected.sessionId ? canonical(tools) === canonical(['dsh_bot_delegate']) : tools.length === 0,'gui_agent_tools_denied');
  });
  async function bindMain(bot,checkpoint,{fresh=false}={}) {
    checkpoint();
    requireValue(bot.lifecycle === 'active' && bot.contactSessionId && ledger.get('config',bot.configVersion)?.agentPreset === agentPreset,'gui_main_binding_unconfirmed');
    if(selected) {requireValue(selected.botId === bot.botId && selected.sessionId === bot.contactSessionId,'gui_single_bot_required');requireValue(contactOwner&&producer&&nativeSourceAvailable(),'gui_main_binding_unconfirmed');return;}
    const log=await ownerCtx.sessionController.inspect(bot.contactSessionId);checkpoint();
    requireValue(log?.meta?.id === bot.contactSessionId && log.meta.cwd === cwd && log.meta.agentPreset === agentPreset
      && log.meta.isSeeded === false && Array.isArray(log.events),'gui_main_log_unconfirmed');
    const original=ledger.list('guiCreationOperation').find(row=>row.botId===bot.botId&&row.sessionId===bot.contactSessionId);
    requireValue(original,'gui_original_receipt_required');
    const intent=ledger.get('creation',original.creationOperation?.operationId);
    requireValue(intent?.state==='created'&&intent.sessionId===bot.contactSessionId&&intent.botId===bot.botId,'gui_original_receipt_required');
    const mode=boundInitialMode(original),prefixLength=mode?3:0;
    requireValue(isBlankInitialSessionEvents(log.events.slice(0,prefixLength),mode)
      && !log.events.slice(prefixLength).some(event=>['permission/preset','sandbox/mode','approval/policy'].includes(event.type)),'gui_initial_mode_changed');
    if(fresh) requireValue(isBlankInitialSessionEvents(log.events,mode),'gui_main_not_blank');
    const port=mainPort(intent,original);
    const preparedProducer=prepareOwnedBotProducer({ownerCtx,host,caller:owner,originSessionId:intent.sessionId,botId:bot.botId,botEpoch:bot.epoch,
      authorityEpoch,cwd,rootInstructionRef:'authenticated-single-bot-main-goal',execution:{isCurrent:()=>{try{current();return true;}catch{return false;}},
        beforeExecute:async()=>{current();},generationControl:{initialization:mode,
          prepareWorkGeneration:(work,options)=>generationPreparation.prepare(work,{role:'work',create:options.mode==='create',mainSessionId:intent.sessionId}),
          bindMainDelegateTool:definition=>{current();const source=host.adapter.bindOwnedMainGeneration(port,intent,definition);
            requireValue(generationSdk?.isOwnedGenerationSource(source,ownerCtx)===true,'gui_owned_source_required');mainGenerationSource=source;return source;}}}});
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
    contactOwner=installSelectedBotContactOwner({ownerCtx,expectedHost:host,connection,peer,connectionGeneration:generation,
      getConnectionGeneration:currentGeneration,selectedBotId:bot.botId,botEpoch:bot.epoch,authorityEpoch,contactAgent:agent,requireOwnedGeneration:true,generationSource:mainGenerationSource,
      canSend:()=>{current();return modelStatus()==='available';}});
    selectRead(bot.botId);
    ledger.put('guiOwner','selected',{botId:bot.botId,sessionId:agent.id,configVersion:bot.configVersion,botEpoch:bot.epoch});
  }
  function rowFor(payload) {
    const row=ledger.get('guiCreationOperation',payload.operationId);
    requireValue(row && row.nonce === payload.nonce,'gui_original_receipt_required');
    boundInitialMode(row);
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
    current();
    const rows=ledger.list('guiCreationOperation');
    requireValue(rows.length <= 1 && ledger.list('bot').length <= 1,'gui_single_bot_required');
    return {version:1,status:'ready',ledgerId:host.ledgerInstanceId,selectedBotId:selected?.botId ?? null,
      contactSessionId:selected?.sessionId ?? null,modelRequestsEnabled:modelStatus()==='available',modelDispatchStatus:modelStatus(),creation:creationView(rows[0]),nativeGenerationTerminalSupported:nativeSourceAvailable()};
  }
  const handler=async(endpoint,payload,signal,actualPeer)=>{
    const checkpoint=()=>current(actualPeer,signal);
    try {
      checkpoint();
      if(endpoint === 'bootstrap') {exact(payload,[]);return {ok:true,value:bootstrap()};}
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
              initialMode:initialization??null,state:'unknown',createdAt:new Date().toISOString(),botOperation:{operationId:randomUUID(),nonce:randomUUID(),createdAt:new Date().toISOString()}};
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
    contactOwner?.dispose();producer?.dispose();readBinding?.close();modelGate();void unregister?.();
    // In-flight native operations observe closed before touching the database again.
    closePromise=creationTail.finally(async()=>{await generationPreparation.close();ledger.close();});return closePromise;
  };
  ownerCtx.effect(()=>()=>dispose());
  try {
    current();await host.adapter.refreshSessionModeCatalog();current();
    for(const original of ledger.list('guiCreationOperation'))boundInitialMode(original);
    const saved=ledger.get('guiOwner','selected');
    if(saved) {
      const bot=host.object('bot',saved.botId);
      requireValue(saved.sessionId === bot.contactSessionId && saved.configVersion === bot.configVersion
        && saved.botEpoch === bot.epoch,'gui_saved_identity_changed');
      try {await bindMain(bot,()=>current());current();}
      catch {current();selected=Object.freeze({botId:bot.botId,botEpoch:bot.epoch,configVersion:bot.configVersion,sessionId:bot.contactSessionId});selectRead(bot.botId);}
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
