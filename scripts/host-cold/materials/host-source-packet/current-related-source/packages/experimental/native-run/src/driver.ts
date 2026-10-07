/** Bounded text-only consumer: every input comes from the authoritative journal. */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapterOptions, DeepSeekDispatchInput } from '@deepseek-ai/dsh-llm-deepseek'
import { BlockAssembler, createAssistantMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { NativeRunHost } from './journal.ts'
import type { NativeControlId as ControlId, NativeOperation, NativeOperationId, NativeTargetId } from './types.ts'
import { digest, reject, usage } from './values.ts'

interface BoundRequest { caller: object; operationId: NativeOperationId; step: number; inputDigest: string }
interface ActiveRun { operation: NativeOperation; abort: AbortController; done: Promise<NativeOperation> }

/** Owns a controlled adapter instance; no foreign adapter, JSON actor or message queue can bypass it. */
export class NativeRunDriver {
  readonly #adapter: DeepSeekAdapter
  readonly #bindings = new WeakMap<GenerateOptions, BoundRequest>()
  readonly #active = new Map<NativeOperationId, ActiveRun>()
  #closed = false

  constructor(private readonly host: NativeRunHost, dependencies: Omit<DeepSeekAdapterOptions, 'dispatchControl'>) {
    this.#adapter = new DeepSeekAdapter({ ...dependencies, dispatchControl: {
      checkAdmission: options => { this.#bound(options) },
      checkDispatch: (options, input) => { this.#dispatch(options, input) },
    } })
    host.registerDriver(this)
  }
  /** Consume journaled pending steps; unknown outcomes never redispatch.
   * @param caller Actual calling scope checked by the test launcher policy.
   * @param operationId Admitted journal-local identity.
   * @returns The durable outcome after this local consumer returns.
   */
  async drive(caller: object, operationId: NativeOperationId): Promise<NativeOperation> {
    if (this.#closed) reject('NATIVE_DRIVER_CLOSED')
    const operation = this.host.inspect(caller, operationId)
    this.host.authorize(caller, 'invoke', operation.targetId)
    const active = this.#active.get(operationId)
    if (active !== undefined) return active.done
    if (operation.state !== 'admitted') return operation
    this.host.claimDriver(caller, operationId, this)
    const abort = new AbortController()
    const done = this.#consume(caller, operation, abort.signal)
    this.#active.set(operationId, { operation, abort, done })
    try { return await done } finally { this.#active.delete(operationId); this.host.releaseDriver(operationId, this) }
  }
  /** Commit an exact-generation fence before aborting and draining all matching owners.
   * @param caller Actual calling scope with current control authority.
   * @param controlId Idempotent journal-local control receipt identity.
   * @param operationId Operation identifying the generation to stop.
   * @returns The durable outcome, retaining unknown remote effects.
   */
  async stop(caller: object, controlId: ControlId, operationId: NativeOperationId): Promise<NativeOperation> {
    this.host.stop(caller, controlId, operationId)
    await this.host.drainStoppedGeneration(caller, operationId)
    return this.host.inspect(caller, operationId)
  }
  /** Drain only the exact generation after the host has committed its fence.
   * @param targetId Journal-local target identity.
   * @param generation Exact generation to abort.
   * @returns Whether every matching local lifecycle returned before the deadline.
   */
  async drainGeneration(targetId: NativeTargetId, generation: number): Promise<boolean> {
    const owned = [...this.#active.values()].filter(run => run.operation.targetId === targetId && run.operation.binding.runGeneration === generation)
    for (const run of owned) run.abort.abort(new Error('GENERATION_STOPPED'))
    return this.#drain(owned)
  }
  /** Abort requests after the native writer commits an authority change.
   * @param targetId Target whose current authority was changed.
   */
  abortTarget(targetId: NativeTargetId): void {
    for (const run of this.#active.values()) if (run.operation.targetId === targetId) run.abort.abort(new Error('AUTHORITY_REVOKED'))
  }
  /** Persist fences and drain owned local requests before disposal. */
  async close(): Promise<void> {
    this.#closed = true
    const owned = [...this.#active.values()]
    for (const run of owned) this.host.stopOwned(this, run.operation.id)
    for (const run of owned) run.abort.abort(new Error('NATIVE_DRIVER_CLOSED'))
    if (!await this.#drain(owned)) {
      for (const run of owned) this.host.noteUnsettled(this, run.operation.id)
      reject('LOCAL_SETTLEMENT_UNKNOWN')
    }
  }
  async #consume(caller: object, initial: NativeOperation, signal: AbortSignal): Promise<NativeOperation> {
    try {
      for (let step = initial.nextStep; step < initial.steps.length; step++) {
        signal.throwIfAborted()
        const op = this.host.checkRequest(caller, initial.id, step)
        const prepared = await this.#adapter.prepareCall(op.binding.provider, op.binding.model, signal)
        const current = this.host.checkRequest(caller, initial.id, step)
        const messages: RequestMessage[] = []
        for (let previous = 0; previous < step; previous++) {
          messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: current.steps[previous]! }] }))
          messages.push(createAssistantMessage({ source: { provider: op.binding.provider, model: op.binding.model }, content: [{ type: 'text', text: current.answers[previous]! }] }))
        }
        messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: current.steps[step]! }] }))
        const frozen = deepFreeze({ provider: current.binding.provider, model: current.binding.model, maxTokens: current.binding.maxTokens,
          reasoningEffort: ReasoningEffortId('off'), messages })
        const options: GenerateOptions = Object.freeze({ ...frozen, signal })
        this.#bindings.set(options, { caller, operationId: current.id, step, inputDigest: digest(frozen) })
        let observed: TokenUsage | undefined
        const assembler = new BlockAssembler()
        for await (const chunk of prepared.stream(options)) {
          assembler.push(chunk)
          if (chunk.type === 'usage') observed = chunk.usage
        }
        if (!['stop', 'max-tokens'].includes(assembler.finish.kind)) {
          const finish = assembler.finish
          if (finish.kind === 'error' || finish.kind === 'aborted') reject(finish.failure.status === 429 ? 'RATE_LIMIT' : finish.failure.code)
          reject('UNSUPPORTED_RESPONSE')
        }
        const blocks = assembler.blocks()
        if (blocks.some(block => block.type !== 'text') || observed === undefined || !usage(observed)) reject('SETTLEMENT_UNKNOWN')
        const answer = blocks.map(block => block.type === 'text' ? block.text : '').join('')
        this.host.completeStep(this, current.id, step, answer, observed)
      }
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : signal.aborted ? 'ABORTED' : 'TRANSPORT'
      this.host.failStep(this, initial.id, code)
    }
    return this.host.inspect(caller, initial.id)
  }
  #bound(options: GenerateOptions): BoundRequest {
    const bound = this.#bindings.get(options)
    if (bound === undefined) reject('CONTROLLED_PERMIT_REQUIRED')
    const { signal: _liveSignal, ...input } = options
    if (!Object.isFrozen(options) || digest(input) !== bound.inputDigest || options.tools !== undefined || options.messages.some(message => message.content.some(block => block.type !== 'text'))) reject('FINAL_INPUT_CONFLICT')
    this.host.checkRequest(bound.caller, bound.operationId, bound.step)
    return bound
  }
  #dispatch(options: GenerateOptions, wire: DeepSeekDispatchInput): void {
    const bound = this.#bound(options)
    this.host.beginAttempt(bound.caller, this, bound.operationId, bound.step, options, wire)
  }
  async #drain(owned: ActiveRun[]): Promise<boolean> {
    if (owned.length === 0) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([Promise.allSettled(owned.map(run => run.done)).then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.host.settlementDeadlineMs) })])
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }
}
