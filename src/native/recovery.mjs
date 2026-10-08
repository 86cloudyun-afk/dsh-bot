import {requireCondition} from './store.mjs';

/** Restart never turns synthetic native closers or absent handles into settlement proof. */
export class Reconciler {
  constructor({store,policy,adapter,tasks,broker}) {Object.assign(this,{store,policy,adapter,tasks,broker});}
  async reconcile(actor,command) {
    requireCondition(actor.kind==='human','access_denied');
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const unknown=[];
      for(const attempt of Object.values(draft.attempts))if(attempt.reservationHeld&&attempt.runtimeId!==this.tasks.runtimeId) {
        attempt.state='UNKNOWN';attempt.error='previous_runtime_unsettled';unknown.push(attempt.attemptId);
        if(draft.sessions[attempt.sessionId])draft.sessions[attempt.sessionId].state='UNKNOWN';
        if(draft.tasks[attempt.taskId])draft.tasks[attempt.taskId].state='UNKNOWN';
      }
      for(const binding of Object.values(draft.sessions))if(binding.ownerRuntimeId!==this.adapter.runtimeId&&(binding.state==='creating'||['group','independent','meeting'].includes(binding.purpose)&&binding.state==='ready')) {binding.state='UNKNOWN';binding.error='previous_channel_runtime';}
      for(const group of Object.values(draft.groups))for(const round of Object.values(group.rounds??{}))if(round.state==='running'&&round.runtimeId!==this.tasks.runtimeId){round.state='UNKNOWN';round.error='previous_round_runtime';unknown.push(round.roundId);}
      for(const meeting of Object.values(draft.meetings))if(!['complete','cancelled'].includes(meeting.phase)&&meeting.runtimeId!==this.tasks.runtimeId) {
        meeting.runtimeState='UNKNOWN';
        for(const participant of meeting.participants.filter(row=>row.active)) {
          const records=meeting.phase==='independent'?meeting.opinions:meeting.phase==='discussion'?meeting.discussion:{[meeting.coordinatorBotId]:meeting.decision};
          if(!records?.[participant.botId]&&draft.sessions[participant.sessionId]?.state==='UNKNOWN')meeting.absences[participant.botId]={reason:'previous_runtime_unsettled',epoch:meeting.epoch,memberEpoch:participant.memberEpoch,phase:meeting.phase};
        }
      }
      for(const row of Object.values(draft.outbox))if(['queued','admitting'].includes(row.state)&&row.runtimeId!==this.broker?.runtimeId){row.state='UNKNOWN';row.error='previous_delivery_runtime';}
      return {unknown,replayed:0,released:0};
    });
  }
}
