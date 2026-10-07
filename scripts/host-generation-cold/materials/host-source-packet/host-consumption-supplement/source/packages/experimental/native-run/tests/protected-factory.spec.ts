/** Native interface substrate, separate from product/human authorization. */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { fixture, config, safeUser, safeResponse } from './protected-fixture.ts'
async function chunks(stream: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}

it('returns only an opaque provider factory and preserves complete prepared native metadata', async () => {
  const { ctx, factory } = await fixture()
  expect(factory).toBeTypeOf('object')
  expect(factory?.protectSession).toBeTypeOf('function')
  expect(Object.isFrozen(factory)).toBe(true)
  expect(Object.keys(factory!)).toEqual(['protectSession'])
  const calls = factory!.protectSession(SessionId('opaque'), {
    checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {},
  })
  const prepared = await calls.prepareCall(config)
  expect(prepared.config).toEqual(config)
  expect(prepared.retryPolicy).toEqual(ctx.llm.providerRetryPolicy('deepseek-official'))
  expect(prepared.context?.contextWindow).toBeGreaterThan(0)
  expect(Object.isFrozen(prepared.config)).toBe(true)
  expect(ctx.tools.schemas()).toHaveLength(0)
})

it('binds the actual owned AgentLoop once before its first native turn and guards its fetch', async () => {
  const { ctx, factory } = await fixture()
  expect(factory?.protectSession).toBeTypeOf('function')
  const id = SessionId('owned-agent')
  const guards = { admission: 0, dispatch: 0, checkpoints: 0 }
  const calls = factory!.protectSession(id, {
    checkAdmission: (options) => { guards.admission++; expect(options.sessionId).toBe(id) },
    checkDispatch: (options) => { guards.dispatch++; expect(Object.isFrozen(options)).toBe(true) },
    beforeStream: async () => { guards.checkpoints++; expect(await ctx.sessions.flush(ctx.sessions.get(id)!)).toBe(true) },
  })
  const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: '/owned', agentPreset: 'acceptance/empty' },
    agentOptions: config, protectedModelCalls: calls,
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'acceptance/empty') },
  })
  const nativeSession = handle.agent.session
  expect(handle.protectModelCalls).toBeTypeOf('function')
  expect(() => handle.protectModelCalls!(calls)).toThrow(expect.objectContaining({ code: 'MODEL_CALLS_ALREADY_PROTECTED' }))
  const fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  handle.agent.followup(safeUser())
  await handle.agent.whenIdle()
  expect(guards).toEqual({ admission: 1, dispatch: 1, checkpoints: 1 })
  expect(fetch).toHaveBeenCalledOnce()
  expect(ctx.sessionProjections.stateOf(nativeSession, 'agentPreset')).toBe('acceptance/empty')
  expect(nativeSession.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
  expect(ctx.tools.schemas()).toHaveLength(0)
  await handle.dispose()
})

it('rejects ordinary and earlier-prepared Session streams before middleware can bypass the factory', async () => {
  const { ctx, factory } = await fixture()
  expect(factory?.protectSession).toBeTypeOf('function')
  const id = SessionId('sealed-session')
  const prior = await ctx.llm.prepareCall(config)
  let middleware = 0
  ctx.on('llm/stream', async function* () { middleware++; yield { type: 'finish', reason: { kind: 'stop' } } })
  factory!.protectSession(id, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })
  const options: GenerateOptions = { ...config, sessionId: id, messages: [safeUser()] }
  await expect(chunks(ctx.llm.stream(options))).rejects.toMatchObject({ code: 'SESSION_MODEL_CALLS_PROTECTED' })
  await expect(chunks(prior.stream(options))).rejects.toMatchObject({ code: 'SESSION_MODEL_CALLS_PROTECTED' })
  expect(middleware).toBe(0)
})

it('holds ordinary-call quiescence before an eager middleware can start authentication', async () => {
  const authEntered = Promise.withResolvers<undefined>(), releaseAuth = Promise.withResolvers<undefined>()
  const { ctx, factory } = await fixture(async () => { authEntered.resolve(undefined); await releaseAuth.promise; return { headers: {} } })
  expect(factory?.protectSession).toBeTypeOf('function')
  const id = SessionId('ordinary-in-flight')
  ctx.on('llm/stream', (_options, next) => {
    const iterator = next()[Symbol.asyncIterator]()
    const first = iterator.next() // Deliberately eager construction: lease must already exist.
    return { [Symbol.asyncIterator]: async function* () {
      let item = await first
      while (!item.done) { yield item.value; item = await iterator.next() }
    } }
  })
  vi.stubGlobal('fetch', async () => safeResponse())
  const running = chunks(ctx.llm.stream({ ...config, sessionId: id, messages: [safeUser()] }))
  await authEntered.promise
  expect(() => factory!.protectSession(id, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} }))
    .toThrow(expect.objectContaining({ code: 'SESSION_MODEL_CALLS_ACTIVE' }))
  releaseAuth.resolve(undefined)
  await running
  expect(() => factory!.protectSession(id, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })).not.toThrow()
})

it('publishes the actual API-key provider factory and withdraws it with its Loader fiber without auth', async () => {
  const { ctx, factory, providerFiber } = await fixture(undefined, true)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  expect(ctx.deepseekProtectedProviders.lookup('deepseek-official')).toBe(factory)
  const calls = factory!.protectSession(SessionId('official-owner-sealed'), { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })
  expect((await calls.prepareCall(config)).config).toEqual(config)
  await providerFiber.dispose()
  expect(ctx.deepseekProtectedProviders.lookup('deepseek-official')).toBeUndefined()
  expect(() => factory!.protectSession(SessionId('disposed'), { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })).toThrow()
  await expect(chunks(ctx.llm.stream({ ...config, sessionId: SessionId('official-owner-sealed'), messages: [safeUser()] }))).rejects.toMatchObject({ code: 'SESSION_MODEL_CALLS_PROTECTED' })
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps protected transport lazy and blocks disposal occurring during async authentication', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const { factory, providerFiber } = await fixture(async () => {
    entered.resolve(undefined); await release.promise; return { headers: {} }
  })
  const dispatch = vi.fn(), fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const id = SessionId('lifetime-check')
  const calls = factory!.protectSession(id, { checkAdmission() {}, checkDispatch: dispatch, beforeStream: async () => {} })
  const prepared = await calls.prepareCall(config)
  const stream = prepared.stream({ ...config, sessionId: id, messages: [safeUser()] })
  expect(fetch).not.toHaveBeenCalled()
  const running = chunks(stream); await entered.promise
  await providerFiber.dispose(); release.resolve(undefined)
  const result = await running
  expect(result.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  expect(fetch).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled()
})

it('does not allow ordinary routing middleware to swap its leased Session identity', async () => {
  const { ctx, factory } = await fixture()
  const sealed = SessionId('sealed-swap-target')
  factory!.protectSession(sealed, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  ctx.on('llm/stream', (options, next) => { options.sessionId = sealed; return next() })
  await expect(chunks(ctx.llm.stream({ ...config, sessionId: SessionId('unsealed-lease'), messages: [safeUser()] }))).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('retains an ordinary adapter lease when middleware detaches its downstream iterator', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const { ctx, factory } = await fixture(async () => { entered.resolve(undefined); await release.promise; return { headers: {} } })
  const id = SessionId('detached-ordinary')
  let iterator: AsyncIterator<StreamChunk>, first: Promise<IteratorResult<StreamChunk>>
  ctx.on('llm/stream', (_options, next) => {
    iterator = next()[Symbol.asyncIterator](); first = iterator.next()
    return (async function* () {})()
  })
  vi.stubGlobal('fetch', async () => safeResponse())
  await chunks(ctx.llm.stream({ ...config, sessionId: id, messages: [safeUser()] })); await entered.promise
  try {
    expect(() => factory!.protectSession(id, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })).toThrow(expect.objectContaining({ code: 'SESSION_MODEL_CALLS_ACTIVE' }))
  } finally { release.resolve(undefined); await first!; await iterator!.return?.() }
  expect(() => factory!.protectSession(id, { checkAdmission() {}, checkDispatch() {}, beforeStream: async () => {} })).not.toThrow()
})
