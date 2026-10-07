/** Real native AgentLoop + preset + JSONL + journal; only the remote text transport is fake. */
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { finalResponse } from '../../../sdk/client/src/api.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import * as native from '../src/index.ts'
import { fixture, safeResponse, safeUser, emptyMaxTokensResponse } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
async function harness(resolveAuth?: () => Promise<{ headers: {} }>) {
  const f = await fixture(resolveAuth)
  expect(native.NativeSessionDriver).toBeTypeOf('function')
  expect(f.factory?.protectSession).toBeTypeOf('function')
  const target = { id: native.NativeTargetId('owned-bot'), runGeneration: 1, botEpoch: 1, taskEpoch: 1, taskRevision: 1,
    authorityEpoch: 1, membershipGeneration: 1, configVersion: 1, scopeRef: 'text-only',
    provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 16, reasoningEffort: 'off',
    endpoint: 'https://api.deepseek.com/anthropic/v1/messages', state: 'active',
    sessionBinding: { sessionId: 'native-owned-session', agentPreset: 'acceptance/empty', controlConfigId: '32d0364f-b94d-4d50-a44a-d2898b63c3df', cwd: f.directory },
  } as const
  // Real Cordis owner fiber capability. This proves private runtime ownership, not human authority.
  const caller = f.ctx.fiber
  const hostConfig = { directory: join(f.directory, 'journal'), create: true, hostId: 'owned-session-host', targets: [target],
    capacity: { executionSlots: 1, contactSlots: 1, executionTokens: 512, contactTokens: 512, tokenReservationPerStep: 128,
      maxSteps: 3, admissionDeadlineMs: 1000, settlementDeadlineMs: 400 },
    authorize: (candidate: object) => candidate === caller,
  }
  const host = await native.NativeRunHost.open(hostConfig)
  cleanup.push(() => host.close())
  const driver = await native.NativeSessionDriver.createOwned(f.ctx, host, target.id, f.factory!)
  const request = (id = 'operation-one', steps = ['Safe first turn'], kind: 'contact' | 'execution' = 'execution') => ({ id: native.NativeOperationId(id), targetId: target.id, binding: host.target(caller, target.id), kind, steps })
  return { ...f, host, driver, caller, request, target, hostConfig }
}

it('consumes two journaled native turns and settles only persisted Session receipts', async () => {
  const h = await harness()
  const fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request('two-turns', ['Safe first turn', 'Safe second turn']))
  const result = await h.driver.drive(h.caller, native.NativeOperationId('two-turns'))
  expect(result).toMatchObject({ state: 'settled', nextStep: 2, reservationHeld: false, answers: ['Offline native answer', 'Offline native answer'] })
  expect(result.attempts).toHaveLength(2)
  expect(result.attempts.every(a => a.state === 'observed' && a.sessionReceipt?.sessionId === 'native-owned-session')).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(h.host.capacity(h.caller).executionSlotsAvailable).toBe(1)
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  expect(h.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')).toBe('acceptance/empty')
  const stored = await h.ctx.sessionPersistence.open(agent.id, 'read')
  const events = (await stored.read()).events; await stored.close()
  expect(events.filter(e => e.type === 'user/message').map(e => e.data.content)).toEqual([[{ type: 'text', text: 'Safe first turn' }], [{ type: 'text', text: 'Safe second turn' }]])
  expect(events.filter(e => e.type === 'assistant/message')).toHaveLength(2)
  const projection = { finalResponse: finalResponse([...events]), finishReasons: events.flatMap(e => e.type === 'turn/end' ? [e.data.reason.kind] : []),
    assistantCount: events.filter(e => e.type === 'assistant/message').length, userCount: events.filter(e => e.type === 'user/message').length,
    journalState: result.state, receipts: result.attempts.map(attempt => attempt.sessionReceipt), usage: result.usage }
  const expected = JSON.parse(await readFile(new URL('./expected/native-session.json', import.meta.url), 'utf8'))
  expect({ ...projection, receipts: projection.receipts.length }).toEqual(expected)
  const evidenceHome = process.env.DSH_HOME
  if (evidenceHome !== undefined) await writeFile(join(evidenceHome, 'native-session-proof.json'), JSON.stringify({ events, projection }, null, 2) + '\n')
})

it.each([
  ['dispose', 'OFFLINE_STORAGE_CLOSE_FAILURE', 'OFFLINE_STORAGE_CLOSE_FAILURE'],
  ['derive', 'OFFLINE_HISTORY_FAILURE', 'OFFLINE_HISTORY_FAILURE'],
  ['dispose', 'unsafe opaque/code', 'NATIVE_CONSUMER_FAILURE'],
  ['dispose', 'x'.repeat(129), 'NATIVE_CONSUMER_FAILURE'],
  ['dispose', { toString: (): string => 'VALID_CODE', detail: 'opaque object' }, 'NATIVE_CONSUMER_FAILURE'],
] as const)('retains known durable settlement and reports a late %s error through restart (%s)', async (phase, code, expectedCode) => {
  const h = await harness()
  const operationId = native.NativeOperationId('late-local-error')
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  const failure = Object.assign(new Error('offline local failure'), { code })
  let lateCalls = 0
  let restore: () => void
  if (phase === 'dispose') {
    const originalOpen = h.ctx.sessionPersistence.open.bind(h.ctx.sessionPersistence)
    const spy = vi.spyOn(h.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      if (args[1] === 'read') {
        const dispose = handle[Symbol.asyncDispose].bind(handle)
        vi.spyOn(handle, Symbol.asyncDispose).mockImplementation(async () => { await dispose(); lateCalls++; throw failure })
      }
      return handle
    })
    restore = () => spy.mockRestore()
  } else {
    const derive = agent.session.deriveMessages.bind(agent.session)
    const spy = vi.spyOn(agent.session, 'deriveMessages').mockImplementation((...args) => {
      if (h.host.inspect(h.caller, operationId).state === 'settled') { lateCalls++; throw failure }
      return derive(...args)
    })
    restore = () => spy.mockRestore()
  }
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request(operationId))
  const result = await h.driver.drive(h.caller, operationId)
  restore()
  expect(lateCalls).toBe(1)
  expect(result).toMatchObject({ state: 'settled', reservationHeld: false, remoteExecution: 'response_observed',
    failureCode: expectedCode, answers: ['Offline native answer'], usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } })
  expect(result.attempts[0]?.state).toBe('observed')
  expect(result.attempts[0]?.sessionReceipt?.sessionId).toBe('native-owned-session')
  expect(h.host.capacity(h.caller)).toMatchObject({ executionSlotsAvailable: 1, executionTokensAvailable: 504 })
  await h.driver.close(); await h.host.close()
  const reopened = await native.NativeRunHost.open({ ...h.hostConfig, create: false })
  cleanup.push(() => reopened.close())
  const resumed = await native.NativeSessionDriver.resumeOwned(h.ctx, reopened, h.target.id, h.factory!)
  expect(reopened.inspect(h.caller, operationId)).toEqual(result)
  expect(await resumed.drive(h.caller, operationId)).toEqual(result)
  expect(fetch).toHaveBeenCalledOnce()
})

it('blocks the direct baseline driver and serialized callers for Session-bound operations', async () => {
  const h = await harness()
  await h.host.admit(h.caller, h.request())
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const direct = h.host.driver({ options: () => { throw new Error('direct preparation must never run') }, resolveAuth: async () => ({ headers: {} }), resolveUserId: () => { throw new Error('unused') }, prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) })
  await expect(direct.drive(h.caller, native.NativeOperationId('operation-one'))).rejects.toMatchObject({ code: 'SESSION_CONSUMER_REQUIRED' })
  await expect(h.driver.drive({ actor: 'human', owner: 'owned-session-host' }, native.NativeOperationId('operation-one'))).rejects.toMatchObject({ code: 'CALLER_UNAUTHORIZED' })
  expect(fetch).not.toHaveBeenCalled()
})

it('routes actual native error retry through the guard, retaining unknown after one fetch', async () => {
  const h = await harness()
  let retries = 0
  h.ctx.on('agent/request-error', async (_args, next) => { retries++; return next() })
  await h.ctx.plugin(LlmRetry)
  const fetch = vi.fn(async () => { throw new Error('ambiguous offline response loss') }); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  expect(await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'unknown', reservationHeld: true, usage: null })
  expect(retries).toBe(2)
  expect(fetch).toHaveBeenCalledOnce()
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  expect(agent.session.snapshotEvents().filter(e => e.type === 'assistant/attempt')).toHaveLength(2)
  expect(agent.session.snapshotEvents().filter(e => e.type === 'llm/retry-started')).toHaveLength(1)
  expect(await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'unknown' })
  expect(fetch).toHaveBeenCalledOnce()
})

it('never reuses an unknown native Session as a new admitted operation after real resume', async () => {
  const h = await harness()
  const fetch = vi.fn(async (): Promise<Response> => { throw new Error('ambiguous offline transport') }); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  expect(await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'unknown' })
  await h.driver.close(); await h.host.close()
  const reopened = await native.NativeRunHost.open({ ...h.hostConfig, create: false })
  cleanup.push(() => reopened.close())
  const resumed = await native.NativeSessionDriver.resumeOwned(h.ctx, reopened, h.target.id, h.factory!)
  expect(h.ctx.agents.get(SessionId('native-owned-session'))!.session.snapshotEvents().some(e => e.type === 'user/message')).toBe(true)
  expect(await resumed.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'unknown', reservationHeld: true })
  fetch.mockImplementation(async () => safeResponse())
  await reopened.admit(h.caller, { id: native.NativeOperationId('new-admission'), targetId: h.target.id, kind: 'contact',
    steps: ['New safe text'], binding: reopened.target(h.caller, h.target.id) })
  await expect(resumed.drive(h.caller, native.NativeOperationId('new-admission'))).rejects.toMatchObject({ code: 'SESSION_OUTCOME_UNKNOWN' })
  expect(fetch).toHaveBeenCalledOnce()
})

it.each(['before-dispatch', 'after-response'] as const)('does not settle or release capacity when native persistence fails %s', async (phase) => {
  const h = await harness()
  let flushes = 0
  h.ctx.on('session/flush', async () => {
    flushes++
    if (phase === 'before-dispatch' || flushes >= 2) throw new Error('offline forced checkpoint failure')
  })
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  const result = await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))
  expect(result.reservationHeld).toBe(true)
  expect(result.state).toBe(phase === 'before-dispatch' ? 'admitted' : 'unknown')
  expect(fetch).toHaveBeenCalledTimes(phase === 'before-dispatch' ? 0 : 1)
})

it('rejects journal completion using fabricated native receipt coordinates', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>(), finish = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', async () => { entered.resolve(undefined); return finish.promise })
  await h.host.admit(h.caller, h.request())
  const running = h.driver.drive(h.caller, native.NativeOperationId('operation-one')); await entered.promise
  expect(() => h.host.completeStep(h.driver, native.NativeOperationId('operation-one'), 0, 'Fabricated harmless answer',
    { inputTokens: 5, outputTokens: 3, totalTokens: 8 }, { sessionId: 'native-owned-session', turn: 1, step: 1, startSeq: 0, assistantSeq: 10, endSeq: 11, assistantDigest: '0'.repeat(64), endDigest: '0'.repeat(64) })).toThrow(expect.objectContaining({ code: 'NATIVE_RECEIPT_REQUIRED' }))
  finish.resolve(safeResponse())
  expect(await running).toMatchObject({ state: 'settled' })
})

it('fences the journal before native cancel and never cancels newer-generation owned activity', async () => {
  const h = await harness()
  const entered = Promise.withResolvers<undefined>()
  vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => {
      const db = new DatabaseSync(join(h.hostConfig.directory, 'journal.sqlite'), { readOnly: true })
      expect(db.prepare('SELECT count(*) AS n FROM stops WHERE generation=1').get()).toMatchObject({ n: 1 }); db.close()
      reject(init.signal!.reason)
    }, { once: true }); entered.resolve(undefined)
  }))
  await h.host.admit(h.caller, h.request())
  const running = h.driver.drive(h.caller, native.NativeOperationId('operation-one')); await entered.promise
  await h.driver.stop(h.caller, native.NativeControlId('stop-old'), native.NativeOperationId('operation-one'))
  expect(await running).toMatchObject({ state: 'unknown', localTransport: 'closed', usage: null })
  h.host.changeTarget(h.caller, h.target.id, { kind: 'restart', sessionBinding: { ...h.target.sessionBinding, sessionId: 'native-new-generation' } })
  const newer = await native.NativeSessionDriver.createOwned(h.ctx, h.host, h.target.id, h.factory!)
  const ready = Promise.withResolvers<undefined>(), finish = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => { ready.resolve(undefined); expect(init.signal!.aborted).toBe(false); return finish.promise })
  await h.host.admit(h.caller, h.request('new-contact', ['Safe newer generation'], 'contact'))
  const next = newer.drive(h.caller, native.NativeOperationId('new-contact')); await ready.promise
  await h.driver.stop(h.caller, native.NativeControlId('late-old-stop'), native.NativeOperationId('operation-one'))
  expect(h.ctx.agents.get(SessionId('native-new-generation'))!.status).toBe('running')
  finish.resolve(safeResponse())
  expect(await next).toMatchObject({ state: 'settled' })
  expect(h.host.inspect(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'unknown', reservationHeld: true })
})

it('does not let an unjournaled native followup acquire a dispatch permit', async () => {
  const h = await harness()
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  agent.followup(safeUser('Unadmitted harmless input'))
  await agent.whenIdle()
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects foreign queued input before waking admitted native work', async () => {
  const h = await harness()
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  agent.inbox.append('next-turn', safeUser('Foreign harmless input'))
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  await expect(h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).rejects.toMatchObject({ code: 'NATIVE_INBOX_CONFLICT' })
  expect(fetch).not.toHaveBeenCalled()
})

it('resumes actual settled native history only after journal receipt reconciliation', async () => {
  const h = await harness()
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  expect(await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'settled' })
  await h.driver.close(); await h.host.close()
  const host = await native.NativeRunHost.open({ ...h.hostConfig, create: false }); cleanup.push(() => host.close())
  const driver = await native.NativeSessionDriver.resumeOwned(h.ctx, host, h.target.id, h.factory!)
  await host.admit(h.caller, { id: native.NativeOperationId('after-resume'), targetId: h.target.id, kind: 'execution', steps: ['Safe resumed turn'], binding: host.target(h.caller, h.target.id) })
  expect(await driver.drive(h.caller, native.NativeOperationId('after-resume'))).toMatchObject({ state: 'settled' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rejects Session history absent from journal receipts on actual resume', async () => {
  const h = await harness()
  const agent = h.ctx.agents.get(SessionId('native-owned-session'))!
  agent.session.append('user/message', safeUser('Unjournaled persisted text'), { surfaceOp: 'append' })
  await h.ctx.sessions.flush(agent.session)
  await h.driver.close()
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(native.NativeSessionDriver.resumeOwned(h.ctx, h.host, h.target.id, h.factory!)).rejects.toMatchObject({ code: 'NATIVE_HISTORY_CONFLICT' })
  expect(fetch).not.toHaveBeenCalled()
})

it('rechecks authority after asynchronous provider authentication before fetch', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const h = await harness(async () => { entered.resolve(undefined); await release.promise; return { headers: {} } })
  const fetch = vi.fn(async () => safeResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  const running = h.driver.drive(h.caller, native.NativeOperationId('operation-one')); await entered.promise
  h.host.changeTarget(h.caller, h.target.id, { kind: 'archive' }); release.resolve(undefined)
  expect(await running).toMatchObject({ state: 'fenced', reservationHeld: false, attempts: [] })
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects structural provider factory imitations before acquiring native Session ownership', async () => {
  const h = await harness()
  h.host.changeTarget(h.caller, h.target.id, { kind: 'restart', sessionBinding: { ...h.target.sessionBinding, sessionId: 'forged-factory-session' } })
  const protectSession = vi.fn(h.factory!.protectSession)
  const outcome = await native.NativeSessionDriver.createOwned(h.ctx, h.host, h.target.id, { protectSession })
    .then(() => 'accepted', (error: { code?: string }) => error.code)
  expect(outcome).toBe('NATIVE_PROVIDER_FACTORY_REQUIRED')
  expect(protectSession).not.toHaveBeenCalled()
  expect(h.ctx.agents.get(SessionId('forged-factory-session'))).toBeUndefined()
})

it('resumes a settled empty max-tokens native assistant using actual Session projection', async () => {
  const h = await harness()
  const fetch = vi.fn(async () => emptyMaxTokensResponse()); vi.stubGlobal('fetch', fetch)
  await h.host.admit(h.caller, h.request())
  expect(await h.driver.drive(h.caller, native.NativeOperationId('operation-one'))).toMatchObject({ state: 'settled', answers: [''] })
  await h.driver.close(); await h.host.close()
  const host = await native.NativeRunHost.open({ ...h.hostConfig, create: false }); cleanup.push(() => host.close())
  const driver = await native.NativeSessionDriver.resumeOwned(h.ctx, host, h.target.id, h.factory!)
  fetch.mockImplementation(async () => safeResponse())
  await host.admit(h.caller, { id: native.NativeOperationId('after-empty'), targetId: h.target.id, kind: 'execution', steps: ['Safe resumed turn'], binding: host.target(h.caller, h.target.id) })
  expect(await driver.drive(h.caller, native.NativeOperationId('after-empty'))).toMatchObject({ state: 'settled' })
  expect(fetch).toHaveBeenCalledTimes(2)
})
