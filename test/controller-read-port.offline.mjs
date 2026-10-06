/** Constructor/read/close only; no native open, session, provider or model request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './operator-read-fixture.mjs';
import {OwnedNativeController} from '../src/native-controller.mjs';
import {createExplicitOperatorReadBinding} from '../src/explicit-operator-read-binding.mjs';

async function controllerFixture(){
 const f=await fixture({makeBinding:false});
 f.ownerCtx.provide('llm',Object.freeze({synthetic:true}));
 f.ownerCtx.provide('sessionPersistence',Object.freeze({synthetic:true}));
 const controller=new OwnedNativeController({ctx:f.ownerCtx,ledger:f.ledger,ownerLabel:'SYNTHETIC UNIT OWNER',directory:'/tmp/inert-not-opened-native-read',capacity:{}});
 return {f,controller};
}
test('actual controller readPort is owner-only, narrows rows and denies after controller close',async()=>{
 const {f,controller}=await controllerFixture();try{
  assert.throws(()=>controller.readPort({}),{code:'unsupported_host_identity'});
  const port=controller.readPort(f.caller),ids={botIds:f.scope.botIds,taskIds:f.scope.taskIds};
  assert.deepEqual(Object.keys(port),['snapshot']);
  assert.deepEqual(Object.keys(port.snapshot(ids).bot[0]),['botId','name','lifecycle','readiness','epoch','revision']);
  assert.throws(()=>createExplicitOperatorReadBinding({ownerCtx:f.ownerCtx,expectedHost:f.host,readPort:port}),{code:'owner_read_port_mismatch'});
  const closing=controller.close(f.caller);
  assert.throws(()=>port.snapshot(ids),{code:'unauthorized'});
  await closing;assert.throws(()=>controller.readPort(f.caller),{code:'native_controller_closed'});
 }finally{await controller.close(f.caller);await f.close();}
});
test('controller atomically installs its private Host and retained port into the narrow source',async()=>{
 const {f,controller}=await controllerFixture();try{
  assert.equal(typeof controller.installReadSource,'function');
  assert.throws(()=>controller.installReadSource({}),{code:'unsupported_host_identity'});
  const binding=controller.installReadSource(f.caller);
  assert.equal(f.root.get('dshBotReadSource'),binding.source);
  assert.deepEqual(await binding.source.readForPeer(f.operator,new AbortController().signal),{status:'not_configured'});
  binding.select(f.scope);
  assert.equal((await binding.source.readForPeer(f.operator,new AbortController().signal)).status,'ready');
  await controller.close(f.caller);
  assert.deepEqual(await binding.source.readForPeer(f.operator,new AbortController().signal),{status:'access_denied'});
 }finally{await controller.close(f.caller);await f.close();}
});
