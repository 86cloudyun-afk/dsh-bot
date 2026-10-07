/** The complete actual delegate policy is immutable before native preparation effects. */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { prepareOwnedGenerationSource, isOwnedGenerationReceipt } from '../src/index.ts'
import { fixture, config, safeUser } from './protected-fixture.ts'

it.each(['finalizeContent', 'projectContent', 'timeoutMs', 'isConcurrencySafe', 'presentCall', 'presentResult'])
('freezes actual delegate %s before native creation', async (key) => {
  const f = await fixture()
  const tool = defineTool({ name: 'dsh_bot_delegate', description: 'Exact complete policy', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}) })
  prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId: 'complete-policy', role: 'main',
    route: config, delegateTool: tool, isCurrent: () => true })
  expect(() => Object.defineProperty(tool, key, { value: key === 'timeoutMs' ? 1 : () => [], configurable: true })).toThrow()
  expect(() => Object.defineProperty(tool.output, 'presentationMeta', { value: () => ({ injected: true }), configurable: true })).toThrow()
  expect(Object.isFrozen(tool)).toBe(true)
  expect(Object.isFrozen(tool.output)).toBe(true)
  expect(Object.isFrozen(tool.parameters)).toBe(true)
  expect(Object.isFrozen(tool.output.schema)).toBe(true)
})

it('rejects the independently reported post-attach finalizer mutation through the actual tool executor', async () => {
  const f = await fixture(), sessionId = 'actual-immutable-delegate'
  const tool = defineTool({ name: 'dsh_bot_delegate', description: 'Exact immutable executor', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'ORIGINAL_FINALIZER' }] },
    execute: async (_args, exec) => { exec.concludeTurn(); return { pending: true } } })
  const prepared = prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId, role: 'main',
    route: config, delegateTool: tool, isCurrent: () => true })
  const handle = await f.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: config,
    meta: { cwd: f.directory, agentPreset: 'acceptance/empty' }, protectedModelCalls: prepared.protectedModelCalls })
  try {
    const source = prepared.attach(handle)
    handle.agent.ctx.tools.register(tool)
    expect(() => { tool.finalizeContent = () => [{ type: 'text', text: 'MUTATED_AFTER_SOURCE_ATTACHMENT' }] }).toThrow()
    vi.stubGlobal('fetch', async () => new Response([
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'exact-actual-delegate', name: 'dsh_bot_delegate', input: {} } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')))
    const binding = { botId: 'immutable-bot', taskId: 'immutable-main', sessionId, generation: 1,
      botEpoch: 1, taskEpoch: 1, taskRevision: 1, authorityEpoch: 1, configVersion: 'exact-immutable-config' }
    const generation = source.start(binding, safeUser()); await handle.agent.whenIdle()
    const view = await source.inspect(generation)
    expect(view.remote).toBe('settled'); expect(isOwnedGenerationReceipt(view.receipt, source, binding)).toBe(true)
    const stored = await f.ctx.sessionPersistence.open(SessionId(sessionId), 'read')
    try {
      const events = (await stored.read()).events, result = events.find(event => event.type === 'tool/result')
      expect(result).toBeDefined(); expect(JSON.stringify(result)).toContain('ORIGINAL_FINALIZER')
      expect(JSON.stringify(events)).not.toContain('MUTATED_AFTER_SOURCE_ATTACHMENT')
    } finally { await stored.close() }
  } finally { await handle.dispose() }
})
it('rejects accessor and prototype policy graphs before protection or native creation', async () => {
  const f = await fixture()
  const tool = defineTool({ name: 'dsh_bot_delegate', description: 'Accessor rejected', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}) })
  Object.defineProperty(tool, 'finalizeContent', { get: () => () => [], configurable: true })
  expect(() => prepareOwnedGenerationSource({ ownerCtx: f.ctx, providerFactory: f.factory!, sessionId: 'accessor-policy',
    role: 'main', route: config, delegateTool: tool, isCurrent: () => true })).toThrow()
  expect(f.ctx.agents.get(SessionId('accessor-policy'))).toBeUndefined()
})
