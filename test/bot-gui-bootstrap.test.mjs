import test from 'node:test';
import assert from 'node:assert/strict';
let registration;
const oldWindow=globalThis.window;
globalThis.window={__ModuleLoader__:{load:value=>{registration=value;}}};
try {await import('../src/client/client.js?fixture=gui-bootstrap');} finally {globalThis.window=oldWindow;}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('initial owner panel is selected after a delayed main slot registration',async()=>{
  const plugin=registration.factory(name=>{assert.equal(name,'react');return {createElement(){}};});
  let mainReady,registered=false,rootSources;const selections=[],scopes=new Map();
  const ctx={effect:fn=>fn(),locale:{register:()=>()=>{},bind:()=>key=>key},
    connection:{state:{},generation:{},rpc:{call(){throw Error('no browser calls before mount');}}},
    layout:{selectPanel(id){assert.equal(registered,true,'main slot must exist before selection');selections.push(id);}},
    slots:{provideRoot(value){rootSources=value;},installScope(name,adapter){scopes.set(name,adapter);},inject(name,fn){if(name==='main'){mainReady=fn;return()=>{};}return()=>{};},register(){registered=true;return()=>{};}}};
  const priorBoot=globalThis.__DSH_BOOT__;
  globalThis.__DSH_BOOT__={rev:'actual-shaped',entries:[{id:'dsh-bot-gui-surface',url:'plugins/dsh-bot-gui-surface/client.js',rev:'surface'}],batches:[]};
  try{plugin.apply(ctx);}finally{if(priorBoot===undefined)delete globalThis.__DSH_BOOT__;else globalThis.__DSH_BOOT__=priorBoot;}
  await tick();
  assert.deepEqual(rootSources?.hooks.sessions.getSnapshot().byId,{},'stock document title must see an empty ordinary Session UI roster');
  const adapter=scopes.get('session');assert.ok(adapter,'stock renderer needs a truthful absent Session UI binding');
  const absent=adapter.current.getSnapshot();assert.equal(absent.key,undefined);assert.equal(absent.props.sessionId,undefined);assert.equal(absent.hooks.session,undefined);
  assert.equal(adapter.bindingSource(undefined).getSnapshot(),absent);
  assert.throws(()=>adapter.bindingSource({sessionId:'unowned'}));
  assert.equal(adapter.renderArea(absent,{empty:()=>null,children:'unowned'}),null);
  assert.deepEqual(selections,[]);
  mainReady();await tick();
  assert.deepEqual(selections,['dsh-bot']);
});
function fixture({storage=new Map(),server={created:false,lost:false}}={}) {
  let cursor=0;const states=[],effects=[],pending=[],cleanups=[],entries=[],calls=[];
  const react={createElement:(type,props,...children)=>({type,props:props??{},children}),
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=cursor++;states[i]??={current:initial};return states[i];},
    useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{async request(_name,options,fn){if(options.signal?.aborted)throw Error('fixture-aborted');return fn();}}}});
  let plugin;
  try {plugin=registration.factory(name=>{assert.equal(name,'react');return react;});}
  finally {if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;if(previousNav)Object.defineProperty(globalThis,'navigator',previousNav);else delete globalThis.navigator;}
  const receipt=()=>({version:1,operationId:server.operation.operationId,nonce:server.operation.nonce,state:server.unknown?'unknown':'created',botId:'one-bot',sessionId:'one-main',preciseNativeSettlementVerified:false});
  const ctx={effect(fn){const cleanup=fn();cleanups.push(cleanup);return cleanup;},layout:{selectPanel(){}},locale:{register:()=>()=>{},bind:()=>key=>key},
    slots:{provideRoot(){},installScope(){},inject(_name,fn){return ctx.effect(fn);},register(options,component){const entry={options,component};entries.push(entry);return()=>{};}},
    connection:{state:{},generation:{},rpc:{async call(channel,endpoint,frame){calls.push({channel,endpoint,frame});
      if(channel==='/dsh-bot-gui') {
        if(endpoint==='bootstrap') return {ok:true,value:{version:1,status:'ready',ledgerId:'ledger-exact',selectedBotId:server.created?'one-bot':null,contactSessionId:server.created?'one-main':null,modelRequestsEnabled:false,creation:server.operation?receipt():null,nativeGenerationTerminalSupported:false}};
        if(endpoint==='createBot') {assert.equal(server.created,false,'must not send another creation');server.created=true;server.operation=structuredClone(frame);if(server.lost)throw Error('fixture-lost-transport');return {ok:true,value:receipt()};}
        if(endpoint==='reconcileCreate') {assert.equal(frame.operationId,server.operation.operationId);assert.equal(frame.nonce,server.operation.nonce);return {ok:true,value:receipt()};}
      }
      if(channel==='/dsh-bot') return {ok:true,value:{version:1,status:'ready',bot:server.created?[{botId:'one-bot',name:'One Bot',lifecycle:'active',readiness:'registered',epoch:1,revision:1}]:[],task:[]}};
      if(endpoint==='selectedView') return {ok:true,value:{version:1,status:'ready',botId:'one-bot',contact:{sessionId:'one-main',status:'idle',reply:null},work:[],held:0,limit:15,preciseNativeSettlementVerified:false}};
      throw Error('unexpected GUI call');
    }}}};
  plugin.apply(ctx,{guiOwner:true});
  const entry=entries.find(e=>e.options.name==='main'),props=entry.options.inject();
  return {calls,storage,server,render(){cursor=0;const tree=entry.component({t:key=>key,...props,useConnection:select=>select('connected'),useGeneration:select=>select({id:1})});for(const fn of pending.splice(0))fn();return tree;},
    async settle(){for(let i=0;i<14;i++){this.render();await tick();}return this.render();},
    async dispose(){for(const effect of effects)effect?.cleanup?.();for(const fn of cleanups.reverse())await fn?.();}};
}
function find(tree,key) {if(!tree||typeof tree!=='object')return null;if(Object.hasOwn(tree.props??{},key))return tree;for(const child of tree.children??[]){const found=Array.isArray(child)?child.map(n=>find(n,key)).find(Boolean):find(child,key);if(found)return found;}return null;}
async function submit(f) {let tree=await f.settle();const name=find(tree,'data-dsh-bot-create-name');assert.ok(name,'missing empty-Home create form');name.props.onChange({target:{value:'One Bot'}});tree=f.render();await find(tree,'data-dsh-bot-create-form').props.onSubmit({preventDefault(){}});return f.settle();}

test('authenticated empty Loader GUI creates one Bot, selects it, and shows the launch model gate',async()=>{
  const f=fixture();try {const tree=await submit(f);assert.equal(f.calls.filter(c=>c.endpoint==='createBot').length,1);assert.equal(find(tree,'data-dsh-bot-select').props.value,'one-bot');assert.ok(find(tree,'data-dsh-bot-model-disabled'));assert.equal(find(tree,'data-dsh-bot-goal').props.disabled,true);assert.equal(f.calls.some(c=>c.endpoint==='sendContactText'),false);} finally {await f.dispose();}
});

test('lost GUI create response retains original identity and reload reconciles without another create',async()=>{
  const server={created:false,lost:true},storage=new Map(),first=fixture({server,storage});
  let original;
  try {const tree=await submit(first);assert.equal(find(tree,'data-dsh-bot-create-receipt').props['data-dsh-bot-create-receipt'],'unknown');const raw=storage.get('dsh-bot/gui-create/ledger-exact');assert.ok(raw);original=JSON.parse(raw);assert.equal(original.operationId,server.operation.operationId);assert.equal(original.nonce,server.operation.nonce);} finally {await first.dispose();}
  const resumed=fixture({server,storage});
  try {let tree=await resumed.settle();const button=find(tree,'data-dsh-bot-create-reconcile');assert.ok(button,'unknown original create must remain inspectable after reload');await button.props.onClick();tree=await resumed.settle();assert.equal(resumed.calls.filter(c=>c.endpoint==='createBot').length,0);assert.equal(resumed.calls.filter(c=>c.endpoint==='reconcileCreate').length,1);const retained=JSON.parse(storage.get('dsh-bot/gui-create/ledger-exact'));assert.equal(retained.operationId,original.operationId);assert.equal(retained.nonce,original.nonce);assert.equal(retained.state,'created');assert.equal(find(tree,'data-dsh-bot-select').props.value,'one-bot');} finally {await resumed.dispose();}
});

test('a fresh browser adopts the authenticated Host original create receipt without another create request',async()=>{
 const server={created:true,operation:{operationId:'host-original',nonce:'host-original-nonce'}},f=fixture({server});
 try{const tree=await f.settle(),saved=JSON.parse(f.storage.get('dsh-bot/gui-create/ledger-exact'));
  assert.equal(saved.operationId,server.operation.operationId);assert.equal(saved.nonce,server.operation.nonce);assert.equal(saved.state,'created');
  assert.equal(find(tree,'data-dsh-bot-create-receipt').props['data-dsh-bot-create-receipt'],'created');
  assert.equal(f.calls.filter(call=>call.endpoint==='createBot').length,0);
 }finally{await f.dispose();}
});
test('a fresh browser retains an UNKNOWN Host original and only queries that same operation',async()=>{
 const server={created:false,unknown:true,operation:{operationId:'host-unknown-original',nonce:'host-unknown-nonce'}},f=fixture({server});
 try{let tree=await f.settle();assert.equal(find(tree,'data-dsh-bot-create').props.disabled,true);
  const lookup=find(tree,'data-dsh-bot-create-reconcile');assert.ok(lookup);await lookup.props.onClick();tree=await f.settle();
  assert.equal(find(tree,'data-dsh-bot-create-receipt').props['data-dsh-bot-create-receipt'],'unknown');
  assert.equal(f.calls.filter(call=>call.endpoint==='createBot').length,0);
  assert.deepEqual(f.calls.find(call=>call.endpoint==='reconcileCreate').frame,server.operation);
 }finally{await f.dispose();}
});
test('a conflicting stored creation is never overwritten by Host bootstrap and keeps fresh creation disabled',async()=>{
 const stored={version:1,ledgerId:'ledger-exact',operationId:'browser-original',nonce:'browser-original-nonce',state:'unknown'},raw=JSON.stringify(stored);
 const storage=new Map([['dsh-bot/gui-create/ledger-exact',raw]]),server={created:true,operation:{operationId:'different-host-original',nonce:'different-host-nonce'}},f=fixture({server,storage});
 try{const tree=await f.settle();assert.equal(storage.get('dsh-bot/gui-create/ledger-exact'),raw);
  assert.equal(find(tree,'data-dsh-bot-goal').props.disabled,true);assert.equal(find(tree,'data-dsh-bot-create-form'),null);
  assert.equal(f.calls.some(call=>['createBot','reconcileCreate'].includes(call.endpoint)),false);
 }finally{await f.dispose();}
});
