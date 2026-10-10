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
    URL:{createObjectURL(blob){blobs.push(blob);return `blob:${blobs.length}`;},revokeObjectURL(){}},document:{createElement:()=>({click(){downloads.push({href:this.href,name:this.download});}})},navigator:{clipboard:{writeText:async text=>{if(routes.clipboard)await routes.clipboard(text);copied.push(text);}}},
    setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{fn();return 1;}});
  const ctx={locale:{register:()=>()=>{},bind:()=>key=>key},effect:fn=>lifecycle.push(fn),
    slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{registrations.push({options,component});return()=>{};}},
    connection:{rpc:{call(_path,method,payload){
      const operation=(async()=>{calls.push(structuredClone({method,payload}));if(method==='dsh.bot/snapshot')return {ok:true,value:structuredClone(snapshot)};if(method==='dsh.bot/catalog')return {ok:true,value:structuredClone(routes.catalog?await routes.catalog():catalog)};const result=await route(payload.action,payload.input,payload);return {ok:true,value:structuredClone(result)};})();
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
const upload=(name,text,read)=>{const bytes=new TextEncoder().encode(text);return {name,size:bytes.length,arrayBuffer:read??(async()=>bytes.buffer)};};
async function materials(ui){await ui.ready();await ui.click('记忆');await ui.click('资料');}

const importText=label=>JSON.stringify({entries:[{text:label,category:'fact'}]});
const importPreview=label=>({entries:[{index:0,text:label,category:'fact',decision:'append'}],memoryRevision:7,pinCount:0});
const enabledButton=(ui,label)=>{const node=ui.find(row=>row.type==='button'&&ui.text(row)===label);assert.ok(node,`missing ${label}`);assert.ok(!node.props.disabled,`${label} must be enabled`);return node;};
const startFile=(ui,label,file)=>{const node=ui.find(row=>row.props?.['aria-label']===label);assert.ok(node);assert.ok(!node.props.disabled,`${label} must be enabled`);const pending=node.props.onChange({target:{files:[file]}});ui.render();return pending;};
const noAlert=ui=>assert.equal(ui.find(row=>row.props.role==='alert'),null);
async function until(predicate){const deadline=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<deadline,'expected asynchronous read to start');await tick();}}
async function memories(ui){await ui.ready();await ui.click('记忆');}
const materialSnapshot=()=>{const snapshot=defaultSnapshot();snapshot.materials=[{docId:'doc_A',botId:bot.botId,title:'Material A',version:1},{docId:'doc_B',botId:bot.botId,title:'Material B',version:1}];return snapshot;};

for(const stage of ['read','preview']) for(const fail of [false,true]) test(`cancel import while replacement ${stage} is pending ignores its ${fail?'failure':'result'}`,async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),(action,input)=>action==='memory.import.preview'?(JSON.parse(input.fileText).entries[0].text==='B'&&stage==='preview'?gate.promise:importPreview(JSON.parse(input.fileText).entries[0].text)):{});t.after(()=>ui.dispose());await memories(ui);
  await ui.change('导入 JSON 文件',upload('a.json',importText('A')));
  enabledButton(ui,'确认整批追加');
  const pending=startFile(ui,'导入 JSON 文件',upload('b.json',importText('B'),stage==='read'?()=>gate.promise:undefined));
  if(stage==='preview')await until(()=>ui.calls.some(row=>row.payload.action==='memory.import.preview'&&row.payload.input.fileText===importText('B')));
  await tick();ui.render();await ui.click('取消导入');
  if(fail)gate.reject(Object.assign(Error('Canceled B failure'),{code:'preview_failure'}));else gate.resolve(stage==='read'?new TextEncoder().encode(importText('B')).buffer:importPreview('B'));
  await pending;ui.render();noAlert(ui);
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='确认整批追加'),null);
  assert.equal(ui.find(row=>row.props['aria-label']==='导入 JSON 文件').props.disabled,false);
  assert.equal(ui.calls.some(row=>row.payload.action==='memory.import'),false);
});

test('replacement import disables confirmation of the old preview throughout its read',async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),action=>action==='memory.import.preview'?importPreview('A'):{});t.after(()=>ui.dispose());await memories(ui);
  await ui.change('导入 JSON 文件',upload('a.json',importText('A')));enabledButton(ui,'确认整批追加');
  const pending=startFile(ui,'导入 JSON 文件',upload('b.json',importText('B'),()=>gate.promise));
  const confirm=ui.find(row=>row.type==='button'&&ui.text(row)==='确认整批追加');assert.ok(!confirm||confirm.props.disabled,'the prior preview cannot be confirmed while a newer import is reading');
  gate.resolve(new TextEncoder().encode(importText('B')).buffer);await pending;ui.render();
});

for(const stage of ['read','preview']) for(const destination of ['bot_other','Bots','资料']) test(`import ${stage} failure after leaving for ${destination} does not publish a global error`,async t=>{
  const snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});
  const gate=deferred(),ui=browser(snapshot,action=>action==='memory.import.preview'?gate.promise:{});t.after(()=>ui.dispose());await memories(ui);
  const pending=startFile(ui,'导入 JSON 文件',upload('a.json',importText('A'),stage==='read'?()=>gate.promise:undefined));
  if(stage==='preview')await until(()=>ui.calls.some(row=>row.payload.action==='memory.import.preview'));
  await tick();ui.render();
  if(destination==='bot_other')await ui.change('所属 Bot',destination);else await ui.click(destination);
  gate.reject(Object.assign(Error('Failure after leaving import'),{code:'preview_failure'}));await pending;ui.render();noAlert(ui);
  if(stage==='read')assert.equal(ui.calls.some(row=>row.payload.action==='memory.import.preview'),false,'abandoned reads must not issue a preview');
});

for(const fail of [false,true]) test(`latest material search wins over an earlier ${fail?'failure':'result'}`,async t=>{
  const gate=deferred(),snapshot=materialSnapshot(),ui=browser(snapshot,(action,input)=>action==='material.search'?(input.query==='A'?gate.promise:[snapshot.materials[1]]):{});t.after(()=>ui.dispose());await materials(ui);
  await ui.submit('搜索资料',{query:'A'});await ui.submit('搜索资料',{query:'B'});
  assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Material B'));
  if(fail)gate.reject(Object.assign(Error('Earlier material search'),{code:'search_failure'}));else gate.resolve([snapshot.materials[0]]);
  await ui.settle();noAlert(ui);assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Material B'));assert.equal(ui.find(row=>row.type==='h3'&&ui.text(row)==='Material A'),null);
});

for(const fail of [false,true]) test(`show all materials invalidates a pending search ${fail?'failure':'result'}`,async t=>{
  const gate=deferred(),snapshot=materialSnapshot(),ui=browser(snapshot,(action,input)=>action==='material.search'?(input.query==='initial'?[snapshot.materials[0]]:gate.promise):{});t.after(()=>ui.dispose());await materials(ui);
  await ui.submit('搜索资料',{query:'initial'});await ui.submit('搜索资料',{query:'held'});await ui.click('显示全部资料');
  if(fail)gate.reject(Object.assign(Error('Canceled search'),{code:'search_failure'}));else gate.resolve([snapshot.materials[0]]);
  await ui.settle();noAlert(ui);assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Material B'));assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='显示全部资料'),null);
});

for(const action of ['material.search','memory.context.preview']) for(const destination of ['bot_other','Bots',action==='material.search'?'长期记忆':'资料']) test(`${action} failure is ignored after leaving for ${destination}`,async t=>{
  const snapshot=materialSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});
  const gate=deferred(),ui=browser(snapshot,query=>query===action?gate.promise:{});t.after(()=>ui.dispose());if(action==='material.search')await materials(ui);else await memories(ui);
  await ui.submit(action==='material.search'?'搜索资料':'查看上下文预览',{query:'A'});
  if(destination==='bot_other')await ui.change('所属 Bot',destination);else await ui.click(destination);
  gate.reject(Object.assign(Error('Read after leaving'),{code:'stale_failure'}));await ui.settle();noAlert(ui);
});

for(const fail of [false,true]) test(`latest context preview wins over an earlier ${fail?'failure':'result'}`,async t=>{
  const gate=deferred(),preview=label=>({memoryPreviews:[{memoryId:label,text:label}],taskPreviews:[]}),ui=browser(defaultSnapshot(),(action,input)=>action==='memory.context.preview'?(input.query==='A'?gate.promise:preview('B')):{});t.after(()=>ui.dispose());await memories(ui);
  await ui.submit('查看上下文预览',{query:'A'});await ui.submit('查看上下文预览',{query:'B'});
  if(fail)gate.reject(Object.assign(Error('Earlier context'),{code:'context_failure'}));else gate.resolve(preview('A'));
  await ui.settle();noAlert(ui);assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='B'));assert.equal(ui.find(row=>row.type==='p'&&ui.text(row)==='A'),null);
});

test('template list error after leaving Bots is not published in Memory',async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),action=>action==='template.list'?gate.promise:{});t.after(()=>ui.dispose());await ui.ready();await ui.click('记忆');
  gate.reject(Object.assign(Error('Disposed template list'),{code:'template_failure'}));await ui.settle();noAlert(ui);
});

for(const pagination of [false,true]) test(`material ${pagination?'next':'initial'} page failure after closing reader stays out of materials`,async t=>{
  const gate=deferred(),ui=browser(materialSnapshot(),(action,input)=>action==='material.page'?(pagination&&!input.cursor?{title:'A',text:'Body',nextCursor:'cursor'}:gate.promise):{});t.after(()=>ui.dispose());await materials(ui);await ui.click('打开正文');
  let pending;if(pagination){const next=enabledButton(ui,'下一页正文');pending=next.props.onClick();ui.render();}
  await ui.click('关闭正文');gate.reject(Object.assign(Error('Closed reader'),{code:'page_failure'}));if(pending)await pending;await ui.settle();noAlert(ui);
});

test('closed briefing failure is not published in the workbench',async t=>{
  const snapshot=defaultSnapshot();snapshot.sessions=[{sessionId:'session_one',botId:bot.botId,purpose:'contact'}];
  const gate=deferred(),ui=browser(snapshot,action=>action==='briefing'?gate.promise:{});t.after(()=>ui.dispose());await ui.ready();
  ui.render('conversation.session.header.utilities',{sessionId:'session_one'});enabledButton(ui,'任务简报').props.onClick({currentTarget:{}});ui.render('dsh-bot.briefing');
  enabledButton(ui,'关闭简报').props.onClick();ui.render('dsh-bot.briefing');gate.reject(Object.assign(Error('Closed briefing'),{code:'briefing_failure'}));await ui.settle();noAlert(ui);
});

async function sessions(ui){await ui.ready();await ui.click('管理');await ui.click('会话管理');await tick();ui.render();}
const sessionRow=title=>({sessionId:`session_${title}`,header:{title}});
for(const fail of [false,true]) test(`latest session refresh wins over earlier ${fail?'failure':'result'}`,async t=>{
  const gate=deferred();let reads=0;const ui=browser(defaultSnapshot(),action=>action==='session.list'?(++reads===2?gate.promise:{items:[sessionRow(reads===1?'Initial':'Latest')],nextCursor:null}):{});t.after(()=>ui.dispose());await sessions(ui);
  const earlier=enabledButton(ui,'刷新会话').props.onClick();ui.render();await ui.click('刷新会话');
  if(fail)gate.reject(Error('Old session failure'));else gate.resolve({items:[sessionRow('Old')],nextCursor:null});await earlier;await ui.settle();
  assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Latest'));assert.equal(ui.find(row=>row.type==='h3'&&ui.text(row)==='Old'),null);assert.equal(ui.find(row=>row.type==='p'&&ui.text(row).includes('Old session failure')),null);
});

test('session refresh invalidates a pending append',async t=>{
  const gate=deferred();let reads=0;const ui=browser(defaultSnapshot(),(action,input)=>action==='session.list'?(input.cursor?gate.promise:{items:[sessionRow(++reads===1?'Initial':'Latest')],nextCursor:'cursor'}):{});t.after(()=>ui.dispose());await sessions(ui);
  const append=enabledButton(ui,'加载下一页').props.onClick();ui.render();await ui.click('刷新会话');gate.resolve({items:[sessionRow('Obsolete append')],nextCursor:null});await append;await ui.settle();
  assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Latest'));assert.equal(ui.find(row=>row.type==='h3'&&ui.text(row)==='Obsolete append'),null);
});

test('repeated pending session pagination does not append the same page twice',async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),(action,input)=>action==='session.list'?(input.cursor?gate.promise:{items:[sessionRow('Initial')],nextCursor:'cursor'}):{});t.after(()=>ui.dispose());await sessions(ui);
  const first=enabledButton(ui,'加载下一页').props.onClick();ui.render();const second=enabledButton(ui,'加载下一页').props.onClick();ui.render();gate.resolve({items:[sessionRow('Next')],nextCursor:null});await Promise.all([first,second]);await ui.settle();
  const count=(node)=>!node||typeof node!=='object'?0:(node.type==='h3'&&ui.text(node)==='Next'?1:0)+(node.children??[]).reduce((sum,child)=>sum+count(child),0);assert.equal(count(ui.render()),1);
});

for(const fail of [false,true]) test(`diagnostic selection change invalidates pending ${fail?'failure':'result'}`,async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),action=>{if(action==='bot.update')throw Error('Unconfirmed operation');return action==='diagnostics.read'?gate.promise:action==='session.list'?{items:[],nextCursor:null}:{};});t.after(()=>ui.dispose());await ui.ready();await ui.click('暂停');await ui.click('管理');await ui.click('会话管理');await tick();ui.render();
  const operationId=ui.calls.find(row=>row.payload.action==='bot.update').payload.operationId,selection=ui.find(row=>row.props['aria-label']==='附带的原始操作（可多选）');assert.ok(!selection.props.disabled);selection.props.onChange({target:{selectedOptions:[{value:operationId}]}});ui.render();
  const priorError=ui.text(ui.find(row=>row.props.role==='alert')),earlier=enabledButton(ui,'预览诊断').props.onClick();ui.render();assert.deepEqual(ui.calls.find(row=>row.payload.action==='diagnostics.read').payload.input.operationIds,[operationId]);ui.find(row=>row.props['aria-label']==='附带的原始操作（可多选）').props.onChange({target:{selectedOptions:[]}});ui.render();
  if(fail)gate.reject(Object.assign(Error('Old diagnostics'),{code:'diagnostics_failure'}));else gate.resolve({operationIds:[operationId]});await earlier;await ui.settle();assert.equal(ui.text(ui.find(row=>row.props.role==='alert')),priorError);assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='复制以上诊断'),null);
});

for(const action of ['memory.import.preview','material.search','memory.context.preview','template.list','material.page','briefing','diagnostics.read']) test(`active ${action} failure remains visible`,async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.sessions=[{sessionId:'session_one',botId:bot.botId,purpose:'contact'}];
  const ui=browser(snapshot,query=>query===action?gate.promise:query==='session.list'?{items:[],nextCursor:null}:{});t.after(()=>ui.dispose());let pending;
  if(action==='template.list')await ui.ready();
  else if(action==='memory.import.preview'){await memories(ui);pending=startFile(ui,'导入 JSON 文件',upload('a.json',importText('A')));await until(()=>ui.calls.some(row=>row.payload.action===action));}
  else if(action==='material.search'||action==='material.page'){await materials(ui);if(action==='material.search')await ui.submit('搜索资料',{query:'A'});else await ui.click('打开正文');}
  else if(action==='memory.context.preview'){await memories(ui);await ui.submit('查看上下文预览',{query:'A'});}
  else if(action==='diagnostics.read'){await sessions(ui);pending=enabledButton(ui,'预览诊断').props.onClick();}
  else{await ui.ready();ui.render('conversation.session.header.utilities',{sessionId:'session_one'});enabledButton(ui,'任务简报').props.onClick({currentTarget:{}});ui.render('dsh-bot.briefing');}
  gate.reject(Object.assign(Error(`Active ${action}`),{code:'active_failure'}));if(pending)await pending;await ui.settle();assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('active_failure')));
});

test('active import decoding failure remains visible and releases the file picker',async t=>{
  const ui=browser();t.after(()=>ui.dispose());await memories(ui);await ui.change('导入 JSON 文件',{name:'bad.json',size:2,arrayBuffer:async()=>Uint8Array.from([0xc3,0x28]).buffer});assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('UTF-8')));assert.equal(ui.find(row=>row.props['aria-label']==='导入 JSON 文件').props.disabled,false);
});

test('accepted import receipt cannot clear a newer draft selected while the write is pending',async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),(action,input)=>action==='memory.import'?gate.promise:action==='memory.import.preview'?importPreview(JSON.parse(input.fileText).entries[0].text):{});t.after(()=>ui.dispose());await memories(ui);await ui.change('导入 JSON 文件',upload('a.json',importText('A')));
  const accepted=enabledButton(ui,'确认整批追加').props.onClick();await until(()=>ui.calls.some(row=>row.payload.action==='memory.import'));ui.render();
  await ui.change('导入 JSON 文件',upload('b.json',importText('B')));assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='B'));
  gate.resolve({added:1});await accepted;await ui.settle();assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='B'));enabledButton(ui,'确认整批追加');assert.equal(ui.find(row=>row.type==='h2'&&ui.text(row)==='待查回的原始操作'),null);assert.equal(ui.calls.filter(row=>row.payload.action==='memory.import').length,1);
});

for(const kind of ['memory','material']) test(`explicit ${kind} download completes after leaving its pane`,async t=>{
  const gate=deferred(),ui=browser(materialSnapshot(),action=>action===(kind==='memory'?'memory.export':'material.download')?gate.promise:action==='material.page'?{title:'A',text:'Body',nextCursor:null}:{});t.after(()=>ui.dispose());if(kind==='memory')await memories(ui);else{await materials(ui);await ui.click('打开正文');}
  const download=enabledButton(ui,kind==='memory'?'导出记忆 JSON':'下载此份资料').props.onClick();ui.render();await ui.click('Bots');gate.resolve(kind==='memory'?{fileText:'{"entries":[]}',fileName:'memory.json'}:{text:'Full immutable body',fileName:'material.txt'});await download;await ui.settle();assert.equal(ui.downloads.length,1);assert.equal(ui.downloads[0].name,kind==='memory'?'memory.json':'material.txt');assert.equal(await ui.blobs[0].text(),kind==='memory'?'{"entries":[]}':'Full immutable body');
});

test('latest reader pagination cannot be replaced by an older page result',async t=>{
  const gate=deferred();let reads=0;const ui=browser(materialSnapshot(),action=>action==='material.page'?(++reads===2?gate.promise:{title:'A',text:reads===1?'Initial':'Latest page',nextCursor:'cursor'}):{});t.after(()=>ui.dispose());await materials(ui);await ui.click('打开正文');const old=enabledButton(ui,'下一页正文').props.onClick();ui.render();await ui.click('下一页正文');gate.resolve({title:'A',text:'Old page',nextCursor:null});await old;await ui.settle();assert.ok(ui.find(row=>row.type==='pre'&&ui.text(row)==='Latest page'));assert.equal(ui.find(row=>row.type==='pre'&&ui.text(row)==='Old page'),null);
});

test('successful active session refresh clears its prior local error',async t=>{
  let reads=0;const ui=browser(defaultSnapshot(),action=>{if(action==='session.list'){if(++reads===2)throw Error('Active session failure');return {items:[sessionRow('Current')],nextCursor:null};}return {};});t.after(()=>ui.dispose());await sessions(ui);await ui.click('刷新会话');assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Active session failure'));await ui.click('刷新会话');assert.equal(ui.find(row=>row.type==='p'&&ui.text(row)==='Active session failure'),null);assert.ok(ui.find(row=>row.type==='h3'&&ui.text(row)==='Current'));
});

test('accepted occurrence prune refresh failure is ignored after leaving Tasks',async t=>{
  const gate=deferred(),schedule={scheduleId:'schedule_one',ownerBotId:bot.botId,kind:'reminder',message:'Reminder',rule:{kind:'once',timezone:'UTC',date:'2026-10-10',time:'09:00'},version:1,enabled:false};let occurrenceReads=0;
  const ui=browser(defaultSnapshot(),action=>action==='schedule.list'?[schedule]:action==='notice.list'?[]:action==='session.list'?{items:[],nextCursor:null}:action==='occurrence.list'?(++occurrenceReads===1?[{occurrenceId:'occurrence_one',state:'settled',dueAt:'2026-10-10T09:00:00Z',version:1}]:gate.promise):action==='occurrence.prune'?{pruned:1}:{});t.after(()=>ui.dispose());await ui.ready();await ui.click('任务');await tick();ui.render();
  const checkbox=ui.find(row=>row.type==='input'&&row.props.type==='checkbox'&&row.props.checked===false);assert.ok(checkbox&&!checkbox.props.disabled);checkbox.props.onChange({target:{checked:true}});ui.render();await ui.click('清理所选历史');const accepted=enabledButton(ui,'确认清理所选记录').props.onClick();await until(()=>occurrenceReads===2);ui.render();await ui.click('Bots');gate.reject(Object.assign(Error('History after leaving Tasks'),{code:'history_failure'}));await accepted;await ui.settle();noAlert(ui);assert.equal(ui.calls.filter(row=>row.payload.action==='occurrence.prune').length,1);assert.equal(ui.find(row=>row.type==='h2'&&ui.text(row)==='待查回的原始操作'),null);
});

for(const action of ['memory.import.preview','material.search','memory.context.preview']) for(const destination of ['bot_other',action==='material.search'?'长期记忆':'资料']) test(`${action} selection change invalidates failure before child effect cleanup for ${destination}`,async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});const ui=browser(snapshot,query=>query===action?gate.promise:{});t.after(()=>ui.dispose());let pending;
  if(action==='material.search')await materials(ui);else await memories(ui);
  if(action==='memory.import.preview'){pending=startFile(ui,'导入 JSON 文件',upload('a.json',importText('A')));await until(()=>ui.calls.some(row=>row.payload.action===action));}
  else await ui.submit(action==='material.search'?'搜索资料':'查看上下文预览',{query:'A'});
  if(destination==='bot_other'){const selector=ui.find(row=>row.props['aria-label']==='所属 Bot');assert.ok(!selector.props.disabled);selector.props.onChange({target:{value:destination}});}else enabledButton(ui,destination).props.onClick();
  gate.reject(Object.assign(Error('Failure before effect cleanup'),{code:'precleanup_failure'}));if(pending)await pending;await ui.settle();noAlert(ui);
});

test('import file read is invalidated at Bot selection before effect cleanup',async t=>{
  const gate=deferred(),snapshot=defaultSnapshot();snapshot.bots.push({...structuredClone(bot),botId:'bot_other',name:'Other'});const ui=browser(snapshot);t.after(()=>ui.dispose());await memories(ui);const pending=startFile(ui,'导入 JSON 文件',upload('a.json',importText('A'),()=>gate.promise));const selector=ui.find(row=>row.props['aria-label']==='所属 Bot');assert.ok(!selector.props.disabled);selector.props.onChange({target:{value:'bot_other'}});gate.reject(Error('Read before cleanup'));await pending;ui.render();noAlert(ui);
});

for(const fail of [false,true]) test(`accepted clipboard copy ${fail?'failure':'completion'} cannot publish into a newer diagnostic selection`,async t=>{
  const gate=deferred(),ui=browser(defaultSnapshot(),action=>{if(action==='bot.update')throw Error('Unconfirmed operation');return action==='diagnostics.read'?{formatVersion:1,operationIds:['selected']}:action==='session.list'?{items:[],nextCursor:null}:{};},{clipboard:()=>gate.promise});t.after(()=>ui.dispose());await ui.ready();await ui.click('暂停');await ui.click('管理');await ui.click('会话管理');await tick();ui.render();
  const operationId=ui.calls.find(row=>row.payload.action==='bot.update').payload.operationId;ui.find(row=>row.props['aria-label']==='附带的原始操作（可多选）').props.onChange({target:{selectedOptions:[{value:operationId}]}});ui.render();await ui.click('预览诊断');const priorError=ui.text(ui.find(row=>row.props.role==='alert')),copy=enabledButton(ui,'复制以上诊断').props.onClick();ui.render();ui.find(row=>row.props['aria-label']==='附带的原始操作（可多选）').props.onChange({target:{selectedOptions:[]}});ui.render();
  if(fail)gate.reject(Error('Late clipboard failure'));else gate.resolve();await copy;await ui.settle();assert.equal(ui.text(ui.find(row=>row.props.role==='alert')),priorError);assert.equal(ui.find(row=>row.props.role==='status'&&ui.text(row)==='已复制诊断。'),null);if(!fail){assert.equal(ui.copied.length,1);assert.ok(ui.copied[0].includes('selected'));}
});

test('closing a reader invalidates its page failure before effect cleanup',async t=>{
  const gate=deferred(),ui=browser(materialSnapshot(),action=>action==='material.page'?gate.promise:{});t.after(()=>ui.dispose());await materials(ui);await ui.click('打开正文');enabledButton(ui,'关闭正文').props.onClick();gate.reject(Object.assign(Error('Reader closed before cleanup'),{code:'page_failure'}));await ui.settle();noAlert(ui);
});

for(const sourceReference of [false,true]) test(`selecting another ${sourceReference?'memory source':'material'} invalidates the old page error before effect cleanup`,async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1,source:{kind:'material',docId:'doc_A',chunkId:'chunk_A'}},{memoryId:'memory_B',botId:bot.botId,text:'Memory B',category:'fact',version:1,source:{kind:'material',docId:'doc_B',chunkId:'chunk_B'}}];
  const ui=browser(snapshot,(action,input)=>action==='material.page'?(input.docId==='doc_A'?gate.promise:{title:'Material B',text:'New document'}):{});t.after(()=>ui.dispose());if(sourceReference)await memories(ui);else await materials(ui);await ui.click(sourceReference?'查看资料来源':'打开正文');
  const article=ui.find(row=>row.type==='article'&&(sourceReference?row.children.some(child=>child?.type==='p'&&ui.text(child)==='Memory B'):row.children.some(child=>child?.type==='h3'&&ui.text(child)==='Material B'))),select=article.children.find(row=>row?.type==='div'&&row.props.className==='actions')?.children.find(row=>row?.type==='button'&&ui.text(row)==='查看资料来源')??article.children.find(row=>row?.type==='button'&&ui.text(row)==='打开正文');assert.ok(select&&!select.props.disabled);select.props.onClick();
  gate.reject(Object.assign(Error('Former document after selection'),{code:'reader_selection_failure'}));await ui.settle();noAlert(ui);await until(()=>{ui.render();return ui.find(row=>row.type==='pre'&&ui.text(row)==='New document');});
});

test('section change closes a pending memory source and reopening the same source starts a fresh read',async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1,source:{kind:'material',docId:'doc_A',chunkId:'chunk_A'}}];let reads=0;
  const ui=browser(snapshot,action=>action==='material.page'?(++reads===1?gate.promise:{title:'Material A',text:'Recovered source body'}):{});t.after(()=>ui.dispose());await memories(ui);await ui.click('查看资料来源');assert.equal(reads,1);await ui.click('资料');const closedDuringMaterials=ui.find(row=>row.type==='button'&&ui.text(row)==='关闭正文')===null;
  gate.resolve({title:'Material A',text:'Obsolete source body'});await ui.settle();await ui.click('长期记忆');await ui.click('查看资料来源');await ui.settle();
  assert.ok(ui.find(row=>row.type==='pre'&&ui.text(row)==='Recovered source body'),'same source must load again after section navigation');assert.equal(reads,2);assert.equal(closedDuringMaterials,true,'section navigation must close its former memory source reader');assert.equal(ui.find(row=>row.type==='pre'&&ui.text(row)==='Obsolete source body'),null);noAlert(ui);
});

test('section change closes a memory source before cleanup and suppresses its late failure',async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1,source:{kind:'material',docId:'doc_A',chunkId:'chunk_A'}}];
  const ui=browser(snapshot,action=>action==='material.page'?gate.promise:{});t.after(()=>ui.dispose());await memories(ui);await ui.click('查看资料来源');enabledButton(ui,'资料').props.onClick();
  gate.reject(Object.assign(Error('Source failure between selection and cleanup'),{code:'source_section_failure'}));await ui.settle();noAlert(ui);assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='关闭正文'),null,'source reader must close for the new section');await ui.click('长期记忆');assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='关闭正文'),null);
});

test('repeating the current memory section and same source preserves its pending read',async t=>{
  const gate=deferred(),snapshot=materialSnapshot();snapshot.memories=[{memoryId:'memory_A',botId:bot.botId,text:'Memory A',category:'fact',version:1,source:{kind:'material',docId:'doc_A',chunkId:'chunk_A'}}];
  const ui=browser(snapshot,action=>action==='material.page'?gate.promise:{});t.after(()=>ui.dispose());await memories(ui);await ui.click('查看资料来源');await ui.click('长期记忆');await ui.click('查看资料来源');assert.equal(ui.calls.filter(row=>row.payload.action==='material.page').length,1);
  gate.resolve({title:'Material A',text:'Still current source body'});await ui.settle();assert.ok(ui.find(row=>row.type==='pre'&&ui.text(row)==='Still current source body'));noAlert(ui);
});

for(const retain of [false,true]) test(`catalog refresh preserves ${retain?'retained':'new pending'} original operations accepted while catalog is pending`,async t=>{
  const gate=deferred();let holdCatalog=false;
  const ui=browser(defaultSnapshot(),action=>{if(action==='bot.update')throw Object.assign(Error('Unconfirmed write'),{code:'connection'});return {};},{catalog:()=>holdCatalog?gate.promise:catalog});t.after(()=>ui.dispose());await ui.ready();
  if(retain)await ui.click('暂停');
  holdCatalog=true;const refreshing=enabledButton(ui,'refresh').props.onClick();await tick();ui.render();
  if(retain)await ui.click('保留并收起');else await ui.click('暂停');
  const operation=ui.calls.find(row=>row.payload.action==='bot.update').payload;
  assert.ok(ui.find(row=>row.type==='small'&&ui.text(row).includes(operation.operationId)));
  gate.resolve(catalog);await refreshing;await ui.settle();
  assert.ok(ui.find(row=>row.type==='small'&&ui.text(row).includes(operation.operationId)),'live original operation remains visible after the delayed catalog');
  assert.ok(ui.find(row=>row.type==='button'&&ui.text(row)==='用原 ID 接续'));
  if(retain){assert.ok(ui.find(row=>row.type==='summary'&&ui.text(row)==='保留的原始操作'));assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='保留并收起'),null);}
});

