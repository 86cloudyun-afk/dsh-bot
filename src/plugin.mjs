import { Ledger } from './ledger.mjs';
import { Host } from './host.mjs';
import { requireValue } from './errors.mjs';
export const name='dsh-bot';
/** No native trusted-caller bridge is available. Never expose Host/ledger through ctx. */
export function apply(ctx,{databasePath,ownerHumanId}) {
 requireValue(typeof ctx?.provide==='function' && typeof ctx?.effect==='function','unsupported_context');
 const ledger=new Ledger(databasePath);let closed=false;
 try {
  const host=new Host({ledger,ownerHumanId});
  const service=Object.freeze({
   snapshot(){requireValue(!closed,'disposed');return {host:'disconnected',nativeRuntimeVerified:false,releaseReady:false,capabilities:host.adapter.capabilities(),reason:'Native trusted caller bridge unavailable; no private ledger records exposed'};},
   execute(){requireValue(false,'unsupported_host_identity','Native caller authority cannot be established; no command issued');}
  });
  ctx.effect(()=>{const dispose=ctx.provide('dshBot',service);return async()=>{if(closed)return;closed=true;try{await dispose?.();}finally{ledger.close();}};});return service;
 }catch(error){closed=true;ledger.close();throw error;}
}
