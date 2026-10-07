/** Actual official policy hooks produce native-branded context, never extra operator authorization. */
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as native from '../src/index.ts'
import { fixture, config, safeUser, safeResponse } from './protected-fixture.ts'
import { logPath } from '../../../session/session-persistence-jsonl/src/format.ts'
import { record } from '../src/values.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const binding = (sessionId: string) => ({ botId: 'policy-bot', taskId: 'policy-work', sessionId,
  generation: 1, botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1,
  configVersion: '11111111-1111-4111-8111-111111111111', operationId: 'policy-original-op', nonce: 'policy-original-nonce', slotLeaseId: 'policy-held-lease' })
async function owner(existingDirectory?: string, create = true) {
  const f = await fixture(undefined, false, existingDirectory, false, true), sessionId = 'actual-native-policy-session'
  const initialization = { permissionPreset: 'workspace-write', sandboxMode: 'workspace-write', approvalPolicy: 'ask' }
  const options = { ownerCtx: f.ctx, directory: join(f.directory, 'journal'), create, sessionId, role: 'work' as const,
    route: config, initialization, session: { cwd: f.directory, agentPreset: 'acceptance/empty' } }
  const journal = await native.openOwnedGenerationJournal(options); cleanup.push(() => journal.close())
  const prepared = native.prepareOwnedGenerationSource({ ...options, journal, providerFactory: f.factory!, isCurrent: () => true })
  const handle = create ? await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config, meta: options.session,
    protectedModelCalls: prepared.protectedModelCalls, setup: async (_ctx, agent) => {
      agent.session.append('permission/preset', { preset: initialization.permissionPreset })
      agent.session.append('sandbox/mode', { mode: initialization.sandboxMode })
      agent.session.append('approval/policy', { policy: initialization.approvalPolicy })
    } }) : await f.ctx.agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions: config,
    protectedModelCalls: prepared.protectedModelCalls })
  cleanup.push(() => handle.dispose())
  return { ...f, handle, journal, source: prepared.attach(handle), sessionId }
}
it('settles and restores the exact original window with official sandbox and approval snapshots', async () => {
  const first = await owner(), fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  const exact = binding(first.sessionId), input = safeUser('One actual operator input'), generation = first.source.start(exact, input)
  await first.handle.agent.whenIdle()
  const view = await first.source.inspect(generation)
  expect(view).toMatchObject({ remote: 'settled', usageKnown: true, local: 'returned' })
  const window = native.getOwnedGenerationReceiptInputWindow(view.receipt, first.source, exact)
  expect(window?.inputMessageId).toBe(input.id)
  expect(window?.runtimeContexts).toHaveLength(1)
  expect(window?.runtimeContexts[0]?.messageId).toBeTypeOf('string')
  expect(window?.runtimeContexts[0]?.messageDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(window?.runtimeContexts[0]?.seq).toBeTypeOf('number')
  expect(native.getOwnedGenerationReceiptInputWindow({ ...view.receipt }, first.source, exact)).toBeNull()
  const stored = await first.ctx.sessionPersistence.open(SessionId(first.sessionId), 'read')
  try {
    const events = (await stored.read()).events, users = events.filter(event => event.type === 'user/message')
    expect(users).toHaveLength(2)
    const context = users.find(event => event.seq === window!.runtimeContexts[0]!.seq)!
    expect(context.data.source).toMatchObject({ kind: 'runtime-context', form: 'snapshot', sections: [
      { name: 'sandbox:policy' }, { name: 'approval:policy' },
    ] })
    expect(context.data.id).toBe(window!.runtimeContextMessageIds[0])
  } finally { await stored.close() }
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const second = await owner(first.directory, false), restored = await second.source.restore(exact)
  const historical = await second.source.inspect(restored)
  expect(native.getOwnedGenerationReceiptInputWindow(historical.receipt, second.source, exact)).toEqual(window)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each(['operator', 'runtime-context', 'copy-native-context'])('rejects extra %s input before any protected dispatch', async (kind) => {
  const h = await owner(), fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  h.handle.agent.ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const extra = kind === 'copy-native-context' ? structuredClone(decision.messages.at(-1)!)
      : createUserMessage({ source: kind === 'runtime-context' ? { kind: 'runtime-context', form: 'snapshot', sections: [] }
        : { kind: 'user' }, content: [{ type: 'text', text: 'Extra unowned input' }] })
    return { ...decision, messages: [...decision.messages, extra] }
  })
  const generation = h.source.start(binding(h.sessionId), safeUser()); await h.handle.agent.whenIdle()
  const view = await h.source.inspect(generation)
  expect(view).toMatchObject({ remote: 'UNKNOWN', usageKnown: false, receipt: null })
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects changed native runtime-context history before a same-id resumed provider can dispatch', async () => {
  const first = await owner(), fetch = vi.fn(async () => safeResponse())
  vi.stubGlobal('fetch', fetch)
  const exact = binding(first.sessionId), generation = first.source.start(exact, safeUser())
  await first.handle.agent.whenIdle()
  const receipt = (await first.source.inspect(generation)).receipt
  const window = native.getOwnedGenerationReceiptInputWindow(receipt, first.source, exact)!
  await first.handle.dispose(); await first.journal.close(); await first.ctx.fiber.dispose()
  const path = logPath(join(first.directory, 'sessions'), first.directory, SessionId(first.sessionId), 'none')
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n').map((line) => {
    const value: unknown = JSON.parse(line)
    if (record(value) && value.seq === window.runtimeContexts[0]?.seq && record(value.data)) {
      value.data.content = [{ type: 'text', text: 'Changed sealed native context' }]
    }
    return JSON.stringify(value)
  })
  await writeFile(path, lines.join('\n') + '\n')
  await expect(owner(first.directory, false)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})
