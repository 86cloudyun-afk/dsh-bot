import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const module = await import('../../src/client/bot-space.js').catch(()=>({}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bot=id=>({botId:id,name:'同名 Bot',role:`职责 ${id}`,lifecycle:'active',contact:{provider:'local',model:'controlled'}});
const contact=(id,botId)=>({sessionId:id,botId,purpose:'contact',state:'ready',name:`历史 ${id}`,archived:false});
const sdkQuestionsSource=await readFile(new URL('../../node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js',import.meta.url),'utf8');
const sdkQuestionsStart=sdkQuestionsSource.indexOf('function settlePendingComposer('),sdkQuestionsEnd=sdkQuestionsSource.indexOf('//#endregion',sdkQuestionsStart);
assert.ok(sdkQuestionsStart>0&&sdkQuestionsEnd>sdkQuestionsStart,'installed official question contract region exists');
const sdkQuestions=vm.runInNewContext(sdkQuestionsSource.slice(sdkQuestionsStart,sdkQuestionsEnd)+';({PendingQuestion,createWaterfallRequest});',{crypto:webcrypto,Uint8Array,Promise,setInterval,clearInterval});
const group=id=>({groupId:id,name:`群 ${id}`,members:[{botId:'a',active:true},{botId:'b',active:true}],coordinatorBotId:'a',messages:[],rounds:[]});
function fixture(){return {storeId:'profile-a',bots:[bot('a'),bot('b')],sessions:[contact('sa','a'),contact('sb','b')],groups:[group('ga'),group('gb')],meetings:[],tasks:[],attempts:[],memories:[],materials:[]};}
function harness({snapshot=fixture(),loading=false,effectOrder='child-first',query,command,retain,onRetain,refreshProjections,status=new Map(),sessionList={byId:{},projectionsBySession:{}}}={}) {
  assert.equal(typeof module.createBotSpace,'function','createBotSpace must implement the dedicated space');
  let view={snapshot,loading,catalog:{defaultModel:{provider:'local',model:'controlled'},providers:[{id:'local',models:[{id:'controlled'}]}]},busy:false,pending:[],error:''};
  let generation={id:'generation-1'};
  let active='root',index=0,tree,seen;
  const hooks=new Map(),effects=new Map(),draftControls=new Map(),queued=[],disposers=[],writes=[],reads=[],leases=[],activated=[],managed=[],opened=[],revealed=[],projectionReads=[],slotShadows=[];let notifications=0,seenControls;
  const key=()=>`${active}:${index++}`;
  const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),
    useState(initial){const k=key();if(!hooks.has(k))hooks.set(k,typeof initial==='function'?initial():initial);return [hooks.get(k),value=>hooks.set(k,typeof value==='function'?value(hooks.get(k)):value)];},
    useRef(initial){const k=key();if(!hooks.has(k))hooks.set(k,{current:initial});return hooks.get(k);},
    useSyncExternalStore(subscribe,get){const k=key();seen.add(k);const old=effects.get(k);if(old?.subscribe!==subscribe){old?.cleanup?.();effects.set(k,{subscribe,cleanup:subscribe(()=>{notifications++;})});}return get();},
    useEffect(fn,deps){const k=key();seen.add(k);const old=effects.get(k);if(old&&deps?.length===old.deps.length&&deps.every((d,i)=>Object.is(d,old.deps[i])))return;queued.push({depth:active.split('/').length,run:()=>{old?.cleanup?.();effects.set(k,{deps:deps??[],cleanup:fn()});}});},
  };
  const ctx={effect:fn=>disposers.push(fn()),userQuestionPanels:{reveal(sessionId,callId){revealed.push({sessionId,callId});for(const p of knownQuestionCards)if(p.sessionId===sessionId&&p.callId===callId&&!p.getSnapshot().closed){status.set(sessionId,{pendingInteraction:p});return true;}return false;}},connection:{generation:{subscribe:()=>()=>{},getSnapshot:()=>generation}},uiSession:{sessionStatus:{subscribe:()=>()=>{},getSnapshot:()=>status}},sessions:{list:{subscribe:()=>()=>{},getSnapshot:()=>sessionList},refreshProjections:id=>{projectionReads.push(id);return refreshProjections?.(id,sessionList)??Promise.resolve();},retain(id,options){if(retain)return retain(id,options);const gate=deferred();const ref={id,ready:gate.promise,releaseCount:0,release(){this.releaseCount++;}};leases.push({id,options,ref,gate});onRetain?.(id,ref);return ref;}},uiConversation:{binding(binding){return {activate:target=>activated.push([binding.id,target])};}}};
  ctx.slots={register(spec,Component){const row={spec,Component,disposed:0};slotShadows.push(row);return()=>{row.disposed++;};}};
  const knownQuestionCards=[...status.values()].map(value=>value.pendingInteraction).filter(p=>p?.kind==='question'||p?.kind==='plan-review');
  const components=module.createBotSpace({React,ctx,useView:()=>view,command:async(action,input)=>{writes.push({action,input:structuredClone(input)});return command?.(action,input,view);},query:async(action,input,isActive)=>{reads.push({action,input});return query?query(action,input,isActive):structuredClone(view.snapshot);},botLabel:b=>`${b.name} · ${b.botId}`,stateName:value=>value,openSession:id=>opened.push(id),onManage:target=>managed.push(target),styles:''});
  function Provider({session,children,empty}){assert.notEqual(session,null,'official SessionProvider accepts reference or undefined, never null');return session?React.createElement('native-provider',{'data-reference':session.id},children):empty();}
  function expand(node,path){if(node==null||node===false)return null;if(typeof node!=='object')return node;if(typeof node.type==='function'){const prior=[active,index];active=`${path}/${node.type.name}:${node.props.key??''}`;index=0;const result=node.type({...node.props,children:node.children});[active,index]=prior;return expand(result,`${path}/${node.type.name}:${node.props.key??''}/output`);}let control;if(['input','textarea','select'].includes(node.type)){seenControls.add(path);if(!draftControls.has(path))draftControls.set(path,{value:node.props.defaultValue??node.children.find(child=>child?.type==='option')?.props.value??''});control=draftControls.get(path);if(node.props.value!==undefined)control.value=node.props.value;}return {...node,control,children:node.children.map((child,i)=>expand(child,`${path}/${child?.props?.key??i}`))};}
  const nativeProps={sessionId:'',useSession:fn=>fn({blank:false,openState:'open'}),useConversation:fn=>fn({activeTargets:new Set(['chat'])}),useSessions:fn=>fn({byId:{}}),renderFactorySlot:(name,props,options)=>React.createElement('native-factory',{'data-factory':name,...props},React.createElement(options.slots.views,{renderSlot:(name,props)=>React.createElement('native-chat',{name,...props})}))};
  const rootProps={SessionProvider:Provider,renderSlot:(name,props)=>React.createElement(name==='dsh.bot-space.interaction'?components.NativeInteraction:components.NativeConversation,{...nativeProps,...props,useSessionStatus:fn=>fn(status)})};
  const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of node.children??[]){const found=walk(child,predicate);if(found)return found;}return null;};
  const all=(node,predicate)=>!node||typeof node!=='object'?[]:[...(predicate(node)?[node]:[]),...(node.children??[]).flatMap(child=>all(child,predicate))];
  const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children??[]).map(text).join('');
  const ui={render(){seen=new Set();seenControls=new Set();tree=expand(React.createElement(components.BotSpace,rootProps),'root');for(const [k,e] of effects)if(!seen.has(k)){e.cleanup?.();effects.delete(k);}while(queued.length){const batch=queued.splice(0);if(effectOrder==='child-first')batch.sort((a,b)=>b.depth-a.depth);for(const effect of batch)effect.run();}seenControls=new Set();tree=expand(React.createElement(components.BotSpace,rootProps),'root');for(const key of draftControls.keys())if(!seenControls.has(key))draftControls.delete(key);return tree;},find:predicate=>walk(tree,predicate),all:predicate=>all(tree,predicate),text,
    async click(label){const node=walk(tree,n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert.ok(node,`missing button ${label}`);assert.ok(!node.props.disabled,`disabled button ${label}`);const result=node.props.onClick?.({currentTarget:{focus(){}}});ui.render();await result;await tick();ui.render();},
    change(label,value){const node=walk(tree,n=>n.props?.['aria-label']===label);assert.ok(node,`missing field ${label}`);node.props.onChange({target:{value,checked:value},currentTarget:{value}});ui.render();},
    enterDraft(label,value){const node=walk(tree,n=>n.props?.['aria-label']===label);assert.ok(node?.control,`missing draft field ${label}`);assert.equal(node.props.value,undefined,'native form draft is uncontrolled');node.control.value=value;},
    async submit(label,values){const node=walk(tree,n=>n.type==='form'&&text(n).includes(label));assert.ok(node,`missing form ${label}`);const form={get:k=>values[k]??'',getAll:k=>values[k]??[]};const event={preventDefault(){},currentTarget:{},formData:form};const old=globalThis.FormData;globalThis.FormData=class{constructor(){return form;}};try{const result=node.props.onSubmit(event);ui.render();await result;await tick();ui.render();}finally{globalThis.FormData=old;}},
    async flush(){await tick();ui.render();await tick();ui.render();},replaceGeneration(next){generation=next;ui.render();},replaceSnapshot(next){view={...view,snapshot:next};ui.render();},dispose(){for(const e of effects.values())e.cleanup?.();effects.clear();for(const fn of disposers)fn?.();},view:()=>view,notifications:()=>notifications,writes,reads,leases,activated,managed,opened,revealed,projectionReads,slotShadows,components};
  ui.render();return ui;
}
function approvalFixture(phase='independent') {
  const snapshot=fixture();snapshot.groups[0].members[0].epoch=5;snapshot.groups[0].rounds={r:{roundId:'r',state:'running',channels:['group-channel']}};
  snapshot.meetings=[{meetingId:'mt',groupId:'ga',epoch:3,phase,topic:'审批议题',participants:[{botId:'a',active:true,memberEpoch:5,sessionId:'independent-channel'}],opinions:{a:{botId:'a',text:'封存推理意见'}},actions:[]}];
  snapshot.sessions.push({sessionId:'group-channel',botId:'a',purpose:'group',state:'ready',lineage:{groupId:'ga',roundId:'r',memberEpoch:5}},
    {sessionId:'independent-channel',botId:'a',purpose:phase==='independent'?'independent':'meeting',state:'ready',lineage:{groupId:'ga',meetingId:'mt',epoch:3,phase,memberEpoch:5}});
  return snapshot;
}
function realQuestion(kind='question',sessionId='group-channel',callId='real-call') {
  const questions=kind==='plan-review'?[{id:'plan',question:'确认实际计划',detail:'实际计划正文',intent:{kind:'plan-review',approve:'确认'},options:[{label:'确认'},{label:'调整'}]}]:[{id:'choice',question:'选择实际方案',options:[{label:'方案一'},{label:'方案二'}]}];
  return new sdkQuestions.PendingQuestion(sessionId,questions,callId);
}

const alert=ui=>ui.text(ui.find(node=>node.props.role==='alert'));
const retry=ui=>ui.find(node=>node.type==='button'&&node.props['data-retry-session-id']==='group-channel');
function continued(kind='question'){
  const pending=realQuestion(kind);pending.attachRpc({answer:async()=>true});pending.setState('continued');return pending;
}

for(const path of ['saved','created'])test(`failed ${path} contact validation keeps the real connection error without another creation`,async t=>{
  let ui;const failure='connection：original snapshot timeout';
  ui=harness({query:()=>{ui.view().error=failure;return undefined;},command:(action,input,view)=>{
    view.snapshot.sessions.push(contact('original-receipt',input.botId));return {state:'ready',sessionId:'original-receipt'};
  }});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');
  await ui.click(path==='saved'?'历史 sa · sa':'开始新对话');
  assert.equal(alert(ui),failure,'a failed read is not evidence of an archived/deleted identity');
  assert.equal(ui.leases.length,0);assert.equal(ui.writes.length,path==='created'?1:0);
  assert.equal(ui.view().snapshot.sessions.some(row=>row.sessionId===(path==='saved'?'sa':'original-receipt')&&row.state==='ready'),true);
  if(path==='created'){await ui.flush();assert.deepEqual(ui.writes,[{action:'session.create',input:{botId:'a'}}]);}
});
for(const path of ['saved','created'])test(`successful ${path} validation still reports the original binding becoming unavailable`,async t=>{
  const remote=fixture();remote.sessions[0].archived=true;
  const ui=harness({query:()=>remote,command:(action,input,view)=>{
    view.snapshot.sessions.push(contact('original-receipt',input.botId));return {state:'ready',sessionId:'original-receipt'};
  }});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click(path==='saved'?'历史 sa · sa':'开始新对话');
  assert.match(alert(ui),path==='saved'?/归档|不可用/:/回执已保存/);assert.equal(ui.leases.length,0);assert.equal(ui.writes.length,path==='created'?1:0);
});

for(const kind of ['question','plan-review'])test(`failed official ${kind} recovery stays retryable in the same group and retains the exact original channel`,async t=>{
  const pending=continued(kind),status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot:approvalFixture('discussion'),status});
  t.after(()=>{ui.dispose();pending.close();});await ui.click('群 ga');
  const failed=ui.leases[0];failed.gate.reject(Error('original recovery timeout'));await ui.flush();
  assert.equal(failed.ref.releaseCount,1);assert.ok(retry(ui),'the failed original reference needs an explicit read-only retry');
  await ui.click('群 ga');assert.equal(ui.leases.length,1,'reselecting never automatically retries');assert.ok(retry(ui));
  const open=ui.find(node=>node.props['data-pending-session-id']==='group-channel');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();
  assert.doesNotMatch(ui.text(ui.find(node=>node.type==='dialog')),/正在打开原生待确认操作/,'failure cannot become an endless spinner');
  assert.ok(ui.find(node=>node.type==='dialog'));const originalKey=pending.key;
  const action=retry(ui).props.onClick;action();action();ui.render();await ui.flush();
  assert.equal(ui.leases.length,2,'one deliberate retry acquires one reference');assert.equal(ui.leases[1].id,'group-channel');
  assert.equal(pending.key,originalKey);assert.equal(status.get('group-channel').pendingInteraction,pending);
  ui.leases[1].gate.resolve({id:'group-channel'});await ui.flush();
  assert.equal(ui.find(node=>node.type==='native-provider').props['data-reference'],'group-channel');assert.equal(retry(ui),null);assert.deepEqual(ui.writes,[]);
  pending.close();await ui.flush();assert.equal(ui.leases[1].ref.releaseCount,1);assert.equal(failed.ref.releaseCount,1);
});

test('a second failed recovery releases its own handle and waits for another deliberate retry',async t=>{
  const pending=continued(),status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot:approvalFixture('discussion'),status});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');ui.leases[0].gate.reject(Error('first failure'));await ui.flush();const action=retry(ui);assert.ok(action);await action.props.onClick();ui.render();await ui.flush();
  ui.leases[1].gate.reject(Error('second failure'));await ui.flush();assert.deepEqual(ui.leases.map(row=>row.ref.releaseCount),[1,1]);assert.equal(ui.leases.length,2);assert.ok(retry(ui));
  ui.change('搜索 Bot 与群','');await ui.flush();assert.equal(ui.leases.length,2,'ordinary renders do not auto retry');assert.deepEqual(ui.writes,[]);
});

for(const invalidate of ['switch','cancel','generation','settled','replace'])test(`a captured recovery retry cannot revive after ${invalidate}`,async t=>{
  const pending=continued(),snapshot=approvalFixture('discussion'),status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot,status});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');ui.leases[0].gate.reject(Error('retryable failure'));await ui.flush();const action=retry(ui);assert.ok(action);const oldRetry=action.props.onClick;
  if(invalidate==='switch')await ui.click('群 gb');
  if(invalidate==='generation')ui.replaceGeneration({id:'generation-2'});
  if(invalidate==='cancel'){const next=structuredClone(snapshot);next.groups[0].rounds.r.state='stopped';ui.replaceSnapshot(next);}
  if(invalidate==='settled'){pending.close();await ui.flush();}
  if(invalidate==='replace'){const replacement=continued();t.after(()=>replacement.close());status.set('group-channel',{pendingInteraction:replacement});ui.render();}
  const before=ui.leases.length;oldRetry();ui.render();await ui.flush();assert.equal(ui.leases.length,before);assert.deepEqual(ui.writes,[]);assert.equal(ui.leases[0].ref.releaseCount,1);
});

for(const transition of ['group','generation','profile','disappear'])test(`interrupted composition does not block the ${transition} composer when compositionend is lost`,async t=>{
  const ui=harness({command:()=>({messageId:'original-message'})});t.after(()=>ui.dispose());await ui.click('群 ga');const old=ui.find(node=>node.props['aria-label']==='群消息');old.props.onCompositionStart();
  if(transition==='group')await ui.click('群 gb');
  if(transition==='generation'){ui.replaceGeneration(null);ui.replaceGeneration({id:'generation-2'});await ui.click('群 gb');}
  if(transition==='profile'){ui.replaceSnapshot({...fixture(),storeId:'profile-b'});await ui.click('群 gb');}
  if(transition==='disappear'){await ui.click('同名 Bot · a');await ui.click('群 ga');}
  ui.change('群消息','new Latin draft');await ui.click('发送消息');assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].input.groupId,transition==='disappear'?'ga':'gb');
});

for(const transition of ['group','generation','disappear'])test(`late ${transition} composition events cannot end a new active IME or send the previous draft`,async t=>{
  const ui=harness({command:()=>({messageId:'original-message'})});t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','old draft');const old=ui.find(node=>node.props['aria-label']==='群消息');old.props.onCompositionStart();
  if(transition==='group')await ui.click('群 gb');
  if(transition==='generation'){ui.replaceGeneration(null);ui.replaceGeneration({id:'generation-2'});await ui.click('群 gb');}
  if(transition==='disappear'){await ui.click('同名 Bot · a');await ui.click('群 ga');}
  ui.change('群消息','new composition');const next=ui.find(node=>node.props['aria-label']==='群消息');next.props.onCompositionStart();old.props.onCompositionEnd();
  next.props.onKeyDown({key:'Enter',preventDefault(){throw Error('active IME Enter must stay native');}});await ui.click('发送消息');assert.equal(ui.writes.length,0,'late old compositionend cannot clear current IME');
  next.props.onCompositionEnd();old.props.onCompositionStart();let prevented=false;next.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});await ui.flush();assert.equal(prevented,true);assert.equal(ui.writes.length,1,'late old compositionstart cannot block the current composer');
  old.props.onKeyDown({key:'Enter',preventDefault(){}});await ui.flush();assert.equal(ui.writes.length,1,'old keydown cannot send any previous draft');
});

test('native IME flags still guard Enter even before compositionstart arrives',async t=>{
  const ui=harness({command:()=>({messageId:'original-message'})});t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','real IME draft');const field=ui.find(node=>node.props['aria-label']==='群消息');
  for(const flags of [{nativeEvent:{isComposing:true}},{isComposing:true},{keyCode:229}])field.props.onKeyDown({key:'Enter',...flags,preventDefault(){throw Error('real IME Enter must stay native');}});
  assert.deepEqual(ui.writes,[]);
});

test('a retry captured before leaving cannot reacquire after returning to the same group',async t=>{
  const pending=continued(),status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot:approvalFixture('discussion'),status});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');ui.leases[0].gate.reject(Error('old scope failure'));await ui.flush();const staleRetry=retry(ui).props.onClick;
  await ui.click('群 gb');await ui.click('群 ga');ui.leases[1].gate.resolve({id:'group-channel'});await ui.flush();
  staleRetry();ui.render();await ui.flush();assert.equal(ui.leases.length,2,'an old failed admission cannot replace the new live reference');assert.equal(ui.leases[1].ref.releaseCount,0);assert.deepEqual(ui.writes,[]);
});

test('a projection-discovered reference failure stays retryable after the actual official carrier appears',async t=>{
  const pending=continued(),status=new Map(),sessionList={byId:{},projectionsBySession:{'group-channel':{values:{userQuestions:{active:[{callId:'real-call',state:'continued'}]}}}}},ui=harness({snapshot:approvalFixture('discussion'),status,sessionList});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');assert.equal(ui.leases.length,1);status.set('group-channel',{pendingInteraction:pending});await ui.flush();assert.equal(ui.leases.length,1,'publishing the actual carrier shares the already-owned channel reference');
  ui.leases[0].gate.reject(Error('projected channel opening failed'));await ui.flush();const open=ui.find(node=>node.props['data-pending-session-id']==='group-channel');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();
  assert.doesNotMatch(ui.text(ui.find(node=>node.type==='dialog')),/正在打开原生待确认操作/);assert.ok(retry(ui));await retry(ui).props.onClick();ui.render();await ui.flush();assert.equal(ui.leases.length,2);assert.equal(ui.leases[1].id,'group-channel');assert.deepEqual(ui.writes,[]);
});

for(const kind of ['question','plan-review'])test(`child-first passive effects preserve synchronous official ${kind} recovery failure and its explicit retry`,async t=>{
  const pending=continued(kind),status=new Map([['group-channel',{pendingInteraction:pending}]]),reference={id:'group-channel',ready:Promise.resolve({id:'group-channel'}),releases:0,release(){this.releases++;}},calls=[];
  const ui=harness({effectOrder:'child-first',snapshot:approvalFixture('discussion'),status,retain(id){calls.push(id);if(calls.length===1)throw Error('original catalog not ready');return reference;}});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');assert.match(alert(ui),/original catalog not ready/,'the parent scope effect must preserve a fresh child failure');assert.ok(retry(ui));assert.deepEqual(calls,['group-channel']);
  await ui.click('群 ga');assert.deepEqual(calls,['group-channel'],'same-group selection does not replay the failed acquisition');
  const open=ui.find(node=>node.props['data-pending-session-id']==='group-channel');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.doesNotMatch(ui.text(ui.find(node=>node.type==='dialog')),/正在打开原生待确认操作/);
  await retry(ui).props.onClick();ui.render();await ui.flush();assert.deepEqual(calls,['group-channel','group-channel']);assert.equal(ui.find(node=>node.type==='native-provider').props['data-reference'],'group-channel');assert.equal(retry(ui),null);assert.deepEqual(ui.writes,[]);
  pending.close();await ui.flush();assert.equal(reference.releases,1);
});

test('child-first scope cleanup removes an old failure while preserving the new group failure',async t=>{
  const first=continued(),second=realQuestion('question','second-channel','second-call');second.attachRpc({answer:async()=>true});second.setState('continued');
  const snapshot=approvalFixture('discussion');snapshot.groups[1].members[1].epoch=7;snapshot.groups[1].rounds={other:{roundId:'other-round',state:'running',channels:['second-channel']}};snapshot.sessions.push({sessionId:'second-channel',botId:'b',purpose:'group',state:'ready',lineage:{groupId:'gb',roundId:'other-round',memberEpoch:7}});
  const status=new Map([['group-channel',{pendingInteraction:first}],['second-channel',{pendingInteraction:second}]]),calls=[],ui=harness({effectOrder:'child-first',snapshot,status,retain(id){calls.push(id);throw Error(`${id} catalog unavailable`);}});t.after(()=>{ui.dispose();first.close();second.close();});
  await ui.click('群 ga');assert.match(alert(ui),/group-channel catalog unavailable/);const staleRetry=retry(ui).props.onClick;
  await ui.click('群 gb');assert.match(alert(ui),/second-channel catalog unavailable/);assert.equal(retry(ui),null,'the old group failure is no longer offered');assert.ok(ui.find(node=>node.props['data-retry-session-id']==='second-channel'));
  staleRetry();ui.render();await ui.flush();assert.deepEqual(calls,['group-channel','second-channel']);assert.deepEqual(ui.writes,[]);
});

test('a projected channel failure before carrier publication transfers to the actual question retry without reacquiring automatically',async t=>{
  const pending=continued(),status=new Map(),sessionList={byId:{},projectionsBySession:{'group-channel':{values:{userQuestions:{active:[{callId:'real-call',state:'continued'}]}}}}},ui=harness({effectOrder:'child-first',snapshot:approvalFixture('discussion'),status,sessionList});t.after(()=>{ui.dispose();pending.close();});
  await ui.click('群 ga');const failed=ui.leases[0];failed.gate.reject(Error('original projected channel failure'));await ui.flush();assert.ok(retry(ui));const projectedRetry=retry(ui).props.onClick;
  status.set('group-channel',{pendingInteraction:pending});await ui.flush();assert.equal(ui.leases.length,1,'publishing a carrier does not replay acquisition after a failure');
  const open=ui.find(node=>node.props['data-pending-session-id']==='group-channel');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.match(ui.text(ui.find(node=>node.type==='dialog')),/original projected channel failure/);assert.doesNotMatch(ui.text(ui.find(node=>node.type==='dialog')),/正在打开原生待确认操作/);assert.ok(retry(ui));
  projectedRetry();ui.render();await ui.flush();assert.equal(ui.leases.length,1,'the projection-only retry admission is retired when the actual carrier appears');
  await retry(ui).props.onClick();ui.render();await ui.flush();assert.equal(ui.leases.length,2);assert.equal(ui.leases[1].id,'group-channel');assert.equal(status.get('group-channel').pendingInteraction,pending);
  ui.leases[1].gate.resolve({id:'group-channel'});await ui.flush();assert.equal(ui.find(node=>node.type==='native-provider').props['data-reference'],'group-channel');pending.close();await ui.flush();assert.deepEqual(ui.leases.map(row=>row.ref.releaseCount),[1,1]);assert.deepEqual(ui.writes,[]);
});

test('a failed channel survives completed Q1 and newly published Q2 while the captured Q1 retry stays inert',async t=>{
  const first=continued(),second=realQuestion('question','group-channel','new-current-call');second.attachRpc({answer:async()=>true});second.setState('continued');const status=new Map([['group-channel',{pendingInteraction:first}]]),ui=harness({effectOrder:'child-first',snapshot:approvalFixture('discussion'),status});t.after(()=>{ui.dispose();first.close();second.close();});
  await ui.click('群 ga');ui.leases[0].gate.reject(Error('original shared channel failure'));await ui.flush();assert.ok(retry(ui));const oldRetry=retry(ui).props.onClick;
  first.close();status.set('group-channel',{pendingInteraction:second});await ui.flush();assert.equal(ui.leases.length,1,'the replacement question requires a deliberate retry of the failed channel');assert.ok(retry(ui),'Q2 inherits an actionable original channel failure');
  oldRetry();ui.render();await ui.flush();assert.equal(ui.leases.length,1,'a captured completed Q1 admission cannot retry for Q2');
  const open=ui.find(node=>node.props['data-pending-session-id']==='group-channel');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.match(ui.text(ui.find(node=>node.type==='dialog')),/original shared channel failure/);assert.doesNotMatch(ui.text(ui.find(node=>node.type==='dialog')),/正在打开原生待确认操作/);
  await retry(ui).props.onClick();ui.render();await ui.flush();assert.equal(ui.leases.length,2);assert.equal(ui.leases[1].id,'group-channel');assert.equal(status.get('group-channel').pendingInteraction,second);assert.notEqual(first.key,second.key);
  ui.leases[1].gate.resolve({id:'group-channel'});await ui.flush();assert.equal(ui.find(node=>node.type==='native-provider').props['data-reference'],'group-channel');second.close();await ui.flush();assert.deepEqual(ui.leases.map(row=>row.ref.releaseCount),[1,1]);assert.deepEqual(ui.writes,[]);
});
