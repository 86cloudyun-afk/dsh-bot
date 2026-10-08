import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';

export async function taskFixture(t,options={}) {
  const f=await businessFixture(t,options);
  const {TaskController}=await import('../../src/native/tasks.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native task controller is missing');throw error;});
  const {Reconciler}=await import('../../src/native/recovery.mjs');
  const tasks=new TaskController(f),recovery=new Reconciler({...f,tasks});
  const service=new BotService({...f,tasks,recovery});f.adapter.setService(service);f.beforeClose.push(()=>tasks.close());
  return {...f,tasks,recovery,service,async task(bot,title='Work') {return tasks.create(f.human,{operationId:`task-${title}`,action:'task.create',input:{botId:bot.botId,title,goal:'One harmless response.',criteria:['Response exists']}});}};
}
