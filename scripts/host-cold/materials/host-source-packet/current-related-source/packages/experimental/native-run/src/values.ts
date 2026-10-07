/** Strict durable-record parsing and deterministic, non-secret input hashing. */
import { createHash } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { NativeAdmission, NativeOperation, NativeTarget, NativeSessionBinding, NativeSessionReceipt } from './types.ts'
import { NativeOperationId, NativeTargetId } from './ids.ts'

/** Reject a controlled operation with its exact machine-readable reason. */
export function reject(code: string): never { throw new LlmError(code, code) }
/** Encode JSON with sorted object keys; unsupported values reject. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return reject('INVALID_JSON_INPUT')
}
/** Hash only the supplied non-secret input; authentication is never passed here. */
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
/** Reproduce only the accepted zero-tool text Messages projection at final wire validation.
 * Empty native system anchors carry no prompt and are omitted by the provider.
 * @param input Frozen native or direct text history.
 * @returns Canonical user/assistant wire turns, merging adjacent equal roles.
 */
export function textWire(input: readonly RequestMessage[]): Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }> = []
  for (const message of input) {
    if (message.content.some(block => block.type !== 'text')) reject('FINAL_INPUT_CONFLICT')
    if (message.role === 'system' && message.content.every(block => block.type === 'text' && block.text.length === 0)) continue
    if (message.role !== 'user' && message.role !== 'assistant') reject('FINAL_INPUT_CONFLICT')
    const content = message.content.flatMap(block => block.type === 'text' && block.text.length > 0 ? [{ type: 'text' as const, text: block.text }] : [])
    if (message.role === 'user' && content.length === 0) continue
    const previous = messages.at(-1)
    if (previous?.role === message.role) previous.content.push(...content)
    else messages.push({ role: message.role, content })
  }
  return messages
}
/** Narrow a parsed JSON object. */
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
/** Recognize a nonnegative exact integer. */
export function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
/** Validate a journal-local identifier. */
export function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) }
/** Parse the complete persisted native Session relationship.
 * @param value Parsed candidate binding.
 * @returns Validated detached binding.
 */
export function sessionBinding(value: unknown): NativeSessionBinding {
  if (!record(value) || Object.keys(value).length !== 4 || !id(value.sessionId)
    || typeof value.agentPreset !== 'string' || value.agentPreset.length === 0 || value.agentPreset.length > 200
    || typeof value.controlConfigId !== 'string' || value.controlConfigId.length === 0 || value.controlConfigId.length > 200
    || typeof value.cwd !== 'string' || !value.cwd.startsWith('/') || value.cwd.includes('\0')) reject('INVALID_SESSION_BINDING')
  return { sessionId: value.sessionId, agentPreset: value.agentPreset, controlConfigId: value.controlConfigId, cwd: value.cwd }
}
/** Parse exact flushed native settlement coordinates and integrity digests.
 * @param value Candidate receipt.
 * @returns Validated detached receipt.
 */
export function sessionReceipt(value: unknown): NativeSessionReceipt {
  if (!record(value) || Object.keys(value).length !== 8 || !id(value.sessionId)
    || !integer(value.turn) || value.turn < 1 || !integer(value.step) || value.step < 1
    || !integer(value.startSeq) || !integer(value.assistantSeq) || !integer(value.endSeq)
    || value.startSeq > value.assistantSeq || value.assistantSeq >= value.endSeq
    || typeof value.assistantDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.assistantDigest)
    || typeof value.endDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.endDigest)) reject('INVALID_SESSION_RECEIPT')
  return { sessionId: value.sessionId, turn: value.turn, step: value.step, startSeq: value.startSeq,
    assistantSeq: value.assistantSeq, endSeq: value.endSeq, assistantDigest: value.assistantDigest, endDigest: value.endDigest }
}
/** Validate every required authority field read from disk or admission JSON. */
export function target(value: unknown): NativeTarget {
  if (!record(value) || !id(value.id) || value.scopeRef !== 'text-only' || value.provider !== 'deepseek-official'
    || !id(value.model) || !integer(value.maxTokens) || value.maxTokens < 1 || value.reasoningEffort !== 'off'
    || value.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages'
    || !['active', 'revoked', 'archived'].includes(String(value.state))) reject('INVALID_BINDING')
  for (const key of ['runGeneration', 'botEpoch', 'taskEpoch', 'taskRevision', 'authorityEpoch', 'membershipGeneration', 'configVersion']) {
    if (!integer(value[key]) || Number(value[key]) < 1) reject('INVALID_BINDING')
  }
  if (Object.keys(value).length !== (value.sessionBinding === undefined ? 15 : 16)) reject('INVALID_BINDING')
  const state = value.state
  if (state !== 'active' && state !== 'revoked' && state !== 'archived') reject('INVALID_BINDING')
  return { id: NativeTargetId(value.id), runGeneration: Number(value.runGeneration), botEpoch: Number(value.botEpoch), taskEpoch: Number(value.taskEpoch),
    taskRevision: Number(value.taskRevision), authorityEpoch: Number(value.authorityEpoch), membershipGeneration: Number(value.membershipGeneration),
    configVersion: Number(value.configVersion), scopeRef: 'text-only', provider: 'deepseek-official', model: value.model, maxTokens: value.maxTokens,
    reasoningEffort: 'off', endpoint: value.endpoint, state,
    ...value.sessionBinding === undefined ? {} : { sessionBinding: sessionBinding(value.sessionBinding) } }
}
/** Validate one complete immutable queued input. */
export function admission(value: unknown, maxSteps: number): NativeAdmission {
  if (!record(value) || !id(value.id) || !id(value.targetId) || !['contact', 'execution'].includes(String(value.kind))
    || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > maxSteps
    || value.steps.some(step => typeof step !== 'string' || step.length < 1 || Buffer.byteLength(step) > 4096)) reject('INVALID_ADMISSION')
  const binding = target(value.binding)
  if (value.targetId !== binding.id || Object.keys(value).length !== 5) reject('INVALID_ADMISSION')
  const kind = value.kind
  if (kind !== 'contact' && kind !== 'execution') reject('INVALID_ADMISSION')
  return { id: NativeOperationId(value.id), targetId: NativeTargetId(value.targetId), kind, binding,
    steps: value.steps.map(step => typeof step === 'string' ? step : reject('INVALID_ADMISSION')) }
}
/** Hash the admitted text and generation together. */
export function admissionDigest(value: NativeAdmission): string {
  return digest({ id: value.id, targetId: value.targetId, kind: value.kind, binding: value.binding, steps: value.steps })
}
/** Accept usage only from an observed terminal response with exact counts. */
export function usage(value: unknown): value is TokenUsage {
  if (!record(value) || !integer(value.inputTokens) || !integer(value.outputTokens)) return false
  for (const key of ['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (value[key] !== undefined && !integer(value[key])) return false
  }
  const total = Number(value.inputTokens) + Number(value.outputTokens) + Number(value.cacheReadTokens ?? 0) + Number(value.cacheWriteTokens ?? 0)
  return value.totalTokens === undefined || value.totalTokens === total
}
/** Sum independently observed step usage; unknown attempts are never counted as zero. */
export function knownUsage(op: NativeOperation): TokenUsage {
  let inputTokens = 0; let outputTokens = 0; let cacheReadTokens = 0; let cacheWriteTokens = 0
  for (const attempt of op.attempts) {
    if (attempt.usage === null) continue
    inputTokens += attempt.usage.inputTokens; outputTokens += attempt.usage.outputTokens
    cacheReadTokens += attempt.usage.cacheReadTokens ?? 0; cacheWriteTokens += attempt.usage.cacheWriteTokens ?? 0
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens }
}
/** Validate complete durable operation rows before any driver or inspection reads them. */
export function operation(value: unknown, maxSteps: number): NativeOperation {
  if (!record(value)) reject('JOURNAL_CORRUPT')
  let input: NativeAdmission
  try { input = admission({ id: value.id, targetId: value.targetId, kind: value.kind, binding: value.binding, steps: value.steps }, maxSteps) }
  catch (_invalidDurableAdmission) { reject('JOURNAL_CORRUPT') }
  if (!['admitted', 'consumed', 'settled', 'fenced', 'unknown'].includes(String(value.state))
    || !integer(value.nextStep) || !Array.isArray(value.steps) || value.nextStep > value.steps.length
    || !Array.isArray(value.answers) || value.answers.length !== value.nextStep || value.answers.some(v => typeof v !== 'string')
    || !Array.isArray(value.attempts) || !integer(value.reservedTokens) || value.reservedTokens < 1 || value.reservedSlots !== 1
    || typeof value.reservationHeld !== 'boolean' || !['not_started', 'open', 'closed', 'unknown'].includes(String(value.localTransport))
    || !['not_started', 'response_observed', 'unknown'].includes(String(value.remoteExecution))
    || !(value.usage === null || usage(value.usage)) || !(value.failureCode === null || typeof value.failureCode === 'string')) reject('JOURNAL_CORRUPT')
  for (const attempt of value.attempts) {
    if (!record(attempt) || !integer(attempt.step) || attempt.step >= value.steps.length
      || typeof attempt.wireDigest !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.wireDigest)
      || !['intent', 'observed', 'unknown'].includes(String(attempt.state))
      || !(attempt.usage === null || usage(attempt.usage))) reject('JOURNAL_CORRUPT')
    if (attempt.sessionReceipt !== undefined) {
      const receipt = sessionReceipt(attempt.sessionReceipt)
      if (input.binding.sessionBinding === undefined || receipt.sessionId !== input.binding.sessionBinding.sessionId || attempt.state !== 'observed') reject('JOURNAL_CORRUPT')
    }
    if (input.binding.sessionBinding !== undefined && attempt.state === 'observed' && attempt.sessionReceipt === undefined) reject('JOURNAL_CORRUPT')
  }
  const op: NativeOperation = { ...input,
    inputDigest: typeof value.inputDigest === 'string' ? value.inputDigest : reject('JOURNAL_CORRUPT'),
    state: value.state as NativeOperation['state'], nextStep: value.nextStep,
    answers: value.answers.map(answer => typeof answer === 'string' ? answer : reject('JOURNAL_CORRUPT')),
    attempts: value.attempts.map(attempt => ({ step: Number(attempt.step), wireDigest: String(attempt.wireDigest),
      state: attempt.state as NativeOperation['attempts'][number]['state'], usage: attempt.usage === null ? null : usage(attempt.usage) ? attempt.usage : reject('JOURNAL_CORRUPT'),
      ...attempt.sessionReceipt === undefined ? {} : { sessionReceipt: sessionReceipt(attempt.sessionReceipt) } })),
    reservedSlots: 1, reservedTokens: value.reservedTokens, reservationHeld: value.reservationHeld,
    localTransport: value.localTransport as NativeOperation['localTransport'], remoteExecution: value.remoteExecution as NativeOperation['remoteExecution'],
    usage: value.usage === null ? null : usage(value.usage) ? value.usage : reject('JOURNAL_CORRUPT'),
    failureCode: value.failureCode === null ? null : typeof value.failureCode === 'string' ? value.failureCode : reject('JOURNAL_CORRUPT') }
  if (op.inputDigest !== admissionDigest(op) || (op.state === 'unknown' && (!op.reservationHeld || op.usage !== null))
    || (op.state === 'settled' && (op.reservationHeld || op.nextStep !== op.steps.length || op.usage === null))) reject('JOURNAL_CORRUPT')
  return op
}
