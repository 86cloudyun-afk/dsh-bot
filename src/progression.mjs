import { randomUUID } from 'node:crypto';
import { canonical,digest,requireValue,text } from './errors.mjs';
import { REQUIRED_NATIVE } from './adapter.mjs';
export function autonomyPolicy(value={}) {
 requireValue(value && Object.keys(value).every(k=>['enabled','maxSteps','maxRetries','observationDeadline','reportMilestonesOnly'].includes(k)),'invalid_policy');
 const p={enabled:false,maxSteps:20,maxRetries:0,observationDeadline:null,reportMilestonesOnly:true,...value};
 requireValue(typeof p.enabled==='boolean' && typeof p.reportMilestonesOnly==='boolean' && Number.isSafeInteger(p.maxSteps) && p.maxSteps>=1 && p.maxSteps<=100 && Number.isSafeInteger(p.maxRetries) && p.maxRetries>=0 && p.maxRetries<=10,'invalid_policy');
 requireValue(p.observationDeadline===null || (typeof p.observationDeadline==='string' && Number.isFinite(Date.parse(p.observationDeadline))),'invalid_policy');return p;
}
export function registerProgression(host) {
 Object.assign(host.extensions,{
  createProgressPlan(p,e) {
   const t=this.object('task',p.taskId,e),b=this.object('bot',t.ownerBotId);
   requireValue(t.stop.state==='none' && t.responsibility!=='verified','task_stopped');requireValue(b.lifecycle==='active','owner_unavailable');
   requireValue(!t.pendingRevision,'revision_pending');requireValue(!this.ledger.list('progress').some(x=>x.taskId===t.taskId && !['verified','stopped'].includes(x.state)),'plan_exists');
   const cfg=this.ledger.get('config',b.configVersion),policy=cfg.autonomy;
   requireValue(Array.isArray(p.steps) && p.steps.length>0 && p.steps.length<=policy.maxSteps,'invalid_plan');
   const steps=p.steps.map(s=>({stepId:randomUUID(),title:text(s.title,'step title',500),expectedEvidence:text(s.evidence,'expected evidence',1000),state:'pending',attemptId:null,completionEvidence:null}));
   return this.save('progress',{planId:randomUUID(),taskId:t.taskId,taskRevision:t.revision,taskEpoch:t.epoch,botEpoch:b.epoch,authorityEpoch:this.ledger.get('grant','root').epoch,goalDigest:digest({title:t.title,acceptance:t.acceptance}),acceptanceVersion:t.acceptanceVersion,configSnapshot:cfg,policySnapshot:policy,steps,nextStepId:steps[0].stepId,checkpoint:null,eventCursor:0,retryCount:0,epoch:1,revision:1,state:'planned',nativeExecutionVerified:false,observedAt:e.createdAt});
  },
  advanceTask(p,e) {
   const plan=this.object('progress',p.planId,e),t=this.object('task',plan.taskId),b=this.object('bot',t.ownerBotId);
   requireValue(t.epoch===plan.taskEpoch && b.epoch===plan.botEpoch && this.ledger.get('grant','root').epoch===plan.authorityEpoch,'epoch_conflict');
   requireValue(t.stop.state==='none' && b.lifecycle==='active','task_stopped');requireValue(t.revision===plan.taskRevision && !t.pendingRevision,'revision_conflict');
   text(p.eventId,'eventId',200);requireValue(Number.isSafeInteger(p.cursor) && p.cursor>0 && ['user','result','authorized_check','recovery'].includes(p.trigger),'invalid_progress_event');
   const eventKey=canonical([plan.planId,p.eventId]),binding=digest(p),previous=this.ledger.get('progress-event',eventKey);
   if(previous) {requireValue(previous.binding===binding,'event_conflict');return plan;}
   requireValue(p.cursor===plan.eventCursor+1,'cursor_conflict');
   requireValue(!['verified','stopped','submitted'].includes(plan.state),'stage_conflict');
   const unknown=plan.state==='reconciling_unknown' || this.ledger.list('attempt').some(a=>a.taskId===t.taskId && ['outcome_unknown','admitted','running','settling'].includes(a.execution));
   const expired=plan.policySnapshot.observationDeadline!==null && Date.parse(plan.policySnapshot.observationDeadline)<=Date.now();
   const blockers=REQUIRED_NATIVE.map(capability=>({code:'unsupported',capability}));
   if(!plan.policySnapshot.enabled) blockers.push({code:'policy_disabled'});
   const state=unknown?'reconciling_unknown':expired?'blocked':'waiting_native';
   this.ledger.put('progress-event',eventKey,{id:eventKey,binding,cursor:p.cursor,trigger:p.trigger});
   return this.save('progress',{...plan,revision:plan.revision+1,eventCursor:p.cursor,state,blockers:unknown?[{code:'outcome_unknown',action:'Native operation lookup required; no replay'}]:expired?[{code:'observation_window_ended'}]:blockers,checkpoint:{eventId:p.eventId,trigger:p.trigger,nextStepId:plan.nextStepId,evidence:null,effectsIssued:false},observedAt:new Date().toISOString()});
  }
 });
}
