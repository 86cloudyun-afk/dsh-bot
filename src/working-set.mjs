/** Read-only context from existing task/progress/observation records. Never an execution capability. */
import { digest,requireValue } from './errors.mjs';
const clip=(value,bytes)=>{let out='';for(const char of String(value ?? '')){if(Buffer.byteLength(out+char)>bytes)break;out+=char;}return out;};
const positive=value=>Number.isSafeInteger(value) && value>0;
export function buildWorkingSet({task,bot,plans=[],attempts=[],projections=[],nativeOperations=[],authorityEpoch,namespace,phase='dispatch',now=Date.now()}){
 requireValue(typeof namespace==='string' && namespace.length>0 && task?.scope?.namespace===namespace,'working_set_scope_denied');
 requireValue(task?.ownerBotId===bot?.botId && task.ownerBotEpoch===bot.epoch && positive(task.revision)
  && positive(task.epoch) && positive(task.acceptanceVersion) && positive(authorityEpoch),'working_set_binding_conflict');
 requireValue(['dispatch','resume'].includes(phase) && Number.isFinite(now)
  && [plans,attempts,projections,nativeOperations].every(Array.isArray),'invalid_working_set');
 const goalDigest=digest({title:task.title,acceptance:task.acceptance}),reasons=[];
 const relevantPlans=plans.filter(p=>p.taskId===task.taskId && !['verified','stopped'].includes(p.state));
 let plan=relevantPlans.length===1?relevantPlans[0]:null;
 if(relevantPlans.length>1)reasons.push('progress_ambiguous');
 if(plan && (plan.taskRevision!==task.revision || plan.taskEpoch!==task.epoch || plan.botEpoch!==bot.epoch
  || plan.authorityEpoch!==authorityEpoch || plan.acceptanceVersion!==task.acceptanceVersion || plan.goalDigest!==goalDigest)){
  reasons.push('progress_binding_stale');plan=null;
 }
 const deadline=plan?.policySnapshot?.observationDeadline;
 const expired=deadline!==undefined && deadline!==null && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline)<=now);
 if(expired)reasons.push('observation_window_ended');
 if(bot.lifecycle!=='active' || task.stop?.state!=='none' || task.pendingRevision || task.responsibility==='verified')reasons.push('task_unavailable');
 const ownedAttempts=attempts.filter(a=>a.taskId===task.taskId),unknownAttempts=ownedAttempts.filter(a=>a.execution==='outcome_unknown');
 const unknownOperations=nativeOperations.filter(p=>p.taskId===task.taskId && (p.state==='unknown' || p.native?.state==='unknown'));
 const unknownCount=unknownAttempts.length+unknownOperations.length+(plan?.state==='reconciling_unknown'?1:0);
 const evidence=[];
 if(plan && !expired)for(const step of plan.steps ?? []){
  const a=ownedAttempts.find(a=>a.attemptId===step.attemptId && a.epoch===task.epoch && a.taskRevision===task.revision
   && a.botEpoch===bot.epoch && a.runGeneration!==null && a.runGeneration!==undefined && ['settled','failed'].includes(a.execution));
  if(!a || step.completionEvidence===null || step.completionEvidence===undefined)continue;
  const p=projections.find(p=>p.entityId===a.attemptId && p.generation===String(a.runGeneration) && p.freshness==='fresh'
   && positive(p.sourceSeq) && ['settled','failed'].includes(p.state) && p.state===a.execution
   && Number.isFinite(Date.parse(p.observedAt)) && Date.parse(p.observedAt)<=now);
  if(p)evidence.push({attemptId:clip(a.attemptId,160),digest:digest(step.completionEvidence),source:clip(p.source,64),
   sourceSeq:p.sourceSeq,generation:clip(p.generation,64),freshness:'fresh',state:p.state});
 }
 const next=plan?.steps?.find(s=>s.stepId===plan.nextStepId);
 const context={format:1,authority:'context-only',phase,namespace:clip(namespace,160),status:unknownCount?'unknown':reasons.length?'blocked':'current',
  recovery:unknownCount?'inspect-original-only':'explicit-new-operation-only',reasons,
  task:{id:clip(task.taskId,160),revision:task.revision,epoch:task.epoch,acceptanceVersion:task.acceptanceVersion,goalDigest,
   title:clip(task.title,120),acceptance:clip(task.acceptance,240),responsibility:task.responsibility},
  progress:plan?{id:clip(plan.planId,160),revision:plan.revision,eventCursor:plan.eventCursor,state:plan.state,nativeExecutionVerified:plan.nativeExecutionVerified===true,
   nextStep:next?{id:clip(next.stepId,160),title:clip(next.title,90),expectedEvidenceDigest:digest(next.expectedEvidence)}:null}:null,
  evidence:evidence.slice(0,2),evidenceOmitted:Math.max(0,evidence.length-2),
  unknown:{count:unknownCount,attemptIds:unknownAttempts.slice(0,2).map(a=>clip(a.attemptId,160)),
   operationIds:unknownOperations.slice(0,2).map(p=>clip(p.operationId,160)),reservations:'retain-recorded'}};
 while(Buffer.byteLength(JSON.stringify(context))>2048 && context.evidence.length){context.evidence.pop();context.evidenceOmitted++;}
 while(Buffer.byteLength(JSON.stringify(context))>2048 && context.unknown.operationIds.length)context.unknown.operationIds.pop();
 while(Buffer.byteLength(JSON.stringify(context))>2048 && context.unknown.attemptIds.length)context.unknown.attemptIds.pop();
 const text=JSON.stringify(context);requireValue(Buffer.byteLength(text)<=2048,'working_set_too_large');
 return {context,text,version:digest(context)};
}
export function renderWorkingSet(workset,input){
 requireValue(workset?.version===digest(workset.context) && workset.text===JSON.stringify(workset.context),'working_set_changed');
 const text=`DSH_WORKING_SET\n${workset.text}\nEXPLICIT_INPUT\n${input}`;
 requireValue(typeof input==='string' && input.trim().length>0 && Buffer.byteLength(text)<=4096,'invalid_native_input');return text;
}
