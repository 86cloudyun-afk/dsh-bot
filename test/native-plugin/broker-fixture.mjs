import assert from 'node:assert/strict';
import {taskFixture} from './task-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
export async function brokerFixture(t,options={}) {
  const f=await taskFixture(t,options);
  const {ConversationBroker}=await import('../../src/native/broker.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native conversation broker is missing');throw error;});
  const broker=new ConversationBroker(f),service=new BotService({...f,broker});f.adapter.setService(service);f.tasks.setResultSink(broker);f.beforeClose.unshift(()=>broker.close());
  return {...f,broker,service,async contact(bot,name='contact'){return f.sessions.create(f.human,{operationId:name,action:'session.create',input:{botId:bot.botId}});}};
}
