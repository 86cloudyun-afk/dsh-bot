import { canonical, copy, digest, plain, requireCondition, validId } from "./store.mjs";

const tables = {
  bot: "bots",
  session: "sessions",
  memory: "memories",
  task: "tasks",
  taskInput: "taskInputs",
  group: "groups",
  meeting: "meetings",
  material: "materials",
  schedule: "schedules",
  notice: "notices",
};
const scopeKeys = { session: "sessions", memory: "memories", task: "tasks", taskInput: "tasks", material: "materials" };
const humanOnly = new Set([
  "bot.create",
  "bot.delete",
  "bot.restore",
  "share.set",
  "grant.set",
  "group.members",
]);
const controllable = new Set([
  "session.configure",
  "session.fork",
  "session.create",
  "session.send",
  "session.stop",
  "session.archive",
  "session.restore",
  "task.create",
  "task.start",
  "task.adjust",
  "task.stop",
  "task.archive",
  "task.restore",
  "task.accept",
  "task.dependencies.set",
  "task.handoff",
]);
export const defaultShare = () => ({
  enabled: true,
  receivers: ["*"],
  scope: { sessions: ["*"], tasks: ["*"], memories: ["*"], materials: ["*"] },
});
function validScope(scope) {
  return (
    plain(scope) &&
    Object.keys(scope).every((key) => Object.values(scopeKeys).includes(key)) &&
    Object.values(scope).every(
      (ids) =>
        Array.isArray(ids) &&
        ids.length <= 10000 &&
        ids.every((id) => id === "*" || validId(id)),
    )
  );
}
function includes(scope, resource) {
  const list = scope?.[scopeKeys[resource.kind]];
  return (
    Array.isArray(list) && (list.includes("*") || list.includes(resource.kind === "taskInput" ? resource.record?.taskId : resource.id))
  );
}

/** Caller tokens are process-local; neither labels nor serialized actors count. */
export class PermissionPolicy {
  #store;
  #agents;
  #operator;
  #actors = new WeakSet();
  #reads = new WeakMap();
  #scheduleAuthority;
  constructor(store, { agents, operatorPeer } = {}) {
    this.#store = store;
    this.#agents = agents;
    this.#operator = operatorPeer;
  }
  fromPeer(peer) {
    requireCondition(peer && peer === this.#operator, "access_denied");
    const actor = Object.freeze({ kind: "human" });
    this.#actors.add(actor);
    return actor;
  }
  fromAgent(agent) {
    const binding = this.#store.read().sessions[agent?.id];
    requireCondition(
      agent && this.#agents?.get(agent.id) === agent && binding?.botId,
      "access_denied",
    );
    const actor = Object.freeze({
      kind: "bot",
      botId: binding.botId,
      sessionId: agent.id,
      agent,
    });
    this.#actors.add(actor);
    return actor;
  }
  registerScheduleAuthority(validate) {
    requireCondition(typeof validate === 'function' && !this.#scheduleAuthority, 'access_denied');
    this.#scheduleAuthority = validate;
  }
  #schedule(occurrenceId, state) {
    requireCondition(validId(occurrenceId) && this.#scheduleAuthority, 'access_denied');
    const prospect = copy(this.#scheduleAuthority(occurrenceId, state));
    requireCondition(plain(prospect) && prospect.occurrenceId === occurrenceId && validId(prospect.scheduleId) && validId(prospect.botId) && validId(prospect.sessionId) && plain(prospect.recipe) && typeof prospect.recipeHash === 'string' && Array.isArray(prospect.origins ?? []), 'access_denied');
    this.requireSavedConsentReceiverControl(prospect.executionConsent,prospect.botId,prospect.sessionId,state);
    return prospect;
  }
  fromScheduleOccurrence(occurrenceId) {
    const prospect = this.#schedule(occurrenceId, this.#store.read());
    const actor = Object.freeze({kind:'schedule',occurrenceId,botId:prospect.botId,sessionId:prospect.sessionId});
    this.#actors.add(actor);
    return actor;
  }
  #prospective(prospect, state) {
    requireCondition(plain(prospect) && validId(prospect.botId) && ['contact','execution'].includes(prospect.purpose) && state.bots[prospect.botId]?.lifecycle === 'active', 'access_denied');
    return {kind:'prospective',botId:prospect.botId};
  }
  canProspectiveBotRead(prospect, reference, state = this.#store.read()) {
    try {return this.#readAllowed(this.#prospective(prospect,state), reference, state, new Set());} catch {return false;}
  }
  canProspectiveBotReadDerived(prospect, record, state = this.#store.read()) {
    try {return this.#visible(this.#prospective(prospect,state), {kind:'memory',id:'derived',record,botId:record.botId ?? record.ownerBotId ?? null},state);} catch {return false;}
  }
  requireSavedConsentReceiverControl(consent,ownerBotId,sessionId,state = this.#store.read()) {
    requireCondition(plain(consent) && validId(ownerBotId) && validId(sessionId) && validId(consent.operationId),'access_denied');
    const receipt=state.operations[consent.operationId];
    requireCondition(receipt && ['schedule.create','schedule.update'].includes(receipt.action) && receipt.fingerprint === consent.operationFingerprint && plain(consent.command) && digest(consent.command) === consent.operationFingerprint && consent.command.callerKey === consent.callerKey && plain(receipt.result?.executionConsent) && canonical(receipt.result.executionConsent) === canonical(consent) && receipt.result.ownerBotId === ownerBotId && receipt.result.recipe?.originSessionId === sessionId && consent.sessionId === sessionId,'access_denied');
    if(consent.callerKey === 'human') return;
    const authorSessionId=receipt.result.source?.sessionId;
    requireCondition(validId(authorSessionId) && consent.callerKey === canonical(['bot',ownerBotId,authorSessionId]) && state.sessions[authorSessionId]?.botId === ownerBotId && state.bots[ownerBotId]?.lifecycle === 'active','access_denied');
    const prospect={kind:'prospective',botId:ownerBotId}, resource=this.resolve({kind:'session',id:sessionId},state);
    requireCondition(this.#readAllowed(prospect,{kind:'session',id:sessionId},state,new Set()) && (resource.botId === ownerBotId || ((!resource.botId || this.#shareAllowed(prospect,resource,state)) && this.#grant(prospect,resource,state,'control'))),'access_denied');
  }
  requireTaskTargetControl(actor, toBotId, taskId, state = this.#store.read()) {
    this.#checkActor(actor,state);
    requireCondition(validId(toBotId) && validId(taskId) && state.bots[toBotId]?.lifecycle === 'active' && state.tasks[taskId], 'access_denied');
    if (actor.kind === 'human') return;
    requireCondition(actor.kind === 'bot', 'access_denied');
    if (actor.botId === toBotId) return;
    const resource = {kind:'task',id:taskId,botId:toBotId,record:state.tasks[taskId]};
    requireCondition(this.#shareAllowed(actor,resource,state) && this.#grant(actor,resource,state,'control'),'access_denied');
  }
  requireScheduleAdmission(actor, action, input, state = this.#store.read()) {
    this.#checkActor(actor,state);
    requireCondition(actor.kind === 'schedule', 'access_denied');
    const authority=this.#schedule(actor.occurrenceId,state), occurrence=state.occurrences[actor.occurrenceId], schedule=state.schedules[authority.scheduleId];
    requireCondition(schedule?.enabled === true && !schedule.archived && occurrence?.state === 'claimed' && occurrence.scheduleId === authority.scheduleId && occurrence.consentVersion === schedule.consentVersion && authority.consentVersion === schedule.consentVersion && state.bots[authority.botId]?.lifecycle === 'active', 'access_denied');
    requireCondition(authority.admissionAllowed !== false,'disabled');
    if(authority.admissionDeadlineAt !== undefined || authority.admissionObservedAt !== undefined) requireCondition(Number.isFinite(authority.admissionDeadlineAt) && Number.isFinite(authority.admissionObservedAt) && authority.admissionObservedAt <= authority.admissionDeadlineAt,'schedule_missed');
    const configRevision=authority.configRevision ?? schedule.executionConsent?.configRevision;
    requireCondition(configRevision === undefined || state.bots[authority.botId].configRevision === configRevision, 'access_denied');
    if (action === 'task.create') {
      requireCondition(!occurrence.taskId && !authority.taskId && canonical(input) === canonical(authority.recipe), 'access_denied');
    } else {
      requireCondition(action === 'task.start' && input?.taskId === occurrence.taskId && (!authority.taskId || authority.taskId === input.taskId) && !occurrence.attemptId && !authority.attemptId && !input.parentAttemptId,'access_denied');
      const task=state.tasks[input.taskId];
      requireCondition(task && task.epoch === 0 && !task.currentAttemptId && !Object.values(state.attempts).some(row=>row.taskId===task.taskId),'access_denied');
      this.#requireScheduleTask(authority,task);
    }
    requireCondition(this.canProspectiveBotRead({botId:authority.botId,purpose:'execution'},{kind:'session',id:authority.sessionId},state),'access_denied');
    for (const ref of authority.origins ?? []) requireCondition(this.canProspectiveBotRead({botId:authority.botId,purpose:'execution'},ref,state),'access_denied');
  }
  #requireScheduleTask(authority,task) {
    requireCondition(task?.createdBy?.kind === 'schedule' && task.createdBy.occurrenceId === authority.occurrenceId && task.createdBy.scheduleId === authority.scheduleId && task.source?.kind === 'schedule' && task.source.occurrenceId === authority.occurrenceId && task.source.scheduleId === authority.scheduleId && task.botId === authority.botId && task.originSessionId === authority.sessionId, 'access_denied');
    for (const key of ['title','goal','criteria']) requireCondition(canonical(task[key]) === canonical(authority.recipe[key]),'access_denied');
    requireCondition(canonical(task.dependsOn ?? []) === canonical(authority.recipe.dependsOn ?? []),'access_denied');
  }
  #scheduleReadAllowed(actor,reference,state) {
    const authority=this.#schedule(actor.occurrenceId,state), refs=new Map();
    const add=ref=>{if(plain(ref) && tables[ref.kind] && validId(ref.id)) refs.set(canonical(ref),copy(ref));};
    const collect=record=>{
      if(!record) return;
      for(const origin of record.origins ?? []) add(origin);
      for(const source of [record.lineage,record.source,...(record.contentSources ?? [])].flat().filter(Boolean)) {
        if(source.sessionId) add({kind:'session',id:source.sessionId});
        if(source.kind === 'material' && source.docId) add({kind:'material',id:source.docId});
      }
    };
    add({kind:'session',id:authority.sessionId});
    for(const ref of authority.origins ?? []) add(ref);
    for(const id of authority.recipe.dependsOn ?? []) {
      add({kind:'task',id});
      const task=state.tasks[id],attempt=state.attempts[task?.currentAttemptId];
      collect(task?.acceptanceEvidence);collect(attempt?.result);collect(attempt?.report);
    }
    const admitted=state.attempts[authority.attemptId];
    if(admitted?.sessionId && admitted.taskId===authority.taskId && admitted.botId===authority.botId)add({kind:'session',id:admitted.sessionId});
    if(admitted && admitted.taskId === authority.taskId) for(const snapshot of admitted.prerequisiteInputs ?? []) {
      const input=state.taskInputs[snapshot.inputId];
      if(input && (authority.recipe.dependsOn ?? []).includes(input.taskId)) {
        add({kind:'taskInput',id:input.inputId});collect(input.result);collect(input.report);collect(input.acceptanceEvidence);
        if(input.attemptSessionId) add({kind:'session',id:input.attemptSessionId});
      }
    }
    if(authority.taskId) add({kind:'task',id:authority.taskId});
    let inspected=0;
    for(const ref of refs.values()) {
      if(++inspected > 256) return false;
      collect(this.resolve(ref,state).record);
    }
    return refs.has(canonical(reference)) && this.#readAllowed({kind:'prospective',botId:authority.botId},reference,state,new Set());
  }
  actorKey(actor) {
    this.#checkActor(actor, this.#store.read());
    if (actor.kind === "schedule") return canonical(["schedule",actor.occurrenceId]);
    return actor.kind === "human"
      ? "human"
      : canonical(["bot", actor.botId, actor.sessionId]);
  }
  command(actor, command) {
    const callerKey=this.actorKey(actor);
    if (actor.kind === 'schedule') {
      const authority=this.#schedule(actor.occurrenceId,this.#store.read());
      requireCondition(['task.create','task.start'].includes(command.action) && command.operationId === (command.action === 'task.create' ? authority.createOperationId : authority.startOperationId),'access_denied');
      const input=command.input, wrapper=plain(input) && Object.keys(input).length === 1 && input.occurrenceId === actor.occurrenceId;
      const expanded=command.action === 'task.create' ? canonical(input) === canonical(authority.recipe) : plain(input) && input.taskId === authority.taskId && input.expectedVersion === 1 && Object.keys(input).every(key=>['taskId','expectedVersion'].includes(key));
      requireCondition(wrapper || expanded,'access_denied');
    }
    return { ...copy(command), callerKey };
  }
  noteRead(actor, reference) {
    this.require(actor, `${reference.kind}.read`, reference);
    if (actor.kind === "human" || actor.kind === "schedule") return;
    const state = this.#store.read(),
      resource = this.resolve(reference, state),
      refs = this.#reads.get(actor.agent) ?? new Map();
    for (const ref of [
      ...(resource.botId !== actor.botId ? [reference] : []),
      ...(resource.record?.origins ?? []),
    ])
      refs.set(canonical(ref), copy(ref));
    this.#reads.set(actor.agent, refs);
  }
  readDependencies(actor) {
    this.#checkActor(actor, this.#store.read());
    if (actor.kind === "schedule") return copy(this.#schedule(actor.occurrenceId,this.#store.read()).origins ?? []);
    return actor.kind === "bot"
      ? [...(this.#reads.get(actor.agent)?.values() ?? [])].map(copy)
      : [];
  }
  canReadDerived(actor, record, state = this.#store.read()) {
    try {
      this.#checkActor(actor, state);
      return this.#visible(
        actor,
        {
          kind: "memory",
          id: "derived",
          record,
          botId: record.botId ?? record.ownerBotId ?? null,
        },
        state,
      );
    } catch {
      return false;
    }
  }
  noteDependencies(actor, references = []) {
    for (const reference of references) this.noteRead(actor, reference);
  }
  noteDerivedRead(actor, record, {sessionId} = {}) {
    requireCondition(this.canReadDerived(actor,record),'access_denied');
    const references=[...(record?.origins ?? [])];
    if(sessionId)references.push({kind:'session',id:sessionId});
    for(const source of [record?.lineage,record?.source,...(record?.contentSources ?? [])].flat().filter(Boolean)) {
      if(source.sessionId)references.push({kind:'session',id:source.sessionId});
      if(source.kind==='material'&&source.docId)references.push({kind:'material',id:source.docId});
    }
    this.noteDependencies(actor,references);
    if(actor.kind!=='bot')return;
    const refs=this.#reads.get(actor.agent) ?? new Map();
    // Explicit source references also preserve same-Bot channel barriers.
    for(const reference of references)if(reference.kind!=='session'||reference.id!==actor.sessionId)refs.set(canonical(reference),copy(reference));
    this.#reads.set(actor.agent,refs);
  }
  #checkActor(actor, state) {
    requireCondition(actor && this.#actors.has(actor), "access_denied");
    if (actor.kind === 'schedule') {
      const authority=this.#schedule(actor.occurrenceId,state);
      requireCondition(actor.botId === authority.botId && actor.sessionId === authority.sessionId,'access_denied');
    }
    if (actor.kind === "bot")
      requireCondition(
        this.#agents?.get(actor.sessionId) === actor.agent &&
          state.sessions[actor.sessionId]?.botId === actor.botId,
        "access_denied",
      );
  }
  resolve(resource, state = this.#store.read()) {
    requireCondition(
      plain(resource) && tables[resource.kind] && validId(resource.id),
      "invalid_resource",
    );
    const record = state[tables[resource.kind]][resource.id];
    return {
      kind: resource.kind,
      id: resource.id,
      record,
      botId:
        resource.kind === "bot"
          ? record?.botId
          : (record?.botId ?? record?.ownerBotId ?? null),
    };
  }
  #visible(actor, resource, state, seen = new Set(), sourcePath = new Set()) {
    if (actor.kind === "human") return true;
    const record = resource.record,
      binding = actor.kind === 'bot' ? state.sessions[actor.sessionId] : null;
    if (record?.inactive === true) return false;
    if (resource.kind === 'taskInput') {
      const sessionId=record?.attemptSessionId ?? record?.sessionId;
      if (sessionId && !this.#readAllowed(actor,{kind:'session',id:sessionId},state,seen,sourcePath)) return false;
      for (const artifact of [record?.result,record?.report,record?.acceptanceEvidence].filter(Boolean)) if (!this.#visible(actor,{kind:'memory',id:'input-artifact',record:artifact,botId:resource.botId},state,seen,sourcePath)) return false;
    }
    for (const origin of record?.origins ?? []) {
      if (!this.#readAllowed(actor, origin, state, seen, sourcePath)) return false;
    }
    const sources = [
      record?.lineage,
      ...(record?.contentSources ?? []),
      ...(Array.isArray(record?.source) ? record.source : [record?.source]),
    ];
    for (const source of [...sources].filter(Boolean))
      if (source.sessionId && state.sessions[source.sessionId]?.lineage)
        sources.push(state.sessions[source.sessionId].lineage);
    for (const source of sources.filter(Boolean)) {
      if (source.kind === 'material' && source.docId && !this.#readAllowed(actor,{kind:'material',id:source.docId},state,seen,sourcePath)) return false;
      if (source.sessionId && state.sessions[source.sessionId] && !(resource.kind === 'session' && resource.id === source.sessionId) && !this.#sourceSessionReadable(actor,source.sessionId,state,seen,sourcePath)) return false;
    }
    for (const lineage of sources.filter(Boolean)) {
      if (!lineage.meetingId || lineage.phase !== "independent") continue;
      const meeting = state.meetings[lineage.meetingId];
      if (!meeting || meeting.epoch !== lineage.epoch) return false;
      if (lineage.memberEpoch !== undefined) {
        const participant = meeting.participants?.find(
          (row) => row.botId === lineage.botId,
        );
        if (
          !participant?.active ||
          participant.memberEpoch !== lineage.memberEpoch
        )
          return false;
      }
      if (
        !["discussion", "decision", "complete"].includes(meeting.phase) &&
        !(
          meeting.phase === "cancelled" &&
          meeting.revealedEpoch === lineage.epoch
        )
      ) {
        if (meeting.phase !== "independent") return false;
        const ownChannel =
          binding?.lineage?.meetingId === lineage.meetingId &&
          binding.lineage.epoch === lineage.epoch &&
          binding.lineage.phase === "independent" &&
          resource.botId === actor.botId &&
          (resource.kind === "session"
            ? resource.id === actor.sessionId
            : lineage.sessionId === actor.sessionId);
        if (!ownChannel) return false;
      }
    }
    if (resource.kind === "group")
      return record?.members?.some(
        (member) => member.botId === actor.botId && member.active,
      );
    if (resource.kind === "meeting")
      return record?.participants?.some(
        (member) => member.botId === actor.botId && member.active,
      );
    return true;
  }
  #sourceSessionReadable(actor,sessionId,state,seen,sourcePath) {
    if(sourcePath.size >= 32) return false;
    if(sourcePath.has(sessionId)) {
      // A context task may point back to this already checked source session.
      // Permit that edge only when it closes an inspected task origin, never
      // when the session's own source links form a cycle.
      const taskBackedge=[...seen].some(key=>{
        const ref=JSON.parse(key),task=ref.kind === 'task' && state.tasks[ref.id];
        return task && [task.source,...(task.contentSources ?? [])].flat().some(source=>source?.sessionId === sessionId);
      });
      const session=state.sessions[sessionId],sources=[session?.lineage,session?.source,...(session?.contentSources ?? [])].flat().filter(Boolean);
      if(!taskBackedge || sources.some(source=>source.sessionId !== sessionId && sourcePath.has(source.sessionId))) return false;
    }
    const nextSources=new Set(sourcePath);nextSources.add(sessionId);
    const resource=this.resolve({kind:'session',id:sessionId},state), next=new Set(seen);
    next.add(canonical({kind:'session',id:sessionId}));
    if (next.size > 32) return false;
    // A source session may itself have consumed this task. Its already visited
    // origins were checked on entry; preserve every other origin and barrier.
    const record={...resource.record,origins:(resource.record?.origins ?? []).filter(ref=>!seen.has(canonical(ref)))};
    if (!this.#visible(actor,{...resource,record},state,next,nextSources)) return false;
    return resource.botId === actor.botId || (resource.botId ? this.#shareAllowed(actor,resource,state) : this.#grant(actor,resource,state,'read'));
  }
  #shareAllowed(actor, resource, state) {
    const share = state.bots[resource.botId]?.share ?? defaultShare();
    return (
      share.enabled === true &&
      share.receivers?.some((id) => id === "*" || id === actor.botId) &&
      includes(share.scope, resource)
    );
  }
  #grant(actor, resource, state, level) {
    return Object.values(state.grants).some(
      (grant) =>
        grant.active === true &&
        grant.recipientBotId === actor.botId &&
        grant.ownerBotId === resource.botId &&
        (level === "read" || grant.level === "control") &&
        includes(grant.scope, resource),
    );
  }
  canRead(actor, reference, _context, state = this.#store.read()) {
    try {
      this.#checkActor(actor, state);
      return actor.kind === "schedule" ? this.#scheduleReadAllowed(actor,reference,state) : this.#readAllowed(actor, reference, state, new Set());
    } catch {
      return false;
    }
  }
  #readAllowed(actor, reference, state, seen, sourcePath = new Set()) {
    const key = canonical(reference);
    if (seen.has(key) || seen.size >= 32) return false;
    const next = new Set(seen);
    next.add(key);
    const resource = this.resolve(reference, state);
    if (!this.#visible(actor, resource, state, next, sourcePath)) return false;
    if (actor.kind === "human") return true;
    if (
      resource.kind === "group" ||
      resource.kind === "meeting" ||
      resource.kind === "bot"
    )
      return !!resource.record;
    if (resource.botId === actor.botId) return true;
    if (!resource.botId) return this.#grant(actor, resource, state, "read");
    return this.#shareAllowed(actor, resource, state);
  }
  require(actor, action, reference, state = this.#store.read()) {
    this.#checkActor(actor, state);
    this.#requirePrincipal(actor, action, reference, state);
  }
  #requirePrincipal(actor, action, reference, state) {
    if (actor.kind === 'schedule') {
      const authority=this.#schedule(actor.occurrenceId,state);
      if (action.endsWith('.read')) {requireCondition(this.#scheduleReadAllowed(actor,reference,state),'access_denied');return;}
      if (action === 'session.send') {requireCondition(reference.kind === 'session' && reference.id === authority.sessionId && this.#scheduleReadAllowed(actor,reference,state),'access_denied');return;}
      const task=this.resolve(reference,state).record;
      this.#requireScheduleTask(authority,task);
      if (action === 'task.create') {
        const occurrence=state.occurrences[actor.occurrenceId];
        requireCondition(!occurrence.taskId || occurrence.taskId === task.taskId,'access_denied');
        this.requireScheduleAdmission(actor,action,authority.recipe,state);
      } else {
        const occurrence=state.occurrences[actor.occurrenceId], attempt=state.attempts[occurrence?.attemptId];
        if (action === 'task.start' && occurrence?.taskId === task.taskId && attempt?.taskId === task.taskId && task.currentAttemptId === attempt.attemptId && task.epoch === 1 && attempt.epoch === 1) {
          requireCondition(this.#visible({kind:'prospective',botId:authority.botId},{kind:'task',id:task.taskId,record:task,botId:task.botId},state),'access_denied');
        } else this.requireScheduleAdmission(actor,action,{taskId:task.taskId},state);
      }
      return;
    }
    if (actor.kind !== "human") requireCondition(!humanOnly.has(action), "access_denied");
    if (["bot.update", "session.create", "session.send", "task.create", "task.start"].includes(action)) {
      const resource = this.resolve(reference, state);
      requireCondition(!state.bots[resource.botId]?.deletedAt, "bot_deleted");
    }
    if (actor.kind === "human") return;
    const resource = this.resolve(reference, state);
    requireCondition(
      this.#readAllowed(actor, reference, state, new Set()),
      "access_denied",
    );
    if (action.endsWith(".read")) return;
    if (action === 'bot.update' || action.startsWith('schedule.') || action.startsWith('notice.') || action.startsWith('material.') || action.startsWith("memory.")) {
      requireCondition(resource.botId === actor.botId, "access_denied");
      return;
    }
    if (["group.post", "meeting.start", "meeting.opinion"].includes(action)) {
      requireCondition(this.#visible(actor, resource, state), "access_denied");
      return;
    }
    requireCondition(controllable.has(action), "access_denied");
    if (resource.botId === actor.botId) return;
    requireCondition(
      (!resource.botId || this.#shareAllowed(actor, resource, state)) &&
        this.#grant(actor, resource, state, "control"),
      "access_denied",
    );
  }
  /** A saved task result executes its original delivery intent, with current grants. */
  requireTaskResultDelivery(row, state = this.#store.read()) {
    const task = state.tasks[row.taskId],
      attempt = state.attempts[row.attemptId];
    requireCondition(
      row.kind === "result" &&
        task &&
        attempt?.taskId === task.taskId &&
        attempt.resultOutboxId === row.outboxId &&
        attempt.epoch === row.epoch &&
        task.originSessionId === row.sessionId,
      "delivery_identity_unknown",
    );
    const principal = task.createdBy;
    requireCondition(
      plain(principal) && ["human", "bot", "schedule"].includes(principal.kind),
      "delivery_identity_unknown",
    );
    if (principal.kind === 'schedule') {
      const authority=this.#schedule(principal.occurrenceId,state), occurrence=state.occurrences[principal.occurrenceId];
      requireCondition(authority.scheduleId === principal.scheduleId && occurrence?.taskId === task.taskId && (!occurrence.attemptId || occurrence.attemptId === attempt.attemptId) && row.sessionId === authority.sessionId,'delivery_identity_unknown');
      this.#requireScheduleTask(authority,task);
      const prospect={kind:'prospective',botId:authority.botId};
      requireCondition(this.#readAllowed(prospect,{kind:'session',id:row.sessionId},state,new Set()) && this.#visible(prospect,{kind:'memory',id:'derived',record:row,botId:row.botId},state),'access_denied');
      for (const ref of [...(authority.origins ?? []),...(row.origins ?? [])]) requireCondition(this.#readAllowed(prospect,ref,state,new Set()),'access_denied');
      return;
    }
    if (principal.kind === "human")
      requireCondition(
        task.source?.kind === "human",
        "delivery_identity_unknown",
      );
    else
      requireCondition(
        validId(principal.botId) &&
          validId(principal.sessionId) &&
          task.source?.sessionId === principal.sessionId &&
          state.sessions[principal.sessionId]?.botId === principal.botId &&
          state.bots[principal.botId]?.lifecycle === "active",
        "delivery_identity_unknown",
      );
    this.#requirePrincipal(
      principal,
      "session.send",
      { kind: "session", id: row.sessionId },
      state,
    );
    requireCondition(
      this.#visible(
        principal,
        { kind: "memory", id: "derived", record: row, botId: row.botId },
        state,
      ),
      "access_denied",
    );
    for (const reference of row.origins ?? [])
      this.#requirePrincipal(
        principal,
        `${reference.kind}.read`,
        reference,
        state,
      );
  }
  async authorizeShare(actor, command) {
    command = copy(command);
    this.require(actor, command.action, {
      kind: "bot",
      id: command.input.botId ?? command.input.ownerBotId ?? "ordinary",
    });
    requireCondition(actor.kind === "human", "access_denied");
    return this.#store.transact(this.command(actor, command), (draft) => {
      this.#checkActor(actor, draft);
      const input = command.input;
      if (command.action === "share.set") {
        const bot = draft.bots[input.botId];
        requireCondition(bot, "not_found");
        requireCondition(input.expectedVersion === undefined || input.expectedVersion === bot.revision, "revision_conflict");
        requireCondition(
          plain(input.share) &&
            typeof input.share.enabled === "boolean" &&
            Array.isArray(input.share.receivers) &&
            input.share.receivers.every((id) => id === "*" || validId(id)) &&
            validScope(input.share.scope),
          "invalid_share",
        );
        bot.share = copy(input.share);
        bot.revision++;
        return bot.share;
      }
      requireCondition(
        command.action === "grant.set" &&
          validId(input.grantId) &&
          validId(input.recipientBotId) &&
          (input.ownerBotId === null || validId(input.ownerBotId)) &&
          ["read", "control"].includes(input.level) &&
          typeof input.active === "boolean" &&
          validScope(input.scope),
        "invalid_grant",
      );
      requireCondition(
        draft.bots[input.recipientBotId] &&
          (input.ownerBotId === null || draft.bots[input.ownerBotId]),
        "not_found",
      );
      const current = draft.grants[input.grantId];
      requireCondition(input.expectedVersion === undefined || input.expectedVersion === (current?.version ?? 0), "revision_conflict");
      requireCondition(
        !current ||
          (current.ownerBotId === input.ownerBotId &&
            current.recipientBotId === input.recipientBotId),
        "grant_identity_conflict",
      );
      const {expectedVersion, ...configuration} = input;
      const grant = {
        ...copy(configuration),
        version: (current?.version ?? 0) + 1,
        grantedBy: "human",
      };
      draft.grants[input.grantId] = grant;
      return grant;
    });
  }
}
