/** Private controls retain exact original native identities without authorizing a new input. */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ArchivedSessionGate, openOwnedWorkspaceSessionPort } from '@deepseek-ai/dsh-workspace'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { OwnedGenerationSource, OwnedNativeGeneration, NativeGenerationBinding, NativeGenerationView } from './generation-source.ts'
import type { OwnedGenerationCreationIntent } from './generation-journal.ts'
import { pinGenerationControlAuthority, assertOwnedControlBinding } from './generation-authority.ts'
import type { OwnedGenerationControlAuthority } from './generation-authority.ts'
import { digest, reject } from './values.ts'

/** Durable archive result; local return and remote accounting remain separate. */
export interface OwnedSessionArchiveResult {
  readonly sessionId: string
  readonly archived: true
  readonly original: NativeGenerationView | null
}
/** Exact-original read, cancellation and archive; this capability has no start or factory method. */
export interface OwnedGenerationControl {
  inspect(): Promise<NativeGenerationView>
  cancel(timeoutMs?: number): Promise<NativeGenerationView>
  archive(): Promise<OwnedSessionArchiveResult>
}
/** A complete original empty creation has no fabricated generation or cancel capability. */
export interface OwnedBlankSessionControl { archive(): Promise<OwnedSessionArchiveResult> }
export interface NativeOriginalControlPort {
  assertOriginal(): void
  fence(): void
  inspect(authorize: () => void): Promise<NativeGenerationView>
  cancel(timeoutMs: number | undefined, authorize: () => void): Promise<NativeGenerationView>
}
/** Internal native closures, opened only by the actual attached source. */
export interface NativeSourceControlPort {
  readonly ownerCtx: Context
  readonly sessionId: string
  assertActive(): void
  original(generation: OwnedNativeGeneration, binding: NativeGenerationBinding): NativeOriginalControlPort
  assertBlank(intent: OwnedGenerationCreationIntent): void
  fenceBlank(intent: OwnedGenerationCreationIntent): void
  proveDurable(authorize: () => void): Promise<void>
  assertResumable(): void
  proveKnown(authorize: () => void): Promise<void>
  clearFence(): void
}
const sourcePorts = new WeakMap<object, NativeSourceControlPort>()
const gates = new WeakMap<Context, { assertActive(): void }>()
const controls = new WeakMap<object, {
  source: OwnedGenerationSource
  generation: OwnedNativeGeneration
  ownerCtx: Context
  bindingDigest: string
  authorize(): void
}>()
const blanks = new WeakMap<object, { source: OwnedGenerationSource; ownerCtx: Context; intentDigest: string; authorize(): void }>()

export function bindNativeSourceControlPort(source: OwnedGenerationSource, port: NativeSourceControlPort): void {
  if (sourcePorts.has(source)) reject('GENERATION_SOURCE_CONTROL_ALREADY_BOUND')
  sourcePorts.set(source, Object.freeze(port))
}
function owned(source: OwnedGenerationSource, ownerCtx: Context): NativeSourceControlPort {
  const port = sourcePorts.get(source) ?? reject('GENERATION_SOURCE_REQUIRED')
  if (port.ownerCtx !== ownerCtx) reject('GENERATION_SOURCE_OWNER_REQUIRED')
  port.assertActive()
  return port
}
function gate(ownerCtx: Context): void {
  ownerCtx.fiber.assertActive()
  ;(gates.get(ownerCtx) ?? reject('GENERATION_ARCHIVE_GATE_REQUIRED')).assertActive()
}
/** Mount the actual stock lineage gate privately without any controller or RPC plugin.
 * @param ownerCtx Exact native source owner with the actual Workspace registry.
 */
export async function mountOwnedGenerationArchiveGate(ownerCtx: Context): Promise<void> {
  ownerCtx.fiber.assertActive()
  openOwnedWorkspaceSessionPort(ownerCtx.workspaceRegistry, ownerCtx)
  const existing = gates.get(ownerCtx)
  if (existing !== undefined) { existing.assertActive(); return }
  const fiber = ownerCtx.plugin(ArchivedSessionGate)
  gates.set(ownerCtx, fiber)
  await fiber
  ownerCtx.fiber.assertActive(); fiber.assertActive()
}
/** Admit the actual original before product epoch changes; future authority never permits dispatch.
 * @param source Actual retained native source with an exclusive journal.
 * @param generation Original opaque native generation.
 * @param ownerCtx Exact source lifecycle owner.
 * @param input Complete original binding including operation, nonce and lease.
 * @param authority Pinned actual owner grant and durable product fence callbacks.
 * @returns Exact-original control without start or factory authority.
 */
export function admitOwnedGenerationControl(source: OwnedGenerationSource, generation: OwnedNativeGeneration,
  ownerCtx: Context, input: NativeGenerationBinding, authority: OwnedGenerationControlAuthority): OwnedGenerationControl {
  const pinned = pinGenerationControlAuthority(authority), binding = deepFreeze(structuredClone(input))
  assertOwnedControlBinding(binding)
  const port = owned(source, ownerCtx), original = port.original(generation, binding)
  const authorize = (): void => { port.assertActive(); pinned.authorize() }
  authorize()
  const control: OwnedGenerationControl = Object.freeze({
    inspect: () => original.inspect(authorize),
    cancel: (timeoutMs?: number) => original.cancel(timeoutMs, authorize),
    archive: async () => {
      const guard = (): void => { authorize(); gate(ownerCtx); pinned.assertFenced(); original.assertOriginal() }
      guard()
      const workspace = openOwnedWorkspaceSessionPort(ownerCtx.workspaceRegistry, ownerCtx)
      original.fence()
      const view = await original.cancel(undefined, guard)
      guard()
      if (view.local !== 'returned') reject('GENERATION_ORIGINAL_NOT_RETURNED')
      await port.proveDurable(guard); guard()
      await workspace.archive(SessionId(port.sessionId), guard); guard()
      if (!workspace.isArchived(SessionId(port.sessionId))) reject('GENERATION_ARCHIVE_NOT_DURABLE')
      return Object.freeze({ sessionId: port.sessionId, archived: true as const, original: view })
    },
  })
  controls.set(control, { source, generation, ownerCtx, bindingDigest: digest(binding), authorize })
  return control
}
/** Verify the exact original control and its current actual owner grant.
 * @param value Candidate opaque control.
 * @param source Original producing source.
 * @param generation Original producing generation.
 * @param ownerCtx Exact current lifecycle owner.
 * @param binding Complete original immutable binding.
 * @returns Whether this is the original live producer control.
 */
export function isOwnedGenerationControl(value: unknown, source: OwnedGenerationSource, generation: OwnedNativeGeneration,
  ownerCtx: Context, binding: NativeGenerationBinding): value is OwnedGenerationControl {
  if (value === null || typeof value !== 'object') return false
  const actual = controls.get(value)
  if (actual?.source !== source || actual.generation !== generation || actual.ownerCtx !== ownerCtx
    || actual.bindingDigest !== digest(binding)) return false
  try { actual.authorize(); return true } catch (_invalid: unknown) { return false }
}
/** Admit only the complete, sealed original empty creation, with no synthetic generation coordinates.
 * @param source Actual protected source with the original empty journal and native initialization.
 * @param ownerCtx Exact lifecycle owner.
 * @param input Immutable actual pre-native creation intent with original operation and nonce.
 * @param authority Pinned actual owner grant and durable product fence callbacks.
 * @returns Archive-only empty-source control; a racing input invalidates it.
 */
export function admitOwnedBlankSessionControl(source: OwnedGenerationSource, ownerCtx: Context,
  input: OwnedGenerationCreationIntent, authority: OwnedGenerationControlAuthority): OwnedBlankSessionControl {
  const pinned = pinGenerationControlAuthority(authority), intent = deepFreeze(structuredClone(input))
  const port = owned(source, ownerCtx)
  const authorize = (): void => { port.assertActive(); pinned.authorize(); port.assertBlank(intent) }
  authorize()
  const control: OwnedBlankSessionControl = Object.freeze({ archive: async () => {
    const guard = (): void => { authorize(); gate(ownerCtx); pinned.assertFenced() }
    guard()
    const workspace = openOwnedWorkspaceSessionPort(ownerCtx.workspaceRegistry, ownerCtx)
    port.fenceBlank(intent)
    await port.proveKnown(guard); guard()
    await workspace.archive(SessionId(port.sessionId), guard); guard()
    if (!workspace.isArchived(SessionId(port.sessionId))) reject('GENERATION_ARCHIVE_NOT_DURABLE')
    return Object.freeze({ sessionId: port.sessionId, archived: true as const, original: null })
  } })
  blanks.set(control, { source, ownerCtx, intentDigest: digest(intent), authorize })
  return control
}
/** Recognize an unchanged genuine blank control under its actual live owner grant.
 * @param value Candidate archive-only control.
 * @param source Actual original blank source.
 * @param ownerCtx Exact lifecycle owner.
 * @param intent Complete original immutable creation intent.
 * @returns Whether the native producer still retains this exact blank control.
 */
export function isOwnedBlankSessionControl(value: unknown, source: OwnedGenerationSource, ownerCtx: Context,
  intent: OwnedGenerationCreationIntent): value is OwnedBlankSessionControl {
  if (value === null || typeof value !== 'object') return false
  const actual = blanks.get(value)
  if (actual?.source !== source || actual.ownerCtx !== ownerCtx || actual.intentDigest !== digest(intent)) return false
  try { actual.authorize(); return true } catch (_invalid: unknown) { return false }
}
/** Unarchive only an attached genuine same-id resume after complete sealed history verification.
 * @param source Actual same-id protected resumed source, before any new native activity.
 * @param ownerCtx Exact current lifecycle owner.
 * @param authority Pinned current actual owner grant; no historical JSON admits dispatch.
 */
export async function unarchiveOwnedGenerationSource(source: OwnedGenerationSource, ownerCtx: Context,
  authority: OwnedGenerationControlAuthority): Promise<void> {
  const pinned = pinGenerationControlAuthority(authority), port = owned(source, ownerCtx)
  const guard = (): void => { port.assertActive(); gate(ownerCtx); pinned.authorize(); port.assertResumable() }
  guard()
  const workspace = openOwnedWorkspaceSessionPort(ownerCtx.workspaceRegistry, ownerCtx)
  await port.proveKnown(guard); guard()
  await workspace.unarchive(SessionId(port.sessionId), guard); guard()
  await port.proveKnown(guard); guard()
  port.clearFence()
}
