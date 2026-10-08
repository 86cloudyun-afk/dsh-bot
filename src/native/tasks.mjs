import {randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {copy,plain,requireCondition,validId} from './store.mjs';

/** Durable admission precedes native work; terminal resources precede slot release. */
export class TaskController {
  runtimeId=randomUUID();#launching=new Map();#watching=new Map();#closed=false;#closing=false;#timers=new Set();
  constructor({store,policy,adapter}) {Object.assign(this,{store,policy,adapter});}
  #source(actor) {
    if(actor.kind==='human')return {kind:'human'};
    const binding=this.store.read().sessions[actor.sessionId];
    return {kind:'session',sessionId:actor.sessionId,...copy(binding.lineage??{})};
  }
  async create(actor,command) {
    command=copy(command);const input=command.input;
    requireCondition(plain(input)&&Object.keys(input).every(key=>['botId','title','goal','criteria','originSessionId'].includes(key))&&validId(input.botId)&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=200&&typeof input.goal==='string'&&input.goal.trim().length>0&&input.goal.length<=16000&&Array.isArray(input.criteria)&&input.criteria.length<=30&&input.criteria.every(item=>typeof item==='string'&&item.length<=2000),'invalid_task');
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const bot=draft.bots[input.botId];requireCondition(bot?.lifecycle==='active','bot_not_active');
      const taskId=`task_${randomUUID()}`,task={taskId,botId:bot.botId,title:input.title.trim(),goal:input.goal,criteria:input.criteria,version:1,epoch:0,state:'queued',archived:false,acceptance:'unknown',currentAttemptId:null,originSessionId:input.originSessionId??(actor.kind==='bot'?actor.sessionId:null),source:this.#source(actor),origins:this.policy.readDependencies(actor),createdAt:new Date().toISOString()};
      draft.tasks[taskId]=task;this.policy.require(actor,'task.create',{kind:'task',id:taskId},draft);return task;
    });
  }
  async start(actor,command) {
    requireCondition(!this.#closed&&!this.#closing,'disabled');command=copy(command);const input=command.input;
    requireCondition(plain(input)&&Object.keys(input).every(key=>['taskId','expectedVersion','parentAttemptId'].includes(key)),'invalid_task');
    const intent=await this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId];requireCondition(task,'not_found');this.policy.require(actor,'task.start',{kind:'task',id:task.taskId},draft);
      requireCondition(task.version===input.expectedVersion,'revision_conflict');requireCondition(!task.archived,'archived');
      requireCondition(!Object.values(draft.attempts).some(row=>row.taskId===task.taskId&&row.reservationHeld),'attempt_unsettled');
      const parentId=input.parentAttemptId??(actor.kind==='bot'?draft.sessions[actor.sessionId].attemptId:null);
      const parent=parentId?draft.attempts[parentId]:null;
      if(parentId)requireCondition(parent?.reservationHeld&&['starting','running'].includes(parent.state)&&parent.botId===task.botId,'invalid_parent');
      const depth=parent?parent.depth+1:0;requireCondition(depth<=1,'depth_exceeded');
      requireCondition(Object.values(draft.attempts).filter(row=>row.botId===task.botId&&row.reservationHeld).length<15,'capacity_exhausted');
      const bot=draft.bots[task.botId];requireCondition(bot?.lifecycle==='active','bot_not_active');
      const attemptId=`attempt_${randomUUID()}`,sessionId=randomUUID(),epoch=task.epoch+1;
      const attempt={attemptId,taskId:task.taskId,botId:bot.botId,sessionId,epoch,taskVersion:task.version+1,parentAttemptId:parent?.attemptId??null,depth,model:copy(bot.execution),configRevision:bot.configRevision,state:'starting',reservationHeld:true,runtimeId:this.runtimeId,operationId:command.operationId,messageId:randomUUID(),readyOperationId:randomUUID(),settleOperationId:randomUUID(),createdAt:new Date().toISOString(),usage:'UNKNOWN',externalEffects:'UNKNOWN'};
      draft.attempts[attemptId]=attempt;task.epoch=epoch;task.version++;task.currentAttemptId=attemptId;task.state='running';task.acceptance='unknown';
      draft.sessions[sessionId]={sessionId,botId:bot.botId,purpose:'execution',attemptId,epoch,model:copy(attempt.model),configRevision:bot.configRevision,cwd:bot.cwd,presetId:bot.presetId,state:'creating',archived:false,source:copy(task.source),origins:copy(task.origins??[]),...(task.source.meetingId?{lineage:copy(task.source)}:{}),parentSessionId:parent?.sessionId??null,depth};
      return attempt;
    });
    const current=this.store.read().attempts[intent.attemptId];
    if(current.state!=='starting')return current;
    requireCondition(current.runtimeId===this.runtimeId,'recovery_required');
    if(this.#launching.has(current.attemptId))return this.#launching.get(current.attemptId);
    const launch=this.#launch(actor,current);this.#launching.set(current.attemptId,launch);
    try{return await launch;}finally{this.#launching.delete(current.attemptId);}
  }
  async #launch(actor,attempt) {
    try {
      const binding=this.store.read().sessions[attempt.sessionId];await this.adapter.createOwned(binding);
      await this.store.transact({operationId:attempt.readyOperationId,action:'attempt.ready',input:{attemptId:attempt.attemptId}},draft=>{
        const row=draft.attempts[attempt.attemptId];requireCondition(row.state==='starting','stale_attempt');this.policy.require(actor,'task.start',{kind:'task',id:attempt.taskId},draft);
        row.state='running';draft.sessions[row.sessionId].state='ready';return null;
      });
      const task=this.store.read().tasks[attempt.taskId],agent=this.adapter.context.agents.get(attempt.sessionId);
      requireCondition(agent&&task.currentAttemptId===attempt.attemptId,'stale_attempt');
      agent.followup(createUserMessage({id:attempt.messageId,content:[{type:'text',text:`执行任务 ${task.title}\n目标：${task.goal}\n验收条件：${JSON.stringify(task.criteria)}\n原始身份：${JSON.stringify({taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch,version:task.version})}\n可以使用 dsh_bot 查询进展或创建一级子任务。完成后给出实际结果及证据；没有证据的验收保持 unknown。`}],source:{kind:'dsh-bot-task',taskId:task.taskId,attemptId:attempt.attemptId,operationId:attempt.operationId}}));
      this.#watch(attempt.attemptId);return this.store.read().attempts[attempt.attemptId];
    }catch(error){
      await this.store.transact({operationId:randomUUID(),action:'attempt.unknown',input:{attemptId:attempt.attemptId,reason:error.code??error.name}},draft=>{const row=draft.attempts[attempt.attemptId];row.state='UNKNOWN';row.error=error.code??error.name;draft.tasks[row.taskId].state='UNKNOWN';return null;}).catch(()=>{});throw error;
    }
  }
  #watch(attemptId) {
    if(this.#watching.has(attemptId)||this.#closed)return;
    const run=(async()=>{
      while(!this.#closed) {
        const state=this.store.read(),attempt=state.attempts[attemptId];if(!attempt?.reservationHeld)return;
        const evidence=this.adapter.resources(attempt.sessionId),children=Object.values(state.attempts).filter(row=>row.parentAttemptId===attemptId&&row.reservationHeld);
        if(evidence.resourceFaults?.length) {
          await this.store.transact({operationId:randomUUID(),action:'attempt.resource-unknown',input:{attemptId}},draft=>{const row=draft.attempts[attemptId];row.state='UNKNOWN';row.error='resource_termination_unknown';row.localEvidence=evidence;draft.tasks[row.taskId].state='UNKNOWN';return null;});return;
        }
        if(evidence.known&&evidence.settled&&!children.length&&attempt.state!=='starting') {
          const live=this.adapter.context.sessions.get(attempt.sessionId);if(live)await this.adapter.context.sessions.flush(live);
          const history=await this.adapter.readNative(attempt.sessionId),end=history.events.filter(event=>event.type==='turn/end').at(-1);
          if(end||attempt.state==='stop_requested') {
            const reply=history.events.filter(event=>event.type==='assistant/message').at(-1);
            await this.store.transact({operationId:attempt.settleOperationId,action:'attempt.settled',input:{attemptId}},draft=>{
              const row=draft.attempts[attemptId];if(!row.reservationHeld)return null;
              const task=draft.tasks[row.taskId],stopped=['stop_requested','UNKNOWN'].includes(row.state)||task.version!==row.taskVersion;
              row.state=stopped?'stopped':end?.data.reason.kind==='stop'?'returned':'failed';row.reservationHeld=false;row.settledAt=new Date().toISOString();row.localEvidence=evidence;row.usage=evidence.requests.map(request=>request.usage);
              if(!stopped&&reply)row.result={sessionId:row.sessionId,eventSeq:reply.seq,content:copy(reply.data.content??reply.data.message?.content??[]),source:{sessionId:row.sessionId,eventSeq:reply.seq},origins:copy(draft.sessions[row.sessionId].origins??[])};
              draft.sessions[row.sessionId].state='settled';
              if(task.currentAttemptId===attemptId) {task.state=stopped?'stopped':row.state==='returned'?'awaiting_acceptance':'failed';task.version++;}
              return null;
            });await this.adapter.disposeOwned(attempt.sessionId);return;
          }
        }
        await new Promise(resolve=>{const timer=setTimeout(()=>{this.#timers.delete(timer);resolve();},20);this.#timers.add(timer);});
      }
    })().catch(()=>{}).finally(()=>this.#watching.delete(attemptId));this.#watching.set(attemptId,run);
  }
  async stop(actor,command) {
    command=copy(command);const input=command.input;
    const receipt=await this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId],attempt=draft.attempts[input.attemptId];requireCondition(task&&attempt,'not_found');this.policy.require(actor,'task.stop',{kind:'task',id:task.taskId},draft);
      requireCondition(task.currentAttemptId===attempt.attemptId&&attempt.taskId===task.taskId&&attempt.epoch===input.epoch,'stale_attempt');
      const forest=[attempt,...Object.values(draft.attempts).filter(row=>row.parentAttemptId===attempt.attemptId&&row.reservationHeld)];
      for(const row of forest)if(row.reservationHeld){row.state='stop_requested';row.stopOperationId=command.operationId;draft.sessions[row.sessionId].state='stopping';}
      task.state=attempt.reservationHeld?'stopping':task.state;return {accepted:true,taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch,operationId:command.operationId,attemptIds:forest.map(row=>row.attemptId),settled:!attempt.reservationHeld};
    });
    for(const id of receipt.attemptIds){const attempt=this.store.read().attempts[id];if(attempt.reservationHeld){void this.adapter.stopResources(attempt.sessionId).catch(()=>{});this.#watch(id);}}
    return receipt;
  }
  async adjust(actor,command) {
    command=copy(command);const input=command.input;
    const changed=await this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId];requireCondition(task,'not_found');this.policy.require(actor,'task.adjust',{kind:'task',id:task.taskId},draft);requireCondition(task.version===input.expectedVersion,'revision_conflict');
      for(const key of ['goal','title','criteria'])if(Object.hasOwn(input,key)) {requireCondition(key==='criteria'?Array.isArray(input[key])&&input[key].every(item=>typeof item==='string'):typeof input[key]==='string'&&input[key].length>0,'invalid_task');task[key]=copy(input[key]);}
      if(input.botId){requireCondition(draft.bots[input.botId]?.lifecycle==='active','bot_not_active');task.botId=input.botId;this.policy.require(actor,'task.create',{kind:'task',id:task.taskId},draft);}
      task.version++;task.acceptance='unknown';task.state='adjusted';task.adjustStopId=randomUUID();return task;
    });
    const attempt=this.store.read().attempts[changed.currentAttemptId];
    if(attempt?.reservationHeld)await this.stop(actor,{operationId:changed.adjustStopId,action:'task.stop',input:{taskId:changed.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch}});
    return this.store.read().tasks[changed.taskId];
  }
  async submit(actor,command) {
    command=copy(command);const input=command.input;
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId],attempt=draft.attempts[input.attemptId];requireCondition(task&&attempt,'not_found');this.policy.require(actor,'task.adjust',{kind:'task',id:task.taskId},draft);
      requireCondition(task.currentAttemptId===attempt.attemptId&&attempt.epoch===input.epoch&&attempt.taskVersion===task.version&&attempt.state==='running','stale_attempt');
      requireCondition(typeof input.report==='string'&&input.report.length<=16000,'invalid_report');
      if(actor.kind==='bot')requireCondition(actor.sessionId===attempt.sessionId,'access_denied');attempt.report={text:input.report,source:this.#source(actor),origins:this.policy.readDependencies(actor)};return {accepted:true,attemptId:attempt.attemptId};
    });
  }
  async accept(actor,command) {
    command=copy(command);const input=command.input;
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId],attempt=draft.attempts[input.attemptId];requireCondition(task&&attempt,'not_found');this.policy.require(actor,'task.accept',{kind:'task',id:task.taskId},draft);
      requireCondition(task.version===input.expectedVersion&&task.currentAttemptId===attempt.attemptId,'revision_conflict');requireCondition(!attempt.reservationHeld,'attempt_unsettled');
      requireCondition(['passed','failed','unknown'].includes(input.outcome)&&typeof input.evidence==='string'&&input.evidence.length<=16000,'invalid_acceptance');
      task.acceptance=input.outcome;task.acceptanceEvidence={text:input.evidence,attemptId:attempt.attemptId,source:this.#source(actor)};task.state=input.outcome==='passed'?'completed':'awaiting_acceptance';task.version++;return task;
    });
  }
  async #archive(actor,command,value) {
    command=copy(command);const input=command.input;
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const task=draft.tasks[input.taskId];requireCondition(task,'not_found');this.policy.require(actor,value?'task.archive':'task.restore',{kind:'task',id:task.taskId},draft);
      requireCondition(task.version===input.expectedVersion,'revision_conflict');requireCondition(!Object.values(draft.attempts).some(row=>row.taskId===task.taskId&&row.reservationHeld),'attempt_unsettled');
      task.archived=value;task.version++;return task;
    });
  }
  archive(actor,command){return this.#archive(actor,command,true);}
  restore(actor,command){return this.#archive(actor,command,false);}
  async close() {
    if(this.#closing)return;this.#closing=true;
    await Promise.allSettled([...this.#launching.values()]);
    await this.store.transact({operationId:randomUUID(),action:'runtime.disable-intent',input:{runtimeId:this.runtimeId}},draft=>{
      for(const row of Object.values(draft.attempts))if(row.runtimeId===this.runtimeId&&row.reservationHeld){row.state='stop_requested';draft.sessions[row.sessionId].state='stopping';draft.tasks[row.taskId].state='stopping';}return null;
    }).catch(()=>{});
    const pending=[];
    for(const row of Object.values(this.store.read().attempts))if(row.runtimeId===this.runtimeId&&row.reservationHeld){pending.push(this.adapter.stopResources(row.sessionId));this.#watch(row.attemptId);}
    let deadline;
    await Promise.race([Promise.allSettled([...pending,...this.#watching.values()]),new Promise(resolve=>{deadline=setTimeout(resolve,2000);})]);clearTimeout(deadline);
    this.#closed=true;
    await this.store.transact({operationId:randomUUID(),action:'runtime.disable-outcome',input:{runtimeId:this.runtimeId}},draft=>{
      for(const row of Object.values(draft.attempts))if(row.runtimeId===this.runtimeId&&row.reservationHeld){row.state='UNKNOWN';row.error='runtime_disabled_unsettled';draft.sessions[row.sessionId].state='UNKNOWN';draft.tasks[row.taskId].state='UNKNOWN';}return null;
    }).catch(()=>{});
    await Promise.allSettled([...this.#watching.values()]);
  }
}
