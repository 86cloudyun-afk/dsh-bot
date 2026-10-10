import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical,copy,digest,PluginStore,requireNativeJson} from '../../src/native/store.mjs';
import {businessFixture} from './business-fixture.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JsonStorageBackend} from '@deepseek-ai/dsh-storage-json';
import {join} from 'node:path';

test('canonical JSON copies and fingerprints deep valid values without a call-stack depth limit',()=>{
  const depth=12000,text='{"a":'.repeat(depth)+'null'+'}'.repeat(depth),value=JSON.parse(text);
  assert.equal(canonical(value),text);
  const cloned=copy(value);let cursor=cloned;
  for(let index=0;index<depth;index++){assert.equal(Object.keys(cursor).length,1);cursor=cursor.a;}
  assert.equal(cursor,null);assert.notEqual(cloned,value);
  assert.equal(digest(value),createHash('sha256').update(text).digest('hex'));
});

test('iterative canonical JSON preserves original byte order and independent repeated references',()=>{
  const shared={z:'😀',a:1},value={z:shared,'2':'two','10':'ten',a:[null,true,1e21,shared],hidden:'retained'};
  Object.defineProperty(value,'hidden',{value:'retained',enumerable:false});
  const expected='{"10":"ten","2":"two","a":[null,true,1e+21,{"a":1,"z":"😀"}],"hidden":"retained","z":{"a":1,"z":"😀"}}';
  assert.equal(canonical(value),expected);assert.equal(digest(value),createHash('sha256').update(expected).digest('hex'));
  const cloned=copy(value);assert.deepEqual(cloned.z,{a:1,z:'😀'});assert.notEqual(cloned.z,cloned.a[3]);
  assert.equal(canonical(Array.from({length:10000},(_,index)=>({index}))),JSON.stringify(Array.from({length:10000},(_,index)=>({index}))));
});

test('iterative canonical JSON still rejects cycles and all non-JSON values without invoking accessors',()=>{
  const cyclic={};cyclic.next=cyclic;const array=[];array.push(array);
  const sparse=Array(1),extra=[];extra.extra='lost';const symbol={};symbol[Symbol('hidden')]=1;
  let invoked=false;const accessor={};Object.defineProperty(accessor,'a',{get(){invoked=true;return 1;}});
  const arrayAccessor=[];Object.defineProperty(arrayAccessor,'0',{get(){invoked=true;return 1;}});
  for(const value of [cyclic,array,sparse,extra,symbol,accessor,arrayAccessor,undefined,NaN,Infinity,-0,1n,()=>1,new Date(),Object.create({a:1})])assert.throws(()=>canonical(value),{code:'invalid_json'});
  assert.equal(invoked,false);
  const deep=JSON.parse('{"a":'.repeat(12000)+'null'+'}'.repeat(12000));let cursor=deep;
  for(let index=1;index<12000;index++)cursor=cursor.a;
  cursor.a=deep;assert.throws(()=>canonical(deep),{code:'invalid_json'});
});


test('unsupported native JSON commits reject before publication and leave the official backend reusable',async t=>{
  const f=await businessFixture(t),bot=await f.bot('Native-shape'),value=JSON.parse('{"a":'.repeat(12000)+'null'+'}'.repeat(12000));
  const before=f.store.read(),path=join(f.dir,'storage','dsh_bot_v1.json'),originalBytes=await readFile(path);
  await assert.rejects(f.store.transact({operationId:'unsupported-json',action:'test.fixture',input:{}},draft=>{draft.bots[bot.botId].history=value;return null;}),error=>error.code==='invalid_json'&&error.details?.rejectedBeforeWrite===true);
  assert.deepEqual(f.store.read(),before);assert.deepEqual(await readFile(path),originalBytes);
  await f.store.transact({operationId:'after-rejection',action:'test.fixture',input:{}},draft=>{draft.bots[bot.botId].role='Still usable';return null;});
  await f.store.close();const reopened=await PluginStore.open(f.ctx.storage.backend.get('json').kv);f.beforeClose.push(()=>reopened.close());
  assert.equal(reopened.read().bots[bot.botId].role,'Still usable');assert.equal(Object.hasOwn(reopened.read().bots[bot.botId],'history'),false);
  assert.equal(Object.hasOwn(reopened.read().operations,'unsupported-json'),false);assert.equal(f.requests.length,0);
});


test('actual native JSON stack boundary rejects without poisoning cache or losing later commits',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'v113-native-boundary-')),backend=new JsonStorageBackend(folder);let unit,openCount=0;
  const facet={async open(descriptor){openCount++;unit=await backend.kv.open(descriptor);return unit;}},store=await PluginStore.open(facet);
  t.after(async()=>{await store.close();await backend.close();await rm(folder,{recursive:true,force:true});});
  await store.transact({operationId:'setup',action:'test.fixture',input:{}},draft=>{draft.bots.boundary={botId:'boundary'};return null;});
  const before=store.read(),path=join(folder,'dsh_bot_v1.json'),originalBytes=await readFile(path);
  const valueAt=depth=>JSON.parse('{"a":'.repeat(depth)+'null'+'}'.repeat(depth));
  let low=100,high=12000;
  while(low+1<high){
    const depth=Math.floor((low+high)/2),state=copy(before);state.bots.boundary.history=valueAt(depth);state.revision++;state.operations.probe={fingerprint:'test',action:'test.fixture',result:null};
    try{await Promise.resolve().then(()=>requireNativeJson(copy(state)));low=depth;}catch(error){assert.equal(error.code,'invalid_json');high=depth;}
  }
  let succeeded=false,rejections=0;
  for(let depth=high;depth>=100&&!succeeded;depth--){
    assert.ok(rejections<32,'native encoding boundary search exceeded its bounded probe budget');
    try{await store.transact({operationId:'probe',action:'test.fixture',input:{}},draft=>{draft.bots.boundary.history=valueAt(depth);return null;});succeeded=true;}
    catch(error){
      assert.equal(error.code,'invalid_json',`${process.version} native encoding failed at discovered depth ${depth}`);
      assert.equal(error.details?.rejectedBeforeWrite,true);rejections++;
      assert.deepEqual(store.read(),before);assert.deepEqual(await readFile(path),originalBytes);
      const loaded=await unit.loadAll();assert.equal(loaded.global,null);assert.deepEqual(loaded.tables,{state:{current:before}});
    }
  }
  assert.equal(succeeded,true);assert.ok(rejections>0);assert.ok(openCount>1,'at least one actual SDK encoding failure must exercise public reopen');
  await store.transact({operationId:'ordinary-after-boundary',action:'test.fixture',input:{}},draft=>{delete draft.bots.boundary.history;draft.bots.boundary.name='Still usable';return null;});
  const expected=store.read();await store.close();const reopened=await PluginStore.open(facet);
  try{assert.deepEqual(reopened.read(),expected);}finally{await reopened.close();}
});


test('ordinary I/O and unrelated RangeError failures keep the original recovery fence',async t=>{
  for(const kind of ['EIO','RangeError'])await t.test(kind,async t=>{
    const folder=await mkdtemp(join(tmpdir(),'v113-native-unknown-')),backend=new JsonStorageBackend(folder);let unit,openCount=0,armed=false;
    const failure=kind==='EIO'?Object.assign(Error('test disk failure'),{code:'EIO'}):new RangeError('unrelated resource failure');
    const facet={async open(descriptor){openCount++;unit=await backend.kv.open(descriptor);return {loadAll:unit.loadAll.bind(unit),close:unit.close.bind(unit),putRecord:async(...args)=>{if(armed)throw failure;return unit.putRecord(...args);}};}},store=await PluginStore.open(facet);
    t.after(async()=>{await store.close();await backend.close();await rm(folder,{recursive:true,force:true});});
    const before=store.read(),path=join(folder,'dsh_bot_v1.json'),originalBytes=await readFile(path);armed=true;
    await assert.rejects(store.transact({operationId:'unknown-write',action:'test.fixture',input:{}},draft=>{draft.bots.new={botId:'new'};return null;}),error=>error===failure);
    assert.throws(()=>store.read(),{code:'recovery_required'});assert.deepEqual(store.read({diagnostic:true}),before);
    assert.deepEqual(await readFile(path),originalBytes);assert.equal(openCount,1);
    await assert.rejects(store.transact({operationId:'next',action:'test.fixture',input:{}},()=>null),{code:'recovery_required'});
  });
});

test('actual native encoding recovery fences if public close, reopen or complete medium proof fails',async t=>{
  for(const failure of ['close','open','global','extra-table','receipt'])await t.test(failure,async t=>{
    const folder=await mkdtemp(join(tmpdir(),'v113-native-recovery-')),backend=new JsonStorageBackend(folder);let current,openCount=0,armed=false;
    const facet={async open(descriptor){
      openCount++;if(armed&&openCount>1&&failure==='open')throw Object.assign(Error('test reopen I/O'),{code:'EIO'});
      const unit=await backend.kv.open(descriptor);current=unit;
      return {putRecord:unit.putRecord.bind(unit),close:async()=>{if(armed&&openCount===1&&failure==='close'){armed=false;throw Object.assign(Error('test close I/O'),{code:'EIO'});}await unit.close();},loadAll:async()=>{
        const data=await unit.loadAll();if(armed&&openCount>1){const altered=copy(data);if(failure==='global')altered.global='unverified';if(failure==='extra-table')altered.tables.extra={};if(failure==='receipt')altered.tables.state.current.operations.unknown={fingerprint:'unknown',action:'test.fixture',result:null};return altered;}return data;
      }};
    }},store=await PluginStore.open(facet);
    t.after(async()=>{await store.close();await backend.close();await rm(folder,{recursive:true,force:true});});
    await store.transact({operationId:'setup',action:'test.fixture',input:{}},draft=>{draft.bots.boundary={botId:'boundary'};return null;});
    const before=store.read(),path=join(folder,'dsh_bot_v1.json'),originalBytes=await readFile(path),valueAt=depth=>JSON.parse('{"a":'.repeat(depth)+'null'+'}'.repeat(depth));
    let low=100,high=12000;while(low+1<high){const depth=Math.floor((low+high)/2),state=copy(before);state.bots.boundary.history=valueAt(depth);state.revision++;state.operations.probe={fingerprint:'test',action:'test.fixture',result:null};try{await Promise.resolve().then(()=>requireNativeJson(copy(state)));low=depth;}catch(error){assert.equal(error.code,'invalid_json');high=depth;}}
    armed=true;let fenced=false;
    for(let depth=high;depth>=low-32&&!fenced;depth--){
      try{await store.transact({operationId:'probe',action:'test.fixture',input:{}},draft=>{draft.bots.boundary.history=valueAt(depth);return null;});assert.fail('encoding boundary recovery was not exercised');}
      catch(error){if(error.code==='invalid_json'){assert.equal(error.details?.rejectedBeforeWrite,true);continue;}assert.equal(error instanceof RangeError,true);fenced=true;}
    }
    assert.equal(fenced,true);assert.throws(()=>store.read(),{code:'recovery_required'});assert.deepEqual(store.read({diagnostic:true}),before);assert.deepEqual(await readFile(path),originalBytes);
    await assert.rejects(store.transact({operationId:'next',action:'test.fixture',input:{}},()=>null),{code:'recovery_required'});
  });
});
