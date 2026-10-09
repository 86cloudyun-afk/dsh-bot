import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const source=await readFile(new URL('../../src/client/client.js',import.meta.url),'utf8');
const packageVersion=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8')).version;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bot={botId:'bot_own',name:'Named identity',role:'Own role',revision:1,memoryRevision:7,lifecycle:'active',contact:{provider:'official',model:'chat'},execution:{provider:'official',model:'work'},executionMode:'inherit',share:{enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:[]}}};
const defaultSnapshot=()=>({storeId:'profile',revision:1,pluginVersion:packageVersion,clientProtocol:2,bots:[structuredClone(bot)],tasks:[],sessions:[],memories:[],materials:[],grants:[],groups:[],meetings:[],outbox:[],attempts:[],notices:[]});
const catalog={providers:[{id:'official',name:'Official',models:[{id:'chat'},{id:'work'}]}],presets:[{id:'default',name:'Default'}],defaultModel:{provider:'official',model:'chat'},defaultCwd:'/workspace'};
function data(values={}) {return {get:key=>values[key]??'',getAll:key=>Array.isArray(values[key])?values[key]:values[key]?[values[key]]:[]};}
function browser(snapshot=defaultSnapshot(),route=()=>({})) {
  const registrations=[],lifecycle=[],calls=[],hooks=new Map(),effects=new Map(),cache=new Map(),copied=[],downloads=[],blobs=[],pendingRpc=new Set(),idleWaiters=new Set();
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
    localStorage:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)},
    FormData:class{constructor(value){return value;}},
    URL:{createObjectURL(blob){blobs.push(blob);return `blob:${blobs.length}`;},revokeObjectURL(){}},document:{createElement:()=>({click(){downloads.push({href:this.href,name:this.download});}})},navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{fn();return 1;}});
  const ctx={locale:{register:()=>()=>{},bind:()=>key=>key},effect:fn=>lifecycle.push(fn),
    slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{registrations.push({options,component});return()=>{};}},
    connection:{rpc:{call(_path,method,payload){
      const operation=(async()=>{calls.push(structuredClone({method,payload}));if(method==='dsh.bot/snapshot')return {ok:true,value:structuredClone(snapshot)};if(method==='dsh.bot/catalog')return {ok:true,value:structuredClone(catalog)};const result=await route(payload.action,payload.input,payload);return {ok:true,value:structuredClone(result)};})();
      pendingRpc.add(operation);
      operation.then(()=>pendingRpc.delete(operation),()=>pendingRpc.delete(operation));
      return operation;
    }}},
    sessions:{refresh:async()=>{}},uiWorkspace:{openSession(){}},layout:{selectPanel(){}}};
  module.factory(()=>react).apply(ctx);
  const disposers=lifecycle.map(fn=>fn());
  // Effects and hooks absent from the next render are disposed, as on React unmount.
  const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of node.children??[]){const found=walk(child,predicate);if(found)return found;}return null;};
  const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');
  const find=(predicate)=>walk(tree,predicate);
  const drainRpc=async()=>{while(pendingRpc.size)await Promise.allSettled([...pendingRpc]);};
  const waitIdle=()=>currentView?.busy?new Promise(resolve=>idleWaiters.add(resolve)):Promise.resolve();
  return {snapshot,calls,copied,downloads,blobs,registrations,
    async ready(){await tick();this.render();await tick();this.render();},
    render(slot='main',props={}) {const component=registrations.find(row=>row.options.name===slot)?.component;assert.ok(component);usedEffectKeys=new Set();usedHookKeys=new Set();tree=render(component,props,slot);for(const [key,value] of effects){if(!usedEffectKeys.has(key)){value.cleanup?.();effects.delete(key);}}for(const key of hooks.keys())if(!usedHookKeys.has(key))hooks.delete(key);usedEffectKeys=null;usedHookKeys=null;return tree;},
    find,text,
    async settle(){
      // The native form does not return the submit promise. Follow its real RPCs
      // and the store's busy=false publication instead of counting event-loop turns.
      await drainRpc();await waitIdle();await tick();this.render();
      await drainRpc();this.render();
      assert.equal(currentView?.busy,false,'UI must publish idle after its RPC completes');
    },
    async click(label){const node=find(row=>row.type==='button'&&text(row)===label);assert.ok(node,`missing button ${label}`);await node.props.onClick({currentTarget:{}});this.render();await tick();this.render();},
    async submit(label,values){const node=find(row=>row.type==='form'&&row.children.some(child=>child?.type==='button'&&text(child)===label));assert.ok(node,`missing form ${label}`);node.props.onSubmit({preventDefault(){},currentTarget:data(values)});await tick();this.render();await tick();this.render();},
    async change(label,value){const node=find(row=>row.props?.['aria-label']===label);assert.ok(node,`missing field ${label}`);await node.props.onChange({target:{value,files:value?[value]:[]},currentTarget:{value,files:value?[value]:[]}});this.render();await tick();this.render();},
    dispose(){unsubscribeView?.();for(const fn of disposers)fn?.();for(const value of effects.values())value.cleanup?.();},
  };
}

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const upload=(name,text,read)=>{const bytes=new TextEncoder().encode(text);return {name,size:bytes.length,arrayBuffer:read??(async()=>bytes.buffer)};};
const fileField=ui=>ui.find(row=>row.props?.['aria-label']==='UTF-8 文本或 Markdown 文件');
const fieldValue=(ui,label)=>ui.find(row=>row.props?.['aria-label']===label).props.defaultValue;
async function materials(ui){await ui.ready();await ui.click('记忆');await ui.click('资料');}

test('material read is visible and disables its title, body and Save until decoding completes',async t=>{
  const gate=deferred(),ui=browser();t.after(()=>ui.dispose());await materials(ui);
  const pending=fileField(ui).props.onChange({target:{files:[upload('slow.md','body',()=>gate.promise)]}});ui.render();
  const locked=ui.find(row=>row.type==='fieldset'&&row.props.disabled);
  assert.ok(locked,'the affected form must be disabled during file decoding');
  assert.ok(ui.find(row=>row.props.role==='status'&&ui.text(row).includes('读取')));
  assert.ok(ui.find(row=>row.type==='fieldset'&&row.props.disabled&&ui.text(row).includes('资料标题')&&ui.text(row).includes('正文')&&ui.text(row).includes('保存不可变资料')));
  await ui.submit('保存不可变资料',{title:'premature',text:'premature'});
  assert.equal(ui.calls.some(row=>row.payload.action==='material.ingest'),false);
  gate.resolve(new TextEncoder().encode('body').buffer);await pending;ui.render();
  assert.equal(fieldValue(ui,'资料标题'),'slow.md');assert.equal(fieldValue(ui,'正文'),'body');
  assert.equal(ui.find(row=>row.type==='fieldset'&&row.props.disabled),null);
});

test('latest material file wins when an earlier read completes last, including exact text and metadata',async t=>{
  const gate=deferred(),ui=browser();t.after(()=>ui.dispose());await materials(ui);
  const earlier=fileField(ui).props.onChange({target:{files:[upload('earlier.md','old',()=>gate.promise)]}});ui.render();
  const exact='\uFEFFlatest 🧭\r\nsecond\rthird\n';
  await ui.change('UTF-8 文本或 Markdown 文件',upload('latest.txt',exact));
  gate.resolve(new TextEncoder().encode('old').buffer);await earlier;ui.render();
  assert.equal(fieldValue(ui,'资料标题'),'latest.txt');assert.equal(fieldValue(ui,'正文'),exact);
  await ui.submit('保存不可变资料',{title:'Latest title',text:exact.replace(/\r\n?/g,'\n')});await ui.settle();
  const request=ui.calls.find(row=>row.payload.action==='material.ingest').payload;
  assert.deepEqual(request.input,{botId:bot.botId,title:'Latest title',text:exact,mediaType:'text/plain',fileName:'latest.txt'});
});

test('an older failed material read cannot replace the current error or unlock a newer read',async t=>{
  const first=deferred(),second=deferred(),ui=browser();t.after(()=>ui.dispose());await materials(ui);
  const earlier=fileField(ui).props.onChange({target:{files:[upload('old.md','old',()=>first.promise)]}});ui.render();
  const latest=fileField(ui).props.onChange({target:{files:[upload('new.md','new',()=>second.promise)]}});ui.render();
  first.reject(Error('old failure'));await earlier;ui.render();
  assert.equal(ui.find(row=>row.props.role==='alert'),null);
  assert.ok(ui.find(row=>row.type==='fieldset'&&row.props.disabled));
  second.resolve(new TextEncoder().encode('new').buffer);await latest;ui.render();
  assert.equal(fieldValue(ui,'正文'),'new');
});

test('a material read rejected after switching Bot cannot publish into the new Bot pane',async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});
  const gate=deferred(),ui=browser(snapshot);t.after(()=>ui.dispose());await materials(ui);
  const pending=fileField(ui).props.onChange({target:{files:[upload('slow.md','old',()=>gate.promise)]}});ui.render();
  await ui.change('所属 Bot','bot_other');
  gate.reject(Error('failed after Bot change'));await pending;ui.render();
  assert.equal(ui.find(row=>row.props.role==='alert'),null);assert.equal(fieldValue(ui,'正文'),'');
});

test('an active invalid UTF-8 material read remains visible and releases the form',async t=>{
  const ui=browser();t.after(()=>ui.dispose());await materials(ui);
  await ui.change('UTF-8 文本或 Markdown 文件',{name:'bad.md',size:2,arrayBuffer:async()=>Uint8Array.from([0xc3,0x28]).buffer});
  assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('UTF-8')));
  assert.equal(ui.find(row=>row.type==='fieldset'&&row.props.disabled),null);
  assert.equal(ui.calls.some(row=>row.payload.action==='material.ingest'),false);
});

test('revising existing material is unavailable during file decoding',async t=>{
  const snapshot=defaultSnapshot();snapshot.materials=[{docId:'material_one',botId:bot.botId,title:'Existing',version:1}];
  const gate=deferred(),ui=browser(snapshot);t.after(()=>ui.dispose());await materials(ui);
  const pending=fileField(ui).props.onChange({target:{files:[upload('slow.md','body',()=>gate.promise)]}});ui.render();
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='修订这份资料').props.disabled,true);
  gate.resolve(new TextEncoder().encode('body').buffer);await pending;ui.render();
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='修订这份资料').props.disabled,false);
});

for(const failure of [false,true]) test(`a prior revision download ${failure?'failure':'result'} cannot replace a later uploaded draft`,async t=>{
  const snapshot=defaultSnapshot();snapshot.materials=[{docId:'material_one',botId:bot.botId,title:'Existing',mediaType:'text/markdown',fileName:'existing.md',version:1}];
  const gate=deferred(),ui=browser(snapshot,action=>action==='material.download'?gate.promise:undefined);t.after(()=>ui.dispose());await materials(ui);
  const revision=ui.find(row=>row.type==='button'&&ui.text(row)==='修订这份资料').props.onClick();ui.render();
  const exact='\uFEFFlatest 🧭\r\nsecond\rthird\n';
  await ui.change('UTF-8 文本或 Markdown 文件',upload('latest.txt',exact));
  if(failure)gate.reject(Object.assign(Error('Old revision failed'),{code:'download_failure'}));else gate.resolve({text:'Old revision body'});
  await revision;ui.render();assert.equal(ui.find(row=>row.props.role==='alert'),null);
  assert.equal(fieldValue(ui,'资料标题'),'latest.txt');assert.equal(fieldValue(ui,'正文'),exact);
  await ui.submit('保存不可变资料',{title:'Latest title',text:exact.replace(/\r\n?/g,'\n')});await ui.settle();
  assert.deepEqual(ui.calls.find(row=>row.payload.action==='material.ingest').payload.input,{botId:bot.botId,title:'Latest title',text:exact,mediaType:'text/plain',fileName:'latest.txt'});
});

test('an active revision download visibly locks its draft and keeps its error visible',async t=>{
  const snapshot=defaultSnapshot();snapshot.materials=[{docId:'material_one',botId:bot.botId,title:'Existing',version:1}];
  const gate=deferred(),ui=browser(snapshot,action=>action==='material.download'?gate.promise:undefined);t.after(()=>ui.dispose());await materials(ui);
  const revision=ui.find(row=>row.type==='button'&&ui.text(row)==='修订这份资料').props.onClick();ui.render();
  assert.ok(ui.find(row=>row.type==='fieldset'&&row.props.disabled));
  assert.ok(ui.find(row=>row.props.role==='status'&&ui.text(row).includes('读取')));
  gate.reject(Object.assign(Error('Active revision failed'),{code:'download_failure'}));await revision;ui.render();
  assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('download_failure')));
  assert.equal(ui.find(row=>row.type==='fieldset'&&row.props.disabled),null);
});

test('a completed material save cannot clear a newer upload selected while the save was pending',async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),action=>action==='material.ingest'?gate.promise:undefined);t.after(()=>ui.dispose());await materials(ui);
  await ui.change('UTF-8 文本或 Markdown 文件',upload('first.txt','First body'));
  await ui.submit('保存不可变资料',{title:'First title',text:'First body'});
  await ui.change('UTF-8 文本或 Markdown 文件',upload('later.md','Later body'));
  gate.resolve({docId:'saved_first'});await ui.settle();
  assert.equal(fieldValue(ui,'资料标题'),'later.md');assert.equal(fieldValue(ui,'正文'),'Later body');
});

for(const failure of [false,true]) test(`Show all memories cancels a pending filtered search ${failure?'failure':'result'}`,async t=>{
  const snapshot=defaultSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1},{memoryId:'memory_B',botId:bot.botId,text:'Memory B',category:'fact',version:1}];
  const gate=deferred(),ui=browser(snapshot,(action,input)=>action==='memory.search'?(input.query==='initial'?[{memoryId:'memory_A'}]:gate.promise):undefined);t.after(()=>ui.dispose());
  await ui.ready();await ui.click('记忆');await ui.submit('搜索记忆',{query:'initial'});await ui.submit('搜索记忆',{query:'held'});await ui.click('显示全部记忆');
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory B'));
  if(failure)gate.reject(Object.assign(Error('Obsolete filtered search'),{code:'search_failure'}));else gate.resolve([{memoryId:'memory_A'}]);
  await ui.settle();assert.equal(ui.find(row=>row.props.role==='alert'),null);
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory B'));
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='显示全部记忆'),null);
});

for(const destination of ['bot_other','资料']) test(`memory intent to ${destination} invalidates a read before effect cleanup`,async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});
  snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1},{memoryId:'memory_B',botId:'bot_other',text:'Memory B',category:'fact',version:1}];
  const gate=deferred(),ui=browser(snapshot,action=>action==='memory.search'?gate.promise:undefined);t.after(()=>ui.dispose());
  await ui.ready();await ui.click('记忆');await ui.submit('搜索记忆',{query:'A'});
  // Deliver the user event, then complete the read before the next render's effects.
  if(destination==='bot_other')ui.find(row=>row.props['aria-label']==='所属 Bot').props.onChange({target:{value:destination}});
  else ui.find(row=>row.type==='button'&&ui.text(row)===destination).props.onClick();
  gate.resolve([{memoryId:'memory_A'}]);await ui.settle();
  if(destination==='资料')await ui.click('长期记忆');
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)===(destination==='bot_other'?'Memory B':'Memory A')));
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='显示全部记忆'),null);
});

for(const failure of [false,true]) for(const destination of ['bot_other','Bots','资料']) {
  test(`held memory search ${failure?'failure':'result'} is ignored after changing to ${destination}`,async t=>{
    const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});
    snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1},{memoryId:'memory_B',botId:'bot_other',text:'Memory B',category:'fact',version:1}];
    const gate=deferred(),ui=browser(snapshot,action=>action==='memory.search'?gate.promise:undefined);t.after(()=>ui.dispose());
    await ui.ready();await ui.click('记忆');await ui.submit('搜索记忆',{query:'A'});
    if(destination==='bot_other')await ui.change('所属 Bot',destination);else await ui.click(destination);
    if(failure)gate.reject(Object.assign(Error('Search after leaving original Bot'),{code:'search_failure'}));else gate.resolve([{memoryId:'memory_A'}]);
    await ui.settle();assert.equal(ui.find(row=>row.props.role==='alert'),null);
    if(destination==='bot_other') {
      assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory B'));
      assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='显示全部记忆'),null);
    } else if(destination==='资料') {
      await ui.click('长期记忆');
      assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory A'));
      assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='显示全部记忆'),null);
    }
  });
}

test('active memory search failures remain visible',async t=>{
  const ui=browser(defaultSnapshot(),action=>{if(action==='memory.search')throw Object.assign(Error('Active search failure'),{code:'search_failure'});});t.after(()=>ui.dispose());
  await ui.ready();await ui.click('记忆');await ui.submit('搜索记忆',{query:'A'});await ui.settle();
  assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('search_failure')));
});

for(const failEarlier of [false,true]) test(`latest memory search wins over an earlier ${failEarlier?'failure':'result'}`,async t=>{
  const snapshot=defaultSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1},{memoryId:'memory_B',botId:bot.botId,text:'Memory B',category:'fact',version:1}];
  const gate=deferred(),ui=browser(snapshot,(action,input)=>action==='memory.search'?(input.query==='A'?gate.promise:[{memoryId:'memory_B'}]):undefined);t.after(()=>ui.dispose());
  await ui.ready();await ui.click('记忆');await ui.submit('搜索记忆',{query:'A'});await ui.submit('搜索记忆',{query:'B'});
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory B'));
  if(failEarlier)gate.reject(Object.assign(Error('Earlier search failed'),{code:'search_failure'}));else gate.resolve([{memoryId:'memory_A'}]);
  await ui.settle();assert.equal(ui.find(row=>row.props.role==='alert'),null);
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory B'));
  assert.equal(ui.find(row=>row.type==='p'&&ui.text(row)==='Memory A'),null);
});

for(const action of ['schedule.list','notice.list','occurrence.list']) {
  const schedule={scheduleId:'schedule_one',ownerBotId:bot.botId,kind:'reminder',message:'Reminder',rule:{kind:'once',timezone:'UTC',date:'2026-10-10',time:'09:00'},version:1,enabled:false};
  for(const leave of [true,false]) test(`${leave?'disposed':'active'} ${action} errors ${leave?'stay out of the destination pane':'remain visible'}`,async t=>{
    const gate=deferred(),ui=browser(defaultSnapshot(),query=>query===action?gate.promise:query==='schedule.list'?[schedule]:query==='session.list'?{items:[],nextCursor:null}:[]);t.after(()=>ui.dispose());
    await ui.ready();await ui.click('任务');
    assert.equal(ui.calls.filter(row=>row.payload.action===action).length,1);
    if(leave)await ui.click('Bots');
    gate.reject(Object.assign(Error('Held schedule read failed'),{code:'schedule_failure'}));await tick();await tick();ui.render();
    const alert=ui.find(row=>row.props.role==='alert');
    if(leave)assert.equal(alert,null,'disposed reads cannot publish into Bots');
    else assert.ok(alert&&ui.text(alert).includes('schedule_failure')&&ui.text(alert).includes('Held schedule read failed'));
  });
}
