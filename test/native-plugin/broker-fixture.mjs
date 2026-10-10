import assert from 'node:assert/strict';
import {taskFixture} from './task-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
import Typert from '@deepseek-ai/dsh-typert-registry';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import Commands from '@deepseek-ai/dsh-commands';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
export async function brokerFixture(t,options={}) {
  const f=await taskFixture(t,options);
  await f.ctx.plugin(Typert).await();
  await f.ctx.plugin(Attachments,{dshHome:f.dir}).await();
  await f.ctx.plugin(Commands).await();
  // Real public upload binding services; no HTTP listener or authentication is exercised.
  await f.ctx.plugin({name:'broker-test-connection',apply(ctx){new HostConnectionService(ctx,new Set(),undefined);}}).await();
  await f.ctx.plugin(FileUploads).await();
  const {ConversationBroker}=await import('../../src/native/broker.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native conversation broker is missing');throw error;});
  const broker=new ConversationBroker(f),service=new BotService({...f,broker});f.recovery.broker=broker;f.adapter.setService(service);f.tasks.setResultSink(broker);f.beforeClose.unshift(()=>broker.close());
  return {...f,broker,service,async contact(bot,name='contact'){return f.sessions.create(f.human,{operationId:name,action:'session.create',input:{botId:bot.botId}});}};
}
