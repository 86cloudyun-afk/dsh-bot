window.__ModuleLoader__.load({
  id: "dsh-bot",
  factory(require) {
    const {
      createElement: h,
      useState,
      useEffect,
      useRef,
      useSyncExternalStore,
    } = require("react");
    // BEGIN GENERATED BOT SPACE
    // Maintained source. scripts/build-client.mjs embeds this one exported factory.
    function createBotSpace(deps) {
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
        const selected=selection?.storeId===storeId&&selection.generation===generation?selection:null;
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
        const reference=owned?.storeId===storeId&&owned.botId===bot?.botId&&owned.sessionId===sessionId?owned.reference:undefined;
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
    // END GENERATED BOT SPACE
    // BEGIN GENERATED BOT SPACE STYLES
    /** Styles for the dedicated Bot panel. Native conversation descendants stay host-owned. */
    const botSpaceStyles = `
    .dsh-bot-space {
      --bs-fallback-surface: #ffffff;
      --bs-fallback-subtle: #f5f7f6;
      --bs-fallback-ink: #18302b;
      --bs-fallback-muted: #63756f;
      --bs-fallback-rule: #e4eae7;
      --bs-surface: var(--dsw-alias-bg-layer-1, var(--bs-fallback-surface));
      --bs-subtle: var(--dsw-alias-bg-layer-2, var(--bs-fallback-subtle));
      --bs-ink: var(--dsw-alias-label-primary, var(--bs-fallback-ink));
      --bs-muted: var(--dsw-alias-label-secondary, var(--bs-fallback-muted));
      --bs-rule: var(--dsw-alias-border-l2, var(--bs-fallback-rule));
      --bs-accent: #146c62;
      --bs-accent-ink: color-mix(in srgb, var(--bs-accent) 55%, var(--bs-ink));
      --bs-accent-soft: color-mix(in srgb, var(--bs-accent) 9%, var(--bs-surface));
      --bs-hover: color-mix(in srgb, var(--bs-ink) 5%, var(--bs-surface));
      --bs-danger: var(--dsw-alias-state-error-primary, #be4248);
      position: relative;
      isolation: isolate;
      container: bot-space / inline-size;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      color: var(--bs-ink);
      background: var(--bs-surface);
      font-family: inherit;
      font-size: 15px;
      line-height: 1.75;
      -webkit-font-smoothing: antialiased;
    }
    .dsh-bot-space .bs-shell {
      display: grid;
      grid-template-columns: 248px minmax(0, 1fr) 296px;
      height: 100%;
      min-height: 0;
    }
    .dsh-bot-space .bs-rail,
    .dsh-bot-space .bs-main,
    .dsh-bot-space .bs-context {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .dsh-bot-space .bs-rail {
      padding: 24px 14px 16px;
      border-right: 1px solid var(--bs-rule);
      background: color-mix(in srgb, var(--bs-accent) 2%, var(--bs-subtle));
      overflow: hidden;
    }
    .dsh-bot-space .bs-rail > .bs-brand,
    .dsh-bot-space .bs-rail > .bs-search,
    .dsh-bot-space .bs-rail > .bs-rail-actions,
    .dsh-bot-space .bs-rail > .bs-rail-footer { flex: 0 0 auto; }
    .dsh-bot-space .bs-brand {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 0 8px 23px;
    }
    .dsh-bot-space .bs-brand-mark {
      display: grid;
      place-items: center;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      border-radius: 11px;
      background: var(--bs-accent);
      color: #fff;
      font-size: 18px;
      font-weight: 650;
      line-height: 1;
    }
    .dsh-bot-space .bs-brand-title {
      margin: 0;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: -.45px;
      line-height: 1.3;
    }
    .dsh-bot-space .bs-search {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      min-height: 40px;
      padding: 9px 12px;
      border: 1px solid var(--bs-rule);
      border-radius: 9px;
      background: var(--bs-surface);
      color: var(--bs-ink);
      font: inherit;
      font-size: 13px;
      line-height: 1.5;
    }
    .dsh-bot-space .bs-search::placeholder,
    .dsh-bot-space .bs-input::placeholder,
    .dsh-bot-space .bs-textarea::placeholder { color: var(--bs-muted); opacity: .85; }
    .dsh-bot-space .bs-rail-actions,
    .dsh-bot-space .bs-actions,
    .dsh-bot-space .bs-header-actions,
    .dsh-bot-space .bs-task-actions,
    .dsh-bot-space .bs-modal-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .dsh-bot-space .bs-rail-actions { margin: 12px 0 20px; }
    .dsh-bot-space .bs-rail-actions > .bs-button,
    .dsh-bot-space .bs-rail-actions > .bs-primary { flex: 1; }
    .dsh-bot-space .bs-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 3px; min-height: 0; margin-bottom: 0; padding-bottom: 16px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .dsh-bot-space .bs-list > * { flex: 0 0 auto; }
    .dsh-bot-space .bs-list-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0;
      padding: 8px 9px;
      color: var(--bs-muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .25px;
      line-height: 1.5;
    }
    .dsh-bot-space .bs-contact,
    .dsh-bot-space .bs-nav-item {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 56px;
      padding: 9px;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      color: var(--bs-ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .dsh-bot-space .bs-contact:hover,
    .dsh-bot-space .bs-nav-item:hover,
    .dsh-bot-space .bs-history-item:hover { background: var(--bs-hover); }
    .dsh-bot-space .bs-contact[aria-selected="true"],
    .dsh-bot-space .bs-contact[aria-pressed="true"],
    .dsh-bot-space .bs-nav-item[aria-selected="true"],
    .dsh-bot-space .bs-nav-item[aria-pressed="true"],
    .dsh-bot-space .bs-nav-item[data-selected="true"] {
      border-color: color-mix(in srgb, var(--bs-accent) 16%, var(--bs-rule));
      background: var(--bs-accent-soft);
    }
    .dsh-bot-space .bs-avatar {
      box-sizing: border-box;
      display: inline-grid;
      place-items: center;
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      border: 1px solid hsl(var(--bs-avatar, 168) 30% 78%);
      border-radius: 12px;
      background: hsl(var(--bs-avatar, 168) 35% 89%);
      color: hsl(var(--bs-avatar, 168) 38% 24%);
      font-size: 15px;
      font-weight: 650;
      line-height: 1;
      user-select: none;
    }
    .dsh-bot-space .bs-contact-copy { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; column-gap: 10px; flex: 1; min-width: 0; }
    .dsh-bot-space .bs-contact-copy > .bs-avatar { grid-column: 1; grid-row: 1 / span 2; }
    .dsh-bot-space .bs-contact-name {
      display: block;
      overflow: hidden;
      color: var(--bs-ink);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.5;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-bot-space .bs-contact-copy > .bs-contact-name { grid-column: 2; }
    .dsh-bot-space .bs-meta,
    .dsh-bot-space .bs-muted {
      color: var(--bs-muted);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .dsh-bot-space .bs-contact-copy > .bs-meta {
      grid-column: 2;
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-bot-space .bs-history {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 2px 0 8px 25px;
      padding-left: 12px;
      border-left: 1px solid var(--bs-rule);
    }
    .dsh-bot-space .bs-history-item {
      box-sizing: border-box;
      display: block;
      width: 100%;
      min-height: 40px;
      padding: 8px 9px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--bs-muted);
      font: inherit;
      font-size: 12px;
      line-height: 1.6;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .dsh-bot-space .bs-history-item[aria-selected="true"],
    .dsh-bot-space .bs-history-item[aria-pressed="true"] {
      background: var(--bs-accent-soft);
      color: var(--bs-accent-ink);
      font-weight: 600;
    }
    .dsh-bot-space .bs-rail-footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: auto;
      padding: 16px 2px 0;
      border-top: 1px solid var(--bs-rule);
    }
    .dsh-bot-space .bs-main { overflow: hidden; background: var(--bs-surface); }
    .dsh-bot-space .bs-header {
      box-sizing: border-box;
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 88px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--bs-rule);
    }
    .dsh-bot-space .bs-header-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }
    .dsh-bot-space .bs-header-identity > :not(.bs-avatar) { min-width: 0; }
    .dsh-bot-space .bs-header-identity .bs-avatar { width: 42px; height: 42px; flex-basis: 42px; border-radius: 14px; font-size: 18px; }
    .dsh-bot-space .bs-title {
      margin: 0;
      font-size: 18px;
      font-weight: 650;
      letter-spacing: -.25px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .dsh-bot-space .bs-header-actions { flex: 0 0 auto; justify-content: flex-end; }
    .dsh-bot-space .bs-button,
    .dsh-bot-space .bs-primary,
    .dsh-bot-space .bs-icon-button,
    .dsh-bot-space .bs-mobile-toggle,
    .dsh-bot-space .bs-context-toggle,
    .dsh-bot-space .bs-load-more,
    .dsh-bot-space .bs-new-messages {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 40px;
      min-height: 40px;
      padding: 9px 12px;
      border: 1px solid var(--bs-rule);
      border-radius: 8px;
      background: var(--bs-surface);
      color: var(--bs-ink);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.5;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .dsh-bot-space .bs-button:hover,
    .dsh-bot-space .bs-icon-button:hover,
    .dsh-bot-space .bs-mobile-toggle:hover,
    .dsh-bot-space .bs-context-toggle:hover,
    .dsh-bot-space .bs-load-more:hover,
    .dsh-bot-space .bs-new-messages:hover { background: var(--bs-hover); border-color: color-mix(in srgb, var(--bs-ink) 18%, var(--bs-rule)); }
    .dsh-bot-space .bs-primary { border-color: var(--bs-accent); background: var(--bs-accent); color: #fff; font-weight: 600; }
    .dsh-bot-space .bs-primary:hover { background: #105b53; border-color: #105b53; }
    .dsh-bot-space .bs-icon-button { padding: 8px; }
    .dsh-bot-space .bs-mobile-toggle { display: none; }
    .dsh-bot-space .bs-button:disabled,
    .dsh-bot-space .bs-primary:disabled,
    .dsh-bot-space .bs-icon-button:disabled,
    .dsh-bot-space .bs-load-more:disabled { opacity: .5; cursor: not-allowed; }
    .dsh-bot-space .bs-status,
    .dsh-bot-space .bs-tag {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 100%;
      padding: 3px 7px;
      border: 1px solid var(--bs-rule);
      border-radius: 6px;
      background: var(--bs-subtle);
      color: var(--bs-muted);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .dsh-bot-space .bs-header .bs-status { margin: 3px 0 0; }
    .dsh-bot-space .bs-native { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; overflow: hidden; }
    .dsh-bot-space .bs-native.bs-interaction { flex: 0 0 auto; height: min(520px, 60dvh); min-height: 240px; }
    .dsh-bot-space .bs-plan-document { margin: 12px 0 16px; padding: 14px 16px; border: 1px solid var(--bs-rule); border-radius: 9px; background: var(--bs-subtle); }
    .dsh-bot-space .bs-plan-document > h3 { margin: 0 0 8px; color: var(--bs-ink); font-size: 13px; font-weight: 600; line-height: 1.6; }
    .dsh-bot-space .bs-plan-document > pre { max-height: 240px; margin: 0; overflow: auto; color: var(--bs-ink); white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .dsh-bot-space .bs-group { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
    .dsh-bot-space .bs-empty {
      box-sizing: border-box;
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 0;
      padding: 40px 28px;
      overflow: auto;
      color: var(--bs-muted);
      text-align: center;
      overflow-wrap: anywhere;
    }
    .dsh-bot-space .bs-empty > h2,
    .dsh-bot-space .bs-empty > h3 { margin: 4px 0 0; color: var(--bs-ink); font-size: 20px; font-weight: 600; line-height: 1.5; letter-spacing: -.3px; }
    .dsh-bot-space .bs-empty > p { max-width: 390px; margin: 0; font-size: 14px; line-height: 1.85; }
    .dsh-bot-space .bs-empty > .bs-primary,
    .dsh-bot-space .bs-empty > .bs-actions { margin-top: 8px; }
    .dsh-bot-space .bs-empty-art {
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      margin-bottom: 6px;
      border: 1px solid color-mix(in srgb, var(--bs-accent) 18%, var(--bs-rule));
      border-radius: 23px;
      background: linear-gradient(145deg, var(--bs-accent-soft), var(--bs-surface));
      color: var(--bs-accent-ink);
      font-size: 28px;
      font-weight: 500;
      line-height: 1;
    }
    .dsh-bot-space .bs-empty-art > .bs-avatar { width: 48px; height: 48px; flex-basis: 48px; border-radius: 16px; font-size: 23px; }
    .dsh-bot-space .bs-feedback,
    .dsh-bot-space .bs-error,
    .dsh-bot-space .bs-pending {
      box-sizing: border-box;
      flex: 0 0 auto;
      margin: 12px 24px 0;
      padding: 10px 12px;
      border: 1px solid var(--bs-rule);
      border-radius: 8px;
      background: var(--bs-subtle);
      font-size: 12px;
      line-height: 1.7;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .dsh-bot-space .bs-feedback { max-height: 160px; overflow-y: auto; }
    .dsh-bot-space .bs-error { color: var(--bs-danger); border-color: color-mix(in srgb, var(--bs-danger) 28%, var(--bs-rule)); background: color-mix(in srgb, var(--bs-danger) 5%, var(--bs-surface)); }
    .dsh-bot-space .bs-feedback .bs-error,
    .dsh-bot-space .bs-feedback .bs-pending { margin: 0; }
    .dsh-bot-space .bs-pending + .bs-pending { margin-top: 8px; }
    .dsh-bot-space .bs-transcript,
    .dsh-bot-space .bs-messages {
      box-sizing: border-box;
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      padding: 24px max(24px, calc((100% - 760px) / 2)) 18px;
    }
    .dsh-bot-space .bs-message { max-width: 760px; margin: 0 auto 28px; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-transcript > .bs-empty { min-height: 100%; }
    .dsh-bot-space .bs-message-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; line-height: 1.6; }
    .dsh-bot-space .bs-message-heading .bs-avatar { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; font-size: 13px; }
    .dsh-bot-space .bs-message-body { margin: 9px 0 0 40px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.75; }
    .dsh-bot-space .bs-message[data-producer="human"] .bs-message-body { width: fit-content; max-width: calc(100% - 40px); padding: 11px 15px; border-radius: 2px 12px 12px 12px; background: var(--bs-accent-soft); }
    .dsh-bot-space .bs-rounds { flex: 0 1 auto; max-height: 160px; overflow-y: auto; overscroll-behavior: contain; }
    .dsh-bot-space .bs-round { box-sizing: border-box; display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; width: calc(100% - 48px); max-width: 760px; margin: 0 auto 10px; padding: 10px 12px; border: 1px solid var(--bs-rule); border-radius: 8px; background: var(--bs-subtle); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-load-more { display: flex; margin: 0 auto 24px; color: var(--bs-muted); }
    .dsh-bot-space .bs-new-messages { align-self: center; flex: 0 0 auto; margin: 0 16px 8px; border-color: color-mix(in srgb, var(--bs-accent) 25%, var(--bs-rule)); background: var(--bs-accent-soft); color: var(--bs-accent-ink); }
    .dsh-bot-space .bs-composer {
      box-sizing: border-box;
      flex: 0 0 auto;
      width: calc(100% - 48px);
      max-width: 760px;
      margin: 8px auto 20px;
      padding: 0;
      border: 1px solid color-mix(in srgb, var(--bs-ink) 16%, var(--bs-rule));
      border-radius: 12px;
      background: var(--bs-surface);
      box-shadow: 0 3px 12px color-mix(in srgb, var(--bs-ink) 4%, transparent);
    }
    .dsh-bot-space .bs-composer .bs-textarea { display: block; min-height: 82px; max-height: 180px; padding: 13px 15px 8px; border: 0; border-radius: 12px 12px 0 0; background: transparent; font-size: 15px; line-height: 1.75; resize: vertical; }
    .dsh-bot-space .bs-composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 10px 10px 15px; }
    .dsh-bot-space .bs-composer-footer .bs-primary { flex: 0 0 auto; }
    .dsh-bot-space .bs-composer-footer .bs-meta { min-width: 0; }
    .dsh-bot-space .bs-context { padding: 22px 20px; border-left: 1px solid var(--bs-rule); background: var(--bs-surface); overflow-y: auto; overscroll-behavior: contain; }
    .dsh-bot-space .bs-context-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 18px; }
    .dsh-bot-space .bs-context-header > h2,
    .dsh-bot-space .bs-context-header > h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
    .dsh-bot-space .bs-section { margin: 0 0 24px; padding: 0 0 20px; border-bottom: 1px solid var(--bs-rule); }
    .dsh-bot-space .bs-section:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: 0; }
    .dsh-bot-space .bs-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 12px; color: var(--bs-muted); font-size: 12px; font-weight: 600; line-height: 1.6; }
    .dsh-bot-space .bs-section-heading > h2,
    .dsh-bot-space .bs-section-heading > h3 { margin: 0; color: inherit; font: inherit; }
    .dsh-bot-space .bs-section > h3 { margin: 0 0 12px; color: var(--bs-muted); font-size: 12px; font-weight: 600; line-height: 1.6; }
    .dsh-bot-space .bs-section > p { margin: 0 0 12px; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-context .bs-button[data-pending-session-id] { display: flex; width: 100%; margin: 0 0 8px; padding: 10px 12px; justify-content: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-task,
    .dsh-bot-space .bs-meeting { margin: 0 0 10px; padding: 12px; border: 1px solid var(--bs-rule); border-radius: 9px; background: var(--bs-subtle); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-task-title { display: block; margin: 0 0 5px; font-size: 13px; font-weight: 600; line-height: 1.7; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-task > .bs-meta { margin: 4px 0; }
    .dsh-bot-space .bs-meeting > h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; line-height: 1.7; }
    .dsh-bot-space .bs-meeting > p { margin: 8px 0; }
    .dsh-bot-space .bs-task-actions { margin-top: 10px; }
    .dsh-bot-space .bs-task-actions > .bs-button { flex: 1 1 auto; padding-right: 8px; padding-left: 8px; font-size: 12px; }
    .dsh-bot-space .bs-member { display: flex; align-items: center; gap: 10px; min-height: 48px; margin-bottom: 6px; font-size: 13px; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-member > :not(.bs-avatar):not(.bs-tag) { flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-member > .bs-tag { flex: 0 0 auto; max-width: none; white-space: nowrap; }
    .dsh-bot-space .bs-member .bs-avatar { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; font-size: 13px; }
    .dsh-bot-space .bs-sealed { margin: 12px 0; padding: 12px; border: 1px dashed color-mix(in srgb, var(--bs-accent) 24%, var(--bs-rule)); border-radius: 8px; background: var(--bs-accent-soft); color: var(--bs-accent-ink); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
    .dsh-bot-space .bs-details { margin: 12px 0; color: var(--bs-muted); font-size: 12px; }
    .dsh-bot-space .bs-details > summary { box-sizing: border-box; min-height: 40px; padding: 10px 0; cursor: pointer; }
    .dsh-bot-space .bs-details > :not(summary) { margin-top: 8px; }
    .dsh-bot-space .bs-form { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .dsh-bot-space .bs-form > fieldset.bs-section { min-width: 0; margin: 0; padding: 10px 12px; border: 1px solid var(--bs-rule); border-radius: 8px; }
    .dsh-bot-space .bs-form > fieldset.bs-section > legend { padding: 0 4px; color: var(--bs-muted); font-size: 12px; }
    .dsh-bot-space .bs-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; color: var(--bs-ink); font-size: 13px; font-weight: 500; line-height: 1.6; }
    .dsh-bot-space .bs-input,
    .dsh-bot-space .bs-select,
    .dsh-bot-space .bs-textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--bs-rule); border-radius: 8px; background: var(--bs-surface); color: var(--bs-ink); font: inherit; font-size: 14px; font-weight: 400; line-height: 1.6; }
    .dsh-bot-space .bs-textarea { min-height: 92px; resize: vertical; }
    .dsh-bot-space .bs-check { box-sizing: border-box; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 7px 0; font-size: 13px; line-height: 1.6; cursor: pointer; }
    .dsh-bot-space .bs-check > input { flex: 0 0 auto; width: 17px; height: 17px; margin: 0; accent-color: var(--bs-accent); }
    .dsh-bot-space .bs-modal,
    .dsh-bot-space .bs-dialog { box-sizing: border-box; width: min(520px, calc(100vw - 40px)); max-height: min(760px, calc(100dvh - 48px)); margin: auto; padding: 0; border: 1px solid var(--bs-rule); border-radius: 16px; background: var(--bs-surface); color: var(--bs-ink); box-shadow: 0 24px 80px rgb(0 0 0 / 18%); font: inherit; overflow-y: auto; }
    .dsh-bot-space .bs-modal::backdrop,
    .dsh-bot-space .bs-dialog::backdrop { background: rgb(8 25 22 / 38%); }
    .dsh-bot-space .bs-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px 16px; border-bottom: 1px solid var(--bs-rule); }
    .dsh-bot-space .bs-modal-header > h2,
    .dsh-bot-space .bs-modal-header > h3 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; letter-spacing: -.2px; }
    .dsh-bot-space .bs-modal-body { padding: 22px 24px; }
    .dsh-bot-space .bs-modal-actions { justify-content: flex-end; padding: 16px 24px 20px; border-top: 1px solid var(--bs-rule); }
    .dsh-bot-space .bs-modal-body > .bs-modal-header { margin: -22px -24px 22px; }
    .dsh-bot-space .bs-modal-body .bs-modal-actions { margin: 4px -24px -22px; }
    .dsh-bot-space .bs-backdrop { display: none; position: absolute; inset: 0; z-index: 45; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: rgb(8 25 22 / 30%); cursor: pointer; }
    .dsh-bot-space .bs-button:focus-visible,
    .dsh-bot-space .bs-primary:focus-visible,
    .dsh-bot-space .bs-icon-button:focus-visible,
    .dsh-bot-space .bs-mobile-toggle:focus-visible,
    .dsh-bot-space .bs-context-toggle:focus-visible,
    .dsh-bot-space .bs-contact:focus-visible,
    .dsh-bot-space .bs-nav-item:focus-visible,
    .dsh-bot-space .bs-history-item:focus-visible,
    .dsh-bot-space .bs-search:focus-visible,
    .dsh-bot-space .bs-input:focus-visible,
    .dsh-bot-space .bs-select:focus-visible,
    .dsh-bot-space .bs-textarea:focus-visible,
    .dsh-bot-space .bs-load-more:focus-visible,
    .dsh-bot-space .bs-new-messages:focus-visible,
    .dsh-bot-space .bs-details > summary:focus-visible,
    .dsh-bot-space .bs-check > input:focus-visible { outline: 2px solid var(--bs-accent-ink); outline-offset: 3px; }
    .dsh-bot-space .bs-composer:focus-within { border-color: var(--bs-accent-ink); }
    .dsh-bot-space[data-context-collapsed="true"] .bs-shell { grid-template-columns: 248px minmax(0, 1fr); }
    .dsh-bot-space[data-context-collapsed="true"] .bs-context { display: none; }
    @container bot-space (max-width: 1179px) {
      .dsh-bot-space .bs-shell { grid-template-columns: 248px minmax(0, 1fr); }
      .dsh-bot-space .bs-context { display: none; position: absolute; top: 0; right: 0; bottom: 0; z-index: 50; width: min(296px, calc(100% - 40px)); box-shadow: -12px 0 40px rgb(0 0 0 / 12%); }
      .dsh-bot-space[data-context-open="true"] .bs-context { display: flex; }
      .dsh-bot-space[data-context-open="true"] .bs-backdrop[data-for="context"] { display: block; }
    }
    @container bot-space (max-width: 839px) {
      .dsh-bot-space .bs-shell,
      .dsh-bot-space[data-context-collapsed="true"] .bs-shell { grid-template-columns: minmax(0, 1fr); }
      .dsh-bot-space .bs-rail { display: none; position: absolute; top: 0; left: 0; bottom: 0; z-index: 50; width: min(296px, calc(100% - 40px)); box-shadow: 12px 0 40px rgb(0 0 0 / 12%); }
      .dsh-bot-space[data-rail-open="true"] .bs-rail { display: flex; }
      .dsh-bot-space[data-rail-open="true"] .bs-backdrop[data-for="rail"] { display: block; }
      .dsh-bot-space .bs-mobile-toggle { display: inline-flex; }
      .dsh-bot-space .bs-brand { gap: 9px; padding-right: 0; padding-left: 0; }
      .dsh-bot-space .bs-brand > .bs-mobile-toggle { flex: 0 0 40px; width: 40px; margin-left: auto; padding: 8px; font-size: 0; }
      .dsh-bot-space .bs-brand > .bs-mobile-toggle::before { content: "×"; font-size: 22px; line-height: 1; }
      .dsh-bot-space .bs-header { flex-wrap: wrap; gap: 10px; min-height: 80px; padding: 14px 16px; }
      .dsh-bot-space .bs-header-identity { flex-basis: 180px; }
      .dsh-bot-space .bs-header-actions { gap: 6px; margin-left: auto; }
      .dsh-bot-space .bs-transcript,
      .dsh-bot-space .bs-messages { padding: 20px 16px 12px; }
      .dsh-bot-space .bs-composer { width: calc(100% - 32px); margin-bottom: 16px; }
      .dsh-bot-space .bs-round { width: calc(100% - 32px); }
      .dsh-bot-space .bs-feedback,
      .dsh-bot-space .bs-error,
      .dsh-bot-space .bs-pending { margin-right: 16px; margin-left: 16px; }
      .dsh-bot-space .bs-empty { padding: 28px 20px; }
    }
    @container bot-space (max-width: 439px) {
      .dsh-bot-space .bs-header-identity { flex-basis: calc(100% - 56px); }
      .dsh-bot-space .bs-header-actions { justify-content: flex-start; width: 100%; margin-left: 0; }
      .dsh-bot-space .bs-composer-footer { flex-wrap: wrap; }
      .dsh-bot-space .bs-composer-footer .bs-primary { margin-left: auto; }
      .dsh-bot-space .bs-message-body { margin-left: 0; }
      .dsh-bot-space .bs-message[data-producer="human"] .bs-message-body { max-width: 100%; }
      .dsh-bot-space .bs-modal,
      .dsh-bot-space .bs-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); border-radius: 12px; }
      .dsh-bot-space .bs-modal-header { padding: 16px; }
      .dsh-bot-space .bs-modal-body { padding: 18px 16px; }
      .dsh-bot-space .bs-modal-actions { padding: 14px 16px 16px; }
      .dsh-bot-space .bs-modal-body > .bs-modal-header { margin: -18px -16px 18px; }
      .dsh-bot-space .bs-modal-body .bs-modal-actions { margin: 4px -16px -18px; }
    }
    @media (prefers-color-scheme: dark) {
      .dsh-bot-space { --bs-fallback-surface: #171d1b; --bs-fallback-subtle: #202825; --bs-fallback-ink: #e5eeea; --bs-fallback-muted: #a4b4ad; --bs-fallback-rule: #34413b; }
    }
    @media (forced-colors: active) {
      .dsh-bot-space .bs-contact[aria-selected="true"],
      .dsh-bot-space .bs-contact[aria-pressed="true"],
      .dsh-bot-space .bs-history-item[aria-selected="true"],
      .dsh-bot-space .bs-history-item[aria-pressed="true"] { border: 1px solid Highlight; }
      .dsh-bot-space .bs-primary { border-color: ButtonText; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dsh-bot-space .bs-contact,
      .dsh-bot-space .bs-nav-item,
      .dsh-bot-space .bs-button,
      .dsh-bot-space .bs-primary,
      .dsh-bot-space .bs-icon-button,
      .dsh-bot-space .bs-mobile-toggle,
      .dsh-bot-space .bs-context-toggle,
      .dsh-bot-space .bs-load-more,
      .dsh-bot-space .bs-new-messages { transition: none; }
    }
    `;
    // END GENERATED BOT SPACE STYLES
    const translations = {
      zh: {
        title: "Bot 工作台",
        newSession: "新建 Bot 会话",
        close: "关闭",
        refresh: "刷新",
        empty: "请先在工作台创建并命名一个 Bot",
        choose: "选择已创建的 Bot",
        start: "开始对话",
        manage: "管理此 Bot",
      },
      en: {
        title: "Bot workbench",
        newSession: "New Bot conversation",
        close: "Close",
        refresh: "Refresh",
        empty: "Create and name a Bot in the workbench first",
        choose: "Choose an existing Bot",
        start: "Start conversation",
        manage: "Manage this Bot",
      },
    };
    const styles = `.dsh-bot{font:inherit;color:var(--dsw-alias-label-primary);padding:24px;overflow:auto;height:100%;box-sizing:border-box}.dsh-bot *{box-sizing:border-box}.dsh-bot h1{font-size:24px;margin:0}.dsh-bot h2{font-size:17px;margin:0 0 16px}.dsh-bot h3{font-size:15px;margin:0 0 8px}.dsh-bot p{line-height:1.65}.dsh-bot small,.dsh-bot .muted{color:var(--dsw-alias-label-secondary)}.dsh-bot header,.dsh-bot nav,.dsh-bot .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-bot header{justify-content:space-between;margin-bottom:20px}.dsh-bot nav{margin-bottom:20px}.dsh-bot button,.dsh-bot input,.dsh-bot select,.dsh-bot textarea{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);padding:9px 12px}.dsh-bot button{cursor:pointer}.dsh-bot button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-bot button:disabled{opacity:.5;cursor:wait}.dsh-bot button[aria-selected=true],.dsh-bot button.primary{background:var(--dsw-alias-state-business-primary);color:white}.dsh-bot form{display:grid;gap:12px}.dsh-bot label{display:grid;gap:6px;font-size:13px}.dsh-bot input,.dsh-bot select,.dsh-bot textarea{width:100%;min-width:0}.dsh-bot textarea{min-height:92px;resize:vertical}.dsh-bot .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}.dsh-bot .card{border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:12px;padding:18px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1,transparent)}.dsh-bot .error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.dsh-bot pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace;max-height:360px;overflow:auto}.dsh-bot .status{font-size:12px;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent)}.dsh-bot details.advanced{margin:8px 0}.dsh-bot summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary);padding:6px 0}.dsh-bot .advanced-content{display:grid;gap:12px;padding-top:10px}.dsh-bot .check{display:flex;align-items:center;gap:8px}.dsh-bot .check input{width:auto}.dsh-bot-dialog{position:fixed;inset:0;display:grid;place-items:center;pointer-events:auto;background:rgba(0,0,0,.35);z-index:90}.dsh-bot-dialog .dsh-bot{height:auto;width:min(480px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-1,Canvas);border-radius:16px;max-height:90vh;overflow:auto}`;
    return {
      inject: [
        "slots",
        "locale",
        "connection",
        "layout",
        "uiWorkspace",
        "sessions",
        "uiSession",
        "uiConversation",
      ],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register("dsh.bot", translations));
        const t = ctx.locale.bind("dsh.bot"),
          listeners = new Set(),
          lifetime = new AbortController();
        const pluginVersion = "1.3.0", clientProtocol = 2;
        let interval,
          refreshing,
          refreshingCatalog = false,
          readError,
          pendingLoaded = false,
          pendingStoreId,
          existingChatIntent = 0;
        let state = {
          snapshot: {
            bots: [],
            tasks: [],
            sessions: [],
            memories: [],
            grants: [],
            groups: [],
            meetings: [],
            outbox: [],
            attempts: [],
            materials: [],
            schedules: [],
            notices: [],
          },
          catalog: { providers: [], presets: [] },
          error: "",
          storageNotice: "",
          busy: false,
          chooser: false,
          deleting: null,
          briefing: null,
          requestedTab: null,
          focusTaskId: null,
          focusBotId: null,
          focusRoundId: null,
          focusGroupId: null,
          focusMeetingId: null,
          pending: [],
          retained: [],
          loading: true,
        };
        const publish = (patch, errorOwner) => {
          if (Object.hasOwn(patch, "error")) readError = errorOwner;
          state = { ...state, ...patch };
          for (const listener of listeners) listener();
        };
        const useView = () =>
          useSyncExternalStore(
            (listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            () => state,
            () => state,
          );
        const storageKey = () =>
          `dsh-bot.pending.v1.${pendingStoreId ?? state.snapshot.storeId ?? "unknown"}`;
        function savePending(pending = state.pending) {
          try {
            localStorage.setItem(storageKey(), JSON.stringify(pending));
          } catch {
            throw Object.assign(Error("无法保存完整原始请求到浏览器存储；请恢复存储后用原 ID 接续。当前草稿和原请求仍保留在此页面。"), {code:"browser_storage",beforeWrite:true});
          }
        }
        function loadPending(storeId) {
          if (pendingLoaded || !storeId || (pendingStoreId && pendingStoreId !== storeId)) return;
          pendingStoreId = storeId;
          let pending = state.pending, retained = state.retained;
          const merge = (cached, live) => [...cached, ...live.filter(row=>!cached.some(saved=>saved.operationId===row.operationId))];
          try {
            const stored = JSON.parse(localStorage.getItem(storageKey()) ?? "[]");
            if (Array.isArray(stored) && stored.length <= 30) pending = merge(stored,pending);
          } catch {
            /* invalid browser cache cannot modify host state */
          }
          try {
            const history = JSON.parse(localStorage.getItem(`${storageKey()}.retained`) ?? "[]");
            if (Array.isArray(history)) retained = merge(history,retained);
          } catch {
            /* pending originals remain available if history cannot be read */
          }
          pendingLoaded = true;
          publish({pending,retained});
        }
        async function rpc(endpoint, payload = {}) {
          const signal = AbortSignal.any([
              lifetime.signal,
              AbortSignal.timeout(15000),
            ]),
            reply = await ctx.connection.rpc.call(
              "/api",
              `dsh.bot/${endpoint}`,
              payload,
              signal,
            );
          if (!reply.ok)
            throw Object.assign(Error(reply.error.message), {
              code: reply.error.code,
              details: reply.error.details,
            });
          return reply.value;
        }
        async function refresh(catalog = false) {
          if (lifetime.signal.aborted) return;
          if (refreshing) {
            if (!catalog || refreshingCatalog) return refreshing;
            await refreshing;
            return refresh(true);
          }
          const previousError = readError;
          refreshingCatalog = catalog;
          refreshing = (async () => {
            try {
              const snapshot = await rpc("snapshot");
              if (lifetime.signal.aborted) return;
              // Load originals synchronously, before catalog awaits or any command
              // can save this profile. Later reads cannot restore an older array.
              loadPending(snapshot.storeId);
              const nextCatalog = catalog ? await rpc("catalog") : undefined;
              if (lifetime.signal.aborted) return;
              publish({
                snapshot,
                loading: false,
                ...(catalog ? { catalog: nextCatalog } : {}),
                ...(previousError?.kind === "refresh" && readError === previousError ? {error:""} : {}),
              });
            } catch (error) {
              if (!lifetime.signal.aborted)
                publish({
                  error: `${error.code ?? "connection"}：${error.message}`,
                  loading: false,
                }, {kind:"refresh"});
            } finally {
              refreshing = null;
              refreshingCatalog = false;
            }
          })();
          return refreshing;
        }
        async function requireCompatible() {
          const snapshot = await rpc("snapshot");
          if (snapshot.pluginVersion !== pluginVersion || snapshot.clientProtocol !== clientProtocol)
            throw Object.assign(Error(`Bot 插件版本不一致：界面 ${pluginVersion}，运行服务 ${snapshot.pluginVersion ?? "旧候选／未知"}。请安装同一新版插件，完全重启 DSH 后刷新此页面。`), {code:"plugin_version_mismatch",beforeWrite:true});
          if ((pendingStoreId ?? state.snapshot.storeId) && (pendingStoreId ?? state.snapshot.storeId) !== snapshot.storeId)
            throw Object.assign(Error("当前 DSH profile 已改变。原始操作仍保留在原 profile，请刷新页面后再操作。"), {code:"profile_changed",beforeWrite:true});
          loadPending(snapshot.storeId);
          return snapshot;
        }
        async function refreshAfterCommand() {
          // An in-flight poll may have read before the mutation committed.
          // Preserve its catalog intent, then fetch a fresh post-commit snapshot.
          if (refreshing) await refreshing;
          return refresh();
        }
        function forgetPending(operationId, committed = false) {
          const pending = state.pending.filter(row=>row.operationId !== operationId);
          try {
            savePending(pending);
            publish({pending,storageNotice:""});
            return true;
          } catch {
            publish({storageNotice: committed
              ? `原始操作 ${operationId} 已收到确定的已提交回执。浏览器记录清理失败；原 ID 仍保留，可只读查回。`
              : "历史已保存，但待查回记录未能从浏览器存储移除；原 ID 仍保留，请恢复存储后重试。"});
            return false;
          }
        }
        function retainPending(request) {
          if(state.busy)return;
          const retained=state.retained.some(row=>row.operationId===request.operationId)?state.retained:[...state.retained,request];
          try {localStorage.setItem(`${storageKey()}.retained`,JSON.stringify(retained));}
          catch {publish({error:"无法保存原始请求历史；待查回记录仍保留，请先恢复浏览器存储。"});return;}
          publish({retained});forgetPending(request.operationId);
        }
        async function readOperation(request) {
          return rpc("command",{action:"operation.lookup",input:{operationId:request.operationId,request}});
        }
        async function lookupOperation(request) {
          if (state.busy) return;
          publish({busy:true,error:""});
          try {
            await requireCompatible();
            const receipt = await readOperation(request);
            if (receipt.state === "committed") {
              forgetPending(request.operationId, true);
              await refreshAfterCommand();
              return receipt.result;
            }
            publish({error:`原始操作 ${request.operationId} 暂无已提交回执，结果仍未确认。原请求已保留；查回不会执行任务或发送模型请求。`});
          } catch (error) {
            publish({error:`${error.code ?? "connection"}：${error.message}\n原始操作 ${request.operationId} 仍保留。`});
          } finally {publish({busy:false});}
        }
        async function command(action, input, original, metadata = {}) {
          const request = original ?? {
            ...metadata,
            operationId: crypto.randomUUID(),
            action,
            input,
          };
          if (state.busy) return;
          publish({ busy: true, error: "" });
          try {
            await requireCompatible();
            if (!state.pending.some(row=>row.operationId === request.operationId)) {
              if (state.pending.length >= 30)
                throw Object.assign(Error("待查回操作已达 30 条，请先查回，或将不再接续的请求“保留并收起”；原 ID 均保留在历史中。"),{code:"pending_limit",beforeWrite:true});
              publish({pending:[...state.pending,request]});
            }
            // Even an original loaded from history must be saved again before
            // continuation; the browser may have lost write permission.
            savePending();
            if (original) {
              const receipt = await readOperation(request);
              if (receipt.state === "committed") {
                forgetPending(request.operationId, true);
                await refreshAfterCommand();
                return receipt.result;
              }
            }
            const value = await rpc("command", request);
            forgetPending(request.operationId, true);
            await refreshAfterCommand();
            return value;
          } catch (error) {
            publish({
              error: `${error.code ?? "unknown"}：${error.message}${error.beforeWrite ? "\n原始请求未发送。" : error.details?.rejectedBeforeWrite ? `\n${["bot.create","bot.update"].includes(request.action) ? "提交被拒，未写入 Bot 配置。" : "提交被拒，未执行本次修改。"}原始操作 ${request.operationId} 已保留；处理提示的问题后可重新提交，也可先查回原始操作。` : `\n原始操作 ${request.operationId} 已保留，结果未确认，请先查回。`}`,
            });
          } finally {
            publish({ busy: false });
          }
        }
        async function query(action, input = {}, isActive = () => true) {
          const previousError = readError;
          try {
            const value = await rpc("command", {action, input});
            if (!lifetime.signal.aborted && isActive() && previousError?.action === action && readError === previousError)
              publish({error:""});
            return value;
          }
          catch (error) { if (!lifetime.signal.aborted && isActive()) publish({error: `${error.code ?? "connection"}：${error.message}`}, {action}); }
        }
        function downloadText(text, name, type = "text/plain;charset=utf-8") {
          const url = URL.createObjectURL(new Blob([text], {type})), link = document.createElement("a");
          link.href = url; link.download = name; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        async function readUtf8(file, maxBytes) {
          if (!file || file.size <= 0 || file.size > maxBytes) throw Error("文件为空或超过允许大小。");
          try { return new TextDecoder("utf-8", {fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()); }
          catch { throw Error("无法读取 UTF-8 文件，请检查编码后重试。"); }
        }
        async function fileDigest(text) {
          const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
          return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,"0")).join("");
        }
        const button = (text, onClick, extra = {}) =>
          h(
            "button",
            { type: "button", onClick, disabled: state.busy, ...extra },
            text,
          );
        const option = (value, label) =>
          h("option", { key: value, value }, label);
        const field = (
          label,
          name,
          {
            value = "",
            type = "text",
            required = true,
            options,
            textarea = false,
            ...extra
          } = {},
        ) =>
          h(
            "label",
            null,
            label,
            options
              ? h(
                  "select",
                  {
                    name,
                    "aria-label": label,
                    defaultValue: value,
                    required,
                    ...extra,
                  },
                  options.map((row) => option(row.value, row.label)),
                )
              : textarea
                ? h("textarea", {
                    name,
                    "aria-label": label,
                    defaultValue: value,
                    required,
                    ...extra,
                  })
                : h("input", {
                    name,
                    "aria-label": label,
                    type,
                    defaultValue: value,
                    required,
                    ...extra,
                  }),
          );
        const resourceCard = (key, title, ...children) =>
          h(
            "section",
            { className: "card", key, id:key?`dsh-resource-${key}`:undefined,tabIndex:key?-1:undefined },
            h("h2", null, title),
            ...children,
          );
        const card = (title, ...children) =>
          resourceCard(undefined, title, ...children);
        const form = (label, submit, ...children) =>
          h(
            "form",
            {
              key: label,
              onSubmit: (event) => {
                event.preventDefault();
                submit(new FormData(event.currentTarget));
              },
            },
            ...children,
            h(
              "button",
              { type: "submit", className: "primary", disabled: state.busy },
              label,
            ),
          );
        const check = (name, label, checked = true) =>
          h(
            "label",
            { className: "check" },
            h("input", { type: "checkbox", name, defaultChecked: checked }),
            label,
          );
        const advanced = (label, ...children) =>
          h("details", { className: "advanced" },
            h("summary", null, label),
            h("div", { className: "advanced-content" }, ...children),
          );
        const botLabel = (bot) => bot
          ? state.snapshot.bots.filter((row) => row.name === bot.name).length > 1
            ? `${bot.name} · ${bot.botId}`
            : bot.name
          : "Bot";
        const botsOptions = () =>
          state.snapshot.bots.map((bot) => ({
            value: bot.botId,
            label: botLabel(bot),
          }));
        const modelsOptions = () =>
          state.catalog.providers.flatMap((provider) =>
            (provider.models ?? []).map((model) => ({
              value: JSON.stringify({ provider: provider.id, model: model.id }),
              label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
            })),
          );
        const stateName = (value) =>
          ({
            queued: "待开始",
            running: "执行中",
            starting: "准备中",
            stopping: "停止已接受，待结算",
            stop_requested: "停止已接受，待结算",
            returned: "已返回",
            awaiting_acceptance: "待验收",
            completed: "已完成",
            stopped: "已停止",
            failed: "失败",
            UNKNOWN: "未知，需查回",
            ready: "可接续",
            settled: "已结算",
            creating: "创建中",
            independent: "独立意见封存中",
            discussion: "讨论",
            decision: "决定",
            complete: "已完成",
            cancelled: "已取消",
            active: "启用",
            paused: "暂停",
            archived: "归档",
            passed: "通过",
            unknown: "待定",
            accepted: "已投递",
            available: "结果已保存",
            blocked: "受限，需检查",
            planned:"待触发",
            claimed:"已认领，待准入",
            missed:"已错过",
          })[value] ?? value;
        const openSession = async (sessionId, nativeRow, isActive = () => true) => {
          const row =
            nativeRow ??
            state.snapshot.sessions.find((row) => row.sessionId === sessionId);
          try {
            await ctx.sessions.refresh();
            if (lifetime.signal.aborted || !isActive()) return;
            const parentSessionId =
              row?.parentSessionId ?? row?.header?.parentSession;
            ctx.uiWorkspace.openSession(
              parentSessionId
                ? {
                    parentSessionId,
                    childSessionId: sessionId,
                    mode: row?.parentSessionId ? "one-shot" : "unknown",
                  }
                : sessionId,
            );
          } catch (error) {
            if (!lifetime.signal.aborted && isActive()) publish({ error: `无法打开原生会话：${error.message}` });
          }
        };
        function BotEditor({ bot: latestBot }) {
          const [bot, setDraftBase] = useState(latestBot),
            [formEpoch, setFormEpoch] = useState(0);
          const models = modelsOptions(), preferred = state.catalog.defaultModel;
          const selected = models.find(row => {
            const model = JSON.parse(row.value);
            return model.provider === preferred?.provider && model.model === preferred?.model;
          })?.value ?? models[0]?.value ?? "";
          const initialContact = bot
            ? JSON.stringify({provider: bot.contact.provider, model: bot.contact.model})
            : selected;
          const separateExecution = bot && bot.executionMode !== "inherit";
          const [draftChoices,setChoices]=useState({contact:initialContact,execution:separateExecution?JSON.stringify({provider:bot.execution.provider,model:bot.execution.model}):"",preset:bot?.presetId??""});
          const contact=draftChoices.contact;
          const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
          const configuredModels = configuration => {
            const value = configuration && JSON.stringify({provider:configuration.provider,model:configuration.model});
            return value && !models.some(row=>row.value === value)
              ? [...models,{value,label:`${configuration.provider} / ${configuration.model}（当前不可用，请重新选择）`}]
              : models;
          };
          const newDefaults = sameRoute(JSON.parse(contact || "{}"), preferred) ? preferred : undefined;
          const presetOptions=state.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}));
          if(draftChoices.preset && !presetOptions.some(row=>row.value===draftChoices.preset))presetOptions.push({value:draftChoices.preset,label:`${draftChoices.preset}（当前不可用，请重新选择）`});
          const modelInput = (selection, effort, tokens, previous) => ({
            ...selection,
            ...(effort ? {reasoningEffort: effort} : {}),
            ...(tokens ? {maxTokens: Number(tokens)} : {}),
            ...(previous?.temperature === undefined ? {} : {temperature: previous.temperature}),
          });
          return card(
            bot ? "编辑 Bot" : "创建具名 Bot",
            latestBot && bot && latestBot.revision !== bot.revision && h(
              "div", null,
              h("p", {role: "status"}, "此 Bot 的配置已在其他页面更新。当前草稿已保留，保存将检查原版本。"),
              button("重新载入最新配置", () => {
                setDraftBase(latestBot);
                setChoices({contact:JSON.stringify({provider:latestBot.contact.provider,model:latestBot.contact.model}),execution:latestBot.executionMode!=="inherit"?JSON.stringify({provider:latestBot.execution.provider,model:latestBot.execution.model}):"",preset:latestBot.presetId??""});
                setFormEpoch(epoch => epoch + 1);
              }),
            ),
            h("div", {key: formEpoch}, form(
              bot ? "保存配置" : "创建 Bot",
              async data => {
                const chosen = JSON.parse(data.get("contact"));
                const inheritsExecution = !data.get("execution");
                const contactConfiguration = modelInput(chosen, data.get("contactEffort"), data.get("contactMaxTokens"),
                  bot?.contact ?? (sameRoute(chosen, preferred) ? preferred : undefined));
                const configuration = {
                  name: data.get("name"), role: data.get("role"),
                  contact: contactConfiguration,
                  execution: modelInput(data.get("execution") ? JSON.parse(data.get("execution")) : chosen,
                    data.get("executionEffort") || (inheritsExecution ? contactConfiguration.reasoningEffort : ""),
                    data.get("executionMaxTokens") || (inheritsExecution ? contactConfiguration.maxTokens : ""),
                    bot?.execution ?? (inheritsExecution ? contactConfiguration : undefined)),
                  executionMode: inheritsExecution ? "inherit" : "explicit",
                  presetId: data.get("preset") || null,
                  ...(data.get("cwd")?.trim() ? {cwd: data.get("cwd").trim()} : {}),
                };
                const saved = await command(bot ? "bot.update" : "bot.create", {
                  ...configuration,
                  ...(bot ? {botId: bot.botId, expectedVersion: bot.revision} : {}),
                });
                if (bot && saved) {
                  setDraftBase(saved);
                  setChoices({contact:JSON.stringify({provider:saved.contact.provider,model:saved.contact.model}),execution:saved.executionMode!=="inherit"?JSON.stringify({provider:saved.execution.provider,model:saved.execution.model}):"",preset:saved.presetId??""});
                  setFormEpoch(epoch => epoch + 1);
                }
                return saved;
              },
              field("名称", "name", {value: bot?.name, maxLength: 100}),
              field("身份与职责", "role", {value: bot?.role, textarea: true, required: false, maxLength: 8192}),
              field("模型", "contact", {value: contact, options: configuredModels(JSON.parse(contact || "null")), onChange: event => {
                const controls = event.currentTarget.form.elements;
                const value=event.currentTarget.value, chosen = JSON.parse(value);
                controls.contactEffort.value = !bot && sameRoute(chosen, preferred) ? preferred?.reasoningEffort ?? "" : "";
                if (!controls.execution.value) controls.executionEffort.value = "";
                setChoices(choices=>({...choices,contact:value}));
              }}),
              advanced("更多设置",
                field("工作目录（DSH 所在机器）", "cwd", {
                  value: bot?.cwd ?? state.catalog.defaultCwd ?? "",
                  required: false, placeholder: "默认使用 DSH 当前工作目录",
                }),
                field("执行模型", "execution", {
                  value: draftChoices.execution,
                  options: [{value: "", label: "与聊天模型相同"}, ...configuredModels(JSON.parse(draftChoices.execution || "null"))], required: false,
                  onChange: event => {
                    const value=event.currentTarget.value,chosen = value ? JSON.parse(value) : null;
                    if (!sameRoute(chosen, bot?.execution)) event.currentTarget.form.elements.executionEffort.value = "";
                    setChoices(choices=>({...choices,execution:value}));
                  },
                }),
                field("联络思考程度（留空使用当前模型默认）", "contactEffort", {
                  value: (bot ? bot.contact.reasoningEffort : newDefaults?.reasoningEffort) ?? "", required: false,
                }),
                field("联络每轮回复上限（tokens）", "contactMaxTokens", {
                  type: "number", min: 1, max: 262144, step: 1,
                  value: (bot ? bot.contact.maxTokens : newDefaults?.maxTokens) ?? "", required: false, placeholder: "使用模型默认值",
                }),
                field("执行思考程度", "executionEffort", {value: bot?.execution.reasoningEffort ?? "", required: false}),
                field("执行每轮回复上限（tokens）", "executionMaxTokens", {
                  type: "number", min: 1, max: 262144, step: 1,
                  value: bot?.execution.maxTokens ?? "", required: false, placeholder: "使用模型默认值",
                }),
                field("原生 Agent preset", "preset", {
                  value: draftChoices.preset,
                  options: [{value: "", label: "使用 DSH 默认会话配置"},
                    ...presetOptions],
                  required: false,
                  onChange:event=>{const value=event.currentTarget.value;setChoices(choices=>({...choices,preset:value}));},
                }),
              ),
              h("small", null, models.length ? "工作工具默认沿用 DSH，任务在后台运行，可随时继续聊天。" : "请先在 DSH 中配置模型，再创建 Bot。"),
            )),
          );
        }
        function TemplateCreator({teamOnly=false}) {
          const view=useView(),[templates,setTemplates]=useState([]),[choice,setChoice]=useState(""),[baseRevision,setBaseRevision]=useState(view.snapshot.revision),[epoch,setEpoch]=useState(0),[selections,setSelections]=useState({}),initialRoute=useRef(null);
          useEffect(()=>{let active=true;query("template.list",{},()=>active).then(value=>{if(active&&value)setTemplates(Array.isArray(value)?value:value.templates??[]);});return()=>{active=false;};},[]);
          const choices=templates.filter(row=>!!row.coordinatorRoleKey===teamOnly),template=choices.find(row=>row.templateId===choice)??choices[0],models=modelsOptions();
          const defaults=models.find(row=>{const parsed=JSON.parse(row.value);return parsed.provider===view.catalog.defaultModel?.provider&&parsed.model===view.catalog.defaultModel?.model;})?.value??models[0]?.value??"";
          if(initialRoute.current===null)initialRoute.current=defaults;
          const templateModels = selected => selected&&!models.some(row=>row.value===selected) ? [...models,{value:selected,label:`${JSON.parse(selected).provider} / ${JSON.parse(selected).model}（当前不可用，请重新选择）`}] : models;
          const templatePresets = selected => {const presets=view.catalog.presets.filter(item=>!item.broken).map(item=>({value:item.id,label:item.name??item.id}));return selected&&!presets.some(row=>row.value===selected)?[...presets,{value:selected,label:`${selected}（当前不可用，请重新选择）`}]:presets;};
          return advanced(teamOnly?"从团队模板创建":"从 Bot 模板创建",
            h("p",null,"模板创建全新的 Bot，可先修改名称和分工。创建完成后再开始聊天或任务。"),
            field("模板","template",{value:template?.templateId??"",required:false,options:choices.map(row=>({value:row.templateId,label:row.name})),onChange:event=>{setChoice(event.target.value);setBaseRevision(view.snapshot.revision);setSelections({});initialRoute.current=defaults;setEpoch(n=>n+1);}}),
            template&&h("div",{key:`${template.templateId}:${epoch}`},
              baseRevision!==view.snapshot.revision&&h("div",null,h("p",{role:"status"},"工作台已更新，模板草稿保留在原版本。"),button("按最新工作台重新准备模板",()=>{setBaseRevision(view.snapshot.revision);setSelections({});initialRoute.current=defaults;setEpoch(n=>n+1);})),
              form(teamOnly?"创建团队与内部群":"创建模板 Bot",async data=>{
                const roles=template.roles.map(row=>({roleKey:row.roleKey,config:{name:data.get(`${row.roleKey}.name`),role:data.get(`${row.roleKey}.role`),contact:JSON.parse(data.get(`${row.roleKey}.model`)),executionMode:data.get(`${row.roleKey}.execution`)?"explicit":"inherit",...(data.get(`${row.roleKey}.execution`)?{execution:JSON.parse(data.get(`${row.roleKey}.execution`))}:{}),presetId:data.get(`${row.roleKey}.preset`)||null,...(data.get(`${row.roleKey}.cwd`)?.trim()?{cwd:data.get(`${row.roleKey}.cwd`).trim()}:{})}}));
                await command("template.instantiate",{templateId:template.templateId,templateVersion:template.templateVersion,roles,...(teamOnly?{group:{name:data.get("groupName"),rounds:Number(data.get("groupRounds")),maxRequests:Number(data.get("groupRequests"))}}:{})},undefined,{expectedRevision:baseRevision});
              },...template.roles.map(row=>{const recipe=templates.find(item=>item.templateId===row.botTemplateId)??template;return h("section",{className:"card",key:row.roleKey},h("h3",null,recipe.name),field("Bot 名称",`${row.roleKey}.name`,{value:recipe.suggestedName??recipe.name,maxLength:100}),field("身份与分工",`${row.roleKey}.role`,{value:recipe.role,textarea:true,required:false,maxLength:8192}),field("聊天模型",`${row.roleKey}.model`,{value:selections[`${row.roleKey}.model`]??initialRoute.current,options:templateModels(selections[`${row.roleKey}.model`]??initialRoute.current),onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.model`]:event.target.value}))}),advanced("更多设置",field("执行模型",`${row.roleKey}.execution`,{value:selections[`${row.roleKey}.execution`]??"",options:[{value:"",label:"与聊天模型相同"},...templateModels(selections[`${row.roleKey}.execution`])],required:false,onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.execution`]:event.target.value}))}),field("工作目录",`${row.roleKey}.cwd`,{value:view.catalog.defaultCwd??"",required:false}),field("原生会话配置",`${row.roleKey}.preset`,{value:selections[`${row.roleKey}.preset`]??"",required:false,options:[{value:"",label:"使用 DSH 默认配置"},...templatePresets(selections[`${row.roleKey}.preset`])],onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.preset`]:event.target.value}))})));}),
                teamOnly&&field("内部群名称","groupName",{value:template.name,maxLength:100}),teamOnly&&advanced("群设置",field("成员轮数","groupRounds",{type:"number",value:template.group?.rounds??1,min:1,max:3}),field("每次群轮的请求预算","groupRequests",{type:"number",value:template.group?.maxRequests??12,min:1,max:60})))));
        }
        const resumableContact = (snapshot, botId, sessionId) =>
          snapshot.bots.some(bot=>bot.botId===botId && !bot.deletedAt) &&
          snapshot.sessions.find(row=>row.sessionId===sessionId && row.botId===botId && row.purpose==="contact" && row.state==="ready" && !row.archived);
        function ExistingChats({botId,onClose}) {
          const view=useView(),[opening,setOpening]=useState(false),generation=useRef(0),mounted=useRef(true);
          useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
          const close=()=>{generation.current++;onClose();};
          const choose=async sessionId=>{
            if(opening || state.busy || lifetime.signal.aborted)return;
            const attempt=++generation.current,intent=existingChatIntent,isActive=()=>mounted.current && attempt===generation.current && intent===existingChatIntent && !lifetime.signal.aborted;
            setOpening(true);
            try {
              const snapshot=await rpc("snapshot");
              if(!isActive())return;
              const row=resumableContact(snapshot,botId,sessionId);
              if(!row || !resumableContact(state.snapshot,botId,sessionId)){
                publish({snapshot,error:"此聊天已归档、状态已改变或 Bot 已删除，请重新选择已有聊天。"});
                return;
              }
              publish({snapshot});
              await openSession(sessionId,row,()=>isActive() && !!resumableContact(state.snapshot,botId,sessionId));
              if(isActive())close();
            } catch(error) {
              if(isActive())publish({error:`无法读取已有聊天：${error.message}`});
            } finally {if(isActive())setOpening(false);}
          };
          const rows=view.snapshot.sessions.filter(row=>resumableContact(view.snapshot,botId,row.sessionId));
          return h("section",{"aria-label":"选择已有聊天"},
            h("h3",null,"继续已有聊天"),
            rows.length ? h("div",{className:"actions"},...rows.map(row=>button(`${row.name || "未命名聊天"} · ${row.sessionId}`,()=>choose(row.sessionId),{key:row.sessionId,disabled:view.busy||opening})))
              : h("p",{role:"status"},"没有可继续的已有聊天。可点击“开始聊天”创建新会话。"),
            button("关闭继续聊天",close,{disabled:false}));
        }
        function BotsPane() {
          const [editing, setEditing] = useState(null),
            [continuing,setContinuing]=useState(null),view = useView();
          const selected = view.snapshot.bots.find(
            (bot) => bot.botId === editing && !bot.deletedAt,
          );
          useEffect(()=>{if(editing&&!selected)setEditing(null);},[editing,selected]);
          const cards = view.snapshot.bots.filter(bot=>!bot.deletedAt).map((bot) =>
            resourceCard(
              bot.botId,
              botLabel(bot),
              h("p", { className: "muted" }, bot.role || "未设置职责"),
              h(
                "p",
                null,
                `模型 ${bot.contact.model}${bot.execution.model !== bot.contact.model ? ` · 任务 ${bot.execution.model}` : ""}`,
              ),
              h(
                "p",
                null,
                `工作槽 ${view.snapshot.attempts.filter((row) => row.botId === bot.botId && row.reservationHeld).length}/15 · ${stateName(bot.lifecycle)}`,
              ),
              h(
                "div",
                { className: "actions" },
                button("开始聊天", async () => {
                  const contact = await command("session.create", {botId: bot.botId});
                  if (contact?.state === "ready") await openSession(contact.sessionId);
                }, {className: "primary", disabled: view.busy || bot.lifecycle !== "active"}),
                button("继续聊天",()=>{if(continuing!==bot.botId){existingChatIntent++;setContinuing(bot.botId);}},{"aria-expanded":continuing===bot.botId}),
                button("编辑", () => setEditing(bot.botId)),
                button("删除", event => publish({deleting:{botId:bot.botId,expectedVersion:bot.revision,name:botLabel(bot),returnFocus:event.currentTarget},error:""})),
                advanced("状态管理", button(bot.lifecycle === "active" ? "暂停" : "启用", () =>
                  command("bot.update", {
                    botId: bot.botId, expectedVersion: bot.revision,
                    lifecycle: bot.lifecycle === "active" ? "paused" : "active",
                  }),
                )),
              ),
              h("small",null,"“开始聊天”创建新会话；“继续聊天”打开已保存的原会话。"),
              continuing===bot.botId && h(ExistingChats,{key:bot.botId,botId:bot.botId,onClose:()=>setContinuing(null)}),
            ),
          );
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...cards,
              view.snapshot.bots.some(bot=>bot.deletedAt) && advanced("已删除的 Bot",
                h("p",{className:"muted"},"原会话、记忆与任务保留。恢复后先暂停，启用后可继续使用同一 Bot。"),
                ...view.snapshot.bots.filter(bot=>bot.deletedAt).map(bot=>h("article",{key:bot.botId},
                  h("p",null,botLabel(bot)),
                  button("恢复",()=>command("bot.restore",{botId:bot.botId,expectedVersion:bot.revision})),
                )),
              ),
              editing && button("创建另一个 Bot", () => setEditing(null)),
            ),
            h("div",null,h(BotEditor, {key: selected?.botId ?? "new",bot: selected}),h(TemplateCreator)),
          );
        }
        const categories = [{value:"fact",label:"事实"},{value:"preference",label:"偏好"},{value:"decision",label:"决定"},{value:"responsibility",label:"职责"}];
        const categoryName = value => categories.find(row=>row.value===value)?.label ?? `其他（${value ?? "未分类"}）`;
        const updatedName = value => value ? new Date(value).toLocaleString() : "未知";
        function MemoryEditor({memory:latestMemory,botId,onSaved}) {
          const [base,setBase]=useState(latestMemory),[epoch,setEpoch]=useState(0);
          const choices = base && !categories.some(row=>row.value===base.category) ? [...categories,{value:base.category,label:categoryName(base.category)}] : categories;
          return card(base?"编辑记忆":"添加记忆",
            latestMemory && latestMemory.version!==base.version && h("div",null,h("p",{role:"status"},"记忆已在其他页面更新。草稿保留，保存会检查开始编辑时的版本。"),button("重新载入最新记忆",()=>{setBase(latestMemory);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form(base?"保存记忆修改":"保存到所选 Bot",async data=>{
              const saved=await command("memory.write",{botId,text:data.get("text"),category:data.get("category"),pinned:data.get("pinned")==="on",...(base?{memoryId:base.memoryId,expectedVersion:base.version}:{})});
              if(saved){setBase(saved);setEpoch(n=>n+1);onSaved?.(saved);}
            },field("内容","text",{value:base?.text,textarea:true,maxLength:8192}),field("分类","category",{value:base?.category??"fact",options:choices}),check("pinned","固定重要记忆（每 Bot 最多 8 条）",base?.pinned??false))),
            h("small",null,"长期记忆随对话按预算带入；编辑与遗忘保留真实来源。"));
        }
        function MemoryTransfer({botId,readIntent}) {
          const view=useView(),[draft,setDraft]=useState(null),[unpin,setUnpin]=useState([]),[selected,setSelected]=useState([]),[loading,setLoading]=useState(false),draftGeneration=useRef(0);
          useEffect(()=>()=>{draftGeneration.current++;},[botId]);
          const activeMemories=view.snapshot.memories.filter(row=>row.botId===botId&&!row.forgotten);
          return advanced("导入导出",
            h("p",null,"只迁移当前 Bot 的长期记忆。导入仅追加；不可验证的受保护来源会保留为不可用。"),
            field("导出条目（可多选；留空导出全部，最多 500 条）","memoryIds",{options:activeMemories.map(row=>({value:row.memoryId,label:row.text.slice(0,60)})),multiple:true,required:false,value:selected,onChange:event=>setSelected([...event.target.selectedOptions].map(row=>row.value))}),
            button("导出记忆 JSON",async()=>{const result=await query("memory.export",{botId,...(selected.length?{memoryIds:selected}:{})});if(result)downloadText(result.fileText,result.fileName??"bot-memory.json","application/json;charset=utf-8");}),
            field("导入 JSON 文件","importFile",{type:"file",required:false,accept:".json,application/json",disabled:loading,onChange:async event=>{
              const generation=++draftGeneration.current,paneGeneration=readIntent.current,isActive=()=>generation===draftGeneration.current&&paneGeneration===readIntent.current&&!lifetime.signal.aborted,file=event.target.files?.[0];setDraft(null);setUnpin([]);if(!file){setLoading(false);return;}setLoading(true);
              try{const fileText=await readUtf8(file,4*1024*1024);if(!isActive())return;const digest=await fileDigest(fileText);if(!isActive())return;const preview=await query("memory.import.preview",{botId,fileText,fileDigest:digest},isActive);if(preview&&isActive()){setDraft({botId,fileText,fileDigest:digest,preview,fileEntries:JSON.parse(fileText).entries});setUnpin([]);}}
              catch(error){if(isActive())publish({error:error.message});}finally{if(isActive())setLoading(false);}
            }}),
            draft && h("div",null,
              h("p",null,`预览 ${draft.preview.entries.length} 条；目标记忆版本 ${draft.preview.memoryRevision}。并发修改将拒绝整批导入，当前预览保留。`),
              draft.preview.pinConflict && h("p",{role:"status"},"固定项超过额度，请在下方取消部分固定项后确认。"),
              ...draft.preview.entries.map((entry,index)=>h("article",{className:"card",key:index},
                h("p",null,entry.text??draft.fileEntries[entry.index??index]?.text??""),h("small",null,`${categoryName(entry.category??draft.fileEntries[entry.index??index]?.category)} · ${{skip:"重复，跳过",inactive:"来源待验证，不可用",append:"新增"}[entry.decision]??"待确认"} · ${{external_description:"外部来源说明",source_unverified:"来源待验证",external_protected_source:"外部受保护来源",verified_local_source:"本地来源已验证",source_revoked:"来源权限已撤销"}[entry.sourceVerification]??"来源待验证"}`),
                entry.pinned && entry.decision!=="skip" && h("label",{className:"check"},h("input",{type:"checkbox",checked:unpin.includes(index),onChange:event=>setUnpin(ids=>event.target.checked?[...ids,index]:ids.filter(id=>id!==index))}),"导入时取消固定"))),
              button("确认整批追加",async()=>{const generation=draftGeneration.current,result=await command("memory.import",{botId:draft.botId,fileText:draft.fileText,fileDigest:draft.fileDigest,expectedMemoryRevision:draft.preview.memoryRevision,...(unpin.length?{unpinnedEntryIndexes:unpin}:{})});if(result&&generation===draftGeneration.current){draftGeneration.current++;setDraft(null);setUnpin([]);}}, {disabled:view.busy||loading||draft.botId!==botId||(draft.preview.pinCount??0)-unpin.filter(index=>draft.preview.entries.some(entry=>entry.index===index&&entry.pinned&&entry.decision!=="skip")).length>8}),
            ),
            (draft||loading)&&button("取消导入",()=>{draftGeneration.current++;setDraft(null);setUnpin([]);setLoading(false);})
          );
        }
        function MaterialReader({docId,chunkId,onClose,readIntent,selectionIntent=readIntent}) {
          const [page,setPage]=useState(null),[cursor,setCursor]=useState(null),pageGeneration=useRef(0);
          useEffect(()=>{const generation=++pageGeneration.current,paneGeneration=readIntent.current,selectionGeneration=selectionIntent.current,isActive=()=>generation===pageGeneration.current&&paneGeneration===readIntent.current&&selectionGeneration===selectionIntent.current;query("material.page",{docId,...(chunkId?{chunkId}:{})},isActive).then(value=>{if(isActive()&&value){setPage(value);setCursor(value.nextCursor);}});return()=>{pageGeneration.current++;};},[docId,chunkId]);
          return card(page?.title??"资料正文",button("关闭正文",()=>{pageGeneration.current++;onClose();}),page&&h("div",null,
            h("p",{className:"muted"},`资料 ${docId}${chunkId?` · 引用 ${chunkId}`:""}`),
            h("pre",null,page.text??page.items?.map(row=>row.text??row.excerpt??"").join("\n")??""),
            page.chunkId&&h("small",null,`行 ${page.startLine}–${page.endLine}${page.section?` · ${page.section}`:""}`),
            page.source?.status==="verified"&&page.source.sessionId&&button("打开已核对的原生来源",()=>openSession(page.source.sessionId)),
            page.source&&h("p",{className:"muted"},({verified:"原生片段来源已核对",changed:"原生来源已变化；此处保留收录时的不可变正文",unavailable:"原生来源暂不可用；此处保留收录时的不可变正文",derived:"由 Bot 整理的资料",description:"用户提供的资料"})[page.source.status]??"来源说明"),
            cursor&&button("下一页正文",async()=>{const generation=++pageGeneration.current,paneGeneration=readIntent.current,selectionGeneration=selectionIntent.current,isActive=()=>generation===pageGeneration.current&&paneGeneration===readIntent.current&&selectionGeneration===selectionIntent.current;const value=await query("material.page",{docId,cursor},isActive);if(value&&isActive()){setPage(value);setCursor(value.nextCursor);}}),
            button("下载此份资料",async()=>{const result=await query("material.download",{docId});if(result)downloadText(result.text,result.fileName??`${result.title??"material"}.txt`);})
          ));
        }
        function MaterialsPane({botId,readIntent}) {
          const view=useView(),[hits,setHits]=useState(null),[opened,setOpened]=useState(null),[draft,setDraft]=useState({text:"",fileName:"",mediaType:"text/plain"}),[epoch,setEpoch]=useState(0),[loading,setLoading]=useState(false),draftGeneration=useRef(0),searchGeneration=useRef(0),readerIntent=useRef(0);
          useEffect(()=>()=>{draftGeneration.current++;searchGeneration.current++;},[botId]);
          const rows=(view.snapshot.materials??[]).filter(row=>row.botId===botId);
          return h("div",{className:"grid"},card("资料检索",
            form("搜索资料",async data=>{const generation=++searchGeneration.current,paneGeneration=readIntent.current,isActive=()=>generation===searchGeneration.current&&paneGeneration===readIntent.current;const result=await query("material.search",{botId,query:data.get("query"),limit:20},isActive);if(result&&isActive())setHits(result);},field("关键词","query",{maxLength:500})),
            ...(hits??rows).map(row=>h("article",{className:"card",key:row.chunkId??row.docId},
              h("h3",null,row.title),row.excerpt&&h("pre",null,row.excerpt),
              h("small",null,row.chunkId?`行 ${row.startLine??row.lineStart}–${row.endLine??row.lineEnd} · ${row.contentHash}`:`${row.archived?"已归档 · ":""}更新 ${updatedName(row.updatedAt??row.createdAt)}`),
              button(row.chunkId?"打开此引用":"打开正文",()=>{if(opened?.docId!==row.docId||opened?.chunkId!==row.chunkId)readerIntent.current++;setOpened({docId:row.docId,chunkId:row.chunkId});}),
              !row.chunkId&&button("修订这份资料",async()=>{const generation=++draftGeneration.current,paneGeneration=readIntent.current,isActive=()=>generation===draftGeneration.current&&paneGeneration===readIntent.current;setLoading(true);try{const result=await query("material.download",{docId:row.docId},isActive);if(result&&isActive()){setDraft({text:result.text,fileName:row.fileName??"",mediaType:row.mediaType??"text/plain",title:row.title,replacesDocId:row.docId});setEpoch(n=>n+1);}}finally{if(isActive())setLoading(false);}},{disabled:view.busy||loading}),
              !row.chunkId&&!row.archived&&button("归档资料",()=>command("material.archive",{docId:row.docId,expectedVersion:row.version})),
            )),hits&&button("显示全部资料",()=>{searchGeneration.current++;setHits(null);})),
            card("收录资料",
              field("UTF-8 文本或 Markdown 文件","materialFile",{type:"file",required:false,accept:".txt,.md,text/plain,text/markdown",onChange:async event=>{const generation=++draftGeneration.current,paneGeneration=readIntent.current,isActive=()=>generation===draftGeneration.current&&paneGeneration===readIntent.current,file=event.target.files?.[0];if(!file){setLoading(false);return;}setLoading(true);try{if(!/\.(txt|md)$/i.test(file.name))throw Error("请选择 .txt 或 .md 文件。");const text=await readUtf8(file,65536);if(!isActive())return;setDraft({text,fileName:file.name,mediaType:/\.md$/i.test(file.name)?"text/markdown":"text/plain"});setEpoch(n=>n+1);}catch(error){if(isActive())publish({error:error.message});}finally{if(isActive())setLoading(false);}}}),
              loading&&h("p",{role:"status"},"正在读取资料，完成后可编辑标题和正文并保存。"),
              h("fieldset",{disabled:loading,style:{border:0,padding:0,margin:0,minWidth:0}},h("div",{key:epoch},form("保存不可变资料",async data=>{
                if(loading)return;
                const generation=draftGeneration.current,enteredText=String(data.get("text")??""),displayText=text=>text.replace(/\r\n?/g,"\n");
                // Textareas normalize line endings; an untouched upload retains its original bytes.
                const text=displayText(enteredText)===displayText(draft.text)?draft.text:enteredText;
                const result=await command("material.ingest",{botId,title:data.get("title"),text,mediaType:draft.mediaType,...(draft.replacesDocId?{replacesDocId:draft.replacesDocId}:{}),...(draft.fileName?{fileName:draft.fileName}:{})});if(result&&generation===draftGeneration.current){draftGeneration.current++;setDraft({text:"",fileName:"",mediaType:"text/plain"});setEpoch(n=>n+1);}},field("资料标题","title",{value:draft.title??draft.fileName,maxLength:200}),field("正文","text",{value:draft.text,textarea:true}),h("small",null,draft.replacesDocId?"正在修订所选资料：保存形成新资料，旧正文、来源和引用保留。":"每份最多 64 KiB。修订形成新资料，引用保留原文。"),draft.replacesDocId&&button("改为收录新资料",()=>{draftGeneration.current++;setDraft({...draft,replacesDocId:undefined});})))),
              advanced("从原生会话摘录",form("收录真实会话片段",data=>command("material.ingest",{botId,title:data.get("title"),source:{sessionId:data.get("sessionId"),eventSeq:Number(data.get("eventSeq")),partIndex:Number(data.get("partIndex")),startOffset:Number(data.get("startOffset")),endOffset:Number(data.get("endOffset"))}}),field("标题","title"),field("来源会话","sessionId",{options:view.snapshot.sessions.map(row=>({value:row.sessionId,label:`${view.snapshot.bots.find(bot=>bot.botId===row.botId)?.name??"会话"} · ${row.sessionId}`}))}),field("事件序号","eventSeq",{type:"number",min:0}),field("文本部分序号","partIndex",{type:"number",min:0,value:0}),field("文本开始位置","startOffset",{type:"number",min:0,value:0}),field("文本结束位置","endOffset",{type:"number",min:1}),h("small",null,"范围由真实原生日志核对；不会用粘贴文字替代该来源。")))
            ),opened&&h(MaterialReader,{...opened,readIntent,selectionIntent:readerIntent,onClose:()=>setOpened(null),key:`${opened.docId}:${opened.chunkId??""}`}));
        }
        function ContextPreview({botId,readIntent}) {
          const view=useView(),[preview,setPreview]=useState(null),previewGeneration=useRef(0);
          useEffect(()=>()=>{previewGeneration.current++;},[botId]);
          return advanced("上下文预览",h("p",null,"查看当前预算下可带入此 Bot 下一轮的记忆摘要与未完成任务。实际对话仍按当时的权限与查询选择。"),
            form("查看上下文预览",async data=>{const generation=++previewGeneration.current,paneGeneration=readIntent.current,isActive=()=>generation===previewGeneration.current&&paneGeneration===readIntent.current;const value=await query("memory.context.preview",{botId,...(data.get("query")?{query:data.get("query")}:{})},isActive);if(value&&isActive()){
              const items = prefix => {try{const line=value.context?.split("\n").find(row=>row.startsWith(prefix));return line?JSON.parse(line.slice(prefix.length)):[];}catch{return [];}};
              setPreview({...value,memoryPreviews:value.memoryPreviews??items("长期记忆（记录带来源，引用不授予控制权）："),taskPreviews:value.taskPreviews??items("未完成任务：")});
            }},field("当前话题关键词","query",{required:false,maxLength:500})),
            preview&&h("div",null,h("h3",null,"可带入的记忆"),...(preview.memoryPreviews??[]).map(row=>h("p",{key:row.memoryId},row.text)),h("h3",null,"未完成任务"),...(preview.taskPreviews??[]).map(row=>h("p",{key:row.taskId},`${row.title} · ${stateName(row.state)}`)),
              advanced("未带入原因",...(preview.omitted??[]).map(row=>h("p",{key:row.memoryId},`${view.snapshot.memories.find(memory=>memory.memoryId===row.memoryId)?.text.slice(0,40)??"记忆"} · ${{forgotten:"已遗忘",inactive:"来源待验证",inaccessible:"来源暂不可读",budget:"本轮预算不足",relevance_or_recency:"按相关性与最近更新选择其他记忆"}[row.reason]??"本轮未选择"}`)))));
        }
        function MemoryPane() {
          const view=useView(),[id,setId]=useState(view.focusBotId??""),[section,setSection]=useState("memory"),[editing,setEditing]=useState(null),[hits,setHits]=useState(null),[sourceRef,setSourceRef]=useState(null),[creationEpoch,setCreationEpoch]=useState(0),searchGeneration=useRef(0),readIntent=useRef(0),sourceIntent=useRef(0);
          useEffect(()=>{const target=view.focusBotId;if(!target||!view.snapshot.bots.some(bot=>bot.botId===target&&!bot.deletedAt))return;searchGeneration.current++;readIntent.current++;sourceIntent.current++;setId(target);setSection("memory");setEditing(null);setHits(null);setSourceRef(null);document.getElementById?.("dsh-memory-owner")?.focus?.();publish({focusBotId:null});},[view.focusBotId]);
          const botId=id||view.snapshot.bots.find(bot=>!bot.deletedAt)?.botId, rows=(hits?hits.map(hit=>view.snapshot.memories.find(row=>row.memoryId===hit.memoryId)).filter(Boolean):view.snapshot.memories).filter(row=>row.botId===botId&&!row.forgotten),selected=view.snapshot.memories.find(row=>row.memoryId===editing&&row.botId===botId&&!row.forgotten);
          useEffect(()=>()=>{searchGeneration.current++;},[botId,section]);
          return h("div",null,
            h("label",null,"所属 Bot",h("select",{id:"dsh-memory-owner","aria-label":"所属 Bot",value:botId??"",onChange:event=>{searchGeneration.current++;readIntent.current++;setId(event.target.value);setEditing(null);setHits(null);setSourceRef(null);}},botsOptions().map(row=>option(row.value,row.label)))),
            h("nav",{"aria-label":"记忆与资料"},button("长期记忆",()=>{if(section!=="memory"){searchGeneration.current++;readIntent.current++;sourceIntent.current++;setSourceRef(null);}setSection("memory");},{"aria-selected":section==="memory"}),button("资料",()=>{if(section!=="materials"){searchGeneration.current++;readIntent.current++;sourceIntent.current++;setSourceRef(null);}setSection("materials");},{"aria-selected":section==="materials"})),
            !botId?h("p",null,"请先创建 Bot。") : section==="materials"?h(MaterialsPane,{botId,readIntent,key:botId}):h("div",{className:"grid"},card("长期记忆",
              form("搜索记忆",async data=>{const generation=++searchGeneration.current,isActive=()=>generation===searchGeneration.current;const result=await query("memory.search",{botId,query:data.get("query"),...(data.get("category")?{category:data.get("category")}:{})},isActive);if(result&&isActive())setHits(result);},field("内容关键词","query",{required:false,maxLength:500}),field("分类筛选","category",{required:false,options:[{value:"",label:"全部分类"},...categories,...[...new Set(rows.map(row=>row.category))].filter(value=>!categories.some(row=>row.value===value)).map(value=>({value,label:categoryName(value)}))]})),
              ...[...rows].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(b.updatedAt).localeCompare(String(a.updatedAt))).map(row=>h("article",{className:"card",key:row.memoryId},h("p",null,row.text),h("small",null,`${categoryName(row.category)} · ${row.pinned?"已固定 · ":""}更新 ${updatedName(row.updatedAt)}${row.inactive?" · 来源待验证，不可用":""}`),h("div",{className:"actions"},button("编辑记忆",()=>setEditing(row.memoryId)),button(row.pinned?"取消固定":"固定",()=>command("memory.pin",{memoryId:row.memoryId,expectedVersion:row.version,pinned:!row.pinned})),row.source?.kind==="material"?button("查看资料来源",()=>{if(sourceRef?.docId!==row.source.docId||sourceRef?.chunkId!==row.source.chunkId)sourceIntent.current++;setSourceRef({docId:row.source.docId,chunkId:row.source.chunkId});}):row.source?.sessionId&&button("查看来源",()=>openSession(row.source.sessionId)),button("遗忘此记忆",()=>command("memory.forget",{memoryId:row.memoryId,expectedVersion:row.version}))))),
              hits&&button("显示全部记忆",()=>{searchGeneration.current++;setHits(null);}),button("添加另一条记忆",()=>{setEditing(null);setCreationEpoch(epoch=>epoch+1);}),h(MemoryTransfer,{botId,readIntent,key:botId}),h(ContextPreview,{botId,readIntent,key:`context:${botId}`})),
              h(MemoryEditor,{memory:selected,botId,onSaved:saved=>setEditing(saved.memoryId),key:selected?.memoryId??`new:${botId}:${creationEpoch}`})),sourceRef&&h(MaterialReader,{...sourceRef,readIntent,selectionIntent:sourceIntent,onClose:()=>setSourceRef(null),key:`source:${sourceRef.docId}:${sourceRef.chunkId}`}));
        }
        function TaskRelations({task:latestTask}) {
          const view=useView(),[task,setBase]=useState(latestTask),[epoch,setEpoch]=useState(0);
          return advanced("前置任务与责任交接",
            latestTask.version!==task.version&&h("div",null,h("p",{role:"status"},"任务已更新。当前关系草稿保留，提交将检查原版本。"),button("重新载入任务关系",()=>{setBase(latestTask);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form("保存前置任务",async data=>{const saved=await command("task.dependencies.set",{taskId:task.taskId,expectedVersion:task.version,dependsOn:data.getAll("dependsOn")});if(saved){setBase(saved);setEpoch(n=>n+1);}},field("前置任务（可多选，全部有效验收后可开始）","dependsOn",{options:view.snapshot.tasks.filter(row=>row.taskId!==task.taskId).map(row=>({value:row.taskId,label:`${row.title} · ${stateName(row.acceptance)}`})),value:task.dependsOn??[],multiple:true,required:false}))),
            form("确认交给所选 Bot",data=>command("task.handoff",{taskId:task.taskId,expectedVersion:task.version,toBotId:data.get("toBotId"),note:data.get("note")}),field("接手 Bot","toBotId",{options:botsOptions().filter(row=>row.value!==task.botId)}),field("交接说明","note",{textarea:true,maxLength:2000}),h("small",null,"交接需等待工作结算。旧运行记录保留原负责人，下一次开始由新负责人执行。")));
        }
        function TaskAdjustment({task:latestTask}) {
          const [task,setBase]=useState(latestTask),[formEpoch,setFormEpoch]=useState(0);
          return advanced("调整与接续",
            latestTask.version !== task.version && h("div",null,
              h("p",{role:"status"},"任务已更新。当前目标草稿已保留；保存将检查原版本。"),
              button("重新载入最新任务",()=>{setBase(latestTask);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("调整目标",async data=>{
              const saved=await command("task.adjust",{taskId:task.taskId,expectedVersion:task.version,goal:data.get("goal")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("新目标","goal",{value:task.goal,textarea:true}))),
          );
        }
        function TaskAcceptance({task:latestTask,attempt}) {
          const [task,setBase]=useState(latestTask),[formEpoch,setFormEpoch]=useState(0);
          return advanced("验收结果",
            latestTask.version !== task.version && h("div",null,
              h("p",{role:"status"},"任务或验收已更新。当前证据草稿已保留；保存将检查原版本。"),
              button("重新载入最新验收",()=>{setBase(latestTask);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("记录验收",async data=>{
              const saved=await command("task.accept",{taskId:task.taskId,expectedVersion:task.version,attemptId:attempt.attemptId,outcome:data.get("outcome"),evidence:data.get("evidence")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("结论","outcome",{value:task.acceptance,options:[{value:"unknown",label:"待定"},{value:"passed",label:"通过"},{value:"failed",label:"不通过"}]}),field("实际证据","evidence",{textarea:true}))),
          );
        }
        function openTask(taskId) {
          publish({briefing:null,requestedTab:"tasks",focusTaskId:taskId});
          ctx.layout.selectPanel("dsh-bot");
        }
        function NoticeList({notices=[]}) {
          return h("div",null,...notices.map(row=>h("article",{className:"card",key:row.noticeId},
            h("h3",null,row.title??(row.kind==="reminder"?"提醒":"任务结果")),h("p",null,row.text??row.message??row.preview??""),...(row.previews??[]).map((preview,index)=>h("pre",{key:index},preview.text)),
            h("small",null,`${row.dueAt?`原定 ${updatedName(row.dueAt)} · `:""}${row.late?"迟到 · ":""}${row.acknowledgedAt||row.ackedAt||row.read?"已读":"未读"}`),
            row.taskId&&button("查看任务",()=>openTask(row.taskId)),
            row.sessionId&&button("查看会话",()=>openSession(row.sessionId)),
            !row.acknowledgedAt&&!row.ackedAt&&!row.read&&button("确认已读",()=>command("notice.ack",{noticeId:row.noticeId,expectedVersion:row.version})))));
        }
        function BriefingDialog() {
          const view=useView(),request=view.briefing,[data,setData]=useState(null),modal=useRef(null);
          useEffect(()=>{let active=true;const isActive=()=>active&&state.briefing===request&&state.snapshot.revision===view.snapshot.revision;setData(null);if(request)query("briefing",{botId:request.botId},isActive).then(value=>{if(isActive())setData(value);});return()=>{active=false;};},[request,view.snapshot.revision]);
          useEffect(()=>{const element=modal.current;if(!request||!element)return;element.showModal();return()=>{if(element.open)element.close();if(request.returnFocus?.isConnected)request.returnFocus.focus();};},[request]);
          if(!request)return null;
          return h("dialog",{ref:modal,className:"dsh-bot-briefing-modal","aria-label":"任务简报",onCancel:event=>{event.preventDefault();if(!view.busy)publish({briefing:null});}},h("section",{className:"dsh-bot"},h("style",null,styles+".dsh-bot-briefing-modal{border:0;padding:0;background:transparent;color:inherit;width:min(680px,calc(100vw - 32px));max-height:90vh;overflow:auto;border-radius:16px}.dsh-bot-briefing-modal::backdrop{background:rgba(0,0,0,.35)}.dsh-bot-briefing-modal .dsh-bot{height:auto;background:var(--dsw-alias-bg-layer-1,Canvas)}"),
            h("header",null,h("h2",null,"任务简报"),button("关闭简报",()=>publish({briefing:null}))),
            !data?h("p",null,"读取简报…"):h("div",null,h("p",null,`${data.unreadCount??0} 条未读通知`),
              ...(data.tasks??[]).map(row=>h("article",{className:"card",key:row.taskId},h("h3",null,row.title),h("p",null,`${stateName(row.attemptState??row.state)} · 验收 ${stateName(row.acceptance)}`),...(row.previews??[]).map((preview,index)=>h("pre",{key:index},preview.text)),
                row.attemptId&&button("查看执行",()=>{const attempt=view.snapshot.attempts.find(item=>item.attemptId===row.attemptId);if(attempt?.sessionId)openSession(attempt.sessionId);}),
                button("打开工作台任务",()=>openTask(row.taskId)))),h(NoticeList,{notices:data.notices??[]})),
            view.error&&h("p",{className:"error",role:"alert"},view.error)));
        }
        function ScheduleEditor({schedule:latestSchedule,onSaved}) {
          const view=useView(),[base,setBase]=useState(latestSchedule),[epoch,setEpoch]=useState(0),[kind,setKind]=useState(latestSchedule?.kind??"reminder"),[ruleKind,setRuleKind]=useState(latestSchedule?.rule?.kind??"once"),[owner,setOwner]=useState(latestSchedule?.ownerBotId??view.snapshot.bots[0]?.botId);
          const timezone=base?.rule?.timezone??"Asia/Shanghai";
          const submit=async data=>{
            const selectedKind=data.get("ruleKind"),rule={kind:selectedKind,timezone:data.get("timezone")};
            if(selectedKind==="interval"){if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.get("anchorAt")))throw Error("首次时间需要包含时区偏移或 Z。");rule.anchorAt=new Date(data.get("anchorAt")).toISOString();rule.everyMinutes=Number(data.get("everyMinutes"));}
            else {rule.time=data.get("time");if(selectedKind==="once")rule.date=data.get("date");else if(data.get("startDate"))rule.startDate=data.get("startDate");if(selectedKind==="weekly")rule.weekdays=data.getAll("weekdays").map(Number);}
            const ownerBotId=base?.ownerBotId??data.get("ownerBotId"),input={ownerBotId,kind:data.get("kind"),rule,enabled:data.get("enabled")==="on",missedPolicy:data.get("missedPolicy")};
            if(input.kind==="reminder")input.message=data.get("message");
            else input.recipe={botId:ownerBotId,title:data.get("title"),goal:data.get("goal"),criteria:String(data.get("criteria")??"").split("\n").filter(Boolean),dependsOn:data.getAll("dependsOn"),...(data.get("originSessionId")?{originSessionId:data.get("originSessionId")}:{})};
            const saved=await command(base?"schedule.update":"schedule.create",{...input,...(base?{scheduleId:base.scheduleId,expectedVersion:base.version}:{})});
            if(saved){setBase(saved);onSaved?.(saved);}
          };
          return h("div",null,
            latestSchedule&&latestSchedule.version!==base.version&&h("div",null,h("p",{role:"status"},"定时安排已更新。草稿保留，保存将检查原版本。"),button("重新载入最新安排",()=>{setBase(latestSchedule);setKind(latestSchedule.kind);setRuleKind(latestSchedule.rule.kind);setOwner(latestSchedule.ownerBotId);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form(base?"重新确认并保存安排":"确认创建安排",data=>{submit(data).catch(error=>publish({error:error.message}));},
              field("负责 Bot","ownerBotId",{value:owner,options:botsOptions(),disabled:!!base,onChange:event=>setOwner(event.target.value)}),
              kind==="task"&&h("p",{className:"muted"},`执行模型：${view.snapshot.bots.find(bot=>bot.botId===owner)?.execution?.model??"当前不可用"}`),
              field("安排类型","kind",{value:kind,options:[{value:"reminder",label:"提醒（不启动任务）"},{value:"task",label:"定时任务"}],onChange:event=>setKind(event.target.value)}),
              kind==="reminder"?field("提醒内容","message",{value:base?.message,textarea:true,maxLength:4000}):h("div",null,field("任务标题","title",{value:base?.recipe?.title,maxLength:200}),field("目标","goal",{value:base?.recipe?.goal,textarea:true,maxLength:16000}),field("验收条件（每行一项）","criteria",{value:base?.recipe?.criteria?.join("\n"),textarea:true,required:false}),advanced("前置任务与结果接收",field("前置任务（可多选）","dependsOn",{value:base?.recipe?.dependsOn??[],multiple:true,required:false,options:view.snapshot.tasks.map(row=>({value:row.taskId,label:row.title}))}),field("结果接收会话","originSessionId",{value:base?.recipe?.originSessionId??"",required:true,options:[{value:"",label:"请选择接收会话"},...view.snapshot.sessions.filter(row=>row.purpose==="contact"&&row.state==="ready"&&!row.archived).map(row=>({value:row.sessionId,label:`${view.snapshot.bots.find(bot=>bot.botId===row.botId)?.name??"Bot"} · ${row.name??row.sessionId.slice(0,8)}`}))]}))),
              field("频率","ruleKind",{value:ruleKind,options:[{value:"once",label:"单次"},{value:"interval",label:"固定间隔"},{value:"daily",label:"每天"},{value:"weekly",label:"每周"}],onChange:event=>setRuleKind(event.target.value)}),field("时区","timezone",{value:timezone,maxLength:100}),
              ruleKind==="interval"?h("div",null,field("首次时间（带时区，例如 2026-10-10T09:00:00+08:00）","anchorAt",{value:base?.rule?.anchorAt}),field("间隔分钟（至少 15）","everyMinutes",{type:"number",value:base?.rule?.everyMinutes??60,min:15,step:1})):h("div",null,ruleKind==="once"?field("当地日期","date",{type:"date",value:base?.rule?.date}):field("开始日期","startDate",{type:"date",value:base?.rule?.startDate,required:false}),field("当地时间","time",{type:"time",value:base?.rule?.time??"09:00"}),ruleKind==="weekly"&&field("每周哪几天（可多选）","weekdays",{value:(base?.rule?.weekdays??[1]).map(String),multiple:true,options:["日","一","二","三","四","五","六"].map((day,index)=>({value:String(index),label:`星期${day}`}))})),
              kind==="task"&&field("错过时如何处理","missedPolicy",{value:base?.missedPolicy??"skip",options:[{value:"skip",label:"跳过并提醒"},{value:"latest",label:"恢复后只补最近一次"}]}),kind==="reminder"&&h("input",{type:"hidden",name:"missedPolicy",value:"skip"}),
              check("enabled","启用安排",base?.enabled??true),h("small",null,kind==="task"?"确认后按以上负责人、目标、频率和结果位置开始独立任务，使用该 Bot 的执行模型。关闭 DSH 时不运行，原生工具审批继续生效。":"到期保存插件内通知。关闭 DSH 时不运行，恢复后显示原定时间和迟到标记。"))));
        }
        function ScheduleHistory({scheduleId}) {
          const view=useView(),[rows,setRows]=useState([]),[selected,setSelected]=useState([]),[confirm,setConfirm]=useState(false),[pruneDraft,setPruneDraft]=useState(null),readGeneration=useRef(0),mounted=useRef(true);
          const load=async()=>{if(!mounted.current)return;const generation=++readGeneration.current,isActive=()=>mounted.current&&generation===readGeneration.current;const value=await query("occurrence.list",{scheduleId,limit:100},isActive);if(value&&isActive())setRows(Array.isArray(value)?value:value.items??[]);};
          useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;readGeneration.current++;};},[scheduleId,view.snapshot.revision]);
          return advanced("触发历史",...rows.map(row=>h("article",{key:row.occurrenceId},h("p",null,`${updatedName(row.dueAt)} · ${stateName(row.state)}`),row.taskId&&h("small",null,`任务 ${row.taskId}`),["settled","missed"].includes(row.state)&&h("label",{className:"check"},h("input",{type:"checkbox",checked:selected.includes(row.occurrenceId),onChange:event=>{setConfirm(false);setPruneDraft(null);setSelected(ids=>event.target.checked?[...ids,row.occurrenceId]:ids.filter(id=>id!==row.occurrenceId));}}),"选择清理此已结算触发记录"))),
            selected.length>0&&h("div",null,button("清理所选历史",()=>{setPruneDraft({occurrenceIds:[...selected],expectedVersions:Object.fromEntries(rows.filter(row=>selected.includes(row.occurrenceId)).map(row=>[row.occurrenceId,row.version]))});setConfirm(true);}),confirm&&h("div",null,h("p",null,`确认清理 ${pruneDraft?.occurrenceIds.length??0} 条已结算触发记录？原任务和操作回执保留。`),button("确认清理所选记录",async()=>{const result=await command("occurrence.prune",{...pruneDraft,confirm:true});if(result){setSelected([]);setConfirm(false);setPruneDraft(null);await load();}}),button("取消清理",()=>{setConfirm(false);setPruneDraft(null);}))));
        }
        function SchedulesPane() {
          const view=useView(),[rows,setRows]=useState([]),[editing,setEditing]=useState(null),[notices,setNotices]=useState([]),[creationEpoch,setCreationEpoch]=useState(0);
          useEffect(()=>{let active=true;Promise.all([query("schedule.list",{},()=>active),query("notice.list",{},()=>active)]).then(([s,n])=>{if(active){if(s)setRows(Array.isArray(s)?s:s.items??[]);if(n)setNotices(Array.isArray(n)?n:n.notices??[]);}});return()=>{active=false;};},[view.snapshot.revision]);
          const selected=rows.find(row=>row.scheduleId===editing);
          return advanced("提醒与定时",h(NoticeList,{notices}),...rows.map(row=>h("article",{className:"card",key:row.scheduleId},h("h3",null,row.kind==="task"?row.recipe?.title:row.message),h("p",null,`${view.snapshot.bots.find(bot=>bot.botId===row.ownerBotId)?.name??"Bot"} · ${row.archived?"已归档":row.enabled?"已启用":"已暂停"} · ${row.rule.timezone} · 下次 ${updatedName(row.nextDueAt)}`),button("编辑并重新确认",()=>setEditing(row.scheduleId)),!row.archived&&button(row.enabled?"暂停安排":"启用安排",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:!row.enabled})),!row.archived&&button("归档安排",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:false,archived:true})),row.archived&&button("恢复安排（保持暂停）",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:false,archived:false})),h(ScheduleHistory,{scheduleId:row.scheduleId}))),
            editing&&button("创建新的安排",()=>{setEditing(null);setCreationEpoch(epoch=>epoch+1);}),h(ScheduleEditor,{schedule:selected,onSaved:saved=>{setRows(previous=>[...previous.filter(row=>row.scheduleId!==saved.scheduleId),saved]);setEditing(saved.scheduleId);},key:selected?`edit-schedule:${selected.scheduleId}`:`new-schedule:${creationEpoch}`}));
        }
        function TasksPane() {
          const view = useView();
          useEffect(()=>{if(view.focusTaskId){const target=document.getElementById?.(`dsh-resource-${view.focusTaskId}`);target?.scrollIntoView?.({block:"center"});target?.focus?.({preventScroll:true});}},[view.focusTaskId]);
          const [recipients, setRecipients] = useState([]),
            reloadRecipients = useRef(null);
          useEffect(() => {
            let active = true, running, requested = false;
            const load = () => {
              requested = true;
              if (running) return;
              running = (async () => {
                while (active && requested) {
                  requested = false;
                  try {
                    const rows = [];
                    let cursor;
                    do {
                      const page = await rpc("command", {
                        action: "session.list",
                        input: { limit: 500, ...(cursor ? { cursor } : {}) },
                      });
                      rows.push(...page.items);
                      cursor = page.nextCursor;
                    } while (active && cursor);
                    if (active) setRecipients(rows);
                  } catch (error) {
                    if (active) publish({ error: error.message });
                  }
                }
              })().finally(() => {
                running = undefined;
                if (active && requested) load();
              });
            };
            reloadRecipients.current = load;
            load();
            return () => {
              active = false;
              reloadRecipients.current = null;
            };
          }, []);
          useEffect(() => { reloadRecipients.current?.(); }, [view.snapshot]);
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.tasks.map((task) => {
                const attempt = view.snapshot.attempts.find(
                    (row) => row.attemptId === task.currentAttemptId,
                  ),
                  owner = view.snapshot.bots.find(
                    (row) => row.botId === task.botId,
                  );
                return resourceCard(
                  task.taskId,
                  task.title,
                  h(
                    "p",
                    null,
                    `${owner?.name ?? "Bot"} · ${stateName(task.state)} · 验收 ${stateName(task.acceptance)}`,
                  ),
                  h("p", null, task.goal),
                  (task.dependsOn??[]).length>0&&h("p",{className:"muted"},`前置任务：${task.dependsOn.map(id=>view.snapshot.tasks.find(row=>row.taskId===id)?.title??"不可读任务").join("、")}`),
                  (task.blockedReasons??[]).length>0&&h("p",{role:"status"},`暂不能开始：${task.blockedReasons.map(row=>typeof row==="string"?row:row.reason??row.code).join("；")}`),
                  task.dependencyStatus?.blocked&&h("p",{role:"status"},`暂不能开始：${task.dependencyStatus.reason}`),
                  h("small", null, `验收条件：${task.criteria.join("；")}`),
                  h(
                    "div",
                    { className: "actions" },
                    attempt &&
                      button("查看执行", () => openSession(attempt.sessionId)),
                    button(
                      "开始／接续",
                      () =>
                        command("task.start", {
                          taskId: task.taskId,
                          expectedVersion: task.version,
                        }),
                      {
                        disabled:
                          view.busy ||
                          !!attempt?.reservationHeld ||
                          task.archived,
                      },
                    ),
                    attempt?.reservationHeld &&
                      button("停止本次尝试", () =>
                        command("task.stop", {
                          taskId: task.taskId,
                          attemptId: attempt.attemptId,
                          epoch: attempt.epoch,
                        }),
                      ),
                    button(
                      task.archived ? "恢复" : "归档",
                      () =>
                        command(
                          task.archived ? "task.restore" : "task.archive",
                          {
                            taskId: task.taskId,
                            expectedVersion: task.version,
                          },
                        ),
                      { disabled: view.busy || !!attempt?.reservationHeld },
                    ),
                  ),
                  !task.archived &&
                    !attempt?.reservationHeld &&
                    view.snapshot.attempts.some(
                      (row) =>
                        row.botId === task.botId &&
                        row.depth === 0 &&
                        row.reservationHeld &&
                        row.taskId !== task.taskId,
                    ) &&
                    advanced("子工作", form(
                      "作为一级子工作开始",
                      (data) =>
                        command("task.start", {
                          taskId: task.taskId,
                          expectedVersion: task.version,
                          parentAttemptId: data.get("parentAttemptId"),
                        }),
                      field("所属父工作", "parentAttemptId", {
                        options: view.snapshot.attempts
                          .filter(
                            (row) =>
                              row.botId === task.botId &&
                              row.depth === 0 &&
                              row.reservationHeld &&
                              row.taskId !== task.taskId,
                          )
                          .map((row) => ({
                            value: row.attemptId,
                            label: `${view.snapshot.tasks.find((task) => task.taskId === row.taskId)?.title ?? "父工作"} · ${row.attemptId.slice(0, 12)}`,
                          })),
                      }),
                    )),
                  attempt?.result &&
                    h(
                      "pre",
                      null,
                      attempt.result.content
                        .map((block) => block.text ?? "")
                        .join("\n"),
                    ),
                  attempt && advanced("运行详情", h(
                    "small", null,
                    `本地资源：${attempt.reservationHeld ? "尚未结算" : "已结算"}；外部副作用：${attempt.externalEffects}；用量：${attempt.usage === "UNKNOWN" ? "未知" : JSON.stringify(attempt.usage)}`,
                  )),
                  h(TaskRelations,{task,key:`relations:${task.taskId}`}),
                  h(TaskAdjustment,{task,key:task.taskId}),
                  attempt &&
                    !attempt.reservationHeld &&
                    h(TaskAcceptance,{task,attempt,key:attempt.attemptId}),
                );
              }),
            ),
            card(
              "新任务",
              h(SchedulesPane),
              form(
                "登记任务",
                (data) =>
                  command("task.create", {
                    botId: data.get("botId"),
                    title: data.get("title"),
                    goal: data.get("goal"),
                    dependsOn: data.getAll("dependsOn"),
                    criteria: String(data.get("criteria"))
                      .split("\n")
                      .filter(Boolean),
                    ...(data.get("origin")
                      ? { originSessionId: data.get("origin") }
                      : {}),
                  }),
                field("负责人", "botId", { options: botsOptions() }),
                field("标题", "title", { maxLength: 200 }),
                field("目标", "goal", { textarea: true, maxLength: 16000 }),
                advanced("验收与结果接收",
                field("前置任务（可多选）","dependsOn",{options:view.snapshot.tasks.map(row=>({value:row.taskId,label:row.title})),multiple:true,required:false}),
                field("验收条件（每行一项）", "criteria", {
                  textarea: true,
                  required: false,
                }),
                field("结果接收会话", "origin", {
                  options: [
                    { value: "", label: "保存在工作台" },
                    ...view.snapshot.sessions
                      .filter(
                        (row) =>
                          row.purpose === "contact" &&
                          !row.archived &&
                          row.state === "ready",
                      )
                      .map((row) => ({
                        value: row.sessionId,
                        label: `${view.snapshot.bots.find((bot) => bot.botId === row.botId)?.name} · ${row.sessionId.slice(0, 8)}`,
                      })),
                    ...recipients
                      .filter((row) => row.type === "ordinary" && !row.archived)
                      .map((row) => ({
                        value: row.sessionId,
                        label: `普通会话 · ${row.header?.title ?? "未命名"} · ${row.sessionId.slice(0, 8)}`,
                      })),
                  ],
                  required: false,
                }),
                ),
              ),
            ),
          );
        }
        function SharingEditor({bot:latestBot}) {
          const view=useView(),[bot,setBase]=useState(latestBot),[receivers,setReceivers]=useState(null),[formEpoch,setFormEpoch]=useState(0);
          const selected=receivers??view.snapshot.bots.filter(row=>row.botId!==bot.botId && (bot.share.receivers.includes("*")||bot.share.receivers.includes(row.botId))).map(row=>row.botId);
          return resourceCard(bot.botId,`${botLabel(bot)} 的共享范围`,
            latestBot.revision !== bot.revision && h("div",null,
              h("p",{role:"status"},"共享范围或 Bot 配置已更新。当前权限草稿已保留；保存将检查原版本。"),
              button("重新载入最新共享范围",()=>{setBase(latestBot);setReceivers(null);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("保存共享上限",async data=>{
              const saved=await command("share.set",{botId:bot.botId,expectedVersion:bot.revision,share:{
                enabled:data.get("enabled")==="on",receivers:receivers??bot.share.receivers,
                scope:Object.fromEntries(["sessions","tasks","memories","materials"].map(key=>[key,data.get(key)==="on"?["*"]:[]])),
              }});
              if(saved){setBase({...bot,share:saved,revision:bot.revision+1});setReceivers(null);setFormEpoch(epoch=>epoch+1);}return saved;
            },check("enabled","允许其他 Bot 只读了解",bot.share.enabled),
            ...view.snapshot.bots.filter(row=>row.botId!==bot.botId).map(row=>h("label",{className:"check",key:row.botId},
              h("input",{type:"checkbox",name:"receiver",value:row.botId,checked:selected.includes(row.botId),onChange:event=>{
                const checked=event.target.checked;setReceivers(draft=>{const ids=draft??selected;return checked?[...new Set([...ids,row.botId])]:ids.filter(id=>id!==row.botId);});
              }}),botLabel(row))),
            check("sessions","共享会话",bot.share.scope.sessions?.includes("*")),
            check("tasks","共享任务",bot.share.scope.tasks?.includes("*")),
            check("memories","共享记忆",bot.share.scope.memories?.includes("*")),
            check("materials","共享资料",bot.share.scope.materials?.includes("*")),
            )),
          );
        }
        function SharingPane() {
          const view = useView();
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.bots.map(bot=>h(SharingEditor,{bot,key:bot.botId})),
            ),
            h(
              "div",
              null,
              card(
                "持续授权",
                form(
                  "授予权限",
                  (data) =>
                    command("grant.set", {
                      grantId: crypto.randomUUID(),
                      ownerBotId: data.get("owner") || null,
                      recipientBotId: data.get("recipient"),
                      level: data.get("level"),
                      active: true,
                      scope: Object.fromEntries(
                        ["sessions", "tasks"].map((key) => [
                          key,
                          data.get(key) === "on"
                            ? data.get(`${key}Ids`)?.trim()
                              ? String(data.get(`${key}Ids`))
                                  .split(",")
                                  .map((x) => x.trim())
                              : ["*"]
                            : [],
                        ]),
                      ),
                    }),
                  field("资源归属", "owner", {
                    options: [
                      ...botsOptions(),
                      { value: "", label: "普通 DSH 会话（需指定具体会话）" },
                    ],
                    required: false,
                  }),
                  field("接收 Bot", "recipient", { options: botsOptions() }),
                  field("权限", "level", {
                    options: [
                      { value: "read", label: "只读" },
                      { value: "control", label: "控制会话和任务" },
                    ],
                  }),
                  check("sessions", "允许会话"),
                  check("tasks", "允许任务"),
                  advanced("指定会话和任务（可选）",
                  field(
                    "会话 ID（逗号分隔；Bot 资源留空表示全部）",
                    "sessionsIds",
                    { required: false },
                  ),
                  field("任务 ID", "tasksIds", { required: false }),
                  ),
                  h(
                    "small",
                    null,
                    "控制授权受资源所有者的共享上限约束；配置、授权和他 Bot 记忆仍由人类管理。",
                  ),
                ),
              ),
              ...view.snapshot.grants.map((grant) =>
                resourceCard(
                  grant.grantId,
                  "已保存的授权",
                  h(
                    "p",
                    null,
                    `${view.snapshot.bots.find((bot) => bot.botId === grant.recipientBotId)?.name} · ${grant.level === "control" ? "控制" : "只读"} · ${grant.active ? "有效" : "已撤销"}`,
                  ),
                  h("small", null, JSON.stringify(grant.scope)),
                  button(grant.active ? "撤销" : "重新启用", () =>
                    command("grant.set", {
                      grantId: grant.grantId,
                      ownerBotId: grant.ownerBotId,
                      recipientBotId: grant.recipientBotId,
                      level: grant.level,
                      scope: grant.scope,
                      active: !grant.active,
                      expectedVersion: grant.version,
                    }),
                  ),
                ),
              ),
            ),
          );
        }
        function GroupMembersEditor({group:latestGroup}) {
          const [group,setBase]=useState(latestGroup),[formEpoch,setFormEpoch]=useState(0);
          return advanced("管理群成员",
            latestGroup.version !== group.version && h("div",null,
              h("p",{role:"status"},"群成员或群状态已更新。当前成员草稿已保留；保存将检查原版本。"),
              button("重新载入最新群成员",()=>{setBase(latestGroup);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("更新群成员",async data=>{
              const saved=await command("group.members",{groupId:group.groupId,expectedVersion:group.version,botIds:data.getAll("botIds"),coordinatorBotId:data.get("coordinator")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("成员（可多选）","botIds",{options:botsOptions(),multiple:true,value:group.members.filter(row=>row.active).map(row=>row.botId)}),field("协调者","coordinator",{options:botsOptions(),value:group.coordinatorBotId}))),
          );
        }
        function GroupsPane() {
          const view = useView();
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.groups.map((group) =>
                resourceCard(
                  group.groupId,
                  group.name,
                  h(
                    "p",
                    null,
                    group.members
                      .filter((row) => row.active)
                      .map(
                        (row) =>
                          view.snapshot.bots.find(
                            (bot) => bot.botId === row.botId,
                          )?.name,
                      )
                      .join("、"),
                  ),
                  ...group.messages
                    .slice(-30)
                    .map((row) =>
                      h(
                        "p",
                        { key: row.messageId },
                        h(
                          "strong",
                          null,
                          row.producer.kind === "human"
                            ? "你："
                            : `${view.snapshot.bots.find((bot) => bot.botId === row.producer.botId)?.name ?? "Bot"}：`,
                        ),
                        row.text,
                      ),
                    ),
                  form(
                    "发送给群成员",
                    (data) =>
                      command("group.post", {
                        groupId: group.groupId,
                        text: data.get("text"),
                      }),
                    field("消息", "text", { textarea: true }),
                  ),
                  advanced("开会", form(
                    "发起会议",
                    (data) =>
                      command("meeting.start", {
                        groupId: group.groupId,
                        topic: data.get("topic"),
                        materials: data.get("materials"),
                      }),
                    field("议题", "topic", { maxLength: 1000 }),
                    field("共同材料", "materials", {
                      textarea: true,
                      required: false,
                      maxLength: 32000,
                    }),
                  )),
                  h(GroupMembersEditor,{group,key:group.groupId}),
                ),
              ),
            ),
            card(
              "新建内部群",
              h(TemplateCreator,{teamOnly:true}),
              form(
                "创建群",
                (data) =>
                  command("group.create", {
                    name: data.get("name"),
                    botIds: data.getAll("botIds"),
                    coordinatorBotId: data.get("coordinator"),
                    rounds: Number(data.get("rounds")),
                    maxRequests: Number(data.get("requests")),
                  }),
                field("群名称", "name", { maxLength: 100 }),
                field("成员（可多选）", "botIds", {
                  options: botsOptions(),
                  multiple: true,
                }),
                field("协调者（必须在成员中）", "coordinator", {
                  options: botsOptions(),
                }),
                advanced("群设置",
                field("每条人类消息的最大成员轮数", "rounds", {
                  type: "number",
                  value: 1,
                  min: 1,
                  max: 3,
                }),
                field("每次群轮的模型请求预算", "requests", {
                  type: "number",
                  value: 12,
                  min: 1,
                  max: 60,
                }),
                ),
              ),
            ),
          );
        }
        function MeetingTopicEditor({meeting:latestMeeting}) {
          const [meeting,setBase]=useState(latestMeeting),[formEpoch,setFormEpoch]=useState(0);
          return advanced("修改议题",
            latestMeeting.epoch !== meeting.epoch && h("div",null,
              h("p",{role:"status"},"会议议题已变更。当前议题草稿保留在原会议世代；不会覆盖新议题。"),
              button("重新载入最新议题",()=>{setBase(latestMeeting);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("修改议题并重开独立意见",async data=>{
              const saved=await command("meeting.topic",{meetingId:meeting.meetingId,epoch:meeting.epoch,topic:data.get("topic"),materials:data.get("materials")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("新议题","topic",{value:meeting.topic,maxLength:1000}),field("新材料","materials",{value:meeting.materials,textarea:true,required:false,maxLength:32000}))),
          );
        }
        function MeetingActionEditor({meeting:latestMeeting}) {
          const [meeting,setBase]=useState(latestMeeting),[formEpoch,setFormEpoch]=useState(0);
          return advanced("登记行动任务",
            latestMeeting.epoch !== meeting.epoch && h("div",null,
              h("p",{role:"status"},"会议决定所属世代已改变。当前行动草稿仍属于原决定；请先查阅最新决定。"),
              button("重新载入最新会议决定",()=>{setBase(latestMeeting);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("生成真实行动任务",data=>command("meeting.action",{
              meetingId:meeting.meetingId,epoch:meeting.epoch,botId:data.get("botId"),title:data.get("title"),goal:data.get("goal"),criteria:String(data.get("criteria")).split("\n").filter(Boolean),
            }),field("负责人","botId",{options:botsOptions()}),field("任务标题","title",{maxLength:200}),field("行动目标","goal",{textarea:true,maxLength:16000}),field("验收条件","criteria",{textarea:true}))),
          );
        }
        function MeetingsPane() {
          const view = useView();
          return h(
            "div",
            null,
            ...view.snapshot.meetings.map((meeting) =>
              resourceCard(
                meeting.meetingId,
                meeting.topic,
                h(
                  "p",
                  null,
                  `${stateName(meeting.phase)} · 已收到独立意见 ${Object.keys(meeting.opinions).length}/${meeting.participants.filter((row) => row.active).length} · 请求 ${meeting.requests}/${meeting.maxRequests}`,
                ),
                h("p", { className: "muted" }, meeting.materials),
                meeting.phase !== "independent" &&
                  h(
                    "div",
                    null,
                    ...Object.values(meeting.opinions).map((row) =>
                      h(
                        "article",
                        { className: "card", key: row.botId },
                        h(
                          "h3",
                          null,
                          view.snapshot.bots.find(
                            (bot) => bot.botId === row.botId,
                          )?.name,
                        ),
                        h("p", null, row.text),
                      ),
                    ),
                  ),
                ...Object.values(meeting.discussion).map((row) =>
                  h(
                    "p",
                    { key: row.botId },
                    `${view.snapshot.bots.find((bot) => bot.botId === row.botId)?.name}：${row.text}`,
                  ),
                ),
                meeting.decision &&
                  card("真实协调者决定", h("p", null, meeting.decision.text)),
                Object.keys(meeting.absences).length > 0 &&
                  h(
                    "p",
                    { className: "error" },
                    `缺席原因：${Object.values(meeting.absences)
                      .map((row) => row.reason)
                      .join("；")}`,
                  ),
                h(
                  "div",
                  { className: "actions" },
                  !["complete", "cancelled"].includes(meeting.phase) &&
                    button(
                      {
                        independent: "揭示并讨论",
                        discussion: "进入决定",
                        decision: "结束会议",
                      }[meeting.phase],
                      () =>
                        command("meeting.advance", {
                          meetingId: meeting.meetingId,
                          epoch: meeting.epoch,
                          phase: meeting.phase,
                        }),
                    ),
                  !["complete", "cancelled"].includes(meeting.phase) &&
                    button("取消会议", () =>
                      command("meeting.cancel", {
                        meetingId: meeting.meetingId,
                        epoch: meeting.epoch,
                      }),
                    ),
                ),
                meeting.decision &&
                  h(MeetingActionEditor,{meeting,key:`action:${meeting.meetingId}`}),
                !["complete", "cancelled"].includes(meeting.phase) &&
                  h(MeetingTopicEditor,{meeting,key:`topic:${meeting.meetingId}`}),
              ),
            ),
          );
        }
        function SessionEditor({binding:latestBinding,onSaved}) {
          const [base,setBase]=useState(latestBinding),[epoch,setEpoch]=useState(0),[choices,setChoices]=useState({configure:"",fork:"",preset:""}),view=useView();
          const model=base.model?JSON.stringify({provider:base.model.provider,model:base.model.model}):"",models=modelsOptions();
          if(model&&!models.some(row=>row.value===model))models.push({value:model,label:`${base.model.provider} / ${base.model.model}（当前不可用）`});
          const sessionModels = selected => selected&&!models.some(row=>row.value===selected)?[...models,{value:selected,label:`${JSON.parse(selected).provider} / ${JSON.parse(selected).model}（当前不可用，请重新选择）`}]:models;
          const presets=view.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}));
          if(choices.preset&&!presets.some(row=>row.value===choices.preset))presets.push({value:choices.preset,label:`${choices.preset}（当前不可用，请重新选择）`});
          return advanced("配置与接续",
            (latestBinding.revision??1)!==(base.revision??1)&&h("div",null,h("p",{role:"status"},"会话配置已更新。草稿保留，保存会检查原版本。"),button("重新载入最新会话配置",()=>{setBase(latestBinding);setChoices({configure:"",fork:"",preset:""});setEpoch(n=>n+1);})),
            h("div",{key:epoch},form("保存此会话配置",async data=>{
              const saved=await command("session.configure",{sessionId:base.sessionId,expectedVersion:base.revision??1,name:data.get("name"),...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),...(data.get("presetId")?{presetId:data.get("presetId")}:{})});if(saved){setBase(saved);onSaved?.();}
            },field("会话名称","name",{value:base.name??view.snapshot.bots.find(bot=>bot.botId===base.botId)?.name,maxLength:100}),base.purpose==="contact"&&field("此会话模型","model",{value:choices.configure,required:false,options:[{value:"",label:`保留当前模型${base.model?.model?`（${base.model.model}）`:""}`},...sessionModels(choices.configure)],onChange:event=>setChoices(draft=>({...draft,configure:event.target.value}))}),base.purpose==="contact"&&field("原生会话配置（首次对话后锁定）","presetId",{value:choices.preset,required:false,options:[{value:"",label:"保留当前配置"},...presets],onChange:event=>setChoices(draft=>({...draft,preset:event.target.value}))}),h("small",null,"请先等待当前回复、排队消息与工作结算。原会话工作目录固定，模型修改从下一轮生效。"))),
            base.purpose==="contact"&&form("创建接续会话",async data=>{
              const row=await command("session.fork",{sessionId:base.sessionId,expectedVersion:base.revision??1,...(data.get("name")?{name:data.get("name")}:{}) ,...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),...(data.get("cwd")?.trim()?{cwd:data.get("cwd").trim()}:{}),...(data.get("atSeq")!==""?{atSeq:Number(data.get("atSeq"))}:{})});
              if(row?.state==="ready"){onSaved?.();await openSession(row.sessionId);}
            },field("新会话名称","name",{value:base.name,required:false,maxLength:100}),field("新会话模型","model",{value:choices.fork,required:false,options:[{value:"",label:"沿用原会话模型"},...sessionModels(choices.fork)],onChange:event=>setChoices(draft=>({...draft,fork:event.target.value}))}),advanced("接续范围与目录",field("原生日志结束事件序号（留空沿用最近完成轮次）","atSeq",{type:"number",min:0,required:false}),field("新会话工作目录","cwd",{required:false,value:base.cwd??""})),h("small",null,"创建新会话保留可核对的原日志来源，原会话与旧记录保留。接续沿用原生会话配置；需要另一配置时创建空白新会话。")));
        }
        function SessionsPane() {
          const [page, setPage] = useState({ items: [], cursor: null }),
            [error, setError] = useState(""),loadGeneration=useRef(0),mounted=useRef(true);
          const load = async (cursor) => {
            if(!mounted.current)return;
            const generation=++loadGeneration.current,isActive=()=>mounted.current&&generation===loadGeneration.current&&!lifetime.signal.aborted;
            setError("");
            try {
              const next=await rpc("command", {
              action: "session.list",
              input: { limit: 50, ...(cursor ? { cursor } : {}) },
              });
              if(isActive())
                setPage((previous) => ({
                  items: cursor
                    ? [...previous.items, ...next.items]
                    : next.items,
                  cursor: next.nextCursor,
                }));
            } catch(e) {if(isActive())setError(e.message);}
          };
          useEffect(() => {
            mounted.current=true;
            load();
            return()=>{mounted.current=false;loadGeneration.current++;};
          }, []);
          return card(
            "原生会话管理",
            button("刷新会话", () => load()),
            h(
              "p",
              { className: "muted" },
              "包含普通会话、Bot 联络、执行、群会议和归档对象。查看历史沿用原生日志。",
            ),
            error && h("p", { className: "error" }, error),
            ...page.items.map((row) => {
              const binding = state.snapshot.sessions.find(
                (item) => item.sessionId === row.sessionId,
              );
              return h(
                "article",
                { className: "card", key: row.sessionId },
                h(
                  "h3",
                  null,
                  row.header?.title ||
                    state.snapshot.bots.find((bot) => bot.botId === row.botId)
                      ?.name ||
                    binding?.name || row.sessionId.slice(0, 8),
                ),
                h(
                  "p",
                  null,
                  `${row.purpose ?? "普通会话"} · ${stateName(binding?.state ?? "ready")}`,
                ),
                h("small", null, row.sessionId),
                h(
                  "div",
                  { className: "actions" },
                  button("查看原生会话", () => openSession(row.sessionId, row)),
                  row.activity &&
                    !row.attemptId &&
                    !row.parentSessionId &&
                    !row.header?.parentSession &&
                    !row.lineage &&
                    button("停止当前回复", async () => {
                      await command("session.stop", {
                        sessionId: row.sessionId,
                        expectedTurn: row.activity.token,
                      });
                      load();
                    }),
                  button(row.archived ? "恢复" : "归档", async () => {
                    await command(
                      row.archived ? "session.restore" : "session.archive",
                      { sessionId: row.sessionId },
                    );
                    load();
                  }),
                ),
                binding&&h(SessionEditor,{binding,onSaved:()=>load(),key:binding.sessionId}),
              );
            }),
            page.cursor && button("加载下一页", () => load(page.cursor)),
            h(DiagnosticsPane,{key:'diagnostics'}),
          );
        }
        function DiagnosticsPane() {
          const view=useView(),[preview,setPreview]=useState(""),[selected,setSelected]=useState([]),[copied,setCopied]=useState(false),previewGeneration=useRef(0);
          useEffect(()=>()=>{previewGeneration.current++;},[]);
          const operations=[...view.pending,...view.retained];
          return advanced("诊断",h("p",null,"在本机读取版本、功能状态、对象数量、错误码和选定的操作 ID。预览与复制内容相同；不会上传，正文、路径和凭据不包含在内。"),
            field("附带的原始操作（可多选）","operationIds",{options:operations.map(row=>({value:row.operationId,label:row.operationId})),multiple:true,required:false,value:selected,onChange:event=>{previewGeneration.current++;setSelected([...event.target.selectedOptions].map(row=>row.value));setPreview("");setCopied(false);}}),
            button("预览诊断",async()=>{const generation=++previewGeneration.current,isActive=()=>generation===previewGeneration.current;const value=await query("diagnostics.read",{operationIds:selected},isActive);if(value&&isActive()){setPreview(JSON.stringify(value,null,2));setCopied(false);}}),
            preview&&h("div",null,h("pre",null,preview),button("复制以上诊断",async()=>{const generation=previewGeneration.current,isActive=()=>generation===previewGeneration.current&&!lifetime.signal.aborted;try{await navigator.clipboard.writeText(preview);if(isActive())setCopied(true);}catch{if(isActive())publish({error:"无法写入剪贴板，请从预览选择并复制。"});}}),copied&&h("p",{role:"status"},"已复制诊断。")));
        }
        function OutboxPane() {
          const view = useView();
          return h(
            "div",
            null,
            h(DiagnosticsPane),
            ...view.snapshot.outbox.map((row) =>
              resourceCard(
                row.outboxId,
                row.kind === "result" ? "任务结果" : "消息投递",
                h("p", null, stateName(row.state)),
                h(
                  "pre",
                  null,
                  row.message?.content
                    ?.map((block) => block.text ?? "")
                    .join("\n"),
                ),
                row.sessionId &&
                  button("查看接收会话", () => openSession(row.sessionId)),
                (["UNKNOWN", "admitting"].includes(row.state) ||
                  (row.state === "blocked" && row.nativeAdmission === false)) &&
                  button(
                    row.state === "blocked" ? "重新检查并投递" : "查回原始投递",
                    () =>
                      command("outbox.reconcile", { outboxId: row.outboxId }),
                  ),
              ),
            ),
          );
        }
        function Workbench() {
          const view = useView(),
            [tab, setTab] = useState("bots"),
            [collaborationTab, setCollaborationTab] = useState("groups"),
            [manageTab, setManageTab] = useState("sharing");
          useEffect(()=>{if(view.requestedTab){if(["groups","meetings"].includes(view.requestedTab)){setTab("collaboration");setCollaborationTab(view.requestedTab);}else setTab(view.requestedTab);publish({requestedTab:null});}},[view.requestedTab]);
          useEffect(()=>{const id=tab==="bots"&&view.requestedTab!=="memory"?view.focusBotId:tab==="collaboration"?(collaborationTab==="groups"?view.focusGroupId:view.focusMeetingId):null;if(id){const target=document.getElementById?.(`dsh-resource-${id}`);target?.scrollIntoView?.({block:"center"});target?.focus?.({preventScroll:true});}},[view.focusBotId,view.focusGroupId,view.focusMeetingId,tab,collaborationTab]);
          const paneKey = tab === "collaboration" ? collaborationTab : tab === "manage" ? manageTab : tab;
          const panes = {
            bots: BotsPane,
            memory: MemoryPane,
            tasks: TasksPane,
            sharing: SharingPane,
            groups: GroupsPane,
            meetings: MeetingsPane,
            sessions: SessionsPane,
            outbox: OutboxPane,
          };
          useEffect(() => {
            refresh(true);
          }, []);
          return h(
            "section",
            { className: "dsh-bot", "aria-label": t("title") },
            h("style", null, styles),
            h(
              "header",
              null,
              h(
                "div",
                null,
                h("h1", null, t("title")),
                h("small", null, `原生多 Bot · 独立记忆 · 协作任务 · 插件 ${pluginVersion} / 服务 ${view.snapshot.pluginVersion ?? "未知"}`),
              ),
              h(
                "div",
                { className: "actions" },
                button(t("newSession"), () => publish({ chooser: true })),
                button(t("refresh"), () => refresh(true)),
              ),
            ),
            view.error &&
              h("p", { role: "alert", className: "error" }, view.error),
            view.storageNotice && h("p",{role:"status","aria-label":"浏览器存储提示"},view.storageNotice),
            view.pending.length > 0 &&
              card(
                "待查回的原始操作",
                ...view.pending.map((row) =>
                  h(
                    "div",
                    { className: "actions", key: row.operationId },
                    h("small", null, `${row.action} · ${row.operationId}`),
                    advanced("查看完整原始请求",h("pre",null,JSON.stringify(row,null,2))),
                    button("查回原始操作", () => lookupOperation(row)),
                    button("用原 ID 接续", () =>
                      command(row.action, row.input, row),
                    ),
                    button("保留并收起",()=>retainPending(row)),
                  ),
                ),
              ),
            view.retained.length>0 && advanced("保留的原始操作",
              h("p",{className:"muted"},"收起只改变浏览器记录的显示；原始请求和 ID 保留，任务和未知状态不受影响。"),
              ...view.retained.map(row=>h("div",{className:"actions",key:row.operationId},
                h("small",null,`${row.action} · ${row.operationId}`),
                advanced("查看完整原始请求",h("pre",null,JSON.stringify(row,null,2))),
                button("查回原始操作",()=>lookupOperation(row)),
                button("用原 ID 接续",()=>command(row.action,row.input,row)),
              )),
            ),
            h(
              "nav",
              { "aria-label": "Bot 工作台功能" },
              ...Object.entries({
                bots: "Bots",
                memory: "记忆",
                tasks: "任务",
                collaboration: "协作",
                manage: "管理",
              }).map(([key, label]) =>
                button(label, () => {if(tab!==key)existingChatIntent++;setTab(key);}, {
                  "aria-selected": tab === key,
                }),
              ),
            ),
            (tab === "collaboration" || tab === "manage") && h("nav", {
              "aria-label": tab === "collaboration" ? "协作功能" : "管理功能",
            }, ...Object.entries(tab === "collaboration"
              ? {groups: "内部群", meetings: "会议"}
              : {sharing: "共享与授权", sessions: "会话管理", outbox: "结果与投递"}
            ).map(([key, label]) => button(label,
              () => tab === "collaboration" ? setCollaborationTab(key) : setManageTab(key),
              {"aria-selected": paneKey === key},
            ))),
            view.loading ? h("p", null, "连接原生插件…") : h(panes[paneKey]),
          );
        }
        function Chooser() {
          const view = useView();
          useEffect(() => {
            if (view.chooser) refresh();
          }, [view.chooser]);
          if (!view.chooser) return null;
          const bots = view.snapshot.bots.filter(
            (bot) => bot.lifecycle === "active",
          );
          return h(
            "div",
            { className: "dsh-bot-dialog" },
            h(
              "section",
              {
                className: "dsh-bot",
                role: "dialog",
                "aria-modal": true,
                "aria-label": t("newSession"),
              },
              h("style", null, styles),
              h(
                "header",
                null,
                h("h2", null, t("newSession")),
                button(t("close"), () => publish({ chooser: false })),
              ),
              bots.length
                ? form(
                    t("start"),
                    async (data) => {
                      const result = await command("session.create", {
                        botId: data.get("botId"),
                        ...(data.get("name")?{name:data.get("name")}:{}) ,
                        ...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),
                        ...(data.get("presetId")?{presetId:data.get("presetId")}:{}) ,
                        ...(data.get("cwd")?.trim()?{cwd:data.get("cwd").trim()}:{}),
                      });
                      if (result?.state === "ready") {
                        publish({ chooser: false });
                        openSession(result.sessionId);
                      }
                    },
                    field(t("choose"), "botId", {
                      options: bots.map((bot) => ({
                        value: bot.botId,
                        label: botLabel(bot),
                      })),
                    }),
                    advanced("会话设置",field("会话名称","name",{required:false,maxLength:100}),field("此会话模型","model",{required:false,options:[{value:"",label:"使用 Bot 的聊天模型"},...modelsOptions()]}),field("原生会话配置","presetId",{required:false,options:[{value:"",label:"使用 Bot 的默认配置"},...view.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}))]}),field("此会话工作目录","cwd",{required:false})),
                    h("small",null,"新会话自动带入该 Bot 的身份、长期记忆与未完成任务。"),
                  )
                : h("p", null, t("empty")),
              view.error &&
                h("p", { role: "alert", className: "error" }, view.error),
              button(t("title"), () => {
                publish({ chooser: false });
                ctx.layout.selectPanel("dsh-bot");
              }),
            ),
          );
        }
        function Header({ sessionId }) {
          const view = useView(),
            binding = view.snapshot.sessions.find(
              (row) => row.sessionId === sessionId,
            ),
            bot = view.snapshot.bots.find(
              (row) => row.botId === binding?.botId,
            );
          if (!bot) return null;
          const identity=bot.deletedAt
            ? `${botLabel(bot)} · 已删除 Bot 的历史会话`
            : binding.purpose === "contact"
              ? `正在与${botLabel(bot)}聊天${bot.lifecycle === "active" ? "" : " · 已暂停"}`
              : `${botLabel(bot)} · ${binding.purpose === "execution" ? "工作会话" : "协作会话"}`;
          return h("div",{className:"actions",style:{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}, h(
            "button",
            {
              type: "button",
              title: `${identity} · ${t("manage")}`,
              "aria-label": identity,
              style: {font:"inherit",color:"var(--dsw-alias-label-primary)",background:"var(--dsw-alias-bg-layer-2,transparent)",border:"1px solid var(--dsw-alias-border-l2,currentColor)",borderRadius:"8px",padding:"6px 12px",cursor:"pointer",maxWidth:"100%",overflowWrap:"anywhere"},
              onClick: () => ctx.layout.selectPanel("dsh-bot"),
            },
            identity,
          ),binding.purpose==="contact"&&button(`任务简报${(view.snapshot.notices??[]).filter(row=>row.botId===bot.botId&&!row.acknowledgedAt&&!row.ackedAt&&!row.read).length?` · ${(view.snapshot.notices??[]).filter(row=>row.botId===bot.botId&&!row.acknowledgedAt&&!row.ackedAt&&!row.read).length}`:""}`,event=>publish({briefing:{botId:bot.botId,returnFocus:event.currentTarget}}),{style:{font:"inherit",border:"1px solid var(--dsw-alias-border-l2,currentColor)",borderRadius:"8px",padding:"6px 10px",background:"var(--dsw-alias-bg-layer-2,transparent)",color:"inherit"}}));
        }
        function DeleteDialog() {
          const view=useView(),request=view.deleting,modal=useRef(null);
          useEffect(()=>{
            const element=modal.current;
            if(!request||!element)return;
            element.showModal();
            return ()=>{
              if(element.open)element.close();
              if(request.returnFocus?.isConnected)request.returnFocus.focus();
            };
          },[request?.botId,request?.expectedVersion]);
          if(!request)return null;
          const current=view.snapshot.bots.find(bot=>bot.botId===request.botId);
          return h("dialog",{ref:modal,className:"dsh-bot-delete-modal","aria-label":"删除 Bot",
            onCancel:event=>{event.preventDefault();if(!view.busy)publish({deleting:null,error:""});},
            onKeyDown:event=>{
              if(event.key!=="Tab")return;
              const controls=[...event.currentTarget.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length);
              const first=controls[0],last=controls.at(-1);
              if(!first){event.preventDefault();return;}
              if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
              else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
            },
          },
            h("style",null,".dsh-bot-delete-modal{border:0;padding:0;background:transparent;color:inherit;width:min(480px,calc(100vw - 32px));max-height:90vh;overflow:auto;border-radius:16px}.dsh-bot-delete-modal::backdrop{background:rgba(0,0,0,.35)}.dsh-bot-delete-modal .dsh-bot{height:auto;background:var(--dsw-alias-bg-layer-1,Canvas)}"),
            h("section",{className:"dsh-bot"},
              h("style",null,styles),
              h("h2",null,`删除 ${request.name}？`),
              h("p",null,"删除后从 Bots 列表和新建聊天选择中移除。原会话、记忆、任务与执行记录保留，可以恢复。"),
              h("p",{className:"muted"},"正在回复、排队、未完成群/会议或未结算的工作会阻止删除。请先停止并等待结算；未知工作需先查回。"),
              current?.revision!==request.expectedVersion && h("p",{role:"status"},"Bot 已被其他页面修改，请取消后按最新配置重新确认删除。"),
              view.error && h("p",{role:"alert",className:"error"},view.error),
              h("div",{className:"actions"},
                button("取消",()=>publish({deleting:null,error:""}),{autoFocus:true}),
                button("确认删除",async()=>{
                  const deleted=await command("bot.delete",{botId:request.botId,expectedVersion:request.expectedVersion});
                  if(deleted?.deletedAt)publish({deleting:null});
                },{disabled:view.busy||!current||current.revision!==request.expectedVersion}),
              ),
            ),
          );
        }
        const {BotSpace,NativeConversation,NativeInteraction}=createBotSpace({
          React:{createElement:h,useState,useEffect,useRef,useSyncExternalStore},ctx,useView,command,query,botLabel,stateName,openSession,
          onManage:({tab,taskId,botId,groupId,meetingId,roundId})=>{publish({requestedTab:tab,focusTaskId:taskId??null,focusBotId:botId??null,focusGroupId:groupId??null,focusMeetingId:meetingId??null,focusRoundId:roundId??null});ctx.layout.selectPanel("dsh-bot");},
          styles:botSpaceStyles,
        });
        ctx.slots.inject("dsh.bot-space.conversation",()=>ctx.slots.register({name:"dsh.bot-space.conversation"},NativeConversation));
        ctx.slots.inject("dsh.bot-space.interaction",()=>ctx.slots.register({name:"dsh.bot-space.interaction"},NativeInteraction));
        ctx.slots.inject("sidebar.panellist",()=>ctx.slots.register({name:"sidebar.panellist",id:"dsh-bot.space",order:245,label:()=>"Bot 空间"},({size=20})=>h("span",{"aria-hidden":true,style:{fontSize:`${size}px`}},"B")));
        ctx.slots.inject("main", () =>
          ctx.slots.register(
            { name: "main", key: "dsh-bot", id: "dsh-bot" },
            Workbench,
          ),
        );
        ctx.slots.inject("main",()=>ctx.slots.register({name:"main",key:"dsh-bot.space",id:"dsh-bot.space",children:{"dsh.bot-space.conversation":{kind:"single",scope:"session"},"dsh.bot-space.interaction":{kind:"single",scope:"session"}}},BotSpace));
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: "dsh-bot",
              order: 250,
              label: () => t("title"),
              locale: "dsh.bot",
            },
            ({ size = 20 }) =>
              h(
                "span",
                { "aria-hidden": true, style: { fontSize: `${size}px` } },
                "♧",
              ),
          ),
        );
        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.footer.action",
              id: "dsh-bot.new-session",
              order: 250,
            },
            ({ wide }) =>
              h(
                "button",
                {
                  type: "button",
                  title: t("newSession"),
                  "aria-label": t("newSession"),
                  onClick: () => publish({ chooser: true }),
                  style: {
                    font: "inherit",
                    color: "var(--dsw-alias-label-primary)",
                    background: "transparent",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "left",
                  },
                },
                wide ? t("newSession") : "B+",
              ),
          ),
        );
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            { name: "shell.overlay", id: "dsh-bot.chooser", order: 250 },
            Chooser,
          ),
        );
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            {name:"shell.overlay",id:"dsh-bot.delete",order:260},
            DeleteDialog,
          ),
        );
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({name:"shell.overlay",id:"dsh-bot.briefing",order:255},BriefingDialog));
        ctx.slots.inject("conversation.session.header.utilities", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.utilities",
              id: "dsh-bot.identity",
              order: 250,
            },
            Header,
          ),
        );
        ctx.slots.inject("conversation.input.dock", () =>
          ctx.slots.register(
            {name:"conversation.input.dock",id:"dsh-bot.identity",order:250},
            Header,
          ),
        );
        ctx.effect(() => {
          refresh(true);
          interval = setInterval(() => {
            if (listeners.size) refresh();
          }, 1000);
          return () => {
            clearInterval(interval);
            lifetime.abort();
            listeners.clear();
          };
        });
      },
    };
  },
});
