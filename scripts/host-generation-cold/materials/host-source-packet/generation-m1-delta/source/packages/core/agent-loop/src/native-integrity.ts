/** Incremental immutable-history coordinates for owned native activity consumers. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Maintained event chain and input/turn counts; this state grants no ownership. */
export interface NativeActivityIntegrity {
  readonly seq: number
  readonly chain: string
  readonly previousChain: string
  readonly users: number
  readonly turnStarts: number
  readonly lastUserDigest: string | null
  readonly lastTurn: number
  readonly toolNames: readonly string[]
  readonly initial: readonly { readonly type: string; readonly data: unknown }[]
  readonly lastEvent: { readonly seq: number; readonly type: string; readonly data: unknown } | null
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { nativeActivityIntegrity: NativeActivityIntegrity }
}

/** Encode the accepted immutable JSON value with stable object-key order.
 * @param value Accepted Session event data.
 * @returns Deterministic JSON for hashing, never an authentication value.
 */
export function nativeEventCanonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(nativeEventCanonical).join(',') + ']'
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + nativeEventCanonical(Reflect.get(value, key))).join(',') + '}'
  }
  throw new Error('NATIVE_INTEGRITY_JSON_REQUIRED')
}
/** Hash one accepted non-secret JSON value.
 * @param value Original event or durable product identity.
 * @returns SHA-256 of canonical JSON.
 */
export const nativeEventDigest = (value: unknown): string => createHash('sha256').update(nativeEventCanonical(value)).digest('hex')
/** Extend the event chain without retaining historical events.
 * @param previous Chain of the complete preceding prefix.
 * @param event Next accepted event in exact sequence order.
 * @returns Chain hash including that event.
 */
export const extendNativeEventChain = (previous: string, event: SessionEvent): string =>
  createHash('sha256').update(previous + '\n' + nativeEventCanonical(event)).digest('hex')

const frameSchema = z.object({ type: z.string(), data: z.unknown() })
const schema: z.ZodType<NativeActivityIntegrity> = z.object({ seq: z.number().int().nonnegative(), chain: z.string(),
  previousChain: z.string(), users: z.number().int().nonnegative(), turnStarts: z.number().int().nonnegative(),
  lastUserDigest: z.string().nullable(), lastTurn: z.number().int().nonnegative(), toolNames: z.array(z.string()),
  initial: z.array(frameSchema), lastEvent: frameSchema.extend({ seq: z.number().int().nonnegative() }).nullable() })

/** Host-only event-order fold used with real native handles and durable readback. */
export const nativeActivityIntegrityDefinition = {
  key: 'nativeActivityIntegrity', stateVersion: 1, stateSchema: schema,
  init: () => ({ seq: 0, chain: '', previousChain: '', users: 0, turnStarts: 0, lastUserDigest: null,
    lastTurn: 0, toolNames: [], initial: [], lastEvent: null }),
  apply: (state, event) => {
    if (event.seq !== state.seq) throw new Error('NATIVE_INTEGRITY_SEQUENCE_CONFLICT')
    return { seq: state.seq + 1, previousChain: state.chain, chain: extendNativeEventChain(state.chain, event),
      users: state.users + (event.type === 'user/message' ? 1 : 0),
      turnStarts: state.turnStarts + (event.type === 'turn/start' ? 1 : 0),
      lastUserDigest: event.type === 'user/message' ? nativeEventDigest(event.data) : state.lastUserDigest,
      lastTurn: event.type === 'turn/start' ? event.data.turn : state.lastTurn,
      toolNames: event.type === 'tool/call' && !state.toolNames.includes(event.data.name)
        ? [...state.toolNames, event.data.name] : state.toolNames,
      initial: state.seq < 3 ? [...state.initial, { type: event.type, data: event.data }] : state.initial,
      lastEvent: { seq: event.seq, type: event.type, data: event.data } }
  },
} satisfies ProjectionDefinition<'nativeActivityIntegrity', NativeActivityIntegrity>
