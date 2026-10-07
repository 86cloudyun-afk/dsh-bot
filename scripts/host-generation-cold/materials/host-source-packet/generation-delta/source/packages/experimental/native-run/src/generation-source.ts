/** Private original-generation receipts, independent of the text-only native journal. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { openNativeAgentActivity, isProtectedNativeRequest } from '@deepseek-ai/dsh-agent-loop'
import type { NativeAgentActivity, NativeAgentActivityPort, NativeActivityObservation } from '@deepseek-ai/dsh-agent-loop'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, ProtectedModelCalls, TokenUsage, AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { isDeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { canonical, digest, reject, usage } from './values.ts'

declare const generationBrand: unique symbol
const receiptBrand: unique symbol = Symbol('owned-native-generation-receipt')
/** Exact product identifiers retained by the source; these fields grant no authority. */
export interface NativeGenerationBinding {
  readonly botId: string
  readonly taskId: string
  readonly sessionId: string
  readonly generation: number
  readonly botEpoch: number
  readonly taskEpoch: number
  readonly taskRevision: number
  readonly authorityEpoch: number
  readonly configVersion: string
}
/** Source-minted process-local identity of one original input and native driver. */
export interface OwnedNativeGeneration { readonly [generationBrand]: true }
/** Durable settlement identity recognized only by its exact producing source. */
export interface OwnedNativeGenerationReceipt { readonly [receiptBrand]: true; readonly sessionId: string }
/** Independent local and remote outcomes; only a branded receipt grants terminal evidence. */
export interface NativeGenerationView {
  readonly binding: NativeGenerationBinding
  readonly inputMessageId: string
  readonly activityCounter: number
  readonly requestCount: number
  readonly local: 'pending' | 'returned'
  readonly remote: 'UNKNOWN' | 'settled'
  readonly usageKnown: boolean
  readonly usage: TokenUsage | null
  readonly receipt: OwnedNativeGenerationReceipt | null
  readonly reason: string | null
}
/** Owner-only source retaining native identities rather than serializable task proofs. */
export interface OwnedGenerationSource {
  start(binding: NativeGenerationBinding, input: UserMessage): OwnedNativeGeneration
  inspect(generation: OwnedNativeGeneration): Promise<NativeGenerationView>
  cancel(generation: OwnedNativeGeneration, timeoutMs?: number): Promise<NativeGenerationView>
}
/** Private source preparation before native mounting or any waking input. */
export interface PrepareOwnedGenerationOptions {
  readonly ownerCtx: Context
  readonly providerFactory: DeepSeekProviderFactory
  readonly sessionId: string
  readonly role: 'main' | 'work'
  readonly route: LlmCallConfig
  readonly delegateTool?: ToolDefinition
  readonly initialization?: {
    readonly permissionPreset: string
    readonly sandboxMode: string
    readonly approvalPolicy: string
  }
  readonly isCurrent: (binding: NativeGenerationBinding) => boolean
  /** Request fence, independent of authority to verify the exact original receipt. */
  readonly canDispatch?: (binding: NativeGenerationBinding) => boolean
}
/** Factory call capability and one-shot attachment to the actual created handle. */
export interface PreparedOwnedGenerationSource {
  readonly protectedModelCalls: ProtectedModelCalls
  attach(handle: AgentHandle, options?: { readonly delegateTool?: ToolDefinition }): OwnedGenerationSource
}
interface GenerationState {
  readonly binding: NativeGenerationBinding
  readonly input: UserMessage
  activity?: NativeAgentActivity
  readonly dispatched: Set<GenerateOptions>
  receipt: OwnedNativeGenerationReceipt | null
  observedUsage: TokenUsage | null
  reason: string | null
  stopped: boolean
}
const sources = new WeakMap<object, { ownerCtx: Context }>()
const receipts = new WeakMap<object, { source: OwnedGenerationSource; bindingDigest: string }>()
const preparations = new WeakMap<object, { ownerCtx: Context; sessionId: string; role: 'main' | 'work' }>()

/** Recognize actual strict provider preparation before any native creation effects.
 * @param value Candidate producer preparation, never a structural route label.
 * @param ownerCtx Exact source owner Context.
 * @param sessionId Exact Session to create.
 * @param role Exact main or work tool policy.
 * @returns Whether the provider minted this preparation for these identities.
 */
export function isPreparedOwnedGenerationSource(value: unknown, ownerCtx: Context, sessionId: string, role: 'main' | 'work'): value is PreparedOwnedGenerationSource {
  if (value === null || typeof value !== 'object') return false
  const actual = preparations.get(value)
  return actual?.ownerCtx === ownerCtx && actual.sessionId === sessionId && actual.role === role
}

/** Recognize an unchanged source belonging to the exact owner Context.
 * @param value Candidate live process-local source.
 * @param ownerCtx Exact lifecycle creator Context.
 * @returns Whether the native producer minted this source for that owner.
 */
export function isOwnedGenerationSource(value: unknown, ownerCtx: Context): value is OwnedGenerationSource {
  return value !== null && typeof value === 'object' && sources.get(value)?.ownerCtx === ownerCtx
}
/** Verify terminal evidence from the source and product binding that produced it.
 * @param value Candidate receipt; copied JSON never qualifies.
 * @param source Exact retained native source.
 * @param binding Exact generation and epochs to consume.
 * @returns Whether this source durably settled that binding and original activity.
 */
export function isOwnedGenerationReceipt(value: unknown, source: OwnedGenerationSource, binding: NativeGenerationBinding): value is OwnedNativeGenerationReceipt {
  if (value === null || typeof value !== 'object') return false
  const actual = receipts.get(value)
  return actual?.source === source && actual.bindingDigest === digest(binding)
}

/** Mint strict calls before creation, then attach only the real same-owner native handle.
 * @param options Provider, lifecycle owner, exact route and tool policy.
 * @returns Opaque preparation with a one-shot actual-handle attachment.
 */
export function prepareOwnedGenerationSource(options: PrepareOwnedGenerationOptions): PreparedOwnedGenerationSource {
  const { ownerCtx, providerFactory, sessionId, role } = options
  let delegateTool = options.delegateTool
  if (!(ownerCtx instanceof Context) || !isDeepSeekProviderFactory(providerFactory, ownerCtx.get('llm'))) reject('GENERATION_PROVIDER_REQUIRED')
  ownerCtx.fiber.assertActive()
  if (!sessionId || !['main', 'work'].includes(role) || typeof options.isCurrent !== 'function'
    || options.canDispatch !== undefined && typeof options.canDispatch !== 'function') reject('GENERATION_OPTIONS_INVALID')
  const route = Object.freeze({ ...options.route })
  if (!route.provider || !route.model || !Number.isSafeInteger(route.maxTokens) || (route.maxTokens ?? 0) <= 0 || route.reasoningEffort !== 'off') reject('GENERATION_ROUTE_REQUIRED')
  if (delegateTool !== undefined && (role !== 'main' || delegateTool.name !== 'dsh_bot_delegate')) reject('GENERATION_TOOL_POLICY_REQUIRED')
  const current = options.isCurrent
  const initialization = options.initialization === undefined ? undefined : Object.freeze({ ...options.initialization })
  if (initialization !== undefined && (Object.keys(initialization).length !== 3
    || !Object.values(initialization).every(value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('\0'))
    || !['read-only', 'workspace-write', 'danger-full-access'].includes(initialization.sandboxMode)
    || !['ask', 'never'].includes(initialization.approvalPolicy))) reject('GENERATION_INITIALIZATION_INVALID')
  let handle: AgentHandle | undefined, activityPort: NativeAgentActivityPort | undefined, source: OwnedGenerationSource | undefined
  let active: GenerationState | undefined, historyDigest: string | undefined
  const generations = new WeakMap<OwnedNativeGeneration, GenerationState>()
  const sourceId = randomUUID()
  const live = (): AgentHandle => {
    ownerCtx.fiber.assertActive()
    const actual = handle ?? reject('GENERATION_SOURCE_NOT_ATTACHED')
    if (ownerCtx.agents.get(actual.agent.id) !== actual.agent || ownerCtx.sessions.get(actual.agent.id) !== actual.agent.session
      || actual.agent.id !== sessionId || actual.agent.session.id !== sessionId) reject('GENERATION_NATIVE_AGENT_CHANGED')
    return actual
  }
  const tools = (blankAttachment = false): void => {
    const agent = live().agent
    if (ownerCtx.tools.schemas().length !== 0) reject('GENERATION_GLOBAL_TOOLS_PRESENT')
    const scoped = ownerCtx.tools.schemas(agent)
    if (blankAttachment && scoped.length === 0) return
    if (role === 'work' ? scoped.length !== 0 : scoped.length !== 1 || scoped[0]?.name !== 'dsh_bot_delegate'
      || ownerCtx.tools.get('dsh_bot_delegate', agent) !== delegateTool) reject('GENERATION_TOOL_POLICY_CHANGED')
  }
  const check = (state: GenerationState): void => {
    live(); tools()
    const accepted: unknown = current(state.binding)
    if (accepted !== true) {
      if (accepted !== null && typeof accepted === 'object' && 'then' in accepted) void Promise.resolve(accepted).catch((_error: unknown) => {})
      reject('GENERATION_BINDING_STALE')
    }
  }
  const checkDispatch = (state: GenerationState): void => {
    check(state)
    const allowed: unknown = options.canDispatch?.(state.binding) ?? true
    if (state.stopped || allowed !== true) {
      if (allowed !== null && typeof allowed === 'object' && 'then' in allowed) void Promise.resolve(allowed).catch((_error: unknown) => {})
      reject('GENERATION_DISPATCH_FENCED')
    }
  }
  const request = (input: GenerateOptions): GenerationState => {
    const state = active ?? reject('GENERATION_ADMISSION_REQUIRED')
    checkDispatch(state)
    const agent = live().agent, port = activityPort ?? reject('GENERATION_SOURCE_NOT_ATTACHED')
    if (state.activity === undefined || !port.ownsRequest(state.activity, input) || !isProtectedNativeRequest(input, agent)
      || !Object.isFrozen(input) || input.sessionId !== sessionId || input.provider !== route.provider
      || input.model !== route.model || input.maxTokens !== route.maxTokens || input.reasoningEffort !== route.reasoningEffort) reject('GENERATION_REQUEST_OWNER_REQUIRED')
    if (canonical(input.messages) !== canonical(agent.session.deriveMessages())) reject('GENERATION_REQUEST_LOG_CONFLICT')
    const observation = port.inspect(state.activity)
    const interval = agent.session.snapshotEvents().slice(observation.startSeq)
    const users = interval.filter(event => event.type === 'user/message')
    if (users.length !== 1 || canonical(users[0]?.data) !== canonical(state.input)
      || interval.filter(event => event.type === 'turn/start').length !== 1) reject('GENERATION_INPUT_WINDOW_CONFLICT')
    if (canonical(input.tools ?? []) !== canonical(ownerCtx.tools.schemas(agent))) reject('GENERATION_FINAL_TOOLS_CONFLICT')
    const allowed = role === 'main' ? ['dsh_bot_delegate'] : []
    if ((input.toolHistory?.tools ?? []).some(tool => !allowed.includes(tool.name))
      || interval.some(event => event.type === 'tool/call' && !allowed.includes(event.data.name))) reject('GENERATION_TOOL_HISTORY_CONFLICT')
    return state
  }
  const protectedModelCalls = providerFactory.protectSession(SessionId(sessionId), {
    checkAdmission: input => { request(input) },
    beforeStream: async input => {
      const original = request(input)
      if (!await ownerCtx.sessions.flush(live().agent.session)) reject('GENERATION_PERSISTENCE_REQUIRED')
      if (request(input) !== original) reject('GENERATION_REQUEST_CHANGED')
    },
    checkDispatch: input => {
      const state = request(input)
      if (state.dispatched.has(input)) reject('GENERATION_DISPATCH_UNKNOWN')
      state.dispatched.add(input)
    },
  })
  const get = (generation: OwnedNativeGeneration): GenerationState => generations.get(generation) ?? reject('GENERATION_CAPABILITY_REQUIRED')
  const view = (state: GenerationState, observation: NativeActivityObservation): NativeGenerationView => Object.freeze({
    binding: state.binding, inputMessageId: state.input.id, activityCounter: observation.counter,
    requestCount: observation.requests.length, local: observation.returned ? 'returned' : 'pending',
    remote: state.receipt === null ? 'UNKNOWN' : 'settled', usageKnown: state.receipt !== null,
    usage: state.observedUsage, receipt: state.receipt, reason: state.reason,
  })
  const inspect = async (generation: OwnedNativeGeneration): Promise<NativeGenerationView> => {
    const state = get(generation), port = activityPort ?? reject('GENERATION_SOURCE_NOT_ATTACHED')
    const activity = state.activity ?? reject('GENERATION_ACTIVITY_REQUIRED')
    const observation = port.inspect(activity)
    if (state.receipt !== null || !observation.returned) return view(state, observation)
    try {
      check(state)
      const agent = live().agent
      if (observation.endSeq === undefined || !await ownerCtx.sessions.flush(agent.session)) reject('GENERATION_PERSISTENCE_REQUIRED')
      check(state)
      const persistence = ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(agent.id, 'read')
      let events
      try {
        check(state)
        if (stored.header.id !== sessionId || stored.header.cwd !== agent.session.header.cwd
          || stored.header.agentPreset !== agent.session.header.agentPreset) reject('GENERATION_PERSISTENCE_CONFLICT')
        events = (await stored.read()).events
        check(state)
      } finally { await stored.close() }
      check(state)
      if (canonical(events.slice(0, observation.endSeq)) !== canonical(agent.session.snapshotEvents().slice(0, observation.endSeq))) reject('GENERATION_RECEIPT_NOT_DURABLE')
      const interval = events.slice(observation.startSeq, observation.endSeq)
      const starts = interval.filter(event => event.type === 'turn/start'), ends = interval.filter(event => event.type === 'turn/end')
      const users = interval.filter(event => event.type === 'user/message'), assistants = interval.filter(event => event.type === 'assistant/message')
      const ending = ends[0]?.data.reason
      const originalStopped = state.stopped && ending?.kind === 'aborted' && ending.reason.kind === 'hook'
        && ending.reason.reason === 'GENERATION_STOPPED'
      if (starts.length !== 1 || ends.length !== 1 || users.length !== 1 || canonical(users[0]?.data) !== canonical(state.input)
        || !(ending?.kind === 'completed' || ending?.kind === 'max-tokens' || originalStopped) || starts[0]!.data.turn !== ends[0]!.data.turn
        || interval.some(event => event.type === 'assistant/attempt') || observation.requests.length === 0
        || assistants.length !== observation.requests.length || state.dispatched.size !== observation.requests.length) reject('GENERATION_SETTLEMENT_UNKNOWN')
      const total: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      for (const record of observation.requests) {
        const durable = assistants.find(event => event.seq === record.assistantSeq)
        const finishes = record.stream.filter((item): item is Extract<AssistantStreamRecord, { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'finish')
        const usages = record.stream.filter((item): item is Extract<AssistantStreamRecord, { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'usage')
        const finish = finishes[0]?.chunk, observed = usages[0]?.chunk
        if (durable === undefined || durable.data.interrupted === true || durable.data.turn !== starts[0]!.data.turn
          || durable.data.turn !== record.turn || durable.data.step !== record.step || !state.dispatched.has(record.options)
          || canonical(durable.data.stream) !== canonical(record.stream) || finishes.length !== 1 || usages.length !== 1
          || finish?.type !== 'finish' || !['stop', 'tool-calls', 'max-tokens'].includes(finish.reason.kind)
          || observed?.type !== 'usage' || !usage(observed.usage) || canonical(durable.data.usage) !== canonical(observed.usage)) reject('GENERATION_SETTLEMENT_UNKNOWN')
        const assembled = assembleAssistantStream(record.stream)
        if (canonical(assembled.blocks()) !== canonical(durable.data.message.content)) reject('GENERATION_RESPONSE_CONFLICT')
        total.inputTokens += observed.usage.inputTokens
        total.outputTokens += observed.usage.outputTokens
        total.totalTokens = (total.totalTokens ?? 0) + (observed.usage.totalTokens ?? reject('GENERATION_USAGE_INCOMPLETE'))
        for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
          if (observed.usage[field] !== undefined) total[field] = (total[field] ?? 0) + observed.usage[field]
        }
      }
      if (!usage(total)) reject('GENERATION_USAGE_INVALID')
      const receipt: OwnedNativeGenerationReceipt = Object.freeze({ [receiptBrand]: true as const, sourceId, sessionId,
        inputMessageId: state.input.id, activityCounter: observation.counter, startSeq: observation.startSeq,
        endSeq: observation.endSeq, windowDigest: digest(interval), bindingDigest: digest(state.binding) })
      state.receipt = receipt
      state.observedUsage = Object.freeze(total)
      state.reason = null
      receipts.set(receipt, { source: source ?? reject('GENERATION_SOURCE_NOT_ATTACHED'), bindingDigest: digest(state.binding) })
      historyDigest = digest(agent.session.snapshotEvents())
    } catch (error: unknown) {
      state.reason = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'GENERATION_SETTLEMENT_UNKNOWN'
    }
    return view(state, observation)
  }
  const attach = (actual: AgentHandle, attachment?: { readonly delegateTool?: ToolDefinition }): OwnedGenerationSource => {
    if (handle !== undefined) reject('GENERATION_SOURCE_ALREADY_ATTACHED')
    const port = openNativeAgentActivity(actual, ownerCtx)
    if (attachment?.delegateTool !== undefined) {
      if (role !== 'main' || attachment.delegateTool.name !== 'dsh_bot_delegate'
        || delegateTool !== undefined && delegateTool !== attachment.delegateTool) reject('GENERATION_TOOL_POLICY_REQUIRED')
      delegateTool = attachment.delegateTool
    }
    if (role === 'main' && delegateTool === undefined) reject('GENERATION_TOOL_POLICY_REQUIRED')
    const events = actual.agent.session.snapshotEvents()
    const expectedInitialization = initialization === undefined ? [] : [
      { type: 'permission/preset', data: { preset: initialization.permissionPreset } },
      { type: 'sandbox/mode', data: { mode: initialization.sandboxMode } },
      { type: 'approval/policy', data: { policy: initialization.approvalPolicy } },
    ]
    if (actual.agent.id !== sessionId || events.length !== expectedInitialization.length
      || events.some((event, index) => event.seq !== index || canonical({ type: event.type, data: event.data }) !== canonical(expectedInitialization[index]))
      || actual.agent.inbox.nextTurn.length !== 0 || actual.agent.inbox.nextStep.length !== 0) reject('GENERATION_BLANK_SESSION_REQUIRED')
    handle = actual; activityPort = port
    tools(true)
    historyDigest = digest(actual.agent.session.snapshotEvents())
    source = Object.freeze({
      start: (binding: NativeGenerationBinding, input: UserMessage): OwnedNativeGeneration => {
        live(); tools()
        if (binding.sessionId !== sessionId || typeof binding.botId !== 'string' || binding.botId.length === 0
          || typeof binding.taskId !== 'string' || binding.taskId.length === 0
          || typeof binding.configVersion !== 'string' || binding.configVersion.length === 0 || binding.configVersion.length > 200
          || binding.configVersion.includes('\0') || ['generation', 'botEpoch', 'taskEpoch', 'taskRevision', 'authorityEpoch'].some(field => {
          const value = Reflect.get(binding, field); return !Number.isSafeInteger(value) || value <= 0
        })) reject('GENERATION_BINDING_INVALID')
        if (active !== undefined && active.receipt === null) reject('GENERATION_PREVIOUS_UNKNOWN')
        if (digest(actual.agent.session.snapshotEvents()) !== historyDigest) reject('GENERATION_HISTORY_CONFLICT')
        const state: GenerationState = { binding: deepFreeze(structuredClone(binding)), input: deepFreeze(structuredClone(input)),
          dispatched: new Set(), receipt: null, observedUsage: null, reason: null, stopped: false }
        checkDispatch(state)
        const generation = Object.freeze({}) as OwnedNativeGeneration
        generations.set(generation, state)
        active = state
        state.activity = port.start(state.input)
        return generation
      },
      inspect,
      cancel: async (generation: OwnedNativeGeneration, timeoutMs = 2000): Promise<NativeGenerationView> => {
        const state = get(generation), activity = state.activity ?? reject('GENERATION_ACTIVITY_REQUIRED')
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) reject('GENERATION_DRAIN_BOUND_REQUIRED')
        state.stopped = true
        port.cancel(activity)
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([port.done(activity).catch((_error: unknown) => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) })]) }
        finally { if (timer !== undefined) clearTimeout(timer) }
        return inspect(generation)
      },
    })
    sources.set(source, { ownerCtx })
    return source
  }
  const prepared = Object.freeze({ protectedModelCalls, attach })
  preparations.set(prepared, { ownerCtx, sessionId, role })
  return prepared
}

/** Bind a retained blank actual native handle before its first input.
 * @param options Same-owner native handle and strict source policy.
 * @returns Private source; GUI creation uses prepareOwnedGenerationSource before mounting.
 */
export function createOwnedGenerationSource(options: Omit<PrepareOwnedGenerationOptions, 'sessionId'> & { readonly handle: AgentHandle }): OwnedGenerationSource {
  openNativeAgentActivity(options.handle, options.ownerCtx)
  const prepared = prepareOwnedGenerationSource({ ...options, sessionId: options.handle.agent.id })
  options.handle.protectModelCalls?.(prepared.protectedModelCalls)
  return prepared.attach(options.handle)
}
