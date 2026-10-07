import {Host} from '../src/host.js';
import type {OwnedWorkSessionPort,OfflineWorkSessionRuntime,WorkSessionView,WorkRuntimeReceipt} from '../src/host.js';
import type {Ledger,CommandEnvelope} from '../src/contracts.js';
declare const ledger:Ledger, caller:object, e:CommandEnvelope;
const runtime:OfflineWorkSessionRuntime={kind:'offline-synthetic',sourceId:'unit',async start(binding){return {receiptId:'r',sourceId:'unit',sourceSeq:1,binding,state:'running',execution:'may-execute',creation:'confirmed'};},async inspect(){return null;}};
const h=new Host({ledger,ownerHumanId:'synthetic',ownerCapability:caller,workSessionRuntime:runtime});
const p:OwnedWorkSessionPort=h.openOwnedWorkSessionPort(caller,{botId:'b',botEpoch:1,authorityEpoch:1});
const v:WorkSessionView=p.delegate(e,{task_id:'t',goal:'g',completion_condition:'c'}).result;
p.admit(e,{task_id:'t',generation:1});p.query({task_ids:['t']});await p.collect({task_id:'t',generation:1});p.dispose();
const continuationCheck:Promise<void>=p.verifyContinuationParent({task_id:'t',generation:1},new AbortController().signal);
// @ts-expect-error Original selectors cannot submit serialized parent proof.
p.verifyContinuationParent({task_id:'t',generation:1,parentProof:{remote:'settled'}});
// @ts-expect-error completion condition is mandatory
p.delegate(e,{task_id:'t',goal:'g'});
// @ts-expect-error generation is numeric
p.admit(e,{task_id:'t',generation:'1'});
// @ts-expect-error no stock-native proof can be supplied
const native:OfflineWorkSessionRuntime={...runtime,kind:'stock-native'};
// @ts-expect-error public receipt submission is absent
p.collect({task_id:'t',generation:1,receipt:{} as WorkRuntimeReceipt});
// @ts-expect-error view is immutable
v.sessionId='changed';
// @ts-expect-error read-only port cannot delegate
h.createOwnedBotTaskReadPort(caller).delegate(e,{task_id:'t',goal:'g',completion_condition:'c'});
