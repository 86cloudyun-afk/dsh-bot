/** One-level child capabilities originate from an actual original native tool activity. */
import { afterEach, expect, it, vi } from 'vitest'
import { digest, record } from '../src/values.ts'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, config } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string, generation = 1) => ({ botId: 'child-bot', taskId: sessionId, sessionId,
  generation, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1, configVersion: '11111111-1111-4111-8111-111111111111' })
const fullBinding = (sessionId: string, generation: number, input: ReturnType<typeof safeUser>) => {
  const operationId = generation === 1 ? 'original-operation' : 'next-operation'
  return { ...binding(sessionId, generation), operationId, nonce: generation === 1 ? 'original-nonce' : 'next-nonce',
    inputMessageId: input.id, messageIdentity: digest(input), slotLease: { taskId: sessionId, sessionId, generation, operationId } }
}
const toolResponse = () => new Response([
  { type: 'message_start', message: { usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'owned-child-call', name: 'dsh_bot_delegate', input: {} } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))

async function parent(onDelegate: (source: native.OwnedGenerationSource, generation: native.OwnedNativeGeneration,
  f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, resolveAuth?: Parameters<typeof fixture>[0],
isCurrent: (binding: native.NativeGenerationBinding) => boolean = () => true) {
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
  const plannedInput = safeUser('Parent work original input'), plannedBinding = fullBinding(sessionId, 1, plannedInput)
  const prepared = native.prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId, role: 'work',
    route: config, workDelegate: { plannedBinding, delegateTool }, isCurrent })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls })
  cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  handle.agent.ctx.tools.register(delegateTool)
  return { ...f, source, handle, plannedBinding, delegateTool, failure: () => delegateError,
    start: (actual = plannedBinding) => {
      generation = source.start(actual, plannedInput); return generation
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
  const full = h.plannedBinding
  const generation = h.start(full); await h.handle.agent.whenIdle()
  const view = await h.source.inspect(generation)
  expect(view.remote).toBe('settled')
  expect(native.isOwnedGenerationReceipt(view.receipt, h.source, full)).toBe(true)
  expect(native.isOwnedGenerationReceipt(view.receipt, h.source, binding(h.plannedBinding.sessionId))).toBe(false)
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
  const nextInput = safeUser('Next planned original'), next = fullBinding('parent-work', 2, nextInput)
  expect(() => { native.planOwnedWorkGenerationSource({ ...h.source }, h.ctx, next) }).toThrow()
  const generation = h.start()
  expect(() => { native.planOwnedWorkGenerationSource(h.source, h.ctx, next) }).toThrow()
  await h.handle.agent.whenIdle(); expect((await h.source.inspect(generation)).remote).toBe('settled')
  native.planOwnedWorkGenerationSource(h.source, h.ctx, next)
  expect(() => h.source.start(h.plannedBinding, safeUser('Old plan'))).toThrow()
  const second = h.source.start(next, nextInput)
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
  const nextInput = safeUser('Next planned original'), next = fullBinding('parent-work', 2, nextInput)
  native.planOwnedWorkGenerationSource(h.source, h.ctx, next)
  const second = h.source.start(next, nextInput)
  release.resolve({ headers: {} }); await childHandle!.agent.whenIdle(); await h.handle.agent.whenIdle()
  expect(await child!.inspect(childGeneration!)).toMatchObject({ remote: 'UNKNOWN', usageKnown: false })
  expect((await h.source.inspect(second)).remote).toBe('settled')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('plans parent g2 with the complete actual immutable execution binding for authority', async () => {
  const observed: native.NativeGenerationBinding[] = []
  const h = await parent(async () => {}, undefined, (value) => {
    observed.push(value)
    return Reflect.get(value, 'nonce') === 'original-nonce' || Reflect.get(value, 'nonce') === 'full-new-nonce'
  })
  vi.stubGlobal('fetch', async () => toolResponse())
  const first = h.start(); await h.handle.agent.whenIdle(); expect((await h.source.inspect(first)).remote).toBe('settled')
  const input = safeUser('Second full binding'), full = { ...fullBinding('parent-work', 2, input), nonce: 'full-new-nonce' }
  native.planOwnedWorkGenerationSource(h.source, h.ctx, full)
  expect(observed.at(-1)).toEqual(full)
  const second = h.source.start(full, input)
  await h.handle.agent.whenIdle(); expect((await h.source.inspect(second)).remote).toBe('settled')
})

it('preserves the same parent-work id across restart with a newly admitted full g2 input and lease', async () => {
  async function mount(input: ReturnType<typeof safeUser>, generation: number, existingDirectory?: string) {
    const f = await fixture(undefined, false, existingDirectory), sessionId = 'known-full-parent-work'
    const full = fullBinding(sessionId, generation, input)
    const options = { ownerCtx: f.ctx, directory: join(f.directory, 'owned-parent'), create: generation === 1,
      sessionId, role: 'work' as const, toolPolicy: 'delegate' as const, route: config,
      session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
    const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
    const delegateTool = defineTool({ name: 'dsh_bot_delegate', description: 'Exact known parent full policy', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'known child admission' }] },
      execute: async (_args, exec) => { exec.concludeTurn(); return { pending: true } } })
    const prepared = native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!,
      workDelegate: { plannedBinding: full, delegateTool }, isCurrent: value => digest(value) === digest(full) })
    const handle = generation === 1 ? await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
      meta: options.session, protectedModelCalls: prepared.protectedModelCalls })
      : await f.ctx.agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions: config,
        protectedModelCalls: prepared.protectedModelCalls })
    cleanup.push(() => handle.dispose()); handle.agent.ctx.tools.register(delegateTool)
    return { ...f, source: prepared.attach(handle), handle, journal, full }
  }
  const fetch = vi.fn(async () => toolResponse()); vi.stubGlobal('fetch', fetch)
  const firstInput = safeUser('Full parent g1'), first = await mount(firstInput, 1)
  const g1 = first.source.start(first.full, firstInput); await first.handle.agent.whenIdle()
  expect((await first.source.inspect(g1)).remote).toBe('settled')
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const secondInput = safeUser('New full parent g2'), second = await mount(secondInput, 2, first.directory)
  expect(second.handle.agent.id).toBe(first.handle.agent.id)
  native.planOwnedWorkGenerationSource(second.source, second.ctx, second.full)
  expect(() =>{  native.planOwnedWorkGenerationSource(second.source, second.ctx, { ...second.full, nonce: 'different-g2-original' }) }).toThrow()
  const g2 = second.source.start(second.full, secondInput); await second.handle.agent.whenIdle()
  expect((await second.source.inspect(g2)).remote).toBe('settled')
  expect(fetch).toHaveBeenCalledTimes(2)
})
