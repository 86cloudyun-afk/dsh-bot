import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialFixture} from './official-fixture.mjs';
import * as Plugin from '../../src/native/plugin.mjs';

test('native plugin mounts an authenticated business RPC and preserves Bot identities across reload',async()=>{
  const f=await createOfficialFixture(),operator={},handlers=new Map();
  f.ctx.provide('profileContext',{name:'owned-test',dir:f.dir});f.ctx.provide('webServer',{});
  f.ctx.provide('connection',{operator,rpc:{handle(path,handler){handlers.set(path,handler);return ()=>handlers.delete(path);}}});
  try {
    const first=f.ctx.plugin(Plugin);await first.await();
    const handler=handlers.get('/dsh-bot');assert.ok(handler);
    const denied=await handler('command',{operationId:'deny',action:'bot.create',input:{}},new AbortController().signal,{});assert.equal(denied.error.code,'access_denied');
    const created=await handler('command',{operationId:'create',action:'bot.create',input:{name:'Persistent',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}},new AbortController().signal,operator);
    assert.equal(created.ok,true,JSON.stringify(created));const id=created.value.botId;assert.ok(id);
    await first.dispose();assert.equal(handlers.has('/dsh-bot'),false);assert.equal(f.ctx.get('dshBot'),undefined);
    const second=f.ctx.plugin(Plugin);await second.await();const reloaded=await handlers.get('/dsh-bot')('snapshot',{},new AbortController().signal,operator);
    assert.equal(reloaded.value.bots[0].botId,id);await second.dispose();
  }finally{await f.close();}
});
