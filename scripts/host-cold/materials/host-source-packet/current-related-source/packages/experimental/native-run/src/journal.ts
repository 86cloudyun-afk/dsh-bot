/** Exclusive native writer: authority, queued inputs, reservations and provider intents share one SQLite journal. */
import { existsSync, statSync } from 'node:fs'
import { mkdir, open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { DeepSeekAdapterOptions, DeepSeekDispatchInput } from '@deepseek-ai/dsh-llm-deepseek'
import type { GenerateOptions, TokenUsage } from '@deepseek-ai/dsh-llm'
import { NativeRunDriver } from './driver.ts'
import { NativeSessionDriver } from './session-driver.ts'
import type { NativeAdmission, NativeControlId as ControlId, NativeOperation, NativeOperationId, NativeRunConfig, NativeTarget, NativeTargetChange, NativeTargetId, NativeRunConsumer, NativeSessionReceipt } from './types.ts'
import { admission, admissionDigest, canonical, digest, id, integer, knownUsage, operation, record, reject, target, textWire, usage } from './values.ts'

interface JournalIdentity { dev: number; ino: number; lockDev: number; lockIno: number }
interface CapacityView { executionSlotsAvailable: number; contactSlotsAvailable: number; executionTokensAvailable: number; contactTokensAvailable: number }
const SCHEMA_VERSION = 3

/** Native journal owner for one host; its launcher caller policy is process-local and test-only. */
export class NativeRunHost {
  readonly #db: DatabaseSync
  readonly #lock: FileHandle
  readonly #path: string
  readonly #lockPath: string
  readonly #identity: JournalIdentity
  readonly #config: NativeRunConfig
  readonly #drivers = new Set<NativeRunConsumer>()
  readonly #operationOwners = new Map<NativeOperationId, NativeRunConsumer>()
  #closed = false
  #closing = false
  #closePromise: Promise<void> | undefined

  private constructor(config: NativeRunConfig, db: DatabaseSync, lock: FileHandle, identity: JournalIdentity) {
    this.#config = { ...config, capacity: deepFreeze(structuredClone(config.capacity)) }
    this.#db = db; this.#lock = lock
    this.#path = join(config.directory, 'journal.sqlite'); this.#lockPath = join(config.directory, 'writer.lock')
    this.#identity = identity
  }

  /** Acquire the native lock and open a fresh or strictly validated existing journal.
   * @param config Explicit test launcher, target and capacity configuration.
   * @returns The exclusive native journal owner.
   */
  static async open(config: NativeRunConfig): Promise<NativeRunHost> {
    if (typeof config.authorize !== 'function' || !config.hostId || !config.directory) reject('INVALID_HOST_CONFIG')
    for (const value of Object.values(config.capacity)) if (!integer(value) || value < 1) reject('INVALID_HOST_CONFIG')
    for (const spec of config.targets) target(spec)
    await mkdir(config.directory, { recursive: true, mode: 0o700 })
    const lockPath = join(config.directory, 'writer.lock')
    const lock = await open(lockPath, 'a+', 0o600)
    let db: DatabaseSync | undefined
    try {
      try { await tryLockExclusive(lock.fd) }
      catch (error) {
        if (['EAGAIN', 'EWOULDBLOCK'].includes(String((error as NodeJS.ErrnoException).code))) reject('NATIVE_WRITER_CONFLICT')
        throw error
      }
      const held = await lock.stat(); const current = await stat(lockPath)
      if (held.dev !== current.dev || held.ino !== current.ino) reject('NATIVE_WRITER_CONFLICT')
      const path = join(config.directory, 'journal.sqlite')
      if (config.create && existsSync(path)) reject('JOURNAL_ALREADY_EXISTS')
      if (!config.create && (!existsSync(path) || statSync(path).size === 0)) reject('JOURNAL_MISSING')
      if (config.create) { const fresh = await open(path, 'wx', 0o600); await fresh.close() }
      db = new DatabaseSync(path)
      try {
        db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
        if (config.create) {
          db.exec('BEGIN IMMEDIATE; CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1), format INTEGER NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, stateDigest TEXT NOT NULL) STRICT; CREATE TABLE targets(id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT; CREATE TABLE operations(id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT; CREATE TABLE stops(id TEXT PRIMARY KEY, target TEXT NOT NULL, generation INTEGER NOT NULL, operation TEXT NOT NULL) STRICT;')
          db.prepare('INSERT INTO meta VALUES(1,?,?,0,?)').run(SCHEMA_VERSION, canonical({ hostId: config.hostId, capacity: config.capacity }), '')
          for (const spec of config.targets) db.prepare('INSERT INTO targets VALUES(?,?)').run(spec.id, canonical(spec))
          db.prepare('UPDATE meta SET stateDigest=? WHERE id=1').run(digest({ targets: db.prepare('SELECT id,data FROM targets ORDER BY id').all(), operations: [], stops: [] }))
          db.exec('COMMIT')
        }
        const meta = db.prepare('SELECT format,data FROM meta WHERE id=1').get()
        if (meta?.format !== SCHEMA_VERSION || meta.data !== canonical({ hostId: config.hostId, capacity: config.capacity })) reject('JOURNAL_CORRUPT')
      } catch (_invalidJournal) { reject('JOURNAL_CORRUPT') }
      const journalStat = statSync(path)
      const host = new NativeRunHost(config, db, lock, { dev: journalStat.dev, ino: journalStat.ino, lockDev: held.dev, lockIno: held.ino })
      host.#validate()
      host.#transaction(() => {
        for (const op of host.#all()) {
          if (!op.attempts.some(a => a.state === 'intent')) continue
          host.#write({ ...op, state: 'unknown', remoteExecution: 'unknown', usage: null, reservationHeld: true,
            localTransport: 'unknown', failureCode: 'INTENT_OUTCOME_UNKNOWN', attempts: op.attempts.map(a => a.state === 'intent' ? { ...a, state: 'unknown' } : a) })
        }
      })
      return host
    } catch (error) {
      db?.close(); await lock.close(); throw error
    }
  }

  /** Check current calling scope, including same-ID inspection.
   * @param caller Actual calling scope object.
   * @param action Requested invocation, inspection or control.
   * @param targetId Target-specific scope when the operation identifies a target.
   */
  authorize(caller: object, action: 'invoke' | 'inspect' | 'control', targetId?: NativeTargetId): void {
    if (this.#closed) reject('NATIVE_HOST_CLOSED')
    if (action === 'invoke' && this.#closing) reject('NATIVE_HOST_CLOSING')
    if (this.#config.authorize(caller, action, targetId) !== true) reject('CALLER_UNAUTHORIZED')
  }
  /** Read a detached current target without waking a driver.
   * @param caller Actual calling scope with inspection authority.
   * @param targetId Journal-local target identity.
   * @returns The frozen current target binding.
   */
  target(caller: object, targetId: NativeTargetId): NativeTarget {
    this.authorize(caller, 'inspect', targetId); this.#validate()
    return deepFreeze(structuredClone(this.#target(targetId)))
  }
  /** Read a detached durable operation without a model request.
   * @param caller Actual calling scope with current inspection authority.
   * @param operationId Journal-local operation identity.
   * @returns The frozen durable operation.
   */
  inspect(caller: object, operationId: NativeOperationId): NativeOperation {
    this.authorize(caller, 'inspect'); this.#validate()
    const op = this.#read(operationId); this.authorize(caller, 'inspect', op.targetId)
    return deepFreeze(structuredClone(op))
  }
  /** Read journal authority for one Session without deriving operations from JSONL.
   * @param caller Actual owner with inspection authority for every matching target.
   * @param sessionId Exact persisted Session identity.
   * @returns Detached operations belonging to that Session across generations.
   */
  sessionOperations(caller: object, sessionId: string): readonly NativeOperation[] {
    this.authorize(caller, 'inspect'); this.#validate()
    const operations = this.#all().filter(op => op.binding.sessionBinding?.sessionId === sessionId)
    for (const op of operations) this.authorize(caller, 'inspect', op.targetId)
    return deepFreeze(structuredClone(operations))
  }
  /** Commit input, complete binding, deduplication receipt and reservation atomically.
   * @param caller Actual calling scope with invocation authority.
   * @param requested Complete target binding and bounded pending text steps.
   * @returns The committed operation or identical existing receipt.
   */
  async admit(caller: object, requested: NativeAdmission): Promise<NativeOperation> {
    this.authorize(caller, 'invoke', requested.targetId)
    const input = deepFreeze(structuredClone(admission(requested, this.#config.capacity.maxSteps)))
    this.#validate()
    const existing = this.#maybe(input.id)
    if (existing !== undefined) {
      if (existing.inputDigest !== admissionDigest(input)) reject('OPERATION_CONFLICT')
      return this.inspect(caller, input.id)
    }
    if (this.#config.capacityReady !== undefined) {
      const signal = AbortSignal.timeout(this.#config.capacity.admissionDeadlineMs)
      await Promise.race([this.#config.capacityReady(signal), new Promise<never>((_resolve, fail) => signal.addEventListener('abort', () => fail(signal.reason), { once: true }))])
    }
    this.authorize(caller, 'invoke', input.targetId)
    this.#transaction(() => {
      const duplicate = this.#maybe(input.id)
      if (duplicate !== undefined) { if (duplicate.inputDigest !== admissionDigest(input)) reject('OPERATION_CONFLICT'); return }
      this.#binding(input.binding)
      const available = this.#capacity()
      const slots = input.kind === 'contact' ? available.contactSlotsAvailable : available.executionSlotsAvailable
      const tokens = input.kind === 'contact' ? available.contactTokensAvailable : available.executionTokensAvailable
      const reservedTokens = input.steps.length * this.#config.capacity.tokenReservationPerStep
      if (slots < 1 || tokens < reservedTokens || input.binding.maxTokens > this.#config.capacity.tokenReservationPerStep) reject('HOST_CAPACITY_BLOCKED')
      const op: NativeOperation = { ...input, inputDigest: admissionDigest(input), state: 'admitted', nextStep: 0, answers: [], attempts: [],
        reservedSlots: 1, reservedTokens, reservationHeld: true, localTransport: 'not_started', remoteExecution: 'not_started', usage: null, failureCode: null }
      this.#db.prepare('INSERT INTO operations VALUES(?,?)').run(op.id, canonical(op))
    })
    return this.inspect(caller, input.id)
  }
  /** Commit an authority change before cancellation or success receipt.
   * @param caller Actual calling scope with current control authority.
   * @param targetId Target whose authority changes.
   * @param change Explicit revoke, archive, restart or model mutation.
   * @returns The committed current target binding.
   */
  changeTarget(caller: object, targetId: NativeTargetId, change: NativeTargetChange): NativeTarget {
    this.authorize(caller, 'control', targetId)
    this.#transaction(() => {
      const previous = this.#target(targetId)
      const next: NativeTarget = { ...previous, authorityEpoch: previous.authorityEpoch + 1,
        ...(change.kind === 'revoke' ? { state: 'revoked' as const } : {}),
        ...(change.kind === 'archive' ? { state: 'archived' as const, botEpoch: previous.botEpoch + 1 } : {}),
        ...(change.kind === 'restart' ? { state: 'active' as const, runGeneration: previous.runGeneration + 1,
          ...change.sessionBinding === undefined ? {} : { sessionBinding: change.sessionBinding } } : {}),
        ...(change.kind === 'model' ? { model: change.model, configVersion: previous.configVersion + 1 } : {}) }
      target(next); this.#db.prepare('UPDATE targets SET data=? WHERE id=?').run(canonical(next), targetId)
      for (const op of this.#all()) if (op.targetId === targetId && !['settled', 'fenced', 'unknown'].includes(op.state)) this.#fence(op, 'AUTHORITY_REVOKED')
    })
    for (const driver of this.#drivers) driver.abortTarget(targetId)
    return this.target(caller, targetId)
  }
  /** Construct a controlled consumer; arbitrary adapters cannot be substituted.
   * @param dependencies Existing provider dependencies without a dispatch guard override.
   * @returns A consumer registered with this native owner.
   */
  driver(dependencies: Omit<DeepSeekAdapterOptions, 'dispatchControl'>): NativeRunDriver {
    if (this.#closed || this.#closing) reject('NATIVE_HOST_CLOSING')
    return new NativeRunDriver(this, dependencies)
  }
  /** Track consumers so direct construction cannot evade host disposal.
   * @param driver Concrete consumer registered by its constructor.
   */
  registerDriver(driver: NativeRunConsumer): void {
    if (this.#closed || this.#closing) reject('NATIVE_HOST_CLOSING')
    if (!(driver instanceof NativeRunDriver) && !(driver instanceof NativeSessionDriver && driver.hasNativeOwner())) reject('CONTROLLED_PERMIT_REQUIRED')
    this.#drivers.add(driver)
  }
  /** Claim one consumer before asynchronous preparation begins.
   * @param caller Actual calling scope with invocation authority.
   * @param operationId Admitted operation to consume.
   * @param driver Registered concrete consumer claiming local ownership.
   */
  claimDriver(caller: object, operationId: NativeOperationId, driver: NativeRunConsumer): void {
    this.authorize(caller, 'invoke'); this.#validate()
    const op = this.#read(operationId); this.authorize(caller, 'invoke', op.targetId)
    if (!this.#drivers.has(driver)) reject('CONTROLLED_PERMIT_REQUIRED')
    this.#consumerBinding(driver, op)
    if (this.#operationOwners.has(operationId)) reject('OPERATION_DRIVER_CONFLICT')
    this.#operationOwners.set(operationId, driver)
  }
  /** Release only the consumer whose complete local lifecycle returned.
   * @param operationId Operation whose local lifecycle returned.
   * @param driver Exact current consumer owner.
   */
  releaseDriver(operationId: NativeOperationId, driver: NativeRunConsumer): void {
    this.#owner(operationId, driver); this.#operationOwners.delete(operationId)
  }
  /** Abort and drain every consumer after the generation fence is durable.
   * @param caller Actual calling scope with current control authority.
   * @param operationId Operation identifying the already-fenced generation.
   */
  async drainStoppedGeneration(caller: object, operationId: NativeOperationId): Promise<void> {
    const op = this.inspect(caller, operationId); this.authorize(caller, 'control', op.targetId)
    if (this.#db.prepare('SELECT id FROM stops WHERE target=? AND generation=? LIMIT 1').get(op.targetId, op.binding.runGeneration) === undefined) reject('STOP_FENCE_REQUIRED')
    const drained = await Promise.all([...this.#drivers].map(driver => driver.drainGeneration(op.targetId, op.binding.runGeneration)))
    if (drained.every(Boolean)) return
    this.#transaction(() => {
      for (const owned of this.#all()) if (owned.targetId === op.targetId && owned.binding.runGeneration === op.binding.runGeneration && owned.localTransport === 'open') {
        this.#write({ ...owned, localTransport: 'unknown' })
      }
    })
  }
  /** Deployment bound for local drain; expiry never claims remote settlement. */
  get settlementDeadlineMs(): number { return this.#config.capacity.settlementDeadlineMs }
  /** Read remaining local allocations while unknown work retains its reserves.
   * @param caller Actual calling scope with inspection authority.
   * @returns Remaining host-local slots and token allocations.
   */
  capacity(caller: object): CapacityView {
    this.authorize(caller, 'inspect'); this.#validate(); return this.#capacity()
  }
  /** Verify a bound request against the authoritative pending step.
   * @param caller Actual calling scope with current invocation authority.
   * @param operationId Admitted operation identity.
   * @param step Exact pending step index.
   * @returns The frozen journaled operation for this step.
   */
  checkRequest(caller: object, operationId: NativeOperationId, step: number): NativeOperation {
    this.authorize(caller, 'invoke'); this.#validate()
    const op = this.#read(operationId); this.authorize(caller, 'invoke', op.targetId)
    this.#binding(op.binding)
    if (op.state !== 'admitted' || op.nextStep !== step) reject(op.state === 'unknown' ? 'OUTCOME_UNKNOWN_BLOCKED' : 'OPERATION_FENCED')
    return op
  }
  /** Persist an attempt after final synchronous validation; no await is allowed here.
   * @param caller Actual calling scope checked at final dispatch.
   * @param driver Exact consumer owning the operation.
   * @param operationId Journal-local operation identity.
   * @param step Exact pending step index.
   * @param options Frozen request input bound by the controlled consumer.
   * @param wire Frozen endpoint and serialized payload immediately preceding fetch.
   */
  beginAttempt(caller: object, driver: NativeRunConsumer, operationId: NativeOperationId, step: number,
    options: GenerateOptions, wire: DeepSeekDispatchInput): void {
    this.#transaction(() => {
      this.#owner(operationId, driver)
      const op = this.checkRequest(caller, operationId, step)
      this.#consumerBinding(driver, op)
      if (driver instanceof NativeSessionDriver) driver.validateIntent(options, op, step)
      const body: unknown = JSON.parse(wire.payload)
      if (!record(body) || wire.endpoint !== op.binding.endpoint || body.model !== op.binding.model
        || body.max_tokens !== op.binding.maxTokens || body.stream !== true
        || Object.keys(body).some(k => !['model', 'max_tokens', 'stream', 'messages', 'thinking'].includes(k))
        || canonical(body.thinking) !== canonical({ type: 'disabled' })
        || canonical(body.messages) !== canonical(textWire(options.messages))) reject('FINAL_INPUT_CONFLICT')
      this.#write({ ...op, state: 'consumed', localTransport: 'open', remoteExecution: 'unknown', usage: null,
        attempts: [...op.attempts, { step, wireDigest: digest(wire), state: 'intent', usage: null }] })
    })
  }
  /** Record a terminal response; release complete-operation capacity only with known usage.
   * @param driver Exact consumer owning the operation.
   * @param operationId Journal-local operation identity.
   * @param step Exact consumed step index.
   * @param answer Observed terminal text answer.
   * @param observed Independently observed provider token counts.
   * @param receipt Required private native persistence attestation for Session consumers.
   */
  completeStep(driver: NativeRunConsumer, operationId: NativeOperationId, step: number, answer: string,
    observed: TokenUsage, receipt?: NativeSessionReceipt): void {
    this.#transaction(() => {
      this.#owner(operationId, driver)
      const op = this.#read(operationId)
      this.#consumerBinding(driver, op)
      if (driver instanceof NativeSessionDriver) driver.validateReceipt(receipt, op, step, answer, observed)
      else if (receipt !== undefined) reject('UNEXPECTED_SESSION_RECEIPT')
      if (op.state !== 'consumed' || op.nextStep !== step || !usage(observed)) reject('SETTLEMENT_CONFLICT')
      this.#binding(op.binding)
      const attempts = op.attempts.map((a, i) => i === op.attempts.length - 1 ? { ...a, state: 'observed' as const, usage: observed,
        ...receipt === undefined ? {} : { sessionReceipt: receipt } } : a)
      const nextStep = step + 1
      const next: NativeOperation = { ...op, attempts, nextStep, answers: [...op.answers, answer], localTransport: 'closed',
        remoteExecution: 'response_observed', state: nextStep === op.steps.length ? 'settled' : 'admitted',
        reservationHeld: nextStep !== op.steps.length, failureCode: null, usage: null }
      this.#write({ ...next, usage: knownUsage(next) })
    })
  }
  /** Preserve unknown allocations; retain a late local failure alongside known settlement.
   * @param driver Exact consumer whose local lifecycle returned.
   * @param operationId Journal-local operation identity.
   * @param failureCode Non-secret machine-readable failure category.
   */
  failStep(driver: NativeRunConsumer, operationId: NativeOperationId, failureCode: string): void {
    this.#transaction(() => {
      this.#owner(operationId, driver)
      const op = this.#read(operationId)
      if (op.state === 'fenced') return
      if (op.state === 'settled') {
        this.#write({ ...op, failureCode: op.failureCode ?? failureCode })
        return
      }
      if (op.attempts.some(a => a.state === 'intent' || a.state === 'unknown')) {
        this.#write({ ...op, state: 'unknown', usage: null, reservationHeld: true, remoteExecution: 'unknown', localTransport: 'closed', failureCode,
          attempts: op.attempts.map(a => a.state === 'intent' ? { ...a, state: 'unknown' } : a) })
      } else this.#write({ ...op, failureCode })
    })
  }
  /** Persist an exact-generation no-dispatch fence before local abort.
   * @param caller Actual calling scope with current control authority.
   * @param controlId Idempotent journal-local control receipt identity.
   * @param operationId Operation identifying the generation to stop.
   * @returns The durable operation after the stop fence commits.
   */
  stop(caller: object, controlId: ControlId, operationId: NativeOperationId): NativeOperation {
    this.authorize(caller, 'control')
    if (!id(controlId)) reject('INVALID_CONTROL')
    this.#transaction(() => {
      const op = this.#read(operationId); this.authorize(caller, 'control', op.targetId)
      this.#stop(controlId, op)
    })
    return this.inspect(caller, operationId)
  }
  /** Fence only an exact native-owned operation, independently of caller revocation.
   * @param driver Exact consumer owning this operation.
   * @param operationId Owned operation to fence before disposal abort.
   */
  stopOwned(driver: NativeRunConsumer, operationId: NativeOperationId): void {
    this.#transaction(() => {
      this.#owner(operationId, driver)
      const op = this.#read(operationId)
      if (!['settled', 'fenced', 'unknown'].includes(op.state)) this.#fence(op, 'OWNER_DISPOSED')
    })
  }
  /** Retain uncertainty when local transport misses its drain deadline.
   * @param driver Exact consumer still owning the operation.
   * @param operationId Owned operation whose closure is unproven.
   */
  noteUnsettled(driver: NativeRunConsumer, operationId: NativeOperationId): void {
    this.#transaction(() => {
      this.#owner(operationId, driver); const op = this.#read(operationId)
      if (op.localTransport === 'open') this.#write({ ...op, localTransport: 'unknown' })
    })
  }
  /** Drain local consumers before releasing the kernel-owned writer descriptor. */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#closing = true
    const pending = Promise.resolve().then(() => this.#dispose())
    this.#closePromise = pending
    const clear = () => { if (this.#closePromise === pending) this.#closePromise = undefined }
    void pending.then(clear, clear)
    return pending
  }
  async #dispose(): Promise<void> {
    const outcomes = await Promise.allSettled([...this.#drivers].map(driver => driver.close()))
    const failed = outcomes.find(outcome => outcome.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    this.#db.close(); await this.#lock.close(); this.#closed = true
  }
  #stop(controlId: ControlId, op: NativeOperation): void {
    const receipt = this.#db.prepare('SELECT target,generation,operation FROM stops WHERE id=?').get(controlId)
    if (receipt !== undefined && (receipt.target !== op.targetId || receipt.generation !== op.binding.runGeneration || receipt.operation !== op.id)) reject('CONTROL_CONFLICT')
    if (receipt === undefined) this.#db.prepare('INSERT INTO stops VALUES(?,?,?,?)').run(controlId, op.targetId, op.binding.runGeneration, op.id)
    for (const owned of this.#all()) if (owned.targetId === op.targetId && owned.binding.runGeneration === op.binding.runGeneration && !['settled', 'fenced', 'unknown'].includes(owned.state)) this.#fence(owned, 'GENERATION_STOPPED')
  }
  #fence(op: NativeOperation, failureCode: string): void {
    const uncertain = op.attempts.some(a => a.state === 'intent' || a.state === 'unknown')
    this.#write({ ...op, state: uncertain ? 'unknown' : 'fenced', reservationHeld: uncertain,
      remoteExecution: uncertain ? 'unknown' : op.remoteExecution, usage: uncertain ? null : op.attempts.length ? knownUsage(op) : null, failureCode })
  }
  #consumerBinding(driver: NativeRunConsumer, op: NativeOperation): void {
    if (op.binding.sessionBinding === undefined) {
      if (driver instanceof NativeSessionDriver) reject('SESSION_BINDING_REQUIRED')
    } else if (!(driver instanceof NativeSessionDriver)) reject('SESSION_CONSUMER_REQUIRED')
    else driver.validateSessionBinding(op.binding)
  }
  #owner(operationId: NativeOperationId, driver: NativeRunConsumer): void {
    if (this.#operationOwners.get(operationId) !== driver) reject('CONTROLLED_PERMIT_REQUIRED')
  }
  #binding(binding: NativeTarget): void {
    const current = this.#target(binding.id)
    if (current.state !== 'active' || canonical(current) !== canonical(binding)) reject('AUTHORITY_REVOKED')
    if (this.#db.prepare('SELECT id FROM stops WHERE target=? AND generation=? LIMIT 1').get(binding.id, binding.runGeneration) !== undefined) reject('GENERATION_STOPPED')
  }
  #target(targetId: NativeTargetId): NativeTarget {
    const row = this.#db.prepare('SELECT data FROM targets WHERE id=?').get(targetId)
    if (typeof row?.data !== 'string') reject('TARGET_MISSING')
    return target(JSON.parse(row.data))
  }
  #maybe(operationId: NativeOperationId): NativeOperation | undefined {
    const row = this.#db.prepare('SELECT data FROM operations WHERE id=?').get(operationId)
    if (row === undefined) return undefined
    if (typeof row.data !== 'string') reject('JOURNAL_CORRUPT')
    return operation(JSON.parse(row.data), this.#config.capacity.maxSteps)
  }
  #read(operationId: NativeOperationId): NativeOperation { return this.#maybe(operationId) ?? reject('OPERATION_MISSING') }
  #all(): NativeOperation[] {
    return this.#db.prepare('SELECT data FROM operations ORDER BY rowid').all().map(row => {
      if (typeof row.data !== 'string') return reject('JOURNAL_CORRUPT')
      return operation(JSON.parse(row.data), this.#config.capacity.maxSteps)
    })
  }
  #write(op: NativeOperation): void { operation(op, this.#config.capacity.maxSteps); this.#db.prepare('UPDATE operations SET data=? WHERE id=?').run(canonical(op), op.id) }
  #capacity() {
    const c = this.#config.capacity
    let executionSlotsAvailable = c.executionSlots; let contactSlotsAvailable = c.contactSlots
    let executionTokensAvailable = c.executionTokens; let contactTokensAvailable = c.contactTokens
    for (const op of this.#all()) {
      const tokens = (knownUsage(op).totalTokens ?? 0) + (op.reservationHeld ? (op.steps.length - op.nextStep) * c.tokenReservationPerStep : 0)
      if (op.kind === 'contact') { contactSlotsAvailable -= op.reservationHeld ? 1 : 0; contactTokensAvailable -= tokens }
      else { executionSlotsAvailable -= op.reservationHeld ? 1 : 0; executionTokensAvailable -= tokens }
    }
    return { executionSlotsAvailable, contactSlotsAvailable, executionTokensAvailable, contactTokensAvailable }
  }
  #validate(): void {
    if (this.#closed) reject('NATIVE_HOST_CLOSED')
    try {
      const s = statSync(this.#path); const l = statSync(this.#lockPath)
      if (s.dev !== this.#identity.dev || s.ino !== this.#identity.ino || l.dev !== this.#identity.lockDev || l.ino !== this.#identity.lockIno) reject('JOURNAL_CORRUPT')
      const integrity = this.#db.prepare('PRAGMA quick_check').get()
      if (integrity?.quick_check !== 'ok') reject('JOURNAL_CORRUPT')
      const meta = this.#db.prepare('SELECT format,data,revision,stateDigest FROM meta WHERE id=1').get()
      if (meta?.format !== SCHEMA_VERSION || meta.data !== canonical({ hostId: this.#config.hostId, capacity: this.#config.capacity })
        || !integer(meta.revision) || meta.stateDigest !== this.#stateDigest()) reject('JOURNAL_CORRUPT')
      const targets = this.#db.prepare('SELECT id,data FROM targets').all()
      if (targets.length !== this.#config.targets.length) reject('JOURNAL_CORRUPT')
      for (const row of targets) { if (typeof row.data !== 'string' || target(JSON.parse(row.data)).id !== row.id) reject('JOURNAL_CORRUPT') }
      for (const row of this.#db.prepare('SELECT id,target,generation,operation FROM stops').all()) {
        if (!id(row.id) || !id(row.target) || !id(row.operation) || !integer(row.generation) || row.generation < 1) reject('JOURNAL_CORRUPT')
      }
      this.#all()
    } catch (_invalidDurableState) { reject('JOURNAL_CORRUPT') }
  }
  #transaction<T>(effect: () => T): T {
    this.#validate(); this.#db.exec('BEGIN IMMEDIATE')
    try { const result = effect(); this.#db.prepare('UPDATE meta SET revision=revision+1,stateDigest=? WHERE id=1').run(this.#stateDigest()); this.#db.exec('COMMIT'); return result }
    catch (error) { this.#db.exec('ROLLBACK'); throw error }
  }
  #stateDigest(): string {
    return digest({ targets: this.#db.prepare('SELECT id,data FROM targets ORDER BY id').all(), operations: this.#db.prepare('SELECT id,data FROM operations ORDER BY id').all(), stops: this.#db.prepare('SELECT id,target,generation,operation FROM stops ORDER BY id').all() })
  }
}
