import {requireCondition} from './store.mjs';

/** Restart never turns synthetic native closers or absent handles into settlement proof. */
export class Reconciler {
  constructor({store,policy,adapter,tasks}) {Object.assign(this,{store,policy,adapter,tasks});}
  async reconcile(actor,command) {
    requireCondition(actor.kind==='human','access_denied');
    return this.store.transact(this.policy.command(actor,command),draft=>{
      const unknown=[];
      for(const attempt of Object.values(draft.attempts))if(attempt.reservationHeld&&attempt.runtimeId!==this.tasks.runtimeId) {
        attempt.state='UNKNOWN';attempt.error='previous_runtime_unsettled';unknown.push(attempt.attemptId);
        if(draft.sessions[attempt.sessionId])draft.sessions[attempt.sessionId].state='UNKNOWN';
        if(draft.tasks[attempt.taskId])draft.tasks[attempt.taskId].state='UNKNOWN';
      }
      for(const binding of Object.values(draft.sessions))if(binding.state==='creating') {binding.state='UNKNOWN';binding.error='creation_interrupted';}
      for(const row of Object.values(draft.outbox))if(['queued','admitting'].includes(row.state)){row.state='UNKNOWN';row.error='previous_delivery_runtime';}
      return {unknown,replayed:0,released:0};
    });
  }
}
