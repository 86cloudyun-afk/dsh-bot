import {realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {withFileLock} from '@deepseek-ai/dsh-atomic-write';
import {digest,requireCondition} from './store.mjs';

/** Official profile identity namespaces the public KV unit; one runtime owns writes. */
export async function openProfileScope(ctx) {
  const profile=ctx.profileContext??ctx.get?.('profileContext');
  requireCondition(profile&&typeof profile.name==='string'&&isAbsolute(profile.dir),'profile_context_required');
  const dir=await realpath(profile.dir),namespace=`dsh_bot_v1_${digest({profileDir:dir}).slice(0,24)}`;
  let acquired,rejected,release;
  const ready=new Promise((resolve,reject)=>{acquired=resolve;rejected=reject;}),held=new Promise(resolve=>{release=resolve;});
  const writer=withFileLock(join(dir,'.dsh-bot-v1-writer'),async()=>{acquired();await held;},{waitMs:250});
  writer.catch(error=>{if(error.message.startsWith('atomic-write: timed out'))error=Object.assign(Error('此 DSH profile 已有插件写入实例，请使用其工作台。'),{code:'profile_writer_active'});rejected(error);});
  await ready;let closed=false;
  return {namespace,async close(){if(!closed){closed=true;release();}await writer;}};
}
