import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';

const source = await readFile(new URL('../../src/client/client.js', import.meta.url), 'utf8');
// Exercise the shipped editor's actual callbacks against official model validation.
const editorSource = source.slice(source.indexOf('        function BotEditor('), source.indexOf('        function BotsPane('));
const route = (provider, model) => JSON.stringify({provider, model});
const preferred = {provider:'reasoning-test', model:'reasoner', reasoningEffort:'high'};

class ReasoningProvider extends LlmAdapter {
  providerInfo(id) { return {id, name:id}; }
  async listModels(provider) { return [{provider, id:'reasoner', name:'reasoner'}]; }
  async resolveModel(provider, id) {
    return {provider, id, name:id, reasoning:{efforts:[{id:'low', name:'low'}, {id:'high', name:'high'}], defaultEffort:'low'}};
  }
  async *stream() { throw Error('Model calls are not part of editor tests'); }
}

function editor(f, bot, defaultModel = preferred, modelRoutes = [route('controlled','model-a'), route('controlled','model-b'), route('reasoning-test','reasoner')]) {
  let submit;
  const fields = {}, elements = {};
  const factory = new Function('useState','modelsOptions','state','card','h','button','form','field','advanced','command', editorSource + '; return BotEditor;');
  const render = factory(value => [value, () => {}],
    () => modelRoutes.map(value => ({value})),
    {catalog:{defaultModel, defaultCwd:f.dir, presets:[]}},
    () => {}, () => {}, () => {}, (_label, callback) => {submit = callback;},
    (_label, name, options) => {
      fields[name] = options;
      elements[name] = {value:String(options.value ?? '')};
    }, () => {}, async (action, input) => f.bots[action === 'bot.create' ? 'create' : 'update'](f.human, {
      operationId:crypto.randomUUID(), action, input,
    }));
  render({bot});
  return {
    value: name => elements[name].value,
    change(name, value) {
      elements[name].value = value;
      fields[name].onChange?.({currentTarget:{value, form:{elements}}});
    },
    save(values = {}) {
      for (const [name, value] of Object.entries(values)) elements[name].value = value;
      return submit(new Map(Object.entries(elements).map(([name, element]) => [name, element.value])));
    },
  };
}

async function fixture(t) {
  const f = await businessFixture(t);
  f.ctx.llm.registerAdapter(['reasoning-test'], new ReasoningProvider());
  return f;
}

test('renaming an existing Bot does not import another model\'s global reasoning effort', async t => {
  const f = await fixture(t), bot = await f.bot('Existing');
  const saved = await editor(f, bot).save({name:'Renamed'});
  assert.deepEqual(saved.contact, bot.contact);
  assert.deepEqual(saved.execution, bot.execution);
  assert.equal(f.requests.length, 0);
});

test('changing the visible model clears incompatible global reasoning defaults', async t => {
  const f = await fixture(t), draft = editor(f);
  draft.change('contact', route('controlled','model-a'));
  const saved = await draft.save({name:'Different model'});
  assert.equal(saved.contact.model, 'model-a');
  assert.equal(saved.contact.reasoningEffort, undefined);
  assert.deepEqual(saved.execution, saved.contact);
});

test('a catalog fallback does not import defaults from an unavailable global model', async t => {
  const f = await fixture(t), draft = editor(f, undefined, preferred, [route('controlled','model-a')]);
  const saved = await draft.save({name:'Catalog fallback'});
  assert.equal(saved.contact.model, 'model-a');
  assert.equal(saved.contact.reasoningEffort, undefined);
});

test('name-only creation inherits the current DSH model and reasoning for both routes', async t => {
  const f = await fixture(t), saved = await editor(f).save({name:'Current defaults'});
  assert.equal(saved.contact.reasoningEffort, 'high');
  assert.deepEqual(saved.execution, saved.contact);
  assert.equal(saved.executionMode, 'inherit');
});

test('an explicitly selected equal execution model stays explicit after saving and reopening', async t => {
  const f = await fixture(t), draft = editor(f, undefined, {provider:'controlled',model:'model-a'});
  draft.change('execution', route('controlled','model-a'));
  const saved = await draft.save({name:'Explicit route'});
  const reopened = editor(f, saved, {provider:'controlled',model:'model-a'});
  assert.equal(reopened.value('execution'), route('controlled','model-a'));
  reopened.change('contact', route('controlled','model-b'));
  const updated = await reopened.save();
  assert.equal(updated.contact.model, 'model-b');
  assert.equal(updated.execution.model, 'model-a');
  assert.equal(updated.executionMode, 'explicit');
});

test('legacy equal routes remain fixed instead of gaining inferred inheritance', async t => {
  const f = await fixture(t), saved = await f.bot('Legacy');
  const legacy = {...saved}; delete legacy.executionMode;
  const reopened = editor(f, legacy, {provider:'controlled',model:'model-a'});
  reopened.change('contact', route('controlled','model-b'));
  const updated = await reopened.save();
  assert.equal(updated.execution.model, 'model-a');
  assert.equal(updated.executionMode, 'explicit');
});

test('persisted inherited execution follows a later contact model update', async t => {
  const f = await fixture(t), bot = await f.bot('Inherited');
  const updated = await f.bots.update(f.human, {operationId:'change-inherited',action:'bot.update',input:{
    botId:bot.botId, expectedVersion:bot.revision, contact:{provider:'controlled',model:'model-b'},
  }});
  assert.equal(updated.executionMode, 'inherit');
  assert.deepEqual(updated.execution, updated.contact);
});
