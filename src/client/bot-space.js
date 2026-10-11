// Maintained source. scripts/build-client.mjs embeds this one exported factory.
export function createBotSpace(deps) {
  const {React,ctx,useView,command,query,botLabel,stateName,openSession,onManage,styles}=deps;
  const {createElement:h,useState,useEffect,useRef,useSyncExternalStore}=React;
  const absentStatus=new Map();
  const absentSessions={byId:{},projectionsBySession:{}};
  const releases=new Set();
  let alive=true;
  ctx.effect(()=>()=>{alive=false;for(const release of [...releases])release();});
  const rows=value=>Array.isArray(value)?value:Object.values(value??{});
  const contact=(snapshot,botId,sessionId)=>snapshot.bots?.some(bot=>bot.botId===botId&&!bot.deletedAt)
    && snapshot.sessions?.find(row=>row.botId===botId&&row.sessionId===sessionId&&row.purpose==='contact'&&row.state==='ready'&&!row.archived);
  const avatar=(name,id)=>h('span',{className:'bs-avatar','aria-hidden':true,style:{'--bs-avatar':[...String(id)].reduce((n,c)=>(n*31+c.charCodeAt(0))%360,0)}},[...String(name||'B')][0]);
  const label=(title,name,extra={})=>h('label',{className:'bs-field'},title,h(extra.textarea?'textarea':extra.options?'select':'input',{
    className:extra.textarea?'bs-textarea':extra.options?'bs-select':'bs-input',name,'aria-label':title,required:true,...extra,
    textarea:undefined,options:undefined,
  },...(extra.options??[]).map(row=>h('option',{key:row.value,value:row.value},row.label))));
  const criteria=data=>String(data.get('criteria')??'').split('\n').map(s=>s.trim()).filter(Boolean);
  function FixedChatViews(props){return props.renderSlot('conversation.session',{view:'chat'});}
  function NativeConversation({sessionId,useSession,useConversation,useSessions,renderFactorySlot}) {
    const session=useSession(s=>s),conversation=useConversation(s=>s);
    const blank=useSessions(s=>s.byId[sessionId]?.blank);
    const active=conversation.activeTargets.size>0||(!session.blank&&!session.awaitingFirstTurn)||session.running;
    const vacant=!active&&!session.promptAttempted;
    const settling=vacant&&session.openState==='loading'&&blank!==true;
    const hero=vacant&&(session.openState==='open'||blank===true);
    return renderFactorySlot('conversation.content',{variant:'embedded',phase:settling?'settling':hero?'hero':'active',hero},{slots:{views:FixedChatViews}});
  }
  const question=pending=>['question','plan-review'].includes(pending?.kind)&&typeof pending.key==='string'&&typeof pending.subscribe==='function'&&typeof pending.getSnapshot==='function';
  const unfinished=pending=>question(pending)&&!pending.getSnapshot().closed&&pending.review===undefined;
  const liveInteraction=(pending,id)=>pending?.sessionId===id&&(pending.kind==='approval'?pending.answerable===true:unfinished(pending)&&((pending.getSnapshot().state==='open'&&pending.getSnapshot().channel==='waterfall')||(pending.getSnapshot().state==='continued'&&pending.getSnapshot().channel==='rpc')));
  const channelKey=target=>JSON.stringify([target.sessionId,target.botId,target.groupId,target.purpose,target.roundId,target.meetingId,target.epoch,target.phase,target.memberEpoch]);
  function usePendingSnapshots(cards) {
    const cache=useRef({cards:[],snapshots:[]});
    return useSyncExternalStore(listener=>{const cleanups=cards.map(card=>card.subscribe(listener));return()=>cleanups.forEach(cleanup=>cleanup());},()=>{
      const snapshots=cards.map(card=>card.getSnapshot()),old=cache.current;
      if(old.cards.length!==cards.length||cards.some((card,i)=>old.cards[i]!==card||old.snapshots[i]!==snapshots[i]))cache.current={cards,snapshots};
      return cache.current;
    },()=>cache.current);
  }
  function NativeInteraction({sessionId,pending,useSessionStatus,renderFactorySlot,isPending}) {
    const actual=useSessionStatus(snapshot=>snapshot.get(sessionId)?.pendingInteraction);
    usePendingSnapshots(question(pending)?[pending]:[]);
    if(actual!==pending||!liveInteraction(actual,sessionId)||!isPending())return null;
    return renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},{slots:{views:()=>null,widthControls:()=>null}});
  }
  function currentChannels(snapshot,groupId) {
    const group=rows(snapshot.groups).find(row=>row.groupId===groupId);if(!group)return [];
    const targets=[];
    const add=(id,identity)=>{
      const binding=rows(snapshot.sessions).find(row=>row.sessionId===id&&!row.archived&&['creating','ready'].includes(row.state));
      const member=rows(group.members).find(row=>row.botId===binding?.botId&&row.active);
      if(!binding||!member||binding.lineage?.groupId!==groupId||binding.lineage.memberEpoch!==member.epoch)return;
      if(identity.roundId&&(binding.purpose!=='group'||binding.lineage.roundId!==identity.roundId))return;
      if(identity.meetingId&&(binding.purpose!==(identity.phase==='independent'?'independent':'meeting')||binding.lineage.meetingId!==identity.meetingId||binding.lineage.epoch!==identity.epoch||binding.lineage.phase!==identity.phase||identity.memberEpoch!==member.epoch||identity.botId!==binding.botId))return;
      targets.push({...identity,sessionId:id,botId:binding.botId,purpose:binding.purpose,groupId,bindingState:binding.state,memberEpoch:member.epoch});
    };
    for(const round of rows(group.rounds))if(round.state==='running')for(const id of rows(round.channels))add(id,{roundId:round.roundId});
    for(const meeting of rows(snapshot.meetings))if(meeting.groupId===groupId&&!['cancelled','complete'].includes(meeting.phase))for(const participant of rows(meeting.participants))if(participant.active)add(participant.sessionId,{meetingId:meeting.meetingId,epoch:meeting.epoch,phase:meeting.phase,memberEpoch:participant.memberEpoch,botId:participant.botId});
    return targets;
  }
  function QuestionRecovery({target,onReference,onError}) {
    useEffect(()=>{
      if(!alive)return;
      const abort=new AbortController();let reference,released=false;
      const release=()=>{if(released)return;released=true;abort.abort();releases.delete(release);reference?.release();onReference(null,reference);};
      try{reference=ctx.sessions.retain(target.sessionId,{source:'botSpace',signal:abort.signal});releases.add(release);onReference(reference);
        Promise.resolve(reference.ready).catch(failure=>{if(!released){onError(`问答接续连接失败：${failure.message}`);release();}});
      }catch(failure){onError(`问答接续连接失败：${failure.message}`);release();}
      return release;
    },[]);
    return null;
  }
  function InteractionPane({target,SessionProvider,renderSlot,isPending,onClose,returnFocus,onError,recoveryReference,recovering}) {
    const [reference,setReference]=useState(null);
    useEffect(()=>{
      if(target.pending.kind!=='plan-review'||!isPending())return;
      let disposed=false,stop;
      const release=()=>{if(disposed)return;disposed=true;releases.delete(release);stop?.();};
      try{stop=ctx.slots.register({name:'conversation.plan-review.actions',id:'@deepseek-ai/dsh-client-ui-plan',priority:-1},()=>null);releases.add(release);}
      catch(failure){onError(`无法限定原生计划预览：${failure.message}`);}
      return release;
    },[target.sessionId,target.pending]);
    useEffect(()=>{
      if(!alive||!isPending()||recovering)return;
      const abort=new AbortController();let lease,released=false;
      const release=()=>{if(released)return;released=true;abort.abort();releases.delete(release);lease?.release();};
      try{lease=ctx.sessions.retain(target.sessionId,{source:'botSpace',signal:abort.signal});releases.add(release);
        if(!isPending()){release();return;}
        setReference(lease);
        Promise.resolve(lease.ready).then(()=>{if(!isPending())release();}).catch(failure=>{if(!released&&isPending()){onError(`无法打开待确认操作：${failure.message}`);onClose();}release();});
      }catch(failure){if(isPending()){onError(`无法打开待确认操作：${failure.message}`);onClose();}release();}
      return release;
    },[target.sessionId,target.pending,recovering]);
    if(!isPending())return null;
    return h(SpaceDialog,{title:'待确认操作',onClose,returnFocus},h('p',{className:'bs-meta'},`${target.identityLabel} · ${target.sessionId}`),
      target.pending.kind==='plan-review'&&h('section',{className:'bs-plan-document','aria-label':'完整原生计划'},h('h3',null,'完整原生计划'),...rows(target.pending.questions).filter(row=>typeof row.detail==='string').map(row=>h('pre',{key:row.id},row.detail))),
      h('div',{className:'bs-native bs-interaction','data-session-id':target.sessionId,'data-interaction-kind':target.pending.kind},h(SessionProvider,{session:recoveryReference??reference??undefined,key:target.sessionId,empty:()=>h('p',{role:'status'},'正在打开原生待确认操作…')},renderSlot('dsh.bot-space.interaction',{sessionId:target.sessionId,pending:target.pending,isPending}))));
  }
  function SpaceDialog({title,children,onClose,returnFocus}) {
    const element=useRef(null);
    useEffect(()=>{const dialog=element.current;dialog?.showModal?.();return()=>{dialog?.close?.();returnFocus?.focus?.();};},[]);
    return h('dialog',{ref:element,className:'bs-modal','aria-label':title,onCancel:event=>{event.preventDefault();onClose();},onClick:event=>{if(event.target===event.currentTarget)onClose();},onKeyDown:event=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const controls=[...(event.currentTarget.querySelectorAll?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[])];
        if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
        else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
      }
    }},h('div',{className:'bs-modal-body'},h('header',{className:'bs-modal-header'},h('h2',null,title),h('button',{type:'button',className:'bs-icon-button','aria-label':'关闭弹层',onClick:onClose},'×')),children));
  }
  function BotSpace({SessionProvider,renderSlot}) {
    const view=useView(),snapshot=view.snapshot,storeId=snapshot.storeId;
    const [selection,setSelection]=useState(null),[search,setSearch]=useState(''),[owned,setOwned]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const [dialog,setDialog]=useState(null),[interaction,setInteraction]=useState(null),[members,setMembers]=useState([]),[drafts,setDrafts]=useState({}),[visible,setVisible]=useState({}),[railOpen,setRailOpen]=useState(false),[contextOpen,setContextOpen]=useState(false),[contextCollapsed,setContextCollapsed]=useState(false),[unread,setUnread]=useState(false),[recoveryReferences,setRecoveryReferences]=useState({});
    const latest=useRef(view),intent=useRef(0),mounted=useRef(true),composing=useRef(false),draftRef=useRef(drafts),draftRevision=useRef({}),sent=useRef(new Set()),scroll=useRef(null),follow=useRef(true),lastMessages=useRef(null),current=useRef(selection),element=useRef(null),rail=useRef(null),context=useRef(null),drawerTrigger=useRef(null);
    latest.current=view;current.current=selection;draftRef.current=drafts;
    const statusSource=ctx.uiSession?.sessionStatus;
    const statuses=useSyncExternalStore(listener=>statusSource?.subscribe(listener)??(()=>{}),()=>statusSource?.getSnapshot()??absentStatus,()=>absentStatus);
    const generationSource=ctx.connection?.generation;
    const generation=useSyncExternalStore(listener=>generationSource?.subscribe(listener)??(()=>{}),()=>generationSource?generationSource.getSnapshot():null,()=>null);
    const sessionsSource=ctx.sessions.list;
    const nativeSessions=useSyncExternalStore(listener=>sessionsSource?.subscribe(listener)??(()=>{}),()=>sessionsSource?.getSnapshot()??absentSessions,()=>absentSessions);
    const known=useRef({storeId,generation,groupId:null,cards:new Map()}),projectionBaseline=useRef({storeId,generation,ids:new Map()});
    const selected=selection&&selection.storeId===storeId&&selection.generation===generation?selection:null;
    const bot=selected?.kind==='bot'?snapshot.bots?.find(row=>row.botId===selected.id&&!row.deletedAt):null;
    const group=selected?.kind==='group'?snapshot.groups?.find(row=>row.groupId===selected.id):null;
    const validSession=bot&&selected.sessionId?contact(snapshot,bot.botId,selected.sessionId):null;
    const sessionId=validSession?.sessionId;
    const name=bot?botLabel(bot):group?.name??'Bot 空间';
    const botTasks=bot?rows(snapshot.tasks).filter(row=>row.botId===bot.botId&&!row.archived):[];
    const meetings=group?rows(snapshot.meetings).filter(row=>row.groupId===group.groupId):[];
    const actionIds=new Set(meetings.flatMap(meeting=>rows(meeting.actions).map(action=>typeof action==='string'?action:action.taskId)));
    const tasks=group?rows(snapshot.tasks).filter(task=>actionIds.has(task.taskId)):botTasks;
    const activeBots=rows(snapshot.bots).filter(row=>!row.deletedAt&&row.lifecycle==='active');
    const channels=group?currentChannels(snapshot,group.groupId):[];
    if(known.current.storeId!==storeId||known.current.generation!==generation||known.current.groupId!==group?.groupId)known.current={storeId,generation,groupId:group?.groupId,cards:new Map()};
    for(const [key,target] of known.current.cards)if(!unfinished(target.pending)||!channels.some(channel=>channelKey(channel)===channelKey(target)))known.current.cards.delete(key);
    const published=channels.map(target=>({...target,pending:statuses.get(target.sessionId)?.pendingInteraction}));
    for(const target of published)if(target.pending?.sessionId===target.sessionId&&unfinished(target.pending)&&typeof target.pending.callId==='string')known.current.cards.set(target.pending.key,target);
    const cards=[...new Set([...published.map(target=>target.pending),...[...known.current.cards.values()].map(target=>target.pending)].filter(question))];
    usePendingSnapshots(cards.filter(unfinished));
    const pendingTargets=published.filter(target=>target.bindingState==='ready'&&liveInteraction(target.pending,target.sessionId));
    const hiddenTargets=[...known.current.cards.values()].filter(target=>unfinished(target.pending)&&statuses.get(target.sessionId)?.pendingInteraction!==target.pending);
    const continuedTargets=channels.filter(target=>{
      if(target.bindingState!=='ready')return false;
      const values=nativeSessions.projectionsBySession?.[target.sessionId]?.values??nativeSessions.byId?.[target.sessionId]?.projectionValues;
      const queued=new Set([...rows(values?.inbox?.['next-step']),...rows(values?.inbox?.['next-turn'])].filter(row=>row?.source?.kind==='user-question-reply').map(row=>row.source.callId));
      return rows(values?.userQuestions?.active).some(row=>row.state==='continued'&&typeof row.callId==='string'&&!queued.has(row.callId)&&!cards.some(card=>card.sessionId===target.sessionId&&card.callId===row.callId&&!unfinished(card)));
    });
    const recoveryTargets=[...new Map([...known.current.cards.values(),...continuedTargets].filter(target=>target.bindingState==='ready'||question(target.pending)).map(target=>[target.sessionId,target])).values()];
    const inScope=target=>alive&&mounted.current&&latest.current.snapshot.storeId===target.storeId&&target.generation===(generationSource?generationSource.getSnapshot():null)&&current.current?.generation===target.generation&&current.current?.kind==='group'&&current.current.id===target.groupId&&currentChannels(latest.current.snapshot,target.groupId).some(channel=>channelKey(channel)===channelKey(target));
    const pendingActive=()=>interaction&&inScope(interaction)&&currentChannels(latest.current.snapshot,interaction.groupId).some(target=>target.sessionId===interaction.sessionId&&target.bindingState==='ready')&&(statusSource?.getSnapshot()??absentStatus).get(interaction.sessionId)?.pendingInteraction===interaction.pending&&liveInteraction(interaction.pending,interaction.sessionId);
    const interactionCurrent=interaction&&interaction.storeId===storeId&&interaction.generation===generation&&group?.groupId===interaction.groupId&&pendingTargets.some(target=>target.sessionId===interaction.sessionId&&target.pending===interaction.pending);
    useEffect(()=>{if(interaction&&!interactionCurrent)setInteraction(null);},[interaction,interactionCurrent]);
    const currentChannelIds=JSON.stringify(channels.filter(target=>target.bindingState==='ready').map(target=>target.sessionId).sort());
    useEffect(()=>{
      if(projectionBaseline.current.generation!==generation||projectionBaseline.current.storeId!==storeId)projectionBaseline.current={storeId,generation,ids:new Map()};
      if(!ctx.sessions.refreshProjections)return;
      for(const id of JSON.parse(currentChannelIds))if(!projectionBaseline.current.ids.has(id)){
        const baseline=projectionBaseline.current,admission={};baseline.ids.set(id,admission);
        const failed=failure=>{
          if(baseline.ids.get(id)!==admission)return;
          baseline.ids.delete(id);
          if(alive&&mounted.current&&latest.current.snapshot.storeId===storeId&&current.current?.generation===generation&&current.current?.kind==='group'&&current.current.id===group?.groupId)setError(`无法核对问答接续状态：${failure.message??'原生投影读取失败'}`);
        };
        try{Promise.resolve(ctx.sessions.refreshProjections(id)).then(()=>{const projection=sessionsSource?.getSnapshot().projectionsBySession?.[id];if(projection?.state==='error')failed(projection.error??{});}).catch(failed);}
        catch(failure){failed(failure);}
      }
    },[currentChannelIds,generation,storeId,selected]);
    const keyFor=(groupId,profile=storeId)=>`${profile}\u0000${groupId}`;
    const groupKey=group?keyFor(group.groupId):null;
    const draft=groupKey?drafts[groupKey]??'':'';
    const updateDraft=(key,text)=>{draftRevision.current[key]=(draftRevision.current[key]??0)+1;draftRef.current={...draftRef.current,[key]:text};setDrafts(draftRef.current);};
    const available=(kind,id,profile)=>alive&&mounted.current&&latest.current.snapshot.storeId===profile&&rows(kind==='bot'?latest.current.snapshot.bots:latest.current.snapshot.groups).some(row=>(kind==='bot'?row.botId:row.groupId)===id&&!row.deletedAt);
    const isCurrent=(token,kind,id,profile)=>available(kind,id,profile)&&token===intent.current&&current.current?.generation===(generationSource?generationSource.getSnapshot():null)&&(!generationSource||!!generationSource.getSnapshot())&&current.current?.kind===kind&&current.current?.id===id&&current.current?.storeId===profile;
    const closeDrawers=()=>{setRailOpen(false);setContextOpen(false);};
    const openDrawer=(kind,event)=>{drawerTrigger.current=event.currentTarget;if(kind==='rail'){setRailOpen(true);setContextOpen(false);}else{setContextOpen(true);setRailOpen(false);}};
    const select=(kind,id)=>{intent.current++;const next={storeId,generation,kind,id,sessionId:null};current.current=next;setSelection(next);setError('');setNotice('');if(railOpen)closeDrawers();follow.current=true;setUnread(false);};
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;intent.current++;};},[]);
    useEffect(()=>{intent.current++;setDialog(null);setMembers([]);setError('');setNotice('');},[storeId]);
    useEffect(()=>{if(railOpen||contextOpen){const container=railOpen?rail.current:context.current;container?.querySelector?.('button:not(:disabled),input:not(:disabled),[tabindex="0"]')?.focus?.();}else{
      const trigger=drawerTrigger.current;
      if(trigger&&(!trigger.getClientRects||trigger.getClientRects().length))trigger.focus?.();
      else if(trigger)[...(element.current?.querySelectorAll?.('.bs-main button:not(:disabled),.bs-main [tabindex="0"]')??[])].find(node=>!node.getClientRects||node.getClientRects().length)?.focus?.();
      drawerTrigger.current=null;
    }},[railOpen,contextOpen]);
    useEffect(()=>{
      if((!railOpen&&!contextOpen)||!element.current)return;
      let watching=true;
      const resize=width=>{if(!watching)return;if(railOpen&&width>=840)setRailOpen(false);if(contextOpen&&width>=1180)setContextOpen(false);};
      resize(element.current.getBoundingClientRect?.().width??0);
      if(typeof globalThis.ResizeObserver!=='function')return;
      const observer=new globalThis.ResizeObserver(entries=>{const entry=entries.find(row=>row.target===element.current);if(entry)resize(entry.contentRect.width);});
      observer.observe(element.current);return()=>{watching=false;observer.disconnect();};
    },[railOpen,contextOpen]);
    useEffect(()=>{
      setOwned(null);
      if(!sessionId||!alive)return;
      const token=intent.current,profile=storeId,botId=bot.botId,abort=new AbortController();let reference,released=false;
      const active=()=>!released&&!abort.signal.aborted&&isCurrent(token,'bot',botId,profile)&&!!contact(latest.current.snapshot,botId,sessionId)&&current.current?.sessionId===sessionId;
      const release=()=>{if(released)return;released=true;abort.abort();releases.delete(release);reference?.release();};
      try {
        reference=ctx.sessions.retain(sessionId,{source:'botSpace',signal:abort.signal});releases.add(release);
        if(!active()){release();return;}
        setOwned({storeId:profile,botId,sessionId,reference});
        Promise.resolve(reference.ready).then(binding=>{if(active())ctx.uiConversation.binding(binding).activate('chat');}).catch(failure=>{
          if(active()){setError(`无法打开原生会话：${failure.message}`);setOwned(null);release();}
        });
      } catch(failure){if(active()){setError(`无法打开原生会话：${failure.message}`);setOwned(null);}release();}
      return release;
    },[sessionId,storeId,bot?.botId,generation]);
    const chooseSession=async id=>{
      if(!bot||!contact(latest.current.snapshot,bot.botId,id))return;
      const botId=bot.botId,profile=storeId,token=++intent.current;
      const valid=()=>isCurrent(token,'bot',botId,profile);
      const waiting={storeId:profile,generation,kind:'bot',id:botId,sessionId:null};current.current=waiting;setSelection(waiting);
      setError('');setNotice('正在核对原会话…');
      const remote=await query('snapshot',{},valid);
      if(!valid())return;
      if(!remote||remote.storeId!==profile||!contact(remote,botId,id)||!contact(latest.current.snapshot,botId,id)){
        setNotice('');setError('此聊天已归档、Bot 已删除或不可用，请重新选择。');return;
      }
      const next={storeId:profile,generation,kind:'bot',id:botId,sessionId:id};current.current=next;setSelection(next);setNotice('');setRailOpen(false);
    };
    const newConversation=async()=>{
      if(!bot||bot.lifecycle!=='active'||view.busy)return;
      const botId=bot.botId,profile=storeId,token=++intent.current;
      if(!isCurrent(token,'bot',botId,profile))return;
      const receipt=await command('session.create',{botId});
      if(!isCurrent(token,'bot',botId,profile)||receipt?.state!=='ready'||!receipt.sessionId)return;
      // command has performed the durable write and refreshed the shared snapshot.
      const remote=await query('snapshot',{},()=>isCurrent(token,'bot',botId,profile));
      if(!isCurrent(token,'bot',botId,profile))return;
      if(remote?.storeId!==profile||!contact(remote,botId,receipt.sessionId)||!contact(latest.current.snapshot,botId,receipt.sessionId)){
        setError('新会话回执已保存；当前身份或会话状态改变，请从原会话记录继续。');return;
      }
      const next={storeId:profile,generation,kind:'bot',id:botId,sessionId:receipt.sessionId};current.current=next;setSelection(next);setNotice('');
    };
    const sendGroup=async()=>{
      if(!group||view.busy||composing.current||!draftRef.current[groupKey]?.trim()||sent.current.has(groupKey))return;
      const originalGroupId=group.groupId,profile=storeId,key=groupKey,text=draftRef.current[key],revision=draftRevision.current[key]??0;
      if(text.length>16000){setError('群消息最多 16000 字符；正文草稿已保留。');return;}
      if(!available('group',originalGroupId,profile))return;
      sent.current.add(key);
      try{const receipt=await command('group.post',{groupId:originalGroupId,text});
        if(alive&&mounted.current&&receipt?.messageId&&draftRef.current[key]===text&&(draftRevision.current[key]??0)===revision)updateDraft(key,'');
      }finally{sent.current.delete(key);}
    };
    const button=(text,onClick,extra={})=>h('button',{type:'button',className:'bs-button',onClick,disabled:view.busy,...extra},text);
    const manage=(tab,target)=>onManage({tab,...(typeof target==='string'?{taskId:target}:target??{})});
    const interactionLabel=target=>{
      const owner=rows(snapshot.bots).find(bot=>bot.botId===target.botId),purpose={group:'群回复',independent:'独立意见',meeting:'会议讨论'}[target.purpose];
      return `${owner?botLabel(owner):target.botId} · ${purpose} · ${target.roundId??`${target.meetingId} / 世代 ${target.epoch}`}`;
    };
    const openInteraction=(target,event)=>setInteraction({...target,storeId,generation,identityLabel:interactionLabel(target),returnFocus:event.currentTarget});
    const reopenInteraction=(target,event)=>{
      const scoped={...target,storeId,generation};if(!inScope(scoped)||!unfinished(target.pending)||known.current.cards.get(target.pending.key)?.pending!==target.pending)return;
      const panels=ctx.get?.('userQuestionPanels')??ctx.userQuestionPanels;
      if(!panels?.reveal){setError('原生问答重开服务不可用；请求仍由原生系统管理。');return;}
      if(!panels.reveal(target.sessionId,target.pending.callId)){setError('原生问答已不可重开，请核对原操作状态。');return;}
      if(inScope(scoped)&&(statusSource?.getSnapshot()??absentStatus).get(target.sessionId)?.pendingInteraction===target.pending&&liveInteraction(target.pending,target.sessionId))openInteraction(target,event);
      else setNotice('原问答已请求重新显示，等待原生可答复通道；不会打开普通聊天输入。');
    };
    const openDialog=(kind,event,extra={})=>{setMembers([]);setError('');setDialog({kind,storeId,returnFocus:event?.currentTarget,...extra});};
    const closeDialog=()=>setDialog(null);
    const taskCard=task=>{
      const attempt=rows(snapshot.attempts).find(row=>row.attemptId===task.currentAttemptId&&row.taskId===task.taskId);
      return h('article',{key:task.taskId,className:'bs-task','data-task-id':task.taskId},h('h4',{className:'bs-task-title'},task.title),h('p',{className:'bs-meta'},`${stateName(attempt?.state??task.state)} · 验收 ${stateName(task.acceptance??'unknown')}`),h('div',{className:'bs-task-actions'},
        !attempt?.reservationHeld&&!task.archived&&['queued','stopped','failed','returned','awaiting_acceptance'].includes(task.state)&&button('开始任务',()=>command('task.start',{taskId:task.taskId,expectedVersion:task.version})),
        attempt?.reservationHeld&&['running','starting'].includes(attempt.state)&&button('停止任务',()=>command('task.stop',{taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch})),
        attempt?.sessionId&&button('查看执行会话',()=>openSession(attempt.sessionId)),button('管理任务',()=>manage('tasks',task.taskId)),
      ));
    };
    const revealedMeeting=meeting=>['discussion','decision','complete'].includes(meeting.phase)||(meeting.phase==='cancelled'&&typeof meeting.epoch==='number'&&meeting.revealedEpoch===meeting.epoch);
    const meetingCard=meeting=>h('article',{key:meeting.meetingId,className:'bs-meeting','data-meeting-id':meeting.meetingId},h('h4',null,meeting.topic),h('p',{className:'bs-meta'},`${stateName(meeting.phase)} · 世代 ${meeting.epoch}`),
      !revealedMeeting(meeting)?h('div',{className:'bs-sealed',role:'status'},`独立意见封存中 · 已收到 ${rows(meeting.opinions).length}/${rows(meeting.participants).filter(row=>row.active).length} 人；${meeting.phase==='cancelled'?'会议取消不揭示独立意见。':'进入讨论后揭示。'}`):h('div',null,
        ...rows(meeting.opinions).map(row=>h('details',{key:row.botId,className:'bs-details'},h('summary',null,`${snapshot.bots.find(bot=>bot.botId===row.botId)?.name??row.botId} 的意见`),h('p',null,row.text))),
        ...rows(meeting.discussion).map((row,i)=>h('p',{key:row.botId??i},`${snapshot.bots.find(bot=>bot.botId===row.botId)?.name??row.botId}：${row.text}`)),
        meeting.decision&&h('div',{className:'bs-section'},h('strong',null,'真实协调者决定'),h('p',null,meeting.decision.text)),
      ),
      rows(meeting.absences).length>0&&h('p',{className:'bs-meta'},`缺席：${rows(meeting.absences).map(row=>row.reason).join('；')}`),
      meeting.phase==='cancelled'&&h('p',{className:'bs-meta'},'会议已逻辑取消；原通道可能仍待停止或待确认，资源结算请查看原记录。'),
      h('div',{className:'bs-task-actions'},!['complete','cancelled'].includes(meeting.phase)&&button('下一阶段',()=>command('meeting.advance',{meetingId:meeting.meetingId,epoch:meeting.epoch,phase:meeting.phase})),
        !['complete','cancelled'].includes(meeting.phase)&&button('取消会议',()=>command('meeting.cancel',{meetingId:meeting.meetingId,epoch:meeting.epoch})),
        meeting.phase!=='independent'&&meeting.decision&&button('登记行动任务',event=>openDialog('action',event,{meetingId:meeting.meetingId,epoch:meeting.epoch,phase:meeting.phase})),button('管理会议与通道',()=>manage('meetings',{meetingId:meeting.meetingId})),
      ));
    const renderDialog=()=>{
      if(!dialog||dialog.storeId!==storeId)return null;
      const titles={bot:'新建 Bot',group:'新建群',task:'新任务',meeting:'发起会议',action:'登记行动任务'};
      const submitLabels={bot:'提交创建 Bot',group:'提交创建群',task:'登记任务',meeting:'开始会议',action:'创建行动任务'};
      const modelOptions=rows(view.catalog?.providers).flatMap(provider=>rows(provider.models).map(model=>({value:JSON.stringify({provider:provider.id,model:model.id}),label:`${provider.name??provider.id} / ${model.name??model.id}`})));
      const preferred=view.catalog?.defaultModel;
      const preferredValue=preferred?JSON.stringify({provider:preferred.provider,model:preferred.model}):modelOptions[0]?.value??'';
      if(preferred&&!modelOptions.some(option=>option.value===preferredValue))modelOptions.unshift({value:preferredValue,label:`当前模型 · ${preferred.model}`});
      const capturedMeeting=dialog.kind==='action'?rows(snapshot.meetings).find(row=>row.meetingId===dialog.meetingId):null;
      const conflict=capturedMeeting&&(capturedMeeting.epoch!==dialog.epoch||capturedMeeting.phase!==dialog.phase);
      const submit=async event=>{
        event.preventDefault();if(view.busy||dialog.storeId!==latest.current.snapshot.storeId||!alive)return;
        const data=new FormData(event.currentTarget),kind=dialog.kind;let receipt;
        if(kind==='bot'){
          const model=JSON.parse(data.get('model'));const contactConfig=preferred&&model.provider===preferred.provider&&model.model===preferred.model?{...preferred}:model;
          receipt=await command('bot.create',{name:data.get('name'),role:data.get('role'),contact:contactConfig,executionMode:'inherit'});
        }else if(kind==='group'){
          const coordinator=data.get('coordinator'),selectedMembers=members.filter(id=>activeBots.some(bot=>bot.botId===id));
          if(selectedMembers.length<1||selectedMembers.length>15||!selectedMembers.includes(coordinator)){setError('请选择 1–15 个启用的成员，协调者必须在选中成员中。');return;}
          receipt=await command('group.create',{name:data.get('name'),botIds:selectedMembers,coordinatorBotId:coordinator,rounds:Number(data.get('rounds')),maxRequests:Number(data.get('requests'))});
        }else if(kind==='task'){
          if(!available('bot',dialog.botId,dialog.storeId))return;
          receipt=await command('task.create',{botId:dialog.botId,title:data.get('title'),goal:data.get('goal'),criteria:criteria(data),...(dialog.sessionId?{originSessionId:dialog.sessionId}:{})});
        }else if(kind==='meeting'){
          if(!available('group',dialog.groupId,dialog.storeId))return;
          receipt=await command('meeting.start',{groupId:dialog.groupId,topic:data.get('topic'),materials:data.get('materials')});
        }else if(kind==='action'){
          // Keep the captured epoch even when the snapshot changes: backend conflict
          // preserves this draft and never silently moves it to a new decision.
          receipt=await command('meeting.action',{meetingId:dialog.meetingId,epoch:dialog.epoch,botId:data.get('botId'),title:data.get('title'),goal:data.get('goal'),criteria:criteria(data)});
        }
        if(receipt&&alive&&mounted.current&&latest.current.snapshot.storeId===dialog.storeId){closeDialog();setNotice(kind==='task'||kind==='action'?'任务已登记；请明确点击“开始任务”派发，登记不表示完成。':'创建回执已保存。');}
      };
      return h(SpaceDialog,{key:`${dialog.kind}:${dialog.storeId}:${dialog.meetingId??dialog.botId??dialog.groupId??''}`,title:titles[dialog.kind],onClose:closeDialog,returnFocus:dialog.returnFocus},
        h('form',{className:'bs-form',onSubmit:submit},
          (dialog.kind==='bot'||dialog.kind==='group')&&label('名称','name',{maxLength:100,autoFocus:true}),
          dialog.kind==='bot'&&label('职责','role',{textarea:true,required:false,maxLength:8192}),
          dialog.kind==='bot'&&label('模型','model',{defaultValue:preferredValue,options:modelOptions}),
          dialog.kind==='bot'&&h('p',{className:'bs-meta'},'默认沿用当前有效模型；工作、记忆和权限可在完整工作台继续配置。'),
          dialog.kind==='group'&&h('fieldset',{className:'bs-section'},h('legend',null,'启用的成员'),...activeBots.map(bot=>h('label',{key:bot.botId,className:'bs-check'},h('input',{type:'checkbox','aria-label':`选择成员 ${bot.botId}`,checked:members.includes(bot.botId),onChange:event=>setMembers(ids=>event.target.checked?[...ids,bot.botId]:ids.filter(id=>id!==bot.botId))}),botLabel(bot)))),
          dialog.kind==='group'&&label('协调者','coordinator',{options:members.filter(id=>activeBots.some(bot=>bot.botId===id)).map(id=>({value:id,label:botLabel(activeBots.find(bot=>bot.botId===id))}))}),
          dialog.kind==='group'&&h('details',{className:'bs-details'},h('summary',null,'群轮设置'),label('成员轮数','rounds',{type:'number',defaultValue:1,min:1,max:3}),label('请求预算','requests',{type:'number',defaultValue:12,min:1,max:60})),
          (dialog.kind==='task'||dialog.kind==='action')&&h('div',{className:'bs-form'},dialog.kind==='action'&&label('行动负责人','botId',{options:activeBots.map(bot=>({value:bot.botId,label:botLabel(bot)}))}),label('任务标题','title',{maxLength:200,autoFocus:true}),label('目标','goal',{textarea:true,maxLength:16000}),label('验收条件（每行一项）','criteria',{textarea:true,required:false})),
          dialog.kind==='meeting'&&h('div',{className:'bs-form'},label('议题','topic',{maxLength:1000,autoFocus:true}),label('共同材料','materials',{textarea:true,required:false,maxLength:32000})),
          conflict&&h('p',{className:'bs-error',role:'status'},'会议世代或阶段已改变，草稿仍属于原决定；提交不会改用新世代。'),
          (view.error||error)&&h('p',{className:'bs-error',role:'alert'},error||view.error),
          h('div',{className:'bs-modal-actions'},button('取消',closeDialog,{disabled:false}),h('button',{type:'submit',className:'bs-primary',disabled:view.busy||(dialog.kind==='bot'&&!modelOptions.length)||(dialog.kind==='group'&&!members.length)},submitLabels[dialog.kind])),
        ));
    };
    const messages=group?.messages??[],limit=groupKey?visible[groupKey]??40:40;
    useEffect(()=>{
      const previous=lastMessages.current;lastMessages.current={key:groupKey,count:messages.length};
      if(!group)return;
      if(previous?.key!==groupKey||follow.current){if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;setUnread(false);}
      else if(messages.length>previous.count)setUnread(true);
    },[groupKey,messages.length]);
    const reference=owned&&owned.storeId===storeId&&owned.botId===bot?.botId&&owned.sessionId===sessionId?owned.reference:undefined;
    const filteredBots=rows(snapshot.bots).filter(bot=>!bot.deletedAt&&`${bot.name} ${bot.botId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const filteredGroups=rows(snapshot.groups).filter(group=>`${group.name} ${group.groupId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const effectiveModel=validSession?.model??bot?.contact;
    return h('section',{className:'dsh-bot-space',ref:element,'aria-label':'Bot 空间','data-rail-open':String(railOpen),'data-context-open':String(contextOpen),'data-context-collapsed':String(contextCollapsed),onKeyDown:event=>{
      if(event.defaultPrevented||(!railOpen&&!contextOpen)||event.target?.closest?.('dialog'))return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDrawers();}
      if(event.key==='Tab'){
        const drawer=railOpen?rail.current:context.current,controls=[...(drawer?.querySelectorAll?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex="0"]')??[])].filter(node=>!node.getClientRects||node.getClientRects().length);
        const first=controls[0],last=controls.at(-1),active=globalThis.document?.activeElement;
        if(!first){event.preventDefault();drawer?.focus?.();}
        else if(event.shiftKey&&(active===first||!drawer?.contains?.(active))){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&(active===last||!drawer?.contains?.(active))){event.preventDefault();first.focus();}
      }
    }},h('style',null,styles),h('div',{className:'bs-shell'},
      h('aside',{className:'bs-rail',ref:rail,inert:contextOpen,role:railOpen?'dialog':undefined,'aria-modal':railOpen?true:undefined,tabIndex:railOpen?-1:undefined,'aria-label':'Bot 与群会话'},h('header',{className:'bs-brand'},h('span',{className:'bs-brand-mark','aria-hidden':true},'B'),h('h1',{className:'bs-brand-title'},'Bot 空间'),button('关闭会话列表',closeDrawers,{className:'bs-mobile-toggle',disabled:false})),
        h('input',{className:'bs-search',type:'search','aria-label':'搜索 Bot 与群',placeholder:'搜索名称或 ID',value:search,onChange:event=>setSearch(event.target.value)}),
        h('div',{className:'bs-rail-actions'},button('新建 Bot',event=>openDialog('bot',event),{className:'bs-primary'}),button('新建群',event=>openDialog('group',event))),
        h('div',{className:'bs-list'},h('h2',{className:'bs-list-heading'},'Bots'),...filteredBots.map(row=>h('div',{key:row.botId},button(h('span',{className:'bs-contact-copy'},avatar(row.name,row.botId),h('span',{className:'bs-contact-name'},botLabel(row)),h('span',{className:'bs-meta'},stateName(row.lifecycle))),()=>select('bot',row.botId),{className:'bs-contact','aria-label':botLabel(row),'data-bot-id':row.botId,'aria-pressed':bot?.botId===row.botId,disabled:false}),
          bot?.botId===row.botId&&h('div',{className:'bs-history'},...rows(snapshot.sessions).filter(session=>contact(snapshot,row.botId,session.sessionId)).map(session=>button(`${session.name||'未命名聊天'} · ${session.sessionId.slice(0,8)}`,()=>chooseSession(session.sessionId),{key:session.sessionId,className:'bs-history-item','data-session-id':session.sessionId,'aria-label':`${session.name||'未命名聊天'} · ${session.sessionId}`,title:`${session.name||'未命名聊天'} · ${session.sessionId}`,'aria-pressed':sessionId===session.sessionId,disabled:false}))))),
        h('h2',{className:'bs-list-heading'},'群与协作'),...filteredGroups.map(row=>button(h('span',{className:'bs-contact-copy'},avatar(row.name,row.groupId),h('span',{className:'bs-contact-name'},row.name),h('span',{className:'bs-meta'},`${rows(row.members).filter(member=>member.active).length} 位成员`)),()=>select('group',row.groupId),{key:row.groupId,className:'bs-contact','aria-label':row.name,'data-group-id':row.groupId,'aria-pressed':group?.groupId===row.groupId,disabled:false})),
        !filteredBots.length&&!filteredGroups.length&&h('p',{className:'bs-muted'},search?'没有匹配的 Bot 或群。':'创建第一个具名 Bot，开始持续对话。')),
        h('footer',{className:'bs-rail-footer'},button('完整工作台',()=>manage('bots'),{disabled:false}),button(`原操作记录${view.pending?.length?` · ${view.pending.length}`:''}`,()=>manage('bots'),{disabled:false}))),
      h('main',{className:'bs-main',inert:railOpen||contextOpen},h('header',{className:'bs-header'},h('div',{className:'bs-header-identity'},button('会话',event=>openDrawer('rail',event),{className:'bs-mobile-toggle',disabled:false}),avatar(name,bot?.botId??group?.groupId??'space'),h('div',null,h('h2',{className:'bs-title','data-bot-id':bot?.botId,'data-group-id':group?.groupId},name),h('p',{className:'bs-status'},bot?`${stateName(bot.lifecycle)} · ${effectiveModel?.provider??''} / ${effectiveModel?.model??''}`:group?`${rows(group.members).filter(row=>row.active).length} 位成员 · 有界真实群轮`:'持续对话 · 独立记忆 · 协作'))),
        h('div',{className:'bs-header-actions'},bot&&button('开始新对话',newConversation,{className:'bs-primary',disabled:view.busy||bot.lifecycle!=='active'}),button('上下文',event=>{if((element.current?.getBoundingClientRect?.().width??0)<1180){if(contextOpen)closeDrawers();else openDrawer('context',event);}else setContextCollapsed(value=>!value);},{className:'bs-context-toggle',disabled:false}))),
        (view.error||error||view.storageNotice||notice||view.pending?.length>0)&&h('div',{className:'bs-feedback'},(view.error||error)&&h('p',{className:'bs-error',role:'alert'},error||view.error),view.storageNotice&&h('p',{role:'status'},view.storageNotice),notice&&h('p',{role:'status'},notice),view.pending?.length>0&&h('div',{className:'bs-pending'},h('span',null,`${view.pending.length} 条原操作待查回，刷新不会重发。`),button('查看完整原操作',()=>manage('bots'),{disabled:false}))),
        bot?h('div',{className:'bs-native','data-session-id':sessionId??''},sessionId&&SessionProvider?h(SessionProvider,{session:reference,key:`${storeId}:${sessionId}`,empty:()=>h('div',{className:'bs-empty',role:'status'},error?'请查阅会话错误，重新选择原会话。':'正在打开原会话…')},renderSlot('dsh.bot-space.conversation',{sessionId})):h('div',{className:'bs-empty'},h('div',{className:'bs-empty-art','aria-hidden':true},avatar(bot.name,bot.botId)),h('h3',null,`与 ${botLabel(bot)} 继续对话`),h('p',null,bot.role||'选择左侧已有聊天，或明确开始新对话。'),h('p',{className:'bs-meta'},`身份 ${bot.botId} · 每段聊天保留原生历史与独立输入草稿。`),bot.lifecycle!=='active'&&h('p',{role:'status'},'Bot 已暂停，不能创建新会话；已有历史仍可查看。'),button('管理此 Bot',()=>manage('bots',{botId:bot.botId}),{disabled:false}))):group?h('div',{className:'bs-group'},
          h('div',{className:'bs-transcript',ref:scroll,role:'log','aria-label':'群消息历史',onScroll:event=>{const el=event.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<64;if(follow.current)setUnread(false);}},messages.length>limit&&button('显示更早消息',()=>{const element=scroll.current,oldHeight=element?.scrollHeight,oldTop=element?.scrollTop;setVisible(old=>({...old,[groupKey]:limit+40}));if(element)requestAnimationFrame(()=>{element.scrollTop=oldTop+element.scrollHeight-oldHeight;});},{className:'bs-load-more',disabled:false}),
            !messages.length&&h('div',{className:'bs-empty'},h('h3',null,'给团队一个共同起点'),h('p',null,'发送一条消息，成员会在真实独立通道中按预算回复。')),
            ...messages.slice(-limit).map(message=>h('article',{key:message.messageId,className:'bs-message','data-message-id':message.messageId,'data-producer':message.producer.kind},h('header',{className:'bs-message-heading'},avatar(message.producer.kind==='human'?'你':snapshot.bots.find(bot=>bot.botId===message.producer.botId)?.name,message.producer.botId??'human'),h('strong',null,message.producer.kind==='human'?'你':snapshot.bots.find(bot=>bot.botId===message.producer.botId)?.name??message.producer.botId),message.time&&h('time',{dateTime:message.time,className:'bs-meta'},new Date(message.time).toLocaleString())),h('p',{className:'bs-message-body'},message.text))),
          ),unread&&button('查看新消息',()=>{follow.current=true;setUnread(false);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},{className:'bs-new-messages',disabled:false}),
          h('div',{className:'bs-rounds'},...rows(group.rounds).filter(round=>['running','stopping','UNKNOWN','stopped'].includes(round.state)).map(round=>h('div',{className:'bs-round',key:round.roundId,'data-round-id':round.roundId},h('span',null,`${stateName(round.state)} · 请求 ${round.requests}/${round.maxRequests}`),rows(round.absences).length>0&&h('span',{className:'bs-meta'},rows(round.absences).map(row=>row.reason).join('；')),round.state==='running'&&button('停止此群轮',()=>command('group.round.stop',{groupId:group.groupId,roundId:round.roundId})),round.state==='stopping'&&h('span',null,'等待真实资源结算'),round.state==='UNKNOWN'&&button('查阅原群轮',()=>manage('groups',{groupId:group.groupId,roundId:round.roundId}),{disabled:false})))),
          h('form',{className:'bs-composer',onSubmit:event=>{event.preventDefault();return sendGroup();}},h('textarea',{className:'bs-textarea','aria-label':'群消息',placeholder:'发送给群成员…',value:draft,maxLength:16000,onChange:event=>updateDraft(groupKey,event.target.value),onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},onKeyDown:event=>{if(event.key==='Enter'&&!event.shiftKey&&!composing.current&&!event.nativeEvent?.isComposing&&!event.isComposing&&event.keyCode!==229){event.preventDefault();sendGroup();}}}),h('div',{className:'bs-composer-footer'},h('span',{className:'bs-meta'},'Enter 发送 · Shift+Enter 换行'),button('发送消息',sendGroup,{className:'bs-primary',disabled:view.busy||!draft.trim()})))):
          h('div',{className:'bs-empty'},h('div',{className:'bs-empty-art','aria-hidden':true},'B'),h('h3',null,'把日常对话留在 Bot 空间'),h('p',null,'选择具名 Bot 继续原生聊天，或进入群与团队协作。'),button('新建第一个 Bot',event=>openDialog('bot',event),{className:'bs-primary'}))),
      h('aside',{className:'bs-context',ref:context,inert:railOpen,role:contextOpen?'dialog':undefined,'aria-modal':contextOpen?true:undefined,tabIndex:contextOpen?-1:undefined,'aria-label':'当前会话上下文'},h('header',{className:'bs-context-header'},h('h3',null,'上下文'),button('关闭上下文',()=>{if(contextOpen)closeDrawers();else setContextCollapsed(true);},{className:'bs-icon-button',disabled:false})),
        bot&&h('section',{className:'bs-section'},h('div',{className:'bs-section-heading'},h('h3',null,'当前 Bot 的任务'),button('新任务',event=>openDialog('task',event,{botId:bot.botId,sessionId}),{disabled:view.busy||bot.lifecycle!=='active'})),...tasks.map(taskCard),!tasks.length&&h('p',{className:'bs-meta'},'还没有任务。登记后明确开始，后台执行不中断聊天。')),
        bot&&h('section',{className:'bs-section'},h('h3',null,'身份与记忆'),h('p',null,bot.role||'尚未填写职责'),h('p',{className:'bs-meta'},`Bot ID ${bot.botId}`),h('p',{className:'bs-meta'},`工作槽 ${rows(snapshot.attempts).filter(a=>a.botId===bot.botId&&a.reservationHeld).length}/15`),...rows(snapshot.memories).filter(m=>m.botId===bot.botId&&!m.forgotten&&!m.inactive).slice(0,3).map(m=>h('p',{key:m.memoryId,className:'bs-muted'},m.text)),button('管理记忆与资料',()=>manage('memory',{botId:bot.botId}),{disabled:false})),
        group&&h('section',{className:'bs-section'},h('h3',null,'群成员'),...rows(group.members).filter(m=>m.active).map(member=>{const owner=snapshot.bots.find(bot=>bot.botId===member.botId);return h('div',{className:'bs-member',key:member.botId},avatar(owner?.name,member.botId),h('span',null,owner?botLabel(owner):member.botId),member.botId===group.coordinatorBotId&&h('span',{className:'bs-tag'},'协调者'));}),button('管理成员与群设置',()=>manage('groups',{groupId:group.groupId}),{disabled:false})),
        group&&(pendingTargets.length>0||hiddenTargets.length>0||continuedTargets.length>0||cards.length>0)&&h('section',{className:'bs-section'},h('h3',null,'原生待处理操作'),
          ...pendingTargets.map(target=>button(`${{approval:'审批',question:'提问','plan-review':'计划确认'}[target.pending.kind]} ${interactionLabel(target)}`,event=>openInteraction(target,event),{key:target.sessionId,'data-pending-session-id':target.sessionId,'data-interaction-kind':target.pending.kind,disabled:false})),
          ...hiddenTargets.map(target=>button(`重新打开${target.pending.kind==='plan-review'?'计划确认':'提问'} ${interactionLabel(target)}`,event=>reopenInteraction(target,event),{key:target.pending.key,'data-reopen-session-id':target.sessionId,'data-call-id':target.pending.callId,disabled:false})),
          ...published.filter(target=>unfinished(target.pending)&&!liveInteraction(target.pending,target.sessionId)).map(target=>h('p',{key:target.pending.key,className:'bs-meta',role:'status'},`等待原生问答通道 · ${interactionLabel(target)}`)),
          ...continuedTargets.filter(target=>!pendingTargets.some(row=>row.sessionId===target.sessionId)).map(target=>h('p',{key:target.sessionId,className:'bs-meta',role:'status'},`正在连接原生接续问答 · ${interactionLabel(target)}`))),
        group&&h('section',{className:'bs-section'},h('div',{className:'bs-section-heading'},h('h3',null,'真实会议'),button('发起会议',event=>openDialog('meeting',event,{groupId:group.groupId}))),...meetings.map(meetingCard),!meetings.length&&h('p',{className:'bs-meta'},'共同议题从独立意见开始，意见正常封存。')),
        group&&h('section',{className:'bs-section'},h('h3',null,'本群会议行动任务'),...tasks.map(taskCard),!tasks.length&&h('p',{className:'bs-meta'},'会议决定登记的行动任务会显示在这里。')),
        !bot&&!group&&h('p',{className:'bs-meta'},'选择一个 Bot 或群查看真实任务、成员和会议。')),
      (railOpen||contextOpen)&&h('button',{type:'button',className:'bs-backdrop','data-for':railOpen?'rail':'context','aria-label':'关闭会话抽屉',onClick:closeDrawers}),renderDialog(),
      ...recoveryTargets.map(target=>h(QuestionRecovery,{key:`${storeId}:${channelKey(target)}`,target,onError:setError,onReference:(reference,old)=>setRecoveryReferences(previous=>{if(!reference&&previous[target.sessionId]!==old)return previous;const next={...previous};if(reference)next[target.sessionId]=reference;else delete next[target.sessionId];return next;})})),
      interactionCurrent&&h(InteractionPane,{key:`${storeId}:${interaction.sessionId}:${interaction.pending.key}`,target:interaction,SessionProvider,renderSlot,isPending:pendingActive,onClose:()=>setInteraction(null),returnFocus:interaction.returnFocus,onError:setError,recovering:unfinished(interaction.pending)&&typeof interaction.pending.callId==='string',recoveryReference:recoveryReferences[interaction.sessionId]})));
  }
  return {BotSpace,NativeConversation,NativeInteraction};
}
