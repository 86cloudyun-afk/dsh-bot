import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const source=await readFile(process.env.DSH_CLIENT_SOURCE ?? new URL('../../src/client/client.js',import.meta.url),'utf8');
const packageVersion=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8')).version;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bot={botId:'bot_own',name:'Named identity',role:'Own role',revision:1,memoryRevision:7,lifecycle:'active',contact:{provider:'official',model:'chat'},execution:{provider:'official',model:'work'},executionMode:'inherit',share:{enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:[]}}};
const defaultSnapshot=()=>({storeId:'profile',revision:1,pluginVersion:packageVersion,clientProtocol:2,bots:[structuredClone(bot)],tasks:[],sessions:[],memories:[],materials:[],grants:[],groups:[],meetings:[],outbox:[],attempts:[],notices:[]});
const catalog={providers:[{id:'official',name:'Official',models:[{id:'chat'},{id:'work'}]}],presets:[{id:'default',name:'Default'}],defaultModel:{provider:'official',model:'chat'},defaultCwd:'/workspace'};
function data(values={}) {return {get:key=>values[key]??'',getAll:key=>Array.isArray(values[key])?values[key]:values[key]?[values[key]]:[]};}
function browser(snapshot=defaultSnapshot(),route=()=>({}),routes={}) {
  const opened=[],registrations=[],lifecycle=[],calls=[],hooks=new Map(),effects=new Map(),cache=new Map(Object.entries(routes.cache??{})),copied=[],downloads=[],blobs=[],pendingRpc=new Set(),idleWaiters=new Set();
  let module,active='root',index=0,tree,currentView,unsubscribeView,usedEffectKeys,usedHookKeys;
  const hookKey=()=>{const key=`${active}:${index++}`;usedHookKeys?.add(key);return key;};
  function render(component,props={},key='root') {const before=[active,index];active=key;index=0;const result=component(props);[active,index]=before;return result;}
  const react={
    createElement(type,props,...children) {return typeof type==='function'?render(type,props??{},`${active}/${type.name}:${props?.key??''}`):{type,props:props??{},children:children.flat(Infinity)};},
    useState(initial) {const key=hookKey();if(!hooks.has(key))hooks.set(key,initial);return [hooks.get(key),next=>hooks.set(key,typeof next==='function'?next(hooks.get(key)):next)];},
    useRef(initial) {const key=hookKey();if(!hooks.has(key))hooks.set(key,{current:initial});return hooks.get(key);},
    useEffect(effect,deps) {const key=hookKey();usedEffectKeys?.add(key);const prior=effects.get(key);if(prior&&deps?.length===prior.deps.length&&deps?.every((item,i)=>Object.is(item,prior.deps[i])))return;prior?.cleanup?.();effects.set(key,{deps:deps??[],cleanup:effect()});},
    useSyncExternalStore(subscribe,get) {
      currentView=get();
      unsubscribeView??=subscribe(()=>{currentView=get();if(!currentView.busy){for(const resolve of idleWaiters)resolve();idleWaiters.clear();}});
      return currentView;
    },
  };
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:value=>module=value}},AbortController,AbortSignal,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Blob,
    localStorage:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>{routes.setItem?.(key,value);cache.set(key,value);}},
    FormData:class{constructor(value){return value;}},
    URL:{createObjectURL(blob){blobs.push(blob);return `blob:${blobs.length}`;},revokeObjectURL(){}},document:{createElement:()=>({click(){downloads.push({href:this.href,name:this.download});}})},navigator:{clipboard:{writeText:async text=>{if(routes.clipboard)await routes.clipboard(text);copied.push(text);}}},
    setInterval:fn=>{(routes.intervals??=[]).push(fn);return 1;},clearInterval:()=>{},setTimeout:fn=>{fn();return 1;}});
  const ctx={locale:{register:()=>()=>{},bind:()=>key=>key},effect:fn=>lifecycle.push(fn),
    slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{registrations.push({options,component});return()=>{};}},
    connection:{rpc:{call(_path,method,payload){
      const operation=(async()=>{calls.push(structuredClone({method,payload}));if(method==='dsh.bot/snapshot')return {ok:true,value:structuredClone(routes.snapshot?await routes.snapshot():snapshot)};if(method==='dsh.bot/catalog')return {ok:true,value:structuredClone(routes.catalog?await routes.catalog():catalog)};const result=await route(payload.action,payload.input,payload);return {ok:true,value:structuredClone(result)};})();
      pendingRpc.add(operation);
      operation.then(()=>pendingRpc.delete(operation),()=>pendingRpc.delete(operation));
      return operation;
    }}},
    sessions:{refresh:async()=>{await routes.nativeRefresh?.();}},uiWorkspace:{openSession(id){opened.push(id);}},layout:{selectPanel(){}}};
  module.factory(()=>react).apply(ctx);
  const disposers=lifecycle.map(fn=>fn());
  // Effects and hooks absent from the next render are disposed, as on React unmount.
  const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of node.children??[]){const found=walk(child,predicate);if(found)return found;}return null;};
  const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');
  const find=(predicate)=>walk(tree,predicate);
  const drainRpc=async()=>{while(pendingRpc.size)await Promise.allSettled([...pendingRpc]);};
  const waitIdle=()=>currentView?.busy?new Promise(resolve=>idleWaiters.add(resolve)):Promise.resolve();
  return {snapshot,calls,copied,downloads,blobs,registrations,opened,cache,view:()=>currentView,
    async ready(){await tick();this.render();await tick();this.render();},
    render(slot='main',props={}) {const component=registrations.find(row=>row.options.name===slot||row.options.id===slot)?.component;assert.ok(component);usedEffectKeys=new Set();usedHookKeys=new Set();tree=render(component,props,slot);for(const [key,value] of effects){if(!usedEffectKeys.has(key)){value.cleanup?.();effects.delete(key);}}for(const key of hooks.keys())if(!usedHookKeys.has(key))hooks.delete(key);usedEffectKeys=null;usedHookKeys=null;return tree;},
    find,text,
    async settle(){
      // The native form does not return the submit promise. Follow its real RPCs
      // and the store's busy=false publication instead of counting event-loop turns.
      await drainRpc();await waitIdle();await tick();this.render();
      await drainRpc();this.render();
      assert.equal(currentView?.busy,false,'UI must publish idle after its RPC completes');
    },
    async click(label){const node=find(row=>row.type==='button'&&text(row)===label);assert.ok(node,`missing button ${label}`);assert.ok(!node.props.disabled,`button ${label} must be enabled`);await node.props.onClick({currentTarget:{}});this.render();await tick();this.render();},
    async submit(label,values){const node=find(row=>row.type==='form'&&row.children.some(child=>child?.type==='button'&&text(child)===label));assert.ok(node,`missing form ${label}`);assert.ok(!node.children.find(child=>child?.type==='button'&&text(child)===label).props.disabled,`submit ${label} must be enabled`);node.props.onSubmit({preventDefault(){},currentTarget:data(values)});await tick();this.render();await tick();this.render();},
    async change(label,value){const node=find(row=>row.props?.['aria-label']===label);assert.ok(node,`missing field ${label}`);assert.ok(!node.props.disabled,`field ${label} must be enabled`);await node.props.onChange({target:{value,files:value?[value]:[]},currentTarget:{value,files:value?[value]:[]}});this.render();await tick();this.render();},
    dispose(){unsubscribeView?.();for(const fn of disposers)fn?.();for(const value of effects.values())value.cleanup?.();},
  };
}

const original={operationId:'original_id',action:'bot.update',input:{botId:bot.botId,expectedVersion:1,lifecycle:'paused'},review:{exact:'full original metadata'}};
const key='dsh-bot.pending.v1.profile';
const storageFailure=()=>{throw Object.assign(Error('quota exceeded'),{name:'QuotaExceededError'});};
const alert=ui=>ui.text(ui.find(row=>row.props.role==='alert'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const contact=(sessionId,overrides={})=>({sessionId,botId:bot.botId,name:'Saved chat',purpose:'contact',state:'ready',archived:false,...overrides});
const button= (ui,label)=>ui.find(row=>row.type==='button'&&ui.text(row)===label);
function core({stored=[],setItem,route,snapshot=defaultSnapshot()}={}){
  const cache=new Map([[key,JSON.stringify(stored)]]),calls=[];
  const body=source.slice(source.indexOf('        const t = ctx.locale.bind'),source.indexOf('        const button ='));
  const ctx={locale:{bind:()=>k=>k},connection:{rpc:{async call(_path,method,payload){calls.push(structuredClone({method,payload}));return {ok:true,value:route?await route(method,payload,snapshot):method==='dsh.bot/snapshot'?structuredClone(snapshot):payload.action==='operation.lookup'?{state:'unrecorded'}:{botId:'created'}};}}}};
  const factory=new Function('ctx','useSyncExternalStore','crypto','localStorage','AbortController','AbortSignal',body+'; return {command,refresh,lookupOperation,retainPending,query,state:()=>state};');
  return {...factory(ctx,()=>{},webcrypto,{getItem:k=>cache.get(k)??null,setItem:(k,v)=>{setItem?.(k,v);cache.set(k,v);}},AbortController,AbortSignal),cache,calls,snapshot};
}

test('first mutation must persist the complete request before RPC; failure keeps the draft and original visible',async t=>{
  const ui=browser(defaultSnapshot(),()=>({}),{setItem:storageFailure});t.after(()=>ui.dispose());await ui.ready();
  await ui.submit('创建 Bot',{name:'Still my draft',role:'Own instructions',contact:JSON.stringify({provider:'official',model:'chat'})});await ui.settle();
  assert.equal(ui.calls.some(row=>row.payload.operationId),false,'no mutation may be sent without a saved original');
  assert.match(alert(ui),/storage|存储|保存/);assert.match(alert(ui),/未发送/);
  assert.equal(ui.view().pending.length,1);assert.equal(ui.view().pending[0].input.name,'Still my draft');
  const preview=ui.find(row=>row.type==='pre'&&ui.text(row).includes(ui.view().pending[0].operationId));
  assert.ok(preview,'the complete unsaved original must be reviewable');
  assert.deepEqual(JSON.parse(ui.text(preview)),structuredClone(ui.view().pending[0]));
  assert.ok(ui.find(row=>row.type==='form'&&ui.text(row).includes('创建 Bot')),'unsaved form must stay open');
});

for(const saved of [false,true])test(`original-ID continuation rechecks browser persistence (saved=${saved})`,async()=>{
  const ui=core({stored:saved?[original]:[],setItem:storageFailure});await ui.refresh();
  await ui.command(original.action,original.input,original);
  assert.equal(ui.calls.some(row=>row.payload.action==='bot.update'),false);
  assert.deepEqual(ui.state().pending,[original]);assert.match(ui.state().error,/未发送/);
});

test('the original request and metadata are durable before the first mutation RPC',async()=>{
  let ui;
  ui=core({route:(_method,payload,snapshot)=>{
    if(payload.operationId){assert.deepEqual(JSON.parse(ui.cache.get(key)),[payload]);return {botId:'created'};}
    return structuredClone(snapshot);
  }});await ui.refresh();await ui.command('bot.create',{name:'New'},undefined,{review:{confirmed:true}});
  assert.equal(ui.calls.filter(row=>row.payload.operationId).length,1);
});

for(const mode of ['lookup','retry-receipt'])test(`known ${mode} receipt stays successful if pending cleanup fails`,async()=>{
  let writes=0;
  const ui=core({stored:[original],setItem:()=>{if(mode!=='retry-receipt'||++writes>1)storageFailure();},route:(method,payload,snapshot)=>{
    if(method==='dsh.bot/snapshot')return structuredClone(snapshot);
    return payload.action==='operation.lookup'?{state:'committed',result:{botId:'known'}}:{botId:'known'};
  }});await ui.refresh();
  const result=mode==='lookup'?await ui.lookupOperation(original):mode==='retry-receipt'?await ui.command(original.action,original.input,original):await ui.command('bot.create',{name:'New'});
  assert.deepEqual(result,{botId:'known'});assert.equal(ui.state().error,'');
  assert.match(ui.state().storageNotice??'',/已提交|回执|完成/);
  assert.deepEqual(JSON.parse(ui.cache.get(key)),[original]);
});

test('new mutation returns its result despite cleanup failure after the durable write',async()=>{
  let writes=0;const ui=core({setItem:()=>{if(++writes>1)storageFailure();}});await ui.refresh();
  const result=await ui.command('bot.create',{name:'New'});
  assert.deepEqual(result,{botId:'created'});assert.equal(ui.state().error,'');assert.match(ui.state().storageNotice??'',/已提交|回执|完成/);
  assert.equal(JSON.parse(ui.cache.get(key)).length,1);
});

test('read-only lookup remains available with denied storage',async()=>{
  const ui=core({stored:[original],setItem:storageFailure});await ui.refresh();await ui.lookupOperation(original);
  assert.deepEqual(ui.calls.filter(row=>row.method==='dsh.bot/command').map(row=>row.payload),[{action:'operation.lookup',input:{operationId:original.operationId,request:original}}]);
  assert.deepEqual(ui.state().pending,[original]);assert.match(ui.state().error,/未确认/);
});

for(const failingKey of [key,`${key}.retained`])test(`retain keeps a recoverable original when ${failingKey} fails`,async()=>{
  const ui=core({stored:[original],setItem:(k)=>{if(k===failingKey)storageFailure();}});await ui.refresh();ui.retainPending(original);
  assert.deepEqual(ui.state().pending,[original]);assert.deepEqual(JSON.parse(ui.cache.get(key)),[original]);
  if(failingKey===key)assert.deepEqual(JSON.parse(ui.cache.get(`${key}.retained`)),[original]);
  assert.match(ui.state().error||(ui.state().storageNotice??''),/保存|存储/);
});

test('a successful refresh clears only an earlier refresh connection failure',async()=>{
  let first=true;const ui=core({route:(method,_payload,snapshot)=>{if(method==='dsh.bot/snapshot'&&first){first=false;throw Error('offline refresh');}return structuredClone(snapshot);}});
  await ui.refresh();assert.match(ui.state().error,/offline refresh/);await ui.refresh();assert.equal(ui.state().error,'');
});

for(const newer of ['read','write','version'])test(`late refresh success preserves a newer ${newer} error`,async()=>{
  const gate=deferred();let held=false,offline=true;
  const ui=core({route:(method,payload,snapshot)=>{
    if(method==='dsh.bot/snapshot'){if(offline){offline=false;throw Error('old refresh failure');}if(held)return gate.promise;return structuredClone(snapshot);}
    throw Error(newer==='read'?'newer read failure':'newer write failure');
  }});
  await ui.refresh();held=true;const waiting=ui.refresh();await tick();
  if(newer==='read')await ui.query('material.search',{query:'latest'});else{held=false;if(newer==='version')ui.snapshot.pluginVersion='wrong';await ui.command('bot.update',original.input);}
  const error=ui.state().error;assert.ok(error&&!error.includes('old refresh failure'));gate.resolve(defaultSnapshot());await waiting;
  assert.equal(ui.state().error,error);
});

test('mutation after an old catalog refresh receives a new post-commit snapshot',async()=>{
  const gate=deferred(),entered=deferred();let holding=false;
  const ui=core({route:async(method,payload,snapshot)=>{
    if(method==='dsh.bot/catalog'){if(holding){entered.resolve();await gate.promise;}return catalog;}
    if(method==='dsh.bot/command'){snapshot.revision++;snapshot.bots.push({...structuredClone(bot),botId:'committed_bot'});return {botId:'committed_bot'};}
    return structuredClone(snapshot);
  }});await ui.refresh();holding=true;const refreshing=ui.refresh(true);await entered.promise;
  const writing=ui.command('bot.create',{name:'Saved'});await tick();gate.resolve();await Promise.all([refreshing,writing]);
  assert.equal(ui.state().snapshot.revision,ui.snapshot.revision);assert.ok(ui.state().snapshot.bots.some(row=>row.botId==='committed_bot'));
  assert.equal(ui.calls.filter(row=>row.method==='dsh.bot/catalog').length,1);
});

test('continue chat filters stable Bot ID and opens the saved contact without any mutation',async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'same_name_bot'});
  snapshot.sessions=[contact('original_a'),contact('original_b'),contact('wrong_bot',{botId:'same_name_bot'}),contact('archived',{archived:true}),contact('not_ready',{state:'unknown'}),contact('task',{purpose:'task'}),contact('missing_purpose',{purpose:undefined})];
  const ui=browser(snapshot);t.after(()=>ui.dispose());await ui.ready();await ui.click('继续聊天');
  assert.ok(button(ui,'Saved chat · original_a'));assert.ok(button(ui,'Saved chat · original_b'));
  for(const id of ['wrong_bot','archived','not_ready','task','missing_purpose'])assert.equal(button(ui,`Saved chat · ${id}`),null);
  assert.ok(button(ui,'开始聊天'));await ui.click('Saved chat · original_b');assert.deepEqual(ui.opened,['original_b']);
  assert.equal(ui.calls.some(row=>row.payload.operationId),false);
});

test('empty continue chat shows a clear state, closes and preserves new chat',async t=>{
  const ui=browser(defaultSnapshot());t.after(()=>ui.dispose());await ui.ready();await ui.click('继续聊天');
  assert.match(ui.text(ui.render()),/没有可继续|暂无可继续/);assert.ok(button(ui,'开始聊天'));await ui.click('关闭继续聊天');
  assert.doesNotMatch(ui.text(ui.render()),/没有可继续|暂无可继续/);
});

for(const changed of ['archive','delete','swap','unknown'])test(`selection rechecks a ${changed} contact against the live snapshot`,async t=>{
  const snapshot=defaultSnapshot();snapshot.sessions=[contact('original')];const ui=browser(snapshot);t.after(()=>ui.dispose());await ui.ready();await ui.click('继续聊天');
  if(changed==='archive')snapshot.sessions[0].archived=true;if(changed==='delete')snapshot.bots[0].deletedAt='now';if(changed==='swap')snapshot.sessions[0].botId='different';if(changed==='unknown')snapshot.sessions[0].state='unknown';
  await ui.click('Saved chat · original');assert.deepEqual(ui.opened,[]);assert.equal(ui.calls.some(row=>row.payload.operationId),false);
});

for(const ended of ['closed','unmounted','disabled'])test(`pending contact read cannot open after ${ended}`,async t=>{
  const snapshot=defaultSnapshot(),gate=deferred();snapshot.sessions=[contact('original')];let hold=false;
  const ui=browser(snapshot,()=>({}),{snapshot:()=>hold?gate.promise:snapshot});t.after(()=>{if(ended!=='disabled')ui.dispose();});await ui.ready();await ui.click('继续聊天');hold=true;
  const pending=button(ui,'Saved chat · original').props.onClick();await tick();ui.render();
  assert.equal(button(ui,'Saved chat · original').props.disabled,true);
  if(ended==='closed')await ui.click('关闭继续聊天');if(ended==='unmounted')await ui.click('记忆');if(ended==='disabled')ui.dispose();
  const before=ui.view();gate.resolve(snapshot);await pending;await tick();assert.deepEqual(ui.opened,[]);
  if(ended==='disabled'){ui.render();assert.equal(ui.view(),before,'late response must not publish after plugin disable');}
});

test('a refresh reply cannot publish after plugin disable',async t=>{
  const gate=deferred();let hold=false;const ui=browser(defaultSnapshot(),()=>({}),{snapshot:()=>hold?gate.promise:defaultSnapshot()});await ui.ready();hold=true;
  const waiting=button(ui,'refresh').props.onClick();await tick();const before=ui.view();ui.dispose();gate.resolve(defaultSnapshot());await waiting;ui.render();
  assert.equal(ui.view(),before);
});


test('before the first refresh a mutation persists in the compatible profile, never unknown',async()=>{
  let storedKey;const ui=core({setItem:(key)=>{storedKey??=key;}});
  await ui.command('bot.create',{name:'Early'});assert.equal(storedKey,key);
});

test('start chat still creates and opens a new native contact',async t=>{
  const ui=browser(defaultSnapshot(),action=>action==='session.create'?contact('new_contact'):{});t.after(()=>ui.dispose());await ui.ready();await ui.click('开始聊天');
  const writes=ui.calls.filter(row=>row.payload.operationId);assert.equal(writes.length,1);assert.equal(writes[0].payload.action,'session.create');
  assert.deepEqual(writes[0].payload.input,{botId:bot.botId});assert.deepEqual(ui.opened,['new_contact']);
});

test('native session refresh cannot open a contact archived by a newer snapshot',async t=>{
  const snapshot=defaultSnapshot(),gate=deferred(),entered=deferred();snapshot.sessions=[contact('original')];
  const ui=browser(snapshot,()=>({}),{nativeRefresh:()=>{entered.resolve();return gate.promise;}});t.after(()=>ui.dispose());await ui.ready();await ui.click('继续聊天');
  const pending=button(ui,'Saved chat · original').props.onClick();await entered.promise;
  snapshot.sessions[0].archived=true;await ui.click('refresh');gate.resolve();await pending;assert.deepEqual(ui.opened,[]);
});

test('duplicated pending and retained history never execute or mint a new ID on refresh or lookup',async()=>{
  const ui=core({stored:[original]});ui.cache.set(`${key}.retained`,JSON.stringify([original]));await ui.refresh();await ui.lookupOperation(original);
  assert.equal(ui.calls.some(row=>row.payload.operationId),false);assert.deepEqual(ui.state().pending,[original]);assert.deepEqual(ui.state().retained,[original]);
});

for(const first of ['command','lookup'])test(`first ${first} before refresh preserves cached pending and retained originals`,async()=>{
  const other={...original,operationId:'other_unconfirmed'},history={...original,operationId:'historical_original'};
  let ui;
  ui=core({stored:[original,other],route:(method,payload,snapshot)=>{
    if(method==='dsh.bot/snapshot')return structuredClone(snapshot);
    if(payload.action==='operation.lookup')return {state:'committed',result:{botId:'known'}};
    assert.deepEqual(JSON.parse(ui.cache.get(key)).slice(0,2),[original,other],'cached originals must be present before any mutation');
    assert.deepEqual(ui.state().retained,[history]);return {botId:'new'};
  }});
  ui.cache.set(`${key}.retained`,JSON.stringify([history]));
  if(first==='command')await ui.command('bot.create',{name:'Early'});else await ui.lookupOperation(original);
  const expected=first==='command'?[original,other]:[other];
  assert.deepEqual(JSON.parse(ui.cache.get(key)),expected);assert.deepEqual(ui.state().pending,expected);
  assert.deepEqual(ui.state().retained,[history]);assert.deepEqual(JSON.parse(ui.cache.get(`${key}.retained`)),[history]);
});

test('command during a gated first refresh preserves cached originals before sending',async()=>{
  const gate=deferred(),history={...original,operationId:'retained_before_refresh'};let snapshots=0,ui;
  ui=core({stored:[original],route:(method,payload,snapshot)=>{
    if(method==='dsh.bot/snapshot')return ++snapshots===1?gate.promise:structuredClone(snapshot);
    if(payload.operationId){assert.deepEqual(JSON.parse(ui.cache.get(key)).map(row=>row.operationId),[original.operationId,payload.operationId]);return {botId:'new'};}
    return catalog;
  }});ui.cache.set(`${key}.retained`,JSON.stringify([history]));
  const refreshing=ui.refresh(true),writing=ui.command('bot.create',{name:'Before first read'});await tick();
  gate.resolve(defaultSnapshot());await Promise.all([refreshing,writing]);
  assert.deepEqual(ui.state().pending,[original]);assert.deepEqual(JSON.parse(ui.cache.get(key)),[original]);assert.deepEqual(ui.state().retained,[history]);
  assert.equal(ui.calls.filter(row=>row.payload.operationId).length,1);
});

for(const barrier of ['snapshot','native'])for(const intent of ['tab','bot'])test(`${intent} intent cancels contact ${barrier} completion before passive unmount`,async t=>{
  const snapshot=defaultSnapshot(),gate=deferred(),entered=deferred();let hold=false;
  snapshot.sessions=[contact('original')];snapshot.bots.push({...structuredClone(bot),botId:'second_bot'});
  const routes=barrier==='snapshot'?{snapshot:()=>{if(hold){entered.resolve();return gate.promise;}return snapshot;}}:{nativeRefresh:()=>{entered.resolve();return gate.promise;}};
  const ui=browser(snapshot,()=>({}),routes);t.after(()=>ui.dispose());await ui.ready();await ui.click('继续聊天');hold=true;
  const selecting=button(ui,'Saved chat · original').props.onClick();await entered.promise;
  const next=intent==='tab'?button(ui,'记忆'):ui.find(row=>row.type==='button'&&ui.text(row)==='继续聊天'&&row.props['aria-expanded']===false);
  assert.ok(next);next.props.onClick();
  // React may not render/clean up passive effects before the awaited read resolves.
  gate.resolve(barrier==='snapshot'?snapshot:undefined);await selecting;
  assert.deepEqual(ui.opened,[]);assert.equal(ui.calls.some(row=>row.payload.operationId),false);
});
