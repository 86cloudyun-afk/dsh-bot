import {randomUUID} from 'node:crypto';
import {canonical,copy,digest,plain,requireCondition,validId} from './store.mjs';
import {normalizeScheduleRule,nextTrigger,latestTrigger} from './schedule-clock.mjs';

const UNSETTLED=new Set(['planned','claimed','running','blocked','UNKNOWN']);
const SAFE_BLOCK=new Set(['capacity_exceeded','capacity_exhausted','bot_capacity','work_capacity_exceeded','dependency_not_accepted','dependency_not_ready','dependency_blocked','prerequisite_not_accepted','task_dependencies_not_satisfied','attempt_unsettled']);
const PAUSE_CODES=new Set(['schedule_config_changed','schedule_receiver_changed','model_unavailable','bot_not_active','access_denied','schedule_consent_invalid']);
const nowISO=at=>new Date(at).toISOString();
const excerpt=value=>[...value].slice(0,800).join('');
function textContent(value) {
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.filter(p=>p?.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n');
  return typeof value?.text==='string'?value.text:textContent(value?.content??[]);
}
function source(actor,state) {
  return actor.kind==='human'?{kind:'human'}:{kind:'session',sessionId:actor.sessionId,...copy(state.sessions[actor.sessionId]?.lineage??{})};
}
function recipeOf(input,ownerBotId) {
  requireCondition(plain(input)&&Object.keys(input).every(k=>['botId','title','goal','criteria','dependsOn','originSessionId'].includes(k))&&input.botId===ownerBotId&&validId(input.botId)&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=200&&typeof input.goal==='string'&&input.goal.trim().length>0&&input.goal.length<=16000&&Array.isArray(input.criteria)&&input.criteria.length<=30&&input.criteria.every(x=>typeof x==='string'&&x.length<=2000)&&validId(input.originSessionId),'invalid_schedule_recipe');
  const dependsOn=input.dependsOn??[];requireCondition(Array.isArray(dependsOn)&&dependsOn.length<=30&&dependsOn.every(validId)&&new Set(dependsOn).size===dependsOn.length,'invalid_schedule_recipe');
  return {...copy(input),title:input.title.trim(),dependsOn:[...dependsOn]};
}
/** Persistent notices and bounded triggers; native admission remains owned by Tasks. */
export class AssistantController {
  #timer;#generation=0;#started=false;#closed=false;#busy=false;#tail=Promise.resolve();#unsubscribe;
  constructor({store,policy,adapter,tasks,clock={}}) {
    Object.assign(this,{store,policy,adapter,tasks});
    this.clock={now:clock.now??(()=>Date.now()),setTimeout:clock.setTimeout??globalThis.setTimeout,clearTimeout:clock.clearTimeout??globalThis.clearTimeout};
    policy.registerScheduleAuthority((id,state)=>this.#authority(id,state));
  }
  #now(){const value=this.clock.now();return value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):value;}
  #internal(action,input,mutate) {return this.store.transact({operationId:`assistant_${randomUUID()}`,action,input},mutate);}
  #authenticate(actor){this.policy.actorKey(actor);requireCondition(['human','bot'].includes(actor.kind),'access_denied');}
  #owner(actor,botId,state) {
    this.#authenticate(actor);this.policy.require(actor,'bot.read',{kind:'bot',id:botId},state);
    requireCondition(state.bots[botId]&& (actor.kind==='human'||actor.botId===botId),'access_denied');
  }
  #visible(actor,record,state){return this.policy.canReadDerived(actor,record,state);}
  #configuration(actor,input,state,current) {
    requireCondition(plain(input)&&Object.keys(input).every(k=>['ownerBotId','kind','rule','recipe','message','enabled','missedPolicy','scheduleId','expectedVersion'].includes(k)),'invalid_schedule');
    const ownerBotId=current?.ownerBotId??input.ownerBotId;requireCondition(validId(ownerBotId)&&(!current||input.ownerBotId===undefined||input.ownerBotId===ownerBotId),'invalid_schedule');this.#owner(actor,ownerBotId,state);
    const merged={...current,...input},kind=merged.kind??'reminder',rule=normalizeScheduleRule(merged.rule);
    requireCondition(['reminder','task'].includes(kind)&&typeof (merged.enabled??true)==='boolean'&&['skip','latest'].includes(merged.missedPolicy??'skip'),'invalid_schedule');
    const result={ownerBotId,kind,rule,enabled:merged.enabled??true,missedPolicy:merged.missedPolicy??'skip'};
    if(kind==='task') {
      result.recipe=recipeOf(merged.recipe,ownerBotId);
      this.policy.require(actor,'session.send',{kind:'session',id:result.recipe.originSessionId},state);
      const receiver=state.sessions[result.recipe.originSessionId];requireCondition(receiver&&!receiver.archived&&receiver.state==='ready','schedule_receiver_changed');
      requireCondition(state.bots[ownerBotId].lifecycle==='active','bot_not_active');
      for(const taskId of result.recipe.dependsOn)this.policy.require(actor,'task.read',{kind:'task',id:taskId},state);
    } else {requireCondition(typeof merged.message==='string'&&merged.message.trim().length>0&&merged.message.length<=4000,'invalid_schedule');result.message=merged.message;}
    return result;
  }
  #consent(actor,stamped,schedule,state) {
    if(schedule.kind!=='task')return null;
    return {operationId:stamped.operationId,operationFingerprint:digest(stamped),callerKey:stamped.callerKey,command:copy(stamped),recipeHash:digest(schedule.recipe),configRevision:state.bots[schedule.ownerBotId].configRevision,sessionId:schedule.recipe.originSessionId,actions:['task.create','task.start'],consentVersion:schedule.consentVersion};
  }
  async createSchedule(actor,command) {
    this.#authenticate(actor);command=copy(command);requireCondition(command.action==='schedule.create','invalid_command');
    const stamped=this.policy.command(actor,command),at=this.#now();
    return this.store.transact(stamped,draft=>{
      const config=this.#configuration(actor,command.input,draft);requireCondition(Object.values(draft.schedules).filter(s=>!s.archived).length<100,'schedule_capacity_exceeded');
      const scheduleId=`schedule_${randomUUID()}`,trigger=nextTrigger(config.rule,at,{inclusive:true}),schedule={scheduleId,...config,version:1,consentVersion:1,archived:false,nextDueAt:trigger?.dueAt??null,nextTriggerKey:trigger?.triggerKey??null,source:source(actor,draft),origins:[...this.policy.readDependencies(actor),...(actor.kind==='bot'?[{kind:'session',id:actor.sessionId}]:[])],createdAt:nowISO(at)};
      if(config.recipe) {schedule.recipeHash=digest(config.recipe);schedule.dependencyOrigins=config.recipe.dependsOn.map(id=>({kind:'task',id}));}
      if(trigger?.skipReason)schedule.lastSkippedLocalTimes={reason:trigger.skipReason,count:trigger.skippedLocalTimes};
      schedule.executionConsent=this.#consent(actor,stamped,schedule,draft);draft.schedules[scheduleId]=schedule;return schedule;
    });
  }
  async updateSchedule(actor,command) {
    this.#authenticate(actor);command=copy(command);requireCondition(command.action==='schedule.update','invalid_command');const stamped=this.policy.command(actor,command),at=this.#now();
    return this.store.transact(stamped,draft=>{
      const current=draft.schedules[command.input.scheduleId];requireCondition(current,'not_found');this.#owner(actor,current.ownerBotId,draft);requireCondition(command.input.expectedVersion===current.version,'revision_conflict');requireCondition(!current.archived,'archived');
      const config=this.#configuration(actor,command.input,draft,current),trigger=nextTrigger(config.rule,at,{inclusive:true});
      const schedule={...current,...config,version:current.version+1,consentVersion:current.consentVersion+1,nextDueAt:trigger?.dueAt??null,nextTriggerKey:trigger?.triggerKey??null,origins:[...new Map([...(current.origins??[]),...this.policy.readDependencies(actor),...(actor.kind==='bot'?[{kind:'session',id:actor.sessionId}]:[])].map(r=>[canonical(r),r])).values()],source:source(actor,draft),contentSources:[...new Map([...(current.contentSources??[]),current.source,source(actor,draft)].filter(Boolean).map(r=>[canonical(r),r])).values()],updatedAt:nowISO(at)};
      delete schedule.pauseReason;delete schedule.missedRange;
      if(config.recipe){schedule.recipeHash=digest(config.recipe);schedule.dependencyOrigins=config.recipe.dependsOn.map(id=>({kind:'task',id}));}else{delete schedule.recipe;delete schedule.recipeHash;delete schedule.dependencyOrigins;}
      if(trigger?.skipReason)schedule.lastSkippedLocalTimes={reason:trigger.skipReason,count:trigger.skippedLocalTimes};
      schedule.executionConsent=this.#consent(actor,stamped,schedule,draft);draft.schedules[current.scheduleId]=schedule;return schedule;
    });
  }
  async setScheduleState(actor,command) {
    this.#authenticate(actor);command=copy(command);requireCondition(['schedule.state','schedule.pause','schedule.cancel','schedule.enable'].includes(command.action),'invalid_command');const stamped=this.policy.command(actor,command);
    return this.store.transact(stamped,draft=>{
      const input=command.input;requireCondition(plain(input)&&Object.keys(input).every(k=>['scheduleId','expectedVersion','enabled','archived'].includes(k))&&typeof input.enabled==='boolean'&&(input.archived===undefined||typeof input.archived==='boolean'),'invalid_schedule');
      const s=draft.schedules[input.scheduleId];requireCondition(s,'not_found');this.#owner(actor,s.ownerBotId,draft);requireCondition(input.expectedVersion===s.version,'revision_conflict');
      if(input.enabled&&s.kind==='task') {requireCondition(s.executionConsent?.configRevision===draft.bots[s.ownerBotId].configRevision,'schedule_config_changed');requireCondition(!s.archived||input.archived===false,'archived');}
      if(s.archived&&input.archived===false)requireCondition(Object.values(draft.schedules).filter(row=>!row.archived).length<100,'schedule_capacity_exceeded');
      s.enabled=input.enabled;s.archived=input.archived??s.archived;if(s.archived)s.enabled=false;s.version++;return s;
    });
  }
  #authority(id,state) {
    const occurrence=state.occurrences[id],s=state.schedules[occurrence?.scheduleId],c=s?.executionConsent;
    requireCondition(occurrence&&s?.kind==='task'&&c&&occurrence.consentVersion===s.consentVersion&&c.consentVersion===s.consentVersion,'schedule_consent_invalid');
    const receipt=state.operations[c.operationId];
    requireCondition(receipt&&['schedule.create','schedule.update'].includes(receipt.action)&&receipt.fingerprint===c.operationFingerprint&&digest(c.command)===c.operationFingerprint&&c.command.callerKey===c.callerKey&&receipt.result?.scheduleId===s.scheduleId&&receipt.result.ownerBotId===s.ownerBotId&&canonical(receipt.result.origins??[])===canonical(s.origins??[])&&canonical(receipt.result.source)===canonical(s.source)&&canonical(receipt.result.contentSources??[])===canonical(s.contentSources??[])&&canonical(receipt.result.executionConsent)===canonical(c)&&canonical(receipt.result.recipe)===canonical(s.recipe)&&c.recipeHash===digest(s.recipe)&&s.recipeHash===c.recipeHash&&occurrence.recipeHash===c.recipeHash&&canonical(occurrence.recipe)===canonical(s.recipe),'schedule_consent_invalid');
    requireCondition(c.callerKey==='human'||(c.callerKey===canonical(['bot',s.ownerBotId,s.source?.sessionId])&&state.sessions[s.source.sessionId]?.botId===s.ownerBotId),'schedule_consent_invalid');
    const bot=state.bots[s.ownerBotId];requireCondition(bot?.lifecycle==='active'&&!bot.deletedAt,'bot_not_active');requireCondition(bot.configRevision===c.configRevision&&occurrence.configRevision===c.configRevision,'schedule_config_changed');
    const receiver=state.sessions[c.sessionId];requireCondition(receiver&&receiver.state==='ready'&&!receiver.archived&&!this.adapter?.isArchived?.(c.sessionId)&&c.sessionId===s.recipe.originSessionId,'schedule_receiver_changed');
    const prospect={botId:s.ownerBotId,purpose:'execution',lineage:null};
    requireCondition(this.policy.canProspectiveBotReadDerived(prospect,s,state),'access_denied');
    this.policy.requireSavedConsentReceiverControl?.(c,s.ownerBotId,c.sessionId,state);
    const dependencyRefs=occurrence.attemptId?(state.attempts[occurrence.attemptId]?.prerequisiteInputs??[]).map(row=>({kind:'taskInput',id:row.inputId})):s.recipe.dependsOn.map(id=>({kind:'task',id}));
    for(const ref of [...(s.origins??[]),...dependencyRefs])requireCondition(this.policy.canProspectiveBotRead(prospect,ref,state),'access_denied');
    requireCondition(this.policy.canProspectiveBotRead(prospect,{kind:'session',id:c.sessionId},state),'access_denied');
    return {occurrenceId:id,scheduleId:s.scheduleId,consentVersion:s.consentVersion,botId:s.ownerBotId,sessionId:c.sessionId,recipe:copy(occurrence.recipe),recipeHash:c.recipeHash,origins:copy([...(occurrence.origins??s.origins??[]),...(occurrence.attemptId?dependencyRefs:[])]),...(occurrence.taskId?{taskId:occurrence.taskId}:{}),...(occurrence.attemptId?{attemptId:occurrence.attemptId}:{}),createOperationId:occurrence.createOperationId,startOperationId:occurrence.startOperationId,configRevision:c.configRevision,executionConsent:copy(c),admissionDeadlineAt:this.#deadline(occurrence),admissionObservedAt:this.#now(),admissionAllowed:!this.#closed};
  }
  #attemptSettled(attempt) {
    const proof=attempt?.localEvidence,current=attempt?.sessionId?this.adapter?.resources?.(attempt.sessionId):null;
    if(current?.known&&(!current.settled||current.resourceFaults?.length||current.releasePending||current.stopPending))return false;
    return !!attempt&&!attempt.reservationHeld&&['returned','completed','failed','stopped','interrupted','settled'].includes(attempt.state)&&typeof attempt.settledAt==='string'&&!!attempt.settledAt&&proof?.known===true&&proof.settled===true&&!proof.resourceFaults?.length&&!proof.releasePending&&!proof.stopPending&&!proof.terminalActive&&!proof.models&&!proof.tools&&!(proof.jobs??[]).some(job=>['running','stopping','UNKNOWN'].includes(job.status));
  }
  #deadline(occurrence){return Date.parse(occurrence.recoveryObservedAt??occurrence.dueAt)+60000;}
  #assertAdmission(id,state=this.store.read()) {
    requireCondition(!this.#closed,'disabled');const a=this.#authority(id,state),o=state.occurrences[id],s=state.schedules[o.scheduleId];
    requireCondition(s.enabled&&!s.archived&&o.state==='claimed','access_denied');requireCondition(this.#now()<=this.#deadline(o),'schedule_missed');
    requireCondition(!Object.values(state.occurrences).some(other=>other.scheduleId===s.scheduleId&&other.occurrenceId!==id&&UNSETTLED.has(other.state)),'attempt_unsettled');return a;
  }
  #noticeInDraft(draft,input) {
    const noticeId=input.noticeId??`notice_${digest([draft.storeId,input.kind,input.occurrenceId])}`;
    if(draft.notices[noticeId])return draft.notices[noticeId];
    return draft.notices[noticeId]={...copy(input),noticeId,version:1,read:false,createdAt:nowISO(this.#now())};
  }
  recordResultNoticeInDraft(draft,task,attempt,row=draft.outbox[attempt.resultOutboxId]) {
    if(!row||(!attempt.report&&!attempt.result))return null;
    requireCondition(row.kind==='result'&&row.taskId===task.taskId&&row.attemptId===attempt.attemptId&&row.epoch===attempt.epoch&&row.outboxId===attempt.resultOutboxId,'delivery_identity_unknown');
    return this.#noticeInDraft(draft,{noticeId:`notice_${digest([draft.storeId,task.taskId,attempt.attemptId,attempt.epoch,row.outboxId])}`,kind:'result',botId:task.botId,taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch,outboxId:row.outboxId,sessionId:row.sessionId??null,source:copy(task.source),origins:copy(task.origins??[])});
  }
  notices(actor,input={}) {
    this.#authenticate(actor);const state=this.store.read();return Object.values(state.notices).filter(n=>(!input.botId||n.botId===input.botId)&&(!input.sessionId||n.sessionId===input.sessionId)&&this.#noticeVisible(actor,n,state)).map(n=>this.#noticeDTO(actor,n,state));
  }
  #noticeVisible(actor,n,state) {
    if(!this.#visible(actor,n,state))return false;
    if(n.taskId&&!this.policy.canRead(actor,{kind:'task',id:n.taskId},null,state))return false;
    if(n.scheduleId&&!this.policy.canRead(actor,{kind:'schedule',id:n.scheduleId},null,state))return false;
    if(n.kind==='result') {const a=state.attempts[n.attemptId];return !!a&&this.#artifacts(actor,a,state).length>0;}
    return true;
  }
  #noticeDTO(actor,n,state) {
    const result=copy(n);if(n.kind==='result') {const task=state.tasks[n.taskId];result.title=task?.title;result.previews=this.#artifacts(actor,state.attempts[n.attemptId],state);}return result;
  }
  #artifacts(actor,a,state) {
    if(!a)return [];if(a.sessionId&&!this.policy.canRead(actor,{kind:'session',id:a.sessionId},null,state))return [];const output=[];
    for(const [kind,artifact] of [['report',a.report],['result',a.result]])if(artifact&&(!artifact.source?.sessionId||this.policy.canRead(actor,{kind:'session',id:artifact.source.sessionId},null,state))&&this.#visible(actor,{botId:a.botId??state.tasks[a.taskId]?.botId,...artifact},state)) {const text=textContent(kind==='report'?artifact.text:artifact.content??artifact.text);if(text)output.push({kind,attemptId:a.attemptId,text:excerpt(text)});}
    return output;
  }
  briefing(actor,input={}) {
    this.#authenticate(actor);const state=this.store.read(),notices=this.notices(actor,input);
    const tasks=Object.values(state.tasks).filter(t=>(!input.botId||t.botId===input.botId)&&(!input.sessionId||t.originSessionId===input.sessionId)&&!t.archived&&this.policy.canRead(actor,{kind:'task',id:t.taskId},null,state)).map(t=>{const a=state.attempts[t.currentAttemptId];return {taskId:t.taskId,botId:t.botId,title:t.title,version:t.version,state:t.state,acceptance:t.acceptance,attemptId:a?.attemptId??null,attemptState:a?.state??null,previews:this.#artifacts(actor,a,state)};});
    return {tasks,notices,unreadCount:notices.filter(n=>!n.read).length};
  }
  listSchedules(actor,input={}) {
    this.#authenticate(actor);const state=this.store.read();return Object.values(state.schedules).filter(s=>(!input.botId||s.ownerBotId===input.botId)&&(!input.ownerBotId||s.ownerBotId===input.ownerBotId)&&this.policy.canRead(actor,{kind:'schedule',id:s.scheduleId},null,state)).map(s=>{const dto=copy(s);delete dto.executionConsent;return dto;});
  }
  listOccurrences(actor,input={}) {
    this.#authenticate(actor);const state=this.store.read(),limit=input.limit??1000;requireCondition(Number.isInteger(limit)&&limit>=1&&limit<=10000,'invalid_input');
    return Object.values(state.occurrences).filter(o=>(!input.scheduleId||o.scheduleId===input.scheduleId)&&this.policy.canRead(actor,{kind:'schedule',id:o.scheduleId},null,state)&&this.#visible(actor,o,state)).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(-limit).map(o=>{const dto=copy(o);delete dto.recipe;return dto;});
  }
  async ackNotice(actor,command) {
    this.#authenticate(actor);command=copy(command);requireCondition(command.action==='notice.ack','invalid_command');return this.store.transact(this.policy.command(actor,command),draft=>{
      const input=command.input;requireCondition(plain(input)&&Object.keys(input).every(k=>['noticeId','expectedVersion'].includes(k)),'invalid_input');const n=draft.notices[input.noticeId];requireCondition(n,'not_found');this.#owner(actor,n.botId,draft);requireCondition(this.#noticeVisible(actor,n,draft),'access_denied');requireCondition(n.version===input.expectedVersion,'revision_conflict');n.read=true;n.version++;n.readAt=nowISO(this.#now());return n;
    });
  }
  async pruneOccurrences(actor,command) {
    this.#authenticate(actor);requireCondition(actor.kind==='human','access_denied');command=copy(command);requireCondition(command.action==='occurrence.prune','invalid_command');
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const input=command.input;requireCondition(plain(input)&&Object.keys(input).every(k=>['occurrenceIds','expectedVersions','confirm'].includes(k))&&input.confirm===true&&Array.isArray(input.occurrenceIds)&&input.occurrenceIds.length>0&&input.occurrenceIds.length<=10000&&input.occurrenceIds.every(validId)&&new Set(input.occurrenceIds).size===input.occurrenceIds.length&&plain(input.expectedVersions),'invalid_input');
      for(const id of input.occurrenceIds){const o=draft.occurrences[id];requireCondition(o,'not_found');requireCondition(input.expectedVersions[id]===o.version,'revision_conflict');requireCondition(['settled','missed'].includes(o.state),'occurrence_unsettled');
        requireCondition(!Object.values(draft.attempts).some(a=>(a.attemptId===o.attemptId||a.taskId===o.taskId||a.occurrenceId===id||(o.attemptId&&a.parentAttemptId===o.attemptId))&&(a.reservationHeld||a.state==='UNKNOWN'))&&!Object.values(draft.outbox).some(r=>(r.occurrenceId===id||r.taskId===o.taskId&&o.taskId||r.attemptId===o.attemptId&&o.attemptId)&&['queued','admitting','UNKNOWN'].includes(r.state))&&!Object.values(draft.operations).some(op=>op.result?.state==='UNKNOWN'&&(op.result.occurrenceId===id||op.result.taskId===o.taskId&&o.taskId||op.result.attemptId===o.attemptId&&o.attemptId)),'occurrence_referenced');
      }
      for(const id of input.occurrenceIds)delete draft.occurrences[id];
      for(const s of Object.values(draft.schedules))if(s.pauseReason==='occurrence_capacity_exceeded')delete s.pauseReason;
      return {pruned:input.occurrenceIds};
    });
  }
  diagnostics(actor,input={}) {
    this.#authenticate(actor);const state=this.store.read({diagnostic:true}),versions={plugin:'1.1.0',service:'1.1.0',protocol:2,dsh:'0.2.0-rc.2',node:process.version,platform:process.platform,arch:process.arch};
    const counts={};for(const key of ['bots','sessions','tasks','attempts','schedules','occurrences','notices','materials'])counts[key]=Object.values(state[key]).filter(row=>actor.kind==='human'||(row.botId??row.ownerBotId)===actor.botId).length;
    const result={versions,profileId:digest(state.storeId).slice(0,24),features:{schedules:true,reminders:true,notices:true},counts,operationIds:(Array.isArray(input.operationIds)?input.operationIds:[]).filter(id=>validId(id)&&Object.hasOwn(state.operations,id)).slice(0,100)};
    if(input.error)result.errorCode=[...SAFE_BLOCK,...PAUSE_CODES,'recovery_required','disposed','delivery_identity_unknown','native_admission_unknown','occurrence_capacity_exceeded'].includes(input.error.code)?input.error.code:'unknown_error';
    if(typeof input.phase==='string'&&['idle','admission','execution','delivery','recovery','storage'].includes(input.phase))result.phase=input.phase;
    return result;
  }
  async start() {
    if(this.#closed||this.#started)return;this.#started=true;this.#unsubscribe=this.store.subscribe(()=>{if(!this.#busy)this.#arm();});await this.runDue({recovery:true});this.#arm();
  }
  #clear(){if(this.#timer!==undefined){this.clock.clearTimeout(this.#timer);this.#timer=undefined;}this.#generation++;}
  #arm() {
    this.#clear();if(!this.#started||this.#closed)return;const state=this.store.read(),now=this.#now();let due=Infinity;
    for(const s of Object.values(state.schedules))if(s.enabled&&!s.archived&&s.pauseReason!=='occurrence_capacity_exceeded'){
      const pending=Object.values(state.occurrences).filter(o=>o.scheduleId===s.scheduleId&&UNSETTLED.has(o.state));
      if(pending.some(o=>['running','UNKNOWN'].includes(o.state)&&state.attempts[o.attemptId]?.reservationHeld&&o.state!==(state.attempts[o.attemptId].state==='UNKNOWN'?'UNKNOWN':'running'))){due=Math.min(due,now);continue;}
      if(pending.some(o=>['claimed','running','UNKNOWN'].includes(o.state)&&this.#attemptSettled(state.attempts[o.attemptId]))){due=Math.min(due,now);continue;}
      if(pending.some(o=>['claimed','running','UNKNOWN'].includes(o.state)))continue;
      for(const o of pending)due=Math.min(due,Math.max(now+1000,Math.min(this.#deadline(o)+1,now+5000)));
      if(!pending.length&&s.nextDueAt)due=Math.min(due,Date.parse(s.nextDueAt));
    }
    if(!Number.isFinite(due))return;const generation=this.#generation;
    this.#timer=this.clock.setTimeout(async()=>{if(this.#closed||generation!==this.#generation)return;this.#timer=undefined;await this.runDue();},Math.max(0,Math.min(due-now,2147483647)));this.#timer?.unref?.();
  }
  runDue(options={}) {
    if(this.#closed)return Promise.resolve();const run=async()=>{if(this.#closed)return;this.#busy=true;try{await this.#run(options);}finally{this.#busy=false;this.#arm();}};
    const promise=this.#tail.then(run);this.#tail=promise.catch(()=>{});return promise;
  }
  async #run({recovery=false}={}) {
    const at=this.#now();
    await this.#reconcile(recovery);
    for(const s of Object.values(this.store.read().schedules)) {
      if(this.#closed)return;if(!s.enabled||s.archived)continue;
      let pending=Object.values(this.store.read().occurrences).filter(o=>o.scheduleId===s.scheduleId&&UNSETTLED.has(o.state));
      if(pending.some(o=>['claimed','running','UNKNOWN'].includes(o.state)))continue;
      if(recovery&&pending.length&&s.kind==='task'&&s.missedPolicy==='latest') {
        await this.#observePendingRecovery(s.scheduleId,at);
        pending=Object.values(this.store.read().occurrences).filter(o=>o.scheduleId===s.scheduleId&&UNSETTLED.has(o.state));
        if(pending.some(o=>['claimed','running','UNKNOWN'].includes(o.state)))continue;
      }
      if(pending.length) {for(const o of pending)if(['planned','blocked'].includes(o.state))await this.#admit(o.occurrenceId);continue;}
      if(!s.nextDueAt||Date.parse(s.nextDueAt)>at)continue;
      const ids=await this.#materialize(s.scheduleId,at,recovery);for(const id of ids)await this.#admit(id);
    }
  }
  #provedUnadmitted(occurrence,state) {
    return ['planned','blocked'].includes(occurrence.state)&&
      (occurrence.state==='planned'||SAFE_BLOCK.has(occurrence.errorCode)||PAUSE_CODES.has(occurrence.errorCode)||occurrence.errorCode==='disabled')&&
      !occurrence.attemptId&&!state.operations[occurrence.startOperationId]&&
      (!occurrence.taskId||!Object.values(state.attempts).some(attempt=>attempt.taskId===occurrence.taskId));
  }
  async #observePendingRecovery(scheduleId,at) {
    return this.#internal('schedule.observeRecovery',{scheduleId,observedAt:nowISO(at)},draft=>{
      const schedule=draft.schedules[scheduleId];
      if(!schedule?.enabled||schedule.archived||schedule.kind!=='task'||schedule.missedPolicy!=='latest')return false;
      const pending=Object.values(draft.occurrences).filter(o=>o.scheduleId===scheduleId&&UNSETTLED.has(o.state));
      if(pending.some(o=>['claimed','running','UNKNOWN'].includes(o.state)))return false;
      const latest=latestTrigger(schedule.rule,at);if(!latest)return false;
      for(const occurrence of pending) {
        if(occurrence.consentVersion!==schedule.consentVersion||Date.parse(occurrence.dueAt)>at)continue;
        // A saved blocked label alone cannot prove that native admission did not occur.
        if(!this.#provedUnadmitted(occurrence,draft)) {occurrence.state='UNKNOWN';occurrence.errorCode='admission_unknown';occurrence.version++;continue;}
        if(Date.parse(latest.dueAt)>Date.parse(occurrence.dueAt)) {
          occurrence.state='missed';occurrence.version++;this.#missedNotice(draft,schedule,occurrence,at);
          schedule.missedRange={fromDueAt:occurrence.dueAt,throughDueAt:latest.dueAt,reason:'late_wakeup',observedAt:nowISO(at)};
        } else if(latest.dueAt===occurrence.dueAt&&!occurrence.recoveryObservedAt&&at>Date.parse(occurrence.dueAt)+60000) {
          occurrence.recoveryObservedAt=nowISO(at);occurrence.version++;
        }
      }
      return true;
    });
  }
  async #reconcile(recovery) {
    const rows=Object.values(this.store.read().occurrences).filter(o=>['claimed','running','UNKNOWN'].includes(o.state));if(!rows.length)return;
    await this.#internal('schedule.reconcile',{recovery},draft=>{
      for(const old of rows){const o=draft.occurrences[old.occurrenceId];if(!o||!['claimed','running','UNKNOWN'].includes(o.state))continue;const a=draft.attempts[o.attemptId],before=o.state;
        if(a){o.receipt={attemptId:a.attemptId,state:a.state,reservationHeld:!!a.reservationHeld};o.state=a.reservationHeld?(a.state==='UNKNOWN'?'UNKNOWN':'running'):(this.#attemptSettled(a)?'settled':'UNKNOWN');}
        else if(recovery&&o.state==='claimed')o.state='UNKNOWN';if(before!==o.state)o.version++;
      }return true;
    });
  }
  async #materialize(scheduleId,at,recovery) {
    return this.#internal('schedule.trigger',{scheduleId,at:nowISO(at),recovery},draft=>{
      const s=draft.schedules[scheduleId];if(!s.enabled||s.archived||!s.nextDueAt||Date.parse(s.nextDueAt)>at)return [];
      if(Object.values(draft.occurrences).some(o=>o.scheduleId===scheduleId&&UNSETTLED.has(o.state)))return [];
      const first={dueAt:s.nextDueAt,triggerKey:s.nextTriggerKey},latest=latestTrigger(s.rule,at),late=at-Date.parse(first.dueAt)>60000;
      const catchup=s.kind==='task'&&late&&recovery&&s.missedPolicy==='latest'&&latest;
      const triggers=[first,...(catchup&&latest.dueAt!==first.dueAt?[latest]:[])];
      if(Object.keys(draft.occurrences).length+triggers.length>10000){s.pauseReason='occurrence_capacity_exceeded';s.version++;this.#noticeInDraft(draft,{kind:'schedule_capacity',occurrenceId:`capacity_${scheduleId}_${s.consentVersion}`,scheduleId,botId:s.ownerBotId,message:'Occurrence history is full; export and explicitly clean settled history.',source:s.source,origins:s.origins??[]});return [];}
      const ids=[];
      for(const trigger of triggers) {
        const occurrenceId=`occurrence_${digest([scheduleId,s.consentVersion,s.rule.version,trigger.triggerKey])}`;
        if(draft.occurrences[occurrenceId])continue;
        const missed=s.kind==='task'&&late&&(!catchup||trigger.dueAt!==latest.dueAt),o={occurrenceId,scheduleId,consentVersion:s.consentVersion,dueAt:trigger.dueAt,triggerKey:trigger.triggerKey,version:1,claimVersion:0,state:missed?'missed':'planned',createOperationId:`schedule_create_${digest(occurrenceId)}`,startOperationId:`schedule_start_${digest(occurrenceId)}`,source:s.source,origins:copy(s.origins??[]),createdAt:nowISO(at)};
        if(s.recipe)Object.assign(o,{recipe:copy(s.recipe),recipeHash:s.recipeHash,configRevision:s.executionConsent.configRevision,originSessionId:s.recipe.originSessionId});
        if(catchup&&trigger.dueAt===latest.dueAt)o.recoveryObservedAt=nowISO(at);
        draft.occurrences[occurrenceId]=o;
        if(missed)this.#missedNotice(draft,s,o,at);else if(s.kind==='reminder'){o.state='settled';this.#noticeInDraft(draft,{kind:'reminder',occurrenceId,scheduleId,botId:s.ownerBotId,message:s.message,dueAt:o.dueAt,late:at>Date.parse(o.dueAt),source:s.source,origins:s.origins??[]});}else ids.push(occurrenceId);
      }
      if(latest&&latest.dueAt!==first.dueAt)s.missedRange={fromDueAt:s.missedRange?.observedAt===nowISO(at)?s.missedRange.fromDueAt:first.dueAt,throughDueAt:latest.dueAt,reason:'late_wakeup',observedAt:nowISO(at)};
      const next=nextTrigger(s.rule,Math.max(at,Date.parse(first.dueAt)));s.nextDueAt=next?.dueAt??null;s.nextTriggerKey=next?.triggerKey??null;s.version++;
      if(next?.skipReason)s.lastSkippedLocalTimes={reason:next.skipReason,count:next.skippedLocalTimes};return ids;
    });
  }
  #missedNotice(draft,s,o,at){this.#noticeInDraft(draft,{kind:'missed',occurrenceId:o.occurrenceId,scheduleId:s.scheduleId,botId:s.ownerBotId,dueAt:o.dueAt,late:at>Date.parse(o.dueAt),source:s.source,origins:s.origins??[],message:'Scheduled task missed its admission window.'});}
  async #admit(id) {
    if(this.#closed)return;
    const claimed=await this.#internal('schedule.claim',{occurrenceId:id},draft=>{
      const o=draft.occurrences[id],s=draft.schedules[o?.scheduleId];if(!o||!['planned','blocked'].includes(o.state)||!s?.enabled||s.archived)return false;
      if(this.#now()>this.#deadline(o)){o.state='missed';o.version++;this.#missedNotice(draft,s,o,this.#now());return false;}
      try {this.#authority(id,draft);}catch(error){if(PAUSE_CODES.has(error.code)){s.enabled=false;s.pauseReason=error.code;s.version++;o.state='blocked';o.errorCode=error.code;o.version++;return false;}throw error;}
      o.state='claimed';o.claimVersion++;o.version++;return true;
    });
    if(!claimed||this.#closed)return;
    try {
      let authority=this.#assertAdmission(id);
      if(this.adapter?.validateModel)await this.adapter.validateModel(this.store.read().bots[authority.botId].execution);
      authority=this.#assertAdmission(id);const actor=this.policy.fromScheduleOccurrence(id),o=this.store.read().occurrences[id];
      if(!o.taskId)await this.tasks.createScheduled(actor,{operationId:o.createOperationId,action:'task.create',input:{occurrenceId:id}});
      this.#assertAdmission(id);await this.tasks.startScheduled(actor,{operationId:o.startOperationId,action:'task.start',input:{occurrenceId:id}});
      await this.#internal('schedule.admitted',{occurrenceId:id},draft=>{const current=draft.occurrences[id];if(current?.state==='claimed'){current.state='running';current.version++;}return true;});
    } catch(error) {
      await this.#internal('schedule.admissionOutcome',{occurrenceId:id},draft=>{
        const o=draft.occurrences[id],s=draft.schedules[o.scheduleId],attempt=draft.attempts[o.attemptId];
        if(attempt?.reservationHeld){o.state=attempt.state==='UNKNOWN'?'UNKNOWN':'running';}
        else if(error.code==='schedule_missed'){o.state='missed';this.#missedNotice(draft,s,o,this.#now());}
        else if(SAFE_BLOCK.has(error.code)){o.state='blocked';}
        else if(PAUSE_CODES.has(error.code)||error.code==='disabled'){o.state='blocked';if(s.enabled){s.enabled=false;s.pauseReason=error.code;s.version++;}}
        else{o.state='UNKNOWN';}
        o.errorCode=typeof error.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(error.code)?error.code:'admission_unknown';o.version++;return true;
      });
    }
  }
  async close(){if(this.#closed)return;this.#closed=true;this.#clear();this.#unsubscribe?.();await this.#tail;await this.store.drain();}
}
