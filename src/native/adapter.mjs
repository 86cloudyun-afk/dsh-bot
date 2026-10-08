import { installModelSelection } from "@deepseek-ai/dsh-agent";
import {
  childSessionMeta,
  resolveChildDepth,
  captureDelegatedPolicyOverrides,
  appendDelegatedPolicyOverrides,
} from "@deepseek-ai/dsh-subagent";
import { NativeWorkChildren } from "./child.mjs";
import {commandNames, botToolDescription} from "./commands.mjs";
import {
  createUserMessage,
  callConfigEquals,
  isAgentLoopRequest,
} from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { copy, plain, requireCondition } from "./store.mjs";

/** Thin public-service adapter. No host copies, private drivers or global defaults. */
export class NativeDshAdapter {
  runtimeId = randomUUID();
  #ctx;
  #store;
  #policy;
  #handles = new Map();
  #creating = new Map();
  #closed = false;
  #closing = false;
  #contextProvider;
  #service;
  #records = new Map();
  #disposers = [];
  #shortPools = new Map();
  #children;
  #activity = new Map();
  constructor(ctx, { store, policy } = {}) {
    this.#ctx = ctx;
    this.#store = store;
    this.#policy = policy;
    this.#disposers.push(
      ctx.on(
        "agent/created",
        async ({ agent, source }) => {
          const state = this.#store?.read(),
            binding = state?.sessions[agent.id],
            initiator = ctx.agents.currentInitiator(),
            parentId = agent.session.header.parentSession;
          const causalBot =
            state?.sessions[parentId]?.botId ??
            state?.sessions[initiator?.id]?.botId;
          if (causalBot)
            requireCondition(
              binding?.botId &&
                (!parentId ||
                  (binding.attemptId &&
                    state.attempts[binding.attemptId]?.reservationHeld)),
              "work_admission_required",
            );
          if (binding?.botId && this.#records.get(agent.id)?.agent !== agent) {
            await this.bindAgent(agent, binding);
            if (source === "resume" && ctx.get("sessionController"))
              this.#records.get(agent.id).nativeControllerRestore = true;
          }
        },
        { global: true },
      ),
    );
    this.#disposers.push(
      ctx.on(
        "session/event",
        (session, event) => {
          if (["turn/start", "turn/end"].includes(event.type)) {
            const agent = ctx.agents.get(session.id),
              prior = this.#activity.get(session.id);
            if (agent?.session === session) {
              if (event.type === "turn/start")
                this.#activity.set(session.id, {
                  agent,
                  turn: event.data.turn,
                  token: randomUUID(),
                  active: true,
                });
              else if (prior?.agent === agent && prior.turn === event.data.turn)
                prior.active = false;
            }
          }
          if (event.type !== "model/selection") return;
          const binding = this.#store?.read().sessions[session.id];
          if (!binding?.botId) return;
          const record = this.#records.get(session.id);
          if (record?.agent.session === session)
            record.uiIntent = copy(event.data);
          void this.#store
            .transact(
              {
                operationId: randomUUID(),
                action: "session.model-intent",
                input: {
                  sessionId: session.id,
                  seq: event.seq,
                  selection: copy(event.data),
                },
              },
              (draft) => {
                const row = draft.sessions[session.id];
                if (row.epoch === binding.epoch)
                  row.uiModelIntent = copy(event.data);
                return null;
              },
            )
            .catch(() => {
              if (record) record.uiIntentUnknown = true;
            });
        },
        { global: true },
      ),
    );
    const adapter = this;
    this.#disposers.push(
      ctx.on(
        "llm/stream",
        async function* (options, next) {
          const binding = adapter.#store?.read().sessions[options.sessionId];
          if (!binding?.botId) {
            yield* next();
            return;
          }
          const record = adapter.#records.get(options.sessionId);
          adapter.#authorize(record);
          requireCondition(
            options.signal &&
              (isAgentLoopRequest(options) ||
                ["compaction", "session-title"].includes(options.purpose)),
            "unbound_request",
          );
          if (isAgentLoopRequest(options)) {
            requireCondition(
              record.requestSignals.has(options.signal),
              "request_identity_mismatch",
            );
            requireCondition(
              callConfigEquals(record.model, options),
              "model_drift",
            );
          }
          if (binding.requestLimit !== undefined)
            requireCondition(
              record.requests.length < binding.requestLimit,
              "round_budget_exhausted",
            );
          const request = {
            usage: "UNKNOWN",
            purpose: options.purpose ?? "conversation",
            submitted: false,
          };
          record.models.add(request);
          let release;
          try {
            if (binding.purpose !== "execution")
              release = await adapter.#shortRound(
                binding.botId,
                options.sessionId,
                options.signal,
              );
            adapter.#authorize(record);
            options.signal.throwIfAborted();
            await adapter.#admitBoundedRequest(binding);
            adapter.#authorize(record);
            options.signal.throwIfAborted();
            request.submitted = true;
            request.startedAt = Date.now();
            for await (const chunk of next()) {
              adapter.#authorize(record);
              if (chunk.type === "usage") request.usage = copy(chunk.usage);
              yield chunk;
            }
          } finally {
            release?.();
            record.models.delete(request);
            if (request.submitted) record.requests.push(request);
          }
        },
        { global: true },
      ),
    );
  }
  async #admitBoundedRequest(binding) {
    const lineage = binding.lineage;
    if (!lineage?.meetingId && !lineage?.roundId) return;
    await this.#store.transact(
      {
        operationId: randomUUID(),
        action: "collaboration.request-admitted",
        input: { sessionId: binding.sessionId },
      },
      (draft) => {
        this.#authorize(this.#records.get(binding.sessionId), { state: draft });
        const record = lineage.meetingId
          ? draft.meetings[lineage.meetingId]
          : draft.groups[lineage.groupId]?.rounds[lineage.roundId];
        requireCondition(
          record && record.requests < record.maxRequests,
          "round_budget_exhausted",
        );
        record.requests++;
        return null;
      },
    );
  }
  #shortRound(botId, sessionId, signal) {
    const pool = this.#shortPools.get(botId) ?? {
      active: 0,
      queue: [],
      last: null,
    };
    this.#shortPools.set(botId, pool);
    requireCondition(pool.queue.length < 64, "short_queue_full");
    return new Promise((resolve, reject) => {
      const entry = { sessionId, resolve, reject, signal };
      entry.abort = () => {
        const index = pool.queue.indexOf(entry);
        if (index >= 0) {
          pool.queue.splice(index, 1);
          reject(signal.reason);
        }
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      pool.queue.push(entry);
      if (signal.aborted) entry.abort();
      this.#pumpShort(pool);
    });
  }
  #pumpShort(pool) {
    while (pool.active < 2 && pool.queue.length) {
      const index = pool.queue.findIndex(
          (entry) => entry.sessionId !== pool.last,
        ),
        entry = pool.queue.splice(index < 0 ? 0 : index, 1)[0];
      entry.signal.removeEventListener("abort", entry.abort);
      pool.active++;
      pool.last = entry.sessionId;
      let released = false;
      entry.resolve(() => {
        if (!released) {
          released = true;
          pool.active--;
          this.#pumpShort(pool);
        }
      });
    }
  }
  get context() {
    return this.#ctx;
  }
  isArchived(sessionId) {
    const registry = this.#ctx.get("workspaceRegistry");
    return registry
      ? registry.archivedSessionIds.includes(sessionId)
      : this.#store.read().sessions[sessionId]?.archived === true;
  }
  setContextProvider(provider) {
    this.#contextProvider = provider;
  }
  setService(service) {
    this.#service = service;
  }
  #authorize(
    record,
    { ignoreModelIntent = false, state = this.#store.read() } = {},
  ) {
    requireCondition(
      !this.#closed && !this.#closing && record && !record.closed,
      "disabled",
    );
    const binding = state.sessions[record.agent.id],
      bot = state.bots[binding?.botId];
    requireCondition(
      this.#ctx.agents.get(record.agent.id) === record.agent &&
        binding?.epoch === record.binding.epoch &&
        binding.state === "ready" &&
        !this.isArchived(record.agent.id) &&
        bot?.lifecycle === "active",
      "stale_agent",
    );
    const intent = record.uiIntent ?? binding.uiModelIntent;
    if (!ignoreModelIntent && intent)
      requireCondition(
        intent.provider === record.model.provider &&
          intent.model === record.model.model &&
          intent.reasoningEffort === record.model.reasoningEffort,
        "model_drift",
      );
    requireCondition(!record.uiIntentUnknown, "recovery_required");
    const lineage = binding.lineage;
    if (lineage?.meetingId) {
      const meeting = state.meetings[lineage.meetingId],
        participant = meeting?.participants?.find(
          (row) => row.botId === binding.botId,
        ),
        member = state.groups[meeting?.groupId]?.members?.find(
          (row) => row.botId === binding.botId,
        );
      requireCondition(
        meeting?.epoch === lineage.epoch &&
          meeting.phase === lineage.phase &&
          participant?.active &&
          participant.sessionId === binding.sessionId &&
          participant.memberEpoch === lineage.memberEpoch &&
          member?.active &&
          member.epoch === lineage.memberEpoch,
        "stale_meeting",
      );
    } else if (lineage?.groupId) {
      const group = state.groups[lineage.groupId],
        member = group?.members?.find((row) => row.botId === binding.botId);
      requireCondition(
        member?.active &&
          member.epoch === lineage.memberEpoch &&
          group.rounds[lineage.roundId]?.state === "running",
        "stale_group",
      );
    }
    const actor = this.#policy.fromAgent(record.agent);
    for (const reference of [
      ...(binding.origins ?? []),
      ...this.#policy.readDependencies(actor),
    ])
      this.#policy.require(actor, `${reference.kind}.read`, reference, state);
    if (binding.attemptId) {
      const attempt = state.attempts[binding.attemptId];
      requireCondition(
        attempt?.reservationHeld &&
          attempt.epoch === binding.epoch &&
          ["starting", "running"].includes(attempt.state),
        "stale_attempt",
      );
    }
    return actor;
  }
  async bindAgent(agent, binding) {
    if (this.#records.get(agent.id)?.agent === agent) return;
    requireCondition(
      !this.#closed &&
        !this.isArchived(binding.sessionId) &&
        ["creating", "ready"].includes(binding.state),
      "session_not_ready",
    );
    const record = {
      agent,
      binding: copy(binding),
      model: copy(binding.model),
      selection: { current: Object.freeze(copy(binding.model)) },
      requestSignals: new WeakSet(),
      models: new Set(),
      tools: new Set(),
      requests: [],
      outputs: new Map(),
      disposers: [],
      closed: false,
      turn: null,
      previousContext: null,
    };
    this.#records.set(agent.id, record);
    const own = (disposer) => {
      let active = true;
      const release = () => {
        if (active) {
          active = false;
          return disposer();
        }
      };
      record.disposers.push(release);
      return release;
    };
    own(
      agent.ctx.on(
        "system-prompt/assemble",
        async (_assembly, context, next) => {
          requireCondition(
            context.agent === agent && context.signal,
            "request_identity_mismatch",
          );
          if (context.signal !== record.assemblySignal) {
            this.#authorize(record, {
              ignoreModelIntent: binding.purpose === "contact",
            });
            if (binding.purpose === "contact")
              record.model = await this.validateModel(
                this.#store.read().bots[binding.botId].contact,
              );
            record.selection.current = Object.freeze(copy(record.model));
            record.assemblySignal = context.signal;
          }
          this.#authorize(record);
          context.signal.throwIfAborted();
          const assembly = await next();
          return {
            ...assembly,
            variables: {
              ...assembly.variables,
              provider: record.model.provider,
              model: record.model.model,
            },
          };
        },
        { prepend: true },
      ),
    );
    own(installModelSelection(agent.ctx, record.selection));
    own(
      agent.ctx.on("agent/pre-step", async (payload, next) => {
        const actor = this.#authorize(record, {
            ignoreModelIntent:
              payload.turn !== record.turn && binding.purpose === "contact",
          }),
          decision = await next();
        if (decision.kind === "reject") return decision;
        if (binding.attemptId)
          requireCondition(
            payload.messages.every((message) => {
              if (message.source?.kind === "dsh-bot-task")
                return message.source.attemptId === binding.attemptId;
              if (message.source?.kind !== "dsh-bot-result") return false;
              const state = this.#store.read(),
                row = state.outbox[message.source.outboxId],
                child = state.attempts[message.source.attemptId];
              return (
                row?.kind === "result" &&
                row.sessionId === agent.id &&
                row.message.id === message.id &&
                child?.parentAttemptId === binding.attemptId &&
                child.resultOutboxId === row.outboxId
              );
            }),
            "task_adjust_required",
          );
        if (payload.turn !== record.turn) {
          record.turn = payload.turn;
        }
        this.#authorize(record);
        payload.signal.throwIfAborted();
        if (!this.#contextProvider) return decision;
        const context = await this.#contextProvider(
          agent,
          this.#store.read().sessions[agent.id],
        );
        if (context === record.previousContext) return decision;
        record.previousContext = context;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: "text", text: context }],
              source: { kind: "dsh-bot-context", botId: binding.botId },
            }),
          ],
        };
      }),
    );
    own(
      agent.ctx.on(
        "agent/request",
        async (payload, next) => {
          this.#authorize(record);
          requireCondition(
            payload.agent === agent,
            "request_identity_mismatch",
          );
          const config = await next();
          const nativeRoutes = record.nativeControllerRestore
            ? [
                agent.session.requestHeader()?.config,
                this.#ctx.get("agentDefaultModel")?.currentSelection(),
              ].filter(Boolean)
            : [];
          requireCondition(
            (config.provider === record.model.provider &&
              config.model === record.model.model) ||
              nativeRoutes.some(
                (route) =>
                  route.provider === config.provider &&
                  route.model === config.model,
              ),
            "model_drift",
          );
          const effective = await this.#ctx.llm.resolveCallConfig(
            copy(record.model),
            payload.signal,
          );
          this.#authorize(record);
          requireCondition(
            callConfigEquals(record.model, effective),
            "model_drift",
          );
          record.requestSignals.add(payload.signal);
          return copy(record.model);
        },
        { prepend: true },
      ),
    );
    own(
      agent.ctx.tools.guard((exec) => {
        try {
          requireCondition(exec.agent === agent, "execution_identity_mismatch");
          this.#authorize(record);
          const bot = this.#store.read().bots[binding.botId];
          if (binding.purpose === "independent" && exec.name === "dsh_bot")
            requireCondition(
              [
                "help",
                "snapshot",
                "session.page",
                "session.list",
                "memory.search",
                "memory.write",
                "meeting.opinion",
              ].includes(exec.arguments?.action),
              "sealed_channel",
            );
          if (exec.name !== "dsh_bot")
            requireCondition(
              binding.purpose !== "independent" &&
                (bot.capabilities ?? []).includes(exec.name) &&
                ![
                  "subagent",
                  "plugin_manager",
                  "cordis_inspect",
                  "session_manager",
                ].includes(exec.name),
              "capability_denied",
            );
        } catch (error) {
          return error.code ?? error.message;
        }
      }),
    );
    own(
      agent.ctx.on("tools/execute", async (exec, next) => {
        this.#authorize(record);
        requireCondition(exec.agent === agent, "execution_identity_mismatch");
        record.tools.add(exec.token);
        try {
          return await next();
        } finally {
          record.tools.delete(exec.token);
        }
      }),
    );
    if (this.#service) {
      own(
        agent.ctx.tools.register({
          name: "dsh_bot",
          description: botToolDescription,
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: commandNames },
              input: { type: "object", description: "动作输入；先用 help 查询所需字段及示例。" },
              operationId: { type: "string", description: "写动作必需；每个新动作使用不同唯一 ID，未知动作保留原请求。只读查询可省略。" },
              expectedRevision: { type: "integer" },
            },
            required: ["action"],
            additionalProperties: false,
          },
          output: {
            schema: {
              type: "object",
              properties: { receiptId: { type: "string" } },
              required: ["receiptId"],
              additionalProperties: false,
            },
            render: (_args, value) => [
              {
                type: "text",
                text: JSON.stringify(
                  record.outputs.get(value.receiptId) ?? {
                    error: "publication_unavailable",
                  },
                ),
              },
            ],
          },
          execute: async (args, exec) => {
            const actor = this.#service.resolveCaller(exec);
            this.#authorize(record);
            const dto = await this.#service.dispatch(actor, args, exec.signal),
              receiptId = randomUUID();
            record.outputs.set(receiptId, dto);
            return { receiptId };
          },
          finalizeContent: (_exec, result) => {
            record.outputs.delete(result.value?.receiptId);
            try {
              this.#authorize(record);
              return result.content;
            } catch (error) {
              return [
                {
                  type: "text",
                  text: `结果发布被拒绝：${error.code ?? "access_denied"}`,
                },
              ];
            }
          },
        }),
      );
    }
  }
  async models() {
    const providers = this.#ctx.llm.listProviders();
    const nativeTools = [
      ...new Set(
        [undefined, ...this.#ctx.agents.list()].flatMap((scope) =>
          this.#ctx.tools.schemas(scope).map((tool) => tool.name),
        ),
      ),
    ]
      .filter(
        (name) =>
          ![
            "dsh_bot",
            "subagent",
            "plugin_manager",
            "cordis_inspect",
            "session_manager",
          ].includes(name),
      )
      .sort();
    return {
      nativeTools,
      providers: await Promise.all(
        providers.map(async (provider) => ({
          ...copy(provider),
          models: await this.#ctx.llm.listModels(provider.id),
        })),
      ),
    };
  }
  async validateModel(input) {
    requireCondition(
      plain(input) &&
        typeof input.provider === "string" &&
        typeof input.model === "string" &&
        Object.keys(input).every((key) =>
          [
            "provider",
            "model",
            "reasoningEffort",
            "maxTokens",
            "temperature",
          ].includes(key),
        ),
      "invalid_model",
    );
    const catalog = await this.#ctx.llm.listModels(input.provider);
    requireCondition(
      catalog.some((model) => model.id === input.model),
      "model_unavailable",
    );
    const resolved = await this.#ctx.llm.resolveCallConfig(copy(input));
    return copy(resolved);
  }
  async validateLocation(cwd) {
    requireCondition(typeof cwd === "string" && isAbsolute(cwd), "invalid_cwd");
    const path = await realpath(cwd);
    requireCondition((await stat(path)).isDirectory(), "invalid_cwd");
    return path;
  }
  async createOwned(binding, setup) {
    requireCondition(!this.#closed, "disposed");
    if (this.#handles.has(binding.sessionId))
      return this.#handles.get(binding.sessionId);
    if (this.#creating.has(binding.sessionId))
      return this.#creating.get(binding.sessionId);
    const operation = (async () => {
      const parent = binding.parentSessionId
        ? this.#ctx.agents.get(binding.parentSessionId)
        : null;
      requireCondition(!binding.parentSessionId || parent, "parent_not_active");
      let handle;
      if (parent) {
        requireCondition(
          this.#ctx.get("subagents"),
          "native_subagent_unavailable",
        );
        this.#children ??= new NativeWorkChildren(this.#ctx, {
          create: (...args) => this.#createHandle(...args),
          stop: (id) => this.stopResources(id),
        });
        handle = await this.#children.create(binding, parent, setup);
      } else handle = await this.#createHandle(binding, setup);
      try {
        requireCondition(!this.#closed, "disposed");
        await this.#ctx.sessions.flush(handle.agent.session);
        const registry = this.#ctx.get("workspaceRegistry");
        if (registry && binding.purpose === "contact")
          await (
            await registry.create(binding.cwd)
          ).attachSession(binding.sessionId);
        this.#handles.set(binding.sessionId, handle);
        return handle;
      } catch (error) {
        await handle.dispose();
        throw error;
      }
    })();
    this.#creating.set(binding.sessionId, operation);
    try {
      return await operation;
    } finally {
      this.#creating.delete(binding.sessionId);
    }
  }
  async #createHandle(binding, setup, { parent, descriptor, signal } = {}) {
    const model = copy(binding.model),
      presets = this.#ctx.get("agentPresets");
    return this.#ctx.agents.create({
      sessionId: binding.sessionId,
      ...(parent ? { parentAgent: parent } : {}),
      ...(signal ? { signal } : {}),
      meta: {
        cwd: binding.cwd,
        ...(binding.presetId ? { agentPreset: binding.presetId } : {}),
        ...(parent
          ? childSessionMeta(parent, resolveChildDepth(parent, 1), false)
          : {}),
      },
      agentOptions: {
        provider: model.provider,
        model: model.model,
        ...(model.maxTokens === undefined
          ? {}
          : { maxTokens: model.maxTokens }),
      },
      setup: async (agentCtx, agent) => {
        if (parent)
          appendDelegatedPolicyOverrides(
            agent.session,
            captureDelegatedPolicyOverrides(parent),
          );
        if (descriptor) {
          let appended = false;
          agentCtx.on("agent/pre-step", async (_payload, next) => {
            const decision = await next();
            if (!appended && decision.kind === "enter") {
              appended = true;
              agent.session.append("subagent/descriptor", descriptor);
            }
            return decision;
          });
        }
        if (presets)
          await presets.mount(agentCtx, binding.presetId ?? undefined);
        await this.bindAgent(agent, binding);
        await setup?.(agentCtx, agent);
      },
    });
  }
  async resumeOwned(binding) {
    requireCondition(
      !this.#closed &&
        binding.state === "ready" &&
        !this.isArchived(binding.sessionId),
      "session_not_ready",
    );
    const live = this.#ctx.agents.get(binding.sessionId);
    if (live) return live;
    if (this.#creating.has(binding.sessionId))
      return (await this.#creating.get(binding.sessionId)).agent;
    const pending = this.#ctx.agents.resume({
      resumeSessionId: binding.sessionId,
      agentOptions: {
        provider: binding.model.provider,
        model: binding.model.model,
      },
      setup: async (agentCtx, agent) => {
        const presets = this.#ctx.get("agentPresets");
        if (presets)
          await presets.mount(agentCtx, binding.presetId ?? undefined);
        await this.bindAgent(agent, binding);
      },
    });
    this.#creating.set(binding.sessionId, pending);
    try {
      const handle = await pending;
      this.#handles.set(binding.sessionId, handle);
      return handle.agent;
    } finally {
      this.#creating.delete(binding.sessionId);
    }
  }
  async readNative(sessionId, signal) {
    const handle = await this.#ctx.sessionPersistence.open(sessionId, "read");
    try {
      const { events } = await handle.read(0, undefined, { signal });
      return {
        header: copy(handle.header),
        events: copy(events),
        original: true,
      };
    } finally {
      await handle.close();
    }
  }
  async replyActivity(sessionId) {
    const agent = this.#ctx.agents.get(sessionId);
    if (!agent || agent.status !== "running") return null;
    let activity = this.#activity.get(sessionId);
    if (activity?.agent !== agent) {
      await this.#ctx.sessions.flush(agent.session);
      const history = await this.readNative(sessionId);
      activity = this.#activity.get(sessionId);
      if (
        activity?.agent !== agent &&
        this.#ctx.agents.get(sessionId) === agent
      ) {
        let turn = null;
        for (const event of history.events) {
          if (event.type === "turn/start") turn = event.data.turn;
          if (event.type === "turn/end" && event.data.turn === turn)
            turn = null;
        }
        if (turn !== null) {
          activity = { agent, turn, token: randomUUID(), active: true };
          this.#activity.set(sessionId, activity);
        }
      }
    }
    return activity?.agent === agent &&
      activity.active &&
      agent.status === "running"
      ? { turn: activity.turn, token: activity.token }
      : null;
  }
  stopReply(sessionId, token) {
    const activity = this.#activity.get(sessionId),
      agent = this.#ctx.agents.get(sessionId);
    requireCondition(
      activity?.agent === agent &&
        activity?.active &&
        activity.token === token &&
        agent?.status === "running",
      "stale_turn",
    );
    requireCondition(!agent.session.header.parentSession, "task_stop_required");
    // Keep the native queue. Execution attempts use their separate resource stop.
    agent.cancel({ kind: "user" }, { keepInbox: true });
    return { sessionId, accepted: true, turn: activity.turn };
  }
  async listNative(_request = {}, signal) {
    signal?.throwIfAborted();
    const rows = await this.#ctx.sessionPersistence.list(),
      list = new Map(
        rows.map((row) => [
          row.header.id,
          { sessionId: row.header.id, header: copy(row.header) },
        ]),
      );
    for (const session of this.#ctx.sessions.list())
      if (!list.has(session.id))
        list.set(session.id, {
          sessionId: session.id,
          header: copy(session.header),
        });
    return [...list.values()];
  }
  async disposeOwned(sessionId) {
    const handle = this.#handles.get(sessionId);
    if (!handle) return;
    try {
      await handle.dispose();
    } catch (error) {
      const record = this.#records.get(sessionId);
      if (record) {
        record.resourceFaults ??= [];
        record.resourceFaults.push({
          kind: "owned-disposal",
          error: error.code ?? error.name,
        });
      }
      throw error;
    }
    this.#handles.delete(sessionId);
    const record = this.#records.get(sessionId);
    if (record?.agent === handle.agent) record.disposed = true;
  }
  async quiesce(sessionId) {
    const record = this.#records.get(sessionId);
    requireCondition(record, "resource_identity_unknown");
    await record.agent.whenIdle();
    return this.resources(sessionId);
  }
  async stopResources(sessionId) {
    const record = this.#records.get(sessionId);
    requireCondition(record, "resource_identity_unknown");
    record.stopPending = (record.stopPending ?? 0) + 1;
    try {
      record.agent.cancel({ kind: "user" });
      const jobs = this.#ctx.get("jobs"),
        terminals = this.#ctx.get("terminals"),
        pending = [];
      if (jobs)
        for (const job of jobs
          .list(sessionId)
          .filter(
            (row) =>
              row.owner === sessionId &&
              ["running", "stopping"].includes(row.status),
          )) {
          try {
            jobs.kill(job.id, sessionId, "dsh-bot stop");
            pending.push(jobs.wait(job.id, 10000, sessionId));
          } catch (error) {
            record.resourceFaults ??= [];
            record.resourceFaults.push({
              jobId: job.id,
              error: error.code ?? error.name,
            });
          }
        }
      if (terminals)
        for (const terminal of terminals.list(record.agent))
          pending.push(
            terminals.kill(record.agent, terminal.sessionId, "dsh-bot stop"),
          );
      const subagents = this.#ctx.get("subagents");
      if (subagents)
        pending.push(subagents.drainContinuableDescendants([record.agent]));
      const outcomes = await Promise.allSettled(pending);
      for (const outcome of outcomes)
        if (outcome.status === "rejected") {
          record.resourceFaults ??= [];
          record.resourceFaults.push({
            error:
              outcome.reason?.code ??
              outcome.reason?.name ??
              "resource_stop_failed",
          });
        }
      await record.agent.whenIdle();
    } catch (error) {
      record.resourceFaults ??= [];
      record.resourceFaults.push({ error: error.code ?? error.name });
      throw error;
    } finally {
      record.stopPending--;
    }
  }
  resources(sessionId) {
    const record = this.#records.get(sessionId);
    if (!record) return { known: false, settled: false };
    const jobs =
      this.#ctx
        .get("jobs")
        ?.list(sessionId)
        .filter((row) => row.owner === sessionId) ?? [];
    const terminals = this.#ctx.get("terminals");
    return {
      known: true,
      settled:
        (record.disposed || record.agent.status === "idle") &&
        !record.stopPending &&
        record.models.size === 0 &&
        record.tools.size === 0 &&
        !jobs.some((row) => ["running", "stopping"].includes(row.status)) &&
        !terminals?.hasOwnerActivity(record.agent) &&
        !record.resourceFaults?.length,
      models: record.models.size,
      tools: record.tools.size,
      jobs: copy(jobs),
      requests: copy(record.requests),
      terminalActive: !!terminals?.hasOwnerActivity(record.agent),
      resourceFaults: copy(record.resourceFaults ?? []),
    };
  }
  async close() {
    if (this.#closed || this.#closing) return;
    this.#closing = true;
    await Promise.allSettled([...this.#creating.values()]);
    await Promise.allSettled(
      [...this.#records.values()]
        .filter(
          (record) => this.#ctx.agents.get(record.agent.id) === record.agent,
        )
        .map((record) => this.stopResources(record.agent.id)),
    );
    await Promise.allSettled(
      [...this.#handles.keys()].map((id) => this.disposeOwned(id)),
    );
    if (this.#store)
      for (const record of this.#records.values()) {
        const evidence = this.resources(record.agent.id);
        if (!evidence.settled)
          await this.#store.transact(
            {
              operationId: randomUUID(),
              action: "session.shutdown-unknown",
              input: { sessionId: record.agent.id, runtimeId: this.runtimeId },
            },
            (draft) => {
              const binding = draft.sessions[record.agent.id];
              if (binding) {
                binding.state = "UNKNOWN";
                binding.error = "shutdown_resources_unsettled";
                binding.resourceEvidence = copy(evidence);
              }
              return null;
            },
          );
      }
    await Promise.allSettled(
      [...this.#records.values()].map((record) => record.agent.whenIdle()),
    );
    await this.#children?.close();
    this.#closed = true;
    for (const record of this.#records.values()) {
      record.closed = true;
      for (const dispose of record.disposers.splice(0).reverse())
        await dispose();
    }
    for (const dispose of this.#disposers.splice(0).reverse()) await dispose();
  }
}
