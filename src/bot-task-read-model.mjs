import { requireValue } from './errors.mjs';

const MAX_RECORDS=500;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value)
 && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const string=(value,max)=>typeof value==='string' && value.length>0 && value.length<=max;
function row(record,fields) {
 requireValue(object(record),'invalid_read_snapshot');
 const result={};
 for(const [field,max] of fields){
  const value=record[field];requireValue(string(value,max),'invalid_read_snapshot');result[field]=value;
 }
 for(const field of ['epoch','revision']){
  requireValue(Number.isSafeInteger(record[field]) && record[field]>=1,'invalid_read_snapshot');result[field]=record[field];
 }
 return result;
}

/**
 * Project the existing Host.snapshot bot/task read model, after its owner has
 * authorized the read. This function grants no authority and opens no ledger.
 * Config, identities, sessions, content, resources and execution data stay out.
 */
export function projectBotTaskSnapshot(snapshot) {
 requireValue(object(snapshot) && Array.isArray(snapshot.bot) && Array.isArray(snapshot.task),'invalid_read_snapshot');
 requireValue(snapshot.bot.length<=MAX_RECORDS && snapshot.task.length<=MAX_RECORDS,'read_snapshot_too_large');
 const bot=snapshot.bot.map(record=>row(record,[['botId',200],['name',100],['lifecycle',64],['readiness',64]]));
 const task=snapshot.task.map(record=>{
  const result=row(record,[['taskId',200],['ownerBotId',200],['title',500],['responsibility',64]]);
  requireValue(object(record.stop) && string(record.stop.state,64),'invalid_read_snapshot');
  return {...result,stop:{state:record.stop.state}};
 });
 return {version:1,status:'ready',bot,task};
}

/** Unavailable is deliberately different from an authorized empty snapshot. */
export function unavailableBotTaskSnapshot(status) {
 requireValue(['not_configured','access_denied','read_failed'].includes(status),'invalid_read_status');
 return {version:1,status,bot:null,task:null};
}
