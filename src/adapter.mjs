import { requireValue,text } from './errors.mjs';
import { emptyPresetCatalog,normalizePresetCatalog,presetId } from './session-mode.mjs';
export const REQUIRED_NATIVE=Object.freeze(['session_model','dispatch_freeze','operation_lookup','run_fence','resource_settlement','producer','scope_enforce','interaction_capacity']);
// Cordis Service.tracker is public per-instance metadata; property reads create fresh proxies.
// Compare that identity only. Keep calling through the traced service, never unwrap its implementation.
const registryIdentity=registry=>registry?.[Symbol.for('cordis.tracker')] ?? registry;
const durablePorts=new WeakMap();
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
  ownedCreationPort(sessionIds,{scopeOf,durable=false}) {
    requireValue(Array.isArray(sessionIds) && sessionIds.length>0 && typeof scopeOf==='function','scope_denied');
    const owned=new Set(sessionIds.map(id=>text(id,'sessionId',200))),context=this.context;
    const check=i=>{requireValue(owned.has(i?.sessionId),'scope_denied');requireValue(context && this.context===context,'host_disconnected');};
    requireValue(typeof durable==='boolean','invalid_creation_options');const acknowledged=new Map(),verified=new Set();
    const readBlank=async i=>{const stat=await context.sessionPersistence.stat(i.sessionId);requireValue(stat?.sizeBytes>0,'native_creation_not_durable');const stored=await context.sessionPersistence.open(i.sessionId,'read');try{const read=await stored.read();requireValue(stored.header.id===i.sessionId && stored.header.cwd===i.cwd && stored.header.agentPreset===i.agentPreset && stored.header.isSeeded===false && read.events.length===0,'native_creation_not_durable');}finally{await stored.close();}};
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
        return {sessionId:session.id,agentPreset:presetId(id),blank:session.seq===0,globalTools:context.tools.schemas().length,scopedTools:context.tools.schemas(scope).length};
      }
    });
    durablePorts.set(port,verified);return port;
  }
  unsupported(operation) { return {status:'unsupported',operation,reason:'Missing verified native contract; no native mutation issued'}; }
  selectSessionModel() { return this.unsupported('selectSessionModel'); }
  dispatch() { return this.unsupported('dispatchPermit'); }
  inspectOperation() { return this.unsupported('inspectOperation'); }
  stopRun() { return this.unsupported('stopRun'); }
  archiveSession() { return this.unsupported('archiveSession'); }
  restoreSession() { return this.unsupported('restoreSession'); }
}
