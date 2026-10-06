import test from 'node:test';
import assert from 'node:assert/strict';
import { knownExecution } from './guide-fixture.mjs';
let api;try{api=await import('../src/operation-explanation.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;api={};}
function explain(p,o){assert.equal(typeof api.explainOperation,'function','Independent three-layer operation explanation must exist');return api.explainOperation(p,o);}
test('known native settlement survives nonzero exit and unconfirmed cleanup as separate conclusions',()=>{
 const p=knownExecution(),before=structuredClone(p),r=explain(p,{actualExitCode:1,records:[{event:'error',command:'close',errorCategory:'LOCAL_CLOSE_FAILED'}]});
 assert.deepEqual(p,before);assert.equal(r.operation.state,'KNOWN_SETTLED');assert.equal(r.operation.knownUsage,true);assert.equal(r.operation.receiptPresent,true);
 assert.equal(r.cliExit.state,'EXITED');assert.equal(r.cliExit.exitCode,1);assert.equal(r.cleanup.state,'UNCONFIRMED');assert.equal(r.cleanup.errorCategory,'LOCAL_CLOSE_FAILED');
});
test('unknown cannot be upgraded by a success-sounding model answer or exit0',()=>{
 const r=explain({...knownExecution(),state:'unknown',usage:null,receipt:null,reservationHeld:true,answers:['Success; completed and cleaned up.']},{actualExitCode:0});
 assert.equal(r.operation.state,'UNKNOWN');assert.equal(r.operation.reservationHeld,true);assert.equal(r.operation.knownUsage,false);assert.equal(r.cleanup.state,'UNCONFIRMED');
});
test('closing acknowledgement is not an actual exit or cleanup observation',()=>{
 const r=explain(knownExecution(),{closeAcknowledgement:{state:'closing'}});assert.equal(r.cliExit.state,'UNCONFIRMED');assert.equal(r.cleanup.state,'UNCONFIRMED');
});
test('SIGKILL terminal observation does not require finally and retains external recovery facts only',()=>{
 const r=explain({...knownExecution(),state:'unknown',usage:null,receipt:null,reservationHeld:true},{actualExitCode:-9,parentSentSigkill:true,writerLockReleased:true,originalIdReopened:true});
 assert.equal(r.cliExit.state,'SIGNALED');assert.equal(r.cliExit.signal,'SIGKILL');assert.equal(r.cleanup.state,'UNCONFIRMED');assert.equal(r.cleanup.writerLockReleased,true);assert.equal(r.cleanup.originalIdReopened,true);assert.equal(r.cleanup.fullOsCleanupProven,false);
});
test('kill request without process terminal observation cannot prove termination',()=>{
 assert.equal(explain(knownExecution(),{parentSentSigkill:true}).cliExit.state,'UNCONFIRMED');
});
test('observed local exit IO and reader completion remain limited rather than full OS cleanup',()=>{
 const r=explain(knownExecution(),{actualExitCode:0,readerThreadsClosed:true,io:{exitObserved:true,exitCode:0,attempts:{fetch:0,network:0,listener:0,child:0,outsideWrite:0,outsideRead:0}}});
 assert.equal(r.cleanup.state,'OBSERVED_LOCAL_COMPLETION');assert.equal(r.cleanup.fullOsCleanupProven,false);
 assert.equal(explain(knownExecution(),{actualExitCode:0,readerThreadsClosed:true,io:{exitObserved:true,exitCode:1,attempts:{fetch:0}}}).cleanup.state,'UNCONFIRMED');
});
test('settled label without complete native receipt or known usage remains unconfirmed',()=>{
 for(const p of [{...knownExecution(),receipt:null},{...knownExecution(),usage:null},{...knownExecution(),receipt:{sessionId:'x'}},{...knownExecution(),receipt:{...knownExecution().receipt,endSeq:1}}])assert.equal(explain(p).operation.state,'UNCONFIRMED');
});
test('product-row native receipts and safe owner projections get the same deterministic conclusions',()=>{
 const p=knownExecution(),native={state:p.state,usage:p.usage,reservationHeld:p.reservationHeld,remoteExecution:p.remoteExecution,failureCode:null,attempts:[{state:'observed',sessionReceipt:p.receipt}]};
 assert.deepEqual(explain({operationId:p.operationId,nativeOperationId:p.nativeOperationId,state:p.state,native}).operation,explain(p).operation);
});
test('outer unknown and malformed usage cannot be upgraded by a settled inner record',()=>{
 const p=knownExecution();assert.equal(explain({...p,state:'unknown',native:{...p,state:'settled',attempts:[{state:'observed',sessionReceipt:p.receipt}]}}).operation.state,'UNKNOWN');
 for(const usage of [{...p.usage,totalTokens:-1},{...p.usage,inputTokens:NaN},{totalTokens:8}])assert.equal(explain({...p,usage}).operation.state,'UNCONFIRMED');
 const r=explain(p,{actualExitSignal:'SIGKILL',parentSentSigkill:true,io:{exitObserved:true,exitCode:0,attempts:{fetch:0}},readerThreadsClosed:true,fullOsCleanupProven:true});
 assert.equal(r.cliExit.state,'SIGNALED');assert.equal(r.cleanup.state,'UNCONFIRMED');assert.equal(r.cleanup.fullOsCleanupProven,false);
});
test('a settled product label cannot override an unknown native journal',()=>{
 const p=knownExecution(),native={state:'unknown',usage:null,reservationHeld:true,remoteExecution:'unknown',failureCode:null,attempts:[]};
 const r=explain({...p,native});assert.equal(r.operation.state,'UNKNOWN');assert.equal(r.operation.reservationHeld,true);assert.equal(r.operation.knownUsage,false);
});
for(const outer of ['prepared','fenced'])test(`${outer} cannot claim not-sent when native receipt or usage contradicts it`,()=>{
 const p=knownExecution(),native={state:outer==='prepared'?'settled':'fenced',usage:p.usage,reservationHeld:false,remoteExecution:outer==='prepared'?'response_observed':'not_started',attempts:[{state:'observed',sessionReceipt:p.receipt}]};
 assert.equal(explain({...p,state:outer,native}).operation.state,'UNCONFIRMED');
});
