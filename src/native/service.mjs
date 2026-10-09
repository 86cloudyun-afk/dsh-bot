import { copy, digest, plain, requireCondition, validId } from "./store.mjs";
import {commandHelp} from "./commands.mjs";
import manifest from "../../package.json" with {type:"json"};

/** One business surface shared by authenticated GUI RPC and Agent-scoped tools. */
export class BotService {
  #closed = false;
  #previewReads(actor, previews=[]) {
    const state=this.store.read();
    for(const preview of previews) {
      const attempt=state.attempts[preview.attemptId],artifact=attempt?.[preview.kind];
      requireCondition(artifact,"access_denied");
      this.policy.noteDerivedRead(actor,{...artifact,botId:attempt.botId},{sessionId:attempt.sessionId});
    }
  }
  #noticeReads(actor, notices=[]) {
    for(const row of notices) {
      this.policy.noteRead(actor,{kind:"notice",id:row.noticeId});
      this.#previewReads(actor,row.previews);
    }
  }
  constructor({
    store,
    policy,
    bots,
    sessions,
    adapter,
    tasks,
    broker,
    collaboration,
    recovery,
    knowledge,
    memory,
    templates,
    assistant,
  }) {
    Object.assign(this, {
      store,
      policy,
      bots,
      sessions,
      adapter,
      tasks,
      broker,
      collaboration,
      recovery,
      knowledge,
      memory,
      templates,
      assistant,
    });
  }
  resolveCaller(exec) {
    requireCondition(!this.#closed, "disabled");
    return this.policy.fromAgent(exec.agent);
  }
  snapshot(actor) {
    requireCondition(!this.#closed, "disabled");
    this.policy.actorKey(actor);
    const state = this.store.read(),
      result = {
        storeId: state.storeId,
        revision: state.revision,
        status: "enabled",
        releaseReady: false,
        pluginVersion: manifest.version,
        clientProtocol: 2,
      };
    for (const [kind, table] of Object.entries({
      bot: "bots",
      session: "sessions",
      memory: "memories",
      task: "tasks",
      group: "groups",
      meeting: "meetings",
    })) {
      result[table] = Object.entries(state[table])
        .filter(
          ([id, row]) =>
            this.policy.canRead(actor, { kind, id }) &&
            !(kind === "memory" && row.forgotten),
        )
        .map(([id, row]) => {
          this.policy.noteRead(actor, { kind, id });
          return kind === "group" && this.collaboration
            ? this.collaboration.viewGroup(actor, row)
            : kind === "meeting" && this.collaboration
              ? this.collaboration.viewMeeting(actor, row)
              : kind === "session"
                ? { ...copy(row), archived: this.adapter.isArchived(id) }
                : kind === "task" ? {
                    ...copy(row),
                    dependencyStatus: this.tasks?.dependencyStatus(actor,row,state) ?? {blocked:false},
                    handoffs: (row.handoffs ?? []).filter(history=>this.policy.canReadDerived(actor,{...history,botId:history.fromBotId,origins:history.provenance?.origins ?? []},state)).map(history=>{
                      this.policy.noteDependencies(actor,history.provenance?.origins ?? []);
                      if(history.source?.sessionId)this.policy.noteRead(actor,{kind:"session",id:history.source.sessionId});
                      return copy(history);
                    }),
                  } : copy(row);
        });
    }
    result.grants = Object.values(state.grants)
      .filter(
        (row) => actor.kind === "human" || row.recipientBotId === actor.botId,
      )
      .map(copy);
    result.attempts = Object.values(state.attempts)
      .filter(
        (row) =>
          this.policy.canRead(actor, { kind: "task", id: row.taskId }) &&
          (!row.sessionId || this.policy.canRead(actor, {kind:"session",id:row.sessionId})) &&
          (!state.sessions[row.sessionId] || this.policy.canReadDerived(actor,state.sessions[row.sessionId],state)) &&
          (row.prerequisiteInputs ?? []).every(input=>input.inputId && this.policy.canRead(actor,{kind:"taskInput",id:input.inputId},null,state)) &&
          [row.result, row.report].filter(Boolean).every(artifact =>
            this.policy.canReadDerived(actor, {...artifact,botId:row.botId},state)),
      )
      .map((row) => {
        this.policy.noteRead(actor, { kind: "task", id: row.taskId });
        if(row.sessionId)this.policy.noteRead(actor,{kind:"session",id:row.sessionId});
        for(const input of row.prerequisiteInputs ?? [])this.policy.noteRead(actor,{kind:"taskInput",id:input.inputId});
        this.policy.noteDependencies(actor, [
          ...(row.result?.origins ?? []),
          ...(row.report?.origins ?? []),
        ]);
        return copy(row);
      });
    result.outbox = Object.values(state.outbox)
      .filter(
        (row) =>
          (actor.kind === "human" || row.botId === actor.botId) &&
          this.policy.canReadDerived(actor, row, state),
      )
      .map((row) => {
        this.policy.noteDependencies(actor, row.origins);
        return copy(row);
      });
    result.materials = this.knowledge ? this.knowledge.metadata(actor, {limit:500}) : [];
    if(!Array.isArray(result.materials))result.materials=result.materials.items ?? [];
    result.schedules = this.assistant?.listSchedules(actor,{}) ?? [];
    result.notices = this.assistant?.notices(actor,{}) ?? [];
    for(const row of result.schedules)this.policy.noteRead(actor,{kind:"schedule",id:row.scheduleId});
    this.#noticeReads(actor,result.notices);
    return result;
  }
  async #rememberReads(actor) {
    if (actor.kind !== "bot") return;
    const refs = this.policy.readDependencies(actor);
    if (!refs.length) return;
    const current = this.store.read().sessions[actor.sessionId];
    const origins = [
      ...new Map(
        [...(current.origins ?? []), ...refs].map((ref) => [
          JSON.stringify(ref),
          ref,
        ]),
      ).values(),
    ];
    if (JSON.stringify(origins) === JSON.stringify(current.origins ?? []))
      return;
    await this.store.transact(
      {
        operationId: crypto.randomUUID(),
        action: "session.origins",
        input: { sessionId: actor.sessionId, origins },
      },
      (draft) => {
        for (const ref of refs)
          this.policy.require(actor, `${ref.kind}.read`, ref, draft);
        draft.sessions[actor.sessionId].origins = origins;
        return null;
      },
    );
  }
  #publishResult(actor, action, input, result) {
    let reference;
    if (action === "meeting.action")
      reference = { kind: "task", id: result.taskId };
    else if (action.startsWith("task."))
      reference = { kind: "task", id: result.taskId ?? input.taskId };
    else if (["memory.write","memory.forget","memory.pin"].includes(action))
      reference = { kind: "memory", id: result.memoryId ?? input.memoryId };
    else if (
      action.startsWith("session.") &&
      !["session.page", "session.list"].includes(action)
    )
      reference = { kind: "session", id: result.sessionId ?? input.sessionId };
    else if (action.startsWith("group."))
      reference = { kind: "group", id: result.groupId ?? input.groupId };
    else if (action.startsWith("meeting."))
      reference = { kind: "meeting", id: result.meetingId ?? input.meetingId };
    else if (action.startsWith("outbox.") && result.sessionId)
      reference = { kind: "session", id: result.sessionId };
    else if (action.startsWith("material.") && result.docId)
      reference = {kind:"material",id:result.docId};
    else if (action.startsWith("schedule.") && result.scheduleId)
      reference = {kind:"schedule",id:result.scheduleId};
    else if (action === "notice.ack" && result.noticeId)
      reference = {kind:"notice",id:result.noticeId};
    if (reference) this.policy.noteRead(actor, reference);
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const state=this.store.read();
      if(result.attemptId && state.attempts[result.attemptId]) {
        const attempt=state.attempts[result.attemptId],binding=state.sessions[attempt.sessionId];
        requireCondition(!binding || this.policy.canReadDerived(actor,binding,state),"access_denied");
        for(const input of attempt.prerequisiteInputs ?? []) {
          requireCondition(input.inputId,"access_denied");
          this.policy.noteRead(actor,{kind:"taskInput",id:input.inputId});
        }
      }
      requireCondition(
        this.policy.canReadDerived(actor, result),
        "access_denied",
      );
      this.policy.noteDependencies(actor, [
        ...(result.origins ?? []),
        ...(result.result?.origins ?? []),
        ...(result.report?.origins ?? []),
      ]);
    }
  }
  async dispatch(actor, command, signal) {
    requireCondition(!this.#closed, "disabled");
    signal?.throwIfAborted();
    command = copy(command);
    requireCondition(
      plain(command) &&
        Object.keys(command).every((key) =>
          ["operationId", "action", "input", "expectedRevision"].includes(key),
        ) &&
        typeof command.action === "string" &&
        plain(command.input ?? {}),
      "invalid_command",
    );
    command.input ??= {};
    const { action, input } = command;
    let result;
    if (action === "help") {
      this.policy.actorKey(actor);
      return {...commandHelp(actor, input), toolCatalog: this.adapter.nativeToolCatalog(actor.kind === "bot" ? actor.agent : undefined)};
    } else if (action === "tools.list") {
      this.policy.actorKey(actor);
      requireCondition(Object.keys(input).length === 0, "invalid_input");
      return this.adapter.nativeToolCatalog(actor.kind === "bot" ? actor.agent : undefined);
    } else if (action === "snapshot") result = this.snapshot(actor);
    else if (action === "catalog") {
      this.policy.actorKey(actor);
      result = {
        ...(await this.adapter.models(actor.kind === "bot" ? actor.agent : undefined)),
        presets: (await this.adapter.context.get("agentPresets")?.list()) ?? [],
        defaultCwd: this.adapter.context.get("profileContext")?.cwd ?? null,
        defaultModel: copy(this.adapter.context.get("agentDefaultModel")?.currentSelection() ?? null),
      };
    } else if (action === "session.page")
      result = await this.sessions.page(actor, input, signal);
    else if (action === "session.list")
      result = await this.sessions.list(actor, input, signal);
    else if (action === "memory.search")
      result = this.memory ? this.memory.search(actor,input) : this.bots.searchMemory(actor, input);
    else if (action === "material.search") result = this.knowledge.search(actor,input);
    else if (action === "material.page") result = await this.knowledge.page(actor,input,signal);
    else if (action === "material.download") result = await this.knowledge.download(actor,input,signal);
    else if (action === "memory.export") result = await this.memory.export(actor,input);
    else if (action === "memory.import.preview") result = await this.memory.preview(actor,input);
    else if (action === "memory.context.preview") {
      this.policy.actorKey(actor);
      requireCondition(Object.keys(input).every(key=>["botId","sessionId","query"].includes(key)),"invalid_input");
      const state=this.store.read(),binding=input.sessionId ? state.sessions[input.sessionId] : actor.kind === "bot" ? state.sessions[actor.sessionId] : {botId:input.botId};
      requireCondition(binding && validId(binding.botId) && (!input.botId || input.botId===binding.botId),"invalid_input");
      if(binding.sessionId)this.policy.require(actor,"session.read",{kind:"session",id:binding.sessionId});
      result=this.memory.contextPreview(actor,binding,{maxChars:12000,...(input.query===undefined?{}:{query:input.query})});
    }
    else if (action === "template.list") result = this.templates.list(actor,input);
    else if (action === "briefing") result = this.assistant.briefing(actor,input);
    else if (action === "schedule.list") result = this.assistant.listSchedules(actor,input);
    else if (action === "occurrence.list") result = this.assistant.listOccurrences(actor,input);
    else if (action === "notice.list") result = this.assistant.notices(actor,input);
    else if (["diagnostics","diagnostics.read"].includes(action)) result = this.assistant.diagnostics(actor,input);
    else if (action === "operation.lookup") {
      this.policy.actorKey(actor);
      requireCondition(actor.kind === "human", "human_required");
      requireCondition(Object.keys(input).every(key => ["operationId", "request"].includes(key)) && validId(input.operationId), "invalid_operation");
      const receipt = this.store.read().operations[input.operationId];
      if (input.request !== undefined) {
        requireCondition(plain(input.request) && input.request.operationId === input.operationId &&
          typeof input.request.action === "string" && plain(input.request.input) &&
          Object.keys(input.request).every(key => ["operationId", "action", "input", "expectedRevision"].includes(key)), "invalid_command");
        if (receipt) requireCondition(receipt.fingerprint === digest(this.policy.command(actor, input.request)), "operation_conflict");
      }
      result = receipt ? {state:"committed", action:receipt.action, result:copy(receipt.result)} : {state:"unrecorded"};
    }
    else {
      requireCondition(validId(command.operationId), "invalid_operation");
      const routes = {
        "bot.create": [this.bots, "create"],
        "bot.update": [this.bots, "update"],
        "bot.delete": [this.bots, "delete"],
        "bot.restore": [this.bots, "restore"],
        "session.create": [this.sessions, "create"],
        "session.configure": [this.sessions, "configure"],
        "session.fork": [this.sessions, "fork"],
        "session.stop": [this.sessions, "stop"],
        "session.archive": [this.sessions, "archive"],
        "session.restore": [this.sessions, "restore"],
        "memory.write": this.memory ? [this.memory,"write"] : [this.bots, "memoryWrite"],
        "memory.forget": this.memory ? [this.memory,"forget"] : [this.bots, "memoryForget"],
        "memory.pin": [this.memory,"pin"],
        "memory.import": [this.memory,"import"],
        "material.ingest": [this.knowledge,"ingest"],
        "material.archive": [this.knowledge,"archive"],
        "template.instantiate": [this.templates,"instantiate"],
        "schedule.create": [this.assistant,"createSchedule"],
        "schedule.update": [this.assistant,"updateSchedule"],
        "schedule.state": [this.assistant,"setScheduleState"],
        "notice.ack": [this.assistant,"ackNotice"],
        "occurrence.prune": [this.assistant,"pruneOccurrences"],
        "share.set": [this.policy, "authorizeShare"],
        "grant.set": [this.policy, "authorizeShare"],
        "task.create": [this.tasks, "create"],
        "task.start": [this.tasks, "start"],
        "task.adjust": [this.tasks, "adjust"],
        "task.dependencies.set": [this.tasks,"setDependencies"],
        "task.handoff": [this.tasks,"handoff"],
        "task.stop": [this.tasks, "stop"],
        "task.submit": [this.tasks, "submit"],
        "task.accept": [this.tasks, "accept"],
        "task.archive": [this.tasks, "archive"],
        "task.restore": [this.tasks, "restore"],
        "outbox.reconcile": [this.broker, "reconcile"],
        "session.send": [this.broker, "enqueue"],
        "group.create": [this.collaboration, "createGroup"],
        "group.post": [this.collaboration, "post"],
        "group.members": [this.collaboration, "changeMembers"],
        "meeting.start": [this.collaboration, "startMeeting"],
        "meeting.opinion": [this.collaboration, "submitOpinion"],
        "meeting.advance": [this.collaboration, "advance"],
        "meeting.topic": [this.collaboration, "changeTopic"],
        "meeting.cancel": [this.collaboration, "cancel"],
        "meeting.action": [this.collaboration, "actionTask"],
        "recovery.reconcile": [this.recovery, "reconcile"],
      };
      const route = Object.hasOwn(routes, action) ? routes[action] : null;
      requireCondition(
        route && typeof route[0]?.[route[1]] === "function",
        "unknown_action",
      );
      result = await route[0][route[1]](actor, command, signal);
    }
    signal?.throwIfAborted();
    if (actor.kind === "bot") {
      if (action === "snapshot") result = this.snapshot(actor);
      else if (action === "session.page")
        this.policy.noteRead(actor, { kind: "session", id: input.sessionId });
      else if (action === "session.list")
        for (const row of result.items)
          this.policy.noteRead(actor, { kind: "session", id: row.sessionId });
      else if (action === "memory.search")
        for (const row of result)
          this.policy.noteRead(actor, { kind: "memory", id: row.memoryId });
      else if (action === "memory.context.preview") {
        for(const id of result.includedMemoryIds)this.policy.noteRead(actor,{kind:"memory",id});
        for(const id of result.includedTaskIds)this.policy.noteRead(actor,{kind:"task",id});
      }
      else if (action === "material.search")
        for(const row of result)this.policy.noteRead(actor,{kind:"material",id:row.docId});
      else if (action === "schedule.list")
        for(const row of result)this.policy.noteRead(actor,{kind:"schedule",id:row.scheduleId});
      else if (action === "notice.list")
        this.#noticeReads(actor,result);
      else if (action === "occurrence.list")
        for(const row of result)this.policy.noteRead(actor,{kind:"schedule",id:row.scheduleId});
      else if (action === "briefing") {
        for(const row of result.tasks){
          this.policy.noteRead(actor,{kind:"task",id:row.taskId});
          this.#previewReads(actor,row.previews);
        }
        this.#noticeReads(actor,result.notices);
      }
      else this.#publishResult(actor, action, input, result);
      await this.#rememberReads(actor);
      for (const ref of this.policy.readDependencies(actor))
        this.policy.require(actor, `${ref.kind}.read`, ref);
    }
    return copy(result);
  }
  close() {
    this.#closed = true;
  }
}
