/** Genuine original controls call the actual durable Workspace registry and native gate. */
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, config } from './protected-fixture.ts'
import { ArchivedSessionGate as WorkspaceGate } from '@deepseek-ai/dsh-workspace'
import { ArchivedSessionGate as ControllerGate } from '../../../api/session-controller/src/archived-session-gate.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string, generation = 1) => ({ botId: 'archive-bot', taskId: 'archive-work', sessionId,
  generation, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1,
  configVersion: '11111111-1111-4111-8111-111111111111', operationId: 'original-op', nonce: 'original-nonce', slotLeaseId: 'original-held-lease' })

async function owner(existingDirectory?: string, create = true) {
  const f = await fixture(undefined, false, existingDirectory, true), sessionId = 'same-native-archived-session'
  expect(native.mountOwnedGenerationArchiveGate).toBeTypeOf('function')
  await native.mountOwnedGenerationArchiveGate(f.ctx)
  const creationIntent = { binding: { botId: 'archive-bot', sessionId, configVersion: 'original-config', cwd: f.directory,
    agentPreset: 'acceptance/empty', botEpoch: 1, authorityEpoch: 1 }, operationId: 'original-create-op', nonce: 'original-create-nonce' }
  const journalOptions = { ownerCtx: f.ctx, directory: join(f.directory, 'owned-source'), create, sessionId,
    role: 'work' as const, route: config, session: { cwd: f.directory, agentPreset: 'acceptance/empty' }, creationIntent }
  const journal = await native.openOwnedGenerationJournal(journalOptions)
  cleanup.push(() => journal.close())
  let current = true, authorized = true, fenced = false
  const authority = { isAuthorized: () => authorized, isDispatchFenced: () => fenced }
  const prepared = native.prepareOwnedGenerationSource({ ...journalOptions, providerFactory: f.factory!, journal,
    isCurrent: () => current, canDispatch: () => current && !fenced })
  const options = { agentOptions: config, protectedModelCalls: prepared.protectedModelCalls }
  const handle = create ? await f.ctx.agents.create({ ...options, sessionId: SessionId(sessionId), meta: journalOptions.session })
    : await f.ctx.agents.resume({ ...options, resumeSessionId: SessionId(sessionId) })
  cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  return { ...f, source, handle, journal, journalOptions, creationIntent, authority, sessionId,
    fence: () => { fenced = true; current = false }, revoke: () => { authorized = false } }
}

it('archives the exact original after Bot epoch invalidation while preserving strict settlement', async () => {
  const h = await owner(), fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  const exact = binding(h.sessionId), generation = h.source.start(exact, safeUser())
  const control = native.admitOwnedGenerationControl(h.source, generation, h.ctx, exact, h.authority)
  expect(native.isOwnedGenerationControl(control, h.source, generation, h.ctx, exact)).toBe(true)
  expect(native.isOwnedGenerationControl({ ...control }, h.source, generation, h.ctx, exact)).toBe(false)
  await h.handle.agent.whenIdle(); h.fence()
  const archived = await control.archive()
  expect(archived).toMatchObject({ sessionId: h.sessionId, archived: true, original: { local: 'returned', remote: 'settled', usageKnown: true } })
  expect(native.isOwnedGenerationReceipt(archived.original?.receipt, h.source, exact)).toBe(true)
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(h.sessionId)
  expect(() => h.source.start({ ...exact, generation: 2, botEpoch: 2 }, safeUser('never sent'))).toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('archives locally returned UNKNOWN without unsealing its original history or creating a usage receipt', async () => {
  const h = await owner()
  vi.stubGlobal('fetch', async () => new Response('data: {"type":"message_stop"}\n\n'))
  const exact = binding(h.sessionId), generation = h.source.start(exact, safeUser())
  const control = native.admitOwnedGenerationControl(h.source, generation, h.ctx, exact, h.authority)
  await h.handle.agent.whenIdle(); h.fence()
  expect(await control.archive()).toMatchObject({ archived: true, original: { local: 'returned', remote: 'UNKNOWN', usageKnown: false, receipt: null } })
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toContain(h.sessionId)
  await h.handle.dispose(); await h.journal.close(); await h.ctx.fiber.dispose()
  const restarted = await fixture(undefined, false, h.directory, true)
  await expect(native.openOwnedGenerationJournal({ ...h.journalOptions, ownerCtx: restarted.ctx, create: false })).rejects.toThrow()
  expect(restarted.ctx.workspaceRegistry.archivedSessionIds).toContain(h.sessionId)
})

it('archives a genuine original blank creation and restores the same protected id without inventing a generation', async () => {
  const first = await owner()
  const control = native.admitOwnedBlankSessionControl(first.source, first.ctx, first.creationIntent, first.authority)
  expect(native.isOwnedBlankSessionControl(control, first.source, first.ctx, first.creationIntent)).toBe(true)
  first.fence()
  expect(await control.archive()).toMatchObject({ sessionId: first.sessionId, archived: true, original: null })
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const second = await owner(first.directory, false)
  expect(second.handle.agent.id).toBe(first.sessionId)
  expect(second.ctx.workspaceRegistry.archivedSessionIds).toContain(first.sessionId)
  await native.unarchiveOwnedGenerationSource(second.source, second.ctx, second.authority)
  expect(second.ctx.workspaceRegistry.archivedSessionIds).not.toContain(first.sessionId)
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const generation = second.source.start({ ...binding(second.sessionId), botEpoch: 2 }, safeUser('fresh input after known same-id restore'))
  await second.handle.agent.whenIdle()
  expect(await second.source.inspect(generation)).toMatchObject({ remote: 'settled', usageKnown: true })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('invalidates a blank control when any original input wins the race and never cancels that generation', async () => {
  const h = await owner(), entered = Promise.withResolvers<undefined>(), response = Promise.withResolvers<Response>()
  const control = native.admitOwnedBlankSessionControl(h.source, h.ctx, h.creationIntent, h.authority)
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { signal = init.signal; entered.resolve(undefined); return response.promise })
  const generation = h.source.start(binding(h.sessionId), safeUser()); await entered.promise; h.fence()
  await expect(control.archive()).rejects.toThrow()
  expect(signal?.aborted).toBe(false)
  expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.sessionId)
  response.resolve(safeResponse()); await h.handle.agent.whenIdle()
  expect((await h.source.inspect(generation)).local).toBe('returned')
})

it('shares the actual stock gate identity and blocks archived native input until the same id is unarchived', async () => {
  expect(WorkspaceGate).toBe(ControllerGate)
  const f = await fixture(undefined, false, undefined, true), sessionId = SessionId('actual-stock-gate-session')
  await native.mountOwnedGenerationArchiveGate(f.ctx)
  const handle = await f.ctx.agents.create({ sessionId, agentOptions: config, meta: { cwd: f.directory, agentPreset: 'acceptance/empty' } })
  cleanup.push(() => handle.dispose())
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await f.ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: false })
  handle.agent.send(safeUser('Blocked archived original'), 'next-turn', true); await handle.agent.whenIdle()
  expect(fetch).not.toHaveBeenCalled()
  await f.ctx.workspaceRegistry.unarchiveSession(sessionId)
  handle.agent.send(safeUser('Fresh input same unarchived id'), 'next-turn', true); await handle.agent.whenIdle()
  expect(handle.agent.id).toBe(sessionId); expect(fetch).toHaveBeenCalledTimes(1)
})
it.each(['wrong-binding', 'wrong-owner', 'copied-source', 'copied-generation', 'revoked', 'promise', 'throw'])
('rejects %s control admission without any native archive effect', async (kind) => {
  const h = await owner(), exact = binding(h.sessionId)
  vi.stubGlobal('fetch', async () => safeResponse())
  const generation = h.source.start(exact, safeUser())
  const authority = kind === 'promise' ? { ...h.authority, isAuthorized: () => Promise.resolve(true) }
    : kind === 'throw' ? { ...h.authority, isAuthorized: () => { throw new Error('revoked') } } : h.authority
  if (kind === 'revoked') h.revoke()
  expect(() => native.admitOwnedGenerationControl(kind === 'copied-source' ? { ...h.source } : h.source,
    kind === 'copied-generation' ? Object.freeze({}) : generation, kind === 'wrong-owner' ? h.ctx.extend({}) : h.ctx,
    kind === 'wrong-binding' ? { ...exact, nonce: 'different-nonce' } : exact,
    // The runtime rejects a thenable even if TypeScript cannot call it a boolean grant.
    authority as native.OwnedGenerationControlAuthority)).toThrow()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.sessionId)
  await h.handle.agent.whenIdle()
})
it('requires the exact pinned durable product fence and rejects its replacement after admission', async () => {
  const h = await owner(), exact = binding(h.sessionId)
  vi.stubGlobal('fetch', async () => safeResponse())
  const generation = h.source.start(exact, safeUser()), authority = { ...h.authority }
  const control = native.admitOwnedGenerationControl(h.source, generation, h.ctx, exact, authority)
  await h.handle.agent.whenIdle()
  authority.isDispatchFenced = () => true
  await expect(control.archive()).rejects.toThrow()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.sessionId)
})
it('rechecks the root grant after actual registry activity awaits before its durable archive write', async () => {
  const h = await owner(), exact = binding(h.sessionId)
  vi.stubGlobal('fetch', async () => safeResponse())
  const generation = h.source.start(exact, safeUser())
  const control = native.admitOwnedGenerationControl(h.source, generation, h.ctx, exact, h.authority)
  await h.handle.agent.whenIdle(); h.fence()
  h.ctx.on('workspace/session-activity', async (_request, next) => { const activity = await next(); h.revoke(); return activity })
  await expect(control.archive()).rejects.toThrow()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.sessionId)
  expect(native.isOwnedGenerationControl(control, h.source, generation, h.ctx, exact)).toBe(false)
})
it('a pre-admitted old control cancels only its original and cannot archive or fence a replacement driver', async () => {
  const h = await owner(), firstBinding = binding(h.sessionId)
  vi.stubGlobal('fetch', async () => safeResponse())
  const first = h.source.start(firstBinding, safeUser())
  const control = native.admitOwnedGenerationControl(h.source, first, h.ctx, firstBinding, h.authority)
  await h.handle.agent.whenIdle(); expect((await h.source.inspect(first)).remote).toBe('settled')
  const entered = Promise.withResolvers<undefined>(), response = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { signal = init.signal; entered.resolve(undefined); return response.promise })
  const nextBinding = { ...firstBinding, generation: 2, nonce: 'second-nonce', slotLeaseId: 'second-held-lease' }
  const second = h.source.start(nextBinding, safeUser('Replacement driver')); await entered.promise
  expect((await control.cancel()).remote).toBe('settled'); expect(signal?.aborted).toBe(false)
  h.fence(); await expect(control.archive()).rejects.toThrow()
  expect(signal?.aborted).toBe(false); expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.sessionId)
  response.resolve(safeResponse()); await h.handle.agent.whenIdle()
  expect((await h.source.inspect(second)).local).toBe('returned')
})

it('restores sealed old epochs through a genuine pre-resume history selector and reads only their original prefix during g2', async () => {
  const first = await owner(), oldBinding = binding(first.sessionId), fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  const old = first.source.start(oldBinding, safeUser('Original old epoch')); await first.handle.agent.whenIdle()
  expect((await first.source.inspect(old)).remote).toBe('settled')
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const f = await fixture(undefined, false, first.directory, true)
  await native.mountOwnedGenerationArchiveGate(f.ctx)
  const options = { ...first.journalOptions, ownerCtx: f.ctx, create: false }
  const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
  const authority = { isAuthorized: () => true, isDispatchFenced: () => false }
  const selector = await native.selectOwnedGenerationHistory(journal, f.ctx, oldBinding, authority)
  expect(native.isOwnedGenerationHistorySelector(selector, journal, f.ctx, oldBinding)).toBe(true)
  expect(native.isOwnedGenerationHistorySelector({ ...selector }, journal, f.ctx, oldBinding)).toBe(false)
  expect(native.isOwnedGenerationHistorySelector(selector, journal, f.ctx, { ...oldBinding, nonce: 'wrong' })).toBe(false)
  const prepared = native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!,
    isCurrent: value => value.generation === 2 && value.botEpoch === 2 })
  const handle = await f.ctx.agents.resume({ resumeSessionId: SessionId(first.sessionId), agentOptions: config,
    protectedModelCalls: prepared.protectedModelCalls }); cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  await expect(source.restore(oldBinding)).rejects.toThrow()
  const historical = await source.restoreKnown(selector)
  expect((await source.inspect(historical)).remote).toBe('settled')
  const entered = Promise.withResolvers<undefined>(), response = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { signal = init.signal; entered.resolve(undefined); return response.promise })
  const secondBinding = { ...oldBinding, generation: 2, botEpoch: 2, nonce: 'new-epoch-input', slotLeaseId: 'new-epoch-lease' }
  const second = source.start(secondBinding, safeUser('New epoch original')); await entered.promise
  expect((await source.inspect(historical)).remote).toBe('settled')
  expect(native.isOwnedGenerationReceipt((await source.cancel(historical)).receipt, source, oldBinding)).toBe(true)
  expect(signal?.aborted).toBe(false)
  response.resolve(safeResponse()); await handle.agent.whenIdle(); expect((await source.inspect(second)).remote).toBe('settled')
})
