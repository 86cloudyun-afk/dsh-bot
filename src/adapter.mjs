import { requireValue } from './errors.mjs';
export const REQUIRED_NATIVE=Object.freeze(['session_model','dispatch_freeze','operation_lookup','run_fence','resource_settlement','producer','scope_enforce','interaction_capacity']);
export class DshAdapter {
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
  unsupported(operation) { return {status:'unsupported',operation,reason:'Missing verified native contract; no native mutation issued'}; }
  selectSessionModel() { return this.unsupported('selectSessionModel'); }
  dispatch() { return this.unsupported('dispatchPermit'); }
  inspectOperation() { return this.unsupported('inspectOperation'); }
  stopRun() { return this.unsupported('stopRun'); }
  archiveSession() { return this.unsupported('archiveSession'); }
  restoreSession() { return this.unsupported('restoreSession'); }
}
