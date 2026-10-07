/** Owner-only observations of one original native driver execution. */
import type { GenerateOptions, AssistantStreamRecord, ProtectedModelCalls } from '@deepseek-ai/dsh-llm'
import type { SessionSeq, UserMessage } from '@deepseek-ai/dsh-session'

declare const activityBrand: unique symbol
/** Process-local identity minted when the owned input starts its native driver. */
export interface NativeAgentActivity { readonly [activityBrand]: true }
/** One native request and its actual accepted stream, independent of event subscribers. */
export interface NativeActivityRequest {
  readonly options: GenerateOptions
  readonly turn: number
  readonly step: number
  readonly stream: readonly AssistantStreamRecord[]
  readonly assistantSeq?: SessionSeq
}
/** Read-only original execution coordinates; returned never describes a replacement driver. */
export interface NativeActivityObservation {
  readonly counter: number
  readonly input: UserMessage
  readonly startSeq: number
  readonly endSeq?: number
  readonly endChain?: string
  readonly returned: boolean
  readonly requests: readonly NativeActivityRequest[]
  /** Exact snapshots produced by this native loop's RuntimeContextProjection, never source-label recognition. */
  readonly runtimeContexts: readonly { readonly seq: number; readonly message: UserMessage }[]
}
/** Native factory capability retaining exact driver promises and cancellation controllers. */
export interface NativeAgentActivityPort {
  /** Require this exact strict capability to have been passed to the original native constructor, before any setup. */
  assertProtectedBirth(calls: ProtectedModelCalls): void
  /** Assert that no later native driver or queued input replaced the captured original; this is not settlement. */
  assertNoReplacement(activity?: NativeAgentActivity): void
  start(input: UserMessage): NativeAgentActivity
  inspect(activity: NativeAgentActivity): NativeActivityObservation
  ownsRequest(activity: NativeAgentActivity, options: GenerateOptions): boolean
  cancel(activity: NativeAgentActivity): void
  done(activity: NativeAgentActivity): Promise<void>
}
