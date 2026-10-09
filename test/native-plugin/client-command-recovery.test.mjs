import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../../src/client/client.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('        const t = ctx.locale.bind'), source.indexOf('        const button ='));
const version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
const original = {operationId:'retained-first-bot', action:'bot.create', input:{name:'First'}};

function client({snapshot = {storeId:'test-store', bots:[], pluginVersion:version, clientProtocol:1}, stored = [], commandReply = {ok:true, value:{botId:'created'}}} = {}) {
  const calls = [], cache = new Map([['dsh-bot.pending.v1.test-store', JSON.stringify(stored)]]);
  const ctx = {
    locale:{bind:()=>key=>key},
    connection:{rpc:{async call(_path, method, payload) {
      calls.push({method,payload:structuredClone(payload)});
      if(method === 'dsh.bot/snapshot') return {ok:true,value:snapshot};
      if(method === 'dsh.bot/catalog') return {ok:true,value:{providers:[],presets:[]}};
      if(payload?.action==='operation.lookup' && !commandReply.value?.state) return {ok:true,value:{state:'unrecorded'}};
      return commandReply;
    }}},
  };
  const factory = new Function('ctx','useSyncExternalStore','crypto','localStorage','AbortController','AbortSignal', body + '; return {command,refresh,lookup:typeof lookupOperation === "undefined" ? null : lookupOperation,retain:typeof retainPending === "undefined" ? null : retainPending,state:()=>state};');
  const ui = factory(ctx,()=>{},crypto,{getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)},AbortController,AbortSignal);
  return {...ui,calls,cache};
}

test('a new client refuses writes to an unidentified previous native release', async () => {
  const ui = client({snapshot:{storeId:'test-store',bots:[]},stored:[original]});
  await ui.refresh();
  await ui.command('bot.create',{name:'New'});
  assert.equal(ui.calls.filter(row=>row.method==='dsh.bot/command').length,0);
  assert.match(ui.state().error,/版本|刷新|重启/);
  assert.deepEqual(ui.state().pending,[original]);
});

test('release is checked again before a write after the host has changed', async () => {
  const snapshot={storeId:'test-store',bots:[],pluginVersion:version,clientProtocol:1};
  const ui=client({snapshot}); await ui.refresh();
  snapshot.pluginVersion='1.0.0';
  await ui.command('bot.create',{name:'New'});
  assert.equal(ui.calls.filter(row=>row.method==='dsh.bot/command').length,0);
  assert.equal(ui.state().pending.length,0);
});

test('read-only original lookup consumes a receipt without replaying the write', async () => {
  const ui=client({stored:[original],commandReply:{ok:true,value:{state:'committed',action:'bot.create',result:{botId:'original-bot'}}}});
  await ui.refresh();
  assert.equal(typeof ui.lookup,'function');
  await ui.lookup(original);
  const requests=ui.calls.filter(row=>row.method==='dsh.bot/command').map(row=>row.payload);
  assert.deepEqual(requests,[{action:'operation.lookup',input:{operationId:original.operationId,request:original}}]);
  assert.equal(ui.state().pending.length,0);
});

test('a missing receipt retains the exact original request and never starts it', async () => {
  const ui=client({stored:[original],commandReply:{ok:true,value:{state:'unrecorded'}}});
  await ui.refresh();
  assert.equal(typeof ui.lookup,'function');
  await ui.lookup(original);
  assert.deepEqual(ui.state().pending,[original]);
  assert.equal(ui.calls.some(row=>row.payload?.action==='bot.create'),false);
  assert.match(ui.state().error,/回执|未确认/);
});

test('full retained-operation capacity rejects a new write without evicting old IDs', async () => {
  const stored=Array.from({length:30},(_,index)=>({...original,operationId:`original-${index}`}));
  const ui=client({stored}); await ui.refresh();
  await ui.command('bot.create',{name:'Another'});
  assert.deepEqual(ui.state().pending,stored);
  assert.equal(ui.calls.filter(row=>row.method==='dsh.bot/command').length,0);
});

test('validation rejection is described as rejected while preserving its original ID', async () => {
  const ui=client({commandReply:{ok:false,error:{code:'invalid_input',message:'Invalid Bot field',details:{rejectedBeforeWrite:true}}}});
  await ui.refresh(); await ui.command(original.action,original.input,original);
  assert.deepEqual(ui.state().pending,[original]);
  assert.match(ui.state().error,/未写入|提交被拒/);
});

test('operator can retain an original in history and release a full pending slot',async()=>{
  const stored=Array.from({length:30},(_,index)=>({...original,operationId:`rejected-${index}`}));
  const ui=client({stored});await ui.refresh();
  assert.equal(typeof ui.retain,'function');
  ui.retain(stored[0]);
  assert.equal(ui.state().pending.length,29);
  assert.deepEqual(ui.state().retained,[stored[0]]);
  assert.deepEqual(JSON.parse(ui.cache.get('dsh-bot.pending.v1.test-store.retained')),[stored[0]]);
  await ui.command('bot.create',{name:'Corrected'});
  assert.equal(ui.calls.filter(row=>row.payload?.action==='bot.create').length,1);
  assert.deepEqual(ui.state().retained,[stored[0]]);
});

test('profile changes cannot move old pending requests into another profile',async()=>{
  const snapshot={storeId:'test-store',bots:[],pluginVersion:version,clientProtocol:1};
  const ui=client({snapshot,stored:[original]});await ui.refresh();
  snapshot.storeId='different-store';await ui.refresh();
  await ui.command('bot.create',{name:'Another profile'});
  assert.equal(ui.calls.some(row=>row.payload?.action==='bot.create'),false);
  assert.deepEqual(ui.state().pending,[original]);
});
