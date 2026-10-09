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
  async create(actor, command) {
    command = copy(command);
    const input = command.input;
    requireCondition(
      plain(input) &&
        Object.keys(input).every((key) => ["botId", "purpose"].includes(key)),
      "invalid_input",
    );
    requireCondition(
      (input.purpose ?? "contact") === "contact",
      "invalid_purpose",
    );
    const stamped = this.policy.command(actor, command);
    const intent = await this.store.transact(stamped, (draft) => {
      const bot = draft.bots[input.botId];
      requireCondition(bot, "not_found");
      requireCondition(!bot.deletedAt, "bot_deleted");
      requireCondition(bot.lifecycle === "active", "bot_not_active");
      const sessionId = randomUUID(),
        purpose = input.purpose ?? "contact";
      const binding = {
        sessionId,
        botId: bot.botId,
        purpose,
        model: copy(purpose === "execution" ? bot.execution : bot.contact),
        cwd: bot.cwd,
        presetId: bot.presetId,
        configRevision: bot.configRevision,
        epoch: 1,
        state: "creating",
        ownerRuntimeId: this.adapter.runtimeId,
        archived: false,
        operationId: command.operationId,
        statusOperationId: randomUUID(),
      };
      draft.sessions[sessionId] = binding;
      this.policy.require(
        actor,
        "session.create",
        { kind: "session", id: sessionId },
        draft,
      );
      return binding;
    });
    const current = this.store.read().sessions[intent.sessionId];
    if (current.state === "ready") return current;
    requireCondition(current.state === "creating", "session_outcome_unknown");
    if (this.#opening.has(intent.sessionId))
      return this.#opening.get(intent.sessionId);
    const opening = (async () => {
      try {
        await this.adapter.createOwned(current);
        const ready = await this.store.transact(
          {
            operationId: current.statusOperationId,
            action: "session.ready",
            input: { sessionId: current.sessionId },
          },
          (draft) => {
            this.policy.require(
              actor,
              "session.create",
              { kind: "session", id: current.sessionId },
              draft,
            );
            const binding = draft.sessions[current.sessionId];
            binding.state = "ready";
            return binding;
          },
        );
        return ready;
      } catch (error) {
        await this.store
          .transact(
            {
              operationId: `unknown-${current.statusOperationId}`,
              action: "session.unknown",
              input: { sessionId: current.sessionId },
            },
            (draft) => {
              const row = draft.sessions[current.sessionId];
              row.state = "UNKNOWN";
              row.error = error.code ?? error.name;
              return null;
            },
          )
          .catch(() => {});
        throw error;
      }
    })();
    this.#opening.set(current.sessionId, opening);
    try {
      return await opening;
    } finally {
      this.#opening.delete(current.sessionId);
    }
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
