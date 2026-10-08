import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import LlmRuntime, {LlmAdapter} from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import SessionQuery from '@deepseek-ai/dsh-session-query';

export function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
export async function eventually(check, label = 'native event', timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {const result = check(); if (result) return result; await new Promise(r => setTimeout(r, 5));}
  throw Error(`Timed out waiting for ${label}`);
}
export async function* textChunks(text) {
  yield {type: 'block-start', index: 0, blockType: 'text'};
  yield {type: 'text-delta', index: 0, text};
  yield {type: 'block-end', index: 0, block: {type: 'text', text}};
  yield {type: 'usage', usage: {inputTokens: 5, outputTokens: 3, totalTokens: 8}};
  yield {type: 'finish', reason: {kind: 'stop'}};
}

/** Test-only official runtime composition. Only the provider is synthetic. */
export async function createOfficialFixture({stream, directory} = {}) {
  const dir = directory ?? await mkdtemp(join(tmpdir(), 'native-dsh-bot-'));
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(join(dir, 'cordis.yml')).href;
  await ctx.plugin(Loader);
  const requests = [], events = new Map();
  ctx.on('session/event', (session, event) => {
    const rows = events.get(session.id) ?? []; rows.push(event); events.set(session.id, rows);
  });
  class ControlledAdapter extends LlmAdapter {
    providerInfo(provider) {return {id: provider, name: 'Controlled test provider'};}
    async listModels(provider) {return ['model-a', 'model-b', 'model-c'].map(id => ({provider, id, name: id}));}
    async resolveModel(provider, model) {return {provider, id: model, name: model, context: {contextWindow: 16384}, maxTokens: 128};}
    async *stream(options) {requests.push(options); yield* stream ? stream(options, requests.length) : textChunks('Native test reply');}
  }
  const provider = {name: 'test-provider', inject: ['llm'], apply(owner) {owner.llm.registerAdapter(['controlled'], new ControlledAdapter());}};
  const plugins = {llm: LlmRuntime, sessions: SessionStore, projections: Projections, persistence: Persistence,
    prompt: SystemPrompt, tools: Tools, agents: Agents, loop: AgentLoop, storage: Storage, json: StorageJson, query: SessionQuery, provider};
  Object.assign(ctx.loader.builtins, plugins);
  const rows = Object.keys(plugins).map(id => ({id, name: `cordis:${id}`, config: id === 'persistence' ? {root: join(dir, 'sessions'), compression: 'none'} :
    id === 'json' ? {root: join(dir, 'storage')} : id === 'loop' ? {agents: []} : id === 'prompt' ? {personaPrefix: '', includeHarnessIdentity: false} : {}}));
  await writeFile(join(dir, 'cordis.yml'), JSON.stringify(rows));
  await ctx.loader.root.update(rows); await ctx.loader.await();
  for (const entry of ctx.loader.entries()) await entry.fiber?.await();
  return {ctx, dir, requests, events, async close({keepDirectory = false} = {}) {await ctx.fiber.dispose(); if (!directory && !keepDirectory) await rm(dir, {recursive: true, force: true});}};
}
