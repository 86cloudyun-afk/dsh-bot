/** Full native parent/child journals restore their original ids and sealed ownership without replay. */
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as native from '../src/index.ts'
import { digest } from '../src/values.ts'
import { fixture, safeUser, safeResponse, config } from './protected-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })
const parentId = 'known-native-parent', childId = 'known-native-child'
function full(sessionId: string, generation: number, input: ReturnType<typeof safeUser>): native.OwnedWorkGenerationBinding {
  const operationId = `${sessionId}-op-${generation}`
  return { botId: 'known-tree-bot', taskId: sessionId, sessionId, generation,
    botEpoch: generation, taskEpoch: generation, taskRevision: generation, authorityEpoch: generation,
    configVersion: 'original-known-tree-config', operationId, nonce: `${sessionId}-nonce-${generation}`,
    inputMessageId: input.id, messageIdentity: digest(input), slotLease: { taskId: sessionId, sessionId, generation, operationId } }
}
const toolResponse = () => new Response([
  { type: 'message_start', message: { usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'original-known-child-call', name: 'dsh_bot_delegate', input: {} } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
const delegate = (body: () => Promise<void>) => defineTool({ name: 'dsh_bot_delegate', description: 'Exact sealed child owner', parameters: {},
  output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'Known child owner' }] },
  execute: async (_args, exec) => { await body(); exec.concludeTurn(); return { pending: true } } })

it.each(['child-first', 'parent-first', 'unowned-parent', 'unknown-parent'])('restores the same-id tree and admits only owned continuation with %s ordering', async (ordering) => {
  const first = await fixture(undefined, false, undefined, true)
  await native.mountOwnedGenerationArchiveGate(first.ctx)
  const parentInput = safeUser('Original parent'), childInput = safeUser('Original child')
  const parentBinding = full(parentId, 1, parentInput), childBinding = full(childId, 1, childInput)
  const options = (sessionId: string) => ({ ownerCtx: first.ctx, directory: join(first.directory, sessionId), create: true,
    sessionId, role: 'work' as const, route: config, session: { cwd: first.directory, agentPreset: 'acceptance/empty' } })
  const parentOptions = { ...options(parentId), toolPolicy: 'delegate' as const }
  const parentJournal = await native.openOwnedGenerationJournal(parentOptions); cleanup.push(() => parentJournal.close())
  let child: {
    handle: Awaited<ReturnType<typeof first.ctx.agents.create>>
    source: native.OwnedGenerationSource
    journal: native.OwnedGenerationJournal
    generation: native.OwnedNativeGeneration
  } | undefined
  let active = true, fenced = false
  const authority = { isAuthorized: () => true, isDispatchFenced: () => fenced }
  const tool = delegate(async () => {
    const childOptions = options(childId), journal = await native.openOwnedGenerationJournal(childOptions)
    cleanup.push(() => journal.close())
    const { role: _derivedRole, ...policy } = childOptions
    const prepared = native.prepareOwnedChildGenerationSource(parent, parentGeneration, { ...policy, journal,
      ownerCtx: first.ctx, providerFactory: first.factory!, plannedBinding: childBinding,
      isCurrent: value => active && digest(value) === digest(childBinding) })
    const handle = await first.ctx.agents.create({ sessionId: SessionId(childId), agentOptions: config,
      protectedModelCalls: prepared.protectedModelCalls, parentAgent: prepared.parentAgent,
      meta: { ...childOptions.session, parentSession: SessionId(parentId), origin: 'subagent', delegationDepth: 1 } })
    cleanup.push(() => handle.dispose())
    const source = prepared.attach(handle), generation = source.start(childBinding, childInput)
    child = { handle, source, generation, journal }
    await handle.agent.whenIdle(); expect((await source.inspect(generation)).remote).toBe('settled')
  })
  const prepared = native.prepareOwnedGenerationSource({ ...parentOptions, journal: parentJournal, providerFactory: first.factory!,
    workDelegate: { plannedBinding: parentBinding, delegateTool: tool },
    isCurrent: value => active && digest(value) === digest(parentBinding) })
  const parentHandle = await first.ctx.agents.create({ sessionId: SessionId(parentId), meta: parentOptions.session, agentOptions: config,
    protectedModelCalls: prepared.protectedModelCalls }); cleanup.push(() => parentHandle.dispose())
  parentHandle.agent.ctx.tools.register(tool); const parent = prepared.attach(parentHandle)
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    if (typeof init.body !== 'string') throw new Error('Expected actual protected provider JSON body')
    return init.body.includes('dsh_bot_delegate') ? toolResponse() : safeResponse()
  }); vi.stubGlobal('fetch', fetch)
  const parentGeneration = parent.start(parentBinding, parentInput); await parentHandle.agent.whenIdle()
  expect((await parent.inspect(parentGeneration)).remote).toBe('settled'); expect(child).toBeDefined()
  const parentControl = native.admitOwnedGenerationControl(parent, parentGeneration, first.ctx, parentBinding, authority)
  const childControl = native.admitOwnedGenerationControl(child!.source, child!.generation, first.ctx, childBinding, authority)
  active = false; fenced = true
  expect((await childControl.archive()).archived).toBe(true); expect((await parentControl.archive()).archived).toBe(true)
  await child!.handle.dispose(); await child!.journal.close(); await parentHandle.dispose()
  await parentJournal.close(); await first.ctx.fiber.dispose()
  const second = await fixture(undefined, false, first.directory, true); await native.mountOwnedGenerationArchiveGate(second.ctx)
  const admitted: { parent?: native.OwnedWorkGenerationBinding; child?: native.OwnedWorkGenerationBinding } = {}
  const reopenedParent = await native.openOwnedGenerationJournal({ ...parentOptions, ownerCtx: second.ctx, create: false })
  cleanup.push(() => reopenedParent.close())
  const readAuthority = { isAuthorized: () => true, isDispatchFenced: () => false }
  const parentSelector = await native.selectOwnedGenerationHistory(reopenedParent, second.ctx, parentBinding, readAuthority)
  const nextTool = delegate(async () => {})
  const originalPolicy = { ...parentOptions, ownerCtx: second.ctx, journal: reopenedParent, providerFactory: second.factory!,
    workDelegate: { plannedBinding: parentBinding, delegateTool: nextTool }, isCurrent: () => false }
  expect(() => native.prepareOwnedGenerationSource(originalPolicy)).toThrow()
  expect(() => native.prepareOwnedGenerationSource({ ...originalPolicy, historicalPlan: { ...parentSelector } })).toThrow()
  expect(() => native.prepareOwnedGenerationSource({ ...originalPolicy, historicalPlan: parentSelector,
    workDelegate: { plannedBinding: { ...parentBinding, nonce: 'conflicting-original' }, delegateTool: nextTool } })).toThrow()
  const resumed = native.prepareOwnedGenerationSource({ ...parentOptions, ownerCtx: second.ctx, journal: reopenedParent,
    providerFactory: second.factory!, historicalPlan: parentSelector,
    workDelegate: { plannedBinding: parentBinding, delegateTool: nextTool },
    isCurrent: value => admitted.parent !== undefined && digest(value) === digest(admitted.parent) })
  const nextParentHandle = await second.ctx.agents.resume({ resumeSessionId: SessionId(parentId), agentOptions: config,
    protectedModelCalls: resumed.protectedModelCalls }); cleanup.push(() => nextParentHandle.dispose())
  nextParentHandle.agent.ctx.tools.register(nextTool)
  const nextParent = resumed.attach(nextParentHandle), originalParent = await nextParent.restoreKnown(parentSelector)
  const childOptions = { ...options(childId), ownerCtx: second.ctx, create: false }
  const reopenedChild = await native.openOwnedGenerationJournal(childOptions); cleanup.push(() => reopenedChild.close())
  const childSelector = await native.selectOwnedGenerationHistory(reopenedChild, second.ctx, childBinding, readAuthority)
  const { role: _derivedRole, ...policy } = childOptions
  const childPolicy = { ...policy, journal: reopenedChild, providerFactory: second.factory!, plannedBinding: childBinding,
    historicalPlan: childSelector,
    isCurrent: (value: native.NativeGenerationBinding) => admitted.child !== undefined && digest(value) === digest(admitted.child) }
  expect(() => native.prepareOwnedGenerationSource({ ...childPolicy, role: 'work' })).toThrow()
  await expect(native.prepareOwnedKnownChildGenerationSource({ ...nextParent }, originalParent, childPolicy)).rejects.toThrow()
  await expect(native.prepareOwnedKnownChildGenerationSource(nextParent, Object.freeze({}), childPolicy)).rejects.toThrow()
  const knownChild = await native.prepareOwnedKnownChildGenerationSource(nextParent, originalParent, childPolicy)
  expect(knownChild.mode).toBe('resume'); expect(knownChild.parentAgent).toBe(nextParentHandle.agent)
  const nextChildHandle = await second.ctx.agents.resume({ resumeSessionId: SessionId(childId), agentOptions: config,
    protectedModelCalls: knownChild.protectedModelCalls, parentAgent: knownChild.parentAgent })
  cleanup.push(() => nextChildHandle.dispose())
  const nextChild = knownChild.attach(nextChildHandle), originalChild = await nextChild.restoreKnown(childSelector)
  expect((await nextChild.inspect(originalChild)).remote).toBe('settled')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(() => nextParent.start(parentBinding, parentInput)).toThrow()
  expect(() => nextChild.start(childBinding, childInput)).toThrow()
  await native.unarchiveOwnedGenerationSource(nextParent, second.ctx, readAuthority)
  await native.unarchiveOwnedGenerationSource(nextChild, second.ctx, readAuthority)
  expect(() => nextParent.start(parentBinding, parentInput)).toThrow()
  expect(() => nextChild.start(childBinding, childInput)).toThrow()
  expect(fetch).toHaveBeenCalledTimes(2)
  const nextParentInput = safeUser('New original parent g2'), nextChildInput = safeUser('New original child g2')
  const nextParentBinding = full(parentId, 2, nextParentInput), nextChildBinding = full(childId, 2, nextChildInput)
  admitted.parent = nextParentBinding; admitted.child = nextChildBinding
  const continueChild = async (): Promise<void> => {
    native.planOwnedWorkGenerationSource(nextChild, second.ctx, nextChildBinding)
    const childG2 = nextChild.start(nextChildBinding, nextChildInput); await nextChildHandle.agent.whenIdle()
    const observed = await nextChild.inspect(childG2)
    expect(observed.remote).toBe('settled')
    expect(observed.usageKnown).toBe(true)
    expect(native.isOwnedGenerationReceipt(observed.receipt, nextChild, nextChildBinding)).toBe(true)
  }
  const continueParent = async (known = true): Promise<void> => {
    native.planOwnedWorkGenerationSource(nextParent, second.ctx, nextParentBinding)
    const parentG2 = nextParent.start(nextParentBinding, nextParentInput); await nextParentHandle.agent.whenIdle()
    const observed = await nextParent.inspect(parentG2)
    expect(observed.remote).toBe(known ? 'settled' : 'UNKNOWN')
    expect(observed.usageKnown).toBe(known)
    expect(native.isOwnedGenerationReceipt(observed.receipt, nextParent, nextParentBinding)).toBe(known)
  }
  if (ordering === 'child-first') { await continueChild(); await continueParent() }
  else {
    if (ordering === 'unknown-parent') {
      fetch.mockImplementationOnce(async () => new Response((await toolResponse().text()).replace('"output_tokens":3', '"missing_usage":3')))
      await continueParent(false)
      native.planOwnedWorkGenerationSource(nextChild, second.ctx, nextChildBinding)
      expect(() => nextChild.start(nextChildBinding, nextChildInput)).toThrow('GENERATION_KNOWN_PARENT_ACTIVITY_REQUIRED')
      expect(fetch).toHaveBeenCalledTimes(3)
      return
    }
    await continueParent()
    if (ordering === 'unowned-parent') {
      nextParentHandle.agent.followup(safeUser('Unowned parent replacement'))
      await nextParentHandle.agent.whenIdle()
      native.planOwnedWorkGenerationSource(nextChild, second.ctx, nextChildBinding)
      expect(() => nextChild.start(nextChildBinding, nextChildInput)).toThrow('NATIVE_ACTIVITY_REPLACED')
      expect(fetch).toHaveBeenCalledTimes(3)
      return
    }
    await continueChild()
  }
  expect(fetch).toHaveBeenCalledTimes(4)
})
