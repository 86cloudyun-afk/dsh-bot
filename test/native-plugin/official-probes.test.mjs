import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createUserMessage, isAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {installModelSelection} from '@deepseek-ai/dsh-agent';
import {createOfficialFixture, eventually} from './official-fixture.mjs';

test('official owned agent setup precedes input and streams a real native turn', async () => {
  const f = await createOfficialFixture();
  try {
    const id = randomUUID(); let configured = false, requestAgent, requestSignal;
    const handle = await f.ctx.agents.create({sessionId: id, agentOptions: {provider: 'controlled', model: 'model-a'}, setup(agentCtx, agent) {
      assert.equal(f.ctx.agents.get(id), undefined);
      installModelSelection(agentCtx, {current: Object.freeze({provider: 'controlled', model: 'model-b'})});
      agentCtx.on('agent/request', async (payload, next) => {requestAgent = payload.agent; requestSignal = payload.signal; return next();});
      configured = true;
    }});
    assert.equal(configured, true); assert.equal(handle.agent.id, id);
    handle.agent.followup(createUserMessage({content: [{type: 'text', text: 'Give one harmless response.'}], source: {kind: 'native-plugin-test'}}));
    await eventually(() => f.events.get(id)?.some(e => e.type === 'turn/end'));
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].model, 'model-b');
    assert.equal(f.requests[0].sessionId, id); assert.equal(f.requests[0].signal, requestSignal);
    assert.equal(requestAgent, handle.agent); assert.equal(isAgentLoopRequest(f.requests[0]), true);
    assert.equal(Object.isFrozen(f.requests[0]), true);
    await f.ctx.sessions.flush(handle.agent.session);
    const cold = await f.ctx.sessionPersistence.open(id, 'read');
    try {const stored = await cold.read(0, 1000); assert.ok(stored.events.some(e => e.type === 'assistant/message'));}
    finally {await cold.close();}
    await handle.dispose(); assert.equal(f.ctx.agents.get(id), undefined);
  } finally {await f.close();}
});
