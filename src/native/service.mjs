import {copy,plain,requireCondition,validId} from './store.mjs';

/** One business surface shared by authenticated GUI RPC and Agent-scoped tools. */
export class BotService {
  #closed=false;
  constructor({store,policy,bots,sessions,adapter,tasks,broker,collaboration,recovery}) {
    Object.assign(this,{store,policy,bots,sessions,adapter,tasks,broker,collaboration,recovery});
  }
  resolveCaller(exec) {requireCondition(!this.#closed,'disabled');return this.policy.fromAgent(exec.agent);}
  snapshot(actor) {
    requireCondition(!this.#closed,'disabled');this.policy.actorKey(actor);
    const state=this.store.read(),result={revision:state.revision,status:'enabled',releaseReady:false};
    for(const [kind,table] of Object.entries({bot:'bots',session:'sessions',memory:'memories',task:'tasks',group:'groups',meeting:'meetings'})) {
      result[table]=Object.entries(state[table]).filter(([id,row])=>this.policy.canRead(actor,{kind,id})&&!(kind==='memory'&&row.forgotten)).map(([id,row])=>{this.policy.noteRead(actor,{kind,id});return copy(row);});
    }
    result.grants=Object.values(state.grants).filter(row=>actor.kind==='human'||row.recipientBotId===actor.botId).map(copy);
    result.attempts=Object.values(state.attempts).filter(row=>this.policy.canRead(actor,{kind:'task',id:row.taskId})).map(copy);
    result.outbox=Object.values(state.outbox).filter(row=>actor.kind==='human'||row.botId===actor.botId).map(copy);
    return result;
  }
  async #rememberReads(actor) {
    if(actor.kind!=='bot')return;
    const refs=this.policy.readDependencies(actor);if(!refs.length)return;
    const current=this.store.read().sessions[actor.sessionId];
    const origins=[...new Map([...(current.origins??[]),...refs].map(ref=>[JSON.stringify(ref),ref])).values()];
    if(JSON.stringify(origins)===JSON.stringify(current.origins??[]))return;
    await this.store.transact({operationId:crypto.randomUUID(),action:'session.origins',input:{sessionId:actor.sessionId,origins}},draft=>{
      for(const ref of refs)this.policy.require(actor,`${ref.kind}.read`,ref,draft);
      draft.sessions[actor.sessionId].origins=origins;return null;
    });
  }
  async dispatch(actor,command,signal) {
    requireCondition(!this.#closed,'disabled');signal?.throwIfAborted();command=copy(command);
    requireCondition(plain(command)&&Object.keys(command).every(key=>['operationId','action','input','expectedRevision'].includes(key))&&typeof command.action==='string'&&plain(command.input??{}),'invalid_command');
    command.input??={};const {action,input}=command;
    let result;
    if(action==='snapshot')result=this.snapshot(actor);
    else if(action==='catalog') {this.policy.actorKey(actor);result={...await this.adapter.models(),presets:await this.adapter.context.get('agentPresets')?.list()??[]};}
    else if(action==='session.page')result=await this.sessions.page(actor,input,signal);
    else if(action==='session.list')result=await this.sessions.list(actor,input,signal);
    else if(action==='memory.search')result=this.bots.searchMemory(actor,input);
    else {
      requireCondition(validId(command.operationId),'invalid_operation');
      const routes={'bot.create':[this.bots,'create'],'bot.update':[this.bots,'update'],'session.create':[this.sessions,'create'],
        'session.archive':[this.sessions,'archive'],'session.restore':[this.sessions,'restore'],
        'memory.write':[this.bots,'memoryWrite'],'memory.forget':[this.bots,'memoryForget'],
        'share.set':[this.policy,'authorizeShare'],'grant.set':[this.policy,'authorizeShare'],
        'task.create':[this.tasks,'create'],'task.start':[this.tasks,'start'],'task.adjust':[this.tasks,'adjust'],'task.stop':[this.tasks,'stop'],
        'task.submit':[this.tasks,'submit'],'task.accept':[this.tasks,'accept'],'task.archive':[this.tasks,'archive'],'task.restore':[this.tasks,'restore'],
        'session.send':[this.broker,'enqueue'],'group.create':[this.collaboration,'createGroup'],'group.post':[this.collaboration,'post'],
        'group.members':[this.collaboration,'changeMembers'],'meeting.start':[this.collaboration,'startMeeting'],'meeting.opinion':[this.collaboration,'submitOpinion'],
        'meeting.advance':[this.collaboration,'advance'],'meeting.topic':[this.collaboration,'changeTopic'],'meeting.cancel':[this.collaboration,'cancel'],
        'meeting.action':[this.collaboration,'actionTask'],'recovery.reconcile':[this.recovery,'reconcile']};
      const route=Object.hasOwn(routes,action)?routes[action]:null;requireCondition(route&&typeof route[0]?.[route[1]]==='function','unknown_action');
      result=await route[0][route[1]](actor,command,signal);
    }
    signal?.throwIfAborted();
    if(actor.kind==='bot') {
      if(action==='snapshot')result=this.snapshot(actor);
      else if(action==='session.page')this.policy.noteRead(actor,{kind:'session',id:input.sessionId});
      else if(action==='memory.search')for(const row of result)this.policy.noteRead(actor,{kind:'memory',id:row.memoryId});
      await this.#rememberReads(actor);
      for(const ref of this.policy.readDependencies(actor))this.policy.require(actor,`${ref.kind}.read`,ref);
    }
    return copy(result);
  }
  close() {this.#closed=true;}
}
