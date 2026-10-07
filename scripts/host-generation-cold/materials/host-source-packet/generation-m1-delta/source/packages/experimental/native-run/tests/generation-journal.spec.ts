/** Protected original-native history continues only through its sealed owner journal. */
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, appendFile, writeFile } from 'node:fs/promises'
import { record, integer } from '../src/values.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { logPath } from '../../../session/session-persistence-jsonl/src/format.ts'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, config } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string, generation = 1) => ({ botId: 'journal-bot', taskId: 'journal-task', sessionId,
  generation, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1, configVersion: '11111111-1111-4111-8111-111111111111' })
const mainDelegate = (description = 'Exact known main delegation') => defineTool({ name: 'dsh_bot_delegate', description, parameters: {},
  output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'delegated' }] },
  execute: async (_args, exec) => { exec.concludeTurn(); return { pending: true } } })

async function owner(existingDirectory?: string, create = true) {
  const f = await fixture(undefined, false, existingDirectory)
  const sessionId = 'same-protected-session'
  const journalOptions = { ownerCtx: f.ctx, directory: join(f.directory, 'owned-source'), create, sessionId,
    role: 'work' as const, route: config, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  expect(native.openOwnedGenerationJournal).toBeTypeOf('function')
  const journal = await native.openOwnedGenerationJournal(journalOptions)
  cleanup.push(() => journal.close())
  expect(native.isOwnedGenerationJournal(journal, f.ctx, sessionId, 'work')).toBe(true)
  expect(native.isOwnedGenerationJournal({ ...journal }, f.ctx, sessionId, 'work')).toBe(false)
  const prepared = native.prepareOwnedGenerationSource({ ...journalOptions, providerFactory: f.factory!, journal,
    isCurrent: () => true })
  expect(prepared.mode).toBe(create ? 'create' : 'resume')
  const options = { agentOptions: config, protectedModelCalls: prepared.protectedModelCalls }
  const handle = create
    ? await f.ctx.agents.create({ ...options, sessionId: SessionId(sessionId), meta: journalOptions.session })
    : await f.ctx.agents.resume({ ...options, resumeSessionId: SessionId(sessionId) })
  cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle)
  return { ...f, source, handle, journal, prepared, sessionId, journalOptions }
}

it('continues the same known protected Session after native teardown and owner restart', async () => {
  const first = await owner()
  vi.stubGlobal('fetch', async () => safeResponse('First original result'))
  const exact = { ...binding(first.sessionId), nonce: 'first-original-nonce', operationId: 'first-original-op',
    slotLeaseId: 'first-held-lease' }
  const g1 = first.source.start(exact, safeUser('First original input'))
  await first.handle.agent.whenIdle()
  const observations = await Promise.all([first.source.inspect(g1), first.source.inspect(g1), first.source.inspect(g1)])
  for (const observation of observations) expect(observation).toMatchObject({ remote: 'settled', usageKnown: true, reason: null })
  expect(observations[0].receipt).toBe(observations[1].receipt)
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const second = await owner(first.directory, false)
  expect(second.handle.agent.id).toBe(first.sessionId)
  await expect(second.source.restore({ ...exact, nonce: 'wrong-original-nonce' })).rejects.toThrow()
  const historical = await second.source.restore(exact)
  const restored = await second.source.inspect(historical)
  expect(restored).toMatchObject({ local: 'returned', remote: 'settled', usageKnown: true, activityCounter: 1, requestCount: 1 })
  expect(native.isOwnedGenerationReceipt(restored.receipt, second.source, exact)).toBe(true)
  expect(native.isOwnedGenerationReceipt(restored.receipt, first.source, exact)).toBe(false)
  expect(native.isOwnedGenerationReceipt(restored.receipt, second.source, binding(first.sessionId))).toBe(false)
  expect(() => second.source.start(binding(first.sessionId), safeUser('Never replay old generation'))).toThrow()
  const prior = second.handle.agent.session.deriveMessages()
  expect(prior.some(message => message.content.some(block => block.type === 'text' && block.text === 'First original input'))).toBe(true)
  const entered = Promise.withResolvers<undefined>(), response = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { signal = init.signal; entered.resolve(undefined)
    return response.promise })
  const g2 = second.source.start(binding(second.sessionId, 2), safeUser('Second original input'))
  await entered.promise
  expect(await second.source.cancel(historical)).toMatchObject({ remote: 'settled', usageKnown: true })
  expect(signal?.aborted).toBe(false)
  response.resolve(safeResponse('Known continuation result'))
  await second.handle.agent.whenIdle()
  const view = await second.source.inspect(g2)
  expect(view).toMatchObject({ remote: 'settled', usageKnown: true, local: 'returned' })
  expect(native.isOwnedGenerationReceipt(view.receipt, second.source, binding(second.sessionId, 2))).toBe(true)
  await second.handle.dispose(); await second.journal.close(); await second.ctx.fiber.dispose()
  const third = await owner(first.directory, false)
  const g2Restored = await third.source.restore(binding(first.sessionId, 2))
  expect(await third.source.inspect(g2Restored)).toMatchObject({ remote: 'settled', usageKnown: true })
})

it.each(['missing-usage', 'missing-finish'] as const)('%s remains UNKNOWN across native restart', async (failure) => {
  const first = await owner()
  vi.stubGlobal('fetch', async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Incomplete actual stream' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, ...(failure === 'missing-usage' ? {} : { usage: { output_tokens: 0 } }) },
    ...(failure === 'missing-finish' ? [] : [{ type: 'message_stop' }]),
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')))
  const generation = first.source.start(binding(first.sessionId), safeUser())
  await first.handle.agent.whenIdle()
  expect(await first.source.inspect(generation)).toMatchObject({ remote: 'UNKNOWN', usageKnown: false })
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const second = await fixture(undefined, false, first.directory)
  await expect(native.openOwnedGenerationJournal({ ...first.journalOptions, ownerCtx: second.ctx, create: false })).rejects.toThrow()
  expect(second.ctx.agents.get(SessionId(first.sessionId))).toBeUndefined()
})

it('unfinished original generation prevents source reopening before any resume or transport', async () => {
  const first = await owner(), entered = Promise.withResolvers<undefined>()
  vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { reject(new Error('Fixture aborted')) }, { once: true }); entered.resolve(undefined)
  }))
  const generation = first.source.start(binding(first.sessionId), safeUser())
  await entered.promise
  expect(await first.source.cancel(generation)).toMatchObject({ remote: 'UNKNOWN', usageKnown: false })
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const second = await fixture(undefined, false, first.directory)
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await expect(native.openOwnedGenerationJournal({ ...first.journalOptions, ownerCtx: second.ctx, create: false })).rejects.toThrow()
  expect(second.ctx.agents.get(SessionId(first.sessionId))).toBeUndefined()
  expect(fetch).not.toHaveBeenCalled()
})

it('a second writer cannot obtain a capability or prepare side effects', async () => {
  const h = await owner()
  await expect(native.openOwnedGenerationJournal({ ...h.journalOptions, create: false })).rejects.toThrow()
  expect(() => native.prepareOwnedGenerationSource({ ...h.journalOptions, providerFactory: h.factory!,
    journal: { ...h.journal }, isCurrent: () => true })).toThrow()
})

it('external log mutation invalidates a sealed checkpoint before native resume', async () => {
  const first = await owner()
  vi.stubGlobal('fetch', async () => safeResponse())
  const generation = first.source.start(binding(first.sessionId), safeUser())
  await first.handle.agent.whenIdle(); expect((await first.source.inspect(generation)).remote).toBe('settled')
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const path = logPath(join(first.directory, 'sessions'), first.directory, SessionId(first.sessionId), 'none')
  const bytes = await readFile(path)
  const last: unknown = JSON.parse(bytes.toString().trim().split('\n').at(-1)!)
  if (!record(last) || !integer(last.seq)) throw new Error('Fixture expects final exact log seq')
  await appendFile(path, JSON.stringify({ ...last, seq: last.seq + 1, type: 'user/message',
    data: safeUser('Unsealed external input') }) + '\n')
  const second = await fixture(undefined, false, first.directory)
  await expect(native.openOwnedGenerationJournal({ ...first.journalOptions, ownerCtx: second.ctx, create: false })).rejects.toThrow()
})

it('freezes native policy before the first asynchronous filesystem operation', async () => {
  const f = await fixture(), sessionId = 'immutable-policy'
  const route = { ...config }
  const options = { ownerCtx: f.ctx, directory: join(f.directory, 'immutable-source'), create: true, sessionId,
    role: 'work' as const, route, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  const pending = native.openOwnedGenerationJournal(options)
  route.model = 'changed-after-open'
  const journal = await pending; cleanup.push(() => journal.close())
  expect(() => native.prepareOwnedGenerationSource({ ...options, route, journal, providerFactory: f.factory!,
    isCurrent: () => true })).toThrow()
  const prepared = native.prepareOwnedGenerationSource({ ...options, route: config, journal, providerFactory: f.factory!,
    isCurrent: () => true })
  expect(native.isPreparedOwnedGenerationSource(prepared, f.ctx, sessionId, 'work')).toBe(true)
})

it('closed or consumed preparation cannot authorize another native creation', async () => {
  const h = await owner()
  expect(native.isPreparedOwnedGenerationSource(h.prepared, h.ctx, h.sessionId, 'work')).toBe(false)
  expect(native.isOwnedGenerationJournal(h.journal, h.ctx, h.sessionId, 'work')).toBe(true)
  await h.journal.close()
  expect(native.isOwnedGenerationJournal(h.journal, h.ctx, h.sessionId, 'work')).toBe(false)
  expect(() => native.prepareOwnedGenerationSource({ ...h.journalOptions, journal: h.journal,
    providerFactory: h.factory!, isCurrent: () => true })).toThrow()
})

it('zero-tool durable policy cannot be widened to parent work delegation', async () => {
  const f = await fixture(), sessionId = 'zero-tool-journal'
  const options = { ownerCtx: f.ctx, directory: join(f.directory, 'zero-tool-source'), create: true, sessionId,
    role: 'work' as const, route: config, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
  const delegateTool = defineTool({ name: 'dsh_bot_delegate', description: 'Unauthorized widening', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}) })
  expect(() => native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!,
    isCurrent: () => true, workDelegate: { plannedBinding: binding(sessionId), delegateTool } })).toThrow()
  expect(f.ctx.agents.get(SessionId(sessionId))).toBeUndefined()
})

it('known main preserves its exact initialization and delegate policy before resumed mounting', async () => {
  const f = await fixture(), sessionId = 'same-known-main'
  const initialization = { permissionPreset: 'workspace-write', sandboxMode: 'workspace-write', approvalPolicy: 'ask' }
  const options = { ownerCtx: f.ctx, directory: join(f.directory, 'main-source'), create: true, sessionId,
    role: 'main' as const, route: config, initialization, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
  const prepared = native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: options.session, protectedModelCalls: prepared.protectedModelCalls, setup: async (_ctx, agent) => {
      agent.session.append('permission/preset', { preset: initialization.permissionPreset })
      agent.session.append('sandbox/mode', { mode: initialization.sandboxMode })
      agent.session.append('approval/policy', { policy: initialization.approvalPolicy })
    } }); cleanup.push(() => handle.dispose())
  const delegateTool = mainDelegate(), source = prepared.attach(handle, { delegateTool }); handle.agent.ctx.tools.register(delegateTool)
  const sse = () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'main-delegate',
      name: 'dsh_bot_delegate', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  vi.stubGlobal('fetch', async () => sse())
  const first = source.start(binding(sessionId), safeUser('Main original delegation'))
  await handle.agent.whenIdle(); expect((await source.inspect(first)).remote).toBe('settled')
  await handle.dispose(); await journal.close(); await f.ctx.fiber.dispose()
  const next = await fixture(undefined, false, f.directory)
  const reopened = await native.openOwnedGenerationJournal({ ...options, ownerCtx: next.ctx, create: false })
  cleanup.push(() => reopened.close())
  const policy = { ...options, ownerCtx: next.ctx, providerFactory: next.factory!, journal: reopened, isCurrent: () => true }
  expect(() => native.prepareOwnedGenerationSource(policy)).toThrow()
  expect(() => native.prepareOwnedGenerationSource({ ...policy, delegateTool: mainDelegate('Different restored schema') })).toThrow()
  expect(next.ctx.agents.get(SessionId(sessionId))).toBeUndefined()
  const actualDelegate = mainDelegate(), resumed = native.prepareOwnedGenerationSource({ ...policy, delegateTool: actualDelegate })
  const retained = await next.ctx.agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions: config,
    protectedModelCalls: resumed.protectedModelCalls }); cleanup.push(() => retained.dispose())
  const restored = resumed.attach(retained); retained.agent.ctx.tools.register(actualDelegate)
  const historical = await restored.restore(binding(sessionId))
  expect(await restored.inspect(historical)).toMatchObject({ remote: 'settled', usageKnown: true })
  const second = restored.start(binding(sessionId, 2), safeUser('Main same-session continuation'))
  await retained.agent.whenIdle(); expect((await restored.inspect(second)).remote).toBe('settled')
})

it('checks durable history again at dispatch rather than trusting a live projection', async () => {
  const authEntered = Promise.withResolvers<undefined>(), releaseAuth = Promise.withResolvers<{ headers: {} }>()
  const f = await fixture(async () => { authEntered.resolve(undefined); return releaseAuth.promise }), sessionId = 'durable-dispatch'
  const options = { ownerCtx: f.ctx, directory: join(f.directory, 'durable-source'), create: true, sessionId,
    role: 'work' as const, route: config, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
  const prepared = native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: options.session, protectedModelCalls: prepared.protectedModelCalls }); cleanup.push(() => handle.dispose())
  const source = prepared.attach(handle), fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const generation = source.start(binding(sessionId), safeUser('Immutable original input'))
  await authEntered.promise
  const path = logPath(join(f.directory, 'sessions'), f.directory, SessionId(sessionId), 'none')
  const bytes = await readFile(path, 'utf8'), rows = bytes.trim().split('\n').map((line): unknown => JSON.parse(line))
  const user = rows.find(row => record(row) && row.type === 'user/message')
  if (!record(user) || !record(user.data)) throw new Error('Fixture expects original user event')
  user.data.content = [{ type: 'text', text: 'External different input' }]
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  releaseAuth.resolve({ headers: {} }); await handle.agent.whenIdle()
  expect(fetch).not.toHaveBeenCalled()
  expect(await source.inspect(generation)).toMatchObject({ local: 'returned', remote: 'UNKNOWN', receipt: null })
})
