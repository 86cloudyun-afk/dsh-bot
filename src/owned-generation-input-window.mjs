/** Native receipt-backed event projection. Copied views and message source labels grant nothing. */
import {canonical,digest,requireValue} from './errors.mjs';
import {loadOwnedGenerationSdk} from './owned-generation-bridge.mjs';

const windows=new WeakSet();
export async function ownedGenerationInputWindow(source,ownerCtx,receipt,binding){
 const sdk=await loadOwnedGenerationSdk();
 requireValue(sdk.isOwnedGenerationSource(source,ownerCtx)===true&&sdk.isOwnedGenerationReceipt(receipt,source,binding)===true,'owned_input_window_required');
 if(typeof sdk.getOwnedGenerationReceiptInputWindow!=='function')return null;
 const native=sdk.getOwnedGenerationReceiptInputWindow(receipt,source,binding);requireValue(native&&native.sessionId===binding.sessionId&&native.inputMessageId===binding.inputMessageId&&Number.isSafeInteger(native.startSeq)&&Number.isSafeInteger(native.endSeq)&&native.endSeq>=native.startSeq&&Array.isArray(native.runtimeContexts),'owned_input_window_required');
 const window=Object.freeze({...native,runtimeContexts:Object.freeze(native.runtimeContexts.map(row=>Object.freeze({...row}))),runtimeContextMessageIds:Object.freeze([...native.runtimeContextMessageIds])});windows.add(window);return window;
}
export function projectOwnedGenerationEvents(window,events,{delegate=false}={}){
 requireValue(windows.has(window)&&Array.isArray(events),'owned_input_window_required');
 const scoped=events.filter(e=>e.seq>=window.startSeq&&e.seq<window.endSeq),contexts=new Set();
 for(const context of window.runtimeContexts){const matches=scoped.filter(e=>e.seq===context.seq&&e.type==='user/message'&&e.data.id===context.messageId&&digest(e.data)===context.messageDigest);requireValue(matches.length===1,'owned_input_window_changed');contexts.add(context.seq);}
 requireValue(new Set(window.runtimeContexts.map(row=>row.seq)).size===window.runtimeContexts.length,'owned_input_window_changed');
 let projected=scoped.filter(e=>!contexts.has(e.seq));
 const users=projected.filter(e=>e.type==='user/message');requireValue(users.length===1&&users[0].data.id===window.inputMessageId,'owned_input_window_changed');
 if(delegate){const responses=projected.filter(e=>e.type==='assistant/message'),prefixes=responses.slice(0,-1);for(const event of prefixes){const message=event.data.message;requireValue(!event.data.interrupted&&message?.source?.kind==='model'&&message.source.provider==='deepseek-official'&&message.content?.length&&message.content.every(block=>block.type==='tool-call'&&block.name==='dsh_bot_delegate')&&event.data.stream?.some(row=>row.chunk?.type==='finish'&&row.chunk.reason?.kind==='tool-calls'),'owned_delegate_window_changed');for(const block of message.content){const calls=projected.filter(e=>e.type==='tool/call'&&e.data.turn===event.data.turn&&e.data.callId===block.id&&e.data.name===block.name&&canonical(JSON.parse(e.data.arguments))===canonical(JSON.parse(block.arguments))),results=projected.filter(e=>e.type==='tool/result'&&e.data.turn===event.data.turn&&e.data.message.toolCallId===block.id);requireValue(calls.length===1&&results.length===1&&event.seq<calls[0].seq&&calls[0].seq<results[0].seq&&results[0].seq<responses.at(-1).seq&&results[0].sourceEventSeqs?.length===1&&results[0].sourceEventSeqs[0]===calls[0].seq,'owned_delegate_window_changed');}}const removed=new Set(prefixes.map(e=>e.seq));projected=projected.filter(e=>!removed.has(e.seq));}
 return projected;
}
