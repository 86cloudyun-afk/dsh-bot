import { canonical,requireValue,text } from './errors.mjs';
import { emptyPresetCatalog,normalizePresetCatalog,presetId } from './session-mode.mjs';
import {freezeInitialSessionMode,isBlankInitialSessionEvents} from './initial-session-blank.mjs';
import {loadOwnedGenerationSdk} from './owned-generation-bridge.mjs';
export const REQUIRED_NATIVE=Object.freeze(['session_model','dispatch_freeze','operation_lookup','run_fence','resource_settlement','producer','scope_enforce','interaction_capacity']);
// Cordis Service.tracker is public per-instance metadata; property reads create fresh proxies.
// Compare that identity only. Keep calling through the traced service, never unwrap its implementation.
const registryIdentity=registry=>registry?.[Symbol.for('cordis.tracker')] ?? registry;
const durablePorts=new WeakMap();
const generationPorts=new WeakMap();
const creationCoordinates=i=>canonical([i.operationId,i.sessionId,i.cwd,i.agentPreset,i.kind??null,i.botId,i.botEpoch,i.configVersion,i.authorityEpoch,i.taskId??null,i.taskEpoch??null,i.taskRevision??null]);
/** Private exact-port lookup; neither copied ports nor historical JSON recover a source. */
export function ownedGenerationSourceFor(port,intent){const retained=generationPorts.get(port),row=retained?.rows.get(intent?.operationId);if(!row)return null;retained.check(intent);requireValue(row.coordinates===creationCoordinates(intent),'native_creation_binding_changed');return row.source??null;}
/** Internal evidence query: labels or copied/wrapped ports cannot mint this identity. */
export const ownedCreationProofKind=(port,intent)=>durablePorts.get(port)?.has(intent.operationId)?'stock-session-durable':'fixture-contract';
export class DshAdapter {
  #modeCatalog=emptyPresetCatalog();
  #modeRead=0;
  #modeRegistry;
  constructor(context=null) { this.context=context; }
  capabilities() { return Object.fromEntries(REQUIRED_NATIVE.map(k=>[k,{status:'unsupported',evidence:'0.2.0-rc.2 public contract insufficient; no live verification'}])); }
  async listSessions(scope) {
    requireValue(this.context?.sessionController,'host_disconnected');
    const result=await this.context.sessionController.list({},new AbortController().signal);
    // No recent-window fallback and no resolveAgent. Archived coverage is explicit.
    const ids=new Set(scope.sessionIds);
    return {items:result.items.filter(x=>ids.has(x.sessionId ?? x.id)),complete:false,coverage:'authorized visible ordinary sessions only; archived/subagent coverage unverified',observedAt:new Date().toISOString()};
  }
  async inspectSession(id,scope) {
    requireValue(scope.sessionIds.includes(id),'scope_denied');
    requireValue(this.context?.sessionController,'host_disconnected');
    return this.context.sessionController.inspect(id,new AbortController().signal);
  }
  sessionModeCatalog() {
    if(this.#modeRegistry!==registryIdentity(this.context?.agentPresets)) {
      this.#modeRead++;this.#modeRegistry=registryIdentity(this.context?.agentPresets);
      this.#modeCatalog=emptyPresetCatalog('Registry changed; explicit refresh required','unavailable');
    }
    return this.#modeCatalog;
  }
  async refreshSessionModeCatalog() {
    const read=++this.#modeRead,registry=this.context?.agentPresets,identity=registryIdentity(registry);this.#modeRegistry=identity;
    this.#modeCatalog=emptyPresetCatalog('Mode metadata refresh pending','unavailable');
    if(typeof registry?.list!=='function') {
      this.#modeCatalog=emptyPresetCatalog();return this.#modeCatalog;
    }
    try {
      const rows=await registry.list();
      requireValue(identity===registryIdentity(this.context?.agentPresets),'mode_registry_changed');
      const catalog=normalizePresetCatalog(rows,registry.defaultId);
      if(read===this.#modeRead)this.#modeCatalog=catalog;
    } catch {
      if(read===this.#modeRead)this.#modeCatalog=emptyPresetCatalog('Mode metadata read failed; refresh required','unavailable');
    }
    return this.sessionModeCatalog();
  }
  /** Private owned entry only. No provider, prompt, model selection, or Session activation on lookup. */
  ownedCreationPort(sessionIds,{scopeOf,durable=false,initialization}) {
    requireValue(Array.isArray(sessionIds) && sessionIds.length>0 && typeof scopeOf==='function','scope_denied');
    const owned=new Set(sessionIds.map(id=>text(id,'sessionId',200))),context=this.context;
    const check=i=>{requireValue(owned.has(i?.sessionId),'scope_denied');requireValue(context && this.context===context,'host_disconnected');};
    requireValue(typeof durable==='boolean','invalid_creation_options');const acknowledged=new Map(),verified=new Set(),initialMode=initialization===undefined?undefined:freezeInitialSessionMode(initialization);
    const readBlank=async i=>{const stat=await context.sessionPersistence.stat(i.sessionId);requireValue(stat?.sizeBytes>0,'native_creation_not_durable');const stored=await context.sessionPersistence.open(i.sessionId,'read');try{const read=await stored.read();requireValue(stored.header.id===i.sessionId && stored.header.cwd===i.cwd && stored.header.agentPreset===i.agentPreset && stored.header.isSeeded===false && isBlankInitialSessionEvents(read.events,initialMode),'native_creation_not_durable');}finally{await stored.close();}};
    const port=Object.freeze({
      createOwnedSession:async i=>{
        check(i);requireValue(typeof context.sessionController?.create==='function','unsupported_native_creation');
        const result=await context.sessionController.create({sessionId:i.sessionId,cwd:i.cwd,agentPreset:i.agentPreset});
        if(durable){const session=context.sessions.get(i.sessionId),agent=context.agents.get(i.sessionId);requireValue(session && agent?.session===session,'scope_denied');requireValue(await context.sessions.flush(session),'native_creation_not_durable');await readBlank(i);check(i);requireValue(context.sessions.get(i.sessionId)===session && context.agents.get(i.sessionId)===agent,'scope_denied');acknowledged.set(i.operationId,{session,agent});}return result;
      },
      inspectOwnedCreation:async i=>{
        check(i);
        const session=context.sessions?.get(i.sessionId),agent=context.agents?.get(i.sessionId);
        // A cold persisted header cannot establish the effective mounted Agent scope.
        if(!session || !agent)return null;
        requireValue(session.id===i.sessionId && agent.id===i.sessionId && agent.session===session,'scope_denied');
        const scope=scopeOf(agent.ctx);requireValue(scope===agent,'scope_denied');
        const id=context.sessionProjections?.stateOf(session,'agentPreset');
        requireValue(typeof id==='string','mode_projection_unavailable');
        requireValue(typeof context.tools?.schemas==='function','tool_scope_unavailable');
        if(durable){const original=acknowledged.get(i.operationId);requireValue(original && original.session===session && original.agent===agent,'native_creation_not_durable');await readBlank(i);check(i);requireValue(context.sessions.get(i.sessionId)===session && context.agents.get(i.sessionId)===agent && scopeOf(agent.ctx)===agent,'scope_denied');
          const [{Context},{default:SessionStore},{default:Persistence},{default:Agents},{default:Controller},{default:Tools},{scopeOf:officialScopeOf}]=await Promise.all([import('@deepseek-ai/cordis'),import('@deepseek-ai/dsh-session'),import('@deepseek-ai/dsh-session-persistence-jsonl'),import('@deepseek-ai/dsh-agent'),import('@deepseek-ai/dsh-api-session-controller'),import('@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-scope')]);
          check(i);requireValue(context.sessions.get(i.sessionId)===session && context.agents.get(i.sessionId)===agent,'scope_denied');
          if(context instanceof Context && context.sessions instanceof SessionStore && context.sessionPersistence instanceof Persistence && context.agents instanceof Agents && context.sessionController instanceof Controller && context.tools instanceof Tools && scopeOf===officialScopeOf)verified.add(i.operationId);
        }
        return {sessionId:session.id,agentPreset:presetId(id),blank:isBlankInitialSessionEvents(session.snapshotEvents?.()??[],initialMode,session.seq),globalTools:context.tools.schemas().length,scopedTools:context.tools.schemas(scope).length};
      }
    });
    durablePorts.set(port,verified);return port;
  }
  /** Prepare actual protected calls before mounting; retain the original native handle privately. */
  ownedGenerationCreationPort(sessionIds,{scopeOf,role,prepareGeneration,isCurrent,initialization}) {
    requireValue(Array.isArray(sessionIds)&&sessionIds.length>0&&typeof scopeOf==='function'&&['main','work'].includes(role)&&typeof prepareGeneration==='function'&&typeof isCurrent==='function','invalid_creation_options');
    const owned=new Set(sessionIds.map(id=>text(id,'sessionId',200))),context=this.context,rows=new Map(),verified=new Set(),initialMode=initialization===undefined?undefined:freezeInitialSessionMode(initialization);
    const check=i=>{requireValue(owned.has(i?.sessionId),'scope_denied');requireValue(context&&this.context===context&&isCurrent()===true,'host_disconnected');};
    const mounted=row=>{const {handle,session}=row;requireValue(context.agents.get(session.id)===handle.agent&&context.sessions.get(session.id)===session&&handle.agent.session===session&&scopeOf(handle.agent.ctx)===handle.agent,'native_creation_binding_changed');};
    const readBlank=async(i,row)=>{check(i);mounted(row);const stat=await context.sessionPersistence.stat(i.sessionId);check(i);mounted(row);requireValue(stat?.sizeBytes>0,'native_creation_not_durable');const stored=await context.sessionPersistence.open(i.sessionId,'read');try{check(i);mounted(row);const log=await stored.read();check(i);mounted(row);requireValue(stored.header.id===i.sessionId&&stored.header.cwd===i.cwd&&stored.header.agentPreset===i.agentPreset&&stored.header.isSeeded===false&&isBlankInitialSessionEvents(log.events,initialMode)&&canonical(log.events)===canonical(row.session.snapshotEvents()),'native_creation_not_durable');}finally{await stored.close();check(i);mounted(row);}};
    const port=Object.freeze({
      createOwnedSession:async i=>{
        check(i);const sdk=await loadOwnedGenerationSdk();check(i);
        const {Context}=await import('@deepseek-ai/cordis');check(i);requireValue(context instanceof Context,'unsupported_host_identity');
        requireValue(!rows.has(i.operationId),'native_creation_replay');
        const preparation=await prepareGeneration(Object.freeze(structuredClone(i)));check(i);
        requireValue(preparation&&sdk.isPreparedOwnedGenerationSource(preparation.prepared,context,i.sessionId,role)===true,'unsupported_owned_generation_preparation');
        const route=Object.freeze(structuredClone(preparation.route));requireValue(route&&typeof route.provider==='string'&&typeof route.model==='string'&&Number.isSafeInteger(route.maxTokens)&&route.maxTokens>0&&route.reasoningEffort==='off','invalid_generation_route');
        const presets=context.agentPresets,presetIdentity=registryIdentity(presets),resolved=await presets.resolve(i.agentPreset);check(i);requireValue(registryIdentity(context.agentPresets)===presetIdentity&&resolved.id===i.agentPreset,'mode_registry_changed');
        const row={coordinates:creationCoordinates(i),prepared:preparation.prepared,sdk,source:null};rows.set(i.operationId,row);
        const handle=await context.agents.create({sessionId:i.sessionId,agentOptions:route,meta:{cwd:i.cwd,agentPreset:i.agentPreset},protectedModelCalls:row.prepared.protectedModelCalls,
          setup:async(agentCtx,agent)=>{check(i);requireValue(registryIdentity(context.agentPresets)===presetIdentity,'mode_registry_changed');const preset=await presets.mount(agentCtx,i.agentPreset);check(i);requireValue(preset.id===i.agentPreset&&scopeOf(agentCtx)===agent,'native_creation_binding_changed');return{commit:()=>{check(i);requireValue(registryIdentity(context.agentPresets)===presetIdentity&&context.tools.schemas().length===0&&context.tools.schemas(agent).length===0,'native_creation_binding_changed');}};}});
        row.handle=handle;row.session=handle.agent.session;check(i);mounted(row);
        if(role==='work'){row.source=row.prepared.attach(handle);requireValue(sdk.isOwnedGenerationSource(row.source,context)===true,'unsupported_owned_generation_source');}
        requireValue(await context.sessions.flush(row.session),'native_creation_not_durable');check(i);mounted(row);await readBlank(i,row);return{sessionId:i.sessionId};
      },
      inspectOwnedCreation:async i=>{check(i);const row=rows.get(i.operationId);if(!row?.handle)return null;requireValue(row.coordinates===creationCoordinates(i),'native_creation_binding_changed');mounted(row);await readBlank(i,row);
        const [{default:SessionStore},{default:Persistence},{default:Agents},{default:Tools},{scopeOf:officialScopeOf}]=await Promise.all([import('@deepseek-ai/dsh-session'),import('@deepseek-ai/dsh-session-persistence-jsonl'),import('@deepseek-ai/dsh-agent'),import('@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-scope')]);
        check(i);mounted(row);requireValue(context.sessions instanceof SessionStore&&context.sessionPersistence instanceof Persistence&&context.agents instanceof Agents&&context.tools instanceof Tools&&scopeOf===officialScopeOf&&(row.source?row.sdk.isOwnedGenerationSource(row.source,context):row.sdk.isPreparedOwnedGenerationSource(row.prepared,context,i.sessionId,role))===true,'unsupported_host_identity');
        const preset=context.sessionProjections.stateOf(row.session,'agentPreset');requireValue(preset===i.agentPreset,'native_creation_binding_changed');verified.add(i.operationId);
        return{sessionId:i.sessionId,agentPreset:preset,blank:isBlankInitialSessionEvents(row.session.snapshotEvents(),initialMode,row.session.seq),globalTools:context.tools.schemas().length,scopedTools:context.tools.schemas(row.handle.agent).length};
      }
    });
    generationPorts.set(port,{adapter:this,context,role,rows,verified,check,mounted,initialMode});durablePorts.set(port,verified);return port;
  }
  /** Main tool binding occurs after original blank proof and before any model input. */
  bindOwnedMainGeneration(port,intent,delegateTool){
    const retained=generationPorts.get(port);requireValue(retained?.adapter===this&&retained.role==='main'&&retained.verified.has(intent?.operationId),'unsupported_owned_generation_source');retained.check(intent);
    const row=retained.rows.get(intent.operationId);requireValue(row?.handle&&row.coordinates===creationCoordinates(intent),'native_creation_binding_changed');retained.mounted(row);
    if(row.source){requireValue(row.delegateTool===delegateTool,'native_creation_binding_changed');return row.source;}
    requireValue(isBlankInitialSessionEvents(row.session.snapshotEvents(),retained.initialMode,row.session.seq),'native_creation_not_blank');
    const source=row.prepared.attach(row.handle,{delegateTool});requireValue(row.sdk.isOwnedGenerationSource(source,retained.context)===true,'unsupported_owned_generation_source');row.delegateTool=delegateTool;row.source=source;return source;
  }
  unsupported(operation) { return {status:'unsupported',operation,reason:'Missing verified native contract; no native mutation issued'}; }
  selectSessionModel() { return this.unsupported('selectSessionModel'); }
  dispatch() { return this.unsupported('dispatchPermit'); }
  inspectOperation() { return this.unsupported('inspectOperation'); }
  stopRun() { return this.unsupported('stopRun'); }
  archiveSession() { return this.unsupported('archiveSession'); }
  restoreSession() { return this.unsupported('restoreSession'); }
}
