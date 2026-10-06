/** Bounded stdin grammar. No field in these frames supplies authority. */
import { CommandError,requireValue } from './errors.mjs';
export const OWNER_FRAME_BYTES=8192;
const fields={status:['command'],close:['command'],progress:['command'],prepare:['command','operationId','kind','text'],
 admit:['command','operationId'],run:['command','operationId'],inspect:['command','operationId'],stop:['command','operationId'],
 plan:['command','operationId','expectedRevision','steps'],advance:['command','operationId','planId','expectedRevision','cursor'],
 submit:['command','operationId','expectedRevision','expectedAuthorityEpoch','artifactDigest','evidence'],
 accept:['command','operationId','expectedRevision','artifactDigest','acceptanceVersion','outcome']};
const positive=value=>Number.isSafeInteger(value) && value>0;
const identifier=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const boundedText=(value,bytes)=>typeof value==='string' && value.trim().length>0 && Buffer.byteLength(value)<=bytes;
export function parseOwnerCommand(line){
 requireValue(typeof line==='string' && Buffer.byteLength(line)<=OWNER_FRAME_BYTES,'invalid_owner_command');
 let value;try{value=JSON.parse(line);}catch{throw new CommandError('invalid_owner_command');}
 requireValue(value && Object.getPrototypeOf(value)===Object.prototype && typeof value.command==='string'
  && Object.hasOwn(fields,value.command),'invalid_owner_command');
 const keys=fields[value.command];requireValue(Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key)),'invalid_owner_command');
 if(keys.includes('operationId'))requireValue(identifier(value.operationId),'invalid_owner_command');
 if(value.command==='prepare')requireValue(['contact','execution'].includes(value.kind) && typeof value.text==='string' && value.text.trim().length>0 && Buffer.byteLength(value.text)<=4096,'invalid_owner_command');
 if(keys.includes('expectedRevision'))requireValue(positive(value.expectedRevision),'invalid_owner_command');
 if(value.command==='plan')requireValue(Array.isArray(value.steps) && value.steps.length>0 && value.steps.length<=20 && value.steps.every(s=>s && Object.getPrototypeOf(s)===Object.prototype
  && Object.keys(s).length===2 && Object.hasOwn(s,'title') && Object.hasOwn(s,'evidence') && boundedText(s.title,500) && boundedText(s.evidence,1000)),'invalid_owner_command');
 if(value.command==='advance')requireValue(identifier(value.planId) && positive(value.cursor),'invalid_owner_command');
 if(keys.includes('artifactDigest'))requireValue(typeof value.artifactDigest==='string' && /^[a-f0-9]{64}$/.test(value.artifactDigest),'invalid_owner_command');
 if(value.command==='submit')requireValue(positive(value.expectedAuthorityEpoch) && boundedText(value.evidence,4096),'invalid_owner_command');
 if(value.command==='accept')requireValue(positive(value.acceptanceVersion) && ['passed','failed','inconclusive'].includes(value.outcome),'invalid_owner_command');
 return value;
}
/** Attach only after native app readiness; disposal stops admission synchronously. */
export function listenOwnerLines(input,onLine,onError,onEnd){
 let parts=[],bytes=0,closed=false;
 const dispose=()=>{if(closed)return;closed=true;input.off('data',data);input.off('end',end);input.off('error',error);input.pause();};
 const line=()=>{const buffer=Buffer.concat(parts,bytes);parts=[];bytes=0;if(!buffer.length)return;
  try{onLine(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{onError(new CommandError('invalid_owner_command'));}
 };
 const data=chunk=>{if(closed)return;const buffer=typeof chunk==='string'?Buffer.from(chunk):chunk;let offset=0;
  while(offset<buffer.length && !closed){const found=buffer.indexOf(10,offset),end=found===-1?buffer.length:found,part=buffer.subarray(offset,end);
   if(bytes+part.length>OWNER_FRAME_BYTES){onError(new CommandError('invalid_owner_command'));dispose();onEnd(2);return;}
   parts.push(part);bytes+=part.length;offset=end+1;if(found!==-1)line();
  }
 };
 const end=()=>{if(closed)return;line();dispose();onEnd(0);};
 const error=()=>{if(closed)return;onError(new CommandError('owner_input_failed'));dispose();onEnd(2);};
 input.on('data',data);input.once('end',end);input.once('error',error);input.resume();
 if(input.readableEnded)queueMicrotask(end);return dispose;
}
