/** Actual rc.2 Loader module. Owner controls are private RPC bindings, independent of read leases. */
window.__ModuleLoader__.load({id:'dsh-bot',factory:require=>{
 const{createElement:h,useState,useEffect,useRef}=require('react');const namespace='dsh.bot',panelId='dsh-bot',cancelledRead=Symbol('dsh-bot/cancelled');
 const en={nav:'Bots',title:'Bots',registration:'Client plugin mounted',connection:'Host connection',unstarted:'Not established',connecting:'Connecting',connected:'Connected',reconnecting:'Reconnecting',disconnected:'Disconnected',offline:'Offline',failed:'Failed',stopped:'Stopped',records:'Bots and tasks',bots:'Bots',tasks:'Tasks',empty:'No records in this authorized snapshot',waiting:'Waiting for a Host connection',loading:'Reading status',not_configured:'Read source not configured',access_denied:'This connection is not authorized to read these records',read_failed:'Status could not be read',selected_bot:'Selected Bot',main_goal:'Main goal',goal_hint:'Send a short text goal to the selected Bot. Its main model chooses whether to delegate work.',send:'Send goal',owner_unavailable:'Owner controls unavailable',reply:'Observed main reply',refresh:'Refresh replies and work',receipt:'Original message receipt',unknown:'Unknown — check the original receipt',sending:'Sending',durably_queued:'Original message durably queued',accepted:'Stop request accepted',reconcile:'Check original receipt',contact_stop:'Request contact stop',work:'Work Sessions',work_stop:'Request work stop',work_detail:'Work details',completion:'Completion condition',result:'Observed work result',state:'State',held:'Held work slots',held_hint:'Observed replies and accepted stop requests do not release held work slots or prove generation settlement.',planned:'Planned',user_bots:'User Bots',groups:'Group chat',autotasks:'Automatic tasks',scope:'Send controls require a current owner binding. A read lease alone grants no write access.'};
 const zh={nav:'我的 Bot',title:'我的 Bot',registration:'界面已就绪',connection:'连接状态',unstarted:'尚未连接',connecting:'正在连接',connected:'已连接',reconnecting:'正在重新连接',disconnected:'连接已断开',offline:'离线',failed:'未能完成',stopped:'已停止',records:'Bot 与任务',bots:'Bot',tasks:'任务',empty:'暂无记录',waiting:'正在等待连接',loading:'正在读取状态',not_configured:'暂不能读取状态，请重新连接',access_denied:'当前连接无法查看这些记录',read_failed:'状态读取失败，请稍后刷新',selected_bot:'当前 Bot',main_goal:'主对话',goal_hint:'告诉 Bot 你的目标。它会处理主任务，并在需要时分派独立的工作。',send:'发送目标',owner_unavailable:'暂不能操作，请刷新或重新连接',reply:'主对话回复',refresh:'刷新回复与工作',receipt:'消息回执',unknown:'结果未知（UNKNOWN），请查询原回执',sending:'正在提交',durably_queued:'消息已保存，等待处理',accepted:'停止请求已接受，结束状态待确认',reconcile:'查询原回执',contact_stop:'请求停止主对话',work:'工作对话',work_stop:'请求停止工作',work_detail:'工作详情',completion:'完成条件',result:'已收到的工作结果',state:'状态',held:'仍占用的工作槽位',held_hint:'收到回复或停止请求已接受，都不代表工作已结束。结束状态尚未确认时，工作槽位会继续保留。',planned:'规划中',user_bots:'用户 Bots',groups:'群聊',autotasks:'自动任务',scope:'操作权限暂未确认，请重新连接。',active:'可用',registered:'已创建',paused:'已暂停',archived:'已归档',restoring:'正在恢复',unsupported:'尚未确认',running:'正在处理',idle:'等待消息',pending:'等待处理',created:'已创建',fenced:'已停止提交',none:'尚未请求停止',generation:'处理代次',retained:'仍保留',released:'已回收',turn:'对话轮次',receipt_details:'回执编号',create_first:'创建 Bot 后即可查看主对话和工作。',empty_work:'暂无工作。Bot 分派工作后，目标、结果和停止状态会显示在这里。',goal_placeholder:'例如：整理这周的待办事项，并给出优先级建议。'};
 Object.assign(en,{create_bot:'Create Bot',bot_name:'Bot name',create_original:'Original create receipt',create_unknown:'Create outcome unknown — check the original receipt',create_created:'Bot and main Session created',model_disabled:'Model requests are disabled for this launch. Restart with --enable-model-requests to send goals.',continuation_unconfirmed:'This main dialog cannot continue yet. You can view existing records and check their original receipts.'});
 Object.assign(en,{active:'Active',registered:'Created',paused:'Paused',archived:'Archived',restoring:'Restoring',unsupported:'Unconfirmed',running:'Working',idle:'Waiting for a message',pending:'Pending',created:'Created',fenced:'New submissions stopped',none:'No stop requested',generation:'Generation',retained:'Retained',released:'Reclaimed',turn:'Turn',receipt_details:'Receipt ID',create_first:'Create a Bot to view its main dialog and work.',empty_work:'No work yet. Delegated goals, results and stop status will appear here.',goal_placeholder:'For example: organize this week’s tasks and suggest priorities.'});
 Object.assign(zh,{create_bot:'创建 Bot',bot_name:'Bot 名称',create_original:'创建回执',create_unknown:'创建结果未知（UNKNOWN），请查询原回执；不会重复创建。',create_created:'Bot 与主对话已创建',model_disabled:'本次为查看模式。启用模型后，可发送新目标。',continuation_unconfirmed:'主对话的接续状态尚未确认，暂不能发送新目标。你仍可查看记录和查询原回执。'});
 Object.assign(zh,{native_settled:'结束状态已核对',native_pending:'正在处理，结束状态待确认',native_unknown:'结束状态未知（UNKNOWN）',latest_processing:'当前对话处理',previous_unconfirmed:'上一轮的结束状态尚未确认。请刷新或查询原回执后再继续。',unoccupied:'未占用槽位'});
 Object.assign(en,{native_settled:'End state verified',native_pending:'Working; end state pending',native_unknown:'End state UNKNOWN',latest_processing:'Current dialog processing',previous_unconfirmed:'The previous end state is unconfirmed. Refresh or check the original receipt before continuing.',unoccupied:'No slot occupied'});
 Object.assign(zh,{work_waiting:'等待下一步'});Object.assign(en,{work_waiting:'Waiting for the next step'});
 Object.assign(zh,{work_continue:'接续原工作',continue_accepted:'接续请求已接受，请查看新一轮状态',bot_controls:'Bot 管理',archive_bot:'归档 Bot',restore_bot:'恢复原 Bot',archive_accepted:'归档请求已接受，请核对原状态',restore_accepted:'恢复请求已接受，请核对原状态',control_unknown:'操作结果未知（UNKNOWN），请查询原回执',control_hint:'操作尚未确认时，只查询原回执。UNKNOWN 工作会保留原对话和槽位。'});
 Object.assign(en,{work_continue:'Continue original work',continue_accepted:'Continuation accepted; check the new generation',bot_controls:'Bot controls',archive_bot:'Archive Bot',restore_bot:'Restore original Bot',archive_accepted:'Archive request accepted; check original status',restore_accepted:'Restore request accepted; check original status',control_unknown:'Outcome UNKNOWN; check the original receipt',control_hint:'An unconfirmed operation remains lookup-only. UNKNOWN work retains its original session and slot.'});
 let operationStorage,operationLocks;try{operationStorage=globalThis.localStorage;operationLocks=globalThis.navigator?.locks;}catch{}
 const string=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max;
  function readView(result) {
   const value=result?.ok===true?result.value:undefined;
   if(value?.version!==1)return {status:'read_failed'};
   if(['not_configured','access_denied','read_failed'].includes(value.status))return {status:value.status};
   const string=(v,max)=>typeof v==='string' && v.length>0 && v.length<=max;
   const revision=v=>Number.isSafeInteger(v) && v>=1;
   if(value.status!=='ready' || !Array.isArray(value.bot) || !Array.isArray(value.task)
     || value.bot.length>500 || value.task.length>500)return {status:'read_failed'};
   if(!value.bot.every(b=>b && string(b.botId,200) && string(b.name,100) && string(b.lifecycle,64)
     && string(b.readiness,64) && revision(b.epoch) && revision(b.revision))
     || !value.task.every(q=>q && string(q.taskId,200) && string(q.ownerBotId,200) && string(q.title,500)
     && string(q.responsibility,64) && string(q.stop?.state,64) && revision(q.epoch) && revision(q.revision)))return {status:'read_failed'};
   return {status:'ready',bot:value.bot,task:value.task};
  }

 function nativeProof(flag,observation){
  if(observation===undefined)return flag===false||flag===undefined;
  if(!observation||typeof flag!=='boolean'||!['unknown','pending','returned'].includes(observation.local)
    ||!['UNKNOWN','settled'].includes(observation.remote)||typeof observation.usageKnown!=='boolean'||typeof observation.settlementVerified!=='boolean')return false;
  const usage=observation.usage,keys=['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'];
  const known=usage&&typeof usage==='object'&&!Array.isArray(usage)&&keys.slice(0,3).every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)
    &&Object.keys(usage).every(key=>keys.includes(key)&&Number.isSafeInteger(usage[key])&&usage[key]>=0)&&usage.totalTokens>=usage.inputTokens+usage.outputTokens;
  if(observation.usageKnown?!known:usage!==null)return false;
  const settled=observation.remote==='settled';
  return flag===settled&&observation.settlementVerified===settled&&(!settled||observation.local==='returned'&&observation.usageKnown&&known);
 }
 const nativeState=observation=>observation?.settlementVerified===true?'settled':observation?.local==='pending'?'pending':'UNKNOWN';
 const nativeLabel=observation=>observation?.settlementVerified===true?'native_settled':observation?.local==='pending'?'native_pending':'native_unknown';
 function ownerView(result,botId){
  const v=result?.ok===true?result.value:null;
  if(v?.version!==1||v.status!=='ready'||v.botId!==botId||!string(v.contact?.sessionId)
    ||v.readOnly!==undefined&&typeof v.readOnly!=='boolean'||!['idle','running',...(v.readOnly===true?['unknown']:[])].includes(v.contact.status)
    ||!Array.isArray(v.work)||v.work.length>500||!Number.isSafeInteger(v.held)||v.held<0||v.limit!==15||v.preciseNativeSettlementVerified!==false
    ||!nativeProof(v.contact.preciseNativeSettlementVerified,v.contact.generationObservation)
    ||v.readOnly===true&&(v.contact.preciseNativeSettlementVerified!==false||v.work.some(w=>w?.preciseNativeSettlementVerified!==false))
    ||v.contact.generation!==undefined&&v.contact.generation!==null&&(!Number.isSafeInteger(v.contact.generation)||v.contact.generation<1))return{status:'owner_unavailable'};
  if(v.contact.reply!==null&&v.contact.reply!==undefined){const r=v.contact.reply;if(!string(r.messageId)||!string(r.text,4096)||!Number.isSafeInteger(r.turn)||r.turn<1||!string(r.inputMessageId)||!string(r.inputKind,64))return{status:'owner_unavailable'};}
  if(!v.work.every(w=>string(w.taskId)&&string(w.task_id)&&string(w.sessionId)&&Number.isSafeInteger(w.generation)&&w.generation>0
    &&string(w.goal,500)&&string(w.completion_condition,4000)&&string(w.state,64)&&typeof w.held==='boolean'&&['none','accepted'].includes(w.stop?.state)
    &&typeof w.preciseNativeSettlementVerified==='boolean'&&nativeProof(w.preciseNativeSettlementVerified,w.generationObservation)&&(!w.preciseNativeSettlementVerified||!w.held)
    &&(!w.result||string(w.result.text,4096)&&string(w.result.responseMessageId)&&Number.isSafeInteger(w.result.turn)&&w.result.turn>0)))return{status:'owner_unavailable'};
  return v;
 }
 function storageKey(botId){return 'dsh-bot/original-operations/'+botId;}
 function cleanOperation(value,botId,kind){if(!value||value.botId!==botId||value.kind!==kind||!string(value.operationId)||!string(value.nonce)||!(kind==='contact'?['unknown','durably-queued']:['unknown','accepted']).includes(value.state)||value.messageId!==undefined&&!string(value.messageId))throw cancelledRead;return{botId,kind,operationId:value.operationId,nonce:value.nonce,state:value.state,...(value.messageId?{messageId:value.messageId}:{})};}
 function loadOperations(botId){if(!operationStorage||typeof operationStorage.getItem!=='function'||typeof operationStorage.setItem!=='function'||typeof operationLocks?.request!=='function')throw cancelledRead;const raw=operationStorage.getItem(storageKey(botId));if(raw===null)return{version:1,botId,contact:null,stops:{}};if(raw.length>32768)throw cancelledRead;const value=JSON.parse(raw);if(value?.version!==1||value.botId!==botId||!value.stops||typeof value.stops!=='object'||Array.isArray(value.stops)||Object.keys(value.stops).length>64)throw cancelledRead;const stops={};for(const[key,v]of Object.entries(value.stops)){if(!string(key)||['__proto__','constructor','prototype'].includes(key))throw cancelledRead;stops[key]=cleanOperation(v,botId,'stop');}return{version:1,botId,contact:value.contact===null?null:cleanOperation(value.contact,botId,'contact'),stops};}
 function saveOperations(value){operationStorage.setItem(storageKey(value.botId),JSON.stringify(value));}
 function receiptView(result,operation){const r=result?.ok===true?result.value:null;if(r?.version!==1||r.operationId!==operation.operationId||r.nonce!==operation.nonce||r.botId!==operation.botId||!(operation.kind==='contact'?['unknown','durably-queued']:['unknown','accepted']).includes(r.state)||typeof r.preciseNativeSettlementVerified!=='boolean'||!nativeProof(r.preciseNativeSettlementVerified,r.generationObservation)||r.messageId!==null&&r.messageId!==undefined&&!string(r.messageId))return{...operation,state:'unknown'};return{...operation,...(r.messageId===null||r.messageId===undefined?{}:{messageId:r.messageId}),state:r.state};}
 function validGuiControls(value,botId){return value?.version===1&&value.botId===botId&&Number.isSafeInteger(value.botEpoch)&&value.botEpoch>0
  &&['active','archived'].includes(value.lifecycle)&&typeof value.canArchive==='boolean'&&typeof value.canRestore==='boolean'
  &&(!value.canArchive||value.lifecycle==='active')&&(!value.canRestore||value.lifecycle==='archived')&&Array.isArray(value.work)&&value.work.length<=500
  &&value.work.every(row=>string(row.taskId)&&string(row.sessionId)&&Number.isSafeInteger(row.generation)&&row.generation>0&&typeof row.canContinue==='boolean')
  &&new Set(value.work.map(row=>JSON.stringify([row.taskId,row.sessionId]))).size===value.work.length;}
 function guiView(result){const v=result?.ok===true?result.value:null,c=v?.creation;if(v?.version!==1||v.status!=='ready'||!string(v.ledgerId)||!(v.selectedBotId===null||string(v.selectedBotId))||!(v.contactSessionId===null||string(v.contactSessionId))||typeof v.modelRequestsEnabled!=='boolean'||typeof v.nativeGenerationTerminalSupported!=='boolean'||v.modelDispatchStatus!==undefined&&(!['disabled','unconfirmed','available'].includes(v.modelDispatchStatus)||v.modelRequestsEnabled!==(v.modelDispatchStatus==='available'))||c!==null&&(c?.version!==1||!string(c.operationId,128)||!string(c.nonce,128)||!['unknown','created'].includes(c.state)||c.preciseNativeSettlementVerified!==false||!(c.botId===null||string(c.botId))||!(c.sessionId===null||string(c.sessionId))||c.state==='created'&&(!string(c.botId)||!string(c.sessionId)))||v.controls!==undefined&&v.controls!==null&&!validGuiControls(v.controls,v.selectedBotId))return{status:'owner_unavailable'};return v;}
 const controlStorageKey=(ledgerId,botId)=>'dsh-bot/gui-controls/'+ledgerId+'/'+botId;
 const controlKey=op=>JSON.stringify(op.kind==='continue'?['work',op.taskId,op.sessionId,op.generation]:['bot',op.kind,op.botEpoch]);
 function cleanControlOperation(value,botId){
  if(value?.version!==1||value.botId!==botId||!['continue','archive','restore'].includes(value.kind)||!string(value.operationId)||!string(value.nonce)||!['unknown','accepted'].includes(value.state))throw cancelledRead;
  const op={version:1,kind:value.kind,botId,operationId:value.operationId,nonce:value.nonce,state:value.state};
  if(value.kind==='continue'){
   if(!string(value.taskId)||!string(value.sessionId)||!Number.isSafeInteger(value.generation)||value.generation<1
     ||value.nextGeneration!==undefined&&value.nextGeneration!==value.generation+1)throw cancelledRead;
   return{...op,taskId:value.taskId,sessionId:value.sessionId,generation:value.generation,...value.nextGeneration?{nextGeneration:value.nextGeneration}:{}};
  }
  if(!Number.isSafeInteger(value.botEpoch)||value.botEpoch<1)throw cancelledRead;
  return{...op,botEpoch:value.botEpoch};
 }
 function loadControlOperations(ledgerId,botId){
  if(!operationStorage||typeof operationStorage.getItem!=='function'||typeof operationStorage.setItem!=='function'||typeof operationLocks?.request!=='function')throw cancelledRead;
  const raw=operationStorage.getItem(controlStorageKey(ledgerId,botId));if(raw===null)return{version:1,ledgerId,botId,operations:{}};
  if(raw.length>32768)throw cancelledRead;const value=JSON.parse(raw);
  if(value?.version!==1||value.ledgerId!==ledgerId||value.botId!==botId||!value.operations||typeof value.operations!=='object'||Array.isArray(value.operations)||Object.keys(value.operations).length>64)throw cancelledRead;
  const operations={};for(const[key,row]of Object.entries(value.operations)){const op=cleanControlOperation(row,botId);if(key!==controlKey(op))throw cancelledRead;operations[key]=op;}
  return{version:1,ledgerId,botId,operations};
 }
 function controlFrame(op,inspect=false){const frame={operationId:op.operationId,nonce:op.nonce,botId:op.botId};
  return op.kind==='continue'?{...frame,taskId:op.taskId,sessionId:op.sessionId,generation:op.generation}:inspect?frame:{...frame,botEpoch:op.botEpoch};}
 function controlReceipt(result,op){
  const value=result?.ok===true?result.value:null;
  if(value?.version!==1||value.operationId!==op.operationId||value.nonce!==op.nonce||value.botId!==op.botId||!['unknown','accepted'].includes(value.state))return{...op,state:'unknown'};
  if(op.kind==='continue'){
   if(value.taskId!==op.taskId||value.sessionId!==op.sessionId||value.originalGeneration!==op.generation||!Number.isSafeInteger(value.generation)
     ||value.generation!==op.generation+1||!nativeProof(value.preciseNativeSettlementVerified,value.generationObservation))return{...op,state:'unknown'};
   return{...op,state:value.state,nextGeneration:value.generation};
  }
  if(!Number.isSafeInteger(value.botEpoch)||value.botEpoch<op.botEpoch||!['active','archived'].includes(value.lifecycle)
    ||value.preciseNativeSettlementVerified!==false)return{...op,state:'unknown'};
  return{...op,state:value.state};
 }
 const createStorageKey=ledgerId=>'dsh-bot/gui-create/'+ledgerId;
 function loadCreate(ledgerId){if(!operationStorage||typeof operationLocks?.request!=='function')throw cancelledRead;const raw=operationStorage.getItem(createStorageKey(ledgerId));if(raw===null)return null;if(raw.length>4096)throw cancelledRead;const op=JSON.parse(raw);if(op?.version!==1||op.ledgerId!==ledgerId||!string(op.operationId,128)||!string(op.nonce,128)||!['unknown','created'].includes(op.state)||op.botId!==undefined&&!string(op.botId)||op.sessionId!==undefined&&!string(op.sessionId))throw cancelledRead;return op;}
 async function bootstrapCreate(view,signal){if(!operationStorage||typeof operationStorage.getItem!=='function'||typeof operationStorage.setItem!=='function'||typeof operationLocks?.request!=='function')throw cancelledRead;return operationLocks.request(createStorageKey(view.ledgerId),{mode:'exclusive',signal},()=>{if(signal.aborted)throw cancelledRead;const stored=loadCreate(view.ledgerId),original=view.creation;if(stored){if(original&&(stored.operationId!==original.operationId||stored.nonce!==original.nonce))throw cancelledRead;return stored;}if(!original)return null;const adopted={version:1,ledgerId:view.ledgerId,operationId:original.operationId,nonce:original.nonce,state:original.state,...(original.botId?{botId:original.botId}:{}),...(original.sessionId?{sessionId:original.sessionId}:{})};operationStorage.setItem(createStorageKey(view.ledgerId),JSON.stringify(adopted));return adopted;});}
 function createReceipt(result,op){const r=result?.ok===true?result.value:null;return r?.version===1&&r.operationId===op.operationId&&r.nonce===op.nonce&&r.preciseNativeSettlementVerified===false&&r.state==='created'&&string(r.botId)&&string(r.sessionId)?{...op,state:'created',botId:r.botId,sessionId:r.sessionId}:{...op,state:'unknown'};}
 function BotPanel({t,useConnection,useGeneration,read,ownerCall,guiCall}){
  const state=useConnection(v=>v),generation=useGeneration(v=>v)?.id,connected=state==='connected'&&Number.isSafeInteger(generation);
  const[view,setView]=useState({status:'waiting'}),[selectedId,setSelectedId]=useState(''),[owned,setOwned]=useState({status:'owner_unavailable'}),[goal,setGoal]=useState(''),[receipt,setReceipt]=useState(null),[stopReceipts,setStopReceipts]=useState({}),[refresh,setRefresh]=useState(0),[identityReady,setIdentityReady]=useState(false);
  const memory=useRef({controllers:new Set(),busy:false,epoch:null,operation:null,live:null,guiIdentity:null});memory.current.live={connected,generation,botId:selectedId};
  const[gui,setGui]=useState({status:'owner_unavailable'}),[botName,setBotName]=useState(guiCall?'我的 Bot':'My Bot'),[createOp,setCreateOp]=useState(null),[creating,setCreating]=useState(false),[catalogRevision,setCatalogRevision]=useState(0),[guiRefresh,setGuiRefresh]=useState(0);
  const[controlOperations,setControlOperations]=useState({}),[controlReady,setControlReady]=useState(false),[controlBusy,setControlBusy]=useState(false);
  useEffect(()=>{memory.current.epoch=generation;return()=>{
   for(const c of memory.current.controllers)c.abort();memory.current.controllers.clear();memory.current.busy=false;
   const op=memory.current.operation;if(op?.state==='sending'){const unknown={...op,state:'unknown'};memory.current.operation=unknown;setReceipt(unknown);}
  };},[state,generation,selectedId]);
  useEffect(()=>{if(!connected){setView({status:'waiting'});return;}const controller=new AbortController();setView({status:'loading',generation});void read(controller.signal).then(result=>{if(controller.signal.aborted)return;const next=readView(result);setView({...next,generation});if(next.status==='ready')setSelectedId(id=>next.bot.some(b=>b.botId===id)?id:next.bot[0]?.botId??'');},()=>{if(!controller.signal.aborted)setView({status:'read_failed',generation});});return()=>controller.abort();},[state,generation,read,catalogRevision]);
  useEffect(()=>{setGui({status:'owner_unavailable'});if(!guiCall||!connected)return;const controller=new AbortController();void guiCall('bootstrap',{},controller.signal).then(async result=>{if(controller.signal.aborted)return;const next=guiView(result);if(next.status!=='ready'||!memory.current.live.connected||memory.current.live.generation!==generation)return;
   const identity=memory.current.guiIdentity;
   if(identity?.generation===generation&&identity.ledgerId!==next.ledgerId){memory.current.guiIdentity={generation,ledgerId:null};throw cancelledRead;}
   const original=await bootstrapCreate(next,controller.signal);if(controller.signal.aborted||!memory.current.live.connected||memory.current.live.generation!==generation)return;
   memory.current.guiIdentity={generation,ledgerId:next.ledgerId};
   setCreateOp(original);setGui({...next,generation});setCatalogRevision(n=>n+1);}).catch(()=>{if(!controller.signal.aborted)setGui({status:'owner_unavailable'});});return()=>controller.abort();},[state,generation,guiCall,guiRefresh]);
  useEffect(()=>{if(!connected||!selectedId){setOwned({status:'owner_unavailable'});return;}const controller=new AbortController();setOwned({status:'loading',generation,botId:selectedId});void ownerCall('selectedView',selectedId,{},controller.signal).then(result=>{if(!controller.signal.aborted){setOwned({...ownerView(result,selectedId),generation});if(guiCall)setGuiRefresh(n=>n+1);}},()=>{if(!controller.signal.aborted){setOwned({status:'owner_unavailable',generation,botId:selectedId});if(guiCall)setGuiRefresh(n=>n+1);}});return()=>controller.abort();},[state,generation,selectedId,refresh,ownerCall,guiCall]);
  useEffect(()=>{
   if(!connected||owned.status!=='ready'||owned.generation!==generation||owned.botId!==selectedId)return;
   const active=owned.contact.generationObservation?.local==='pending'||owned.work.some(work=>work.generationObservation?.local==='pending');
   if(!active)return;
   const timer=globalThis.setTimeout(()=>setRefresh(value=>value+1),1500);
   return()=>globalThis.clearTimeout(timer);
  },[connected,generation,selectedId,owned]);
  useEffect(()=>{try{if(!selectedId){setIdentityReady(false);return;}const value=loadOperations(selectedId);memory.current.operation=value.contact;setReceipt(value.contact);setStopReceipts(value.stops);setIdentityReady(true);}catch{setIdentityReady(false);setReceipt(null);setStopReceipts({});}},[selectedId,generation]);
  useEffect(()=>{try{if(!guiCall||!selectedId||!string(gui.ledgerId)){setControlReady(false);return;}const value=loadControlOperations(gui.ledgerId,selectedId);setControlOperations(value.operations);setControlReady(true);}catch{setControlReady(false);setControlOperations({});}},[selectedId,generation,gui.ledgerId,guiCall]);
  useEffect(()=>()=>{for(const c of memory.current.controllers)c.abort();memory.current.controllers.clear();},[]);
  const visible=connected&&view.generation===generation?view:{status:connected?'loading':'waiting'},current=connected&&owned.generation===generation&&owned.botId===selectedId&&owned.status==='ready',operationCurrent=receipt?.botId===selectedId,contactStopReceipt=stopReceipts['contact/'+receipt?.operationId];
  memory.current.live={...memory.current.live,ownerReadable:current,ownerWritable:current&&owned.readOnly!==true};
  async function invoke(endpoint,payload,operation){const controller=new AbortController(),epoch=generation;memory.current.controllers.add(controller);try{const result=await ownerCall(endpoint,operation.botId,payload,controller.signal);if(controller.signal.aborted||memory.current.epoch!==epoch||memory.current.live.botId!==operation.botId||!memory.current.live.connected)return{...operation,state:'unknown'};return receiptView(result,operation);}catch{return{...operation,state:'unknown'};}finally{memory.current.controllers.delete(controller);}}
  const ids=(kind,botId)=>({operationId:globalThis.crypto.randomUUID(),nonce:globalThis.crypto.randomUUID(),botId,kind,state:'unknown'});
  async function storedAction(key,kind,endpoint,makePayload){const queryOnly=endpoint==='inspectContactReceipt';if(!current||!identityReady||memory.current.busy||owned.readOnly===true&&!queryOnly)return;const controller=new AbortController(),botId=selectedId,epoch=generation;memory.current.controllers.add(controller);memory.current.busy=true;try{await operationLocks.request(storageKey(botId),{mode:'exclusive',signal:controller.signal},async()=>{const live=()=>!controller.signal.aborted&&memory.current.live.connected&&memory.current.live.generation===epoch&&memory.current.live.botId===botId&&(queryOnly?memory.current.live.ownerReadable:memory.current.live.ownerWritable);if(!live())return;const value=loadOperations(botId),previous=kind==='contact'?value.contact:value.stops[key],lookup=previous&&(kind==='stop'||previous.state==='unknown'||endpoint==='inspectContactReceipt');if(endpoint==='inspectContactReceipt'&&!previous)return;const op=lookup?previous:ids(kind,botId);if(kind==='contact'){value.contact=op;memory.current.operation=op;setReceipt({...op,state:lookup?op.state:'sending'});}else{if(!previous&&Object.keys(value.stops).length>=64)return;value.stops[key]=op;setStopReceipts({...value.stops,[key]:{...op,state:lookup?op.state:'sending'}});}saveOperations(value);if(!live())return;const next=await invoke(lookup?'inspectContactReceipt':endpoint,lookup?{operationId:op.operationId,nonce:op.nonce}:makePayload(op,value),op);const latest=loadOperations(botId),retained=kind==='contact'?latest.contact:latest.stops[key];if(retained?.operationId!==op.operationId||retained.nonce!==op.nonce)return;const safe=cleanOperation({...next,state:live()?next.state:'unknown'},botId,kind);if(kind==='contact')latest.contact=safe;else latest.stops[key]=safe;saveOperations(latest);if(!live())return;if(kind==='contact'){memory.current.operation=safe;setReceipt(safe);if(safe.state==='durably-queued'&&endpoint==='sendContactText')setGoal('');}else setStopReceipts(latest.stops);setRefresh(n=>n+1);});}catch{try{const value=loadOperations(botId);if(memory.current.live.botId===botId){memory.current.operation=value.contact;setReceipt(value.contact);setStopReceipts(value.stops);}}catch{setIdentityReady(false);}}finally{memory.current.controllers.delete(controller);memory.current.busy=false;}}
  async function submit(event){event.preventDefault();if(writeBlocked||!goal.trim()||goal.length>500)return;const text=goal;await storedAction('contact','contact','sendContactText',op=>({operationId:op.operationId,nonce:op.nonce,text}));}
  async function reconcile(){await storedAction('contact','contact','inspectContactReceipt',()=>({}));}
  const workStopKey=w=>'work/'+w.taskId+'/'+w.generation;
  async function stopWork(w){await storedAction(workStopKey(w),'stop',owned.readOnly===true?'inspectContactReceipt':'requestWorkStop',op=>({operationId:op.operationId,nonce:op.nonce,taskId:w.taskId,generation:w.generation}));}
  async function stopContact(){if(!operationCurrent||!receipt.messageId)return;const target=receipt.operationId;await storedAction('contact/'+target,'stop',owned.readOnly===true?'inspectContactReceipt':'requestContactStop',(op,value)=>{if(value.contact?.operationId!==target)throw cancelledRead;return{operationId:op.operationId,nonce:op.nonce,contactOperationId:target};});}
  const guiCurrent=!!guiCall&&connected&&gui.status==='ready'&&gui.generation===generation;
  const controls=guiCurrent&&gui.controls?.botId===selectedId?gui.controls:null;
  const workOriginal=w=>Object.values(controlOperations).find(op=>op.kind==='continue'&&op.taskId===w.taskId&&op.sessionId===w.sessionId&&op.state==='unknown')
    ??controlOperations[controlKey({kind:'continue',taskId:w.taskId,sessionId:w.sessionId,generation:w.generation})];
  const lifecycleOriginal=Object.values(controlOperations).filter(op=>op.kind!=='continue').sort((a,b)=>b.botEpoch-a.botEpoch).find(op=>op.state==='unknown')
    ??Object.values(controlOperations).filter(op=>op.kind!=='continue').sort((a,b)=>b.botEpoch-a.botEpoch)[0];
  const canContinue=w=>current&&guiCurrent&&gui.modelRequestsEnabled&&w.preciseNativeSettlementVerified===true&&!w.held&&w.stop.state==='none'
    &&controls?.work.some(row=>row.taskId===w.taskId&&row.sessionId===w.sessionId&&row.generation===w.generation&&row.canContinue===true);
  // A pending read may disable new controls; it cannot replace the exact receipt identity.
  // This connection-scoped anchor grants no native authority and contains no capability.
  memory.current.live={...memory.current.live,ledgerId:connected&&memory.current.guiIdentity?.generation===generation?memory.current.guiIdentity.ledgerId:undefined,controls,work:current?owned.work:[],modelEnabled:guiCurrent&&gui.modelRequestsEnabled};
  async function controlAction(kind,work,inspect=false){
   if(!guiCurrent||!controlReady||!identityReady||controlBusy||memory.current.busy||!selectedId)return;
   const previous=kind==='continue'?workOriginal(work):lifecycleOriginal,lookup=inspect||previous?.state==='unknown';
   if(kind==='continue'&&!lookup&&(!canContinue(work)||previous?.state==='accepted'))return;
   if(kind!=='continue'&&!lookup&&(kind==='archive'?controls?.canArchive!==true:controls?.canRestore!==true))return;
   if(inspect&&!previous)return;
   const botId=selectedId,ledgerId=gui.ledgerId,epoch=generation,controller=new AbortController();
   memory.current.controllers.add(controller);memory.current.busy=true;setControlBusy(true);
   const live=()=>!controller.signal.aborted&&memory.current.live.connected&&memory.current.live.generation===epoch&&memory.current.live.botId===botId&&memory.current.live.ledgerId===ledgerId;
   try{await operationLocks.request(controlStorageKey(ledgerId,botId),{mode:'exclusive',signal:controller.signal},async()=>{
    if(!live())return;const value=loadControlOperations(ledgerId,botId),rows=Object.values(value.operations);
    let op=kind==='continue'?rows.find(row=>row.kind==='continue'&&row.taskId===work.taskId&&row.sessionId===work.sessionId&&row.state==='unknown')
      ??value.operations[controlKey({kind,taskId:work.taskId,sessionId:work.sessionId,generation:work.generation})]
      :rows.filter(row=>row.kind!=='continue').sort((a,b)=>b.botEpoch-a.botEpoch).find(row=>row.state==='unknown');
    const query=inspect||op!==undefined;
    if(inspect&&!op){if(previous)op=value.operations[controlKey(previous)];if(!op)return;}
    if(!op){const latest=memory.current.live,gate=latest.controls;
     if(kind==='continue'){const actual=latest.work.find(row=>row.taskId===work.taskId&&row.sessionId===work.sessionId&&row.generation===work.generation);
      if(!latest.modelEnabled||actual?.preciseNativeSettlementVerified!==true||actual.held||actual.stop.state!=='none'
        ||!gate?.work.some(row=>row.taskId===work.taskId&&row.sessionId===work.sessionId&&row.generation===work.generation&&row.canContinue===true))return;
     }else if(kind==='archive'?gate?.canArchive!==true:gate?.canRestore!==true)return;
     if(Object.keys(value.operations).length>=64)return;
     op=cleanControlOperation({version:1,...ids(kind,botId),...kind==='continue'?{taskId:work.taskId,sessionId:work.sessionId,generation:work.generation}:{botEpoch:gate.botEpoch}},botId);
     value.operations[controlKey(op)]=op;operationStorage.setItem(controlStorageKey(ledgerId,botId),JSON.stringify(value));setControlOperations(value.operations);
    }
    if(!live())return;let next={...op,state:'unknown'};
    const endpoint=op.kind==='continue'?(query?'inspectWorkContinuation':'continueWork'):(query?'inspectBotLifecycle':op.kind==='archive'?'archiveBot':'restoreBot');
    try{const result=await guiCall(endpoint,controlFrame(op,query),controller.signal);if(live())next=controlReceipt(result,op);}catch{}
    const latest=loadControlOperations(ledgerId,botId),retained=latest.operations[controlKey(op)];
    if(retained?.operationId!==op.operationId||retained.nonce!==op.nonce)return;
    latest.operations[controlKey(op)]=cleanControlOperation({...next,state:live()?next.state:'unknown'},botId);
    operationStorage.setItem(controlStorageKey(ledgerId,botId),JSON.stringify(latest));
    if(live()){setControlOperations(latest.operations);setRefresh(n=>n+1);setGuiRefresh(n=>n+1);}
   });}catch{if(live())setControlReady(false);}finally{memory.current.controllers.delete(controller);memory.current.busy=false;setControlBusy(false);}
  }
  async function createBot(event,inspect=false){event?.preventDefault?.();if(!guiCurrent||creating||!inspect&&(!botName.trim()||botName.length>100||gui.selectedBotId))return;const controller=new AbortController(),ledgerId=gui.ledgerId,epoch=generation;memory.current.controllers.add(controller);setCreating(true);try{await operationLocks.request(createStorageKey(ledgerId),{mode:'exclusive',signal:controller.signal},async()=>{const live=()=>!controller.signal.aborted&&memory.current.live.connected&&memory.current.live.generation===epoch;if(!live())return;let op=loadCreate(ledgerId);if(inspect&&!op)return;if(!op)op={version:1,ledgerId,operationId:globalThis.crypto.randomUUID(),nonce:globalThis.crypto.randomUUID(),state:'unknown'};const lookup=inspect||loadCreate(ledgerId)!==null;operationStorage.setItem(createStorageKey(ledgerId),JSON.stringify(op));setCreateOp(op);let next;try{const result=await guiCall(lookup?'reconcileCreate':'createBot',lookup?{operationId:op.operationId,nonce:op.nonce}:{operationId:op.operationId,nonce:op.nonce,name:botName},controller.signal);next=live()?createReceipt(result,op):{...op,state:'unknown'};}catch{next={...op,state:'unknown'};}const retained=loadCreate(ledgerId);if(retained.operationId!==op.operationId||retained.nonce!==op.nonce)return;operationStorage.setItem(createStorageKey(ledgerId),JSON.stringify(next));if(live()){setCreateOp(next);setGuiRefresh(n=>n+1);}});}catch{setGui({status:'owner_unavailable'});}finally{memory.current.controllers.delete(controller);setCreating(false);}}
  const previousUnconfirmed=current&&owned.contact.generation!=null&&owned.contact.generationObservation?.settlementVerified!==true;
  const writeBlocked=!current||owned.readOnly===true||!identityReady||memory.current.busy||receipt?.state==='unknown'||previousUnconfirmed||!!guiCall&&(!guiCurrent||!gui.modelRequestsEnabled),label=s=>t(s==='durably-queued'?'durably_queued':s==='waiting'?'work_waiting':s);
  const rows=(key,items,kind)=>h('div',{className:'dsh-bot-overview'},h('h3',null,t(key)),items.length?h('ul',null,...items.map(item=>h('li',{key:kind==='bot'?item.botId:item.taskId},kind==='bot'?`${item.name} · ${t(item.lifecycle)} · ${t(item.readiness)}`:`${item.title} · ${t(item.responsibility)} · ${t(item.stop.state)}`))):h('p',null,t('empty')));
  const panelCss='[data-dsh-bot-panel]{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e293b}[data-dsh-bot-panel] h1{font-size:28px;line-height:1.3;margin:0;font-weight:650}[data-dsh-bot-panel] h2{font-size:20px;margin:30px 0 8px;font-weight:650}[data-dsh-bot-panel] h3,[data-dsh-bot-panel] h4{font-size:16px;margin:0 0 8px;font-weight:600}[data-dsh-bot-panel] p{margin:8px 0 14px}[data-dsh-bot-panel] label{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-weight:500}[data-dsh-bot-panel] input,[data-dsh-bot-panel] select,[data-dsh-bot-panel] textarea{font:inherit;border:1px solid #cbd5e1;border-radius:9px;padding:9px 12px;background:#fff;color:#1e293b}[data-dsh-bot-panel] textarea{min-height:112px;resize:vertical;display:block;margin:12px 0}[data-dsh-bot-panel] input:focus,[data-dsh-bot-panel] select:focus,[data-dsh-bot-panel] textarea:focus{outline:2px solid #bfdbfe;outline-offset:2px;border-color:#60a5fa}[data-dsh-bot-panel] button{font:inherit;font-size:14px;padding:8px 14px;margin:4px 8px 4px 0;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;color:#334155}[data-dsh-bot-panel] button:hover:enabled{background:#f1f5f9}[data-dsh-bot-panel] button.dsh-bot-primary{background:#2563eb;color:#fff;border-color:#2563eb}[data-dsh-bot-panel] button.dsh-bot-primary:hover:enabled{background:#1d4ed8}[data-dsh-bot-panel] button:disabled{background:#f1f5f9;color:#94a3b8;border-color:#e2e8f0;cursor:not-allowed}[data-dsh-bot-panel] textarea:disabled{background:#f8fafc}[data-dsh-bot-panel] details,.dsh-bot-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:16px 18px;margin:16px 0}[data-dsh-bot-panel] summary{cursor:pointer;font-weight:600}[data-dsh-bot-panel] small{color:#64748b;overflow-wrap:anywhere}[data-dsh-bot-panel] article p{white-space:pre-wrap;overflow-wrap:anywhere}[data-dsh-bot-panel] code{font-size:12px;overflow-wrap:anywhere}[data-dsh-bot-panel] ul{padding-left:20px}.dsh-bot-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.dsh-bot-connection{border-radius:999px;background:#f1f5f9;color:#64748b;font-size:13px;padding:4px 12px;white-space:nowrap}.dsh-bot-connection.is-connected{background:#dcfce7;color:#166534}.dsh-bot-notice{border-radius:9px;background:#eff6ff;padding:10px 14px;color:#1e40af;font-size:14px}.dsh-bot-overview{margin:20px 0}.dsh-bot-help{font-size:13px;color:#64748b;margin-top:24px!important}';
  return h('section',{'data-dsh-bot-panel':'','aria-label':t('title'),style:{padding:'32px 24px',maxWidth:'940px',margin:'0 auto',lineHeight:1.7}},
   h('style',null,panelCss),h('header',{className:'dsh-bot-header'},h('h1',null,t('title')),h('span',{'data-dsh-bot-connection':'',className:'dsh-bot-connection'+(connected?' is-connected':''),role:'status'},t(Object.hasOwn(en,state)?state:'unstarted'))),
   guiCurrent&&!gui.selectedBotId?h('form',{'data-dsh-bot-create-form':'',className:'dsh-bot-card',onSubmit:createBot},h('label',null,t('bot_name'),h('input',{'data-dsh-bot-create-name':'',value:botName,maxLength:100,disabled:creating,onChange:e=>setBotName(e.target.value)})),h('button',{'data-dsh-bot-create':'',className:'dsh-bot-primary',type:'submit',disabled:creating||!botName.trim()||createOp?.state==='unknown'},t('create_bot'))):null,
   guiCurrent&&createOp?h('div',{'data-dsh-bot-create-receipt':createOp.state,className:'dsh-bot-notice',role:'status'},h('p',null,t(createOp.state==='created'?'create_created':'create_unknown')),createOp.state==='unknown'?h('button',{'data-dsh-bot-create-reconcile':'',type:'button',disabled:creating,onClick:()=>createBot(null,true)},t('reconcile')):null):null,
   guiCurrent&&!gui.modelRequestsEnabled?h('p',{'data-dsh-bot-model-disabled':'',className:'dsh-bot-notice'},t(gui.modelDispatchStatus==='unconfirmed'?'continuation_unconfirmed':'model_disabled')):null,
   visible.status==='ready'?h('div',{'data-dsh-bot-read-status':'ready'},rows('bots',visible.bot,'bot'),!guiCall||visible.task.length?rows('tasks',visible.task,'task'):null):h('p',{'data-dsh-bot-read-status':visible.status,role:'status'},t(visible.status)),
   h('label',null,t('selected_bot'),h('select',{'data-dsh-bot-select':'',value:selectedId,disabled:!connected,onChange:e=>{for(const c of memory.current.controllers)c.abort();setSelectedId(e.target.value);}},...(visible.bot??[]).map(b=>h('option',{key:b.botId,value:b.botId},b.name)))),
   guiCurrent&&selectedId?h('article',{'data-dsh-bot-lifecycle':controls?.lifecycle??'unknown',className:'dsh-bot-card'},h('h2',null,t('bot_controls')),
    h('button',{'data-dsh-bot-archive':'',type:'button',disabled:!controlReady||!identityReady||controlBusy||memory.current.busy||controls?.canArchive!==true||lifecycleOriginal?.state==='unknown',onClick:()=>controlAction('archive')},t('archive_bot')),
    h('button',{'data-dsh-bot-restore':'',type:'button',disabled:!controlReady||!identityReady||controlBusy||memory.current.busy||controls?.canRestore!==true||lifecycleOriginal?.state==='unknown',onClick:()=>controlAction('restore')},t('restore_bot')),
    lifecycleOriginal?h('p',{'data-dsh-bot-lifecycle-receipt':lifecycleOriginal.state,role:'status'},t(lifecycleOriginal.state==='unknown'?'control_unknown':lifecycleOriginal.kind+'_accepted')):null,
    lifecycleOriginal?.state==='unknown'?h('button',{'data-dsh-bot-lifecycle-reconcile':'',type:'button',disabled:!controlReady||controlBusy||memory.current.busy,onClick:()=>controlAction(lifecycleOriginal.kind,null,true)},t('reconcile')):null,
    h('p',{className:'dsh-bot-help'},t('control_hint'))):null,
   h('h2',null,t('main_goal')),h('p',null,t('goal_hint')),h('form',{'data-dsh-bot-goal-form':'',onSubmit:submit},h('textarea',{'data-dsh-bot-goal':'','aria-label':t('main_goal'),placeholder:t('goal_placeholder'),value:goal,maxLength:500,rows:3,disabled:writeBlocked,onChange:e=>setGoal(e.target.value),style:{width:'100%',boxSizing:'border-box'}}),h('button',{'data-dsh-bot-submit':'',className:'dsh-bot-primary',type:'submit',disabled:writeBlocked||!goal.trim()},t('send'))),
   previousUnconfirmed?h('p',{className:'dsh-bot-notice'},t('previous_unconfirmed')):null,
   current&&owned.contact.generation!=null?h('p',{'data-dsh-bot-contact-generation':nativeState(owned.contact.generationObservation),role:'status'},`${t('latest_processing')}: ${t(nativeLabel(owned.contact.generationObservation))} · ${t('generation')} ${owned.contact.generation}`):null,
   !current?h('p',{'data-dsh-bot-owner-status':owned.status},t(guiCurrent&&!gui.selectedBotId?'create_first':'owner_unavailable')):h('button',{type:'button',onClick:()=>setRefresh(n=>n+1)},t('refresh')),
   operationCurrent?h('div',{'data-dsh-bot-receipt':receipt.state,className:'dsh-bot-card',role:'status'},h('h3',null,t('receipt')),h('p',null,label(receipt.state)),h('details',null,h('summary',null,t('receipt_details')),h('code',null,receipt.messageId??receipt.operationId)),h('button',{'data-dsh-bot-reconcile':'',type:'button',disabled:!current||!identityReady||memory.current.busy,onClick:reconcile},t('reconcile')),h('button',{'data-dsh-bot-contact-stop':'',type:'button',disabled:!current||!identityReady||(owned.readOnly===true&&contactStopReceipt?.state!=='unknown')||(contactStopReceipt?.state!=='unknown'&&(owned.contact?.status!=='running'||!receipt.messageId))||contactStopReceipt?.state==='sending'||contactStopReceipt?.state==='accepted',onClick:stopContact},contactStopReceipt?label(contactStopReceipt.state):t('contact_stop'))):null,
   current&&owned.contact.reply?h('article',{'data-dsh-bot-main-reply':owned.contact.reply.messageId,className:'dsh-bot-card'},h('h3',null,t('reply')),h('p',null,owned.contact.reply.text),h('small',null,`${t('turn')} ${owned.contact.reply.turn}`)):null,
   h('h2',null,t('work')),current?h('div',{'data-dsh-bot-work-list':''},h('p',null,`${t('held')}: ${owned.held}/${owned.limit}`),...(owned.work.length?owned.work.map(w=>h('details',{'data-dsh-bot-work-detail':w.taskId,key:w.taskId},h('summary',null,`${w.task_id} · ${label(w.state)}${w.stop.state==='accepted'?' · '+t('accepted'):''}`),h('p',null,w.goal),h('p',null,`${t('completion')}: ${w.completion_condition}`),h('p',null,`${t('state')}: ${label(w.state)} · ${t(w.held?'retained':w.preciseNativeSettlementVerified?'released':'unoccupied')} · ${t('generation')} ${w.generation}`),w.generationObservation?h('p',{'data-dsh-bot-work-generation':nativeState(w.generationObservation),role:'status'},t(nativeLabel(w.generationObservation))):null,h('small',null,w.sessionId),w.result?h('article',{'data-dsh-bot-work-result':w.result.responseMessageId},h('h4',null,t('result')),h('p',null,w.result.text),h('small',null,`${t('turn')} ${w.result.turn}`)):null,guiCall?h('button',{'data-dsh-bot-work-continue':w.taskId,type:'button',disabled:!current||!controlReady||!identityReady||controlBusy||memory.current.busy||(workOriginal(w)?.state!=='unknown'&&(!canContinue(w)||workOriginal(w)?.state==='accepted')),onClick:()=>controlAction('continue',w)},t(workOriginal(w)?.state==='unknown'?'reconcile':'work_continue')):null,
    guiCall&&workOriginal(w)?h('p',{'data-dsh-bot-work-continuation':workOriginal(w).state,role:'status'},t(workOriginal(w).state==='unknown'?'control_unknown':'continue_accepted')):null,
    h('button',{'data-dsh-bot-work-stop':w.taskId,type:'button',disabled:!current||!identityReady||(owned.readOnly===true&&stopReceipts[workStopKey(w)]?.state!=='unknown')||(w.preciseNativeSettlementVerified&&stopReceipts[workStopKey(w)]?.state!=='unknown')||(w.stop.state==='accepted'&&stopReceipts[workStopKey(w)]?.state!=='unknown')||stopReceipts[workStopKey(w)]?.state==='sending'||stopReceipts[workStopKey(w)]?.state==='accepted',onClick:()=>stopWork(w)},stopReceipts[workStopKey(w)]?.state==='unknown'?t('reconcile'):t('work_stop')),stopReceipts[workStopKey(w)]?h('p',{role:'status'},label(stopReceipts[workStopKey(w)].state)):null)): [h('p',{key:'empty'},t(guiCall?'empty_work':'empty'))])):h('p',null,t(guiCurrent&&!gui.selectedBotId?'create_first':'owner_unavailable')),
   h('p',{className:'dsh-bot-help'},t('held_hint')),!guiCall?h('p',null,t('scope')):null);
 }
  function BotIcon({ size }) {
   return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
    h('rect', { x: 4, y: 6, width: 16, height: 14, rx: 4 }),
    h('path', { d: 'M12 2v4M8 15h8M8 10v2M16 10v2' }));
  }

 function apply(ctx,config={}){let closed=false;const pending=new Set();ctx.effect(()=>()=>{closed=true;for(const controller of pending)controller.abort();pending.clear();},'dsh-bot: RPC calls');
  async function rpc(channel,endpoint,payload,signal){if(closed||signal.aborted)throw cancelledRead;const controller=new AbortController(),abort=()=>controller.abort();pending.add(controller);signal.addEventListener('abort',abort,{once:true});try{const result=await ctx.connection.rpc.call(channel,endpoint,payload,controller.signal);if(closed||controller.signal.aborted)throw cancelledRead;return result;}finally{signal.removeEventListener('abort',abort);pending.delete(controller);}}
  const read=signal=>rpc('/dsh-bot','snapshot',{},signal),ownerCall=(endpoint,botId,payload,signal)=>rpc('/dsh-bot-owner',endpoint,{command:endpoint,botId,payload},signal);
  const guiMode=config.guiOwner===true||globalThis.__DSH_BOOT__?.entries?.some(entry=>entry.id==='dsh-bot-gui-surface')===true;
  const guiCall=guiMode?(endpoint,payload,signal)=>rpc('/dsh-bot-gui',endpoint,payload,signal):undefined;
  if(guiCall){
   const absent=Object.freeze({key:undefined,hooks:Object.freeze({session:undefined}),keyedHooks:Object.freeze({projection:undefined}),props:Object.freeze({sessionId:undefined})});
   const source=Object.freeze({getSnapshot:()=>absent,subscribe:()=>()=>{}});
   const roster=Object.freeze({byId:Object.freeze({})});
   ctx.slots.provideRoot({hooks:{sessions:Object.freeze({getSnapshot:()=>roster,subscribe:()=>()=>{}})}});
   ctx.slots.installScope('session',{current:source,bindingSource:target=>{if(target!==undefined)throw Error('dsh-bot: ordinary Session UI unavailable');return source;},renderArea:(_binding,props)=>props.empty?.()??null});
  }
  ctx.effect(()=>ctx.locale.register(namespace,{en,zh}),'dsh-bot: dictionaries');const t=ctx.locale.bind(namespace);
  ctx.slots.inject('main',()=>{const remove=ctx.slots.register({name:'main',key:panelId,locale:namespace,inject:()=>({hooks:{connection:ctx.connection.state,generation:ctx.connection.generation},read,ownerCall,guiCall})},BotPanel);if(guiCall)ctx.layout.selectPanel(panelId);return remove;});
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:panelId,order:70,label:()=>t('nav'),locale:namespace},BotIcon));
 }
 return{name:'dsh-bot-client',inject:['slots','layout','locale','connection'],apply};
}});
