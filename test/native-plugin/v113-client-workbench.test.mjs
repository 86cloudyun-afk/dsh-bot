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
function browser(snapshot=defaultSnapshot(),route=()=>({}),routes={}) {
  const registrations=[],lifecycle=[],calls=[],hooks=new Map(),effects=new Map(),cache=new Map(Object.entries(routes.cache??{})),copied=[],downloads=[],blobs=[],pendingRpc=new Set(),idleWaiters=new Set();
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

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const fieldNode=(ui,label)=>ui.find(row=>row.props?.['aria-label']===label);
const alert=ui=>ui.text(ui.find(row=>row.props.role==='alert'));
const materialSnapshot=()=>{
  const snapshot=defaultSnapshot();
  snapshot.materials=[{docId:'doc_read',botId:bot.botId,title:'Successful material result',version:1}];
  return snapshot;
};
async function materials(ui){await ui.ready();await ui.click('记忆');await ui.click('资料');}
const original={operationId:'original_unconfirmed',action:'bot.update',input:{botId:bot.botId,expectedVersion:1,lifecycle:'paused'}};
const storedOriginal={'dsh-bot.pending.v1.profile':JSON.stringify([original])};

test('manual catalog refresh during a snapshot poll fetches the latest model catalog',async t=>{
  const gate=deferred(),snapshot=defaultSnapshot();let holdPoll=false,updated=false,catalogReads=0;
  const nextCatalog=structuredClone(catalog);nextCatalog.providers[0].models.push({id:'latest-model'});
  const routes={snapshot:()=>holdPoll?gate.promise:snapshot,catalog:()=>{catalogReads++;return updated?nextCatalog:catalog;}};
  const ui=browser(snapshot,()=>({}),routes);t.after(()=>ui.dispose());await ui.ready();
  const priorReads=catalogReads,oldSnapshot=structuredClone(snapshot);
  holdPoll=true;routes.intervals[0]();await tick();
  updated=true;snapshot.revision++;
  const refreshing=ui.find(row=>row.type==='button'&&ui.text(row)==='refresh').props.onClick();
  holdPoll=false;gate.resolve(oldSnapshot);await refreshing;await ui.settle();
  assert.equal(catalogReads,priorReads+1,'an explicit refresh must fetch the changed catalog after the poll');
  assert.ok(fieldNode(ui,'模型').children.some(row=>row.props.value.includes('latest-model')),'the latest model must become selectable');
});

test('a successful material search retry clears that search failure',async t=>{
  const snapshot=materialSnapshot();let searches=0;
  const ui=browser(snapshot,action=>{
    if(action==='material.search'){if(++searches===1)throw Object.assign(Error('failed material search'),{code:'search_failure'});return snapshot.materials;}
    return {};
  });t.after(()=>ui.dispose());await materials(ui);
  await ui.submit('搜索资料',{query:'failed'});await ui.settle();assert.match(alert(ui),/failed material search/);
  await ui.submit('搜索资料',{query:'retry'});await ui.settle();
  assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Successful material result'));
  assert.equal(ui.find(row=>row.props.role==='alert'),null,'the successful retry must remove its own obsolete error');
});

for(const newerFailure of ['write','read'])test(`a successful material retry preserves a newer ${newerFailure} failure`,async t=>{
  const snapshot=materialSnapshot(),gate=deferred();let searches=0;
  const ui=browser(snapshot,action=>{
    if(action==='material.search'){if(++searches===1)throw Object.assign(Error('prior material search'),{code:'search_failure'});return gate.promise;}
    if(action==='operation.lookup')return {state:'unrecorded'};
    if(action==='bot.update')throw Object.assign(Error('newer original write outcome'),{code:'connection'});
    if(action==='material.download')throw Object.assign(Error('newer explicit download failure'),{code:'download_failure'});
    return {};
  },{cache:storedOriginal});t.after(()=>ui.dispose());await materials(ui);
  await ui.submit('搜索资料',{query:'first'});await ui.settle();await ui.submit('搜索资料',{query:'retry'});
  if(newerFailure==='write')await ui.click('用原 ID 接续');else await ui.click('修订这份资料');
  const expected=newerFailure==='write'?'newer original write outcome':'newer explicit download failure';assert.ok(alert(ui).includes(expected));
  gate.resolve(snapshot.materials);await ui.settle();assert.ok(alert(ui).includes(expected),'a material success cannot clear the newer unrelated failure');
  if(newerFailure==='write')assert.ok(ui.find(row=>row.type==='small'&&ui.text(row).includes(original.operationId)),'the original write remains available for lookup');
});

test('an obsolete successful material search cannot clear the latest failed search',async t=>{
  const snapshot=materialSnapshot(),gate=deferred();let searches=0;
  const ui=browser(snapshot,action=>{
    if(action==='material.search'){if(++searches===1)return gate.promise;throw Object.assign(Error('latest material failure'),{code:'search_failure'});}
    return {};
  });t.after(()=>ui.dispose());await materials(ui);await ui.submit('搜索资料',{query:'earlier'});await ui.submit('搜索资料',{query:'latest'});
  gate.resolve(snapshot.materials);await ui.settle();assert.match(alert(ui),/latest material failure/);
});

for(const otherBots of [0,1])test(`untouched sharing save preserves wildcard recipients with ${otherBots} existing other Bots`,async t=>{
  const snapshot=defaultSnapshot();if(otherBots)snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other Bot'});
  let request;
  const ui=browser(snapshot,(action,input)=>{
    if(action==='share.set'){request=structuredClone(input);snapshot.bots[0].share=structuredClone(input.share);snapshot.bots[0].revision++;snapshot.revision++;return input.share;}
    return {};
  });t.after(()=>ui.dispose());await ui.ready();await ui.click('管理');
  const receivers=snapshot.bots.filter(row=>row.botId!==bot.botId).map(row=>row.botId);
  await ui.submit('保存共享上限',{enabled:'on',sessions:'on',tasks:'on',memories:'on',receiver:receivers});await ui.settle();
  assert.deepEqual(request.share.receivers,['*'],'saving another sharing setting must preserve the original persistent default for future Bots');
  assert.equal(request.expectedVersion,1);
  snapshot.bots.push({...structuredClone(bot),botId:'bot_future',name:'Future Bot'});snapshot.revision++;await ui.click('refresh');
  assert.equal(ui.find(row=>row.type==='input'&&row.props.name==='receiver'&&row.props.value==='bot_future').props.checked,true,'the saved default must still include a Bot created later');
});

test('an explicit sharing selection survives another Bot inserted before its selected receiver',async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other Bot'});
  let request;
  const ui=browser(snapshot,(action,input)=>{if(action==='share.set'){request=structuredClone(input);return input.share;}return {};});t.after(()=>ui.dispose());await ui.ready();await ui.click('管理');
  const sharingNodes=()=>{
    const sharing=ui.find(row=>row.type==='section'&&row.props.id===`dsh-resource-${bot.botId}`),rows=[];
    const visit=node=>{if(!node||typeof node!=='object')return;rows.push(node);for(const child of node.children??[])visit(child);};
    visit(sharing);return rows;
  };
  const receivers=()=>sharingNodes().filter(row=>row.type==='input'&&row.props.name==='receiver');
  const recipient=receivers().find(row=>row.props.value==='bot_other');
  recipient.props.onChange({target:{checked:false}});ui.render();recipient.props.onChange({target:{checked:true}});ui.render();
  snapshot.bots.unshift({...structuredClone(bot),botId:'bot_000',name:'New Bot before the selected recipient'});snapshot.revision++;await ui.click('refresh');
  assert.deepEqual(receivers().map(row=>row.props.value),['bot_000','bot_other'],'the actual refreshed controls must place the new recipient before the existing selection');
  assert.equal(receivers().find(row=>row.props.value==='bot_000').props.checked,false);
  assert.deepEqual(receivers().filter(row=>row.props.checked).map(row=>row.props.value),['bot_other']);
  const form=sharingNodes().find(row=>row.type==='form');assert.ok(form,'the original owner sharing form remains available after insertion');
  form.props.onSubmit({preventDefault(){},currentTarget:data({enabled:'on',sessions:'on',tasks:'on',memories:'on',receiver:['bot_other']})});await ui.settle();
  assert.equal(request.botId,bot.botId);assert.deepEqual(request.share.receivers,['bot_other']);assert.equal(request.expectedVersion,1);
});

const scheduleRow=()=>({scheduleId:'schedule_existing',ownerBotId:bot.botId,kind:'reminder',message:'Saved reminder',rule:{kind:'once',timezone:'UTC',date:'2099-10-10',time:'09:00'},version:1,enabled:false});
const reminderValues={kind:'reminder',ruleKind:'once',timezone:'UTC',date:'2099-10-10',time:'09:00',message:'Reviewed reminder',missedPolicy:'skip'};
function scheduleBrowser(snapshot,route=()=>({})){
  return browser(snapshot,(action,input,request)=>action==='schedule.list'?[scheduleRow()]:action==='notice.list'||action==='occurrence.list'?[]:action==='session.list'?{items:[],nextCursor:null}:route(action,input,request));
}
async function schedules(ui){await ui.ready();await ui.click('任务');await ui.settle();}

test('the existing schedule owner is visible and disabled during editing',async t=>{
  const ui=scheduleBrowser(defaultSnapshot());t.after(()=>ui.dispose());await schedules(ui);await ui.click('编辑并重新确认');
  const owner=fieldNode(ui,'负责 Bot');assert.equal(owner.props.defaultValue,bot.botId);assert.equal(owner.props.disabled,true,'the saved schedule owner cannot be transferred through this edit form');
});

test('saving an existing schedule retains its original owner when disabled controls are absent from FormData',async t=>{
  let request;
  const ui=scheduleBrowser(defaultSnapshot(),(action,input)=>{if(action==='schedule.update'){request=structuredClone(input);return {...scheduleRow(),...input,version:2};}return {};});t.after(()=>ui.dispose());await schedules(ui);await ui.click('编辑并重新确认');
  await ui.submit('重新确认并保存安排',reminderValues);await ui.settle();
  assert.equal(request.ownerBotId,bot.botId,'disabled owner controls must not turn immutable ownership into an empty update');assert.equal(request.expectedVersion,1);
});

test('new schedule creation still permits choosing another responsible Bot',async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other Bot'});let request;
  const ui=scheduleBrowser(snapshot,(action,input)=>{if(action==='schedule.create'){request=structuredClone(input);return {...scheduleRow(),...input,scheduleId:'schedule_created'};}return {};});t.after(()=>ui.dispose());await schedules(ui);
  assert.ok(!fieldNode(ui,'负责 Bot').props.disabled);await ui.change('负责 Bot','bot_other');
  await ui.submit('确认创建安排',{...reminderValues,ownerBotId:'bot_other'});await ui.settle();assert.equal(request.ownerBotId,'bot_other');
});
