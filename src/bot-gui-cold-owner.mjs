/** Owner-scoped history reads only. This module never activates an Agent or mints native proof. */
import {Context,symbols} from '@deepseek-ai/cordis';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {Host} from './host.mjs';
import {canonical,requireValue} from './errors.mjs';
import {unknownGenerationObservation} from './owned-generation-bridge.mjs';

const identity=value=>value?.[symbols.original]??value;
const active=fiber=>fiber?.state===2&&fiber.uid!==null;
const id=value=>requireValue(typeof value==='string'&&value.length>0&&value.length<=200,'gui_cold_payload_invalid');
const exact=(value,keys)=>requireValue(value&&Object.getPrototypeOf(value)===Object.prototype
  &&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'gui_cold_payload_invalid');
const textMessage=event=>event?.type==='assistant/message'&&event.data.interrupted!==true&&event.data.message?.source?.kind==='model'
  &&Array.isArray(event.data.message.content)&&event.data.message.content.length>0&&event.data.message.content.every(block=>block.type==='text'&&typeof block.text==='string')
  ?event.data.message.content.map(block=>block.text).join('').slice(0,4096):null;

export function installBotGuiColdOwner({ownerCtx,host,connection,peer,connectionGeneration,getConnectionGeneration,
  botId,mainSessionId,isOwnerCurrent}){
  requireValue(ownerCtx instanceof Context&&host instanceof Host&&host.adapter.context===ownerCtx
    &&typeof isOwnerCurrent==='function'&&typeof getConnectionGeneration==='function','gui_cold_owner_required');
  const owner=ownerCtx.fiber,actualConnection=identity(ownerCtx.get('connection')),query=ownerCtx.get('sessionQuery'),queryIdentity=identity(query);
  requireValue(actualConnection instanceof HostConnectionService&&connection===actualConnection&&peer===connection.operator
    &&peer?.ctx instanceof Context&&scopeOf(peer.ctx)===peer&&connectionGeneration&&getConnectionGeneration()===connectionGeneration
    &&query instanceof SessionQueryEngine,'gui_cold_actual_services_required');
  id(botId);id(mainSessionId);const configVersion=host.object('bot',botId).configVersion;let closed=false;
  function ownerCurrent(){
    const result=isOwnerCurrent();if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    return result===true;
  }
  const readPort=host.createOwnedBotTaskReadPort(owner,{isCurrent:()=>!closed&&ownerCurrent()});
  function live(actualPeer,signal){
    requireValue(!closed&&active(owner)&&active(peer.ctx.fiber)&&actualPeer===peer&&identity(ownerCtx.get('connection'))===connection
      &&connection.operator===peer&&getConnectionGeneration()===connectionGeneration&&ownerCurrent()
      &&identity(ownerCtx.get('sessionQuery'))===queryIdentity&&!signal?.aborted,'gui_cold_owner_stale');
    const bot=host.object('bot',botId);requireValue(bot.contactSessionId===mainSessionId&&bot.configVersion===configVersion,'gui_cold_binding_changed');
    readPort.snapshot({botIds:[botId],taskIds:[]});
  }
  async function log(sessionId,checkpoint){
    checkpoint();let result;
    try{result=await query.readSession(sessionId);}catch{checkpoint();return null;}
    checkpoint();requireValue(result?.session?.id===sessionId&&Array.isArray(result.events),'gui_cold_history_changed');
    return result.events;
  }
  function reply(events){
    if(!events)return null;
    const response=events.findLast(event=>textMessage(event)!==null);if(!response)return null;
    const start=events.findLast(event=>event.type==='turn/start'&&event.data.turn===response.data.turn&&event.seq<response.seq);
    const inputs=events.filter(event=>event.type==='user/message'&&event.seq>(start?.seq??Infinity)&&event.seq<response.seq);
    if(inputs.length!==1||textMessage(response).length===0)return null;
    return{messageId:response.data.message.id,turn:response.data.turn,text:textMessage(response),inputMessageId:inputs[0].data.id,inputKind:inputs[0].data.source?.kind??'unknown'};
  }
  async function selectedView(checkpoint){
    checkpoint();const ledger=host.ledger,work=ledger.list('workTask').filter(row=>row.botId===botId);requireValue(work.length<=500,'gui_cold_scope_exceeded');
    const events=await log(mainSessionId,checkpoint),routes=ledger.list('workObservedResponse');
    const rows=await Promise.all(work.map(async row=>{
      checkpoint();const original=ledger.get('workGeneration',canonical([botId,row.taskId,row.generation]));
      requireValue(original?.sessionId===row.sessionId&&typeof original.held==='boolean','gui_cold_binding_changed');
      const history=await log(row.sessionId,checkpoint);checkpoint();
      const recorded=routes.find(route=>route.botId===botId&&route.taskId===row.taskId&&route.sessionId===row.sessionId
        &&route.generation===row.generation&&route.routing==='durably-queued');
      const observed=recorded&&history?.find(event=>event.data?.message?.id===recorded.responseMessageId&&event.data.turn===recorded.turn
        &&textMessage(event)!==null&&textMessage(event)===recorded.text?.slice(0,4096));
      return{taskId:row.taskId,task_id:row.task_id,sessionId:row.sessionId,generation:row.generation,goal:row.goal,completion_condition:row.completion_condition,
        state:original.state,held:original.held,stop:{state:original.fence?'accepted':'none'},result:observed?{text:textMessage(observed),responseMessageId:recorded.responseMessageId,turn:recorded.turn}:null,
        generationObservation:unknownGenerationObservation(),preciseNativeSettlementVerified:false};
    }));
    checkpoint();const counter=ledger.get('ownedMainGenerationCounter',canonical([botId,mainSessionId]));
    return{version:1,status:'ready',readOnly:true,botId,contact:{sessionId:mainSessionId,status:'unknown',reply:reply(events),generation:counter?.generation??null,
      generationObservation:unknownGenerationObservation(),preciseNativeSettlementVerified:false},work:rows,
      held:ledger.list('workGeneration').filter(row=>row.botId===botId&&row.held===true).length,limit:15,preciseNativeSettlementVerified:false};
  }
  async function receipt(payload,checkpoint){
    exact(payload,['operationId','nonce']);id(payload.operationId);id(payload.nonce);checkpoint();
    const row=host.ledger.get('contactOwnerOperation',canonical([botId,payload.operationId]));
    requireValue(row?.botId===botId&&row.sessionId===mainSessionId&&row.configVersion===configVersion&&row.nonce===payload.nonce,'gui_cold_original_required');
    let state=row.command==='sendContactText'?'unknown':row.state==='accepted'?'accepted':'unknown';
    if(row.command==='sendContactText'&&row.effectStarted&&row.message){
      const events=await log(mainSessionId,checkpoint),inserted=events?.flatMap(event=>event.type==='agent/inbox/spliced'?event.data.inserted:[])
        .filter(message=>message.id===row.message.id);
      if(inserted?.length===1&&canonical(inserted[0])===canonical(row.message))state='durably-queued';
    }
    checkpoint();return{version:1,operationId:row.operationId,nonce:row.nonce,botId,sessionId:mainSessionId,messageId:row.message?.id??row.messageId??null,state,
      generationObservation:unknownGenerationObservation(),preciseNativeSettlementVerified:false};
  }
  const handler=async(endpoint,request,signal,actualPeer)=>{
    try{
      const checkpoint=()=>live(actualPeer,signal);checkpoint();
      exact(request,['command','botId','payload']);requireValue(request.command===endpoint&&request.botId===botId,'gui_cold_scope_denied');
      let value;
      if(endpoint==='selectedView'){exact(request.payload,[]);value=await selectedView(checkpoint);}
      else{requireValue(endpoint==='inspectContactReceipt','gui_cold_read_only');value=await receipt(request.payload,checkpoint);}
      checkpoint();return{ok:true,value};
    }catch{return{ok:false,error:{code:'dsh-bot-owner/action-unconfirmed',message:'action-unconfirmed',details:{}}};}
  };
  live(peer);const unregister=ownerCtx.get('connection').rpc.handle('/dsh-bot-owner',handler);
  const dispose=()=>{if(closed)return;closed=true;void unregister?.();};ownerCtx.effect(()=>()=>dispose());
  return Object.freeze({dispose});
}
