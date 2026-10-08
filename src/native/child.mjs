import { copy, requireCondition } from "./store.mjs";

/** An actual public subagent provider for already-admitted plugin work. */
export class NativeWorkChildren {
  #ctx;
  #create;
  #stop;
  #intents = new WeakMap();
  #lifetime = new AbortController();
  #unregister;
  constructor(ctx, { create, stop }) {
    this.#ctx = ctx;
    this.#create = create;
    this.#stop = stop;
    this.#unregister = ctx.subagents.registerProvider({
      name: "dsh-bot-work",
      inheritsParentContext: false,
      capabilities: {
        agentOptions: true,
        depthLimit: true,
        outputSchema: false,
        toolFilter: false,
        persona: false,
      },
      start: (request) => this.#start(request),
    });
  }
  async create(binding, parent, setup) {
    const prompt = [];
    this.#intents.set(prompt, { binding: copy(binding), parent, setup });
    try {
      const run = await this.#ctx.subagents.start("dsh-bot-work", {
        parent,
        prompt,
        label: `工作 ${binding.attemptId}`,
        agentOptions: copy(binding.model),
        maxDepth: 1,
        signal: this.#lifetime.signal,
      });
      return { agent: run.localAgent, dispose: () => run.dispose() };
    } finally {
      this.#intents.delete(prompt);
    }
  }
  async #start(request) {
    const intent = this.#intents.get(request.prompt);
    requireCondition(
      intent &&
        intent.parent === request.parent &&
        this.#ctx.agents.get(request.parent.id) === request.parent,
      "work_admission_required",
    );
    request.signal.throwIfAborted();
    let handle,
      settled = false,
      resolveResult,
      disposal,
      output = [];
    const result = new Promise((resolve) => {
      resolveResult = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
    });
    const unobserve = this.#ctx.on(
      "session/event",
      (session, event) => {
        if (session.id !== intent.binding.sessionId) return;
        if (event.type === "assistant/message") {
          output = copy(
            event.data.message?.content ?? event.data.content ?? [],
          );
          return;
        }
        if (event.type !== "turn/end") return;
        void handle.agent
          .whenIdle()
          .then(() => {
            resolveResult({
              output: copy(output),
              stopReason:
                event.data.reason.kind === "completed"
                  ? "completed"
                  : event.data.reason.kind === "aborted"
                    ? "aborted"
                    : "error",
            });
          })
          .catch(() => resolveResult({ output: [], stopReason: "error" }));
      },
      { global: true },
    );
    const abort = () => handle?.agent.cancel({ kind: "user" });
    try {
      handle = await this.#create(intent.binding, intent.setup, {
        parent: request.parent,
        descriptor: request.descriptor,
        signal: request.signal,
      });
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      return {
        id: handle.agent.id,
        localAgent: handle.agent,
        result,
        dispose: () =>
          (disposal ??= (async () => {
            try {
              await this.#stop(handle.agent.id);
              await handle.dispose();
              resolveResult({ output: [], stopReason: "aborted" });
            } finally {
              request.signal.removeEventListener("abort", abort);
              await unobserve();
            }
          })()),
      };
    } catch (error) {
      await unobserve();
      await handle?.dispose();
      resolveResult({ output: [], stopReason: "error" });
      throw error;
    }
  }
  async close() {
    this.#lifetime.abort();
    await this.#unregister?.();
  }
}
