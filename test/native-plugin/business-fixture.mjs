import assert from 'node:assert/strict';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {createOfficialFixture} from './official-fixture.mjs';

export async function businessFixture(t,options={}) {
  const native=await createOfficialFixture(options),store=await PluginStore.open(native.ctx.storage.backend.get('json').kv);
  let adapter;const beforeClose=[];
  t.after(async()=>{for(const close of beforeClose)await close();await adapter?.close();await store.close();await native.close();});
  const operator={},policy=new PermissionPolicy(store,{agents:native.ctx.agents,operatorPeer:operator}),human=policy.fromPeer(operator);
  const modules={};
  for(const name of ['bots','sessions','adapter']) modules[name]=await import(`../../src/native/${name}.mjs`).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')assert.fail(`${name} feature is missing`);throw e;});
  adapter=new modules.adapter.NativeDshAdapter(native.ctx,{store,policy});
  const bots=new modules.bots.BotDirectory(store,policy,adapter),sessions=new modules.sessions.SessionOwnership(store,policy,adapter);
  return {...native,store,policy,human,adapter,bots,sessions,beforeClose,async bot(name='A',model='model-a') {
    return bots.create(human,{operationId:`create-${name}`,action:'bot.create',input:{name,role:'Test assistant',cwd:native.dir,contact:{provider:'controlled',model}}});
  }};
}
