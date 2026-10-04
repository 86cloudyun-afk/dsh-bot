import { requireValue } from './errors.mjs';
/** Plugin-owned reservations only. This is not native provider quota or OS locking. */
export function reserveResources(ledger,attemptId,ids) {
  requireValue(typeof attemptId==='string' && Array.isArray(ids) && ids.every(x=>typeof x==='string' && x.length>0),'invalid_resource_plan');
  const keys=[...new Set(ids)].sort();
  return ledger.transaction(()=>{
    const conflicts=keys.map(id=>ledger.get('resource',id)).filter(r=>r && r.state!=='settled' && r.attemptId!==attemptId);
    if(conflicts.length) return {status:'blocked_resource',conflicts};
    for(const id of keys) {const old=ledger.get('resource',id);if(!old || old.state==='settled') ledger.put('resource',id,{id,attemptId,state:'reserved',authority:'plugin-reservation',runGeneration:null});}
    return {status:'reserved',ids:keys,authority:'plugin-reservation'};
  });
}
export function settleResources(ledger,attemptId,evidence,verifySettlement=()=>false) {
  requireValue(evidence?.attemptId===attemptId && evidence.terminal===true && verifySettlement(evidence)===true,'invalid_evidence','Trusted authoritative settlement verifier required');
  return ledger.transaction(()=>{
    const rows=ledger.list('resource').filter(r=>r.attemptId===attemptId);
    for(const r of rows) ledger.put('resource',r.id,{...r,state:'settled',settlement:evidence});
    return {status:'settled',ids:rows.map(r=>r.id),authority:'plugin-reservation'};
  });
}
