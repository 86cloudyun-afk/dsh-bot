import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonStorageBackend} from '@deepseek-ai/dsh-storage-json';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'bot-state-'));
  const backend = new JsonStorageBackend(folder);
  t.after(async () => {await backend.close(); await rm(folder, {recursive: true, force: true});});
  const module = await import('../../src/native/store.mjs').catch(e => {if (e.code === 'ERR_MODULE_NOT_FOUND') assert.fail('PluginStore feature is missing'); throw e;});
  return {backend, folder, Store: module.PluginStore, store: await module.PluginStore.open(backend.kv)};
}
const command = (operationId, input = {}, expectedRevision) => ({operationId, action: 'test', input, ...(expectedRevision === undefined ? {} : {expectedRevision})});

test('same operation returns its original result after other commits', async t => {
  const {store} = await fixture(t);
  const first = await store.transact(command('op-a', {name: 'A'}, 0), draft => {draft.bots.a = {name: 'A'}; return {id: 'a'};});
  await store.transact(command('op-b'), draft => {draft.bots.b = {name: 'B'}; return {id: 'b'};});
  const duplicate = await store.transact(command('op-a', {name: 'A'}, 0), () => assert.fail('duplicate mutation ran'));
  assert.deepEqual(duplicate, first); assert.equal(store.read().revision, 2);
});
test('same id with changed content conflicts', async t => {
  const {store} = await fixture(t);
  await store.transact(command('op-a', {name: 'A'}), () => 'first');
  await assert.rejects(store.transact(command('op-a', {name: 'B'}), () => 'second'), {code: 'operation_conflict'});
  assert.equal(store.read().revision, 1);
});
test('concurrent transactions serialize without losing either update', async t => {
  const {store} = await fixture(t);
  await Promise.all(Array.from({length: 20}, (_, i) => store.transact(command(`op-${i}`), draft => {draft.bots[`b-${i}`] = {name: String(i)}; return i;})));
  assert.equal(Object.keys(store.read().bots).length, 20); assert.equal(store.read().revision, 20);
});
test('failed write retains published state and fences further writes', async t => {
  const f = await fixture(t); await f.store.close();
  const facet = {async open(descriptor) {const unit = await f.backend.kv.open(descriptor); return {...unit, loadAll: unit.loadAll.bind(unit), close: unit.close.bind(unit), putRecord: async () => {throw Error('disk unavailable');}};}};
  const broken = await f.Store.open(facet);
  await assert.rejects(broken.transact(command('disk-fail'), draft => {draft.bots.a = {name: 'A'}; return 'a';}), /disk unavailable/);
  assert.equal(broken.read().revision, 0); assert.equal(Object.keys(broken.read().bots).length, 0);
  await assert.rejects(broken.transact(command('next'), () => null), {code: 'recovery_required'});
  await broken.close();
});
test('restart retains identities and committed operation results', async t => {
  const f = await fixture(t);
  await f.store.transact(command('op-persist'), draft => {draft.bots.stable = {name: 'stable'}; return {botId: 'stable'};});
  await f.store.close(); const resumed = await f.Store.open(f.backend.kv);
  assert.equal(resumed.read().bots.stable.name, 'stable');
  assert.deepEqual(await resumed.transact(command('op-persist'), () => assert.fail('replayed')), {botId: 'stable'});
  await resumed.close();
});
test('unknown schema rejects without overwriting the existing medium', async t => {
  const f = await fixture(t); const snapshot = f.store.read(); await f.store.close();
  const unit = await f.backend.kv.open({name: 'dsh_bot_v1', version: 1, tables: ['state'], hasGlobal: false});
  await unit.putRecord('state', 'current', {...snapshot, schema: 999}); await unit.close();
  const file = join(f.folder, 'dsh_bot_v1.json'), before = await readFile(file);
  await assert.rejects(f.Store.open(f.backend.kv), {code: 'unsupported_schema'});
  assert.deepEqual(await readFile(file), before);
});
test('mutations cannot escape the write chain through async callbacks or references', async t => {
  const {store} = await fixture(t);
  await assert.rejects(store.transact(command('async'), async () => 'bad'), {code: 'async_transaction'});
  let retained;
  await store.transact(command('sync'), draft => {retained = draft; draft.bots.a = {name: 'A'}; return draft.bots.a;});
  retained.bots.a.name = 'changed'; const view = store.read(); view.bots.a.name = 'changed too';
  assert.equal(store.read().bots.a.name, 'A');
});
