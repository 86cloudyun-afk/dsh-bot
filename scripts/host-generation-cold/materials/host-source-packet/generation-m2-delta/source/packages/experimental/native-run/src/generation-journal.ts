/** Exclusive owner journal for original native activity, separate from text-only operations. */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { mkdir, open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { extendNativeEventChain, nativeEventDigest } from '@deepseek-ai/dsh-agent-loop'
import type { NativeActivityIntegrity } from '@deepseek-ai/dsh-agent-loop'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, TokenUsage, AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { DeepSeekDispatchInput } from '@deepseek-ai/dsh-llm-deepseek'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import type { NativeGenerationBinding, PrepareOwnedGenerationOptions } from './generation-source.ts'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { pinGenerationControlAuthority, assertOwnedControlBinding } from './generation-authority.ts'
import type { OwnedGenerationControlAuthority } from './generation-authority.ts'
import { canonical, digest, integer, record, reject, usage } from './values.ts'

const journalBrand: unique symbol = Symbol('owned-native-generation-journal')
/** Process-local journal identity; serialized fields never mint source authority. */
export interface OwnedGenerationJournal { readonly [journalBrand]: true; close(): Promise<void> }
/** Complete original creation data; a main creation does not invent model/task coordinates. */
export interface OwnedGenerationCreationIntent {
  readonly binding: Readonly<Record<string, JsonValue>>
  readonly operationId: string
  readonly nonce: string
}
/** Stable native policy expected before any protected creation or resume. */
export interface OpenOwnedGenerationJournalOptions {
  readonly ownerCtx: Context
  readonly directory: string
  readonly create: boolean
  readonly sessionId: string
  readonly role: 'main' | 'work'
  /** Explicit owner opt-in for parent work; ordinary work and derived children stay zero-tool. */
  readonly toolPolicy?: 'zero' | 'delegate'
  readonly route: LlmCallConfig
  readonly initialization?: PrepareOwnedGenerationOptions['initialization']
  readonly session: { readonly cwd: string; readonly agentPreset: string }
  readonly creationIntent?: OwnedGenerationCreationIntent
}
interface Checkpoint { seq: number; chain: string; headerDigest: string }
interface Dispatch { requestDigest: string; wireDigest: string; endpoint: string }
interface Response { assistantSeq: number; turn: number; step: number; streamDigest: string; usage: TokenUsage }
interface Settlement {
  activityCounter: number
  endSeq: number
  endChain: string
  windowDigest: string
  originalReturned: true
  responses: Response[]
  usage: TokenUsage
  runtimeContexts: Array<{ seq: number; messageId: string; messageDigest: string }>
}
interface Generation {
  key: string
  binding: NativeGenerationBinding
  input: UserMessage
  startSeq: number
  startChain: string
  dispatches: Dispatch[]
  settlement: Settlement | null
}
/** Producer-only original parent binding; callers cannot mint it from serialized lineage. */
export interface NativeOwnedParentLineage {
  readonly parentSourceId: string
  readonly parentBinding: NativeGenerationBinding
  readonly parentInput: UserMessage
  readonly toolCallId: string
  readonly toolCallSeq: number
  readonly childSessionId: string
  readonly nativeDepth: number
}
interface JournalState {
  sourceId: string
  toolDigest: string | null
  checkpoint: Checkpoint | null
  generations: Generation[]
  sessionFence: string | null
  parentLineage: NativeOwnedParentLineage | null
}
/** Internal native producer operations; only the exact journal capability opens this port. */
export interface NativeGenerationJournalPort {
  readonly mode: 'create' | 'resume'
  readonly sourceId: string
  assertActive(): void
  assertParentCapability(derived: boolean): void
  bindOriginalParent(lineage: NativeOwnedParentLineage): void
  readOriginalParent(): Promise<NativeOwnedParentLineage>
  proveOriginalDelegate(lineage: NativeOwnedParentLineage): Promise<void>
  assertUnfenced(): void
  assertLatest(key: string): void
  assertBlank(intent: OwnedGenerationCreationIntent, integrity: NativeActivityIntegrity): void
  fence(subject: string): void
  clearFence(): void
  proveFullKnown(): Promise<void>
  assertKnownPlan(binding: NativeGenerationBinding, expectedDigest: string): void
  readHistory(binding: NativeGenerationBinding): Promise<Generation & { settlement: Settlement }>
  assertToolPolicy(toolDigest: string): void
  assertCanStart(binding: NativeGenerationBinding, integrity: NativeActivityIntegrity): void
  readKnown(binding: NativeGenerationBinding): Promise<Generation & { settlement: Settlement }>
  attach(header: SessionHeader, integrity: NativeActivityIntegrity, toolDigest: string): void
  begin(binding: NativeGenerationBinding, input: UserMessage, integrity: NativeActivityIntegrity): string
  dispatch(key: string, options: GenerateOptions, wire: DeepSeekDispatchInput): void
  settle(key: string, settlement: Settlement): void
}
interface OwnedJournal {
  options: OpenOwnedGenerationJournalOptions
  port: NativeGenerationJournalPort
  assertActive(): void
}
const journals = new WeakMap<object, OwnedJournal>()
declare const historySelectorBrand: unique symbol
/** Read-only selector minted from complete sealed native history under the exclusive journal writer. */
export interface OwnedGenerationHistorySelector { readonly [historySelectorBrand]: true }
const historySelectors = new WeakMap<object, {
  journal: OwnedGenerationJournal
  ownerCtx: Context
  binding: NativeGenerationBinding
  authorize(): void
  assertOriginalPlan(): void
  read(): Promise<Generation & { settlement: Settlement }>
}>()

/** Select exact complete known history under its genuine exclusive journal and current owner grant.
 * @param journal Actual reopened exclusive journal.
 * @param ownerCtx Exact lifecycle owner Context.
 * @param input Full original immutable execution binding.
 * @param authority Pinned live read grant; it does not authorize new dispatch.
 * @returns Opaque historical selector after full durable native history readback.
 */
export async function selectOwnedGenerationHistory(journal: OwnedGenerationJournal, ownerCtx: Context,
  input: NativeGenerationBinding, authority: OwnedGenerationControlAuthority): Promise<OwnedGenerationHistorySelector> {
  const actual = journals.get(journal) ?? reject('GENERATION_JOURNAL_CAPABILITY_REQUIRED')
  const pinned = pinGenerationControlAuthority(authority), binding = deepFreeze(structuredClone(input))
  assertOwnedControlBinding(binding)
  const authorize = (): void => {
    ownerCtx.fiber.assertActive(); actual.assertActive(); pinned.authorize()
    if (actual.options.ownerCtx !== ownerCtx || actual.options.sessionId !== binding.sessionId) reject('GENERATION_HISTORY_OWNER_REQUIRED')
  }
  authorize()
  const known = await actual.port.readHistory(binding)
  authorize()
  const selector = Object.freeze({}) as OwnedGenerationHistorySelector
  historySelectors.set(selector, { journal, ownerCtx, binding, authorize,
    assertOriginalPlan: () => { authorize(); actual.port.assertKnownPlan(binding, digest(known)); authorize() }, read: async () => {
      authorize(); const read = await actual.port.readHistory(binding); authorize()
      if (read.key !== known.key || digest(read) !== digest(known)) reject('GENERATION_HISTORY_SELECTOR_CHANGED')
      return read
    } })
  return selector
}
/** Recognize the genuine live selector for the complete original binding.
 * @param value Candidate opaque selector.
 * @param journal Exact exclusive producing journal.
 * @param ownerCtx Exact current lifecycle owner.
 * @param binding Complete original operation, nonce, lease and product coordinates.
 * @returns Whether the original producer retains this exact live selector.
 */
export function isOwnedGenerationHistorySelector(value: unknown, journal: OwnedGenerationJournal,
  ownerCtx: Context, binding: NativeGenerationBinding): value is OwnedGenerationHistorySelector {
  if (value === null || typeof value !== 'object') return false
  const actual = historySelectors.get(value)
  if (actual?.journal !== journal || actual.ownerCtx !== ownerCtx || digest(actual.binding) !== digest(binding)) return false
  try { actual.authorize(); return true } catch (_invalid: unknown) { return false }
}
/** Internal consumer; only a native source attached to this same journal may retain a historical selector. */
export function openNativeGenerationHistorySelector(selector: OwnedGenerationHistorySelector,
  journal: OwnedGenerationJournal, ownerCtx: Context) {
  const actual = historySelectors.get(selector) ?? reject('GENERATION_HISTORY_SELECTOR_REQUIRED')
  if (actual.journal !== journal || actual.ownerCtx !== ownerCtx) reject('GENERATION_HISTORY_SELECTOR_OWNER_REQUIRED')
  actual.authorize()
  return actual
}
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const completeUsage = (value: unknown): value is TokenUsage => usage(value) && integer(value.totalTokens)
  && Object.keys(value).every(key => ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens',
    'reasoningTokens'].includes(key))
// The physical Session format materializes the omitted top-level delegation depth as zero.
const headerDigest = (header: SessionHeader): string => digest({ ...header, delegationDepth: header.delegationDepth ?? 0 })
const policy = (options: OpenOwnedGenerationJournalOptions) => ({ sessionId: options.sessionId, role: options.role,
  toolPolicy: options.toolPolicy ?? (options.role === 'main' ? 'delegate' : 'zero'),
  route: options.route, session: options.session, creationIntent: options.creationIntent ?? null,
  ...(options.initialization === undefined ? {} : { initialization: options.initialization }) })

/** Recognize the actual exclusive journal for the exact lifecycle owner and native Session.
 * @param value Candidate journal, never parsed metadata.
 * @param ownerCtx Exact runtime owner Context.
 * @param sessionId Original Session identity.
 * @param role Exact main or work role.
 * @returns Whether the native journal minted this capability for those identities.
 */
export function isOwnedGenerationJournal(value: unknown, ownerCtx: Context, sessionId: string,
  role: 'main' | 'work'): value is OwnedGenerationJournal {
  if (value === null || typeof value !== 'object') return false
  const actual = journals.get(value)
  if (actual?.options.ownerCtx !== ownerCtx || actual.options.sessionId !== sessionId || actual.options.role !== role) return false
  try { actual.assertActive(); return true } catch (_closedOrInvalidJournal) { return false }
}
/** Open the producer port after exact capability and policy verification.
 * @param value Actual journal capability retained by its owner.
 * @param options Preparation policy for this original native Session.
 * @returns Native-only durable intent and settlement operations.
 */
export function openNativeGenerationJournalPort(value: OwnedGenerationJournal,
  options: PrepareOwnedGenerationOptions): NativeGenerationJournalPort {
  const actual = journals.get(value) ?? reject('GENERATION_JOURNAL_CAPABILITY_REQUIRED')
  actual.assertActive()
  if (actual.options.ownerCtx !== options.ownerCtx || actual.options.sessionId !== options.sessionId || actual.options.role !== options.role
    || (actual.options.toolPolicy ?? (actual.options.role === 'main' ? 'delegate' : 'zero'))
      !== (options.role === 'main' || options.workDelegate !== undefined ? 'delegate' : 'zero')
    || canonical(actual.options.route) !== canonical(options.route)
    || canonical(actual.options.initialization ?? null) !== canonical(options.initialization ?? null)) reject('GENERATION_JOURNAL_POLICY_CONFLICT')
  return actual.port
}

function parseState(data: unknown): JournalState {
  if (typeof data !== 'string') reject('GENERATION_JOURNAL_CORRUPT')
  const value: unknown = JSON.parse(data)
  if (!record(value) || Object.keys(value).length !== 6 || !(value.toolDigest === null || isHash(value.toolDigest))
    || !(value.sessionFence === null || isHash(value.sessionFence))
    || typeof value.sourceId !== 'string' || value.sourceId.length === 0
    || !Array.isArray(value.generations)) reject('GENERATION_JOURNAL_CORRUPT')
  if (value.checkpoint !== null && (!record(value.checkpoint) || Object.keys(value.checkpoint).length !== 3
    || !integer(value.checkpoint.seq)
    || !isHash(value.checkpoint.headerDigest) || !(value.checkpoint.chain === ''
      || isHash(value.checkpoint.chain)))) reject('GENERATION_JOURNAL_CORRUPT')
  if (value.parentLineage !== null) {
    const parent = value.parentLineage
    if (!record(parent) || Object.keys(parent).length !== 7 || typeof parent.parentSourceId !== 'string' || !parent.parentSourceId
      || !record(parent.parentBinding) || !record(parent.parentInput) || typeof parent.parentInput.id !== 'string'
      || typeof parent.parentInput.role !== 'string' || parent.parentInput.role !== 'user'
      || typeof parent.toolCallId !== 'string' || !parent.toolCallId || !integer(parent.toolCallSeq)
      || typeof parent.childSessionId !== 'string' || !parent.childSessionId || parent.nativeDepth !== 1) reject('GENERATION_PARENT_JOURNAL_CORRUPT')
    assertOwnedControlBinding(parent.parentBinding)
  }
  const keys = new Set<string>()
  for (const row of value.generations) {
    if (!record(row) || Object.keys(row).length !== 7 || !isHash(row.key) || keys.has(row.key) || !record(row.binding) || !record(row.input)
      || typeof row.input.id !== 'string' || !integer(row.startSeq) || !(row.startChain === '' || isHash(row.startChain))
      || !Array.isArray(row.dispatches)) reject('GENERATION_JOURNAL_CORRUPT')
    keys.add(row.key)
    const coordinates = row.binding
    if (['botId', 'taskId', 'sessionId', 'configVersion'].some((key) => {
      const value = coordinates[key]; return typeof value !== 'string' || value.length === 0 || value.length > 200 || value.includes('\0')
    }) || ['generation', 'botEpoch', 'taskEpoch', 'taskRevision', 'authorityEpoch']
      .some(key => !integer(coordinates[key]) || coordinates[key] < 1)) reject('GENERATION_JOURNAL_CORRUPT')
    if (row.key !== digest({ binding: row.binding, input: row.input })) reject('GENERATION_JOURNAL_CORRUPT')
    for (const attempt of row.dispatches) if (!record(attempt) || Object.keys(attempt).length !== 3 || !isHash(attempt.requestDigest)
      || !isHash(attempt.wireDigest)
        || attempt.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages') reject('GENERATION_JOURNAL_CORRUPT')
    if (row.settlement !== null) {
      const sealed = row.settlement
      if (!record(sealed) || Object.keys(sealed).length !== 8 || !integer(sealed.activityCounter)
        || sealed.activityCounter < 1 || !integer(sealed.endSeq) || sealed.endSeq <= row.startSeq || !isHash(sealed.endChain)
        || !isHash(sealed.windowDigest) || sealed.originalReturned !== true || !completeUsage(sealed.usage)
        || !Array.isArray(sealed.responses) || sealed.responses.length === 0
          || sealed.responses.length !== row.dispatches.length || !Array.isArray(sealed.runtimeContexts)) reject('GENERATION_JOURNAL_CORRUPT')
      let previousContextSeq = row.startSeq - 1
      for (const context of sealed.runtimeContexts) {
        if (!record(context) || Object.keys(context).length !== 3 || !integer(context.seq)
          || context.seq <= previousContextSeq || context.seq >= sealed.endSeq || typeof context.messageId !== 'string'
          || context.messageId.length === 0 || !isHash(context.messageDigest)) reject('GENERATION_JOURNAL_CORRUPT')
        previousContextSeq = context.seq
      }
      let previousAssistantSeq = row.startSeq - 1, previousStep = 0
      for (const response of sealed.responses) {
        if (!record(response) || Object.keys(response).length !== 5 || !integer(response.assistantSeq)
        || !integer(response.turn) || response.turn < 1 || !integer(response.step) || response.step < 1
        || response.assistantSeq <= previousAssistantSeq || response.assistantSeq >= sealed.endSeq || response.step <= previousStep
        || !isHash(response.streamDigest) || !completeUsage(response.usage)) reject('GENERATION_JOURNAL_CORRUPT')
        previousAssistantSeq = response.assistantSeq; previousStep = response.step
      }
    }
  }
  // SQLite JSON was validated above; the native producer owns all fields written into it.
  const parsed = { sourceId: value.sourceId, toolDigest: value.toolDigest, checkpoint: value.checkpoint,
    generations: value.generations, sessionFence: value.sessionFence, parentLineage: value.parentLineage }
  return parsed as JournalState
}

function chain(events: readonly SessionEvent[]): string { return events.reduce(extendNativeEventChain, '') }
function validateHistory(state: JournalState, header: SessionHeader, events: readonly SessionEvent[],
  options: OpenOwnedGenerationJournalOptions): void {
  if (state.parentLineage !== null && (state.parentLineage.childSessionId !== header.id
    || state.parentLineage.parentBinding.sessionId !== header.parentSession || header.origin !== 'subagent'
    || state.parentLineage.nativeDepth !== header.delegationDepth)) reject('GENERATION_CHILD_NATIVE_LINEAGE_CONFLICT')
  const checkpoint = state.checkpoint ?? reject('GENERATION_HISTORY_UNSEALED')
  if (checkpoint.seq !== events.length) reject('GENERATION_HISTORY_LENGTH_CONFLICT')
  if (checkpoint.chain !== chain(events)) reject('GENERATION_HISTORY_CHAIN_CONFLICT')
  if (checkpoint.headerDigest !== headerDigest(header)) reject('GENERATION_HISTORY_HEADER_CONFLICT')
  const initialization = options.initialization
  const initial = initialization === undefined ? [] : [
    { type: 'permission/preset', data: { preset: initialization.permissionPreset } },
    { type: 'sandbox/mode', data: { mode: initialization.sandboxMode } },
    { type: 'approval/policy', data: { policy: initialization.approvalPolicy } },
  ]
  if (canonical(events.slice(0, initial.length).map(({ type, data }) => ({ type, data }))) !== canonical(initial)
    || events.some((event, index) => event.seq !== index)) reject('GENERATION_HISTORY_CONFLICT')
  let previousEnd = initial.length, previousGeneration = 0
  const markersOnly = (start: number, end: number): boolean => events.slice(start, end)
    .every(event => event.type === 'session/end-seed' && canonical(event.data) === '{}')
  for (const generation of state.generations) {
    const sealed = generation.settlement ?? reject('GENERATION_PREVIOUS_UNKNOWN')
    if (generation.startSeq < previousEnd || generation.binding.sessionId !== options.sessionId
      || generation.binding.generation <= previousGeneration || !markersOnly(previousEnd,
      generation.startSeq)) reject('GENERATION_HISTORY_CONFLICT')
    const interval = events.slice(generation.startSeq, sealed.endSeq)
    if (chain(events.slice(0, generation.startSeq)) !== generation.startChain || chain(events.slice(0, sealed.endSeq)) !== sealed.endChain
      || digest(interval) !== sealed.windowDigest) reject('GENERATION_HISTORY_CONFLICT')
    const users = interval.filter(event => event.type === 'user/message'), starts = interval.filter(event => event.type === 'turn/start')
    const ends = interval.filter(event => event.type === 'turn/end'),
      assistants = interval.filter(event => event.type === 'assistant/message')
    const contextSeqs = new Set(sealed.runtimeContexts.map(value => value.seq))
    const originalUsers = users.filter(event => !contextSeqs.has(event.seq))
    if (users.length !== 1 + sealed.runtimeContexts.length || originalUsers.length !== 1
      || canonical(originalUsers[0]?.data) !== canonical(generation.input) || starts.length !== 1 || ends.length !== 1
      || starts[0]?.data.turn !== ends[0]?.data.turn || assistants.length !== sealed.responses.length
      || interval.some(event => event.type === 'assistant/attempt')) reject('GENERATION_HISTORY_CONFLICT')
    for (const context of sealed.runtimeContexts) {
      const actual = users.find(event => event.seq === context.seq)
      if (actual?.data.id !== context.messageId || digest(actual.data) !== context.messageDigest) reject('GENERATION_HISTORY_CONFLICT')
    }
    const ending = ends[0]?.data.reason ?? reject('GENERATION_HISTORY_CONFLICT')
    if (!(ending.kind === 'completed' || ending.kind === 'max-tokens' || ending.kind === 'aborted'
      && ending.reason.kind === 'hook' && ending.reason.reason === 'GENERATION_STOPPED')) reject('GENERATION_HISTORY_CONFLICT')
    const total: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    for (const response of sealed.responses) {
      const durable = assistants.find(event => event.seq === response.assistantSeq)
      if (durable === undefined || durable.data.interrupted === true || durable.data.turn !== response.turn
        || durable.data.step !== response.step || durable.data.turn !== starts[0]?.data.turn
        || canonical(durable.data.usage) !== canonical(response.usage) || !Array.isArray(durable.data.stream)
        || digest(durable.data.stream) !== response.streamDigest) reject('GENERATION_HISTORY_CONFLICT')
      const finishes = durable.data.stream.filter((item): item is Extract<AssistantStreamRecord,
        { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'finish')
      const usages = durable.data.stream.filter((item): item is Extract<AssistantStreamRecord,
        { type: 'chunk' }> => item.type === 'chunk' && item.chunk.type === 'usage')
      const finish = finishes[0]?.chunk, observed = usages[0]?.chunk
      if (finishes.length !== 1 || usages.length !== 1 || finish?.type !== 'finish'
        || !['stop', 'tool-calls', 'max-tokens'].includes(finish.reason.kind) || observed?.type !== 'usage'
        || !completeUsage(observed.usage) || canonical(observed.usage) !== canonical(response.usage)
        || canonical(assembleAssistantStream(durable.data.stream).blocks()) !== canonical(durable.data.message.content)) reject('GENERATION_HISTORY_CONFLICT')
      total.inputTokens += response.usage.inputTokens; total.outputTokens += response.usage.outputTokens
      total.totalTokens = (total.totalTokens ?? 0) + (response.usage.totalTokens ?? reject('GENERATION_USAGE_INCOMPLETE'))
      for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
        if (response.usage[field] !== undefined) total[field] = (total[field] ?? 0) + response.usage[field]
      }
    }
    if (!completeUsage(total) || canonical(total) !== canonical(sealed.usage)) reject('GENERATION_HISTORY_CONFLICT')
    previousEnd = sealed.endSeq; previousGeneration = generation.binding.generation
  }
  if (previousEnd > events.length || !markersOnly(previousEnd, events.length)) reject('GENERATION_HISTORY_CONFLICT')
}

/** Acquire a private native writer and verify known history before any resume can wake.
 * @param options Exact owner, original Session, private directory and immutable policy.
 * @returns Exclusive process-local journal capability; UNKNOWN histories reject reopening.
 */
export async function openOwnedGenerationJournal(input: OpenOwnedGenerationJournalOptions): Promise<OwnedGenerationJournal> {
  const options: OpenOwnedGenerationJournalOptions = Object.freeze({ ...input, route: Object.freeze({ ...input.route }),
    session: Object.freeze({ ...input.session }),
    ...(input.creationIntent === undefined ? {} : { creationIntent: deepFreeze(structuredClone(input.creationIntent)) }),
    ...(input.initialization === undefined ? {} : { initialization: Object.freeze({ ...input.initialization }) }) })
  if (!(options.ownerCtx instanceof Context) || !options.sessionId || !['main', 'work'].includes(options.role)
    || options.toolPolicy !== undefined && !['zero', 'delegate'].includes(options.toolPolicy)
    || options.role === 'main' && options.toolPolicy === 'zero'
    || !options.session.cwd.startsWith('/') || !options.session.agentPreset
      || !options.directory.startsWith('/')) reject('GENERATION_JOURNAL_OPTIONS_INVALID')
  options.ownerCtx.fiber.assertActive()
  if (options.creationIntent !== undefined && (Object.keys(options.creationIntent).length !== 3
    || !record(options.creationIntent.binding) || options.creationIntent.binding.sessionId !== options.sessionId
    || options.creationIntent.binding.cwd !== undefined && options.creationIntent.binding.cwd !== options.session.cwd
    || options.creationIntent.binding.agentPreset !== undefined
      && options.creationIntent.binding.agentPreset !== options.session.agentPreset
    || options.creationIntent.binding.operationId !== undefined
      && options.creationIntent.binding.operationId !== options.creationIntent.operationId
    || options.creationIntent.binding.nonce !== undefined && options.creationIntent.binding.nonce !== options.creationIntent.nonce
    || ![options.creationIntent.operationId, options.creationIntent.nonce].every(value => typeof value === 'string'
      && value.length > 0 && value.length <= 200 && !value.includes('\0')))) reject('GENERATION_CREATION_INTENT_INVALID')
  canonical(options.creationIntent ?? null)
  if (options.create) {
    const sessionId = SessionId(options.sessionId)
    if (options.ownerCtx.sessions.get(sessionId) !== undefined || options.ownerCtx.agents.get(sessionId) !== undefined) {
      reject('GENERATION_JOURNAL_BEFORE_NATIVE_CREATION_REQUIRED')
    }
    const persistence = options.ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
    const existing = await persistence.stat(sessionId)
    options.ownerCtx.fiber.assertActive()
    if (existing !== undefined || options.ownerCtx.sessions.get(sessionId) !== undefined
      || options.ownerCtx.agents.get(sessionId) !== undefined) reject('GENERATION_JOURNAL_BEFORE_NATIVE_CREATION_REQUIRED')
  }
  const directory = resolve(options.directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryStat = await stat(directory)
  if (await realpath(directory) !== directory || directoryStat.uid !== process.getuid?.()
    || (directoryStat.mode & 0o077) !== 0) reject('GENERATION_JOURNAL_PRIVATE_DIRECTORY_REQUIRED')
  const lockPath = join(directory, 'writer.lock'), path = join(directory, 'journal.sqlite')
  if (existsSync(lockPath) && lstatSync(lockPath).isSymbolicLink() || existsSync(path)
    && lstatSync(path).isSymbolicLink()) reject('GENERATION_JOURNAL_IDENTITY_CONFLICT')
  const lock: FileHandle = await open(lockPath, 'a+', 0o600)
  let db: DatabaseSync | undefined
  try {
    try { await tryLockExclusive(lock.fd) }
    catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error && ['EAGAIN',
        'EWOULDBLOCK'].includes(String(error.code))) reject('GENERATION_WRITER_CONFLICT')
      throw error
    }
    options.ownerCtx.fiber.assertActive()
    const held = await lock.stat(), current = await stat(lockPath)
    if (held.dev !== current.dev || held.ino !== current.ino) reject('GENERATION_JOURNAL_IDENTITY_CONFLICT')
    if (options.create) { const fresh = await open(path, 'wx', 0o600); await fresh.close() }
    else if (!existsSync(path) || statSync(path).size === 0) reject('GENERATION_JOURNAL_MISSING')
    const identity = statSync(path)
    if (identity.uid !== process.getuid() || (identity.mode & 0o077) !== 0) reject('GENERATION_JOURNAL_PRIVATE_FILE_REQUIRED')
    db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;')
    const database = db
    const expectedPolicy = canonical(policy(options))
    if (options.create) {
      const initial: JournalState = { sourceId: randomUUID(), toolDigest: null, checkpoint: null,
        generations: [], sessionFence: null, parentLineage: null }
      const data = canonical(initial)
      database.exec('CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),format INTEGER NOT NULL,policy TEXT NOT NULL,data TEXT NOT NULL,stateDigest TEXT NOT NULL) STRICT;')
      database.prepare('INSERT INTO meta VALUES(1,2,?,?,?)').run(expectedPolicy, data, digest(initial))
    }
    let closed = false, claimed = false
    const validate = (): JournalState => {
      if (closed) reject('GENERATION_JOURNAL_CLOSED')
      options.ownerCtx.fiber.assertActive()
      const actual = lstatSync(path), actualLock = lstatSync(lockPath)
      if (!actual.isFile() || actual.dev !== identity.dev || actual.ino !== identity.ino || actualLock.dev !== held.dev
        || actualLock.ino !== held.ino) reject('GENERATION_JOURNAL_IDENTITY_CONFLICT')
      const meta = database.prepare('SELECT format,policy,data,stateDigest FROM meta WHERE id=1').get()
      if (meta?.format !== 2 || meta.policy !== expectedPolicy) reject('GENERATION_JOURNAL_POLICY_CONFLICT')
      const state = parseState(meta.data)
      if (meta.stateDigest !== digest(state)) reject('GENERATION_JOURNAL_CORRUPT')
      return state
    }
    const update = (mutate: (state: JournalState) => void): void => {
      const state = validate(); mutate(state)
      const data = canonical(state)
      database.prepare('UPDATE meta SET data=?,stateDigest=? WHERE id=1').run(data, digest(state))
      if (database.prepare('SELECT data FROM meta WHERE id=1').get()?.data !== data) reject('GENERATION_JOURNAL_DURABILITY_CONFLICT')
    }
    const restored = validate()
    if (!options.create) {
      if (restored.generations.some(generation => generation.settlement === null)) reject('GENERATION_PREVIOUS_UNKNOWN')
      const persistence = options.ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(SessionId(options.sessionId), 'read')
      try { validateHistory(restored, stored.header, (await stored.read()).events, options) }
      finally { await stored.close() }
      validate()
    }
    const proveFullKnown = async (): Promise<void> => {
      const state = validate()
      const persistence = options.ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(SessionId(options.sessionId), 'read')
      try { validateHistory(state, stored.header, (await stored.read()).events, options) }
      finally { await stored.close() }
      if (digest(validate()) !== digest(state)) reject('GENERATION_JOURNAL_CHANGED')
    }
    const readOriginalParent = async (): Promise<NativeOwnedParentLineage> => {
      if (options.create) reject('GENERATION_KNOWN_CHILD_REQUIRED')
      await proveFullKnown()
      return deepFreeze(structuredClone(validate().parentLineage ?? reject('GENERATION_CHILD_ORIGIN_UNSEALED')))
    }
    const proveOriginalDelegate = async (lineage: NativeOwnedParentLineage): Promise<void> => {
      const state = validate()
      if (state.sourceId !== lineage.parentSourceId || lineage.parentBinding.sessionId !== options.sessionId) {
        reject('GENERATION_ORIGINAL_PARENT_JOURNAL_REQUIRED')
      }
      const parent = state.generations.find(row => digest(row.binding) === digest(lineage.parentBinding))
        ?? reject('GENERATION_ORIGINAL_PARENT_REQUIRED')
      const sealed = parent.settlement ?? reject('GENERATION_PREVIOUS_UNKNOWN')
      if (canonical(parent.input) !== canonical(lineage.parentInput)) reject('GENERATION_ORIGINAL_PARENT_INPUT_REQUIRED')
      const persistence = options.ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
      const stored = await persistence.open(SessionId(options.sessionId), 'read')
      try {
        const events = (await stored.read()).events
        validateHistory({ ...state, checkpoint: { seq: sealed.endSeq, chain: sealed.endChain,
          headerDigest: state.checkpoint?.headerDigest ?? reject('GENERATION_HISTORY_UNSEALED') },
        generations: state.generations.filter(row => row.settlement !== null && row.settlement.endSeq <= sealed.endSeq) },
        stored.header, events.slice(0, sealed.endSeq), options)
        const call = events[lineage.toolCallSeq]
        const nativeCall = events.slice(parent.startSeq, sealed.endSeq).some(event => event.type === 'assistant/message'
          && assembleAssistantStream(event.data.stream).blocks().some(block => block.type === 'tool-call'
            && block.id === lineage.toolCallId && block.name === 'dsh_bot_delegate'))
        if (lineage.toolCallSeq < parent.startSeq || lineage.toolCallSeq >= sealed.endSeq || call?.type !== 'tool/call'
          || call.data.name !== 'dsh_bot_delegate' || call.data.callId !== lineage.toolCallId || !nativeCall) {
          reject('GENERATION_ORIGINAL_PARENT_DELEGATE_REQUIRED')
        }
      } finally { await stored.close() }
      validate()
    }
    const port: NativeGenerationJournalPort = Object.freeze({
      mode: options.create ? 'create' : 'resume',
      sourceId: restored.sourceId,
      assertActive: (): void => { validate() },
      assertParentCapability: (derived: boolean): void => {
        if (validate().parentLineage !== null && !derived) reject('GENERATION_CHILD_PARENT_CAPABILITY_REQUIRED')
      },
      bindOriginalParent: (lineage: NativeOwnedParentLineage): void => {
        const state = validate()
        if (!options.create) {
          const original = state.parentLineage ?? reject('GENERATION_CHILD_ORIGIN_UNSEALED')
          if (original.parentSourceId !== lineage.parentSourceId || original.childSessionId !== lineage.childSessionId
            || original.nativeDepth !== lineage.nativeDepth || original.parentBinding.botId !== lineage.parentBinding.botId
            || original.parentBinding.taskId !== lineage.parentBinding.taskId
            || original.parentBinding.sessionId !== lineage.parentBinding.sessionId) reject('GENERATION_ORIGINAL_PARENT_JOURNAL_REQUIRED')
          return
        }
        if (claimed || state.generations.length > 0 || state.parentLineage !== null || lineage.childSessionId !== options.sessionId
          || lineage.nativeDepth !== 1) reject('GENERATION_CHILD_ORIGIN_ALREADY_BOUND')
        update((next) => { next.parentLineage = structuredClone(lineage) })
      },
      readOriginalParent,
      proveOriginalDelegate,
      assertUnfenced: (): void => { if (validate().sessionFence !== null) reject('GENERATION_SESSION_ARCHIVED') },
      assertLatest: (key: string): void => {
        if (validate().generations.at(-1)?.key !== key) reject('GENERATION_ARCHIVE_ORIGINAL_REPLACED')
      },
      assertBlank: (intent: OwnedGenerationCreationIntent, integrity: NativeActivityIntegrity): void => {
        const state = validate()
        if (!claimed || options.creationIntent === undefined || digest(options.creationIntent) !== digest(intent)
          || state.generations.length !== 0 || state.checkpoint?.seq !== integrity.seq
          || state.checkpoint.chain !== integrity.chain || integrity.users !== 0 || integrity.turnStarts !== 0
          || integrity.toolNames.length !== 0) reject('GENERATION_ORIGINAL_BLANK_REQUIRED')
      },
      fence: (subject: string): void => { update((state) => {
        if (!isHash(subject) || state.sessionFence !== null && state.sessionFence !== subject) reject('GENERATION_SESSION_FENCE_CONFLICT')
        state.sessionFence = subject
      }) },
      clearFence: (): void => { update((state) => { state.sessionFence = null }) },
      proveFullKnown,
      assertKnownPlan: (binding: NativeGenerationBinding, expectedDigest: string): void => {
        if (options.create) reject('GENERATION_RESTORE_UNAVAILABLE')
        const state = validate()
        if (state.generations.some(row => row.settlement === null)) reject('GENERATION_PREVIOUS_UNKNOWN')
        const known = state.generations.find(row => digest(row.binding) === digest(binding))
          ?? reject('GENERATION_RESTORE_NOT_FOUND')
        if (known.settlement === null || digest(known) !== expectedDigest) reject('GENERATION_HISTORY_SELECTOR_CHANGED')
      },
      readHistory: async (binding: NativeGenerationBinding): Promise<Generation & { settlement: Settlement }> => {
        if (options.create) reject('GENERATION_RESTORE_UNAVAILABLE')
        await proveFullKnown()
        const known = validate().generations.find(row => digest(row.binding) === digest(binding)) ?? reject('GENERATION_RESTORE_NOT_FOUND')
        return deepFreeze({ ...structuredClone(known), settlement: structuredClone(known.settlement ?? reject('GENERATION_PREVIOUS_UNKNOWN')) })
      },
      assertToolPolicy: (toolDigest: string): void => {
        const state = validate()
        if (state.toolDigest !== null && state.toolDigest !== toolDigest) reject('GENERATION_JOURNAL_TOOL_POLICY_CONFLICT')
      },
      assertCanStart: (binding: NativeGenerationBinding, integrity: NativeActivityIntegrity): void => {
        const state = validate()
        if (state.sessionFence !== null) reject('GENERATION_SESSION_ARCHIVED')
        if (!claimed || state.checkpoint?.chain !== integrity.chain
          || state.checkpoint.seq !== integrity.seq) reject('GENERATION_HISTORY_CONFLICT')
        if (state.generations.some(row => row.settlement === null)) reject('GENERATION_PREVIOUS_UNKNOWN')
        if (state.generations.some(row => row.binding.generation >= binding.generation)) reject('GENERATION_ALREADY_CONSUMED')
      },
      readKnown: async (binding: NativeGenerationBinding): Promise<Generation & { settlement: Settlement }> => {
        if (!claimed) reject('GENERATION_RESTORE_UNAVAILABLE')
        const state = validate()
        const known = state.generations.find(row => digest(row.binding) === digest(binding)) ?? reject('GENERATION_RESTORE_NOT_FOUND')
        const sealed = known.settlement ?? reject('GENERATION_PREVIOUS_UNKNOWN')
        const persistence = options.ownerCtx.get('sessionPersistence') ?? reject('GENERATION_PERSISTENCE_REQUIRED')
        const stored = await persistence.open(SessionId(options.sessionId), 'read')
        try {
          const events = (await stored.read()).events
          validateHistory({ ...state, checkpoint: { seq: sealed.endSeq, chain: sealed.endChain,
            headerDigest: state.checkpoint?.headerDigest ?? reject('GENERATION_HISTORY_UNSEALED') },
          generations: state.generations.filter(row => row.settlement !== null && row.settlement.endSeq <= sealed.endSeq) },
          stored.header, events.slice(0, sealed.endSeq), options)
        } finally { await stored.close() }
        validate()
        return { ...known, settlement: sealed }
      },
      attach: (header: SessionHeader, integrity: NativeActivityIntegrity, toolDigest: string): void => {
        if (claimed) reject('GENERATION_JOURNAL_ALREADY_ATTACHED')
        if (header.id !== options.sessionId || header.cwd !== options.session.cwd
          || header.agentPreset !== options.session.agentPreset) reject('GENERATION_JOURNAL_SESSION_CONFLICT')
        update((state) => {
          if (!isHash(toolDigest) || state.toolDigest !== null
            && state.toolDigest !== toolDigest) reject('GENERATION_JOURNAL_TOOL_POLICY_CONFLICT')
          if (state.checkpoint !== null) {
            const checkpoint = state.checkpoint
            const marker = integrity.lastEvent
            if (checkpoint.headerDigest !== headerDigest(header) || !(integrity.seq === checkpoint.seq
              && integrity.chain === checkpoint.chain
              || integrity.seq === checkpoint.seq + 1 && integrity.previousChain === checkpoint.chain
              && marker?.seq === checkpoint.seq && marker.type === 'session/end-seed'
                && canonical(marker.data) === '{}')) reject('GENERATION_HISTORY_CONFLICT')
          }
          state.checkpoint = { seq: integrity.seq, chain: integrity.chain, headerDigest: headerDigest(header) }
          state.toolDigest = toolDigest
        })
        claimed = true
      },
      begin: (binding: NativeGenerationBinding, input: UserMessage, integrity: NativeActivityIntegrity): string => {
        const key = digest({ binding, input })
        update((state) => {
          if (state.sessionFence !== null) reject('GENERATION_SESSION_ARCHIVED')
          if (!claimed || state.checkpoint?.chain !== integrity.chain
            || state.checkpoint.seq !== integrity.seq) reject('GENERATION_HISTORY_CONFLICT')
          if (state.generations.some(row => row.settlement === null || row.key === key)) reject('GENERATION_PREVIOUS_UNKNOWN')
          if (state.generations.some(row => row.binding.generation >= binding.generation)) reject('GENERATION_ALREADY_CONSUMED')
          state.generations.push({ key, binding: structuredClone(binding), input: structuredClone(input), startSeq: integrity.seq,
            startChain: integrity.chain, dispatches: [], settlement: null })
        })
        return key
      },
      dispatch: (key: string, options: GenerateOptions, wire: DeepSeekDispatchInput): void => { update((state) => {
        if (state.sessionFence !== null) reject('GENERATION_SESSION_ARCHIVED')
        const row = state.generations.find(value => value.key === key) ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED')
        if (row.settlement !== null
          || wire.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages') reject('GENERATION_JOURNAL_DISPATCH_CONFLICT')
        const requestDigest = nativeEventDigest({ sessionId: options.sessionId, provider: options.provider, model: options.model,
          maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort, messages: options.messages,
          tools: options.tools ?? [], toolHistory: options.toolHistory ?? null })
        row.dispatches.push({ requestDigest, wireDigest: digest({ endpoint: wire.endpoint, payload: wire.payload }),
          endpoint: wire.endpoint })
      }) },
      settle: (key: string, settlement: Settlement): void => { update((state) => {
        const row = state.generations.find(value => value.key === key) ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED')
        const originalReturned: unknown = Reflect.get(settlement, 'originalReturned')
        if (row.settlement !== null || settlement.responses.length !== row.dispatches.length || originalReturned !== true
          || !completeUsage(settlement.usage)) reject('GENERATION_JOURNAL_SETTLEMENT_CONFLICT')
        row.settlement = structuredClone(settlement)
        state.checkpoint = { seq: settlement.endSeq, chain: settlement.endChain,
          headerDigest: state.checkpoint?.headerDigest ?? reject('GENERATION_JOURNAL_INTENT_REQUIRED') }
      }) },
    })
    const journal: OwnedGenerationJournal = Object.freeze({ [journalBrand]: true as const, close: async (): Promise<void> => {
      if (closed) return
      closed = true
      try { database.close() } finally { await lock.close() }
    } })
    journals.set(journal, { options, port, assertActive: () => { validate() } })
    options.ownerCtx.effect(() => () => journal.close())
    return journal
  } catch (error: unknown) { db?.close(); await lock.close(); throw error }
}
