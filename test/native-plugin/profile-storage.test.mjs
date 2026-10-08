import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JsonStorageBackend} from '@deepseek-ai/dsh-storage-json';
import {PluginStore} from '../../src/native/store.mjs';

async function profileScope(context){const module=await import('../../src/native/profile.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('profile writer isolation is missing');throw error;});return module.openProfileScope(context);}
test('two official JSON backends sharing a root cannot overwrite separate profile ledgers',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'bot-profile-isolation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const aDir=join(dir,'profiles','A'),bDir=join(dir,'profiles','B');await mkdir(aDir,{recursive:true});await mkdir(bDir,{recursive:true});
  const a=await profileScope({profileContext:{name:'A',dir:aDir}}),b=await profileScope({profileContext:{name:'B',dir:bDir}});t.after(()=>b.close());t.after(()=>a.close());
  const ba=new JsonStorageBackend(join(dir,'shared-storage')),bb=new JsonStorageBackend(join(dir,'shared-storage'));t.after(()=>ba.close());t.after(()=>bb.close());
  const sa=await PluginStore.open(ba.kv,{namespace:a.namespace}),sb=await PluginStore.open(bb.kv,{namespace:b.namespace});
  await sa.transact({operationId:'A',action:'write',input:{}},draft=>{draft.outbox.A={value:'A'};return null;});
  await sb.transact({operationId:'B',action:'write',input:{}},draft=>{draft.outbox.B={value:'B'};return null;});await sa.close();await sb.close();
  const ar=await PluginStore.open(ba.kv,{namespace:a.namespace}),br=await PluginStore.open(bb.kv,{namespace:b.namespace});
  assert.equal(ar.read().outbox.A.value,'A');assert.equal(br.read().outbox.B.value,'B');assert.notEqual(ar.read().storeId,br.read().storeId);await ar.close();await br.close();
});
test('another live writer of the same canonical profile is rejected before opening its ledger',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'bot-profile-writer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=await profileScope({profileContext:{name:'A',dir}});
  await assert.rejects(profileScope({profileContext:{name:'A',dir:join(dir,'.')}}),{code:'profile_writer_active'});
  await first.close();const second=await profileScope({profileContext:{name:'A',dir}});assert.equal(second.namespace,first.namespace);await second.close();
});
