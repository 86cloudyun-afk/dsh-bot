/** Safe deterministic projection of trusted records; never changes native settlement or grants authority. */
const category=value=>value==null?null:typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)?value:'owner_runtime_unconfirmed';
const id=value=>typeof value==='string' && value.length>0 && value.length<=256?value:null;
function knownUsage(value){
 return value!=null && ['inputTokens','outputTokens','totalTokens'].every(key=>Number.isSafeInteger(value[key]) && value[key]>=0)
  && value.totalTokens===value.inputTokens+value.outputTokens
  && ['cacheReadTokens','cacheWriteTokens'].every(key=>value[key]===undefined || Number.isSafeInteger(value[key]) && value[key]>=0);
}
function completeReceipt(value){
 return id(value?.sessionId)!==null && ['turn','step'].every(key=>Number.isSafeInteger(value[key]) && value[key]>0)
  && ['startSeq','assistantSeq','endSeq'].every(key=>Number.isSafeInteger(value[key]) && value[key]>=0)
  && value.startSeq<value.assistantSeq && value.assistantSeq<value.endSeq
  && ['assistantDigest','endDigest'].every(key=>typeof value[key]==='string' && /^[a-f0-9]{64}$/.test(value[key]));
}
export function explainOperation(value={},observations={}){
 const p=value ?? {},n=p.native ?? undefined,usage=n?n.usage:p.usage,receipt=n?n.attempts?.at(-1)?.sessionReceipt:p.receipt;
 const nativeState=n?.state ?? p.state ?? null,receiptPresent=completeReceipt(receipt),usageKnown=knownUsage(usage);
 const localErrorCategory=category(p.errorCategory ?? n?.failureCode),reservationHeld=n?n.reservationHeld:p.reservationHeld;
 let state='UNCONFIRMED';
 if(p.state==='unknown' || nativeState==='unknown')state='UNKNOWN';
 else if(!receiptPresent && !usageKnown && (p.state==='prepared' && !n && (p.remoteExecution==null || p.remoteExecution==='not_started')
  || p.state==='fenced' && nativeState==='fenced' && (n?.remoteExecution ?? p.remoteExecution)==='not_started'))state='NOT_SENT';
 else if(p.state==='settled' && nativeState==='settled' && receiptPresent && usageKnown
  && (!n || n.attempts?.length>0 && n.attempts.every(a=>a.state==='observed')))state='KNOWN_SETTLED';
 else if(['admitting','admitted','driving','consumed'].includes(p.state))state='PENDING';
 const operation={operationId:id(p.operationId),nativeOperationId:id(p.nativeOperationId),state,nativeState,
  knownUsage:usageKnown,receiptPresent,reservationHeld:typeof reservationHeld==='boolean'?reservationHeld:null,localErrorCategory};
 let exitCode=Number.isInteger(observations.actualExitCode)?observations.actualExitCode:null;
 let signal=typeof observations.actualExitSignal==='string' && /^SIG[A-Z0-9]+$/.test(observations.actualExitSignal)?observations.actualExitSignal:null;
 if(exitCode===-9)signal='SIGKILL';
 let exitState=signal!==null || exitCode!==null && exitCode<0?'SIGNALED':exitCode!==null?'EXITED':'UNCONFIRMED';
 if(signal!==null && exitCode!==null && exitCode>=0)exitState='UNCONFIRMED';
 const cliExit={state:exitState,exitCode,signal};
 const failed=observations.records?.find(r=>r?.event==='error' && r.command==='close');
 const cleanupError=failed?category(failed.errorCategory ?? 'owner_runtime_unconfirmed'):null,io=observations.io;
 const localComplete=exitState==='EXITED' && io?.exitObserved===true && io.exitCode===exitCode
  && observations.readerThreadsClosed===true && cleanupError===null
  && ['fetch','network','listener','child','outsideWrite','outsideRead'].every(key=>io.attempts?.[key]===0);
 const cleanup={state:localComplete?'OBSERVED_LOCAL_COMPLETION':'UNCONFIRMED',errorCategory:cleanupError,
  writerLockReleased:observations.writerLockReleased===true,originalIdReopened:observations.originalIdReopened===true,
  fullOsCleanupProven:false};
 return {operation,cliExit,cleanup};
}
