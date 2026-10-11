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
function harness({snapshot=fixture(),loading=false,query,command,retain,onRetain,refreshProjections,status=new Map(),sessionList={byId:{},projectionsBySession:{}}}={}) {
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
    useEffect(fn,deps){const k=key();seen.add(k);const old=effects.get(k);if(old&&deps?.length===old.deps.length&&deps.every((d,i)=>Object.is(d,old.deps[i])))return;queued.push(()=>{old?.cleanup?.();effects.set(k,{deps:deps??[],cleanup:fn()});});},
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
  const ui={render(){seen=new Set();seenControls=new Set();tree=expand(React.createElement(components.BotSpace,rootProps),'root');for(const [k,e] of effects)if(!seen.has(k)){e.cleanup?.();effects.delete(k);}while(queued.length)queued.shift()();seenControls=new Set();tree=expand(React.createElement(components.BotSpace,rootProps),'root');for(const key of draftControls.keys())if(!seenControls.has(key))draftControls.delete(key);return tree;},find:predicate=>walk(tree,predicate),all:predicate=>all(tree,predicate),text,
    async click(label){const node=walk(tree,n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert.ok(node,`missing button ${label}`);assert.ok(!node.props.disabled,`disabled button ${label}`);const result=node.props.onClick?.({currentTarget:{focus(){}}});ui.render();await result;await tick();ui.render();},
    change(label,value){const node=walk(tree,n=>n.props?.['aria-label']===label);assert.ok(node,`missing field ${label}`);node.props.onChange({target:{value,checked:value},currentTarget:{value}});ui.render();},
    enterDraft(label,value){const node=walk(tree,n=>n.props?.['aria-label']===label);assert.ok(node?.control,`missing draft field ${label}`);assert.equal(node.props.value,undefined,'native form draft is uncontrolled');node.control.value=value;},
    async submit(label,values){const node=walk(tree,n=>n.type==='form'&&text(n).includes(label));assert.ok(node,`missing form ${label}`);const form={get:k=>values[k]??'',getAll:k=>values[k]??[]};const event={preventDefault(){},currentTarget:{},formData:form};const old=globalThis.FormData;globalThis.FormData=class{constructor(){return form;}};try{const result=node.props.onSubmit(event);ui.render();await result;await tick();ui.render();}finally{globalThis.FormData=old;}},
    async flush(){await tick();ui.render();await tick();ui.render();},replaceGeneration(next){generation=next;ui.render();},replaceSnapshot(next){view={...view,snapshot:next};ui.render();},dispose(){for(const e of effects.values())e.cleanup?.();effects.clear();for(const fn of disposers)fn?.();},view:()=>view,notifications:()=>notifications,writes,reads,leases,activated,managed,opened,revealed,projectionReads,slotShadows,components};
  ui.render();return ui;
}

test('dedicated panel and session-scoped child coexist with the original workbench in one factory',async()=>{
  let loaded;const React={createElement(){},useState(){},useEffect(){},useRef(){},useSyncExternalStore(){}};
  const source=await readFile(new URL('../../src/client/client.js',import.meta.url),'utf8');vm.runInNewContext(source,{window:{__ModuleLoader__:{load:x=>loaded=x}},AbortController,AbortSignal});
  const rows=[],ctx={locale:{register(){},bind:()=>x=>x},effect(){},slots:{inject:(_s,fn)=>fn(),register:(spec,component)=>rows.push({spec,component})}};
  loaded.factory(()=>React).apply(ctx);
  assert.ok(rows.some(r=>r.spec.key==='dsh-bot'),'old workbench survives');
  const panel=rows.find(r=>r.spec.key==='dsh-bot.space');assert.ok(panel,'dedicated main panel');assert.equal(panel.spec.children['dsh.bot-space.conversation'].scope,'session');
  assert.ok(rows.some(r=>r.spec.name==='dsh.bot-space.conversation'));
  assert.ok(rows.some(r=>r.spec.name==='sidebar.panellist'&&r.spec.id==='dsh-bot.space'));
  assert.equal(rows.filter(r=>r.spec.name==='sidebar.footer.action'&&r.spec.id==='dsh-bot.space').length,0,'one canonical space sidebar entry');
});

function coldSnapshot(){return {bots:[],tasks:[],sessions:[],memories:[],grants:[],groups:[],meetings:[],outbox:[],attempts:[],materials:[],schedules:[],notices:[]};}

test('cold initial space renders the actual unready snapshot with null selection and owner before hydration',async t=>{
  const ui=harness({snapshot:coldSnapshot(),loading:true});t.after(()=>ui.dispose());
  assert.equal(ui.view().snapshot.storeId,undefined);assert.ok(ui.find(n=>n.props.className==='dsh-bot-space'));assert.ok(ui.find(n=>n.props.className==='bs-main'));assert.ok(ui.find(n=>n.props.className==='bs-empty'));assert.equal(ui.find(n=>n.type==='native-provider'),null);assert.equal(ui.leases.length,0);assert.equal(ui.writes.length,0);
  ui.replaceSnapshot(fixture());await ui.flush();await ui.click('同名 Bot · b');await ui.click('历史 sb · sb');assert.equal(ui.leases.length,1);assert.equal(ui.leases[0].id,'sb');assert.equal(ui.find(n=>n.type==='native-provider').props['data-reference'],'sb');assert.equal(ui.find(n=>n.props['data-session-id']==='sa'),null);
});

test('unready reset hides and releases the previous exact session before a later snapshot restores data',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');const prior=ui.leases[0];assert.ok(ui.find(n=>n.type==='native-provider'));
  ui.replaceSnapshot(coldSnapshot());await ui.flush();assert.ok(ui.find(n=>n.props.className==='dsh-bot-space'));assert.equal(ui.find(n=>n.type==='native-provider'),null);assert.equal(prior.ref.releaseCount,1);prior.gate.resolve({id:'sa'});await ui.flush();assert.deepEqual(ui.activated,[]);assert.equal(ui.leases.length,1);
  ui.replaceSnapshot({...fixture(),storeId:'new-profile'});await ui.flush();assert.equal(ui.find(n=>n.type==='native-provider'),null);await ui.click('同名 Bot · b');await ui.click('历史 sb · sb');assert.equal(ui.leases[1].id,'sb');assert.equal(ui.leases[0].ref.releaseCount,1);assert.equal(ui.writes.length,0);
});

test('hot re-apply starts with a null selection and owner while retired references stay retired',async t=>{
  const prior=harness();t.after(()=>prior.dispose());await prior.click('群 ga');prior.change('群消息','previous apply draft');await prior.click('同名 Bot · a');await prior.click('历史 sa · sa');const old=prior.leases[0];prior.dispose();assert.equal(old.ref.releaseCount,1);
  const fresh=harness({snapshot:coldSnapshot(),loading:true});t.after(()=>fresh.dispose());assert.ok(fresh.find(n=>n.props.className==='dsh-bot-space'));assert.equal(fresh.find(n=>n.type==='native-provider'),null);assert.equal(fresh.leases.length,0);old.gate.resolve({id:'sa'});await tick();assert.deepEqual(prior.activated,[]);
  fresh.replaceSnapshot(fixture());await fresh.flush();assert.equal(fresh.find(n=>n.type==='native-provider'),null);await fresh.click('群 ga');assert.equal(fresh.find(n=>n.props['aria-label']==='群消息').props.value,'');await fresh.click('同名 Bot · b');await fresh.click('历史 sb · sb');assert.equal(fresh.leases.length,1);assert.equal(fresh.leases[0].id,'sb');assert.notEqual(fresh.leases[0].ref,old.ref);assert.equal(old.ref.releaseCount,1);assert.equal(fresh.writes.length,0);assert.equal(prior.writes.length,0);
});

test('browsing same-name Bots never writes; selecting owned history embeds the exact reference and official factory',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('同名 Bot · a');assert.equal(ui.writes.length,0);assert.equal(ui.leases.length,0);
  assert.ok(ui.find(n=>n.props['data-session-id']==='sa'));assert.equal(ui.find(n=>n.props['data-session-id']==='sb'),null);
  await ui.click('历史 sa · sa');assert.deepEqual(ui.leases.map(l=>l.id),['sa']);assert.equal(ui.leases[0].options.source,'botSpace');
  assert.equal(ui.find(n=>n.type==='native-provider').props['data-reference'],'sa');assert.equal(ui.find(n=>n.type==='native-factory').props.variant,'embedded');
  assert.equal(ui.find(n=>n.type==='native-chat').props.view,'chat');ui.leases[0].gate.resolve({id:'sa'});await ui.flush();assert.deepEqual(ui.activated,[['sa','chat']]);assert.deepEqual(ui.opened,[]);
});

test('same-name group and meeting authors retain their distinct original Bot labels and missing-author fallback',async t=>{
  const snapshot=fixture();snapshot.groups[0].messages=[
    {messageId:'original-a',producer:{kind:'bot',botId:'a'},text:'A original reply'},
    {messageId:'original-b',producer:{kind:'bot',botId:'b'},text:'B original reply'},
    {messageId:'original-missing',producer:{kind:'bot',botId:'missing-original-bot'},text:'Original missing Bot reply'},
    {messageId:'original-human',producer:{kind:'human'},text:'Original human message'},
  ];snapshot.meetings=[{meetingId:'original-meeting',groupId:'ga',topic:'Original meeting',phase:'discussion',epoch:3,participants:[],opinions:{a:{botId:'a',text:'A original opinion'},b:{botId:'b',text:'B original opinion'},missing:{botId:'missing-original-bot',text:'Missing original opinion'}},discussion:{a:{botId:'a',text:'A original discussion'},b:{botId:'b',text:'B original discussion'},missing:{botId:'missing-original-bot',text:'Missing original discussion'}},decision:null,actions:[]}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');
  const messages=ui.all(n=>n.props.className==='bs-message'),authors=messages.map(article=>ui.text(article.children.find(child=>child?.props?.className==='bs-message-heading').children.find(child=>child?.type==='strong')));
  assert.deepEqual(messages.map(article=>article.props['data-message-id']),snapshot.groups[0].messages.map(message=>message.messageId));assert.deepEqual(authors,['同名 Bot · a','同名 Bot · b','missing-original-bot','你']);
  assert.deepEqual({opinions:ui.all(n=>n.type==='summary'&&ui.text(n).endsWith(' 的意见')).map(ui.text),discussion:ui.all(n=>n.type==='p'&&ui.text(n).endsWith(' original discussion')).map(ui.text)},
    {opinions:['同名 Bot · a 的意见','同名 Bot · b 的意见','missing-original-bot 的意见'],discussion:['同名 Bot · a：A original discussion','同名 Bot · b：B original discussion','missing-original-bot：Missing original discussion']});assert.equal(ui.writes.length,0);assert.equal(ui.leases.length,0);
});

for(const phase of ['cancelled','decision','complete'])test(`${phase} revealed meeting keeps its original decision and action tasks with correct action-entry eligibility`,async t=>{
  const snapshot=fixture();snapshot.meetings=[{meetingId:'original-decision',groupId:'ga',topic:'原始决定议题',phase,epoch:3,revealedEpoch:3,participants:[],opinions:{},discussion:{},decision:{botId:'a',text:'原始已揭示的决定正文'},actions:['original-action-task']}];snapshot.tasks=[{taskId:'original-action-task',botId:'a',title:'已登记的原行动任务',state:'queued',version:7}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');
  assert.match(ui.text(ui.find(n=>n.props['data-meeting-id']==='original-decision')),/原始已揭示的决定正文/);assert.ok(ui.find(n=>n.props['data-task-id']==='original-action-task'));const entry=ui.find(n=>n.type==='button'&&ui.text(n)==='登记行动任务');assert.equal(!!entry,phase!=='cancelled');if(entry){await ui.click('登记行动任务');assert.ok(ui.find(n=>n.type==='dialog'&&n.props['aria-label']==='登记行动任务'));}assert.equal(ui.writes.length,0);
});

test('cancelling an already-open action draft preserves its original fields and prevents dispatch even through the prior submit callback',async t=>{
  const snapshot=fixture();snapshot.meetings=[{meetingId:'draft-meeting',groupId:'ga',topic:'Original topic',phase:'decision',epoch:7,participants:[],opinions:{},discussion:{},decision:{text:'Original decision'},actions:[]}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.click('登记行动任务');
  const values={title:'原行动标题',goal:'原行动目标\n第二段',criteria:'原条件一\n原条件二'};for(const [label,value] of [['任务标题',values.title],['目标',values.goal],['验收条件（每行一项）',values.criteria]])ui.enterDraft(label,value);const before=ui.all(n=>n.props.name&&n.control),priorSubmit=ui.find(n=>n.type==='form'&&ui.text(n).includes('创建行动任务')).props.onSubmit;
  const next=structuredClone(snapshot);next.meetings[0].phase='cancelled';next.meetings[0].revealedEpoch=7;ui.replaceSnapshot(next);await ui.flush();assert.ok(ui.find(n=>n.type==='dialog'&&n.props['aria-label']==='登记行动任务'));
  const after=ui.all(n=>n.props.name&&n.control);for(const field of before){const current=after.find(n=>n.props.name===field.props.name);assert.equal(current.control,field.control,'original keyed form control remains mounted');assert.equal(current.control.value,field.control.value);}const formValues=Object.fromEntries(after.map(n=>[n.props.name,n.control.value]));assert.equal(formValues.title,values.title);assert.equal(formValues.goal,values.goal);assert.equal(formValues.criteria,values.criteria);
  await ui.submit('创建行动任务',formValues);const original=globalThis.FormData;globalThis.FormData=class{constructor(){return {get:key=>formValues[key]??''};}};try{await priorSubmit({preventDefault(){},currentTarget:{}});}finally{globalThis.FormData=original;}await ui.flush();assert.equal(ui.writes.length,0,'cancelled meeting refuses current and prior submit callbacks without dispatch');assert.match(ui.text(ui.render()),/会议已取消，不再接受新行动；原草稿保留。/);assert.equal(ui.find(n=>n.type==='button'&&n.props.type==='submit'&&ui.text(n)==='创建行动任务').props.disabled,true);assert.ok(ui.find(n=>n.type==='dialog'&&n.props['aria-label']==='登记行动任务'));for(const field of ui.all(n=>n.props.name&&n.control))assert.equal(field.control.value,formValues[field.props.name]);
});

test('completed partial group rounds preserve exact missing-member reasons and original management target while clean rounds stay quiet',async t=>{
  const snapshot=fixture();snapshot.groups[0].messages=[{messageId:'real-a-reply',producer:{kind:'bot',botId:'a'},text:'A original completed reply'}];snapshot.groups[0].rounds=[{roundId:'original-partial-round',state:'running',requests:1,maxRequests:12,channels:[],absences:[{botId:'b',reason:'model_opinion_missing'},{reason:'legacy original absence'}]},{roundId:'original-clean-round',state:'complete',requests:2,maxRequests:12,channels:[],absences:[]}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.ok(ui.find(n=>n.props['data-round-id']==='original-partial-round'));
  const completed=structuredClone(snapshot);completed.groups[0].rounds[0].state='complete';ui.replaceSnapshot(completed);await ui.flush();const round=ui.find(n=>n.props['data-round-id']==='original-partial-round');assert.ok(round,'recorded absence remains visible after the real round settles');assert.match(ui.text(round),/同名 Bot · b：model_opinion_missing/);assert.match(ui.text(round),/legacy original absence/);assert.equal(ui.find(n=>n.props['data-round-id']==='original-clean-round'),null);assert.equal(ui.find(n=>n.props['data-message-id']==='real-a-reply').props['data-producer'],'bot');await ui.click('查阅原群轮');assert.deepEqual(ui.managed,[{tab:'groups',groupId:'ga',roundId:'original-partial-round'}]);assert.equal(ui.writes.length,0);assert.equal(ui.leases.length,0);
});

test('late selection and late ready cannot reopen or activate the previous Bot',async t=>{
  const gate=deferred();const ui=harness({query:()=>gate.promise});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');const choosing=ui.click('历史 sa · sa');await tick();await ui.click('同名 Bot · b');gate.resolve(fixture());await choosing;
  assert.equal(ui.leases.length,0);assert.ok(ui.find(n=>n.props['data-session-id']==='sb'));
});

test('references release on switch, profile change and plugin disposal; stale ready stays silent',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');const a=ui.leases[0];await ui.click('同名 Bot · b');assert.equal(a.ref.releaseCount,1);a.gate.resolve({id:'sa'});await ui.flush();assert.deepEqual(ui.activated,[]);
  await ui.click('历史 sb · sb');const b=ui.leases[1];ui.replaceSnapshot({...fixture(),storeId:'profile-b'});await ui.flush();assert.equal(b.ref.releaseCount,1);assert.equal(ui.find(n=>n.type==='native-provider'),null);
  await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');const c=ui.leases[2];ui.dispose();assert.equal(c.ref.releaseCount,1);
});

for(const failure of ['sync','ready'])test(`native ${failure} failure is visible and its reference is released`,async t=>{
  const ref={id:'sa',ready:Promise.reject(Error('open rejected')),count:0,release(){this.count++;}};ref.ready.catch(()=>{});
  const ui=harness({retain:()=>{if(failure==='sync')throw Error('unknown session');return ref;}});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');await ui.flush();assert.match(ui.text(ui.find(n=>n.props.role==='alert')),failure==='sync'?/unknown session/:/open rejected/);if(failure==='ready')assert.equal(ref.count,1);
});

test('explicit new conversation selects only the receipt ID; a late receipt after switching does not select',async t=>{
  const gate=deferred();const ui=harness({command:async(action,input,view)=>{const value=await gate.promise;view.snapshot.sessions.push(contact(value.sessionId,input.botId));return value;}});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');const creating=ui.click('开始新对话');await tick();await ui.click('同名 Bot · b');gate.resolve({state:'ready',sessionId:'receipt-only'});await creating;assert.deepEqual(ui.writes,[{action:'session.create',input:{botId:'a'}}]);assert.equal(ui.leases.length,0);
  const live=harness({command:(action,input,view)=>{view.snapshot.sessions.push(contact('exact-id',input.botId));return {state:'ready',sessionId:'exact-id'};}});t.after(()=>live.dispose());await live.click('同名 Bot · a');await live.click('开始新对话');assert.deepEqual(live.leases.map(l=>l.id),['exact-id']);
});

test('server archival or local deletion while selection is delayed prevents retaining stale history',async t=>{
  const remote=fixture();remote.sessions[0].archived=true;const ui=harness({query:()=>remote});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');assert.equal(ui.leases.length,0);assert.match(ui.text(ui.find(n=>n.props.role==='alert')),/归档|不可用/);
});

test('group drafts stay with the original group and edited submissions survive late success and failure',async t=>{
  const gates=[];const ui=harness({command:()=>{const g=deferred();gates.push(g);return g.promise;}});t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','first');const sending=ui.click('发送消息');await tick();ui.change('群消息','edited');await ui.click('群 gb');ui.change('群消息','other');gates[0].resolve({messageId:'m1'});await sending;assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'other');await ui.click('群 ga');assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'edited');
  const failing=ui.click('发送消息');await tick();gates[1].resolve(undefined);await failing;assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'edited');
  const ok=ui.click('发送消息');await tick();gates[2].resolve({messageId:'m2'});await ok;assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'');assert.equal(ui.writes.length,3);
});

test('IME Enter does not send and group history grows by forty real messages',async t=>{
  const snapshot=fixture();snapshot.groups[0].messages=Array.from({length:95},(_,i)=>({messageId:`m${i}`,producer:{kind:'bot',botId:'a'},text:`真实消息 ${i}`}));const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.all(n=>n.props.className==='bs-message').length,40);await ui.click('显示更早消息');assert.equal(ui.all(n=>n.props.className==='bs-message').length,80);ui.change('群消息','输入法');const field=ui.find(n=>n.props['aria-label']==='群消息');field.props.onCompositionStart();field.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:true},preventDefault(){throw Error('IME should stay native');}});field.props.onCompositionEnd();assert.equal(ui.writes.length,0);
});

test('group context derives task ownership only from meeting actions and seals independent content',async t=>{
  const snapshot=fixture();snapshot.tasks=[{taskId:'private',botId:'a',title:'私人任务',state:'queued',version:1},{taskId:'linked',botId:'a',title:'群行动任务',state:'queued',version:4}];snapshot.meetings=[{meetingId:'mt',groupId:'ga',topic:'实际议题',phase:'independent',epoch:7,participants:[{botId:'a',active:true}],opinions:{a:{text:'密封意见',botId:'a'}},discussion:{a:{text:'过早讨论'}},decision:{text:'过早决定'},actions:['linked']}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.ok(ui.text(ui.render()).includes('群行动任务'));assert.ok(!ui.text(ui.render()).includes('私人任务'));assert.ok(!ui.text(ui.render()).includes('密封意见'));assert.ok(!ui.text(ui.render()).includes('过早讨论'));assert.ok(!ui.text(ui.render()).includes('过早决定'));await ui.click('下一阶段');assert.deepEqual(ui.writes[0],{action:'meeting.advance',input:{meetingId:'mt',epoch:7,phase:'independent'}});await ui.click('取消会议');assert.deepEqual(ui.writes[1],{action:'meeting.cancel',input:{meetingId:'mt',epoch:7}});
});

test('task start and stop preserve real receipt/version/attempt identity and management has exact task target',async t=>{
  const snapshot=fixture();snapshot.tasks=[{taskId:'task',botId:'a',title:'真实工作',state:'queued',version:8,currentAttemptId:'attempt'}];snapshot.attempts=[{attemptId:'attempt',taskId:'task',epoch:3,state:'running',reservationHeld:true,sessionId:'execution'}];const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('停止任务');assert.deepEqual(ui.writes[0],{action:'task.stop',input:{taskId:'task',attemptId:'attempt',epoch:3}});await ui.click('管理任务');assert.deepEqual(ui.managed,[{tab:'tasks',taskId:'task'}]);assert.equal(ui.opened.length,0);
});

test('named group coordinator options contain only selected active members and creation never starts a model',async t=>{
  const ui=harness({command:()=>({groupId:'new-group'})});t.after(()=>ui.dispose());await ui.click('新建群');ui.change('选择成员 a',true);const select=ui.find(n=>n.props['aria-label']==='协调者');assert.deepEqual(select.children.filter(n=>n?.type==='option').map(n=>n.props.value),['a']);await ui.submit('提交创建群',{name:'具名群',coordinator:'a',rounds:'1',requests:'12'});assert.deepEqual(ui.writes,[{action:'group.create',input:{name:'具名群',botIds:['a'],coordinatorBotId:'a',rounds:1,maxRequests:12}}]);
});

test('selecting a second history removes the previous Provider while server validation is pending',async t=>{
  const snapshot=fixture();snapshot.sessions.push(contact('sa2','a'));let gate;const ui=harness({snapshot,query:()=>gate?gate.promise:structuredClone(snapshot)});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');assert.ok(ui.find(n=>n.type==='native-provider'));gate=deferred();const next=ui.click('历史 sa2 · sa2');await tick();assert.equal(ui.find(n=>n.type==='native-provider'),null);assert.equal(ui.leases[0].ref.releaseCount,1);gate.resolve(snapshot);await next;assert.equal(ui.leases[1].id,'sa2');
});

test('reusing the same session id in a new profile never reuses the old reference or draft',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','original profile draft');ui.replaceSnapshot({...fixture(),storeId:'new-profile'});await ui.flush();await ui.click('群 ga');assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'');ui.change('群消息','new profile draft');ui.replaceSnapshot(fixture());await ui.flush();await ui.click('群 ga');assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'original profile draft');
});

test('UNKNOWN group submission preserves its draft and never autonomously resends',async t=>{
  const ui=harness({command:()=>undefined});t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','unknown original');await ui.click('发送消息');await ui.flush();ui.replaceSnapshot(fixture());await ui.flush();assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value,'unknown original');assert.deepEqual(ui.writes,[{action:'group.post',input:{groupId:'ga',text:'unknown original'}}]);
});

test('task registration uses the current Bot and receipt task identity for explicit start',async t=>{
  const ui=harness({command:(action,input,view)=>{if(action==='task.create'){view.snapshot.tasks.push({taskId:'receipt-task',botId:input.botId,title:input.title,state:'queued',version:6});return {taskId:'receipt-task',version:6};}return {attemptId:'actual-attempt'};}});t.after(()=>ui.dispose());await ui.click('同名 Bot · b');await ui.click('新任务');await ui.submit('登记任务',{title:'新工作',goal:'实际目标',criteria:'条件一\n条件二'});assert.deepEqual(ui.writes,[{action:'task.create',input:{botId:'b',title:'新工作',goal:'实际目标',criteria:['条件一','条件二']}}]);await ui.click('开始任务');assert.deepEqual(ui.writes[1],{action:'task.start',input:{taskId:'receipt-task',expectedVersion:6}});
});

test('meeting action conflicts keep captured epoch and draft; success only registers the linked task',async t=>{
  const snapshot=fixture();snapshot.meetings=[{meetingId:'mt',groupId:'ga',topic:'决定',phase:'decision',epoch:3,decision:{text:'真实决定'},actions:[]}];const ui=harness({snapshot,command:()=>undefined});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.click('登记行动任务');const changed=structuredClone(snapshot);changed.meetings[0].epoch=4;ui.replaceSnapshot(changed);await ui.submit('创建行动任务',{botId:'a',title:'原决定行动',goal:'原目标',criteria:'原条件'});assert.deepEqual(ui.writes,[{action:'meeting.action',input:{meetingId:'mt',epoch:3,botId:'a',title:'原决定行动',goal:'原目标',criteria:['原条件']}}]);assert.ok(ui.find(n=>n.type==='dialog'));assert.match(ui.text(ui.find(n=>n.type==='dialog')),/原决定|原.*世代/);
});

test('meeting start keeps original group target and group stop keeps exact round target',async t=>{
  const snapshot=fixture();snapshot.groups[0].rounds={one:{roundId:'round1',state:'running',requests:1,maxRequests:12},other:{roundId:'round2',state:'stopping',requests:1,maxRequests:12}};const ui=harness({snapshot,command:()=>({accepted:true,state:'stopping',settled:false})});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.click('停止此群轮');assert.deepEqual(ui.writes[0],{action:'group.round.stop',input:{groupId:'ga',roundId:'round1'}});await ui.click('发起会议');await ui.click('群 gb');await ui.submit('开始会议',{topic:'原群议题',materials:'共同材料'});assert.deepEqual(ui.writes[1],{action:'meeting.start',input:{groupId:'ga',topic:'原群议题',materials:'共同材料'}});
});

test('long group round status history has its own scroll region so the send action stays available',async t=>{
  const snapshot=fixture();snapshot.groups[0].rounds=Object.fromEntries(Array.from({length:100},(_,i)=>[`r${i}`,{roundId:`r${i}`,state:'stopped',requests:2,maxRequests:12}]));const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.ok(ui.find(n=>n.props.className==='bs-rounds'));assert.equal(ui.all(n=>n.props.className==='bs-round').length,100);assert.ok(ui.find(n=>n.type==='button'&&ui.text(n)==='发送消息'));
});

function approvalFixture(phase='independent') {
  const snapshot=fixture();snapshot.groups[0].members[0].epoch=5;snapshot.groups[0].rounds={r:{roundId:'r',state:'running',channels:['group-channel']}};
  snapshot.meetings=[{meetingId:'mt',groupId:'ga',epoch:3,phase,topic:'审批议题',participants:[{botId:'a',active:true,memberEpoch:5,sessionId:'independent-channel'}],opinions:{a:{botId:'a',text:'封存推理意见'}},actions:[]}];
  snapshot.sessions.push({sessionId:'group-channel',botId:'a',purpose:'group',state:'ready',lineage:{groupId:'ga',roundId:'r',memberEpoch:5}},
    {sessionId:'independent-channel',botId:'a',purpose:phase==='independent'?'independent':'meeting',state:'ready',lineage:{groupId:'ga',meetingId:'mt',epoch:3,phase,memberEpoch:5}});
  return snapshot;
}

test('group and independent approvals are visible without retaining until explicitly opened; native interaction omits history',async t=>{
  const snapshot=approvalFixture(),pending={key:'p',kind:'approval',answerable:true,sessionId:'independent-channel'};
  const status=new Map([['independent-channel',{pendingInteraction:pending}],['group-channel',{pendingInteraction:{key:'g',kind:'approval',answerable:true,sessionId:'group-channel'}}]]);
  const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.leases.length,0);assert.ok(ui.find(n=>n.props['data-pending-session-id']==='independent-channel'));assert.ok(ui.find(n=>n.props['data-pending-session-id']==='group-channel'));
  const node=ui.find(n=>n.type==='button'&&n.props['data-pending-session-id']==='independent-channel');await node.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.equal(ui.leases[0].id,'independent-channel');assert.ok(ui.find(n=>n.type==='native-provider'));assert.ok(ui.find(n=>n.type==='native-factory'));assert.equal(ui.find(n=>n.type==='native-chat'),null);assert.ok(!ui.text(ui.render()).includes('封存推理意见'));
  status.delete('independent-channel');await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,1);
});

for(const invalidate of ['replace','epoch','member','group'])test(`pending ${invalidate} change unmounts the interaction and never exposes a normal composer`,async t=>{
  const snapshot=approvalFixture(),pending={key:'p',kind:'approval',answerable:true,sessionId:'independent-channel'},status=new Map([['independent-channel',{pendingInteraction:pending}]]);const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');const open=ui.find(n=>n.type==='button'&&n.props['data-pending-session-id']==='independent-channel');assert.ok(open);await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();
  if(invalidate==='replace')status.set('independent-channel',{pendingInteraction:{...pending}});
  if(invalidate==='epoch'){const next=structuredClone(snapshot);next.meetings[0].epoch=4;ui.replaceSnapshot(next);}
  if(invalidate==='member'){const next=structuredClone(snapshot);next.groups[0].members[0].epoch=6;ui.replaceSnapshot(next);}
  if(invalidate==='group')await ui.click('群 gb');
  await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,1);ui.leases[0].gate.resolve({id:'independent-channel'});await ui.flush();assert.deepEqual(ui.activated,[]);
});

test('management from a selected group or meeting carries its exact stable target',async t=>{
  const ui=harness({snapshot:approvalFixture()});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.click('管理成员与群设置');await ui.click('管理会议与通道');assert.deepEqual(ui.managed,[{tab:'groups',groupId:'ga'},{tab:'meetings',meetingId:'mt'}]);
});

for(const kind of ['answered','unsupported','settled'])test(`${kind} pending state cannot reveal an execution composer`,async t=>{
  const snapshot=approvalFixture(),pending={key:'p',kind:kind==='unsupported'?'unknown-interaction':'approval',answerable:kind!=='answered',sessionId:'group-channel'},status=new Map([['group-channel',{pendingInteraction:pending}]]);if(kind==='settled')snapshot.sessions.find(row=>row.sessionId==='group-channel').state='settled';const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.find(n=>n.props['data-pending-session-id']==='group-channel'),null);assert.equal(ui.leases.length,0);
});

test('connection generation loss releases the old exact reference and late ready cannot activate it',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');const old=ui.leases[0];ui.replaceGeneration(undefined);await ui.flush();assert.equal(ui.find(n=>n.type==='native-provider'),null);assert.equal(old.ref.releaseCount,1);old.gate.resolve({id:'sa'});await ui.flush();assert.deepEqual(ui.activated,[]);ui.replaceGeneration({id:'generation-2'});await ui.flush();assert.equal(ui.find(n=>n.type==='native-provider'),null);await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');assert.equal(ui.leases[1].id,'sa');
});

test('group composer rejects more than the accepted sixteen thousand characters while preserving draft',async t=>{
  const ui=harness({command:()=>({messageId:'accepted'})});t.after(()=>ui.dispose());await ui.click('群 ga');ui.change('群消息','x'.repeat(16001));assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.maxLength,16000);await ui.click('发送消息');assert.equal(ui.writes.length,0);assert.equal(ui.find(n=>n.props['aria-label']==='群消息').props.value.length,16001);assert.match(ui.text(ui.find(n=>n.props.role==='alert')),/16000/);ui.change('群消息','x'.repeat(16000));await ui.click('发送消息');assert.equal(ui.writes[0].input.text.length,16000);
});

test('cancelled independent opinions remain sealed without matching reveal proof; revealed epochs keep original history',async t=>{
  const snapshot=approvalFixture();snapshot.meetings[0].phase='cancelled';const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.ok(!ui.text(ui.render()).includes('封存推理意见'));assert.match(ui.text(ui.render()),/封存/);const revealed=structuredClone(snapshot);revealed.meetings[0].revealedEpoch=3;ui.replaceSnapshot(revealed);assert.ok(ui.text(ui.render()).includes('封存推理意见'));revealed.meetings[0].epoch=4;ui.replaceSnapshot(structuredClone(revealed));assert.ok(!ui.text(ui.render()).includes('封存推理意见'));
});

test('memory management and UNKNOWN round management keep exact original Bot/group identities',async t=>{
  const snapshot=fixture();snapshot.groups[0].rounds={r:{roundId:'unknown-round',state:'UNKNOWN',requests:1,maxRequests:12}};const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('同名 Bot · b');await ui.click('管理此 Bot');await ui.click('管理记忆与资料');await ui.click('群 ga');await ui.click('查阅原群轮');assert.deepEqual(ui.managed,[{tab:'bots',botId:'b'},{tab:'memory',botId:'b'},{tab:'groups',groupId:'ga',roundId:'unknown-round'}]);
});

test('real workbench management focuses original second Bot card and exact memory owner',async t=>{
  const source=await readFile(new URL('../../src/client/client.js',import.meta.url),'utf8'),continuity=await readFile(new URL('./v120-client-continuity.test.mjs',import.meta.url),'utf8');
  const focusWitnesses=[];
  const browserSource=continuity.slice(continuity.indexOf('function browser('),continuity.indexOf('\nconst original=')).replace('row.options.name===slot||row.options.id===slot',"(slot==='dsh-bot.space'?row.options.name==='main'&&row.options.key===slot:row.options.name===slot||row.options.id===slot)").replace('document:{createElement:',"document:{getElementById:id=>({scrollIntoView(){focusWitnesses.push(['scroll',id]);},focus(){focusWitnesses.push(['focus',id]);}}),createElement:");
  const browser=new Function('source','vm','assert','tick','webcrypto','data','catalog','focusWitnesses',browserSource+';return browser;')(source,vm,assert,tick,webcrypto,values=>({get:key=>values[key]??'',getAll:key=>values[key]??[]}),{providers:[],presets:[]},focusWitnesses);
  const snapshot={...fixture(),revision:1,pluginVersion:'1.3.0',clientProtocol:2,grants:[],outbox:[],notices:[],schedules:[]};snapshot.bots=snapshot.bots.map(row=>({...row,revision:1,memoryRevision:1,execution:row.contact,executionMode:'inherit',share:{enabled:false,receivers:[],scope:{}}}));snapshot.memories=[{memoryId:'ma',botId:'a',text:'A原始记忆',category:'fact',updatedAt:'2026-10-11T00:00:00Z'},{memoryId:'mb',botId:'b',text:'B原始记忆',category:'fact',updatedAt:'2026-10-11T00:00:00Z'}];
  const ui=browser(snapshot);t.after(()=>ui.dispose());await ui.ready();ui.render('dsh-bot.space');await ui.find(n=>n.type==='button'&&n.props['data-bot-id']==='b').props.onClick({currentTarget:{}});ui.render('dsh-bot.space');await ui.find(n=>n.type==='button'&&ui.text(n)==='管理此 Bot').props.onClick({currentTarget:{}});await ui.ready();assert.ok(ui.find(n=>n.props.id==='dsh-resource-b'));assert.ok(focusWitnesses.some(([action,id])=>action==='focus'&&id==='dsh-resource-b'));
  ui.render('dsh-bot.space');await ui.find(n=>n.type==='button'&&n.props['data-bot-id']==='b').props.onClick({currentTarget:{}});ui.render('dsh-bot.space');await ui.find(n=>n.type==='button'&&ui.text(n)==='管理记忆与资料').props.onClick({currentTarget:{}});await ui.ready();const owner=ui.find(n=>n.type==='select'&&n.props['aria-label']==='所属 Bot');assert.ok(owner);assert.equal(owner.props.value,'b');assert.ok(ui.find(n=>n.type==='p'&&ui.text(n)==='B原始记忆'));assert.equal(ui.find(n=>n.type==='p'&&ui.text(n)==='A原始记忆'),null);assert.ok(focusWitnesses.some(([action,id])=>action==='focus'&&id==='dsh-memory-owner'));
});

test('configured private history header displays the original session provider and model together',async t=>{
  const snapshot=fixture();snapshot.sessions[0].model={provider:'different-provider',model:'different-model'};const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');await ui.click('历史 sa · sa');const status=ui.text(ui.find(n=>n.props.className==='bs-status'));assert.match(status,/different-provider \/ different-model/);assert.ok(!status.includes('local / different-model'));
});

for(const kind of ['rail','context'])test(`${kind} drawer Escape closes it and returns focus without consuming normal native Escape`,async t=>{
  const ui=harness();t.after(()=>ui.dispose());let focus=0,prevented=0;const trigger=ui.find(n=>n.type==='button'&&ui.text(n)===(kind==='rail'?'会话':'上下文'));await trigger.props.onClick({currentTarget:{focus(){assert.equal(ui.find(n=>n.props.className==='bs-main').props.inert,false,'return focus after background inert is removed');focus++;}}});ui.render();let root=ui.find(n=>n.props.className==='dsh-bot-space');assert.equal(root.props[kind==='rail'?'data-rail-open':'data-context-open'],'true');assert.equal(typeof root.props.onKeyDown,'function');root.props.onKeyDown({key:'Escape',preventDefault(){prevented++;},stopPropagation(){}});ui.render();root=ui.find(n=>n.props.className==='dsh-bot-space');assert.equal(root.props[kind==='rail'?'data-rail-open':'data-context-open'],'false');assert.equal(focus,1);assert.equal(prevented,1);root.props.onKeyDown({key:'Escape',preventDefault(){prevented++;},stopPropagation(){}});assert.equal(prevented,1);
});

test('space contact toggles use aria-pressed selection semantics on plain buttons',async t=>{
  const ui=harness();t.after(()=>ui.dispose());await ui.click('同名 Bot · a');const selected=ui.find(n=>n.type==='button'&&n.props['data-bot-id']==='a');assert.equal(selected.props['aria-pressed'],true);assert.equal(selected.props['aria-selected'],undefined);
});

for(const kind of ['rail','context'])test(`${kind} drawer contains keyboard focus and protects the background`,async t=>{
  const ui=harness();t.after(()=>ui.dispose());const drawer=ui.find(n=>n.props.className===(kind==='rail'?'bs-rail':'bs-context'));let firstFocus=0,lastFocus=0;
  const first={focus(){firstFocus++;}},last={focus(){lastFocus++;}},container={querySelector:()=>first,querySelectorAll:()=>[first,last],contains:node=>node===first||node===last};drawer.props.ref.current=container;
  await ui.find(n=>n.type==='button'&&ui.text(n)===(kind==='rail'?'会话':'上下文')).props.onClick({currentTarget:{focus(){}}});ui.render();assert.equal(firstFocus,1);assert.equal(ui.find(n=>n.props.className==='bs-main').props.inert,true);assert.equal(ui.find(n=>n.props.className===(kind==='rail'?'bs-context':'bs-rail')).props.inert,true);assert.equal(ui.find(n=>n.props.className===(kind==='rail'?'bs-rail':'bs-context')).props['aria-modal'],true);
  const original=globalThis.document;globalThis.document={activeElement:last};try{let prevented=0;ui.find(n=>n.props.className==='dsh-bot-space').props.onKeyDown({key:'Tab',target:last,preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(firstFocus,2);globalThis.document.activeElement=first;ui.find(n=>n.props.className==='dsh-bot-space').props.onKeyDown({key:'Tab',shiftKey:true,target:first,preventDefault(){prevented++;}});assert.equal(lastFocus,1);assert.equal(prevented,2);}finally{globalThis.document=original;}
});

function realQuestion(kind='question',sessionId='group-channel',callId='real-call') {
  const questions=kind==='plan-review'?[{id:'plan',question:'确认实际计划',detail:'实际计划正文',intent:{kind:'plan-review',approve:'确认'},options:[{label:'确认'},{label:'调整'}]}]:[{id:'choice',question:'选择实际方案',options:[{label:'方案一'},{label:'方案二'}]}];
  return new sdkQuestions.PendingQuestion(sessionId,questions,callId);
}

for(const kind of ['question','plan-review'])test(`official ${kind} waterfall carrier is routed without a fabricated answerable property and closes after settlement`,async t=>{
  const pending=realQuestion(kind),request=sdkQuestions.createWaterfallRequest(undefined,undefined,channel=>pending.detachWaterfall(channel));pending.attachWaterfall(request.channel);assert.equal(pending.answerable,undefined);const status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot:approvalFixture('discussion'),status});t.after(()=>ui.dispose());await ui.click('群 ga');const open=ui.find(n=>n.type==='button'&&n.props['data-pending-session-id']==='group-channel');assert.ok(open);assert.match(ui.text(open),kind==='question'?/提问/:/计划确认/);assert.equal(ui.leases.length,1,'one affected keyed recovery reference');await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.equal(ui.leases.length,1,'modal borrows recovery reference');assert.equal(ui.leases[0].id,'group-channel');assert.ok(ui.find(n=>n.type==='native-factory'));assert.equal(ui.find(n=>n.type==='native-chat'),null);
  const answer={answers:[{id:kind==='question'?'choice':'plan',selected:[kind==='question'?'方案一':'确认']}]};await pending.answer(answer);assert.deepEqual(structuredClone(await request.result),answer);await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,0,'waterfall none is still observed until official registry settlement');pending.close();await ui.flush();assert.equal(ui.leases[0].ref.releaseCount,1);assert.equal(ui.writes.length,0);
});

test('official question card snapshot changes notify the root before outer status Map changes',async t=>{
  const pending=realQuestion(),status=new Map([['group-channel',{pendingInteraction:pending}]]),ui=harness({snapshot:approvalFixture(),status});t.after(()=>ui.dispose());await ui.click('群 ga');const before=ui.notifications(),originalMap=status;const request=sdkQuestions.createWaterfallRequest(undefined,undefined,channel=>pending.detachWaterfall(channel));pending.attachWaterfall(request.channel);await ui.flush();assert.equal(status,originalMap);assert.ok(ui.notifications()>before,'public card subscription drives changes even though sessionStatus Map is identical');assert.ok(ui.find(n=>n.props['data-pending-session-id']==='group-channel'));pending.answer({answers:[{id:'choice',selected:['方案一']}]});await request.result;
});

for(const kind of ['question','plan-review'])test(`official continued ${kind} RPC stays target-scoped and explicit hidden-card reopen preserves its canonical identity`,async t=>{
  const pending=realQuestion(kind),answers=[],status=new Map([['group-channel',{pendingInteraction:pending}]]);pending.attachRpc({answer:async answer=>{answers.push(answer);return true;}});pending.setState('continued');pending.attachSeat({hide:()=>status.delete('group-channel')});const ui=harness({snapshot:approvalFixture('discussion'),status});t.after(()=>ui.dispose());await ui.click('群 ga');let open=ui.find(n=>n.type==='button'&&n.props['data-pending-session-id']==='group-channel');assert.ok(open);await open.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.ok(ui.find(n=>n.type==='native-factory'));await pending.dismiss();await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,0,'unresolved current keyed card keeps only its recovery binding');assert.deepEqual(ui.revealed,[]);
  const reopen=ui.find(n=>n.type==='button'&&n.props['data-reopen-session-id']==='group-channel');assert.ok(reopen,'empty native Views require an explicit exact tool-call reopen handle');await reopen.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.deepEqual(ui.revealed,[{sessionId:'group-channel',callId:'real-call'}]);assert.ok(ui.find(n=>n.type==='native-factory'));await pending.answer({answers:[{id:kind==='question'?'choice':'plan',selected:[kind==='question'?'方案一':'确认']}]});assert.equal(answers.length,1);pending.close();await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.find(n=>n.props['data-reopen-session-id']==='group-channel'),null);assert.equal(ui.leases[0].ref.releaseCount,1);assert.equal(ui.writes.length,0);
});

test('continued projection discovers only current ready channels and waits for the actual native RPC carrier',async t=>{
  const snapshot=approvalFixture('discussion'),status=new Map(),pending=realQuestion(),sessionList={byId:{},projectionsBySession:{'group-channel':{values:{userQuestions:{active:[{callId:'real-call',state:'continued'}]}}},'sa':{values:{userQuestions:{active:[{callId:'contact-call',state:'continued'}]}}}}};
  const ui=harness({snapshot,status,sessionList});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.flush();assert.deepEqual(ui.projectionReads.sort(),['group-channel','independent-channel'].sort());assert.deepEqual(ui.leases.map(l=>l.id),['group-channel']);assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.find(n=>n.props['data-pending-session-id']),null,'projection metadata is never a fake carrier');pending.attachRpc({answer:async()=>true});pending.setState('continued');status.set('group-channel',{pendingInteraction:pending});await ui.flush();assert.ok(ui.find(n=>n.props['data-pending-session-id']==='group-channel'));assert.equal(ui.leases.length,1);const completed=structuredClone(snapshot);completed.groups[0].rounds.r.state='complete';ui.replaceSnapshot(completed);await ui.flush();assert.equal(ui.find(n=>n.props['data-pending-session-id']==='group-channel'),null);assert.equal(ui.leases[0].ref.releaseCount,1);
});

for(const invalid of ['group','generation','member','epoch','settled','UNKNOWN'])test(`hidden canonical question cannot reopen after ${invalid} invalidates current channel`,async t=>{
  const snapshot=approvalFixture('discussion'),pending=realQuestion(),status=new Map([['group-channel',{pendingInteraction:pending}]]);pending.attachRpc({answer:async()=>true});pending.setState('continued');pending.attachSeat({hide:()=>status.delete('group-channel')});const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');await pending.dismiss();await ui.flush();const reopen=ui.find(n=>n.props['data-reopen-session-id']==='group-channel');assert.ok(reopen);if(invalid==='group')await ui.click('群 gb');else if(invalid==='generation')ui.replaceGeneration({id:'generation-2'});else{const next=structuredClone(snapshot);if(invalid==='member')next.groups[0].members[0].epoch++;else if(invalid==='epoch')next.sessions.find(s=>s.sessionId==='group-channel').lineage.roundId='replacement';else next.sessions.find(s=>s.sessionId==='group-channel').state=invalid;ui.replaceSnapshot(next);}await ui.flush();assert.equal(ui.find(n=>n.props['data-reopen-session-id']==='group-channel'),null);await reopen.props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.deepEqual(ui.revealed,[]);assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,1);
});

for(const invalid of ['hide','close','generation','epoch','group'])test(`full canonical plan text and bounded native preview shadow dispose after ${invalid}`,async t=>{
  const snapshot=approvalFixture('discussion'),pending=realQuestion('plan-review'),status=new Map([['group-channel',{pendingInteraction:pending}]]),body='# 实际全文\n\n<script>原样文本</script>\n\n'+('完整正文\n'.repeat(100))+'最终计划尾标记';pending.questions[0].detail=body;pending.attachRpc({answer:async()=>true});pending.setState('continued');pending.attachSeat({hide:()=>status.delete('group-channel')});const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.slotShadows.length,0);await ui.find(n=>n.props['data-pending-session-id']==='group-channel').props.onClick({currentTarget:{focus(){}}});await ui.flush();const document=ui.find(n=>n.props.className==='bs-plan-document');assert.ok(document);assert.equal(ui.text(ui.find(n=>n.type==='pre')),body);assert.equal(ui.find(n=>n.type==='script'),null);assert.equal(ui.slotShadows.length,1);assert.deepEqual(ui.slotShadows[0].spec,{name:'conversation.plan-review.actions',id:'@deepseek-ai/dsh-client-ui-plan',priority:-1});assert.equal(ui.slotShadows[0].Component(),null);
  if(invalid==='hide')await pending.dismiss();else if(invalid==='close')pending.close();else if(invalid==='generation')ui.replaceGeneration({id:'generation-2'});else if(invalid==='group')await ui.click('群 gb');else{const next=structuredClone(snapshot);next.sessions.find(s=>s.sessionId==='group-channel').lineage.roundId='new';ui.replaceSnapshot(next);}await ui.flush();assert.equal(ui.find(n=>n.props.className==='bs-plan-document'),null);assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.slotShadows[0].disposed,1);assert.deepEqual(ui.opened,[]);
});

test('long history keeps compact primary identity and full original accessible identity',async t=>{
  const snapshot=fixture(),id='05d55d22-0111-4990-aeee-1abc123abcde';snapshot.sessions[0].sessionId=id;const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('同名 Bot · a');const history=ui.find(n=>n.props.className==='bs-history-item');assert.equal(ui.text(history),'历史 sa · 05d55d22');assert.equal(history.props['data-session-id'],id);assert.equal(history.props.title,`历史 sa · ${id}`);assert.equal(history.props['aria-label'],`历史 sa · ${id}`);await history.props.onClick();await ui.flush();assert.equal(ui.leases[0].id,id);
});

test('actual timed card none-to-continued snapshot keeps one recovery binding and closes native fallback throughout',async t=>{
  const pending=realQuestion(),request=sdkQuestions.createWaterfallRequest(undefined,undefined,channel=>pending.detachWaterfall(channel)),status=new Map([['group-channel',{pendingInteraction:pending}]]);request.result.catch(()=>{});pending.attachWaterfall(request.channel);const ui=harness({snapshot:approvalFixture('discussion'),status});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.find(n=>n.props['data-pending-session-id']==='group-channel').props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.ok(ui.find(n=>n.type==='native-factory'));pending.timeout();await assert.rejects(request.result);await ui.flush();assert.equal(pending.getSnapshot().channel,'none');assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,0);const before=ui.notifications();pending.setState('continued');pending.attachRpc({answer:async()=>true});await ui.flush();assert.ok(ui.notifications()>before);assert.equal(ui.leases.length,1);await ui.find(n=>n.props['data-pending-session-id']==='group-channel').props.onClick({currentTarget:{focus(){}}});await ui.flush();assert.ok(ui.find(n=>n.type==='native-factory'));pending.close();await ui.flush();assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases[0].ref.releaseCount,1);
});

for(const kind of ['question','plan-review'])test(`creating ${kind} channel waits for durable ready binding before opening native Factory`,async t=>{
  const snapshot=approvalFixture('discussion'),pending=realQuestion(kind),status=new Map([['group-channel',{pendingInteraction:pending}]]);pending.attachRpc({answer:async()=>true});pending.setState('continued');snapshot.sessions.find(s=>s.sessionId==='group-channel').state='creating';const ui=harness({snapshot,status});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.find(n=>n.props['data-pending-session-id']==='group-channel'),null);assert.equal(ui.find(n=>n.type==='native-factory'),null);assert.equal(ui.leases.length,1,'genuine incoming card permits bounded recovery retain');snapshot.sessions.find(s=>s.sessionId==='group-channel').state='ready';ui.replaceSnapshot(structuredClone(snapshot));await ui.flush();assert.ok(ui.find(n=>n.props['data-pending-session-id']==='group-channel'));
});

test('review-only and queued continued questions never retain or expose an editable native route',async t=>{
  const pending=realQuestion();pending.attachRpc({answer:async()=>true});pending.setState('continued');pending.review={answer:{answers:[]}};const sessionList={byId:{},projectionsBySession:{'group-channel':{values:{userQuestions:{active:[{callId:'real-call',state:'continued'}]},inbox:{'next-step':[{source:{kind:'user-question-reply',callId:'real-call'}}]}}}}},ui=harness({snapshot:approvalFixture(),status:new Map([['group-channel',{pendingInteraction:pending}]]),sessionList});t.after(()=>ui.dispose());await ui.click('群 ga');assert.equal(ui.leases.length,0);assert.equal(ui.find(n=>n.props['data-pending-session-id']),null);assert.equal(ui.find(n=>n.type==='native-factory'),null);
});

for(const failure of ['resolved-error','rejected','sync'])test(`projection baseline ${failure} permits deliberate same-generation retry without a render retry loop`,async t=>{
  let attempts=0;const ui=harness({snapshot:approvalFixture('discussion'),refreshProjections:(id,list)=>{
    if(id!=='group-channel')return Promise.resolve();attempts++;
    if(attempts===1){if(failure==='sync')throw Error('retryable baseline');if(failure==='rejected')return Promise.reject(Error('retryable baseline'));list.projectionsBySession[id]={state:'error',error:{message:'retryable baseline'},values:{}};return Promise.resolve();}
    list.projectionsBySession[id]={state:'ready',error:null,values:{}};return Promise.resolve();
  }});t.after(()=>ui.dispose());await ui.click('群 ga');await ui.flush();assert.equal(attempts,1);assert.match(ui.text(ui.find(n=>n.props.role==='alert')),/retryable baseline/);ui.change('搜索 Bot 与群','');await ui.flush();assert.equal(attempts,1,'error publication and ordinary renders never retry');await ui.click('群 ga');await ui.flush();assert.equal(attempts,2,'explicit same-lineage selection retries failed admission');await ui.click('群 gb');await ui.click('群 ga');await ui.flush();assert.equal(attempts,2,'successful baseline remains cached for the connection');assert.equal(ui.writes.length,0);
});

for(const kind of ['rail','context'])test(`${kind} container widening closes obsolete drawer and removes inert after its exact breakpoint`,async t=>{
  const original=globalThis.ResizeObserver,observers=[];globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;this.disconnected=0;observers.push(this);}observe(element){this.element=element;}disconnect(){this.disconnected++;}};
  const ui=harness();t.after(()=>{ui.dispose();globalThis.ResizeObserver=original;});let width=760,returned=0;const container={getBoundingClientRect:()=>({width})};ui.find(n=>n.props.className==='dsh-bot-space').props.ref.current=container;
  await ui.find(n=>n.type==='button'&&ui.text(n)===(kind==='rail'?'会话':'上下文')).props.onClick({currentTarget:{focus(){assert.equal(ui.find(n=>n.props.className==='bs-main').props.inert,false);returned++;}}});ui.render();const observer=observers.find(o=>o.element===container);assert.ok(observer,'actual container resize must be observed');width=kind==='rail'?839:1179;observer.callback([{target:container,contentRect:{width}}]);ui.render();assert.equal(ui.find(n=>n.props.className==='bs-main').props.inert,true);assert.equal(returned,0);width++;observer.callback([{target:container,contentRect:{width}}]);ui.render();assert.equal(ui.find(n=>n.props.className==='bs-main').props.inert,false);assert.equal(ui.find(n=>n.props.className===(kind==='rail'?'bs-rail':'bs-context')).props['aria-modal'],undefined);assert.equal(ui.find(n=>n.props.className==='bs-backdrop'),null);assert.equal(returned,1);assert.equal(observer.disconnected,1);observer.callback([{target:container,contentRect:{width:1600}}]);ui.render();assert.equal(returned,1);
});

for(const phase of ['discussion','decision','complete'])test(`legacy ${phase} meeting without revealedEpoch keeps its authoritative revealed history`,async t=>{
  const snapshot=approvalFixture(phase);delete snapshot.meetings[0].revealedEpoch;snapshot.meetings[0].discussion={a:{botId:'a',text:'原始讨论记录'}};snapshot.meetings[0].decision={text:'原始协调者决定'};const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');const card=ui.find(n=>n.props['data-meeting-id']==='mt');assert.match(ui.text(card),/封存推理意见/);assert.match(ui.text(card),/原始讨论记录/);assert.match(ui.text(card),/原始协调者决定/);assert.equal(ui.find(n=>n.props.className==='bs-sealed'),null);assert.equal(ui.writes.length,0);
});

test('independent phase remains sealed even if a legacy snapshot carries a matching old reveal marker',async t=>{
  const snapshot=approvalFixture();snapshot.meetings[0].revealedEpoch=3;const ui=harness({snapshot});t.after(()=>ui.dispose());await ui.click('群 ga');assert.ok(ui.find(n=>n.props.className==='bs-sealed'));assert.ok(!ui.text(ui.render()).includes('封存推理意见'));assert.equal(ui.writes.length,0);
});
