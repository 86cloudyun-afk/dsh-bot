/** Real native loop, Loader and strict provider with an offline SSE transport. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, config } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string, generation = 1) => ({ botId: 'offline-bot', taskId: 'offline-task', sessionId,
  generation, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1, configVersion: '11111111-1111-4111-8111-111111111111' })
async function harness(role: 'main' | 'work' = 'work', resolveAuth?: () => Promise<{ headers: {} }>, delegateGate?: () => Promise<void>) {
  const f = await fixture(resolveAuth)
  const handle = await f.ctx.agents.create({ sessionId: SessionId(`generation-${role}`), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' } })
  cleanup.push(() => handle.dispose())
  const delegateTool = role === 'main' ? defineTool({ name: 'dsh_bot_delegate', description: 'Offline harmless delegation',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'pending' }] },
    execute: async (_args, exec) => { await delegateGate?.(); exec.concludeTurn(); return { pending: true } } }) : undefined
  if (delegateTool) handle.agent.ctx.tools.register(delegateTool)
  expect(native.createOwnedGenerationSource).toBeTypeOf('function')
  let current = true, dispatchAllowed = true
  const source = native.createOwnedGenerationSource({ ownerCtx: f.ctx, handle, providerFactory: f.factory!, role,
    route: config, delegateTool, isCurrent: () => current, canDispatch: () => dispatchAllowed })
  return { ...f, handle, source, binding: binding(handle.agent.id), revoke: () => { current = false }, fence: () => { dispatchAllowed = false } }
}

it('settles only original activity with actual usage, finish and the exact durable input window', async () => {
  const h = await harness()
  vi.stubGlobal('fetch', async () => safeResponse('Offline generation result'))
  const input = safeUser('Original input')
  const generation = h.source.start(h.binding, input)
  expect(native.isOwnedGenerationSource(h.source, h.ctx)).toBe(true)
  await h.handle.agent.whenIdle()
  const result = await h.source.inspect(generation)
  expect(result).toMatchObject({ local: 'returned', remote: 'settled', usageKnown: true,
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 }, inputMessageId: input.id, requestCount: 1 })
  expect(native.isOwnedGenerationReceipt(result.receipt, h.source, h.binding)).toBe(true)
  expect(native.isOwnedGenerationReceipt(structuredClone(result.receipt), h.source, h.binding)).toBe(false)
})

it('rejects copied handles, wrong owner Context and fabricated provider factories', async () => {
  const h = await harness()
  const options = { ownerCtx: h.ctx, handle: h.handle, providerFactory: h.factory!, role: 'work' as const,
    route: config, isCurrent: () => true }
  expect(() => native.createOwnedGenerationSource({ ...options, handle: { ...h.handle } })).toThrow()
  expect(() => native.createOwnedGenerationSource({ ...options, ownerCtx: new Context() })).toThrow()
  expect(() => native.createOwnedGenerationSource({ ...options, providerFactory: { protectSession: h.factory!.protectSession } })).toThrow()
  await expect(h.source.inspect(Object.freeze({}))).rejects.toThrow()
})

it('keeps remote UNKNOWN when the strict provider lacks observed terminal output usage', async () => {
  const h = await harness()
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Offline incomplete usage' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' },
  ]
  vi.stubGlobal('fetch', async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')))
  const generation = h.source.start(h.binding, safeUser())
  await h.handle.agent.whenIdle()
  expect(await h.source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', usageKnown: false, receipt: null })
  expect(() => h.source.start({ ...h.binding, generation: 2 }, safeUser('Do not reuse UNKNOWN'))).toThrow()
})

it('keeps remote UNKNOWN after EOF without actual finish even though assemblers default to stop', async () => {
  const h = await harness()
  vi.stubGlobal('fetch', async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 2 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Offline truncated stream' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')))
  const generation = h.source.start(h.binding, safeUser())
  await h.handle.agent.whenIdle()
  expect(await h.source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', receipt: null })
})

it('accepts explicit complete zero usage without confusing it with missing counts', async () => {
  const h = await harness()
  vi.stubGlobal('fetch', async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Offline explicit zero' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
    { type: 'message_stop' },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')))
  const generation = h.source.start(h.binding, safeUser())
  await h.handle.agent.whenIdle()
  expect(await h.source.inspect(generation)).toMatchObject({ remote: 'settled', usageKnown: true, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
})

it('cancel reports local return and retains remote uncertainty', async () => {
  const h = await harness(), entered = Promise.withResolvers<void>()
  vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); entered.resolve()
  }))
  const generation = h.source.start(h.binding, safeUser())
  await entered.promise
  expect(await h.source.cancel(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', usageKnown: false, receipt: null })
})

it('late old cancellation never aborts a newer activity on the same native Agent', async () => {
  const h = await harness()
  vi.stubGlobal('fetch', async () => safeResponse())
  const first = h.source.start(h.binding, safeUser('First original activity'))
  await h.handle.agent.whenIdle()
  expect((await h.source.inspect(first)).remote).toBe('settled')
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { signal = init.signal; entered.resolve(); return response.promise })
  const second = h.source.start({ ...h.binding, generation: 2 }, safeUser('New activity'))
  await entered.promise
  await h.source.cancel(first)
  expect(signal?.aborted).toBe(false)
  response.resolve(safeResponse())
  await h.handle.agent.whenIdle()
  expect((await h.source.inspect(second)).remote).toBe('settled')
})

it('does not attribute several turns sharing one driver to a single captured input', async () => {
  const h = await harness(), entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', async () => { entered.resolve(); return response.promise })
  const generation = h.source.start(h.binding, safeUser('Captured generation'))
  await entered.promise
  h.handle.agent.followup(safeUser('Unowned later turn'))
  response.resolve(safeResponse())
  await h.handle.agent.whenIdle()
  expect(await h.source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', receipt: null })
})

it('revoked epochs prevent admission', async () => {
  const h = await harness()
  const fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  h.revoke()
  expect(() => h.source.start(h.binding, safeUser())).toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('brands preparation before mounting and captures the exact main tool after blank creation', async () => {
  const f = await fixture(), sessionId = 'prepared-main'
  const prepared = native.prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId,
    role: 'main', route: config, isCurrent: () => true })
  expect(native.isPreparedOwnedGenerationSource).toBeTypeOf('function')
  expect(native.isPreparedOwnedGenerationSource(prepared, f.ctx, sessionId, 'main')).toBe(true)
  expect(native.isPreparedOwnedGenerationSource({ ...prepared }, f.ctx, sessionId, 'main')).toBe(false)
  expect(native.isPreparedOwnedGenerationSource(prepared, new Context(), sessionId, 'main')).toBe(false)
  expect(native.isPreparedOwnedGenerationSource(prepared, f.ctx, 'other-session', 'main')).toBe(false)
  expect(native.isPreparedOwnedGenerationSource(prepared, f.ctx, sessionId, 'work')).toBe(false)
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls })
  cleanup.push(() => handle.dispose())
  expect(handle.agent.session.snapshotEvents()).toHaveLength(0)
  expect(f.ctx.tools.schemas(handle.agent)).toHaveLength(0)
  const delegateTool = defineTool({ name: 'dsh_bot_delegate', description: 'Offline native delegation', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'pending' }] },
    execute: async (_args, exec) => { exec.concludeTurn(); return { pending: true } } })
  const source = prepared.attach(handle, { delegateTool })
  handle.agent.ctx.tools.register(delegateTool)
  vi.stubGlobal('fetch', async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'offline-delegation', name: 'dsh_bot_delegate', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')))
  const generation = source.start(binding(sessionId), safeUser('Delegate harmless work'))
  await handle.agent.whenIdle()
  expect(await source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'settled', usageKnown: true, requestCount: 1 })
})

it('retains an inspectable original generation after inbox admission throws', async () => {
  const h = await harness()
  const spy = vi.spyOn(h.handle.agent.inbox, 'splice').mockImplementation(() => { throw new Error('Offline inbox failure') })
  const generation = h.source.start(h.binding, safeUser())
  spy.mockRestore()
  expect(await h.source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', receipt: null, requestCount: 0 })
  expect(() => h.source.start({ ...h.binding, generation: 2 }, safeUser())).toThrow()
})

it('rechecks exact epochs after async auth and before transport', async () => {
  const entered = Promise.withResolvers<void>(), auth = Promise.withResolvers<{ headers: {} }>()
  const h = await harness('work', async () => { entered.resolve(); return auth.promise })
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const generation = h.source.start(h.binding, safeUser())
  await entered.promise; h.revoke(); auth.resolve({ headers: {} }); await h.handle.agent.whenIdle()
  expect(fetch).not.toHaveBeenCalled()
  expect(await h.source.inspect(generation)).toMatchObject({ remote: 'UNKNOWN', usageKnown: false, receipt: null })
})

it('accepts only the exact owned mode initialization prefix as semantically blank', async () => {
  const f = await fixture(), sessionId = 'initialized-work'
  const initialization = { permissionPreset: 'offline-read-only', sandboxMode: 'read-only', approvalPolicy: 'ask' }
  const prepared = native.prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId,
    role: 'work', route: config, initialization, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls,
    setup: async (_ctx, agent) => {
      agent.session.append('permission/preset', { preset: initialization.permissionPreset })
      agent.session.append('sandbox/mode', { mode: initialization.sandboxMode })
      agent.session.append('approval/policy', { policy: initialization.approvalPolicy })
    } })
  cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  vi.stubGlobal('fetch', async () => safeResponse())
  const generation = source.start(binding(sessionId), safeUser())
  await handle.agent.whenIdle()
  expect(await source.inspect(generation)).toMatchObject({ remote: 'settled', usageKnown: true })
})

it.each(['wrong-value', 'extra-event'] as const)('rejects %s in an owned initialization prefix', async kind => {
  const f = await fixture(), sessionId = 'bad-initialization'
  const initialization = { permissionPreset: 'offline-read-only', sandboxMode: 'read-only', approvalPolicy: 'ask' }
  const prepared = native.prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId,
    role: 'work', route: config, initialization, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls,
    setup: async (_ctx, agent) => {
      agent.session.append('permission/preset', { preset: kind === 'wrong-value' ? 'different-preset' : initialization.permissionPreset })
      agent.session.append('sandbox/mode', { mode: initialization.sandboxMode })
      agent.session.append('approval/policy', { policy: initialization.approvalPolicy })
      if (kind === 'extra-event') agent.session.append('turn/start', { turn: 1 })
    } })
  cleanup.push(() => handle.dispose())
  expect(() => prepared.attach(handle)).toThrow()
})

it('a dispatch fence rechecks after auth without revoking original receipt authority', async () => {
  const entered = Promise.withResolvers<void>(), auth = Promise.withResolvers<{ headers: {} }>()
  const h = await harness('work', async () => { entered.resolve(); return auth.promise })
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const generation = h.source.start(h.binding, safeUser())
  await entered.promise; h.fence(); auth.resolve({ headers: {} }); await h.handle.agent.whenIdle()
  expect(fetch).not.toHaveBeenCalled()
  expect(await h.source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', usageKnown: false, receipt: null })
})

it('cancel can settle a fully observed original response after its original tool returns', async () => {
  const entered = Promise.withResolvers<void>(), tool = Promise.withResolvers<void>()
  const h = await harness('main', undefined, async () => { entered.resolve(); await tool.promise })
  vi.stubGlobal('fetch', async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'offline-fenced-delegation', name: 'dsh_bot_delegate', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')))
  const generation = h.source.start(h.binding, safeUser())
  await entered.promise; h.fence()
  expect(await h.source.cancel(generation, 1)).toMatchObject({ local: 'pending', remote: 'UNKNOWN', receipt: null })
  tool.resolve(); await h.handle.agent.whenIdle()
  const result = await h.source.inspect(generation)
  expect(result).toMatchObject({ local: 'returned', remote: 'settled', usageKnown: true, requestCount: 1 })
  expect(native.isOwnedGenerationReceipt(result.receipt, h.source, h.binding)).toBe(true)
  expect(native.isOwnedGenerationReceipt(result.receipt, h.source, { ...h.binding, generation: 2 })).toBe(false)
})
