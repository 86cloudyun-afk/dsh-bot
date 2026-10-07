/** Native Session consumer: real inbox/loop/receipts with provider-owned guarded calls. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { isNativeAgentHandle, isProtectedNativeRequest } from '@deepseek-ai/dsh-agent-loop'
import { assembleAssistantStream, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DeepSeekProviderFactory, DeepSeekDispatchInput } from '@deepseek-ai/dsh-llm-deepseek'
import { isDeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek'
import { SessionId, deriveEventMessage } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'
import type { NativeRunHost } from './journal.ts'
import type { NativeControlId, NativeOperation, NativeOperationId, NativeSessionReceipt, NativeTarget, NativeTargetId } from './types.ts'
import { canonical, digest, reject, textWire, usage } from './values.ts'

const withoutEmptySystem = (messages: readonly RequestMessage[]) => messages.filter(message =>
  !(message.role === 'system' && message.content.every(block => block.type === 'text' && block.text.length === 0)))

interface ActiveRun {
  operation: NativeOperation
  step: number
  startSeq: number
  inputId: string
  done: Promise<NativeOperation>
}
interface BoundRequest { operationId: NativeOperationId; step: number; inputDigest: string; prefixDigest: string }
interface ReceiptProof { operationId: NativeOperationId; step: number; answer: string; usageDigest: string }

/** Private runtime-owner consumer; it does not establish public human authorization. */
export class NativeSessionDriver {
  #handle: AgentHandle | undefined
  #active: ActiveRun | undefined
  #closed = false
  #closing = false
  #history: readonly RequestMessage[] = []
  #historyDigest = ''
  readonly #requests = new WeakMap<GenerateOptions, BoundRequest>()
  readonly #receipts = new WeakMap<NativeSessionReceipt, ReceiptProof>()

  private constructor(private readonly ctx: Context, private readonly host: NativeRunHost,
    private readonly binding: NativeTarget) {}

  /** Create a native owned Session with its exact preset and protection before publication.
   * @param ctx Actual trusted runtime owner context, not a JSON principal.
   * @param host Open exclusive native journal owner.
   * @param targetId Current Session-bound target.
   * @param provider Actual provider-owned opaque factory.
   * @returns Registered native consumer owning its lifecycle handle.
   */
  static createOwned(ctx: Context, host: NativeRunHost, targetId: NativeTargetId,
    provider: DeepSeekProviderFactory): Promise<NativeSessionDriver> {
    return this.#openOwned(ctx, host, targetId, provider, false)
  }
  /** Resume with protection already attached before any reconstructed inbox wake.
   * Unknown journal work remains unexecutable; this method never drives it.
   * @param ctx Actual trusted runtime owner context.
   * @param host Already reopened authoritative journal; missing state cannot be synthesized.
   * @param targetId Exact current Session-bound target.
   * @param provider Actual provider-owned opaque factory.
   * @returns Registered consumer after native persistence reconstruction.
   */
  static resumeOwned(ctx: Context, host: NativeRunHost, targetId: NativeTargetId,
    provider: DeepSeekProviderFactory): Promise<NativeSessionDriver> {
    return this.#openOwned(ctx, host, targetId, provider, true)
  }
  static async #openOwned(ctx: Context, host: NativeRunHost, targetId: NativeTargetId,
    provider: DeepSeekProviderFactory, resume: boolean): Promise<NativeSessionDriver> {
    if (!isDeepSeekProviderFactory(provider, ctx.get('llm'))) reject('NATIVE_PROVIDER_FACTORY_REQUIRED')
    const binding = host.target(ctx.fiber, targetId)
    const session = binding.sessionBinding ?? reject('SESSION_BINDING_REQUIRED')
    if (ctx.get('sessionPersistence') === undefined) reject('NATIVE_PERSISTENCE_REQUIRED')
    const driver = new NativeSessionDriver(ctx, host, binding)
    const calls = provider.protectSession(SessionId(session.sessionId), {
      checkAdmission: (options) => { driver.#bound(options) },
      checkDispatch: (options, wire) => { driver.#dispatch(options, wire) },
      beforeStream: async (options) => {
        driver.#validateRequest(options)
        if (!await ctx.sessions.flush(driver.#agent().session)) reject('NATIVE_PERSISTENCE_REQUIRED')
        driver.#validateRequest(options)
        const active = driver.#active ?? reject('CONTROLLED_PERMIT_REQUIRED')
        driver.#requests.set(options, { operationId: active.operation.id, step: active.step,
          inputDigest: driver.#inputDigest(options), prefixDigest: digest(driver.#agent().session.snapshotEvents()) })
      },
    })
    const setup = async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, session.agentPreset) }
    const options = { agentOptions: { provider: binding.provider, model: binding.model, maxTokens: binding.maxTokens, reasoningEffort: ReasoningEffortId('off') }, protectedModelCalls: calls, setup }
    const handle = resume
      ? await ctx.agents.resume({ ...options, resumeSessionId: SessionId(session.sessionId) })
      : await ctx.agents.create({ ...options, sessionId: SessionId(session.sessionId),
        meta: { cwd: session.cwd, agentPreset: session.agentPreset } })
    driver.#handle = handle
    try {
      driver.validateSessionBinding(binding)
      driver.#history = withoutEmptySystem(handle.agent.session.deriveMessages())
      if (!resume && driver.#history.length !== 0) reject('NATIVE_HISTORY_CONFLICT')
      if (resume) await driver.#restoreHistory()
      driver.#historyDigest = digest(handle.agent.session.snapshotEvents())
      host.registerDriver(driver)
    } catch (error: unknown) { await handle.dispose(); throw error }
    return driver
  }

  /** Prove concrete owned native handle identity, never structural JSON.
   * @returns Whether the exact native factory-returned handle is retained.
   */
  hasNativeOwner(): boolean { return this.#handle !== undefined && isNativeAgentHandle(this.#handle) }

  /** Revalidate the actual Session/preset/tool relationship at each host-owned boundary.
   * @param current Complete operation binding, including native/control versions.
   */
  validateSessionBinding(current: NativeTarget): void {
    const session = current.sessionBinding ?? reject('SESSION_BINDING_REQUIRED')
    const agent = this.#agent()
    if (canonical(session) !== canonical(this.binding.sessionBinding) || current.id !== this.binding.id
      || agent.id !== session.sessionId || agent.session.id !== session.sessionId
      || agent.session.header.cwd !== session.cwd || agent.session.header.agentPreset !== session.agentPreset
      || this.ctx.agents.get(agent.id) !== agent || this.ctx.sessions.get(agent.id) !== agent.session
      || this.ctx.sessionProjections.stateOf(agent.session, 'agentPreset') !== session.agentPreset) reject('NATIVE_SESSION_BINDING_CONFLICT')
    const scope = scopeOf(agent.ctx) ?? reject('NATIVE_SCOPE_REQUIRED')
    if (this.ctx.tools.schemas().length !== 0 || this.ctx.tools.schemas(scope).length !== 0) reject('NATIVE_MODEL_TOOLS_PRESENT')
  }

  /** Claim journal input, then drive actual native turns; unknown state never wakes the Agent.
   * @param caller Exact trusted owner fiber capability accepted by the journal policy.
   * @param operationId Admitted journal-local identity.
   * @returns Durable native journal outcome after owned local activity returns.
   */
  async drive(caller: object, operationId: NativeOperationId): Promise<NativeOperation> {
    this.host.authorize(caller, 'invoke')
    if (caller !== this.ctx.fiber) reject('CALLER_UNAUTHORIZED')
    if (this.#closed || this.#closing) reject('NATIVE_DRIVER_CLOSED')
    const op = this.host.inspect(caller, operationId)
    if (this.#active?.operation.id === operationId) return this.#active.done
    if (op.state !== 'admitted') return op
    this.#assertKnownSession()
    if (this.#active !== undefined || this.#agent().status !== 'idle') reject('NATIVE_SESSION_BUSY')
    this.#assertEmptyInbox()
    if (digest(this.#agent().session.snapshotEvents()) !== this.#historyDigest) reject('NATIVE_HISTORY_CONFLICT')
    this.validateSessionBinding(op.binding)
    this.host.claimDriver(caller, operationId, this)
    const done = Promise.withResolvers<NativeOperation>()
    const active: ActiveRun = { operation: op, step: op.nextStep, startSeq: 0, inputId: '', done: done.promise }
    this.#active = active
    void this.#consume(caller, active).then(done.resolve, done.reject)
    try { return await done.promise }
    finally { if (this.#active === active) this.#active = undefined; this.host.releaseDriver(operationId, this) }
  }

  async #consume(caller: object, active: ActiveRun): Promise<NativeOperation> {
    try {
      for (; active.step < active.operation.steps.length; active.step++) {
        const current = this.host.checkRequest(caller, active.operation.id, active.step)
        this.validateSessionBinding(current.binding)
        this.#assertEmptyInbox()
        const agent = this.#agent()
        const text = current.steps[active.step] ?? reject('NATIVE_HISTORY_CONFLICT')
        const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
        active.inputId = input.id
        active.startSeq = agent.session.snapshotEvents().length
        agent.followup(input) // Durable inbox receipt occurs only after authoritative admission/claim.
        await agent.whenIdle() // Local drain; never used alone as output settlement.
        if (!await this.ctx.sessions.flush(agent.session)) reject('NATIVE_PERSISTENCE_REQUIRED')
        const persistence = this.ctx.get('sessionPersistence') ?? reject('NATIVE_PERSISTENCE_REQUIRED')
        await using stored = await persistence.open(agent.id, 'read')
        const read = await stored.read()
        const live = agent.session.snapshotEvents()
        if (canonical(read.events) !== canonical(live)) reject('NATIVE_RECEIPT_NOT_DURABLE')
        const interval = read.events.slice(active.startSeq)
        const starts = interval.filter(event => event.type === 'turn/start')
        const ends = interval.filter(event => event.type === 'turn/end')
        const messages = interval.filter(event => event.type === 'assistant/message')
        const users = interval.filter(event => event.type === 'user/message')
        const message = messages[0], end = ends[0]
        if (starts.length !== 1 || ends.length !== 1 || messages.length !== 1 || users.length !== 1
          || interval.some(event => event.type === 'assistant/attempt') || users[0]?.data.id !== active.inputId
          || message === undefined || end === undefined || message.data.interrupted === true
          || !['completed', 'max-tokens'].includes(end.data.reason.kind)
          || end.data.turn !== message.data.turn || starts[0]?.data.turn !== end.data.turn
          || message.data.step !== 1 || message.data.usage === undefined || !usage(message.data.usage)
          || message.data.message.content.some(block => block.type !== 'text')) reject('NATIVE_SETTLEMENT_UNKNOWN')
        const assembled = assembleAssistantStream(message.data.stream)
        if (!['stop', 'max-tokens'].includes(assembled.finish.kind)) reject('NATIVE_SETTLEMENT_UNKNOWN')
        const answer = message.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
        const receipt: NativeSessionReceipt = Object.freeze({ sessionId: agent.id, turn: message.data.turn, step: message.data.step,
          startSeq: active.startSeq, assistantSeq: message.seq, endSeq: end.seq,
          assistantDigest: digest(message), endDigest: digest(end) })
        this.#receipts.set(receipt, { operationId: current.id, step: active.step, answer, usageDigest: digest(message.data.usage) })
        this.host.completeStep(this, current.id, active.step, answer, message.data.usage, receipt)
        this.#history = withoutEmptySystem(agent.session.deriveMessages())
        this.#historyDigest = digest(agent.session.snapshotEvents())
      }
    } catch (error: unknown) {
      const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        && /^[A-Za-z0-9_-]{1,128}$/.test(error.code) ? error.code : 'NATIVE_CONSUMER_FAILURE'
      this.host.failStep(this, active.operation.id, code)
    }
    return this.host.inspect(caller, active.operation.id)
  }

  #assertKnownSession(): void {
    if (this.host.sessionOperations(this.ctx.fiber, this.#agent().id).some(op => op.state === 'unknown'
      || op.attempts.some(attempt => attempt.state === 'intent' || attempt.state === 'unknown'))) reject('SESSION_OUTCOME_UNKNOWN')
  }

  async #restoreHistory(): Promise<void> {
    const agent = this.#agent()
    const operations = this.host.sessionOperations(this.ctx.fiber, agent.id)
    // Unknown history can be inspected and stopped, but never admits a new native turn.
    if (operations.some(op => op.state === 'unknown' || op.attempts.some(attempt => attempt.state !== 'observed'))) return
    this.#assertEmptyInbox()
    if (!await this.ctx.sessions.flush(agent.session)) reject('NATIVE_PERSISTENCE_REQUIRED')
    const persistence = this.ctx.get('sessionPersistence') ?? reject('NATIVE_PERSISTENCE_REQUIRED')
    await using stored = await persistence.open(agent.id, 'read')
    const events = (await stored.read()).events
    if (canonical(events) !== canonical(agent.session.snapshotEvents())) reject('NATIVE_RECEIPT_NOT_DURABLE')
    const receipts = operations.flatMap(op => op.attempts.map(attempt => ({ op, attempt,
      receipt: attempt.sessionReceipt ?? reject('NATIVE_RECEIPT_REQUIRED') }))).sort((a, b) => a.receipt.startSeq - b.receipt.startSeq)
    const expected: RequestMessage[] = []
    let previousEnd = -1
    for (const { op, attempt, receipt } of receipts) {
      if (canonical(op.binding.sessionBinding) !== canonical(this.binding.sessionBinding)
        || receipt.startSeq <= previousEnd) reject('NATIVE_HISTORY_CONFLICT')
      const interval = events.slice(receipt.startSeq, receipt.endSeq + 1)
      const users = interval.filter(event => event.type === 'user/message')
      const user = users[0]
      const assistants = interval.filter(event => event.type === 'assistant/message')
      const message = events[receipt.assistantSeq], end = events[receipt.endSeq]
      if (user === undefined || users.length !== 1 || assistants.length !== 1
        || message?.type !== 'assistant/message' || end?.type !== 'turn/end'
        || digest(message) !== receipt.assistantDigest || digest(end) !== receipt.endDigest
        || message.data.turn !== receipt.turn || message.data.step !== receipt.step || end.data.turn !== receipt.turn
        || canonical(user.data.content) !== canonical([{ type: 'text', text: op.steps[attempt.step] ?? reject('NATIVE_HISTORY_CONFLICT') }])
        || canonical(message.data.usage) !== canonical(attempt.usage)
        || message.data.message.content.map(block => block.type === 'text' ? block.text : '').join('') !== op.answers[attempt.step]) reject('NATIVE_HISTORY_CONFLICT')
      expected.push(user.data)
      const projected = deriveEventMessage(message)
      if (projected !== null) expected.push(projected)
      previousEnd = receipt.endSeq
    }
    textWire(this.#history)
    if (canonical(this.#history) !== canonical(expected)) reject('NATIVE_HISTORY_CONFLICT')
  }

  #inputDigest(options: GenerateOptions): string {
    const { signal: _signal, ...input } = options
    return digest(input)
  }
  #validateRequest(options: GenerateOptions): void {
    const active = this.#active ?? reject('CONTROLLED_PERMIT_REQUIRED')
    const current = this.host.checkRequest(this.ctx.fiber, active.operation.id, active.step)
    this.validateSessionBinding(current.binding)
    const agent = this.#agent()
    if (!isProtectedNativeRequest(options, agent)) reject('NATIVE_REQUEST_OWNER_REQUIRED')
    if (!Object.isFrozen(options) || options.sessionId !== agent.id || options.provider !== current.binding.provider
      || options.model !== current.binding.model
      || options.maxTokens !== current.binding.maxTokens || options.reasoningEffort !== 'off' || options.tools !== undefined
      || (options.toolHistory?.tools.length ?? 0) !== 0 || (options.toolHistory?.updates.length ?? 0) !== 0
    ) reject('FINAL_INPUT_CONFLICT')
    textWire(options.messages) // Reject nonempty system prompts and all non-text/tool content.
    if (canonical(options.messages) !== canonical(agent.session.deriveMessages())) reject('NATIVE_REQUEST_LOG_CONFLICT')
    const conversation = withoutEmptySystem(options.messages)
    const last = conversation.at(-1)
    if (conversation.length !== this.#history.length + 1 || canonical(conversation.slice(0, -1)) !== canonical(this.#history)
      || last?.role !== 'user' || last.id !== active.inputId
      || canonical(last.content) !== canonical([{ type: 'text', text: current.steps[active.step] ?? reject('NATIVE_HISTORY_CONFLICT') }])) reject('NATIVE_HISTORY_CONFLICT')
    this.#assertEmptyInbox()
  }
  #bound(options: GenerateOptions): BoundRequest {
    this.#validateRequest(options)
    const bound = this.#requests.get(options) ?? reject('CONTROLLED_PERMIT_REQUIRED')
    const active = this.#active ?? reject('CONTROLLED_PERMIT_REQUIRED')
    if (bound.operationId !== active.operation.id || bound.step !== active.step || bound.inputDigest !== this.#inputDigest(options)
      || bound.prefixDigest !== digest(this.#agent().session.snapshotEvents())) reject('FINAL_INPUT_CONFLICT')
    return bound
  }
  #dispatch(options: GenerateOptions, wire: DeepSeekDispatchInput): void {
    const bound = this.#bound(options)
    this.host.beginAttempt(this.ctx.fiber, this, bound.operationId, bound.step, options, wire)
  }
  /** Host-only final native request ownership check; no caller-supplied authorization callback.
   * @param options Actual request instance.
   * @param op Exact journal operation.
   * @param step Pending journal step.
   */
  validateIntent(options: GenerateOptions, op: NativeOperation, step: number): void {
    const bound = this.#bound(options)
    if (bound.operationId !== op.id || bound.step !== step) reject('CONTROLLED_PERMIT_REQUIRED')
  }
  /** Host verifies an exact private attestation created only after native durable readback.
   * @param receipt Candidate Session receipt identity.
   * @param op Exact journal operation.
   * @param step Consumed journal step.
   * @param answer Actual native terminal text.
   * @param observed Actual native terminal usage.
   */
  validateReceipt(receipt: NativeSessionReceipt | undefined, op: NativeOperation, step: number,
    answer: string, observed: TokenUsage): void {
    const proof = receipt === undefined ? undefined : this.#receipts.get(receipt)
    if (proof === undefined || proof.operationId !== op.id || proof.step !== step || proof.answer !== answer
      || proof.usageDigest !== digest(observed)) reject('NATIVE_RECEIPT_REQUIRED')
  }
  #agent(): Agent {
    if (this.#handle === undefined || !isNativeAgentHandle(this.#handle)) reject('NATIVE_OWNED_HANDLE_REQUIRED')
    return this.#handle.agent
  }
  #assertEmptyInbox(): void {
    const inbox = this.#agent().inbox
    if (inbox.nextTurn.length !== 0 || inbox.nextStep.length !== 0) reject('NATIVE_INBOX_CONFLICT')
  }

  /** Fence the exact generation before native cancellation and bounded local drain.
   * @param caller Exact owner fiber capability.
   * @param controlId Idempotent stop receipt.
   * @param operationId Operation specifying the generation.
   * @returns Durable outcome retaining remote uncertainty.
   */
  async stop(caller: object, controlId: NativeControlId, operationId: NativeOperationId): Promise<NativeOperation> {
    this.host.stop(caller, controlId, operationId)
    await this.host.drainStoppedGeneration(caller, operationId)
    return this.host.inspect(caller, operationId)
  }
  /** Abort/drain only locally active work with the exact fenced generation.
   * @param targetId Target to stop.
   * @param generation Exact generation, excluding restarted work.
   * @returns Whether owned activity returned within the settlement bound.
   */
  async drainGeneration(targetId: NativeTargetId, generation: number): Promise<boolean> {
    const active = this.#active
    if (active === undefined || active.operation.targetId !== targetId || active.operation.binding.runGeneration !== generation) return true
    this.#agent().cancel({ kind: 'hook', reason: 'GENERATION_STOPPED' })
    return this.#drain(active)
  }
  /** Cancel active work only after its target mutation has committed.
   * @param targetId Revoked/changed target.
   */
  abortTarget(targetId: NativeTargetId): void {
    if (this.#active?.operation.targetId === targetId) this.#agent().cancel({ kind: 'hook', reason: 'AUTHORITY_REVOKED' })
  }
  /** Fence owned work and release the actual native handle only after bounded quiescence. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closing = true
    const active = this.#active
    if (active !== undefined) {
      this.host.stopOwned(this, active.operation.id)
      this.#agent().cancel({ kind: 'disposed' })
      if (!await this.#drain(active)) { this.host.noteUnsettled(this, active.operation.id); reject('LOCAL_SETTLEMENT_UNKNOWN') }
    }
    await this.#handle?.dispose()
    this.#closed = true
  }
  async #drain(active: ActiveRun): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([
      active.done.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), this.host.settlementDeadlineMs) }),
    ]) }
    finally { if (timer !== undefined) clearTimeout(timer) }
  }
}
