import assert from 'node:assert/strict';
import {brokerFixture} from './broker-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
export async function collaborationFixture(t,options={}) {
  const f=await brokerFixture(t,options);
  const {GroupMeetingController}=await import('../../src/native/collaboration.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native groups and meetings are missing');throw error;});
  const collaboration=new GroupMeetingController(f),service=new BotService({...f,collaboration});f.adapter.setService(service);f.beforeClose.unshift(()=>collaboration.close());
  return {...f,collaboration,service,async group(name,bots){return collaboration.createGroup(f.human,{operationId:`group-${name}`,action:'group.create',input:{name,botIds:bots.map(row=>row.botId),coordinatorBotId:bots[0].botId,rounds:1,maxRequests:12}});},async meeting(group,topic='Topic',materials='Shared material'){return collaboration.startMeeting(f.human,{operationId:`meeting-${topic}`,action:'meeting.start',input:{groupId:group.groupId,topic,materials}});}};
}
