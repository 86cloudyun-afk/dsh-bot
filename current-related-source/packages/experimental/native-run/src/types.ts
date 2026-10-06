/** Private controlled text-operation data; none of these values authorize a caller. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** Journal-local operation identity supplied by the controller. */
export type NativeOperationId = Branded<'NativeOperationId'>
/** Journal-local target identity; carries no authority. */
export type NativeTargetId = Branded<'NativeTargetId'>
/** Durable control receipt identity; carries no authority. */
export type NativeControlId = Branded<'NativeControlId'>

/** Complete authority generation and explicit text route. */
export interface NativeTarget {
  /** Native Session relationship, required by Session consumers and denied to direct drivers. */
  readonly sessionBinding?: NativeSessionBinding
  readonly id: NativeTargetId
  readonly runGeneration: number
  readonly botEpoch: number
  readonly taskEpoch: number
  readonly taskRevision: number
  readonly authorityEpoch: number
  readonly membershipGeneration: number
  readonly configVersion: number
  readonly scopeRef: 'text-only'
  readonly provider: 'deepseek-official'
  readonly model: string
  readonly maxTokens: number
  readonly reasoningEffort: 'off'
  readonly endpoint: string
  readonly state: 'active' | 'revoked' | 'archived'
}

/** Exact Session/preset relationship; numeric native and opaque control versions stay separate. */
export interface NativeSessionBinding {
  readonly sessionId: string
  readonly agentPreset: string
  readonly controlConfigId: string
  /** Explicit absolute native creation directory; no implicit host default. */
  readonly cwd: string
}

/** Actual flushed native receipt coordinates; text and credentials are not duplicated here. */
export interface NativeSessionReceipt {
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly startSeq: number
  readonly assistantSeq: number
  readonly endSeq: number
  readonly assistantDigest: string
  readonly endDigest: string
}

/** Local consumer lifecycle tracked by the exclusive native writer. */
export interface NativeRunConsumer {
  drainGeneration(targetId: NativeTargetId, generation: number): Promise<boolean>
  abortTarget(targetId: NativeTargetId): void
  close(): Promise<void>
}

/** Separate local slot and token allocations; no account-global quota guarantee. */
export interface NativeCapacity {
  readonly executionSlots: number
  readonly contactSlots: number
  readonly executionTokens: number
  readonly contactTokens: number
  readonly tokenReservationPerStep: number
  readonly maxSteps: number
  readonly admissionDeadlineMs: number
  readonly settlementDeadlineMs: number
}

/** Trusted in-process launcher configuration without tokens, principals or durable grants. */
export interface NativeRunConfig {
  readonly directory: string
  readonly create: boolean
  readonly hostId: string
  readonly targets: readonly NativeTarget[]
  readonly capacity: NativeCapacity
  readonly authorize: (caller: object, action: 'invoke' | 'inspect' | 'control', targetId?: NativeTargetId) => boolean
  /** Bounded readiness wait; native reservation and authority are rechecked afterward. */
  readonly capacityReady?: (signal: AbortSignal) => Promise<void>
}

/** Pending text steps committed together with the complete reservation. */
export interface NativeAdmission {
  readonly id: NativeOperationId
  readonly targetId: NativeTargetId
  readonly kind: 'contact' | 'execution'
  readonly binding: NativeTarget
  readonly steps: readonly string[]
}

/** Native mutations commit on the exclusive writer used by dispatch. */
export type NativeTargetChange =
  | { readonly kind: 'revoke' | 'archive' }
  | { readonly kind: 'restart'; readonly sessionBinding?: NativeSessionBinding }
  | { readonly kind: 'model'; readonly model: string }

/** Durable provider intent; wire contents and authentication are never stored. */
export interface NativeAttempt {
  /** Present only after actual Session persistence validation by its exact consumer. */
  readonly sessionReceipt?: NativeSessionReceipt
  readonly step: number
  readonly wireDigest: string
  readonly state: 'intent' | 'observed' | 'unknown'
  readonly usage: TokenUsage | null
}

/** Journal record consumed by the driver, including pending input. */
export interface NativeOperation extends NativeAdmission {
  readonly inputDigest: string
  readonly state: 'admitted' | 'consumed' | 'settled' | 'fenced' | 'unknown'
  readonly nextStep: number
  readonly answers: readonly string[]
  readonly attempts: readonly NativeAttempt[]
  readonly reservedSlots: number
  readonly reservedTokens: number
  readonly reservationHeld: boolean
  readonly localTransport: 'not_started' | 'open' | 'closed' | 'unknown'
  readonly remoteExecution: 'not_started' | 'response_observed' | 'unknown'
  readonly usage: TokenUsage | null
  readonly failureCode: string | null
}
