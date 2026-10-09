import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { copy, digest, plain, requireCondition, validId } from "./store.mjs";

/** Durable admission precedes native work; terminal resources precede slot release. */
export class TaskController {
  runtimeId = randomUUID();
  #launching = new Map();
  #watching = new Map();
  #closed = false;
  #closing = false;
  #timers = new Set();
  #resultSink;
  constructor({ store, policy, adapter }) {
    Object.assign(this, { store, policy, adapter });
  }
  setResultSink(broker) {
    this.#resultSink = broker;
  }
  #hasPendingChildren(state, parent) {
    return Object.values(state.attempts).some((child) => {
      if (child.parentAttemptId !== parent.attemptId) return false;
      if (child.reservationHeld) return true;
      const result = state.outbox[child.resultOutboxId];
      return (
        parent.state !== "stop_requested" &&
        result?.sessionId === parent.sessionId &&
        ["queued", "admitting", "UNKNOWN"].includes(result.state)
      );
    });
  }
  #source(actor, state = this.store.read()) {
    if (actor.kind === "schedule") {
      const occurrence = state.occurrences[actor.occurrenceId];
      requireCondition(occurrence, "access_denied");
      return {kind: "schedule", occurrenceId: actor.occurrenceId, scheduleId: occurrence.scheduleId, sessionId: actor.sessionId};
    }
    if (actor.kind === "human") return { kind: "human" };
    const binding = state.sessions[actor.sessionId];
    return {
      kind: "session",
      sessionId: actor.sessionId,
      ...copy(binding.lineage ?? {}),
    };
  }
  #inheritContent(actor, task, draft) {
    if (actor.kind === "human" || actor.kind === "schedule") return;
    const refs = this.policy.readDependencies(actor);
    for (const ref of refs)
      this.policy.require(actor, `${ref.kind}.read`, ref, draft);
    task.origins = [
      ...new Map(
        [...(task.origins ?? []), ...refs].map((ref) => [
          JSON.stringify(ref),
          copy(ref),
        ]),
      ).values(),
    ];
    task.contentSources = [
      ...new Map(
        [...(task.contentSources ?? []), this.#source(actor)].map((source) => [
          JSON.stringify(source),
          copy(source),
        ]),
      ).values(),
    ];
  }
  #definition(task) {
    return digest({title: task.title, goal: task.goal, criteria: task.criteria, dependsOn: task.dependsOn ?? []});
  }
  #dependencies(actor, taskId, dependsOn, draft) {
    requireCondition(Array.isArray(dependsOn) && dependsOn.length <= 30 &&
      dependsOn.every(validId) && new Set(dependsOn).size === dependsOn.length, "invalid_dependencies");
    for (const id of dependsOn) {
      requireCondition(draft.tasks[id], "not_found");
      this.policy.require(actor, "task.read", {kind: "task", id}, draft);
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      requireCondition(!visiting.has(id), "dependency_cycle");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const next of id === taskId ? dependsOn : draft.tasks[id]?.dependsOn ?? []) visit(next);
      visiting.delete(id); visited.add(id);
    };
    // All tasks, including archived and cross Bot records, participate in the graph.
    for (const id of new Set([...Object.keys(draft.tasks), taskId])) visit(id);
  }
  #settled(attempt) {
    const proof = attempt?.localEvidence;
    const current = attempt?.sessionId ? this.adapter.resources(attempt.sessionId) : null;
    // Historical proof survives restart, but known active current resources always win.
    if (current?.known && (!current.settled || current.resourceFaults?.length || current.releasePending || current.stopPending)) return false;
    return !!attempt && !attempt.reservationHeld && !["UNKNOWN", "starting", "running", "stop_requested", "stopping"].includes(attempt.state) &&
      typeof attempt.settledAt === "string" && !!attempt.settledAt && proof?.known === true && proof.settled === true &&
      !(proof.resourceFaults?.length) && !(proof.releasePending || proof.stopPending || proof.terminalActive || proof.models || proof.tools) &&
      !(proof.jobs ?? []).some(job => ["running", "stopping", "UNKNOWN"].includes(job.status));
  }
  #requireSettledTask(task, draft) {
    const rows = Object.values(draft.attempts), related = new Set(rows.filter(row => row.taskId === task.taskId).map(row => row.attemptId));
    if (task.currentAttemptId) related.add(task.currentAttemptId);
    let added;
    do {
      added = false;
      for (const row of rows) {
        if (related.has(row.parentAttemptId) && !related.has(row.attemptId)) {related.add(row.attemptId); added = true;}
        // A child's original parent and that parent's work remain part of settlement.
        if (related.has(row.attemptId) && row.parentAttemptId && !related.has(row.parentAttemptId)) {related.add(row.parentAttemptId); added = true;}
      }
    } while (added);
    requireCondition(!["UNKNOWN", "running", "starting", "stopping", "stop_requested"].includes(task.state) && [...related].every(id => draft.attempts[id] && this.#settled(draft.attempts[id])), "attempt_unsettled");
    const sessionIds = new Set(rows.filter(row => related.has(row.attemptId)).map(row => row.sessionId));
    requireCondition(!Object.values(draft.outbox).some(row =>
      (row.taskId === task.taskId || related.has(row.attemptId) || sessionIds.has(row.sessionId) || sessionIds.has(row.source?.sessionId)) &&
      (["queued", "admitting", "UNKNOWN"].includes(row.state) || row.state === "blocked" && row.nativeAdmission !== false)), "delivery_pending");
    return rows.filter(row => related.has(row.attemptId));
  }
  #readContent(actor, prospect, record, draft) {
    if (!record) return;
    requireCondition(this.policy.canReadDerived(actor, record, draft) &&
      this.policy.canProspectiveBotReadDerived(prospect, record, draft), "access_denied");
    const sources = [record.source, ...(record.contentSources ?? [])].flat().filter(Boolean);
    const refs = [...(record.origins ?? []), ...sources.filter(source => source.sessionId).map(source => ({kind: "session", id: source.sessionId}))];
    for (const ref of refs) {
      this.policy.require(actor, `${ref.kind}.read`, ref, draft);
      requireCondition(this.policy.canProspectiveBotRead(prospect, ref, draft), "access_denied");
    }
  }
  #readAttemptSession(actor, prospect, sessionId, state) {
    requireCondition(validId(sessionId), "access_denied");
    const reference = {kind: "session", id: sessionId};
    this.policy.require(actor, "session.read", reference, state);
    requireCondition(this.policy.canProspectiveBotRead(prospect, reference, state), "access_denied");
  }
  #persistInputs(inputs, draft) {
    return inputs.map(input => {
      const inputId = `taskinput_${digest({taskId: input.taskId, definitionDigest: input.definitionDigest,
        attemptId: input.attemptId, epoch: input.epoch, evidenceHash: digest(input.acceptanceEvidence)})}`;
      // The immutable ledger identity excludes later operation-only task versions.
      // Each consuming attempt still retains its own admission-observed version.
      draft.taskInputs[inputId] ??= {...copy(input), inputId};
      return {...copy(draft.taskInputs[inputId]), version: input.version};
    });
  }
  #publishAttempt(actor, attempt) {
    const state = this.store.read(), current = state.attempts[attempt.attemptId];
    requireCondition(current, "not_found");
    this.policy.require(actor, "session.read", {kind: "session", id: current.sessionId}, state);
    const binding = state.sessions[current.sessionId];
    requireCondition(binding && this.policy.canReadDerived(actor, binding, state) &&
      this.policy.canReadDerived(actor, current, state), "access_denied");
    for (const artifact of [current.result, current.report].filter(Boolean))
      requireCondition(this.policy.canReadDerived(actor, {...artifact, botId: current.botId}, state), "access_denied");
    for (const input of current.prerequisiteInputs ?? []) {
      if (input.inputId) this.policy.require(actor, "taskInput.read", {kind: "taskInput", id: input.inputId}, state);
      else this.policy.require(actor, "task.read", {kind: "task", id: input.taskId}, state);
      this.policy.require(actor, "session.read", {kind: "session", id: input.attemptSessionId ?? state.attempts[input.attemptId]?.sessionId}, state);
      for (const record of [input, input.result, input.report, input.acceptanceEvidence].filter(Boolean))
        requireCondition(this.policy.canReadDerived(actor, record, state), "access_denied");
    }
    return current;
  }
  #prerequisites(actor, task, draft) {
    const prospect = {botId: task.botId, purpose: "execution", lineage: {}};
    return (task.dependsOn ?? []).map(id => {
      const prerequisite = draft.tasks[id], evidence = prerequisite?.acceptanceEvidence,
        attempt = draft.attempts[evidence?.attemptId], definitionDigest = prerequisite && this.#definition(prerequisite);
      requireCondition(prerequisite?.acceptance === "passed" && evidence &&
        evidence.definitionVersion === (prerequisite.definitionVersion ?? 1) && evidence.definitionDigest === definitionDigest &&
        evidence.attemptId === prerequisite.currentAttemptId && evidence.epoch === attempt?.epoch && attempt.epoch === prerequisite.epoch &&
        attempt.taskId === id && attempt.definitionVersion === evidence.definitionVersion && attempt.definitionDigest === definitionDigest &&
        this.#settled(attempt) && (attempt.result || attempt.report), "dependency_blocked", `等待依赖验收：${id}`);
      this.policy.require(actor, "task.read", {kind: "task", id}, draft);
      requireCondition(this.policy.canProspectiveBotRead(prospect, {kind: "task", id}, draft), "access_denied");
      this.#readAttemptSession(actor, prospect, attempt.sessionId, draft);
      for (const record of [attempt.result, attempt.report, evidence]) this.#readContent(actor, prospect, record, draft);
      return {taskId: id, botId: attempt.botId, attemptSessionId: attempt.sessionId, version: prerequisite.version, definitionVersion: evidence.definitionVersion,
        definitionDigest, attemptId: attempt.attemptId, epoch: attempt.epoch,
        acceptanceEvidence: copy(evidence), result: attempt.result ? copy(attempt.result) : null,
        report: attempt.report ? copy(attempt.report) : null, source: copy(prerequisite.source), origins: copy(prerequisite.origins ?? []),
        contentSources: copy(prerequisite.contentSources ?? [])};
    });
  }
  #scheduleInput(actor, command, action) {
    requireCondition(actor.kind === "schedule" && plain(command.input) &&
      Object.keys(command.input).length === 1 && command.input.occurrenceId === actor.occurrenceId, "access_denied");
    // The authentic token is checked before reading its immutable claim recipe.
    this.policy.actorKey(actor);
    const occurrence = this.store.read().occurrences[actor.occurrenceId];
    requireCondition(occurrence, "access_denied");
    if (action === "task.create") return copy(occurrence.recipe);
    return {taskId: occurrence.taskId, expectedVersion: 1};
  }
  async createScheduled(actor, command) {
    requireCondition(actor.kind === "schedule", "access_denied");
    return this.create(actor, command);
  }
  async startScheduled(actor, command) {
    requireCondition(actor.kind === "schedule", "access_denied");
    return this.start(actor, command);
  }
  async create(actor, command) {
    command = copy(command);
    const input = actor.kind === "schedule" ? this.#scheduleInput(actor, command, "task.create") : command.input;
    return this.store.transact(this.policy.command(actor, command), (draft) =>
      this.createInDraft(actor, input, draft),
    );
  }
  createInDraft(actor, input, draft) {
    input = copy(input);
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) =>
          ["botId", "title", "goal", "criteria", "originSessionId", "dependsOn"].includes(
            key,
          ),
        ) &&
        validId(input.botId) &&
        typeof input.title === "string" &&
        input.title.trim().length > 0 &&
        input.title.length <= 200 &&
        typeof input.goal === "string" &&
        input.goal.trim().length > 0 &&
        input.goal.length <= 16000 &&
        Array.isArray(input.criteria) &&
        input.criteria.length <= 30 &&
        input.criteria.every(
          (item) => typeof item === "string" && item.length <= 2000,
        ),
      "invalid_task",
    );
    if (actor.kind === "schedule") this.policy.requireScheduleAdmission(actor, "task.create", input, draft);
    if (input.originSessionId)
      this.policy.require(
        actor,
        "session.send",
        { kind: "session", id: input.originSessionId },
        draft,
      );
    const bot = draft.bots[input.botId];
    requireCondition(bot?.lifecycle === "active", "bot_not_active");
    const taskId = `task_${randomUUID()}`,
      task = {
        taskId,
        botId: bot.botId,
        title: input.title.trim(),
        goal: input.goal,
        criteria: input.criteria,
        version: 1,
        definitionVersion: 1,
        dependsOn: input.dependsOn ?? [],
        handoffs: [],
        createdBy:
          actor.kind === "schedule"
            ? {kind: "schedule", occurrenceId: actor.occurrenceId, scheduleId: draft.occurrences[actor.occurrenceId].scheduleId}
            : actor.kind === "human"
            ? { kind: "human" }
            : { kind: "bot", botId: actor.botId, sessionId: actor.sessionId },
        epoch: 0,
        state: "queued",
        archived: false,
        acceptance: "unknown",
        currentAttemptId: null,
        originSessionId:
          input.originSessionId ??
          (actor.kind === "bot" ? actor.sessionId : null),
        source: this.#source(actor, draft),
        origins: this.policy.readDependencies(actor),
        createdAt: new Date().toISOString(),
      };
    this.#dependencies(actor, taskId, task.dependsOn, draft);
    draft.tasks[taskId] = task;
    this.policy.require(
      actor,
      "task.create",
      { kind: "task", id: taskId },
      draft,
    );
    if (actor.kind === "schedule") draft.occurrences[actor.occurrenceId].taskId = taskId;
    return task;
  }
  async start(actor, command) {
    requireCondition(!this.#closed && !this.#closing, "disabled");
    command = copy(command);
    const input = actor.kind === "schedule" ? this.#scheduleInput(actor, command, "task.start") : command.input;
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) =>
          ["taskId", "expectedVersion", "parentAttemptId"].includes(key),
        ),
      "invalid_task",
    );
    const stamped = this.policy.command(actor, command);
    if (actor.kind === "schedule" && !Object.hasOwn(this.store.read().operations, command.operationId)) {
      const bot = this.store.read().bots[actor.botId];
      requireCondition(bot?.lifecycle === "active", "bot_not_active");
      await this.adapter.validateModel(bot.execution);
    }
    const intent = await this.store.transact(
      stamped,
      (draft) => {
        const task = draft.tasks[input.taskId];
        requireCondition(task, "not_found");
        if (actor.kind === "schedule") this.policy.requireScheduleAdmission(actor, "task.start", input, draft);
        this.policy.require(
          actor,
          "task.start",
          { kind: "task", id: task.taskId },
          draft,
        );
        requireCondition(
          task.version === input.expectedVersion,
          "revision_conflict",
        );
        requireCondition(!task.archived, "archived");
        requireCondition(
          !Object.values(draft.attempts).some(
            (row) => row.taskId === task.taskId && row.reservationHeld,
          ),
          "attempt_unsettled",
        );
        const prerequisiteInputs = this.#persistInputs(this.#prerequisites(actor, task, draft), draft);
        const parentId =
          input.parentAttemptId ??
          (actor.kind === "bot"
            ? draft.sessions[actor.sessionId].attemptId
            : null);
        const parent = parentId ? draft.attempts[parentId] : null;
        if (parentId)
          requireCondition(
            parent?.reservationHeld &&
              ["starting", "running"].includes(parent.state) &&
              parent.botId === task.botId,
            "invalid_parent",
          );
        const depth = parent ? parent.depth + 1 : 0;
        requireCondition(depth <= 1, "depth_exceeded");
        requireCondition(
          Object.values(draft.attempts).filter(
            (row) => row.botId === task.botId && row.reservationHeld,
          ).length < 15,
          "capacity_exhausted",
        );
        const bot = draft.bots[task.botId];
        requireCondition(bot?.lifecycle === "active", "bot_not_active");
        const attemptId = `attempt_${randomUUID()}`,
          sessionId = randomUUID(),
          epoch = task.epoch + 1;
        const attempt = {
          attemptId,
          taskId: task.taskId,
          botId: bot.botId,
          sessionId,
          epoch,
          taskVersion: task.version + 1,
          definitionVersion: task.definitionVersion ?? 1,
          definitionDigest: this.#definition(task),
          prerequisiteInputs,
          parentAttemptId: parent?.attemptId ?? null,
          depth,
          model: copy(bot.execution),
          configRevision: bot.configRevision,
          state: "starting",
          reservationHeld: true,
          runtimeId: this.runtimeId,
          operationId: command.operationId,
          messageId: randomUUID(),
          readyOperationId: randomUUID(),
          settleOperationId: randomUUID(),
          resultOutboxId: `outbox_${randomUUID()}`,
          resultOperationId: randomUUID(),
          resultMessageId: randomUUID(),
          createdAt: new Date().toISOString(),
          usage: "UNKNOWN",
          externalEffects: "UNKNOWN",
        };
        draft.attempts[attemptId] = attempt;
        if (actor.kind === "schedule") draft.occurrences[actor.occurrenceId].attemptId = attemptId;
        task.epoch = epoch;
        task.version++;
        task.currentAttemptId = attemptId;
        task.state = "running";
        task.acceptance = "unknown";
        draft.sessions[sessionId] = {
          sessionId,
          botId: bot.botId,
          purpose: "execution",
          attemptId,
          epoch,
          model: copy(attempt.model),
          configRevision: bot.configRevision,
          cwd: bot.cwd,
          presetId: bot.presetId,
          state: "creating",
          ownerRuntimeId: this.adapter.runtimeId,
          archived: false,
          source: copy(task.source),
          origins: [...new Map([
            ...(task.origins ?? []),
            ...prerequisiteInputs.flatMap(row => [
              {kind: "taskInput", id: row.inputId}, {kind: "session", id: row.attemptSessionId}, ...(row.origins ?? []),
              ...[row.result, row.report, row.acceptanceEvidence].filter(Boolean).flatMap(record => [
                ...(record.origins ?? []), ...(record.source?.sessionId ? [{kind: "session", id: record.source.sessionId}] : []),
              ]),
            ]),
          ].map(ref => [JSON.stringify(ref), copy(ref)])).values()],
          contentSources: prerequisiteInputs.flatMap(row => [row.source, ...[row.result, row.report, row.acceptanceEvidence].map(record => record?.source)].filter(Boolean).map(copy)),
          parentSessionId: parent?.sessionId ?? null,
          depth,
        };
        return attempt;
      },
    );
    const current = this.store.read().attempts[intent.attemptId];
    if (current.state !== "starting") return this.#publishAttempt(actor, current);
    requireCondition(current.runtimeId === this.runtimeId, "recovery_required");
    if (this.#launching.has(current.attemptId)) {
      const launched = await this.#launching.get(current.attemptId);
      return this.#publishAttempt(actor, launched);
    }
    const launch = this.#launch(actor, current);
    this.#launching.set(current.attemptId, launch);
    try {
      const launched = await launch;
      return this.#publishAttempt(actor, launched);
    } finally {
      this.#launching.delete(current.attemptId);
    }
  }
  async #launch(actor, attempt) {
    try {
      const binding = this.store.read().sessions[attempt.sessionId];
      await this.adapter.createOwned(binding);
      await this.store.transact(
        {
          operationId: attempt.readyOperationId,
          action: "attempt.ready",
          input: { attemptId: attempt.attemptId },
        },
        (draft) => {
          const row = draft.attempts[attempt.attemptId];
          requireCondition(row.state === "starting", "stale_attempt");
          this.policy.require(
            actor,
            "task.start",
            { kind: "task", id: attempt.taskId },
            draft,
          );
          row.state = "running";
          draft.sessions[row.sessionId].state = "ready";
          return null;
        },
      );
      const task = this.store.read().tasks[attempt.taskId],
        agent = this.adapter.context.agents.get(attempt.sessionId);
      requireCondition(
        agent && task.currentAttemptId === attempt.attemptId,
        "stale_attempt",
      );
      agent.followup({
        ...createUserMessage({
          content: [
            {
              type: "text",
              text: `执行任务 ${task.title}\n目标：${task.goal}\n验收条件：${JSON.stringify(task.criteria)}\n已准入的前置任务结果与验收（固定输入）：${JSON.stringify(attempt.prerequisiteInputs ?? [])}\n原始身份：${JSON.stringify({ taskId: task.taskId, attemptId: attempt.attemptId, epoch: attempt.epoch, version: task.version })}\n可以使用 dsh_bot 查询进展或创建一级子任务。完成后给出实际结果及证据；没有证据的验收保持 unknown。`,
            },
          ],
          source: {
            kind: "dsh-bot-task",
            taskId: task.taskId,
            attemptId: attempt.attemptId,
            operationId: attempt.operationId,
          },
        }),
        id: attempt.messageId,
      });
      this.#watch(attempt.attemptId);
      return this.store.read().attempts[attempt.attemptId];
    } catch (error) {
      await this.store
        .transact(
          {
            operationId: randomUUID(),
            action: "attempt.unknown",
            input: {
              attemptId: attempt.attemptId,
              reason: error.code ?? error.name,
            },
          },
          (draft) => {
            const row = draft.attempts[attempt.attemptId];
            if (row?.reservationHeld) {
              row.state = "UNKNOWN";
              row.error = error.code ?? error.name;
              if (draft.tasks[row.taskId].currentAttemptId === row.attemptId)
                draft.tasks[row.taskId].state = "UNKNOWN";
            }
            return null;
          },
        )
        .catch(() => {});
      throw error;
    }
  }
  #watch(attemptId) {
    if (this.#watching.has(attemptId) || this.#closed) return;
    const run = (async () => {
      while (!this.#closed) {
        const state = this.store.read(),
          attempt = state.attempts[attemptId];
        if (!attempt?.reservationHeld) return;
        const evidence = this.adapter.resources(attempt.sessionId),
          childrenPending = this.#hasPendingChildren(state, attempt);
        if (evidence.resourceFaults?.length) {
          await this.store.transact(
            {
              operationId: randomUUID(),
              action: "attempt.resource-unknown",
              input: { attemptId },
            },
            (draft) => {
              const row = draft.attempts[attemptId];
              row.state = "UNKNOWN";
              row.error = "resource_termination_unknown";
              row.localEvidence = evidence;
              draft.tasks[row.taskId].state = "UNKNOWN";
              return null;
            },
          );
          return;
        }
        if (
          evidence.known &&
          evidence.settled &&
          !childrenPending &&
          attempt.state !== "starting"
        ) {
          const live = this.adapter.context.sessions.get(attempt.sessionId);
          if (live) await this.adapter.context.sessions.flush(live);
          const candidate = await this.adapter.readNative(attempt.sessionId),
            candidateEnd = candidate.events
              .filter((event) => event.type === "turn/end")
              .at(-1);
          if (candidateEnd || attempt.state === "stop_requested") {
            await this.adapter.quiesce(attempt.sessionId);
            if (
              this.#hasPendingChildren(
                this.store.read(),
                this.store.read().attempts[attemptId],
              ) ||
              !this.adapter.resources(attempt.sessionId).settled
            )
              continue;
            await this.adapter.disposeOwned(attempt.sessionId);
            // The idle barrier can follow later native turns, including child
            // results. Read the final durable log after owned teardown, once
            // admission is closed, rather than settling a pre-barrier reply.
            const history = await this.adapter.readNative(attempt.sessionId),
              end = history.events.filter((event) => event.type === "turn/end").at(-1),
              reply = history.events.filter((event) => event.type === "assistant/message").at(-1),
              finalEvidence = this.adapter.resources(attempt.sessionId);
            try {
              await this.store.transact(
                {
                  operationId: attempt.settleOperationId,
                  action: "attempt.settled",
                  input: { attemptId },
                },
                (draft) => {
                  const row = draft.attempts[attemptId];
                  if (!row.reservationHeld) return null;
                  requireCondition(
                    !this.#hasPendingChildren(draft, row) &&
                      this.adapter.resources(row.sessionId).settled,
                    "settlement_pending",
                  );
                  const task = draft.tasks[row.taskId],
                    stopped =
                      ["stop_requested", "UNKNOWN"].includes(row.state) ||
                      task.version !== row.taskVersion;
                  row.state = stopped
                    ? "stopped"
                    : end?.data.reason.kind === "completed"
                      ? "returned"
                      : "failed";
                  row.reservationHeld = false;
                  row.settledAt = new Date().toISOString();
                  row.localEvidence = finalEvidence;
                  row.usage = finalEvidence.requests.map((request) => request.usage);
                  if (!stopped && reply)
                    row.result = {
                      sessionId: row.sessionId,
                      eventSeq: reply.seq,
                      content: copy(
                        reply.data.content ?? reply.data.message?.content ?? [],
                      ),
                      source: { sessionId: row.sessionId, eventSeq: reply.seq },
                      origins: copy(
                        draft.sessions[row.sessionId].origins ?? [],
                      ),
                    };
                  draft.sessions[row.sessionId].state = "settled";
                  if (task.currentAttemptId === attemptId) {
                    task.state = stopped
                      ? "stopped"
                      : row.state === "returned"
                        ? "awaiting_acceptance"
                        : "failed";
                    task.version++;
                  }
                  if (!stopped)
                    this.#resultSink?.recordResult(draft, task, row);
                  return null;
                },
              );
            } catch (error) {
              if (error.code === "settlement_pending") continue;
              throw error;
            }
            await this.#resultSink?.deliverResult(attemptId);
            return;
          }
        }
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            this.#timers.delete(timer);
            resolve();
          }, 20);
          this.#timers.add(timer);
        });
      }
    })()
      .catch(async (error) => {
        await this.store
          .transact(
            {
              operationId: randomUUID(),
              action: "attempt.evidence-unknown",
              input: { attemptId, reason: error.code ?? error.name },
            },
            (draft) => {
              const row = draft.attempts[attemptId];
              if (row?.reservationHeld) {
                row.state = "UNKNOWN";
                row.error = error.code ?? error.name;
                draft.tasks[row.taskId].state = "UNKNOWN";
                draft.sessions[row.sessionId].state = "UNKNOWN";
              }
              return null;
            },
          )
          .catch(() => {});
      })
      .finally(() => this.#watching.delete(attemptId));
    this.#watching.set(attemptId, run);
  }
  async stop(actor, command) {
    command = copy(command);
    const input = command.input;
    const receipt = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const task = draft.tasks[input.taskId],
          attempt = draft.attempts[input.attemptId];
        requireCondition(task && attempt, "not_found");
        this.policy.require(
          actor,
          "task.stop",
          { kind: "task", id: task.taskId },
          draft,
        );
        requireCondition(
          task.currentAttemptId === attempt.attemptId &&
            attempt.taskId === task.taskId &&
            attempt.epoch === input.epoch,
          "stale_attempt",
        );
        const forest = [
          attempt,
          ...Object.values(draft.attempts).filter(
            (row) =>
              row.parentAttemptId === attempt.attemptId && row.reservationHeld,
          ),
        ];
        for (const row of forest)
          if (row.reservationHeld) {
            row.state = "stop_requested";
            row.stopOperationId = command.operationId;
            draft.sessions[row.sessionId].state = "stopping";
          }
        task.state = attempt.reservationHeld ? "stopping" : task.state;
        return {
          accepted: true,
          taskId: task.taskId,
          attemptId: attempt.attemptId,
          epoch: attempt.epoch,
          operationId: command.operationId,
          attemptIds: forest.map((row) => row.attemptId),
          settled: !attempt.reservationHeld,
        };
      },
    );
    for (const id of receipt.attemptIds) {
      const attempt = this.store.read().attempts[id];
      if (attempt.reservationHeld) {
        void this.adapter.stopResources(attempt.sessionId).catch(() => {});
        this.#watch(id);
      }
    }
    return receipt;
  }
  dependencyStatus(actor, task, state = this.store.read()) {
    try {
      this.policy.require(actor, "task.read", {kind: "task", id: task.taskId}, state);
      this.#prerequisites(actor, task, state);
      return {blocked: false};
    } catch (error) {
      return {blocked: true, reason: error.code === "dependency_blocked" ? "等待依赖验收" : "依赖内容不可读", code: error.code ?? "dependency_blocked"};
    }
  }
  async setDependencies(actor, command) {
    command = copy(command);
    const input = command.input;
    requireCondition(plain(input) && Object.keys(input).every(key => ["taskId", "expectedVersion", "dependsOn"].includes(key)), "invalid_dependencies");
    return this.store.transact(this.policy.command(actor, command), draft => {
      const task = draft.tasks[input.taskId];
      requireCondition(task, "not_found");
      this.policy.require(actor, "task.dependencies.set", {kind: "task", id: task.taskId}, draft);
      requireCondition(task.version === input.expectedVersion, "revision_conflict");
      this.#requireSettledTask(task, draft);
      this.#dependencies(actor, task.taskId, input.dependsOn, draft);
      task.dependsOn = copy(input.dependsOn);
      this.#inheritContent(actor, task, draft);
      task.version++; task.definitionVersion = (task.definitionVersion ?? 1) + 1;
      task.acceptance = "unknown";
      return task;
    });
  }
  #handoffInDraft(actor, input, operationId, task, draft) {
    requireCondition(validId(input.toBotId) && typeof (input.note ?? "") === "string" && (input.note ?? "").length <= 2000, "invalid_handoff");
    this.policy.require(actor, "task.handoff", {kind: "task", id: task.taskId}, draft);
    this.policy.requireTaskTargetControl(actor, input.toBotId, task.taskId, draft);
    requireCondition(draft.bots[input.toBotId]?.lifecycle === "active" && !draft.bots[input.toBotId].deletedAt, "bot_not_active");
    const related = this.#requireSettledTask(task, draft), prospect = {botId: input.toBotId, purpose: "execution", lineage: {}};
    requireCondition(this.policy.canProspectiveBotRead(prospect, {kind: "task", id: task.taskId}, draft), "access_denied");
    this.#readContent(actor, prospect, task, draft);
    this.#readContent(actor, prospect, task.acceptanceEvidence, draft);
    for (const row of related.filter(row => row.taskId === task.taskId)) {
      this.#readAttemptSession(actor, prospect, row.sessionId, draft);
      for (const record of [row.result, row.report]) this.#readContent(actor, prospect, record, draft);
      for (const prerequisite of row.prerequisiteInputs ?? []) {
        this.#readAttemptSession(actor, prospect, prerequisite.attemptSessionId ?? draft.attempts[prerequisite.attemptId]?.sessionId, draft);
        if (prerequisite.inputId) {
          this.policy.require(actor, "taskInput.read", {kind: "taskInput", id: prerequisite.inputId}, draft);
          requireCondition(this.policy.canProspectiveBotRead(prospect, {kind: "taskInput", id: prerequisite.inputId}, draft), "access_denied");
        }
        for (const record of [prerequisite.result, prerequisite.report, prerequisite.acceptanceEvidence]) this.#readContent(actor, prospect, record, draft);
      }
    }
    const beforeVersion = task.version;
    task.handoffs ??= [];
    task.handoffs.push({operationId, fromBotId: task.botId, toBotId: input.toBotId,
      source: this.#source(actor, draft), note: input.note ?? "", time: new Date().toISOString(),
      previousAttemptId: task.currentAttemptId, beforeVersion, afterVersion: beforeVersion + 1,
      provenance: {origins: this.policy.readDependencies(actor), source: this.#source(actor, draft)}});
    task.botId = input.toBotId;
  }
  async handoff(actor, command) {
    command = copy(command);
    const input = command.input;
    requireCondition(plain(input) && Object.keys(input).every(key => ["taskId", "expectedVersion", "toBotId", "note"].includes(key)), "invalid_handoff");
    return this.store.transact(this.policy.command(actor, command), draft => {
      const task = draft.tasks[input.taskId];
      requireCondition(task, "not_found");
      requireCondition(task.version === input.expectedVersion, "revision_conflict");
      this.#handoffInDraft(actor, input, command.operationId, task, draft);
      task.version++;
      return task;
    });
  }
  async adjust(actor, command) {
    command = copy(command);
    const input = command.input;
    const changed = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const task = draft.tasks[input.taskId];
        requireCondition(task, "not_found");
        this.policy.require(
          actor,
          "task.adjust",
          { kind: "task", id: task.taskId },
          draft,
        );
        requireCondition(
          task.version === input.expectedVersion,
          "revision_conflict",
        );
        requireCondition(plain(input) && Object.keys(input).every(key => ["taskId", "expectedVersion", "goal", "title", "criteria", "botId", "note"].includes(key)), "invalid_task");
        for (const key of ["goal", "title", "criteria"])
          if (Object.hasOwn(input, key)) requireCondition(
            key === "criteria" ? Array.isArray(input[key]) && input[key].length <= 30 && input[key].every(item => typeof item === "string" && item.length <= 2000) :
              typeof input[key] === "string" && input[key].trim().length > 0 && input[key].length <= (key === "title" ? 200 : 16000), "invalid_task");
        // Validate the entire handoff before any definition field is written.
        if (Object.hasOwn(input, "botId")) this.#handoffInDraft(actor, {...input, toBotId: input.botId}, command.operationId, task, draft);
        const previousDefinition = this.#definition(task);
        for (const key of ["goal", "title", "criteria"])
          if (Object.hasOwn(input, key)) task[key] = copy(input[key]);
        const definitionChanged = previousDefinition !== this.#definition(task);
        if (definitionChanged) {
          this.#inheritContent(actor, task, draft);
          if (Object.hasOwn(input, "botId")) {
            const prospect = {botId: input.botId, purpose: "execution", lineage: {}};
            this.#readContent(actor, prospect, task, draft);
          }
          task.definitionVersion = (task.definitionVersion ?? 1) + 1;
          task.acceptance = "unknown";
          task.state = "adjusted";
          task.adjustStopId = randomUUID();
        }
        task.version++;
        return task;
      },
    );
    const attempt = this.store.read().attempts[changed.currentAttemptId];
    if (attempt?.reservationHeld && changed.adjustStopId)
      await this.stop(actor, {
        operationId: changed.adjustStopId,
        action: "task.stop",
        input: {
          taskId: changed.taskId,
          attemptId: attempt.attemptId,
          epoch: attempt.epoch,
        },
      });
    return this.store.read().tasks[changed.taskId];
  }
  async submit(actor, command) {
    command = copy(command);
    const input = command.input;
    return this.store.transact(this.policy.command(actor, command), (draft) => {
      const task = draft.tasks[input.taskId],
        attempt = draft.attempts[input.attemptId];
      requireCondition(task && attempt, "not_found");
      this.policy.require(
        actor,
        "task.adjust",
        { kind: "task", id: task.taskId },
        draft,
      );
      requireCondition(
        task.currentAttemptId === attempt.attemptId &&
          attempt.epoch === input.epoch &&
          attempt.taskVersion === task.version &&
          attempt.state === "running",
        "stale_attempt",
      );
      requireCondition(
        typeof input.report === "string" && input.report.length <= 16000,
        "invalid_report",
      );
      if (actor.kind === "bot")
        requireCondition(
          actor.sessionId === attempt.sessionId,
          "access_denied",
        );
      attempt.report = {
        text: input.report,
        source: this.#source(actor),
        origins: this.policy.readDependencies(actor),
      };
      return { accepted: true, attemptId: attempt.attemptId };
    });
  }
  async accept(actor, command) {
    command = copy(command);
    const input = command.input;
    return this.store.transact(this.policy.command(actor, command), (draft) => {
      const task = draft.tasks[input.taskId],
        attempt = draft.attempts[input.attemptId];
      requireCondition(task && attempt, "not_found");
      this.policy.require(
        actor,
        "task.accept",
        { kind: "task", id: task.taskId },
        draft,
      );
      requireCondition(
        task.version === input.expectedVersion &&
          task.currentAttemptId === attempt.attemptId,
        "revision_conflict",
      );
      requireCondition(this.#settled(attempt), "attempt_unsettled");
      requireCondition(
        attempt.definitionVersion === (task.definitionVersion ?? 1) &&
          (!attempt.definitionDigest || attempt.definitionDigest === this.#definition(task)) && attempt.epoch === task.epoch,
        "stale_attempt",
      );
      requireCondition(
        ["passed", "failed", "unknown"].includes(input.outcome) &&
          typeof input.evidence === "string" &&
          input.evidence.length <= 16000,
        "invalid_acceptance",
      );
      this.#inheritContent(actor, task, draft);
      // A legacy settled attempt may be explicitly re-accepted, never inferred.
      attempt.definitionDigest ??= this.#definition(task);
      task.acceptance = input.outcome;
      task.acceptanceEvidence = {
        text: input.evidence,
        attemptId: attempt.attemptId,
        epoch: attempt.epoch,
        definitionVersion: task.definitionVersion ?? 1,
        definitionDigest: this.#definition(task),
        source: this.#source(actor, draft),
        origins: this.policy.readDependencies(actor),
      };
      task.state =
        input.outcome === "passed" ? "completed" : "awaiting_acceptance";
      task.version++;
      return task;
    });
  }
  async #archive(actor, command, value) {
    command = copy(command);
    const input = command.input;
    return this.store.transact(this.policy.command(actor, command), (draft) => {
      const task = draft.tasks[input.taskId];
      requireCondition(task, "not_found");
      this.policy.require(
        actor,
        value ? "task.archive" : "task.restore",
        { kind: "task", id: task.taskId },
        draft,
      );
      requireCondition(
        task.version === input.expectedVersion,
        "revision_conflict",
      );
      requireCondition(
        !Object.values(draft.attempts).some(
          (row) => row.taskId === task.taskId && row.reservationHeld,
        ),
        "attempt_unsettled",
      );
      task.archived = value;
      task.version++;
      return task;
    });
  }
  archive(actor, command) {
    return this.#archive(actor, command, true);
  }
  restore(actor, command) {
    return this.#archive(actor, command, false);
  }
  async close() {
    if (this.#closing) return;
    this.#closing = true;
    await Promise.allSettled([...this.#launching.values()]);
    await this.store
      .transact(
        {
          operationId: randomUUID(),
          action: "runtime.disable-intent",
          input: { runtimeId: this.runtimeId },
        },
        (draft) => {
          for (const row of Object.values(draft.attempts))
            if (row.runtimeId === this.runtimeId && row.reservationHeld) {
              row.state = "stop_requested";
              draft.sessions[row.sessionId].state = "stopping";
              draft.tasks[row.taskId].state = "stopping";
            }
          return null;
        },
      )
      .catch(() => {});
    const pending = [];
    // Shutdown uses the last published ownership ledger even when storage is fenced.
    for (const row of Object.values(this.store.read({diagnostic:true}).attempts))
      if (row.runtimeId === this.runtimeId && row.reservationHeld) {
        pending.push(this.adapter.stopResources(row.sessionId));
        this.#watch(row.attemptId);
      }
    let deadline;
    await Promise.race([
      Promise.allSettled([...pending, ...this.#watching.values()]),
      new Promise((resolve) => {
        deadline = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(deadline);
    this.#closed = true;
    await this.store
      .transact(
        {
          operationId: randomUUID(),
          action: "runtime.disable-outcome",
          input: { runtimeId: this.runtimeId },
        },
        (draft) => {
          for (const row of Object.values(draft.attempts))
            if (row.runtimeId === this.runtimeId && row.reservationHeld) {
              row.state = "UNKNOWN";
              row.error = "runtime_disabled_unsettled";
              draft.sessions[row.sessionId].state = "UNKNOWN";
              draft.tasks[row.taskId].state = "UNKNOWN";
            }
          return null;
        },
      )
      .catch(() => {});
    await Promise.allSettled([...this.#watching.values()]);
  }
}
