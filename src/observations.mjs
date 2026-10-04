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
    if(old && ['settled','failed'].includes(old.state) && event.state!==old.state) return ledger.put('projection',event.entityId,{...old,sourceSeq:event.sourceSeq,freshness:'stale'});
    return ledger.put('projection',event.entityId,{...event,freshness,projectionUpdatedAt:new Date().toISOString()});
  });
}
