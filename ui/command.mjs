export function canonical(value) {
 if(value===null || ['string','boolean'].includes(typeof value))return JSON.stringify(value);
 if(typeof value==='number' && Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value && Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('Only finite JSON values are accepted');
}
async function digest(value) {const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
function locked(locks,fn) {
 if(!locks?.request){const e=Error('浏览器不支持跨标签页操作身份锁；保留待查回记录');e.code='identity_lock_unavailable';throw e;}
 return locks.request('dsh-bot-pending',{mode:'exclusive'},fn);
}
/** Persist identity and full binding before any network attempt. One pending command per origin. */
export async function prepareCommand(storage,input,locks=globalThis.navigator?.locks) {
 return locked(locks,async()=>{
 input=JSON.parse(canonical(input));
 if(typeof input.ledgerInstanceId!=='string' || !input.ledgerInstanceId){const e=Error('持久账本身份未确认；请先查回旧操作');e.code='ledger_identity_conflict';throw e;}
 const existing=storage.getItem('dsh-bot-pending');
 if(existing) {const old=JSON.parse(existing);if(canonical(old.input)!==canonical(input)){const e=Error('Inspect the pending operation before changing the command');e.code='pending_operation';throw e;}return {envelope:old.envelope,payload:old.payload};}
 const operationId=crypto.randomUUID(),body={envelope:{operationId,ledgerInstanceId:input.ledgerInstanceId,nonce:crypto.randomUUID(),command:input.command,payloadDigest:await digest(input.payload),expectedRevision:input.expectedRevision,expectedEpochs:input.expectedEpochs,rootHumanInstructionRef:`local-ui:${operationId}`,authorizationRef:'root',createdAt:new Date().toISOString(),deadline:null},payload:input.payload};
 storage.setItem('dsh-bot-pending',JSON.stringify({...body,input}));return body;
 });
}
/** A delayed receipt may clear only the operation it actually confirms. */
export async function clearPending(storage,receipt,locks=globalThis.navigator?.locks) {
 return locked(locks,()=>{
  const value=storage.getItem('dsh-bot-pending');
  if(!value)return false;
  const pending=JSON.parse(value).envelope;
  if(pending.operationId!==receipt.operationId || !pending.ledgerInstanceId || pending.ledgerInstanceId!==receipt.ledgerInstanceId)return false;
  storage.removeItem('dsh-bot-pending');return true;
 });
}
/** Retry uses only the saved body, even if another tab clears or replaces it later. */
export async function recoverPending(storage,locks=globalThis.navigator?.locks) {
 return locked(locks,()=>{
  const value=storage.getItem('dsh-bot-pending');if(!value)return null;
  const old=JSON.parse(value);return {envelope:old.envelope,payload:old.payload};
 });
}
