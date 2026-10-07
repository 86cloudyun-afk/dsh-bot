/** Private original-generation receipts, independent of the text-only native journal. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { openNativeAgentActivity, isProtectedNativeRequest, extendNativeEventChain, nativeEventDigest } from '@deepseek-ai/dsh-agent-loop'
import type { NativeAgentActivity, NativeAgentActivityPort, NativeActivityObservation,
  NativeActivityIntegrity } from '@deepseek-ai/dsh-agent-loop'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, ProtectedModelCalls, TokenUsage, AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { isDeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekProviderFactory } from '@deepseek-ai/dsh-llm-deepseek'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { assertOwnedControlBinding } from './generation-authority.ts'
import { canonical, digest, reject, usage, record } from './values.ts'
import { openNativeGenerationJournalPort, openNativeGenerationHistorySelector } from './generation-journal.ts'
import type { OwnedGenerationJournal, OwnedGenerationHistorySelector, NativeOwnedParentLineage } from './generation-journal.ts'
import { bindNativeSourceControlPort } from './generation-control.ts'
import { freezeOwnedDelegateDefinition } from './generation-tool-policy.ts'

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
/** Complete pre-reserved original parent-work execution, including the actual held slot lease. */
export interface OwnedWorkGenerationBinding extends NativeGenerationBinding {
  readonly operationId: string
  readonly nonce: string
  readonly inputMessageId: string
  readonly messageIdentity: string
  readonly slotLease: Readonly<Record<string, JsonValue>>
}
/** Source-minted process-local identity of one original input and native driver. */
export interface OwnedNativeGeneration { readonly [generationBrand]: true }
/** Durable settlement identity recognized only by its exact producing source. */
export interface OwnedNativeGenerationReceipt { readonly [receiptBrand]: true; readonly sessionId: string }
/** Exact native-attested original input window; serialized source labels never qualify extra inputs. */
export interface NativeGenerationInputWindow {
  readonly sessionId: string
  readonly inputMessageId: string
  readonly startSeq: number
  readonly endSeq: number
  readonly runtimeContexts: readonly { readonly seq: number; readonly messageId: string; readonly messageDigest: string }[]
  readonly runtimeContextMessageIds: readonly string[]
}
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
  restore(binding: NativeGenerationBinding): Promise<OwnedNativeGeneration>
  restoreKnown(selector: OwnedGenerationHistorySelector): Promise<OwnedNativeGeneration>
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
  readonly journal?: OwnedGenerationJournal
  /** Complete pre-reserved original input for zero-tool work or a privately derived child. */
  readonly plannedBinding?: OwnedWorkGenerationBinding
  /** Exact genuine sealed historical plan for resume; it grants no new start or replay. */
  readonly historicalPlan?: OwnedGenerationHistorySelector
  readonly workDelegate?: {
    readonly plannedBinding: OwnedWorkGenerationBinding
    readonly delegateTool: ToolDefinition
  }
}
/** Factory call capability and one-shot attachment to the actual created handle. */
export interface PreparedOwnedGenerationSource {
  readonly mode: 'create' | 'resume'
  /** Actual parent Agent only for a source-derived child; pass it unchanged to the native factory. */
  readonly parentAgent?: Agent
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
  readonly initial: NativeActivityIntegrity
  journalKey?: string
  startError?: string
  restoredView?: NativeGenerationView
  readAuthority?: () => void
  restoredProof?: () => Promise<void>
}
interface ChildLineage {
  parentSessionId: string
  parentAgent: Agent
  nativeDepth: number
  binding: NativeGenerationBinding
  assertDispatch(): void
  proveDispatch?(): Promise<void>
  knownOriginal?: true
  original?: NativeOwnedParentLineage
}
interface SourceOwner {
  ownerCtx: Context
  prepareChild?: (generation: OwnedNativeGeneration, options: OwnedChildGenerationOptions) => PreparedOwnedGenerationSource
  prepareKnownChild?: (generation: OwnedNativeGeneration, options: OwnedChildGenerationOptions) => Promise<PreparedOwnedGenerationSource>
  planWork?: (binding: OwnedWorkGenerationBinding) => void
}
/** Private child preparation; role and recursion policy are derived from the original parent. */
export type OwnedChildGenerationOptions = Omit<PrepareOwnedGenerationOptions, 'role' | 'delegateTool' | 'workDelegate'>
const sources = new WeakMap<object, SourceOwner>()
const receipts = new WeakMap<object, { source: OwnedGenerationSource; bindingDigest: string; inputWindow: NativeGenerationInputWindow }>()
const preparations = new WeakMap<object, { ownerCtx: Context; sessionId: string; role: 'main' | 'work'; assertActive(): void }>()

/** Recognize actual strict provider preparation before any native creation effects.
 * @param value Candidate producer preparation, never a structural route label.
 * @param ownerCtx Exact source owner Context.
 * @param sessionId Exact Session to create.
 * @param role Exact main or work tool policy.
 * @returns Whether the provider minted this preparation for these identities.
 */
export function isPreparedOwnedGenerationSource(value: unknown, ownerCtx: Context, sessionId: string,
  role: 'main' | 'work'): value is PreparedOwnedGenerationSource {
  if (value === null || typeof value !== 'object') return false
  const actual = preparations.get(value)
  if (actual?.ownerCtx !== ownerCtx || actual.sessionId !== sessionId || actual.role !== role) return false
  try { actual.assertActive(); return true } catch (_usedOrInvalidPreparation) { return false }
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
export function isOwnedGenerationReceipt(value: unknown, source: OwnedGenerationSource,
  binding: NativeGenerationBinding): value is OwnedNativeGenerationReceipt {
  if (value === null || typeof value !== 'object') return false
  const actual = receipts.get(value)
  return actual?.source === source && actual.bindingDigest === digest(binding)
}
/** Read original input/context facts only from the exact source-branded settled receipt.
 * @param value Exact producing receipt; copied fields have no authority.
 * @param source Actual source that settled the original generation.
 * @param binding Full original product binding, including operation, nonce and lease.
 * @returns Frozen native input-window facts, or null when the receipt is not genuine.
 */
export function getOwnedGenerationReceiptInputWindow(value: unknown, source: OwnedGenerationSource,
  binding: NativeGenerationBinding): NativeGenerationInputWindow | null {
  return isOwnedGenerationReceipt(value, source, binding) ? receipts.get(value)?.inputWindow ?? null : null
}
function assertDataPolicy(value: object): void {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) reject('GENERATION_OPTIONS_INVALID')
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) reject('GENERATION_OPTIONS_ACCESSOR_FORBIDDEN')
  }
}
function pinPreparationOptions<T extends Omit<PrepareOwnedGenerationOptions, 'role'>>(input: T): T {
  assertDataPolicy(input)
  const snapshot = { ...input }
  assertDataPolicy(snapshot.route)
  if (snapshot.initialization !== undefined) assertDataPolicy(snapshot.initialization)
  if (snapshot.workDelegate !== undefined) assertDataPolicy(snapshot.workDelegate)
  Object.freeze(snapshot.isCurrent)
  if (snapshot.canDispatch !== undefined) Object.freeze(snapshot.canDispatch)
  return Object.freeze({ ...snapshot, route: deepFreeze(structuredClone(snapshot.route)),
    ...(snapshot.initialization === undefined ? {} : { initialization: deepFreeze(structuredClone(snapshot.initialization)) }),
    ...(snapshot.plannedBinding === undefined ? {} : { plannedBinding: deepFreeze(structuredClone(snapshot.plannedBinding)) }),
    ...(snapshot.workDelegate === undefined ? {} : { workDelegate: Object.freeze({ ...snapshot.workDelegate,
      plannedBinding: deepFreeze(structuredClone(snapshot.workDelegate.plannedBinding)) }) }) })
}

/** Mint strict calls before creation, then attach only the real same-owner native handle.
 * @param options Provider, lifecycle owner, exact route and tool policy.
 * @returns Opaque preparation with a one-shot actual-handle attachment.
 */
export function prepareOwnedGenerationSource(options: PrepareOwnedGenerationOptions): PreparedOwnedGenerationSource {
  return prepareSource(pinPreparationOptions(options))
}
/** Derive one zero-tool child only from an actual original parent delegate activity.
 * @param parentSource Exact retained parent-work source.
 * @param parentGeneration Its original native generation capability.
 * @param options Same owner, provider and private child policy.
 * @returns A factory-branded depth-one preparation; JSON lineage grants no authority.
 */
export function prepareOwnedChildGenerationSource(parentSource: OwnedGenerationSource, parentGeneration: OwnedNativeGeneration,
  options: OwnedChildGenerationOptions): PreparedOwnedGenerationSource {
  const parent = sources.get(parentSource) ?? reject('GENERATION_PARENT_SOURCE_REQUIRED')
  if (Reflect.has(options, 'role') || Reflect.has(options, 'delegateTool')
    || Reflect.has(options, 'workDelegate')) reject('GENERATION_CHILD_OPTIONS_INVALID')
  const pinned = pinPreparationOptions(options)
  if (parent.ownerCtx !== pinned.ownerCtx) reject('GENERATION_CHILD_OPTIONS_INVALID')
  return (parent.prepareChild ?? reject('GENERATION_CHILD_DEPTH_EXCEEDED'))(parentGeneration, pinned)
}
/** Restore only the exact sealed original child through its genuine historical parent source and capability.
 * A newer parent activity must belong to this source and have complete durable settlement.
 * @param parentSource Actual resumed parent source with its immutable delegate policy.
 * @param parentGeneration Genuine restored original parent generation, never a serialized lineage.
 * @param options Exact child journal and owner policy; no future input needs to be invented.
 * @returns Protected same-id child preparation retaining the actual native parent Agent.
 */
export async function prepareOwnedKnownChildGenerationSource(parentSource: OwnedGenerationSource, parentGeneration: OwnedNativeGeneration,
  options: OwnedChildGenerationOptions): Promise<PreparedOwnedGenerationSource> {
  const parent = sources.get(parentSource) ?? reject('GENERATION_PARENT_SOURCE_REQUIRED')
  if (Reflect.has(options, 'role') || Reflect.has(options, 'delegateTool')
    || Reflect.has(options, 'workDelegate')) reject('GENERATION_CHILD_OPTIONS_INVALID')
  const pinned = pinPreparationOptions(options)
  if (parent.ownerCtx !== pinned.ownerCtx) reject('GENERATION_CHILD_OPTIONS_INVALID')
  return (parent.prepareKnownChild ?? reject('GENERATION_KNOWN_CHILD_UNAVAILABLE'))(parentGeneration, pinned)
}
/** Plan the next parent-work input through its actual owner after the preceding run settled.
 * @param source Exact retained parent-work source.
 * @param ownerCtx Exact source lifecycle owner, never a JSON identity.
 * @param binding Complete next pre-reserved original input, operation, nonce and held slot lease.
 */
export function planOwnedWorkGenerationSource(source: OwnedGenerationSource, ownerCtx: Context, binding: OwnedWorkGenerationBinding): void {
  const actual = sources.get(source) ?? reject('GENERATION_SOURCE_REQUIRED')
  if (actual.ownerCtx !== ownerCtx) reject('GENERATION_SOURCE_OWNER_REQUIRED')
  ;(actual.planWork ?? reject('GENERATION_WORK_DELEGATE_REQUIRED'))(binding)
}
function assertWorkBinding(binding: OwnedWorkGenerationBinding): void {
  assertOwnedControlBinding(binding)
  const lease: unknown = binding.slotLease
  if (typeof binding.inputMessageId !== 'string' || !binding.inputMessageId || typeof binding.messageIdentity !== 'string'
    || !/^[a-f0-9]{64}$/.test(binding.messageIdentity) || !record(lease)
    || lease.taskId !== binding.taskId || lease.sessionId !== binding.sessionId
    || lease.generation !== binding.generation || lease.operationId !== binding.operationId) {
    reject('GENERATION_FULL_WORK_PLAN_REQUIRED')
  }
  canonical(binding)
}
function prepareSource(options: PrepareOwnedGenerationOptions, lineage?: ChildLineage): PreparedOwnedGenerationSource {
  const { ownerCtx, providerFactory, sessionId, role } = options
  let delegateTool = options.delegateTool ?? options.workDelegate?.delegateTool
  if (delegateTool !== undefined) freezeOwnedDelegateDefinition(delegateTool)
  let toolDigest: string | undefined
  let toolExecute: unknown, toolRender: unknown
  const toolMethod = (key: 'execute' | 'render'): unknown => delegateTool === undefined ? undefined
    : Reflect.get(key === 'execute' ? delegateTool : delegateTool.output, key)
  const callbackPolicy = (value: unknown) => typeof value === 'function'
    ? { codeDigest: digest(Function.prototype.toString.call(value)) } : null
  const toolPolicyDigest = (): string => digest(delegateTool === undefined ? [] : [{ name: delegateTool.name,
    description: delegateTool.description, parameters: delegateTool.parameters,
    deferLoading: delegateTool.deferLoading ?? false, timeoutMs: delegateTool.timeoutMs ?? null,
    isConcurrencySafe: callbackPolicy(Reflect.get(delegateTool, 'isConcurrencySafe')),
    callbacks: ['execute', 'projectContent', 'finalizeContent', 'presentCall', 'presentResult'].map(key =>
      callbackPolicy(Reflect.get(delegateTool ?? {}, key))),
    output: { schema: delegateTool.output.schema, presentationMeta: callbackPolicy(Reflect.get(delegateTool.output, 'presentationMeta')),
      render: callbackPolicy(Reflect.get(delegateTool.output, 'render')) } }])
  const originalPlan = options.workDelegate?.plannedBinding ?? options.plannedBinding
  let plannedBinding = originalPlan === undefined ? undefined : deepFreeze(structuredClone(originalPlan))
  if (!(ownerCtx instanceof Context) || !isDeepSeekProviderFactory(providerFactory,
    ownerCtx.get('llm'))) reject('GENERATION_PROVIDER_REQUIRED')
  ownerCtx.fiber.assertActive()
  if (!sessionId || !['main', 'work'].includes(role) || typeof options.isCurrent !== 'function'
    || options.canDispatch !== undefined && typeof options.canDispatch !== 'function') reject('GENERATION_OPTIONS_INVALID')
  const route = Object.freeze({ ...options.route })
  if (!route.provider || !route.model || !Number.isSafeInteger(route.maxTokens) || (route.maxTokens ?? 0) <= 0
    || route.reasoningEffort !== 'off') reject('GENERATION_ROUTE_REQUIRED')
  if (options.plannedBinding !== undefined && (role !== 'work' || options.workDelegate !== undefined)) reject('GENERATION_WORK_PLAN_POLICY_REQUIRED')
  if (options.workDelegate !== undefined && (role !== 'work' || lineage !== undefined || plannedBinding?.sessionId !== sessionId
    || options.delegateTool !== undefined)) reject('GENERATION_WORK_DELEGATE_POLICY_REQUIRED')
  if (delegateTool !== undefined && (role !== 'main' && options.workDelegate === undefined
    || delegateTool.name !== 'dsh_bot_delegate')) reject('GENERATION_TOOL_POLICY_REQUIRED')
  const current = options.isCurrent
  const canDispatch = options.canDispatch ?? (() => true)
  if (plannedBinding !== undefined) assertWorkBinding(plannedBinding)
  const initialization = options.initialization === undefined ? undefined : Object.freeze({ ...options.initialization })
  if (initialization !== undefined && (Object.keys(initialization).length !== 3
    || !Object.values(initialization).every(value => typeof value === 'string' && value.length > 0 && value.length <= 200
      && !value.includes('\0'))
    || !['read-only', 'workspace-write', 'danger-full-access'].includes(initialization.sandboxMode)
    || !['ask', 'never'].includes(initialization.approvalPolicy))) reject('GENERATION_INITIALIZATION_INVALID')
  const journalCapability = options.journal
  const journal = journalCapability === undefined ? undefined : openNativeGenerationJournalPort(journalCapability, options)
  if (options.historicalPlan !== undefined) {
    if (journal?.mode !== 'resume' || plannedBinding === undefined) reject('GENERATION_HISTORICAL_PLAN_REQUIRED')
    const historical = openNativeGenerationHistorySelector(options.historicalPlan,
      journalCapability ?? reject('GENERATION_JOURNAL_CAPABILITY_REQUIRED'), ownerCtx)
    if (digest(historical.binding) !== digest(plannedBinding)) reject('GENERATION_HISTORICAL_PLAN_CONFLICT')
    historical.assertOriginalPlan()
  } else if (plannedBinding !== undefined) {
    const accepted: unknown = current(plannedBinding)
    if (accepted !== true) {
      if (accepted !== null && typeof accepted === 'object'
        && 'then' in accepted) void Promise.resolve(accepted).catch((_error: unknown) => {})
      reject('GENERATION_BINDING_STALE')
    }
  }
  if (journal?.mode === 'resume' && role === 'main' && delegateTool === undefined) reject('GENERATION_RESTORE_TOOL_POLICY_REQUIRED')
  if (journal !== undefined) journal.assertParentCapability(lineage !== undefined)
  if (lineage?.original !== undefined) journal?.bindOriginalParent(lineage.original)
  if (journal?.mode === 'resume') journal.assertToolPolicy(toolPolicyDigest())
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
    if (delegateTool === undefined ? scoped.length !== 0 : scoped.length !== 1 || scoped[0]?.name !== 'dsh_bot_delegate'
      || ownerCtx.tools.get('dsh_bot_delegate', agent) !== delegateTool) reject('GENERATION_TOOL_POLICY_CHANGED')
    if (toolDigest !== undefined && (toolPolicyDigest() !== toolDigest || toolMethod('execute') !== toolExecute
      || toolMethod('render') !== toolRender)) reject('GENERATION_TOOL_POLICY_CHANGED')
  }
  const integrity = (): NativeActivityIntegrity => {
    const agent = live().agent
    const state = ownerCtx.sessionProjections.stateOf(agent.session, 'nativeActivityIntegrity') ?? reject('GENERATION_INTEGRITY_REQUIRED')
    if (state.seq !== agent.session.seq) reject('GENERATION_INTEGRITY_SEQUENCE_CONFLICT')
    return state
  }
  const check = (state: GenerationState): void => {
    live(); tools()
    const accepted: unknown = current(state.binding)
    if (accepted !== true) {
      if (accepted !== null && typeof accepted === 'object'
        && 'then' in accepted) void Promise.resolve(accepted).catch((_error: unknown) => {})
      reject('GENERATION_BINDING_STALE')
    }
  }
  const checkDispatch = (state: GenerationState): void => {
    check(state)
    journal?.assertUnfenced()
    lineage?.assertDispatch()
    const allowed: unknown = canDispatch(state.binding)
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
      || input.model !== route.model || input.maxTokens !== route.maxTokens
        || input.reasoningEffort !== route.reasoningEffort) reject('GENERATION_REQUEST_OWNER_REQUIRED')
    if (canonical(input.messages) !== canonical(agent.session.deriveMessages())) reject('GENERATION_REQUEST_LOG_CONFLICT')
    const contexts = port.inspect(state.activity).runtimeContexts
    const progress = integrity()
    if (progress.users !== state.initial.users + 1 + contexts.length
      || progress.lastUserDigest !== nativeEventDigest(contexts.at(-1)?.message ?? state.input)
      || progress.turnStarts !== state.initial.turnStarts + 1) reject('GENERATION_INPUT_WINDOW_CONFLICT')
    if (canonical(input.tools ?? []) !== canonical(ownerCtx.tools.schemas(agent))) reject('GENERATION_FINAL_TOOLS_CONFLICT')
    const allowed = delegateTool === undefined ? [] : ['dsh_bot_delegate']
    if ((input.toolHistory?.tools ?? []).some(tool => !allowed.includes(tool.name))
      || progress.toolNames.some(name => !allowed.includes(name))) reject('GENERATION_TOOL_HISTORY_CONFLICT')
    return state
  }
  const protectedModelCalls = providerFactory.protectSession(SessionId(sessionId), {
    checkAdmission: (input) => { request(input) },
    beforeStream: async (input) => {
      const original = request(input)
      if (!await ownerCtx.sessions.flush(live().agent.session)) reject('GENERATION_PERSISTENCE_REQUIRED')
      if (request(input) !== original) reject('GENERATION_REQUEST_CHANGED')
    },
    beforeDispatch: async (input) => {
      const original = request(input), agent = live().agent, expected = integrity()
      if (lineage?.proveDispatch !== undefined) {
        await lineage.proveDispatch()
        if (request(input) !== original) reject('GENERATION_REQUEST_CHANGED')
      }
      const persistence = ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(agent.id, 'read')
      try {
        if (request(input) !== original) reject('GENERATION_REQUEST_CHANGED')
        const { events } = await stored.read()
        if (request(input) !== original || nativeEventDigest({ ...stored.header, delegationDepth: stored.header.delegationDepth ?? 0 })
          !== nativeEventDigest({ ...agent.session.header, delegationDepth: agent.session.header.delegationDepth ?? 0 })
          || events.length !== expected.seq || events.reduce(extendNativeEventChain,
          '') !== expected.chain) reject('GENERATION_DURABLE_DISPATCH_CONFLICT')
      } finally { await stored.close() }
      if (request(input) !== original || integrity().chain !== expected.chain) reject('GENERATION_REQUEST_CHANGED')
    },
    checkDispatch: (input, wire) => {
      const state = request(input)
      if (state.dispatched.has(input)) reject('GENERATION_DISPATCH_UNKNOWN')
      if (wire.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages') reject('GENERATION_ENDPOINT_CONFLICT')
      if (journal !== undefined) journal.dispatch(state.journalKey ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED'), input, wire)
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
  const authorizeState = (state: GenerationState, authority?: () => void): void => {
    live(); tools(); journal?.assertActive()
    if (authority !== undefined) authority()
    else if (state.readAuthority !== undefined) state.readAuthority()
    else check(state)
  }
  const inspect = async (generation: OwnedNativeGeneration, authority?: () => void): Promise<NativeGenerationView> => {
    const state = get(generation), port = activityPort ?? reject('GENERATION_SOURCE_NOT_ATTACHED')
    live(); journal?.assertActive()
    const authorize = authorizeState.bind(undefined, state, authority)
    if (authority !== undefined || state.readAuthority !== undefined) authorize()
    if (state.restoredView !== undefined) {
      authorize(); await state.restoredProof?.(); authorize(); return state.restoredView
    }
    if (state.startError !== undefined) return view(state, { counter: 0, input: state.input, startSeq: state.initial.seq,
      returned: true, requests: [], runtimeContexts: [] })
    const activity = state.activity ?? reject('GENERATION_ACTIVITY_REQUIRED')
    const observation = port.inspect(activity)
    if (state.receipt !== null) {
      authorize()
      if (journal !== undefined) {
        const known = await journal.readKnown(state.binding); authorize()
        if (known.settlement.endChain !== observation.endChain || canonical(known.input) !== canonical(state.input)) {
          reject('GENERATION_RECEIPT_NOT_DURABLE')
        }
      }
      return view(state, observation)
    }
    if (!observation.returned) return view(state, observation)
    try {
      authorize()
      const agent = live().agent
      if (observation.endSeq === undefined || !await ownerCtx.sessions.flush(agent.session)) reject('GENERATION_PERSISTENCE_REQUIRED')
      authorize()
      const persistence = ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(agent.id, 'read')
      let events
      try {
        authorize()
        if (stored.header.id !== sessionId || stored.header.cwd !== agent.session.header.cwd
          || stored.header.agentPreset !== agent.session.header.agentPreset) reject('GENERATION_PERSISTENCE_CONFLICT')
        events = (await stored.read()).events
        authorize()
      } finally { await stored.close() }
      authorize()
      if (observation.endChain === undefined || events.slice(0, observation.endSeq).reduce(extendNativeEventChain,
        '') !== observation.endChain) reject('GENERATION_RECEIPT_NOT_DURABLE')
      const interval = events.slice(observation.startSeq, observation.endSeq)
      const starts = interval.filter(event => event.type === 'turn/start'), ends = interval.filter(event => event.type === 'turn/end')
      const users = interval.filter(event => event.type === 'user/message'),
        assistants = interval.filter(event => event.type === 'assistant/message')
      const ending = ends[0]?.data.reason
      const originalStopped = state.stopped && ending?.kind === 'aborted' && ending.reason.kind === 'hook'
        && ending.reason.reason === 'GENERATION_STOPPED'
      const contextSeqs = new Set(observation.runtimeContexts.map(value => value.seq))
      const originalUsers = users.filter(event => !contextSeqs.has(event.seq))
      if (starts.length !== 1 || ends.length !== 1 || users.length !== 1 + observation.runtimeContexts.length
        || originalUsers.length !== 1 || canonical(originalUsers[0]?.data) !== canonical(state.input)
        || !(ending?.kind === 'completed' || ending?.kind === 'max-tokens' || originalStopped)
        || starts[0]?.data.turn !== ends[0]?.data.turn
        || interval.some(event => event.type === 'assistant/attempt') || observation.requests.length === 0
        || assistants.length !== observation.requests.length
          || state.dispatched.size !== observation.requests.length) reject('GENERATION_SETTLEMENT_UNKNOWN')
      const runtimeContexts = observation.runtimeContexts.map((context) => {
        const event = users.find(value => value.seq === context.seq)
        if (event === undefined || canonical(event.data) !== canonical(context.message)) reject('GENERATION_RUNTIME_CONTEXT_CONFLICT')
        return { seq: context.seq, messageId: context.message.id, messageDigest: digest(context.message) }
      })
      const total: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      for (const record of observation.requests) {
        const durable = assistants.find(event => event.seq === record.assistantSeq)
        const finishes = record.stream.filter((item): item is Extract<AssistantStreamRecord,
          { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'finish')
        const usages = record.stream.filter((item): item is Extract<AssistantStreamRecord,
          { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'usage')
        const finish = finishes[0]?.chunk, observed = usages[0]?.chunk
        if (durable === undefined || durable.data.interrupted === true || durable.data.turn !== starts[0]?.data.turn
          || durable.data.turn !== record.turn || durable.data.step !== record.step || !state.dispatched.has(record.options)
          || canonical(durable.data.stream) !== canonical(record.stream) || finishes.length !== 1 || usages.length !== 1
          || finish?.type !== 'finish' || !['stop', 'tool-calls', 'max-tokens'].includes(finish.reason.kind)
          || observed?.type !== 'usage' || !usage(observed.usage)
            || canonical(durable.data.usage) !== canonical(observed.usage)) reject('GENERATION_SETTLEMENT_UNKNOWN')
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
      const cachedReceipt = (value: GenerationState): OwnedNativeGenerationReceipt | null => value.receipt
      if (cachedReceipt(state) !== null) return view(state, observation)
      const receipt: OwnedNativeGenerationReceipt = Object.freeze({ [receiptBrand]: true as const, sourceId, sessionId,
        inputMessageId: state.input.id, activityCounter: observation.counter, startSeq: observation.startSeq,
        endSeq: observation.endSeq, windowDigest: digest(interval), bindingDigest: digest(state.binding) })
      if (journal !== undefined) journal.settle(state.journalKey ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED'), {
        activityCounter: observation.counter, endSeq: observation.endSeq, endChain: observation.endChain,
        windowDigest: digest(interval), originalReturned: true,
        runtimeContexts,
        usage: total, responses: observation.requests.map(request => ({ assistantSeq: request.assistantSeq ?? reject('GENERATION_ASSISTANT_REQUIRED'),
          turn: request.turn, step: request.step, streamDigest: digest(request.stream),
          usage: assistants.find(event => event.seq === request.assistantSeq)?.data.usage ?? reject('GENERATION_USAGE_INCOMPLETE') })) })
      state.receipt = receipt
      state.observedUsage = Object.freeze(total)
      state.reason = null
      receipts.set(receipt, { source: source ?? reject('GENERATION_SOURCE_NOT_ATTACHED'), bindingDigest: digest(state.binding),
        inputWindow: deepFreeze({ sessionId, inputMessageId: state.input.id, startSeq: observation.startSeq,
          endSeq: observation.endSeq, runtimeContexts, runtimeContextMessageIds: runtimeContexts.map(value => value.messageId) }) })
      historyDigest = observation.endChain
    } catch (error: unknown) {
      state.reason = error !== null && typeof error === 'object' && 'code' in error
        && typeof error.code === 'string' ? error.code : 'GENERATION_SETTLEMENT_UNKNOWN'
    }
    return view(state, observation)
  }
  const restore = async (binding: NativeGenerationBinding, authority?: () => void): Promise<OwnedNativeGeneration> => {
    live(); tools()
    if (journal?.mode !== 'resume') reject('GENERATION_RESTORE_UNAVAILABLE')
    authority?.()
    const known = await journal.readKnown(binding)
    authority?.()
    const state: GenerationState = { binding: deepFreeze(structuredClone(known.binding)), input: deepFreeze(structuredClone(known.input)),
      dispatched: new Set(), receipt: null, observedUsage: null, reason: null, stopped: true, initial: integrity(),
      ...(authority === undefined ? {} : { readAuthority: authority }), restoredProof: async () => {
        authority?.(); const current = await journal.readKnown(binding); authority?.()
        if (digest(current) !== digest(known)) reject('GENERATION_HISTORY_SELECTOR_CHANGED')
      } }
    if (authority === undefined) check(state)
    const sealed = known.settlement
    const receipt: OwnedNativeGenerationReceipt = Object.freeze({ [receiptBrand]: true as const, sourceId,
      originalSourceId: journal.sourceId, sessionId, inputMessageId: state.input.id, activityCounter: sealed.activityCounter,
      startSeq: known.startSeq, endSeq: sealed.endSeq, windowDigest: sealed.windowDigest, bindingDigest: digest(state.binding) })
    state.receipt = receipt; state.observedUsage = Object.freeze({ ...sealed.usage })
    state.restoredView = Object.freeze({ binding: state.binding, inputMessageId: state.input.id, activityCounter: sealed.activityCounter,
      requestCount: sealed.responses.length, local: 'returned', remote: 'settled', usageKnown: true,
      usage: state.observedUsage, receipt, reason: null })
    receipts.set(receipt, { source: source ?? reject('GENERATION_SOURCE_NOT_ATTACHED'), bindingDigest: digest(state.binding),
      inputWindow: deepFreeze({ sessionId, inputMessageId: state.input.id, startSeq: known.startSeq, endSeq: sealed.endSeq,
        runtimeContexts: structuredClone(sealed.runtimeContexts),
        runtimeContextMessageIds: sealed.runtimeContexts.map(value => value.messageId) }) })
    const generation = Object.freeze({}) as OwnedNativeGeneration
    generations.set(generation, state)
    return generation
  }
  const cancel = async (generation: OwnedNativeGeneration, timeoutMs = 2000, authority?: () => void): Promise<NativeGenerationView> => {
    const state = get(generation), port = activityPort ?? reject('GENERATION_SOURCE_NOT_ATTACHED')
    const authorize = authorizeState.bind(undefined, state, authority)
    authorize()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) reject('GENERATION_DRAIN_BOUND_REQUIRED')
    state.stopped = true
    if (state.activity === undefined) return inspect(generation, authority)
    const activity = state.activity
    port.cancel(activity)
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([port.done(activity).catch((_error: unknown) => {}),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) })]) }
    finally { if (timer !== undefined) clearTimeout(timer) }
    authorize()
    return inspect(generation, authority)
  }
  const proveDurable = async (authorize: () => void): Promise<void> => {
    authorize()
    const agent = live().agent, expected = integrity()
    if (!await ownerCtx.sessions.flush(agent.session)) reject('GENERATION_PERSISTENCE_REQUIRED')
    authorize()
    const persistence = ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
    const stored = await persistence.open(agent.id, 'read')
    try {
      authorize()
      const events = (await stored.read()).events
      authorize()
      if (events.length !== expected.seq || events.reduce(extendNativeEventChain, '') !== expected.chain
        || nativeEventDigest({ ...stored.header, delegationDepth: stored.header.delegationDepth ?? 0 })
          !== nativeEventDigest({ ...agent.session.header, delegationDepth: agent.session.header.delegationDepth ?? 0 })) {
        reject('GENERATION_ARCHIVE_DURABLE_CONFLICT')
      }
    } finally { await stored.close() }
    authorize()
    if (integrity().chain !== expected.chain) reject('GENERATION_ARCHIVE_DURABLE_CONFLICT')
  }
  const attach = (actual: AgentHandle, attachment?: { readonly delegateTool?: ToolDefinition }): OwnedGenerationSource => {
    journal?.assertActive(); lineage?.assertDispatch()
    if (handle !== undefined) reject('GENERATION_SOURCE_ALREADY_ATTACHED')
    const port = openNativeAgentActivity(actual, ownerCtx)
    if (journal !== undefined) port.assertProtectedBirth(protectedModelCalls)
    if (attachment?.delegateTool !== undefined) {
      if (role !== 'main' || attachment.delegateTool.name !== 'dsh_bot_delegate'
        || delegateTool !== undefined && delegateTool !== attachment.delegateTool) reject('GENERATION_TOOL_POLICY_REQUIRED')
      delegateTool = attachment.delegateTool
      freezeOwnedDelegateDefinition(delegateTool)
    }
    if (role === 'main' && delegateTool === undefined) reject('GENERATION_TOOL_POLICY_REQUIRED')
    if (lineage === undefined && actual.agent.session.header.origin === 'subagent') reject('GENERATION_CHILD_PARENT_CAPABILITY_REQUIRED')
    if (lineage !== undefined && (actual.agent.session.header.parentSession !== lineage.parentSessionId
      || actual.agent.session.header.origin !== 'subagent' || actual.agent.session.header.delegationDepth !== lineage.nativeDepth
      || !ownerCtx.agents.isOwnedBy(actual.agent.id, lineage.parentAgent))) reject('GENERATION_CHILD_NATIVE_LINEAGE_CONFLICT')
    const initialState = ownerCtx.sessionProjections.stateOf(actual.agent.session,
      'nativeActivityIntegrity') ?? reject('GENERATION_INTEGRITY_REQUIRED')
    const expectedInitialization = initialization === undefined ? [] : [
      { type: 'permission/preset', data: { preset: initialization.permissionPreset } },
      { type: 'sandbox/mode', data: { mode: initialization.sandboxMode } },
      { type: 'approval/policy', data: { policy: initialization.approvalPolicy } },
    ]
    if (actual.agent.id !== sessionId || journal?.mode !== 'resume' && (initialState.seq !== expectedInitialization.length
      || canonical(initialState.initial.slice(0, initialState.seq)) !== canonical(expectedInitialization))
      || actual.agent.inbox.nextTurn.length !== 0 || actual.agent.inbox.nextStep.length !== 0) reject('GENERATION_BLANK_SESSION_REQUIRED')
    handle = actual; activityPort = port
    toolDigest = toolPolicyDigest(); toolExecute = toolMethod('execute'); toolRender = toolMethod('render')
    tools(true)
    if (journal !== undefined) journal.attach(actual.agent.session.header, initialState, toolDigest)
    historyDigest = initialState.chain
    source = Object.freeze({
      start: (binding: NativeGenerationBinding, input: UserMessage): OwnedNativeGeneration => {
        live(); tools()
        if (Reflect.has(binding, 'inputMessageId') && Reflect.get(binding, 'inputMessageId') !== input.id
          || Reflect.has(binding, 'messageIdentity') && Reflect.get(binding, 'messageIdentity') !== digest(input)) reject('GENERATION_INPUT_IDENTITY_CONFLICT')
        if (binding.sessionId !== sessionId || typeof binding.botId !== 'string' || binding.botId.length === 0
          || typeof binding.taskId !== 'string' || binding.taskId.length === 0
          || typeof binding.configVersion !== 'string' || binding.configVersion.length === 0 || binding.configVersion.length > 200
          || binding.configVersion.includes('\0') || ['generation', 'botEpoch', 'taskEpoch', 'taskRevision',
          'authorityEpoch'].some((field) => {
          const value: unknown = Reflect.get(binding, field)
          return typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0
        })) reject('GENERATION_BINDING_INVALID')
        if (plannedBinding !== undefined
          && digest(binding) !== digest(plannedBinding)) reject('GENERATION_WORK_PLAN_CONFLICT')
        if (lineage !== undefined && (binding.botId !== lineage.binding.botId || lineage.knownOriginal !== true
          && (binding.botEpoch !== lineage.binding.botEpoch || binding.configVersion !== lineage.binding.configVersion)
            || binding.taskId === lineage.binding.taskId)) reject('GENERATION_CHILD_BINDING_CONFLICT')
        if (active !== undefined && active.receipt === null) reject('GENERATION_PREVIOUS_UNKNOWN')
        const initial = integrity()
        if (initial.chain !== historyDigest) reject('GENERATION_HISTORY_CONFLICT')
        const state: GenerationState = { binding: deepFreeze(structuredClone(binding)), input: deepFreeze(structuredClone(input)),
          dispatched: new Set(), receipt: null, observedUsage: null, reason: null, stopped: false, initial }
        checkDispatch(state)
        journal?.assertCanStart(state.binding, initial)
        const generation = Object.freeze({}) as OwnedNativeGeneration
        generations.set(generation, state)
        active = state
        try {
          if (journal !== undefined) state.journalKey = journal.begin(state.binding, state.input, initial)
          state.activity = port.start(state.input)
        } catch (error: unknown) {
          state.startError = error !== null && typeof error === 'object' && 'code' in error
            && typeof error.code === 'string' ? error.code : 'GENERATION_START_UNKNOWN'
          state.reason = state.startError
        }
        return generation
      },
      restore,
      restoreKnown: async (selector: OwnedGenerationHistorySelector): Promise<OwnedNativeGeneration> => {
        live(); tools()
        const actualJournal = journalCapability ?? reject('GENERATION_JOURNAL_CAPABILITY_REQUIRED')
        if (journal?.mode !== 'resume') reject('GENERATION_RESTORE_UNAVAILABLE')
        const selected = openNativeGenerationHistorySelector(selector, actualJournal, ownerCtx)
        const authorize = (): void => { live(); tools(); journal.assertActive(); selected.authorize() }
        await proveDurable(authorize); authorize()
        await selected.read(); authorize()
        return restore(selected.binding, authorize)
      },
      inspect,
      cancel,

    })
    const prepareChild = options.workDelegate === undefined || lineage !== undefined ? undefined
      : (generation: OwnedNativeGeneration, childOptions: OwnedChildGenerationOptions): PreparedOwnedGenerationSource => {
        const original = get(generation)
        checkDispatch(original)
        const activity = original.activity ?? reject('GENERATION_PARENT_ACTIVITY_REQUIRED')
        const observation = port.inspect(activity), frame = integrity().lastEvent
        const lastRequest = observation.requests.at(-1)
        const calls = lastRequest === undefined ? [] : assembleAssistantStream(lastRequest.stream).blocks().filter(block => block.type === 'tool-call')
        if (active !== original || observation.returned || frame?.type !== 'tool/call' || !recordToolCall(frame.data, calls)
          || childOptions.providerFactory !== providerFactory
            || childOptions.sessionId === sessionId) reject('GENERATION_ORIGINAL_DELEGATE_REQUIRED')
        const assertDispatch = (): void => {
          if (active !== original) reject('GENERATION_PARENT_GENERATION_CHANGED')
          checkDispatch(original)
        }
        if (childOptions.journal !== undefined && journal === undefined) reject('GENERATION_PARENT_JOURNAL_REQUIRED')
        if (!record(frame.data) || typeof frame.data.callId !== 'string') reject('GENERATION_ORIGINAL_DELEGATE_REQUIRED')
        const actual = live().agent
        const nativeDepth = (actual.session.header.delegationDepth ?? 0) + 1
        const nativeLineage = journal === undefined ? undefined : deepFreeze({ parentSourceId: journal.sourceId,
          parentBinding: original.binding, parentInput: original.input, toolCallId: frame.data.callId, toolCallSeq: frame.seq,
          childSessionId: childOptions.sessionId, nativeDepth })
        return prepareSource({ ...childOptions, role: 'work' }, { parentSessionId: sessionId,
          parentAgent: actual, nativeDepth, binding: original.binding, assertDispatch,
          ...(nativeLineage === undefined ? {} : { original: nativeLineage }) })
      }
    const prepareKnownChild = options.workDelegate === undefined || lineage !== undefined || journal === undefined ? undefined
      : async (generation: OwnedNativeGeneration, input: OwnedChildGenerationOptions): Promise<PreparedOwnedGenerationSource> => {
        const original = get(generation)
        if (original.restoredView === undefined || original.readAuthority === undefined || original.receipt === null
          || input.providerFactory !== providerFactory || input.journal === undefined) reject('GENERATION_KNOWN_PARENT_CAPABILITY_REQUIRED')
        const childOptions = input
        const authorize = (): void => {
          live(); tools(); journal.assertActive(); original.readAuthority?.()
          if (active === undefined) port.assertNoReplacement()
          else {
            const activity = active.activity ?? reject('GENERATION_PARENT_ACTIVITY_REQUIRED')
            port.assertNoReplacement(activity)
            check(active)
            const receipt = active.receipt ?? reject('GENERATION_KNOWN_PARENT_ACTIVITY_REQUIRED')
            const retained = receipts.get(receipt)
            if (!port.inspect(activity).returned || retained === undefined || retained.source !== source
              || retained.bindingDigest !== digest(active.binding)) reject('GENERATION_KNOWN_PARENT_ACTIVITY_REQUIRED')
            journal.assertLatest(active.journalKey ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED'))
          }
          if (integrity().chain !== historyDigest) reject('GENERATION_PARENT_HISTORY_CONFLICT')
        }
        const proveDispatch = async (): Promise<void> => {
          authorize()
          const admitted = active
          await proveDurable(authorize); authorize()
          await journal.proveFullKnown(); authorize()
          if (active !== admitted) reject('GENERATION_PARENT_GENERATION_CHANGED')
        }
        authorize()
        const childJournal = openNativeGenerationJournalPort(childOptions.journal ?? reject('GENERATION_JOURNAL_CAPABILITY_REQUIRED'),
          { ...childOptions, role: 'work' })
        const nativeLineage = await childJournal.readOriginalParent(); authorize()
        if (nativeLineage.parentSourceId !== journal.sourceId || digest(nativeLineage.parentBinding) !== digest(original.binding)
          || canonical(nativeLineage.parentInput) !== canonical(original.input) || nativeLineage.childSessionId !== childOptions.sessionId
          || nativeLineage.nativeDepth !== 1) reject('GENERATION_ORIGINAL_PARENT_JOURNAL_REQUIRED')
        await journal.proveOriginalDelegate(nativeLineage); authorize()
        await proveDispatch(); authorize()
        const actual = live().agent
        return prepareSource({ ...childOptions, role: 'work' }, { parentSessionId: sessionId, parentAgent: actual,
          nativeDepth: nativeLineage.nativeDepth, binding: original.binding, assertDispatch: authorize, proveDispatch,
          original: nativeLineage, knownOriginal: true })
      }
    const planWork = plannedBinding === undefined ? undefined : (binding: OwnedWorkGenerationBinding): void => {
      live(); tools()
      if (active !== undefined && active.receipt === null) reject('GENERATION_PREVIOUS_UNKNOWN')
      const next = deepFreeze(structuredClone(binding))
      assertWorkBinding(next)
      if (next.sessionId !== sessionId || next.botId !== plannedBinding?.botId || next.taskId !== plannedBinding.taskId
        || next.generation < plannedBinding.generation
        || next.generation === plannedBinding.generation && digest(next) !== digest(plannedBinding)) reject('GENERATION_WORK_PLAN_CONFLICT')
      const accepted: unknown = current(next)
      if (accepted !== true) {
        if (accepted !== null && typeof accepted === 'object' && 'then' in accepted) void Promise.resolve(accepted).catch((_error: unknown) => {})
        reject('GENERATION_BINDING_STALE')
      }
      plannedBinding = next
    }
    if (journal !== undefined) {
      const attached = integrity()
      const controlActive = (): void => { live(); tools(); journal.assertActive() }
      const assertResumable = (): void => {
        controlActive()
        if (journal.mode !== 'resume' || integrity().chain !== attached.chain) reject('GENERATION_RESUME_ORIGINAL_REQUIRED')
        port.assertNoReplacement()
      }
      bindNativeSourceControlPort(source, { ownerCtx, sessionId, assertActive: controlActive,
        original: (generation, binding) => {
          const state = get(generation)
          if (digest(state.binding) !== digest(binding)) reject('GENERATION_CONTROL_BINDING_REQUIRED')
          if (state.readAuthority === undefined) check(state); else state.readAuthority()
          const key = state.journalKey ?? (state.restoredView === undefined ? reject('GENERATION_JOURNAL_INTENT_REQUIRED')
            : digest({ binding: state.binding, input: state.input }))
          const assertOriginal = (): void => {
            controlActive(); journal.assertLatest(key)
            if (state.activity === undefined && state.restoredView === undefined) reject('GENERATION_ACTIVITY_REQUIRED')
            port.assertNoReplacement(state.activity)
          }
          return Object.freeze({ assertOriginal, fence: () => { assertOriginal(); journal.fence(key); state.stopped = true },
            inspect: (authorize: () => void) => inspect(generation, authorize),
            cancel: (timeoutMs: number | undefined, authorize: () => void) => cancel(generation, timeoutMs, authorize) })
        },
        assertBlank: (intent) => { controlActive(); port.assertNoReplacement(); journal.assertBlank(intent, integrity()) },
        fenceBlank: (intent) => {
          controlActive(); port.assertNoReplacement(); journal.assertBlank(intent, integrity()); journal.fence(digest(intent))
        },
        proveDurable,
        assertResumable,
        proveKnown: async (authorize) => { await proveDurable(authorize); authorize(); await journal.proveFullKnown(); authorize() },
        clearFence: () => { assertResumable(); journal.clearFence() },
      })
    }
    sources.set(source, { ownerCtx, ...(prepareChild === undefined ? {} : { prepareChild }),
      ...(prepareKnownChild === undefined ? {} : { prepareKnownChild }),
      ...(planWork === undefined ? {} : { planWork }) })
    return source
  }
  const prepared = Object.freeze({ mode: journal?.mode ?? 'create', protectedModelCalls, attach,
    ...(lineage === undefined ? {} : { parentAgent: lineage.parentAgent }) })
  preparations.set(prepared, { ownerCtx, sessionId, role, assertActive: () => {
    ownerCtx.fiber.assertActive(); journal?.assertActive(); lineage?.assertDispatch()
    if (handle !== undefined) reject('GENERATION_SOURCE_ALREADY_ATTACHED')
  } })
  return prepared
}
function recordToolCall(value: unknown, calls: readonly { type: 'tool-call'; id: string; name: string }[]): boolean {
  return value !== null && typeof value === 'object' && Reflect.get(value, 'name') === 'dsh_bot_delegate'
    && calls.some(call => call.name === 'dsh_bot_delegate' && call.id === Reflect.get(value, 'callId'))
}

/** Bind a retained blank actual native handle before its first input.
 * @param options Same-owner native handle and strict source policy.
 * @returns Private source; GUI creation uses prepareOwnedGenerationSource before mounting.
 */
export function createOwnedGenerationSource(options: Omit<PrepareOwnedGenerationOptions,
  'sessionId'> & { readonly handle: AgentHandle }): OwnedGenerationSource {
  openNativeAgentActivity(options.handle, options.ownerCtx)
  const prepared = prepareOwnedGenerationSource({ ...options, sessionId: options.handle.agent.id })
  options.handle.protectModelCalls?.(prepared.protectedModelCalls)
  return prepared.attach(options.handle)
}
