import { DshAdapter } from './adapter.mjs';
import { requireValue } from './errors.mjs';
import { projectBotTaskSnapshot, unavailableBotTaskSnapshot } from './bot-task-read-model.mjs';
export { Host } from './host.mjs';
export const name='dsh-bot';
export const inject=['connection','webServer'];
/** Read-only Loader entry. No ledger or native caller is opened by mounting it.
 * The optional host-owned dshBotReadSource.readForPeer(peer,signal) must enforce
 * its own per-request authorization before returning {status:'ready',snapshot}
 * from the existing Host.snapshot read model. Connection's OperatorPeer is not
 * a human actor. Source config, serialized actors and private owner services
 * cannot supply authority here. An absent source remains not_configured.
 * @param ctx Cordis plugin context.
 * @returns Read-only status service; execute always refuses admission.
 */
export function apply(ctx) {
 requireValue(typeof ctx?.provide==='function' && typeof ctx?.effect==='function','unsupported_context');
 const adapter=new DshAdapter();let closed=false;
 const pending=new Set();
 const service=Object.freeze({
  snapshot(){requireValue(!closed,'disposed');return {host:'disconnected',nativeRuntimeVerified:false,releaseReady:false,capabilities:adapter.capabilities(),reason:'Native trusted caller bridge unavailable; no private ledger records exposed'};},
  execute(){requireValue(!closed,'disposed');requireValue(false,'unsupported_host_identity','Native caller authority cannot be established; no command issued');}
 });
 ctx.effect(()=>{const dispose=ctx.provide('dshBot',service);return async()=>{
  if(closed)return;closed=true;for(const controller of pending)controller.abort();pending.clear();await dispose?.();
 };});
 if(typeof ctx.connection?.rpc?.handle==='function')ctx.connection.rpc.handle('/dsh-bot',async(endpoint,payload,signal,peer)=>{
  const failure=code=>({ok:false,error:{code:`dsh-bot/${code}`,message:code,details:{}}});
  if(closed || signal.aborted)return failure('cancelled');
  if(endpoint!=='snapshot')return failure('unsupported_endpoint');
  if(payload===null || typeof payload!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(payload))
    || Reflect.ownKeys(payload).length!==0)return failure('invalid_payload');
  const source=ctx.get?.('dshBotReadSource');
  if(!source)return {ok:true,value:unavailableBotTaskSnapshot('not_configured')};
  if(typeof source.readForPeer!=='function')return {ok:true,value:unavailableBotTaskSnapshot('read_failed')};
  const controller=new AbortController();pending.add(controller);
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  let cancel;
  const cancelled=new Promise(resolve=>{cancel=()=>resolve(undefined);controller.signal.addEventListener('abort',cancel,{once:true});});
  try{
   const result=await Promise.race([Promise.resolve().then(()=>closed || controller.signal.aborted?undefined:source.readForPeer(peer,controller.signal)),cancelled]);
   if(closed || controller.signal.aborted)return failure('cancelled');
   if(result?.status==='not_configured' || result?.status==='access_denied')return {ok:true,value:unavailableBotTaskSnapshot(result.status)};
   requireValue(result?.status==='ready','invalid_read_snapshot');
   return {ok:true,value:projectBotTaskSnapshot(result.snapshot)};
  }catch{
   return closed || controller.signal.aborted?failure('cancelled'):{ok:true,value:unavailableBotTaskSnapshot('read_failed')};
  }finally{
   signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancel);pending.delete(controller);
  }
 });
 return service;
}
