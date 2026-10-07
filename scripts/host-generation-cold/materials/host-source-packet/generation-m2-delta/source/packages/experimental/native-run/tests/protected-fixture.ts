/** Interface substrate: native composition and keyless fake transport, no human-authority claim. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { registerDeepSeekProvider, resolveAdapterOptions, DeepSeekProtectedProviders } from '@deepseek-ai/dsh-llm-deepseek'
import * as DeepSeekApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { afterEach, expect, vi } from 'vitest'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.unstubAllGlobals(); while (cleanup.length) await cleanup.pop()!() })
export const safeUser = (text = 'Safe prompt') => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
export function safeResponse(text = 'Offline native answer') {
  return new Response([
    { type: 'message_start', message: { id: 'offline-receipt', model: 'deepseek-flash', usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}
export function emptyMaxTokensResponse() {
  return new Response([
    { type: 'message_start', message: { id: 'offline-empty-receipt', model: 'deepseek-flash', usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}
export async function fixture(resolveAuth = async () => ({ headers: {} }), officialPlugin = false,
  existingDirectory?: string, workspace = false, officialPolicy = false) {
  const directory = existingDirectory ?? await mkdtemp(join(tmpdir(), 'dsh-protected-factory-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = new URL(`file://${directory}/cordis.yml`).href
  await ctx.plugin(Loader)
  let factory: ReturnType<typeof registerDeepSeekProvider> | undefined
  const provider = { name: 'offline-provider-owner', inject: ['llm'], apply(child: Context) {
    factory = registerDeepSeekProvider(child, 'deepseek-official', {
      options: () => resolveAdapterOptions({ reasoningEffort: 'off', maxTokens: 16,
        retryPolicy: { mode: 'normal', maxRetries: 1, backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } } }),
      resolveAuth,
    })
  } }
  const plugins = { llm: LlmRuntime, sessions: SessionStore, projections: SessionProjectionRegistry,
    persistence: SessionPersistenceJsonl, prompt: SystemPrompt, tools: ToolRuntime, agents: AgentRegistry,
    loop: AgentLoop, presets: AgentPresets, preset: AgentPreset, protectedProviders: DeepSeekProtectedProviders,
    provider: officialPlugin ? DeepSeekApiKey : provider,
    ...(officialPolicy ? { sandboxPolicy: SandboxPolicy, approval: ApprovalService } : {}),
    ...(workspace ? { storage: Storage, storageSqlite: StorageSqlite, storageDomain: StorageDomain, workspace: WorkspaceRegistry } : {}) }
  Object.assign(ctx.loader.builtins, plugins)
  const rows = Object.keys(plugins).map(id => ({ id, name: `cordis:${id}`, config:
    id === 'sandboxPolicy' ? { mode: 'workspace-write', workspaceRoot: directory } : id === 'approval' ? { policy: 'ask' }
      : id === 'storageSqlite' ? { path: join(directory, 'workspace.sqlite'), journalMode: 'delete' }
        : id === 'storageDomain' ? { backend: 'sqlite' }
          : id === 'persistence' ? { root: join(directory, 'sessions'), compression: 'none' }
            : id === 'loop' ? { agents: [] } : id === 'presets' ? { default: 'acceptance/empty' }
              : id === 'preset' ? { id: 'acceptance/empty', plugins: [] }
                : id === 'prompt' ? { personaPrefix: '', includeHarnessIdentity: false }
                  : id === 'provider' && officialPlugin ? { apiKeyEnv: 'DSH_OFFLINE_NO_CREDENTIAL', reasoningEffort: 'off', maxTokens: 16 } : {} }))
  await writeFile(join(directory, 'cordis.yml'), JSON.stringify(rows) + '\n')
  await ctx.loader.root.update(rows)
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  expect(ctx.get('sessionPersistence')).toBeDefined()
  expect((await ctx.agentPresets.resolve('acceptance/empty')).id).toBe('acceptance/empty')
  factory ??= ctx.deepseekProtectedProviders.lookup('deepseek-official')
  const providerFiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')!.fiber!
  return { ctx, factory, directory, providerFiber }
}
export const config = { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 16, reasoningEffort: ReasoningEffortId('off') }
