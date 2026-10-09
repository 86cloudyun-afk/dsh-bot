import { randomUUID } from "node:crypto";
import { copy, digest, plain, requireCondition, validId } from "./store.mjs";

export class SessionOwnership {
  #opening = new Map();
  #stopping = new Map();
  constructor(store, policy, adapter) {
    this.store = store;
    this.policy = policy;
    this.adapter = adapter;
  }
  #configuring = new Map();
  async #contactConfig(input, defaults) {
    const config = {
      model: await this.adapter.validateModel(input.model ?? defaults.model ?? defaults.contact),
      modelMode: input.model ? "explicit" : defaults.modelMode ?? "inherit",
      cwd: await this.adapter.validateLocation(input.cwd ?? defaults.cwd),
      presetId: await this.adapter.validatePreset(Object.hasOwn(input,"presetId") ? input.presetId : defaults.presetId),
    };
    const name = input.name ?? defaults.name;
    if (name !== undefined) {
      requireCondition(typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100,"invalid_name");
      config.name = name.trim();
    }
    return config;
  }
  async create(actor, command) {
    command = copy(command);
    const input = command.input;
    requireCondition(plain(input) && Object.keys(input).every(key=>["botId","purpose","name","model","presetId","cwd"].includes(key)) && validId(input.botId),"invalid_input");
    requireCondition((input.purpose ?? "contact") === "contact","invalid_purpose");
    const stamped = this.policy.command(actor,command);
    let intent;
    if (Object.hasOwn(this.store.read().operations,command.operationId)) intent = await this.store.transact(stamped,()=>null);
    else {
      const bot = this.store.read().bots[input.botId]; requireCondition(bot,"not_found");
      // Check target authority before expensive validation and before any native work.
      const prospect = {sessionId:"new",botId:bot.botId,purpose:"contact"};
      const prospective = this.store.read(); prospective.sessions.new = prospect;
      this.policy.require(actor,"session.create",{kind:"session",id:"new"},prospective);
      const config = await this.#contactConfig(input,bot);
      intent = await this.store.transact(stamped,draft=>{
        const current = draft.bots[input.botId];
        requireCondition(current && !current.deletedAt,"bot_deleted");
        requireCondition(current.lifecycle === "active","bot_not_active");
        requireCondition(current.configRevision === bot.configRevision,"revision_conflict");
        const sessionId=randomUUID(),binding={sessionId,botId:bot.botId,purpose:"contact",...config,
          configRevision:bot.configRevision,revision:1,epoch:1,state:"creating",ownerRuntimeId:this.adapter.runtimeId,
          archived:false,operationId:command.operationId,statusOperationId:randomUUID()};
        draft.sessions[sessionId]=binding;
        this.policy.require(actor,"session.create",{kind:"session",id:sessionId},draft);
        return binding;
      });
    }
    return this.#finishCreate(actor,intent,"session.create");
  }
  async #finishCreate(actor,intent,action) {
    const current=this.store.read().sessions[intent.sessionId];
    requireCondition(current,"session_outcome_unknown");
    this.policy.require(actor,action,{kind:"session",id:action === "session.fork" ? current.source.sessionId : current.sessionId});
    const receipt=this.store.read().operations[intent.statusOperationId]?.result;
    if (receipt) return receipt;
    if (current.state === "ready") return current;
    requireCondition(current.state === "creating","session_outcome_unknown");
    // An intent surviving a runtime restart is never automatically re-created.
    requireCondition(current.ownerRuntimeId === this.adapter.runtimeId,"session_outcome_unknown");
    if (this.#opening.has(current.sessionId)) return this.#opening.get(current.sessionId);
    const opening=(async()=>{
      try {
        await this.adapter.createOwned(current);
        return await this.store.transact({operationId:current.statusOperationId,action:"session.ready",input:{sessionId:current.sessionId}},draft=>{
          this.policy.require(actor,action,{kind:"session",id:action === "session.fork" ? current.source.sessionId : current.sessionId},draft);
          const row=draft.sessions[current.sessionId]; requireCondition(row.state === "creating","stale_operation");
          for (const reference of row.origins ?? []) this.policy.require(actor,`${reference.kind}.read`,reference,draft);
          row.state="ready";return row;
        });
      } catch(error) {
        await this.store.transact({operationId:`unknown-${current.statusOperationId}`,action:"session.unknown",input:{sessionId:current.sessionId}},draft=>{
          const row=draft.sessions[current.sessionId];row.state="UNKNOWN";row.error=error.code ?? error.name;return null;
        }).catch(()=>{});
        throw error;
      }
    })();
    this.#opening.set(current.sessionId,opening);
    try {return await opening;} finally {this.#opening.delete(current.sessionId);}
  }
  #requireSettled(row,native,state=this.store.read()) {
    requireCondition(row?.state === "ready" && !this.adapter.isArchived(row.sessionId),"session_not_ready");
    const agent=this.adapter.context.agents.get(row.sessionId),resources=this.adapter.resources(row.sessionId);
    requireCondition(resources.known,"resource_identity_unknown");
    requireCondition(agent?.status !== "running" && !agent?.inbox?.nextTurn?.length && !agent?.inbox?.nextStep?.length &&
      native.openTurn === null && !native.inbox["next-turn"].length && !native.inbox["next-step"].length &&
      resources.settled,"session_active");
    const jobs=this.adapter.context.get("jobs")?.list(row.sessionId) ?? [], terminals=this.adapter.context.get("terminals");
    requireCondition(!jobs.some(job=>job.owner === row.sessionId && ["running","stopping"].includes(job.status)) &&
      (!agent || !terminals?.hasOwnerActivity(agent)),"session_active");
    requireCondition(!row.attemptId || !state.attempts[row.attemptId]?.reservationHeld,"attempt_unsettled");
    requireCondition(!Object.values(state.outbox).some(out=>out.sessionId === row.sessionId &&
      (["queued","admitting","UNKNOWN"].includes(out.state) || out.state === "blocked" && out.nativeAdmission !== false)),"session_delivery_pending");
  }
  async configure(actor,command,signal) {
    command=copy(command);const input=command.input;
    requireCondition(plain(input) && Object.keys(input).every(key=>["sessionId","expectedVersion","name","model","presetId","cwd"].includes(key)) &&
      validId(input.sessionId) && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1 &&
      ["name","model","presetId","cwd"].some(key=>Object.hasOwn(input,key)),"invalid_input");
    const reference={kind:"session",id:input.sessionId};this.policy.require(actor,"session.configure",reference);
    const stamped=this.policy.command(actor,command),fingerprint=digest(stamped),pending=this.#configuring.get(command.operationId);
    if (pending) {requireCondition(pending.fingerprint === fingerprint,"operation_conflict");return pending.promise;}
    if (Object.hasOwn(this.store.read().operations,command.operationId)) {
      const intent=await this.store.transact(stamped,()=>null),receipt=this.store.read().operations[intent.statusOperationId]?.result;
      requireCondition(receipt,"session_outcome_unknown");return receipt;
    }
    const operation=(async()=>{
      const saved=this.store.read().sessions[input.sessionId];
      requireCondition((saved?.revision ?? 1) === input.expectedVersion,"revision_conflict");
      const native=await this.adapter.inspectSession(input.sessionId,signal);
      const row=saved ?? {sessionId:input.sessionId,botId:null,purpose:"ordinary",epoch:0,revision:1,state:"ready",archived:false,
        ...(native.header.cwd ? {cwd:native.header.cwd} : {}),presetId:native.presetId};
      if (!row.botId && !this.adapter.context.agents.get(row.sessionId)) {
        const selection=native.events.findLast(event=>event.type === "model/selection")?.data ?? native.events.findLast(event=>event.type === "request/header")?.data.header.config;
        if(selection)row.model=await this.adapter.validateModel(Object.fromEntries(Object.entries(selection).filter(([key])=>["provider","model","reasoningEffort","maxTokens","temperature"].includes(key))));
      }
      this.policy.require(actor,"session.configure",reference);
      this.#requireSettled(row,native);
      requireCondition(["contact","ordinary"].includes(row.purpose) || !Object.hasOwn(input,"model") && !Object.hasOwn(input,"presetId"),"task_adjust_required");
      if (Object.hasOwn(input,"cwd")) {
        const cwd=await this.adapter.validateLocation(input.cwd);requireCondition(cwd === native.header.cwd,"cwd_immutable");
      }
      const config={};
      if (Object.hasOwn(input,"name")) {requireCondition(typeof input.name === "string" && input.name.trim().length > 0 && input.name.trim().length <= 100,"invalid_name");config.name=input.name.trim();}
      if (Object.hasOwn(input,"model")) config.model=await this.adapter.validateModel(input.model);
      if (Object.hasOwn(input,"presetId")) {
        config.presetId=await this.adapter.validatePreset(input.presetId);
        if(config.presetId !== native.presetId)requireCondition(native.lastTurn === 0 && native.openTurn === null,"agent-preset/locked");
      }
      signal?.throwIfAborted();const release=this.adapter.fenceSessionAdmissions(row.sessionId);let intent;
      try {
        intent=await this.store.transact(stamped,draft=>{
          this.policy.require(actor,"session.configure",reference,draft);
          const current=draft.sessions[row.sessionId] ?? copy(row);
          requireCondition((current.revision ?? 1) === input.expectedVersion,"revision_conflict");
          draft.sessions[row.sessionId]=current;
          this.#requireSettled(current,native,draft);
          const value={sessionId:row.sessionId,statusOperationId:randomUUID(),config,previous:copy(current)};
          current.state="configuring";current.configureOperationId=command.operationId;current.configureStatusId=value.statusOperationId;return value;
        });
        this.policy.require(actor,"session.configure",reference);signal?.throwIfAborted();
        const evidence=await this.adapter.configureOwned(intent.previous,intent.config,signal);
        return await this.store.transact({operationId:intent.statusOperationId,action:"session.configured",input:{sessionId:row.sessionId,operationId:command.operationId}},draft=>{
          this.policy.require(actor,"session.configure",reference,draft);
          const current=draft.sessions[row.sessionId];requireCondition(current.configureOperationId === command.operationId && current.state === "configuring","stale_operation");
          Object.assign(current,config,evidence,{state:"ready",revision:input.expectedVersion+1});
          if(config.model)current.modelMode="explicit";
          current.nativeConfigEvidence=copy(evidence);
          return current;
        });
      } catch(error) {
        if(intent) await this.store.transact({operationId:`unknown-${intent.statusOperationId}`,action:"session.configure-unknown",input:{sessionId:row.sessionId}},draft=>{
          const current=draft.sessions[row.sessionId];if(current.configureOperationId === command.operationId){current.state="UNKNOWN";current.error=error.code ?? error.name;current.nativeConfigEvidence=copy(error.details?.nativeConfigEvidence ?? {});}return null;
        }).catch(()=>{});
        throw error;
      } finally {release();}
    })();
    this.#configuring.set(command.operationId,{fingerprint,promise:operation});
    try{return await operation;}finally{this.#configuring.delete(command.operationId);}
  }
  async fork(actor,command,signal) {
    command=copy(command);const input=command.input;
    requireCondition(plain(input) && Object.keys(input).every(key=>["sessionId","expectedVersion","atSeq","name","model","presetId","cwd"].includes(key)) && validId(input.sessionId) &&
      (input.expectedVersion === undefined || Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1) &&
      (input.atSeq === undefined || Number.isSafeInteger(input.atSeq) && input.atSeq >= 0),"invalid_input");
    const reference={kind:"session",id:input.sessionId};this.policy.require(actor,"session.fork",reference);this.policy.require(actor,"session.read",reference);
    const stamped=this.policy.command(actor,command);
    if(Object.hasOwn(this.store.read().operations,command.operationId))return this.#finishCreate(actor,await this.store.transact(stamped,()=>null),"session.fork");
    const source=this.store.read().sessions[input.sessionId];requireCondition(source?.botId && source.purpose === "contact" && !source.lineage && !source.attemptId,"task_adjust_required");
    requireCondition(source.state === "ready","session_not_ready");
    if(input.expectedVersion !== undefined)requireCondition((source.revision ?? 1) === input.expectedVersion,"revision_conflict");
    const native=await this.adapter.inspectSession(input.sessionId,signal),boundary=input.atSeq ?? native.events.findLast(event=>event.type === "turn/end")?.seq;
    requireCondition(boundary !== undefined && native.events[boundary]?.seq === boundary && native.events.slice(0,boundary+1).every((event,index)=>event.seq === index),"fork_unavailable");
    this.policy.require(actor,"session.read",reference);this.policy.noteRead(actor,reference);
    const prefixPresetId=this.adapter.effectivePresetAt(native,boundary),
      config=await this.#contactConfig(input,{...source,presetId:prefixPresetId});
    // The chosen inherited prefix defines its native composition, including historical blank-session selections.
    requireCondition(config.presetId === prefixPresetId,"fork_preset_immutable");
    const origins=[...new Map([...(source.origins ?? []),...this.policy.readDependencies(actor),reference].map(ref=>[digest(ref),ref])).values()];
    signal?.throwIfAborted();
    const intent=await this.store.transact(stamped,draft=>{
      this.policy.require(actor,"session.fork",reference,draft);this.policy.require(actor,"session.read",reference,draft);
      const current=draft.sessions[source.sessionId],bot=draft.bots[source.botId];
      requireCondition(current.state === "ready" && (current.revision ?? 1) === (source.revision ?? 1),"revision_conflict");
      requireCondition(bot && !bot.deletedAt && bot.lifecycle === "active","bot_not_active");
      for(const ref of origins)this.policy.require(actor,`${ref.kind}.read`,ref,draft);
      const sessionId=randomUUID(),binding={sessionId,botId:source.botId,purpose:"contact",...config,
        source:{kind:"session",sessionId:source.sessionId,eventSeq:boundary,checksum:digest({header:native.header,events:native.events.slice(0,boundary+1)})},origins,
        configRevision:source.configRevision,revision:1,epoch:1,state:"creating",ownerRuntimeId:this.adapter.runtimeId,
        archived:false,operationId:command.operationId,statusOperationId:randomUUID()};
      draft.sessions[sessionId]=binding;return binding;
    });
    return this.#finishCreate(actor,intent,"session.fork");
  }
  async page(actor, input, signal) {
    const reference = { kind: "session", id: input.sessionId };
    this.policy.require(actor, "session.read", reference);
    const offset = input.cursor?.offset ?? 0,
      limit = input.limit ?? 50;
    requireCondition(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= 500,
      "invalid_page",
    );
    if (input.cursor)
      requireCondition(
        input.cursor.sessionId === input.sessionId,
        "invalid_cursor",
      );
    const history = await this.adapter.readNative(input.sessionId, signal);
    this.policy.require(actor, "session.read", reference);
    signal?.throwIfAborted();
    const events = history.events.slice(offset, offset + limit);
    return {
      sessionId: input.sessionId,
      header: history.header,
      events,
      nextCursor:
        offset + events.length < history.events.length
          ? { sessionId: input.sessionId, offset: offset + events.length }
          : null,
      original: history.original,
    };
  }
  async list(actor, input = {}, signal) {
    const limit = input.limit ?? 50;
    requireCondition(
      Number.isInteger(limit) && limit >= 1 && limit <= 500,
      "invalid_page",
    );
    const native = await this.adapter.listNative(input, signal),
      state = this.store.read();
    const combined = new Map(native.map((row) => [row.sessionId, row]));
    for (const binding of Object.values(state.sessions))
      if (!combined.has(binding.sessionId))
        combined.set(binding.sessionId, {
          sessionId: binding.sessionId,
          header: null,
        });
    const rows = [...combined.values()]
      .filter((row) =>
        this.policy.canRead(actor, { kind: "session", id: row.sessionId }),
      )
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const token = digest(rows.map((row) => row.sessionId));
    const offset = input.cursor?.offset ?? 0;
    requireCondition(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        (!input.cursor || input.cursor.token === token),
      "cursor_changed",
    );
    const items = await Promise.all(
      rows
        .slice(offset, offset + limit)
        .map(async (row) => ({
          ...row,
          ...copy(state.sessions[row.sessionId] ?? {}),
          archived: this.adapter.isArchived(row.sessionId),
          type: state.sessions[row.sessionId]?.purpose ?? "ordinary",
          activity: await this.adapter.replyActivity(row.sessionId),
        })),
    );
    signal?.throwIfAborted();
    return {
      items: items.filter((row) =>
        this.policy.canRead(actor, { kind: "session", id: row.sessionId }),
      ),
      nextCursor:
        offset + limit < rows.length ? { token, offset: offset + limit } : null,
      total: rows.length,
    };
  }
  async stop(actor, command, signal) {
    command = copy(command);
    const input = command.input,
      reference = { kind: "session", id: input.sessionId };
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) =>
          ["sessionId", "expectedTurn"].includes(key),
        ) &&
        validId(input.sessionId) &&
        validId(input.expectedTurn),
      "invalid_input",
    );
    this.policy.require(actor, "session.stop", reference);
    const binding = this.store.read().sessions[input.sessionId];
    requireCondition(
      !binding?.attemptId && !binding?.parentSessionId && !binding?.lineage,
      "task_stop_required",
    );
    const stamped = this.policy.command(actor, command),
      fingerprint = digest(stamped),
      pending = this.#stopping.get(command.operationId),
      previous = this.store.read().operations[command.operationId];
    if (pending) {
      requireCondition(
        pending.fingerprint === fingerprint,
        "operation_conflict",
      );
      return pending.promise;
    }
    if (previous) {
      const intent = await this.store.transact(stamped, () => null);
      const receipt =
        this.store.read().operations[intent.statusOperationId]?.result;
      requireCondition(receipt, "session_outcome_unknown");
      return receipt;
    }
    const stopping = (async () => {
      const target = await this.adapter.replyActivity(input.sessionId);
      requireCondition(target?.token === input.expectedTurn, "stale_turn");
      const intent = await this.store.transact(stamped, (draft) => {
        this.policy.require(actor, "session.stop", reference, draft);
        const row = draft.sessions[input.sessionId] ?? {
          sessionId: input.sessionId,
          botId: null,
          purpose: "ordinary",
          epoch: 0,
          state: "ready",
          archived: false,
        };
        draft.sessions[input.sessionId] = row;
        return {
          sessionId: input.sessionId,
          statusOperationId: randomUUID(),
          expectedTurn: input.expectedTurn,
          runtimeId: this.adapter.runtimeId,
        };
      });
      this.policy.require(actor, "session.stop", reference);
      signal?.throwIfAborted();
      const receipt = this.adapter.stopReply(
        input.sessionId,
        input.expectedTurn,
      );
      return this.store.transact(
        {
          operationId: intent.statusOperationId,
          action: "session.reply-stop-receipt",
          input: intent,
        },
        () => receipt,
      );
    })();
    this.#stopping.set(command.operationId, { fingerprint, promise: stopping });
    try {
      return await stopping;
    } finally {
      this.#stopping.delete(command.operationId);
    }
  }
  async #archive(actor, command, value) {
    command = copy(command);
    const input = command.input,
      reference = { kind: "session", id: input.sessionId };
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) => key === "sessionId") &&
        validId(input.sessionId),
      "invalid_input",
    );
    this.policy.require(
      actor,
      value ? "session.archive" : "session.restore",
      reference,
    );
    const previous = this.store.read().sessions[input.sessionId],
      resources = this.adapter.resources(input.sessionId);
    requireCondition(previous?.state !== "UNKNOWN", "recovery_required");
    await this.adapter.readNative(input.sessionId);
    this.policy.require(
      actor,
      value ? "session.archive" : "session.restore",
      reference,
    );
    if (value)
      requireCondition(
        !previous?.attemptId ||
          !this.store.read().attempts[previous.attemptId]?.reservationHeld,
        "attempt_unsettled",
      );
    if (value && resources.known)
      requireCondition(resources.settled, "session_active");
    const intent = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        this.policy.require(
          actor,
          value ? "session.archive" : "session.restore",
          reference,
          draft,
        );
        const row = draft.sessions[input.sessionId] ?? {
          sessionId: input.sessionId,
          botId: null,
          purpose: "ordinary",
          epoch: 0,
          state: "ready",
          archived: false,
        };
        requireCondition(
          !["archiving", "restoring"].includes(row.state),
          "operation_pending",
        );
        row.archiveOperationId = command.operationId;
        row.archiveStatusId = randomUUID();
        row.previousState =
          row.state === "UNKNOWN" ? (row.previousState ?? "ready") : row.state;
        row.state = value ? "archiving" : "restoring";
        draft.sessions[input.sessionId] = row;
        return {
          sessionId: row.sessionId,
          statusOperationId: row.archiveStatusId,
          archived: value,
        };
      },
    );
    if (Object.hasOwn(this.store.read().operations, intent.statusOperationId))
      return this.store.read().operations[intent.statusOperationId].result;
    this.policy.require(
      actor,
      value ? "session.archive" : "session.restore",
      reference,
    );
    const workspaces = this.adapter.context.get("workspaceRegistry");
    requireCondition(workspaces, "workspace_unavailable");
    try {
      if (value) await workspaces.archiveSession(input.sessionId);
      else await workspaces.unarchiveSession(input.sessionId);
      return await this.store.transact(
        {
          operationId: intent.statusOperationId,
          action: "session.archive-settled",
          input: intent,
        },
        (draft) => {
          this.policy.require(
            actor,
            value ? "session.archive" : "session.restore",
            reference,
            draft,
          );
          const row = draft.sessions[input.sessionId];
          requireCondition(
            row.archiveOperationId === command.operationId,
            "stale_operation",
          );
          row.archived = value;
          row.state = row.previousState;
          delete row.previousState;
          return row;
        },
      );
    } catch (error) {
      await this.store
        .transact(
          {
            operationId: randomUUID(),
            action: "session.archive-unknown",
            input: {
              sessionId: input.sessionId,
              error: error.code ?? error.name,
            },
          },
          (draft) => {
            const row = draft.sessions[input.sessionId];
            if (row.archiveOperationId === command.operationId) {
              row.state = [
                "WorkspaceActiveSessionError",
                "WorkspaceUnknownSessionError",
              ].includes(error.name)
                ? row.previousState
                : "UNKNOWN";
              row.error = error.code ?? error.name;
            }
            return null;
          },
        )
        .catch(() => {});
      throw error;
    }
  }
  archive(actor, command) {
    return this.#archive(actor, command, true);
  }
  restore(actor, command) {
    return this.#archive(actor, command, false);
  }
}
