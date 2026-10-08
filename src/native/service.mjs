import { copy, plain, requireCondition, validId } from "./store.mjs";
import {commandHelp} from "./commands.mjs";

/** One business surface shared by authenticated GUI RPC and Agent-scoped tools. */
export class BotService {
  #closed = false;
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
                : copy(row);
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
          this.policy.canReadDerived(
            actor,
            { botId: row.botId, ...(row.result ?? {}), ...(row.report ?? {}) },
            state,
          ),
      )
      .map((row) => {
        this.policy.noteRead(actor, { kind: "task", id: row.taskId });
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
    else if (action.startsWith("memory.") && action !== "memory.search")
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
    if (reference) this.policy.noteRead(actor, reference);
    if (result && typeof result === "object" && !Array.isArray(result)) {
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
      return commandHelp(actor, input);
    } else if (action === "snapshot") result = this.snapshot(actor);
    else if (action === "catalog") {
      this.policy.actorKey(actor);
      result = {
        ...(await this.adapter.models()),
        presets: (await this.adapter.context.get("agentPresets")?.list()) ?? [],
        defaultCwd: this.adapter.context.get("profileContext")?.cwd ?? null,
        defaultModel: copy(this.adapter.context.get("agentDefaultModel")?.currentSelection() ?? null),
      };
    } else if (action === "session.page")
      result = await this.sessions.page(actor, input, signal);
    else if (action === "session.list")
      result = await this.sessions.list(actor, input, signal);
    else if (action === "memory.search")
      result = this.bots.searchMemory(actor, input);
    else {
      requireCondition(validId(command.operationId), "invalid_operation");
      const routes = {
        "bot.create": [this.bots, "create"],
        "bot.update": [this.bots, "update"],
        "session.create": [this.sessions, "create"],
        "session.stop": [this.sessions, "stop"],
        "session.archive": [this.sessions, "archive"],
        "session.restore": [this.sessions, "restore"],
        "memory.write": [this.bots, "memoryWrite"],
        "memory.forget": [this.bots, "memoryForget"],
        "share.set": [this.policy, "authorizeShare"],
        "grant.set": [this.policy, "authorizeShare"],
        "task.create": [this.tasks, "create"],
        "task.start": [this.tasks, "start"],
        "task.adjust": [this.tasks, "adjust"],
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
