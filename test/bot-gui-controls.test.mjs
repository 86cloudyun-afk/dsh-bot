/** Shipped Loader panel protocol tests with synthetic React/transport; no native/auth/model claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
let registration;
const priorWindow=globalThis.window;
globalThis.window={__ModuleLoader__:{load:value=>{registration=value;}}};
try{await import('../src/client/client.js?fixture=gui-controls');}finally{globalThis.window=priorWindow;}
const settled={local:'returned',remote:'settled',usageKnown:true,usage:{inputTokens:5,outputTokens:3,totalTokens:8},settlementVerified:true};
const unknown={local:'pending',remote:'UNKNOWN',usageKnown:false,usage:null,settlementVerified:false};
const initialWork=()=>({taskId:'original-task',task_id:'original-work',sessionId:'original-work-session',generation:1,goal:'Original work goal',
 completion_condition:'Keep the original session',state:'waiting',held:false,stop:{state:'none'},result:null,generationObservation:settled,preciseNativeSettlementVerified:true});
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function locks(){const tails=new Map();return{async request(key,options,fn){const old=tails.get(key)??Promise.resolve();let release;
 const pending=new Promise(resolve=>{release=resolve;});tails.set(key,pending);try{await old;if(options.signal.aborted)throw Error('synthetic-abort');return await fn();}
 finally{release();if(tails.get(key)===pending)tails.delete(key);}}};}
function fixture({storage=new Map(),server={lifecycle:'active',botEpoch:1,canArchive:true,canRestore:false,canContinue:true,work:initialWork()},lock=locks()}={}){
 let cursor=0,generation=1;const states=[],effects=[],pending=[],entries=[],cleanups=[],calls=[];
 const react={createElement:(type,props,...children)=>({type,props:props??{},children}),
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
  useRef(initial){const i=cursor++;states[i]??={current:initial};return states[i];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:lock}});
 let plugin;try{plugin=registration.factory(name=>{assert.equal(name,'react');return react;});}
 finally{if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;}
 const continuation=(frame,state='accepted')=>({version:1,operationId:frame.operationId,nonce:frame.nonce,botId:'original-bot',taskId:frame.taskId,
  sessionId:frame.sessionId,originalGeneration:frame.generation,generation:frame.generation+1,state,generationObservation:unknown,preciseNativeSettlementVerified:false});
 const lifecycle=frame=>({version:1,operationId:frame.operationId,nonce:frame.nonce,botId:'original-bot',botEpoch:server.botEpoch,lifecycle:server.lifecycle,
  state:'accepted',preciseNativeSettlementVerified:false});
 let responder=async(channel,endpoint,frame)=>{
  if(channel==='/dsh-bot')return{ok:true,value:{version:1,status:'ready',bot:[{botId:'original-bot',name:'Original Bot',lifecycle:server.lifecycle,readiness:'registered',epoch:server.botEpoch,revision:server.botEpoch}],task:[]}};
  if(channel==='/dsh-bot-owner'&&endpoint==='selectedView')return{ok:true,value:{version:1,status:'ready',botId:'original-bot',contact:{sessionId:'original-main',status:'idle',reply:null},
   work:[structuredClone(server.work)],held:server.work.held?1:0,limit:15,preciseNativeSettlementVerified:false}};
  if(channel!=='/dsh-bot-gui')throw Error('unexpected ordinary model/controller operation');
  if(endpoint==='bootstrap')return{ok:true,value:{version:1,status:'ready',ledgerId:'original-ledger',selectedBotId:'original-bot',contactSessionId:'original-main',
   modelRequestsEnabled:server.lifecycle==='active',modelDispatchStatus:server.lifecycle==='active'?'available':'unconfirmed',nativeGenerationTerminalSupported:true,
   creation:{version:1,operationId:'original-create',nonce:'original-create-nonce',state:'created',botId:'original-bot',sessionId:'original-main',preciseNativeSettlementVerified:false},
   controls:{version:1,botId:'original-bot',botEpoch:server.botEpoch,lifecycle:server.lifecycle,canArchive:server.canArchive,canRestore:server.canRestore,
    work:[{taskId:server.work.taskId,sessionId:server.work.sessionId,generation:server.work.generation,canContinue:server.canContinue}]}}};
  if(endpoint==='continueWork'){server.continuation=structuredClone(frame);if(server.loseContinue)throw Error('synthetic lost continuation');server.canContinue=false;
   server.work={...server.work,generation:frame.generation+1,held:true,state:'running',generationObservation:unknown,preciseNativeSettlementVerified:false};return{ok:true,value:continuation(frame)};}
  if(endpoint==='inspectWorkContinuation'){assert.deepEqual(frame,server.continuation);return{ok:true,value:continuation(frame)};}
  if(endpoint==='archiveBot'||endpoint==='restoreBot'){server.lifecycle=endpoint==='archiveBot'?'archived':'active';server.botEpoch++;server.canArchive=server.lifecycle==='active';server.canRestore=server.lifecycle==='archived';
   server.lifecycleOperation=structuredClone(frame);if(server.loseLifecycle)throw Error('synthetic lost lifecycle');return{ok:true,value:lifecycle(frame)};}
  if(endpoint==='inspectBotLifecycle'){assert.deepEqual(frame,{operationId:server.lifecycleOperation.operationId,nonce:server.lifecycleOperation.nonce,botId:'original-bot'});return{ok:true,value:lifecycle(frame)};}
  throw Error('unexpected GUI endpoint');
 };
 const ctx={effect(fn){const cleanup=fn();cleanups.push(cleanup);return cleanup;},locale:{register:()=>()=>{},bind:()=>key=>key},layout:{selectPanel(){}},
  slots:{provideRoot(){},installScope(){},inject(_name,fn){return ctx.effect(fn);},register(options,component){entries.push({options,component});return()=>{};}},
  connection:{state:{},generation:{},rpc:{call(channel,endpoint,frame,signal){calls.push({channel,endpoint,frame,signal});return responder(channel,endpoint,frame,signal);}}}};
 plugin.apply(ctx,{guiOwner:true});const entry=entries.find(e=>e.options.name==='main'),props=entry.options.inject();
 return{server,storage,calls,setResponder:fn=>{const original=responder;responder=(...args)=>fn(original,...args);},setGeneration:id=>{generation=id;},
  render(){cursor=0;const tree=entry.component({t:key=>key,...props,useConnection:fn=>fn('connected'),useGeneration:fn=>fn({id:generation})});for(const fn of pending.splice(0))fn();return tree;},
  async settle(){for(let i=0;i<14;i++){this.render();await tick();}return this.render();},
  async dispose(){for(const effect of effects)effect?.cleanup?.();for(const cleanup of cleanups.reverse())await cleanup?.();}};
}
function find(tree,key){if(!tree||typeof tree!=='object')return null;if(Object.hasOwn(tree.props??{},key))return tree;
 for(const child of tree.children??[]){const found=Array.isArray(child)?child.map(n=>find(n,key)).find(Boolean):find(child,key);if(found)return found;}return null;}

test('verified original work continues through the private GUI channel with the exact task, session and generation',async()=>{
 const f=fixture();try{let tree=await f.settle(),button=find(tree,'data-dsh-bot-work-continue');assert.ok(button,'missing same-session work continuation');assert.equal(button.props.disabled,false);
  await button.props.onClick();tree=await f.settle();const calls=f.calls.filter(c=>c.endpoint==='continueWork');assert.equal(calls.length,1);assert.equal(calls[0].channel,'/dsh-bot-gui');
  assert.deepEqual(Object.keys(calls[0].frame).sort(),['botId','generation','nonce','operationId','sessionId','taskId']);
  assert.equal(calls[0].frame.taskId,'original-task');assert.equal(calls[0].frame.sessionId,'original-work-session');assert.equal(calls[0].frame.generation,1);
  assert.equal(find(tree,'data-dsh-bot-work-continue').props.disabled,true);assert.match(JSON.stringify(tree),/retained/);
  assert.doesNotMatch([...f.storage.values()].join(''),/generationObservation|settlementVerified|usageKnown|delegateTool|parentSource/);
 }finally{await f.dispose();}
});
test('UNKNOWN work and a missing private continuation capability cannot allocate an operation or RPC',async()=>{
 for(const mode of ['unknown','missing']){const f=fixture();if(mode==='unknown')f.server.work={...f.server.work,held:true,state:'unknown',generationObservation:{...unknown,local:'returned'},preciseNativeSettlementVerified:false};else f.server.canContinue=false;
  try{const tree=await f.settle(),button=find(tree,'data-dsh-bot-work-continue');assert.ok(button);assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(f.calls.filter(c=>c.endpoint==='continueWork').length,0);
   assert.equal([...f.storage.keys()].some(key=>key.startsWith('dsh-bot/gui-controls/')),false);
  }finally{await f.dispose();}}
});
test('a lost work continuation response remains its original lookup across a fresh panel',async()=>{
 const storage=new Map(),server={lifecycle:'active',botEpoch:1,canArchive:true,canRestore:false,canContinue:true,work:initialWork(),loseContinue:true};
 const first=fixture({storage,server});let original;
 try{let tree=await first.settle();await find(tree,'data-dsh-bot-work-continue').props.onClick();tree=await first.settle();original=server.continuation;assert.ok(original);
  assert.equal(find(tree,'data-dsh-bot-work-continue').children[0],'reconcile');
 }finally{await first.dispose();}
 const next=fixture({storage,server});try{let tree=await next.settle();await find(tree,'data-dsh-bot-work-continue').props.onClick();tree=await next.settle();
  assert.equal(next.calls.filter(c=>c.endpoint==='continueWork').length,0);assert.deepEqual(next.calls.find(c=>c.endpoint==='inspectWorkContinuation').frame,original);
  assert.equal(find(tree,'data-dsh-bot-work-continue').props.disabled,true);
 }finally{await next.dispose();}
});
test('Bot archive and restore use original private operations and retain the same main and work IDs',async()=>{
 const f=fixture();try{let tree=await f.settle();const archive=find(tree,'data-dsh-bot-archive');assert.ok(archive,'missing native Bot archive');assert.equal(archive.props.disabled,false);
  await archive.props.onClick();tree=await f.settle();assert.equal(find(tree,'data-dsh-bot-goal').props.disabled,true);assert.equal(find(tree,'data-dsh-bot-restore').props.disabled,false);
  const archived=f.calls.find(c=>c.endpoint==='archiveBot');assert.equal(archived.channel,'/dsh-bot-gui');assert.equal(archived.frame.botEpoch,1);
  await find(tree,'data-dsh-bot-restore').props.onClick();tree=await f.settle();const restored=f.calls.find(c=>c.endpoint==='restoreBot');assert.equal(restored.frame.botEpoch,2);
  assert.notEqual(restored.frame.operationId,archived.frame.operationId);assert.equal(find(tree,'data-dsh-bot-select').props.value,'original-bot');
  assert.equal(f.server.work.sessionId,'original-work-session');assert.equal(f.calls.some(c=>['createBot','reconcileCreate','sendContactText'].includes(c.endpoint)),false);
 }finally{await f.dispose();}
});
test('a lost Bot archive response permits original inspection and blocks restore while its outcome is UNKNOWN',async()=>{
 const f=fixture();f.server.loseLifecycle=true;
 try{let tree=await f.settle();await find(tree,'data-dsh-bot-archive').props.onClick();tree=await f.settle();
  assert.equal(find(tree,'data-dsh-bot-restore').props.disabled,true);const lookup=find(tree,'data-dsh-bot-lifecycle-reconcile');assert.ok(lookup);
  await lookup.props.onClick();tree=await f.settle();assert.equal(f.calls.filter(c=>c.endpoint==='archiveBot').length,1);assert.equal(f.calls.filter(c=>c.endpoint==='inspectBotLifecycle').length,1);
  assert.equal(find(tree,'data-dsh-bot-restore').props.disabled,false);
 }finally{await f.dispose();}
});

test('another session in a continuation reply is retained UNKNOWN and can only inspect the exact original',async()=>{
 const f=fixture();f.setResponder(async(original,channel,endpoint,frame,signal)=>{const result=await original(channel,endpoint,frame,signal);
  if(endpoint==='continueWork')return{ok:true,value:{...result.value,sessionId:'replacement-session'}};return result;});
 try{let tree=await f.settle();await find(tree,'data-dsh-bot-work-continue').props.onClick();tree=await f.settle();
  const op=f.server.continuation;assert.equal(find(tree,'data-dsh-bot-work-continuation').props['data-dsh-bot-work-continuation'],'unknown');
  await find(tree,'data-dsh-bot-work-continue').props.onClick();await f.settle();
  assert.equal(f.calls.filter(c=>c.endpoint==='continueWork').length,1);assert.deepEqual(f.calls.find(c=>c.endpoint==='inspectWorkContinuation').frame,op);
  assert.doesNotMatch([...f.storage.values()].join(''),/replacement-session/);
 }finally{await f.dispose();}
});
test('connection replacement suppresses a late continuation while retaining the same original operation',async()=>{
 const f=fixture();let finish;
 f.setResponder(async(original,channel,endpoint,frame,signal)=>{const result=await original(channel,endpoint,frame,signal);
  if(endpoint==='continueWork')return new Promise(resolve=>{finish=()=>resolve(result);});return result;});
 try{let tree=await f.settle();const pending=find(tree,'data-dsh-bot-work-continue').props.onClick();await tick();assert.equal(typeof finish,'function');
  const op=f.server.continuation;f.setGeneration(2);await f.settle();finish();await pending;tree=await f.settle();
  assert.equal(find(tree,'data-dsh-bot-work-continuation').props['data-dsh-bot-work-continuation'],'unknown');
  await find(tree,'data-dsh-bot-work-continue').props.onClick();await f.settle();
  assert.equal(f.calls.filter(c=>c.endpoint==='continueWork').length,1);assert.deepEqual(f.calls.find(c=>c.endpoint==='inspectWorkContinuation').frame,op);
 }finally{await f.dispose();}
});
