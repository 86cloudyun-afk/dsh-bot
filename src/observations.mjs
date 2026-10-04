import { canonical, requireValue, text } from './errors.mjs';
/** Only a trusted adapter may supply events. No client command accepts runtime events. */
export function observe(ledger,event) {
  for(const k of ['eventId','source','entityId','generation','state','observedAt']) text(event[k],k,250);
  requireValue(Number.isSafeInteger(event.sourceSeq) && event.sourceSeq>0,'invalid_event');
  requireValue(['queued','admitted','running','settling','settled','failed','outcome_unknown'].includes(event.state),'invalid_event');
  return ledger.transaction(()=>{
    const previous=ledger.db.prepare('SELECT value FROM observations WHERE event_id=?').get(event.eventId);
    if(previous) {requireValue(previous.value===canonical(event),'event_conflict');return ledger.get('projection',event.entityId);}
    ledger.db.prepare('INSERT INTO observations VALUES(?,?,?,?)').run(event.eventId,event.source,event.sourceSeq,canonical(event));
    const old=ledger.get('projection',event.entityId);
    if(old && (old.generation!==event.generation || old.source!==event.source || event.sourceSeq<=old.sourceSeq)) return old;
    const freshness=event.sourceSeq===(old?.sourceSeq ?? 0)+1 && old?.freshness!=='stale' ? 'fresh':'stale';
    if(old && !legalTransition(old.state,event.state)) return ledger.put('projection',event.entityId,{...old,sourceSeq:event.sourceSeq,freshness:'stale'});
    return ledger.put('projection',event.entityId,{...event,freshness,projectionUpdatedAt:new Date().toISOString()});
  });
}

function legalTransition(from,to) {
  if(from===to) return true;
  if(['settled','failed'].includes(from)) return false;
  if(to==='outcome_unknown') return true;
  if(from==='outcome_unknown') return to!=='queued';
  const rank={queued:0,admitted:1,running:2,settling:3,settled:4,failed:4};
  return rank[to]>=rank[from];
}
export function activateGeneration(ledger,transition,verifyTransition=()=>false) {
  requireValue(verifyTransition(transition)===true,'invalid_evidence','Trusted native generation receipt required');
  return ledger.transaction(()=>{
    const old=ledger.get('projection',transition.entityId);
    requireValue(old?.generation===transition.priorGeneration,'generation_conflict');
    return ledger.put('projection',transition.entityId,{entityId:transition.entityId,source:transition.source,generation:transition.generation,sourceSeq:0,state:'queued',freshness:'fresh',observedAt:null});
  });
}
