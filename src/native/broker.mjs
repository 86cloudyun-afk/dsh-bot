import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { copy, plain, requireCondition, validId } from "./store.mjs";

/** Native delivery has its own durable identity; uncertain inputs are never replayed. */
export class ConversationBroker {
  #actors = new Map();
  #deliveries = new Map();
  #targets = new Map();
  #closed = false;
  #lifetime = new AbortController();
  runtimeId = randomUUID();
  constructor({ store, policy, adapter }) {
    Object.assign(this, { store, policy, adapter });
  }
  async enqueue(actor, command) {
    requireCondition(!this.#closed, "disabled");
    command = copy(command);
    const input = command.input;
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) =>
          ["sessionId", "text", "mode"].includes(key),
        ) &&
        validId(input.sessionId) &&
        typeof input.text === "string" &&
        input.text.trim().length > 0 &&
        input.text.length <= 16000 &&
        ["queue", "steer"].includes(input.mode ?? "queue"),
      "invalid_message",
    );
    const row = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        this.policy.require(
          actor,
          "session.send",
          { kind: "session", id: input.sessionId },
          draft,
        );
        const binding = draft.sessions[input.sessionId];
        if (binding?.botId)
          requireCondition(
            binding.purpose === "contact" &&
              binding.state === "ready" &&
              !binding.archived,
            "session_not_ready",
          );
        const pending = Object.values(draft.outbox).filter((row) =>
          ["queued", "admitting", "UNKNOWN"].includes(row.state),
        );
        requireCondition(
          pending.length < 256 &&
            pending.filter((row) => row.botId === (binding?.botId ?? null))
              .length < 64,
          "queue_full",
        );
        const outboxId = `outbox_${randomUUID()}`,
          message = createUserMessage({
            id: randomUUID(),
            content: [{ type: "text", text: input.text }],
            source: {
              kind: "dsh-bot-message",
              operationId: command.operationId,
              outboxId,
            },
          });
        const result = {
          outboxId,
          botId: binding?.botId ?? null,
          sessionId: input.sessionId,
          kind: "message",
          message: copy(message),
          mode: input.mode ?? "queue",
          state: "queued",
          runtimeId: this.runtimeId,
          operationId: command.operationId,
          source:
            actor.kind === "bot"
              ? {
                  sessionId: actor.sessionId,
                  ...copy(draft.sessions[actor.sessionId].lineage ?? {}),
                }
              : { kind: "human" },
          origins: this.policy.readDependencies(actor),
          createdAt: new Date().toISOString(),
        };
        draft.outbox[outboxId] = result;
        return result;
      },
    );
    this.#actors.set(row.outboxId, actor);
    if (this.store.read().outbox[row.outboxId].state === "queued")
      await this.deliver(row.outboxId);
    return this.store.read().outbox[row.outboxId];
  }
  recordResult(draft, task, attempt) {
    if (!attempt.result && !attempt.report) return;
    const outboxId = attempt.resultOutboxId,
      content = attempt.report?.text ?? attempt.result?.content ?? [];
    draft.outbox[outboxId] = {
      outboxId,
      botId: task.botId,
      sessionId: task.originSessionId,
      attemptId: attempt.attemptId,
      taskId: task.taskId,
      epoch: attempt.epoch,
      kind: "result",
      state: task.originSessionId ? "queued" : "available",
      runtimeId: this.runtimeId,
      operationId: attempt.resultOperationId,
      mode: "queue",
      source: copy(attempt.result?.source ?? task.source),
      origins: [
        { kind: "task", id: task.taskId },
        ...(attempt.result?.origins ?? []),
        ...(attempt.report?.origins ?? []),
      ],
      createdAt: new Date().toISOString(),
      message: copy({
        ...createUserMessage({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                taskId: task.taskId,
                attemptId: attempt.attemptId,
                epoch: attempt.epoch,
                result: content,
                execution: attempt.state,
                acceptance: task.acceptance,
                usage: attempt.usage,
                externalEffects: attempt.externalEffects,
              }),
            },
          ],
          source: {
            kind: "dsh-bot-result",
            outboxId,
            operationId: attempt.resultOperationId,
            taskId: task.taskId,
            attemptId: attempt.attemptId,
          },
        }),
        id: attempt.resultMessageId,
      }),
    };
  }
  async deliverResult(attemptId) {
    const attempt = this.store.read().attempts[attemptId],
      row = this.store.read().outbox[attempt?.resultOutboxId];
    if (row?.state === "queued" && row.sessionId && !this.#closed)
      return this.deliver(row.outboxId);
    return row ?? null;
  }
  async deliver(outboxId) {
    requireCondition(!this.#closed, "disabled");
    if (this.#deliveries.has(outboxId)) return this.#deliveries.get(outboxId);
    const row = this.store.read().outbox[outboxId];
    requireCondition(row, "not_found");
    if (
      row.state !== "queued" &&
      !(row.state === "blocked" && row.nativeAdmission === false)
    )
      return row;
    const previous = this.#targets.get(row.sessionId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.#deliver(row));
    this.#targets.set(row.sessionId, run);
    this.#deliveries.set(outboxId, run);
    try {
      return await run;
    } finally {
      this.#deliveries.delete(outboxId);
      if (this.#targets.get(row.sessionId) === run)
        this.#targets.delete(row.sessionId);
    }
  }
  async #authorize(row) {
    requireCondition(
      !this.#closed && row.runtimeId === this.runtimeId,
      "recovery_required",
    );
    const state = this.store.read(),
      binding = state.sessions[row.sessionId],
      actor = this.#actors.get(row.outboxId);
    requireCondition(
      !this.adapter.isArchived(row.sessionId),
      "session_not_ready",
    );
    if (actor)
      this.policy.require(
        actor,
        "session.send",
        { kind: "session", id: row.sessionId },
        state,
      );
    else {
      requireCondition(row.kind === "result", "recovery_required");
      this.policy.requireTaskResultDelivery(row, state);
    }
    if (binding?.botId) {
      const parentResult =
        row.kind === "result" &&
        binding.purpose === "execution" &&
        state.attempts[row.attemptId]?.parentAttemptId === binding.attemptId;
      requireCondition(
        (binding.purpose === "contact" || parentResult) &&
          binding.state === "ready",
        "session_not_ready",
      );
      const agent = await this.adapter.resumeOwned(binding),
        recipient = this.policy.fromAgent(agent);
      requireCondition(
        this.policy.canReadDerived(recipient, row),
        "access_denied",
      );
      for (const ref of row.origins ?? [])
        this.policy.require(recipient, `${ref.kind}.read`, ref);
      return { agent, recipient };
    }
    return { ordinary: true, actor };
  }
  #fenceTarget(row, target) {
    requireCondition(
      !this.#closed && row.runtimeId === this.runtimeId,
      "recovery_required",
    );
    const state = this.store.read(),
      actor = this.#actors.get(row.outboxId);
    requireCondition(
      !this.adapter.isArchived(row.sessionId),
      "session_not_ready",
    );
    if (actor)
      this.policy.require(
        actor,
        "session.send",
        { kind: "session", id: row.sessionId },
        state,
      );
    else this.policy.requireTaskResultDelivery(row, state);
    if (target.recipient) {
      const binding = state.sessions[row.sessionId];
      requireCondition(
        this.adapter.context.agents.get(row.sessionId) === target.agent &&
          binding?.state === "ready",
        "session_not_ready",
      );
      requireCondition(
        this.policy.canReadDerived(target.recipient, row, state),
        "access_denied",
      );
      for (const ref of row.origins ?? [])
        this.policy.require(target.recipient, `${ref.kind}.read`, ref, state);
    }
  }
  async #deliver(row) {
    let nativeAdmission = false;
    try {
      if (row.runtimeId !== this.runtimeId)
        row = await this.store.transact(
          {
            operationId: randomUUID(),
            action: "outbox.reclaim-unadmitted",
            input: { outboxId: row.outboxId },
          },
          (draft) => {
            const current = draft.outbox[row.outboxId];
            requireCondition(
              current.kind === "result" &&
                current.state === "blocked" &&
                current.nativeAdmission === false,
              "recovery_required",
            );
            this.policy.requireTaskResultDelivery(current, draft);
            current.runtimeId = this.runtimeId;
            return current;
          },
        );
      const target = await this.#authorize(row);
      await this.store.transact(
        {
          operationId: randomUUID(),
          action: "outbox.admitting",
          input: { outboxId: row.outboxId },
        },
        (draft) => {
          const current = draft.outbox[row.outboxId];
          requireCondition(
            current.state === "queued" ||
              (current.state === "blocked" &&
                current.nativeAdmission === false),
            "delivery_not_queued",
          );
          const actor = this.#actors.get(row.outboxId);
          if (actor)
            this.policy.require(
              actor,
              "session.send",
              { kind: "session", id: row.sessionId },
              draft,
            );
          else this.policy.requireTaskResultDelivery(current, draft);
          if (target.recipient) {
            requireCondition(
              this.policy.canReadDerived(target.recipient, current, draft),
              "access_denied",
            );
            for (const ref of current.origins ?? [])
              this.policy.require(
                target.recipient,
                `${ref.kind}.read`,
                ref,
                draft,
              );
            const binding = draft.sessions[row.sessionId];
            binding.origins = [
              ...new Map(
                [...(binding.origins ?? []), ...(current.origins ?? [])].map(
                  (ref) => [JSON.stringify(ref), ref],
                ),
              ).values(),
            ];
          }
          current.state = "admitting";
          delete current.error;
          return null;
        },
      );
      await this.#authorize(row);
      this.#fenceTarget(row, target);
      nativeAdmission = true;
      if (target.ordinary) {
        const controller = this.adapter.context.get("sessionController");
        requireCondition(controller, "native_controller_unavailable");
        await controller.prompt(
          {
            requestId: row.message.id,
            sessionId: row.sessionId,
            mode: row.mode,
            content: row.message.content,
          },
          this.#lifetime.signal,
        );
        const live = this.adapter.context.sessions.get(row.sessionId);
        requireCondition(live, "native_session_unavailable");
        await this.adapter.context.sessions.flush(live);
      } else {
        target.agent[row.mode === "steer" ? "steer" : "followup"](row.message);
        await this.adapter.context.sessions.flush(target.agent.session);
      }
      return await this.reconcileDelivery(row.outboxId);
    } catch (error) {
      await this.store
        .transact(
          {
            operationId: randomUUID(),
            action: "outbox.failed",
            input: { outboxId: row.outboxId, reason: error.code ?? error.name },
          },
          (draft) => {
            draft.outbox[row.outboxId].state = nativeAdmission
              ? "UNKNOWN"
              : "blocked";
            draft.outbox[row.outboxId].nativeAdmission = nativeAdmission;
            draft.outbox[row.outboxId].error = error.code ?? error.name;
            return null;
          },
        )
        .catch(() => {});
      return this.store.read().outbox[row.outboxId];
    }
  }
  async reconcileDelivery(outboxId) {
    const row = this.store.read().outbox[outboxId];
    requireCondition(row, "not_found");
    if (["accepted", "available", "blocked"].includes(row.state)) return row;
    const history = await this.adapter.readNative(row.sessionId);
    const evidence = history.events.find(
      (event) =>
        (event.type === "user/message" &&
          (event.data.id === row.message.id ||
            event.data.source?.rpcId === row.message.id)) ||
        (event.type === "agent/inbox/spliced" &&
          event.data.inserted.some(
            (message) =>
              message.id === row.message.id ||
              message.source?.rpcId === row.message.id,
          )),
    );
    return this.store.transact(
      {
        operationId: randomUUID(),
        action: "outbox.reconcile",
        input: { outboxId, eventSeq: evidence?.seq ?? null },
      },
      (draft) => {
        const current = draft.outbox[outboxId];
        current.state = evidence ? "accepted" : "UNKNOWN";
        current.nativeEvidence = evidence
          ? {
              sessionId: row.sessionId,
              eventSeq: evidence.seq,
              originalMessageId: row.message.id,
            }
          : null;
        return current;
      },
    );
  }
  async reconcile(actor, command) {
    command = copy(command);
    this.policy.actorKey(actor);
    const row = this.store.read().outbox[command.input.outboxId];
    requireCondition(row, "not_found");
    requireCondition(
      actor.kind === "human" ||
        (row.botId === actor.botId && this.policy.canReadDerived(actor, row)),
      "access_denied",
    );
    if (row.sessionId)
      this.policy.require(actor, "session.read", {
        kind: "session",
        id: row.sessionId,
      });
    const result =
      row.state === "blocked" && row.nativeAdmission === false
        ? await this.deliver(row.outboxId)
        : await this.reconcileDelivery(row.outboxId);
    requireCondition(
      actor.kind === "human" || this.policy.canReadDerived(actor, result),
      "access_denied",
    );
    return result;
  }
  async close() {
    this.#closed = true;
    this.#lifetime.abort();
    await Promise.allSettled([...this.#deliveries.values()]);
    this.#actors.clear();
  }
}
