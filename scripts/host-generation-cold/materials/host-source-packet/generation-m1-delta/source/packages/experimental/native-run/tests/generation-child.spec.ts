/** One-level child capabilities originate from an actual original native tool activity. */
import { afterEach, expect, it, vi } from 'vitest'
import { record } from '../src/values.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, config } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string, generation = 1) => ({ botId: 'child-bot', taskId: sessionId, sessionId,
  generation, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1, configVersion: '11111111-1111-4111-8111-111111111111' })
const toolResponse = () => new Response([
  { type: 'message_start', message: { usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'owned-child-call', name: 'dsh_bot_delegate', input: {} } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))

async function parent(onDelegate: (source: native.OwnedGenerationSource, generation: native.OwnedNativeGeneration,
  f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, resolveAuth?: Parameters<typeof fixture>[0]) {
  const f = await fixture(resolveAuth), sessionId = 'parent-work'
  let generation: native.OwnedNativeGeneration
  let delegateError: unknown
  const delegateTool = defineTool({ name: 'dsh_bot_delegate', description: 'One-level offline child', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'pending' }] },
    execute: async (_args, exec) => {
      try { await onDelegate(source, generation, f) }
      catch (error: unknown) { delegateError = error; throw error }
      finally { exec.concludeTurn() }
      return { pending: true }
    } })
  const plannedBinding = binding(sessionId)
  const prepared = native.prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId, role: 'work',
    route: config, workDelegate: { plannedBinding, delegateTool }, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls })
  cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  handle.agent.ctx.tools.register(delegateTool)
  return { ...f, source, handle, plannedBinding, delegateTool, failure: () => delegateError,
    start: (actual = { ...plannedBinding, slotLeaseId: 'parent-held-lease', operationId: 'original-operation', nonce: 'original-nonce' }) => {
      generation = source.start(actual, safeUser('Parent work original input')); return generation
    } }
}

it('owner-approved parent work mints one real zero-tool child from its original tool call', async () => {
  let childView: native.NativeGenerationView | undefined
  const h = await parent(async (source, generation, f) => {
    const sessionId = 'owned-child-work'
    expect(native.prepareOwnedChildGenerationSource).toBeTypeOf('function')
    const options = { ownerCtx: f.ctx, providerFactory: f.factory!, sessionId, route: config, isCurrent: () => true }
    expect(() => native.prepareOwnedChildGenerationSource({ ...source }, generation, options)).toThrow()
    expect(() => native.prepareOwnedChildGenerationSource(source, Object.freeze({}), options)).toThrow()
    const prepared = native.prepareOwnedChildGenerationSource(source, generation, options)
    expect(native.isPreparedOwnedGenerationSource(prepared, f.ctx, sessionId, 'work')).toBe(true)
    const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
      meta: { cwd: f.directory, agentPreset: 'acceptance/empty', parentSession: SessionId('parent-work'), origin: 'subagent', delegationDepth: 1 },
      protectedModelCalls: prepared.protectedModelCalls, parentAgent: prepared.parentAgent })
    cleanup.push(() => handle.dispose())
    const child = prepared.attach(handle)
    expect(f.ctx.tools.schemas(handle.agent)).toHaveLength(0)
    const childGeneration = child.start({ ...binding(sessionId), slotLeaseId: 'shared-child-held-lease', parentGeneration: 1 }, safeUser('Child input'))
    expect(() => native.prepareOwnedChildGenerationSource(child, childGeneration,
      { ...options, sessionId: 'forbidden-grandchild' })).toThrow()
    await handle.agent.whenIdle(); childView = await child.inspect(childGeneration)
  })
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    if (typeof init.body !== 'string') throw new Error('Fixture expects exact string payload')
    const payload: unknown = JSON.parse(init.body)
    if (!record(payload)) throw new Error('Fixture expects object payload')
    return Array.isArray(payload.tools) && payload.tools.length ? toolResponse() : safeResponse('Owned child result')
  })
  const generation = h.start()
  await h.handle.agent.whenIdle()
  expect(h.failure()).toBeUndefined()
  expect(childView).toMatchObject({ local: 'returned', remote: 'settled', usageKnown: true })
  expect(await h.source.inspect(generation)).toMatchObject({ remote: 'settled', usageKnown: true })
})

it('does not mint child capability before the actual original delegate call', async () => {
  const h = await parent(async () => {})
  const entered = Promise.withResolvers<undefined>(), response = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', async () => { entered.resolve(undefined); return response.promise })
  const generation = h.start(); await entered.promise
  expect(() => native.prepareOwnedChildGenerationSource(h.source, generation, { ownerCtx: h.ctx, providerFactory: h.factory!,
    sessionId: 'premature-child', route: config, isCurrent: () => true })).toThrow()
  response.resolve(toolResponse()); await h.handle.agent.whenIdle()
})

it('retains complete start binding while matching the precreation planned work coordinates', async () => {
  const h = await parent(async () => {})
  const fetch = vi.fn(async () => toolResponse()); vi.stubGlobal('fetch', fetch)
  expect(() => h.source.start({ ...h.plannedBinding, authorityEpoch: 2 }, safeUser())).toThrow()
  expect(fetch).not.toHaveBeenCalled()
  const full = { ...h.plannedBinding, slotLeaseId: 'parent-held-lease', operationId: 'original-operation', nonce: 'original-nonce' }
  const generation = h.start(full); await h.handle.agent.whenIdle()
  const view = await h.source.inspect(generation)
  expect(view.remote).toBe('settled')
  expect(native.isOwnedGenerationReceipt(view.receipt, h.source, full)).toBe(true)
  expect(native.isOwnedGenerationReceipt(view.receipt, h.source, h.plannedBinding)).toBe(false)
})

it('checks the captured original parent fence after child auth resolves', async () => {
  const authEntered = Promise.withResolvers<undefined>(), releaseAuth = Promise.withResolvers<{ headers: {} }>()
  let calls = 0, childView: native.NativeGenerationView | undefined
  const h = await parent(async (source, generation, f) => {
    const sessionId = 'fenced-child'
    const prepared = native.prepareOwnedChildGenerationSource(source, generation, { ownerCtx: f.ctx,
      providerFactory: f.factory!, sessionId, route: config, isCurrent: () => true })
    const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
      meta: { cwd: f.directory, agentPreset: 'acceptance/empty', parentSession: SessionId('parent-work'), origin: 'subagent', delegationDepth: 1 },
      protectedModelCalls: prepared.protectedModelCalls, parentAgent: prepared.parentAgent })
    cleanup.push(() => handle.dispose())
    const child = prepared.attach(handle)
    const childGeneration = child.start(binding(sessionId), safeUser('Fenced child input'))
    await handle.agent.whenIdle(); childView = await child.inspect(childGeneration)
  }, async () => { if (++calls === 2) { authEntered.resolve(undefined); return releaseAuth.promise } return { headers: {} } })
  const fetch = vi.fn(async () => toolResponse()); vi.stubGlobal('fetch', fetch)
  const generation = h.start(); await authEntered.promise
  const draining = h.source.cancel(generation)
  releaseAuth.resolve({ headers: {} })
  await draining; await h.handle.agent.whenIdle()
  expect(h.failure()).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(childView).toMatchObject({ local: 'returned', remote: 'UNKNOWN', usageKnown: false })
})

it('owner plans the next parent work generation only after the original receipt', async () => {
  const h = await parent(async () => {})
  vi.stubGlobal('fetch', async () => toolResponse())
  const next = binding('parent-work', 2)
  expect(() => { native.planOwnedWorkGenerationSource({ ...h.source }, h.ctx, next) }).toThrow()
  const generation = h.start()
  expect(() => { native.planOwnedWorkGenerationSource(h.source, h.ctx, next) }).toThrow()
  await h.handle.agent.whenIdle(); expect((await h.source.inspect(generation)).remote).toBe('settled')
  native.planOwnedWorkGenerationSource(h.source, h.ctx, next)
  expect(() => h.source.start(h.plannedBinding, safeUser('Old plan'))).toThrow()
  const second = h.source.start({ ...next, nonce: 'new-original-nonce', slotLeaseId: 'new-held-lease' }, safeUser('Next plan'))
  await h.handle.agent.whenIdle()
  expect(await h.source.inspect(second)).toMatchObject({ remote: 'settled', usageKnown: true })
})

it('a late child request cannot inherit a replacement parent generation', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<{ headers: {} }>()
  let authCalls = 0, delegateCalls = 0
  let child: native.OwnedGenerationSource | undefined, childGeneration: native.OwnedNativeGeneration | undefined
  let childHandle: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['ctx']['agents']['create']>> | undefined
  const h = await parent(async (source, generation, f) => {
    if (++delegateCalls > 1) return
    const sessionId = 'late-original-child'
    const prepared = native.prepareOwnedChildGenerationSource(source, generation, { ownerCtx: f.ctx,
      providerFactory: f.factory!, sessionId, route: config, isCurrent: () => true })
    childHandle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
      meta: { cwd: f.directory, agentPreset: 'acceptance/empty', parentSession: SessionId('parent-work'), origin: 'subagent', delegationDepth: 1 },
      protectedModelCalls: prepared.protectedModelCalls, parentAgent: prepared.parentAgent }); cleanup.push(() => childHandle!.dispose())
    child = prepared.attach(childHandle)
    childGeneration = child.start(binding(sessionId), safeUser('Late original child input'))
    await entered.promise
  }, async () => { if (++authCalls === 2) { entered.resolve(undefined); return release.promise } return { headers: {} } })
  const fetch = vi.fn(async () => toolResponse()); vi.stubGlobal('fetch', fetch)
  const first = h.start(); await h.handle.agent.whenIdle()
  expect(h.failure()).toBeUndefined()
  expect((await h.source.inspect(first)).remote).toBe('settled')
  const next = binding('parent-work', 2)
  native.planOwnedWorkGenerationSource(h.source, h.ctx, next)
  const second = h.source.start(next, safeUser('Replacement parent input'))
  release.resolve({ headers: {} }); await childHandle!.agent.whenIdle(); await h.handle.agent.whenIdle()
  expect(await child!.inspect(childGeneration!)).toMatchObject({ remote: 'UNKNOWN', usageKnown: false })
  expect((await h.source.inspect(second)).remote).toBe('settled')
  expect(fetch).toHaveBeenCalledTimes(2)
})
