/** Trusted owner installation for this Host's authenticated operator summary audience. */
import {Context} from '@deepseek-ai/cordis';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import {createBotTaskReadSource} from './bot-task-read-source.mjs';
import {Host,isOwnedBotTaskReadPort,isOwnedBotTaskReadPortForHost} from './host.mjs';
import {requireValue} from './errors.mjs';

const audience='this-host-authenticated-operator';
const active=fiber=>fiber?.uid!==null && fiber?.state===2;
const denseIds=ids=>Array.isArray(ids) && ids.length<=500 && Array.from(ids).every(id=>typeof id==='string' && id.length>0 && id.length<=200) && new Set(ids).size===ids.length;
export function createExplicitOperatorReadBinding({ownerCtx,expectedHost,readPort}){
 requireValue(ownerCtx instanceof Context && isOwnedBotTaskReadPort(readPort),'retained_owner_read_port_required');
 requireValue(expectedHost instanceof Host,'retained_host_read_port_required');
 requireValue(isOwnedBotTaskReadPortForHost(readPort,expectedHost,ownerCtx.fiber),'owner_read_port_mismatch');
 const ownerFiber=ownerCtx.fiber,connection=ownerCtx.get('connection'),operator=connection?.operator,peerFiber=operator?.ctx?.fiber;
 requireValue(ownerFiber && peerFiber && connection instanceof HostConnectionService && operator.ctx instanceof Context,'actual_connection_operator_required');
 let lease=null,closed=false,configured=false;
 const bound=createBotTaskReadSource({resolveAccess:(peer,signal)=>{
  const captured=lease;
  if(peer!==operator || !captured)return null;
  return {readPort,botIds:captured.botIds,taskIds:captured.taskIds,isCurrent:()=>!closed && !signal.aborted && lease===captured
   && active(ownerFiber) && active(peerFiber) && currentConnection()};
 }});
 function currentConnection(){const current=ownerCtx.get('connection');return current instanceof HostConnectionService && current.operator===operator;}
 const unconfigured=createBotTaskReadSource();
 const source=Object.freeze({readForPeer:(peer,signal)=>!closed && !configured?unconfigured.readForPeer(peer,signal):bound.readForPeer(peer,signal)});
 function revoke(){configured=true;lease=null;}
 function close(){closed=true;revoke();}
 function select(config){
  revoke();
  requireValue(!closed,'disposed');
  requireValue(config && Object.getPrototypeOf(config)===Object.prototype && Reflect.ownKeys(config).every(key=>['audience','botIds','taskIds'].includes(key))
   && config.audience===audience && denseIds(config.botIds) && denseIds(config.taskIds),'explicit_operator_scope_required');
  lease=Object.freeze({botIds:Object.freeze([...config.botIds]),taskIds:Object.freeze([...config.taskIds])});
 }
 ownerCtx.effect(()=>()=>close());
 return Object.freeze({source,select,revoke,close});
}

/** Trusted same-Host owner composition; provides only the readForPeer service. */
export function installExplicitOperatorReadBinding(options){
 const binding=createExplicitOperatorReadBinding(options);
 try{options.ownerCtx.provide('dshBotReadSource',binding.source);}catch(error){binding.close();throw error;}
 return binding;
}
