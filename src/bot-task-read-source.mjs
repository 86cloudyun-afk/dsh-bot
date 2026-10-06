import { Host,isOwnedBotTaskReadPort } from './host.mjs';
import { requireValue } from './errors.mjs';
import {projectBotTaskSnapshot} from './bot-task-read-model.mjs';

/**
 * Bind a host-owned authorization resolver to the existing private owner read.
 * The resolver must compare the actual peer object, retain the existing owner
 * capability, and check its lease generation and both owner/peer lifetimes in
 * isCurrent(). Cordis fibers must still have uid !== null as well as ACTIVE
 * state: disposal clears uid before the state transition. IDs are host-selected;
 * peer IDs, roles and JSON grant no access.
 * This factory opens no ledger and registers no source in a production context.
 * @param options Optional trusted resolveAccess(peer, signal) function.
 * @returns Source for the optional dshBotReadSource service.
 */
export function createBotTaskReadSource({resolveAccess}={}) {
 requireValue(resolveAccess===undefined || typeof resolveAccess==='function','invalid_read_source');
 return Object.freeze({async readForPeer(peer,signal){
  const denied=()=>({status:'access_denied'});
  if(signal.aborted)return denied();
  if(!resolveAccess)return {status:'not_configured'};
  const access=await resolveAccess(peer,signal);
  if(signal.aborted || !access)return denied();
  const {host,caller,authorityEpoch,isCurrent,readPort}=access;
  if(!(readPort===undefined?host instanceof Host:isOwnedBotTaskReadPort(readPort)) || typeof isCurrent!=='function' || !Array.isArray(access.botIds) || !Array.isArray(access.taskIds))return denied();
  const scope={authorityEpoch,botIds:[...access.botIds],taskIds:[...access.taskIds]};
  const current=()=>{
   if(signal.aborted)return false;
   try{return isCurrent()===true;}catch{return false;}
  };
  if(!current())return denied();
  let snapshot;
  // Both genuine owner ports and Host reads are synchronous. Keep grant validation,
  // projection and final lease validation in one turn; no post-grant await gap.
  try{
   if(readPort===undefined){const dto=projectBotTaskSnapshot(host.snapshotOwnedBotTasks(caller,scope));snapshot={bot:dto.bot,task:dto.task};}
   else snapshot=readPort.snapshot(scope);
  }catch(error){
   if(error?.code==='unauthorized' || error?.code==='unsupported_host_identity')return denied();
   throw error;
  }
  return current()?{status:'ready',snapshot}:denied();
 }});
}
