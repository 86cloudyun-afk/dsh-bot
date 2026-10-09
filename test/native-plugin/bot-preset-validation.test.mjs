import test from 'node:test';
import assert from 'node:assert/strict';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import {businessFixture} from './business-fixture.mjs';

async function fixture(t) {
  const f=await businessFixture(t);
  await f.ctx.plugin(AgentPresets,{default:'default'});
  await f.ctx.agentPresets.register({id:'default',plugins:[]});
  await f.ctx.agentPresets.register({id:'custom',plugins:[]});
  return f;
}

test('choosing the native default resets an explicit preset and advances configuration revision',async t=>{
  const f=await fixture(t);
  const bot=await f.bots.create(f.human,{operationId:'create-preset',action:'bot.create',input:{name:'Preset',presetId:'custom',contact:{provider:'controlled',model:'model-a'}}});
  const saved=await f.bots.update(f.human,{operationId:'reset-preset',action:'bot.update',input:{botId:bot.botId,expectedVersion:bot.revision,presetId:null}});
  assert.equal(saved.presetId,'default');
  assert.equal(saved.configRevision,bot.configRevision+1);
  const paused=await f.bots.update(f.human,{operationId:'pause-preset',action:'bot.update',input:{botId:bot.botId,expectedVersion:saved.revision,lifecycle:'paused'}});
  assert.equal(paused.presetId,'default');
  assert.equal(paused.configRevision,saved.configRevision);
  assert.equal(f.requests.length,0);
});

test('unsupported Bot fields provide useful diagnostics before any durable write',async t=>{
  const f=await businessFixture(t), before=f.store.read();
  await assert.rejects(f.bots.create(f.human,{operationId:'unsupported-input',action:'bot.create',input:{name:'Bot',legacyUnknown:'private value'}}),error=>{
    assert.equal(error.code,'invalid_input');
    assert.match(error.message,/legacyUnknown/);
    assert.equal(error.details?.rejectedBeforeWrite,true);
    assert.equal(error.message.includes('private value'),false);
    return true;
  });
  assert.deepEqual(f.store.read(),before);
});
