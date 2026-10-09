import manifest from '../../package.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import {businessFixture} from './business-fixture.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {MemoryController} from '../../src/native/memory.mjs';
import {AssistantController} from '../../src/native/assistant.mjs';
import {BotService} from '../../src/native/service.mjs';

const source=await readFile(new URL('../../src/client/client.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bot={botId:'bot_own',name:'Named identity',role:'Own role',revision:1,memoryRevision:7,lifecycle:'active',contact:{provider:'official',model:'chat'},execution:{provider:'official',model:'work'},executionMode:'inherit',share:{enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:[]}}};
const defaultSnapshot=()=>({storeId:'profile',revision:1,pluginVersion:manifest.version,clientProtocol:2,bots:[structuredClone(bot)],tasks:[],sessions:[],memories:[],materials:[],grants:[],groups:[],meetings:[],outbox:[],attempts:[],notices:[]});
const catalog={providers:[{id:'official',name:'Official',models:[{id:'chat'},{id:'work'}]}],presets:[{id:'default',name:'Default'}],defaultModel:{provider:'official',model:'chat'},defaultCwd:'/workspace'};
function data(values={}) {return {get:key=>values[key]??'',getAll:key=>Array.isArray(values[key])?values[key]:values[key]?[values[key]]:[]};}
function browser(snapshot=defaultSnapshot(),route=()=>({})) {
  const registrations=[],lifecycle=[],calls=[],hooks=new Map(),effects=new Map(),cache=new Map(),copied=[],downloads=[],blobs=[],pendingRpc=new Set(),idleWaiters=new Set();
  let module,active='root',index=0,tree,currentView,unsubscribeView;
  const hookKey=()=>`${active}:${index++}`;
  function render(component,props={},key='root') {const before=[active,index];active=key;index=0;const result=component(props);[active,index]=before;return result;}
  const react={
    createElement(type,props,...children) {return typeof type==='function'?render(type,props??{},`${active}/${type.name}:${props?.key??''}`):{type,props:props??{},children:children.flat(Infinity)};},
    useState(initial) {const key=hookKey();if(!hooks.has(key))hooks.set(key,initial);return [hooks.get(key),next=>hooks.set(key,typeof next==='function'?next(hooks.get(key)):next)];},
    useRef(initial) {const key=hookKey();if(!hooks.has(key))hooks.set(key,{current:initial});return hooks.get(key);},
    useEffect(effect,deps) {const key=hookKey(),prior=effects.get(key);if(prior&&deps?.every((item,i)=>Object.is(item,prior.deps[i])))return;prior?.cleanup?.();effects.set(key,{deps:deps??[],cleanup:effect()});},
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
  const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of node.children??[]){const found=walk(child,predicate);if(found)return found;}return null;};
  const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');
  const find=(predicate)=>walk(tree,predicate);
  const drainRpc=async()=>{while(pendingRpc.size)await Promise.allSettled([...pendingRpc]);};
  const waitIdle=()=>currentView?.busy?new Promise(resolve=>idleWaiters.add(resolve)):Promise.resolve();
  return {snapshot,calls,copied,downloads,blobs,registrations,
    async ready(){await tick();this.render();await tick();this.render();},
    render(slot='main',props={}) {const component=registrations.find(row=>row.options.name===slot)?.component;assert.ok(component);tree=render(component,props,slot);return tree;},
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

test('v1.1 memory drafts keep their original version across snapshots and scoped bot selection',async()=>{
  const snapshot=defaultSnapshot();snapshot.memories=[{memoryId:'memory_first',botId:bot.botId,text:'Original',category:'legacy',version:3,pinned:false,updatedAt:'2026-10-09T01:00:00Z'}];
  const ui=browser(snapshot,()=>undefined);await ui.ready();await ui.click('记忆');await ui.click('编辑记忆');
  snapshot.memories[0]={...snapshot.memories[0],text:'External newer edit',version:4};snapshot.revision++;
  await ui.click('refresh');
  await ui.submit('保存记忆修改',{text:'Local preserved draft',category:'legacy'});
  const request=ui.calls.find(row=>row.payload.action==='memory.write').payload;
  assert.equal(request.input.expectedVersion,3);assert.equal(request.input.botId,bot.botId);assert.equal(request.input.category,'legacy');assert.equal(request.input.text,'Local preserved draft');
  assert.ok(ui.find(row=>row.props?.role==='status'&&ui.text(row).includes('草稿保留')));
  ui.dispose();
});

test('memory import retains digest, preview memory revision and explicit pin overrides until atomic confirmation',async()=>{
  const snapshot=defaultSnapshot(),fileText=JSON.stringify({format:'dsh-bot-memory',formatVersion:1,entries:[{text:'Pinned original',category:'fact',pinned:true}]}),bytes=new TextEncoder().encode(fileText);
  const ui=browser(snapshot,(action)=>action==='memory.import.preview'?{botId:bot.botId,memoryRevision:7,pinCount:9,pinConflict:true,entries:[{index:0,text:'Pinned original',category:'fact',decision:'append',pinned:true,sourceVerification:'external_description'}]}:action==='memory.import'?{addedIds:['new']}:undefined);
  await ui.ready();await ui.click('记忆');await ui.change('导入 JSON 文件',{size:bytes.length,arrayBuffer:async()=>bytes.buffer});
  let confirm=ui.find(row=>row.type==='button'&&ui.text(row)==='确认整批追加');assert.equal(confirm.props.disabled,true);
  const unpin=ui.find(row=>row.type==='input'&&row.props.type==='checkbox'&&row.props.checked===false&&!row.props.name);assert.ok(unpin);unpin.props.onChange({target:{checked:true}});ui.render();
  snapshot.bots[0].memoryRevision=8;snapshot.revision++;await ui.click('refresh');
  await ui.click('确认整批追加');const request=ui.calls.find(row=>row.payload.action==='memory.import').payload;
  assert.equal(request.input.expectedMemoryRevision,7);assert.equal(request.input.fileText,fileText);assert.equal(request.input.fileDigest,Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex'));assert.deepEqual(request.input.unpinnedEntryIndexes,[0]);
  assert.equal(ui.calls.some(row=>['task.start','session.create'].includes(row.payload.action)),false);ui.dispose();
});

test('invalid UTF-8 uploads never submit or truncate material text',async()=>{
  const ui=browser();await ui.ready();await ui.click('记忆');await ui.click('资料');
  await ui.change('UTF-8 文本或 Markdown 文件',{name:'bad.md',size:2,arrayBuffer:async()=>Uint8Array.from([0xc3,0x28]).buffer});
  assert.equal(ui.calls.some(row=>row.payload.action==='material.ingest'),false);
  assert.ok(ui.find(row=>row.props.role==='alert'&&ui.text(row).includes('UTF-8')));ui.dispose();
});

test('template creation preserves top-level draft revision and never wakes a native conversation',async()=>{
  const snapshot=defaultSnapshot(),template={templateId:'personal-assistant',templateVersion:1,name:'个人助理',suggestedName:'个人助理',role:'Assist',roles:[{roleKey:'assistant',botTemplateId:'personal-assistant'}]};
  const ui=browser(snapshot,action=>action==='template.list'?[template]:undefined);await ui.ready();
  snapshot.revision=2;await ui.click('refresh');
  await ui.submit('创建模板 Bot',{'assistant.name':'Chosen identity','assistant.role':'Chosen role','assistant.model':JSON.stringify({provider:'official',model:'chat'})});
  const request=ui.calls.find(row=>row.payload.action==='template.instantiate').payload;
  assert.equal(request.expectedRevision,1);assert.equal(request.input.expectedRevision,undefined);assert.equal(request.input.roles[0].config.name,'Chosen identity');assert.equal(ui.calls.some(row=>row.payload.action==='session.create'),false);ui.dispose();
});

test('chat briefing reads whole Bot scope without replaying tasks, and five primary tabs remain',async()=>{
  const snapshot=defaultSnapshot();snapshot.sessions=[{sessionId:'own_contact',botId:bot.botId,purpose:'contact',state:'ready'}];
  const ui=browser(snapshot,action=>action==='briefing'?{tasks:[],notices:[],unreadCount:0}:undefined);await ui.ready();
  const primary=ui.find(row=>row.type==='nav'&&row.props['aria-label']==='Bot 工作台功能');assert.deepEqual(primary.children.map(ui.text),['Bots','记忆','任务','协作','管理']);
  ui.render('conversation.session.header.utilities',{sessionId:'own_contact'});
  const briefing=ui.find(row=>row.type==='button'&&ui.text(row)==='任务简报');assert.ok(briefing);briefing.props.onClick({currentTarget:{}});
  ui.render('shell.overlay'); // First overlay remains the chooser; locate the briefing seat explicitly below.
  const component=ui.registrations.find(row=>row.options.id==='dsh-bot.briefing').component;component();await tick();
  const request=ui.calls.find(row=>row.payload.action==='briefing').payload;
  assert.deepEqual(request.input,{botId:bot.botId});assert.equal(ui.calls.some(row=>['task.start','session.create'].includes(row.payload.action)),false);ui.dispose();
});

test('diagnostic copy exactly matches the reviewed allowlist response',async()=>{
  const safe={pluginVersion:manifest.version,counts:{bots:1},operationIds:[]};
  const ui=browser(defaultSnapshot(),action=>action==='diagnostics.read'?safe:undefined);await ui.ready();await ui.click('管理');await ui.click('结果与投递');await ui.click('预览诊断');await ui.click('复制以上诊断');
  assert.equal(ui.copied[0],JSON.stringify(safe,null,2));assert.equal(ui.calls.some(row=>row.payload.action==='session.create'),false);ui.dispose();
});

test('owned session rename preserves its draft version without resetting model or preset',async()=>{
  const snapshot=defaultSnapshot();snapshot.sessions=[{sessionId:'contact_owned',botId:bot.botId,purpose:'contact',state:'ready',revision:4,name:'Owned contact',model:{provider:'official',model:'chat',reasoningEffort:'high'}}];
  const ui=browser(snapshot,action=>action==='session.list'?{items:[{sessionId:'contact_owned',botId:bot.botId,purpose:'contact',header:{title:'Owned contact'}}],nextCursor:null}:undefined);
  await ui.ready();await ui.click('管理');await ui.click('会话管理');
  snapshot.sessions[0].revision=5;snapshot.revision++;await ui.click('refresh');
  await ui.submit('保存此会话配置',{name:'Draft rename'});
  const request=ui.calls.find(row=>row.payload.action==='session.configure').payload;
  assert.equal(request.input.expectedVersion,4);assert.equal(request.input.name,'Draft rename');assert.equal(Object.hasOwn(request.input,'model'),false);assert.equal(Object.hasOwn(request.input,'presetId'),false);assert.equal(Object.hasOwn(request.input,'cwd'),false);ui.dispose();
});

test('settled occurrence pruning keeps the versions captured at explicit confirmation',async()=>{
  const snapshot=defaultSnapshot(),schedule={scheduleId:'schedule_one',ownerBotId:bot.botId,kind:'reminder',message:'Reminder',rule:{kind:'once',timezone:'Asia/Shanghai',date:'2026-10-10',time:'09:00'},version:1,enabled:false},occurrence={occurrenceId:'occurrence_settled',scheduleId:'schedule_one',state:'settled',version:3,dueAt:'2026-10-10T01:00:00Z'};
  const ui=browser(snapshot,action=>action==='schedule.list'?[schedule]:action==='occurrence.list'?[occurrence]:action==='notice.list'?[]:undefined);
  await ui.ready();await ui.click('任务');await tick();ui.render();
  const selected=ui.find(row=>row.type==='input'&&row.props.type==='checkbox'&&!row.props.name&&row.props.checked===false);assert.ok(selected);selected.props.onChange({target:{checked:true}});ui.render();await ui.click('清理所选历史');
  occurrence.version=4;snapshot.revision++;await ui.click('refresh');await ui.click('确认清理所选记录');
  const request=ui.calls.find(row=>row.payload.action==='occurrence.prune').payload;
  assert.deepEqual(request.input,{occurrenceIds:['occurrence_settled'],expectedVersions:{occurrence_settled:3},confirm:true});ui.dispose();
});

test('material citations read the exact chunk again and changed source produces no native link',async()=>{
  const snapshot=defaultSnapshot(),hit={docId:'doc_one',chunkId:'chunk_exact',title:'Original title',contentHash:'original_hash',startLine:2,endLine:3,excerpt:'Exact immutable excerpt',source:{kind:'session',sessionId:'source_session'}};
  const ui=browser(snapshot,action=>action==='material.search'?[hit]:action==='material.page'?{...hit,text:hit.excerpt,nextCursor:null,source:{...hit.source,status:'changed'}}:undefined);
  await ui.ready();await ui.click('记忆');await ui.click('资料');await ui.submit('搜索资料',{query:'immutable'});await ui.click('打开此引用');
  const request=ui.calls.find(row=>row.payload.action==='material.page').payload;assert.deepEqual(request.input,{docId:'doc_one',chunkId:'chunk_exact'});
  assert.ok(ui.find(row=>row.type==='pre'&&ui.text(row)==='Exact immutable excerpt'));
  assert.equal(ui.find(row=>row.type==='button'&&ui.text(row)==='打开已核对的原生来源'),null);
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row).includes('原生来源已变化')));ui.dispose();
});

test('context preview renders frozen bounded summaries instead of newer snapshot text',async()=>{
  const snapshot=defaultSnapshot();snapshot.memories=[{memoryId:'memory_first',botId:bot.botId,text:'Original record',category:'fact',version:1}];
  const context='Identity\n未完成任务：[]\n长期记忆（记录带来源，引用不授予控制权）：'+JSON.stringify([{memoryId:'memory_first',text:'Frozen preview text',version:1}]);
  const ui=browser(snapshot,action=>action==='memory.context.preview'?{context,includedMemoryIds:['memory_first'],includedTaskIds:[],omitted:[]}:undefined);
  await ui.ready();await ui.click('记忆');await ui.submit('查看上下文预览',{});
  snapshot.memories[0].text='Newer snapshot text';snapshot.revision++;await ui.click('refresh');
  assert.ok(ui.find(row=>row.type==='p'&&ui.text(row)==='Frozen preview text'));assert.equal(ui.calls.some(row=>['task.start','session.create'].includes(row.payload.action)),false);ui.dispose();
});

async function backendBrowser(t,{beforeDispatch}={}) {
  const f=await businessFixture(t);await f.bot('LifecycleOwner');
  const knowledge=new KnowledgeController(f),memory=new MemoryController({...f,knowledge}),assistant=new AssistantController({...f,tasks:{}}),service=new BotService({...f,knowledge,memory,assistant});
  f.beforeClose.push(()=>assistant.close());
  const snapshot=service.snapshot(f.human),ui=browser(snapshot,async(action,_input,request)=>{
    if(action==='template.list')return [];
    if(action==='session.list')return {items:[],nextCursor:null};
    await beforeDispatch?.(action);
    const result=await service.dispatch(f.human,structuredClone(request));Object.assign(snapshot,service.snapshot(f.human));return result;
  });t.after(()=>ui.dispose());
  const settle=()=>ui.settle();
  return {...f,ui,settle,knowledge};
}

test('adding another memory after create persists a new backend identity and preserves the first text',async t=>{
  const f=await backendBrowser(t);await f.ui.ready();await f.ui.click('记忆');
  await f.ui.submit('保存到所选 Bot',{text:'First independent memory',category:'fact'});await f.settle();
  const first=Object.values(f.store.read().memories)[0];assert.ok(first);
  await f.ui.click('添加另一条记忆');
  assert.ok(f.ui.find(row=>row.type==='form'&&row.children.some(child=>child?.type==='button'&&f.ui.text(child)==='保存到所选 Bot')),'add-another must open a fresh creation draft');
  await f.ui.submit('保存到所选 Bot',{text:'Second independent memory',category:'preference'});await f.settle();
  const records=Object.values(f.store.read().memories);assert.equal(records.length,2);assert.equal(f.store.read().memories[first.memoryId].text,'First independent memory');
  const second=records.find(row=>row.memoryId!==first.memoryId);assert.ok(second);assert.equal(second.text,'Second independent memory');assert.equal(second.category,'preference');assert.equal(second.version,1);
  const writes=f.ui.calls.filter(row=>row.payload.action==='memory.write');assert.equal(writes.length,2);assert.equal(writes[1].payload.input.memoryId,undefined);assert.equal(writes[1].payload.input.expectedVersion,undefined);assert.equal(f.requests.length,0);
});

test('creating another reminder persists a distinct backend schedule and retains the first reminder',async t=>{
  const f=await backendBrowser(t);await f.ui.ready();await f.ui.click('任务');
  const values={ownerBotId:Object.keys(f.store.read().bots)[0],kind:'reminder',ruleKind:'once',timezone:'UTC',date:'2099-10-10',time:'09:00',message:'First reminder',missedPolicy:'skip'};
  await f.ui.submit('确认创建安排',values);await f.settle();const first=Object.values(f.store.read().schedules)[0];assert.ok(first);
  assert.ok(f.ui.find(row=>row.type==='button'&&f.ui.text(row)==='创建新的安排'),'saved schedule must offer a separate new-creation action');
  await f.ui.click('创建新的安排');await f.ui.submit('确认创建安排',{...values,message:'Second reminder'});await f.settle();
  const records=Object.values(f.store.read().schedules);assert.equal(records.length,2);assert.equal(f.store.read().schedules[first.scheduleId].message,'First reminder');const second=records.find(row=>row.scheduleId!==first.scheduleId);assert.ok(second);assert.equal(second.message,'Second reminder');assert.equal(second.version,1);
  const writes=f.ui.calls.filter(row=>['schedule.create','schedule.update'].includes(row.payload.action));assert.deepEqual(writes.map(row=>row.payload.action),['schedule.create','schedule.create']);assert.equal(writes[1].payload.input.scheduleId,undefined);assert.equal(writes[1].payload.input.expectedVersion,undefined);assert.equal(f.requests.length,0);
});

const hashText=text=>createHash('sha256').update(text,'utf8').digest('hex');
const uploadText='# GUI 引用验收\r\n\r\n第一段记录 🧭 Unicode 边界。\r\n\r\n## CITATION_MARKER\r\n准确引用这段原文，保持行号与哈希。\r\n';
for(const [name,original,submitted] of [
  ['textarea LF normalization',uploadText,uploadText.replace(/\r\n/g,'\n')],
  ['FormData CRLF normalization','# Mixed\r\n\r正文 🧭\nCITATION_MARKER\r', '# Mixed\r\n\r\n正文 🧭\r\nCITATION_MARKER\r\n'],
  ['BOM plus mixed CR/LF preservation','\uFEFF# BOM\r\n\rCITATION_MARKER 🧭\nEnd\r','\uFEFF# BOM\n\nCITATION_MARKER 🧭\nEnd\n'],
])test(`untouched uploaded UTF-8 material preserves exact bytes and backend citation offsets through ${name}`,async t=>{
  const f=await backendBrowser(t),bytes=new TextEncoder().encode(original);await f.ui.ready();await f.ui.click('记忆');await f.ui.click('资料');
  await f.ui.change('UTF-8 文本或 Markdown 文件',{name:'v11-citations.md',size:bytes.length,arrayBuffer:async()=>bytes.buffer});
  await f.ui.submit('保存不可变资料',{title:'Exact uploaded material',text:submitted});await f.settle();
  const doc=Object.values(f.store.read().materials)[0];assert.ok(doc);assert.equal(doc.text,original);assert.equal(doc.contentHash,hashText(original));assert.equal(doc.fileName,'v11-citations.md');assert.equal(doc.mediaType,'text/markdown');
  const request=f.ui.calls.find(row=>row.payload.action==='material.ingest').payload;assert.equal(request.input.text,original);
  const hits=f.knowledge.search(f.human,{botId:doc.botId,query:'CITATION_MARKER'});assert.ok(hits.length);for(const hit of hits){assert.equal(hit.contentHash,hashText(original));assert.equal(hit.excerpt,original.slice(hit.startOffset,hit.endOffset));}
  assert.equal(f.requests.length,0);
});

test('genuine uploaded-material edits persist edited text and a new backend hash while retaining filename',async t=>{
  const f=await backendBrowser(t),bytes=new TextEncoder().encode(uploadText),edited=uploadText.replace(/\r\n/g,'\n').replace('准确引用这段原文','用户已改写此正文')+'Edited final line\n';
  await f.ui.ready();await f.ui.click('记忆');await f.ui.click('资料');await f.ui.change('UTF-8 文本或 Markdown 文件',{name:'v11-citations.md',size:bytes.length,arrayBuffer:async()=>bytes.buffer});
  await f.ui.submit('保存不可变资料',{title:'Edited upload',text:edited});await f.settle();
  const doc=Object.values(f.store.read().materials)[0];assert.ok(doc);assert.equal(doc.text,edited);assert.equal(doc.contentHash,hashText(edited));assert.notEqual(doc.contentHash,hashText(uploadText));assert.equal(doc.fileName,'v11-citations.md');
  const request=f.ui.calls.find(row=>row.payload.action==='material.ingest').payload;assert.equal(request.input.text,edited);assert.equal(f.requests.length,0);
});


test('memory import previews the original BOM-prefixed UTF-8 file digest and rejects unsupported BOM JSON',async t=>{
  const f=await backendBrowser(t),fileText='\uFEFF'+JSON.stringify({format:'dsh-bot-memory',formatVersion:1,storeId:'external',botName:'Imported',entries:[{text:'one',category:'fact',pinned:false,provenance:{storeId:'external',protected:false}}]}),bytes=new TextEncoder().encode(fileText);
  await f.ui.ready();await f.ui.click('记忆');await f.ui.change('导入 JSON 文件',{name:'bom-memory.json',size:bytes.length,arrayBuffer:async()=>bytes.buffer});
  const preview=f.ui.calls.find(row=>row.payload.action==='memory.import.preview');assert.ok(preview);assert.equal(preview.payload.input.fileText,fileText);assert.equal(preview.payload.input.fileDigest,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(f.ui.find(row=>row.type==='button'&&f.ui.text(row)==='确认整批追加'),null);assert.equal(Object.keys(f.store.read().memories).length,0);assert.equal(f.requests.length,0);
});

test('UTF-8 material upload accepts exactly 64 KiB and refuses larger files before reading bytes',async t=>{
  const f=await backendBrowser(t),text='x'.repeat(65536),bytes=new TextEncoder().encode(text);await f.ui.ready();await f.ui.click('记忆');await f.ui.click('资料');
  await f.ui.change('UTF-8 文本或 Markdown 文件',{name:'boundary.txt',size:bytes.length,arrayBuffer:async()=>bytes.buffer});await f.ui.submit('保存不可变资料',{title:'64 KiB boundary',text});await f.settle();
  const doc=Object.values(f.store.read().materials)[0];assert.equal(doc.text,text);assert.equal(doc.contentHash,hashText(text));let read=false;
  await f.ui.change('UTF-8 文本或 Markdown 文件',{name:'oversize.txt',size:65537,arrayBuffer:async()=>{read=true;throw Error('Oversize file must never be read');}});
  assert.equal(read,false);assert.equal(f.ui.calls.filter(row=>row.payload.action==='material.ingest').length,1);assert.equal(Object.keys(f.store.read().materials).length,1);assert.equal(f.requests.length,0);
});


test('backend UI settlement waits for the accepted RPC barrier and published idle state',async t=>{
  let enter,release;
  const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  const f=await backendBrowser(t,{beforeDispatch:async action=>{if(action==='memory.write'){enter();await gate;}}});
  await f.ui.ready();await f.ui.click('记忆');await f.ui.submit('保存到所选 Bot',{text:'Held until backend release',category:'fact'});await entered;
  let settled=false;const completion=f.settle().then(()=>settled=true);
  await tick();
  assert.equal(settled,false);assert.equal(Object.keys(f.store.read().memories).length,0);
  assert.ok(f.ui.find(row=>row.type==='button'&&row.props.type==='submit'&&row.props.disabled));
  release();await completion;
  assert.equal(settled,true);assert.equal(Object.values(f.store.read().memories)[0].text,'Held until backend release');
  assert.ok(f.ui.find(row=>row.type==='button'&&row.props.type==='submit'&&!row.props.disabled));assert.equal(f.requests.length,0);
});
