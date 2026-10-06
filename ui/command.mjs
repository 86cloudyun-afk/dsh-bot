export function canonical(value) {
 if(value===null || ['string','boolean'].includes(typeof value))return JSON.stringify(value);
 if(typeof value==='number' && Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value && Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('Only finite JSON values are accepted');
}
async function digest(value) {const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
/** Persist identity and full binding before any network attempt. One pending command per UI. */
export async function prepareCommand(storage,input,locks=globalThis.navigator?.locks) {
 if(!locks?.request && typeof document!=='undefined') {const e=Error('Browser operation identity lock unavailable; retain the pending operation');e.code='identity_lock_unavailable';throw e;}
 const prepare=async()=>{
 const existing=storage.getItem('dsh-bot-pending');
 if(existing) {const old=JSON.parse(existing);if(canonical(old.input)!==canonical(input)){const e=Error('Inspect the pending operation before changing the command');e.code='pending_operation';throw e;}return {envelope:old.envelope,payload:old.payload};}
 const operationId=crypto.randomUUID(),body={envelope:{operationId,nonce:crypto.randomUUID(),command:input.command,payloadDigest:await digest(input.payload),expectedRevision:input.expectedRevision,expectedEpochs:input.expectedEpochs,rootHumanInstructionRef:`local-ui:${operationId}`,authorizationRef:'root',createdAt:new Date().toISOString(),deadline:null},payload:input.payload};
 storage.setItem('dsh-bot-pending',JSON.stringify({...body,input}));return body;
 };
 return locks?.request ? locks.request('dsh-bot-pending',{mode:'exclusive'},prepare):prepare();
}
