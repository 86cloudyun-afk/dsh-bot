import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {taskFixture} from './task-fixture.mjs';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {eventually} from './official-fixture.mjs';

const source=await readFile(new URL('../../src/client/client.js',import.meta.url),'utf8');
function pane(f,name) {
  const helper=({TasksPane:'TaskAdjustment',GroupsPane:'GroupMembersEditor',SharingPane:'SharingEditor',MeetingsPane:'MeetingTopicEditor'})[name];
  const start=source.indexOf(`        function ${helper}(`);
  const body=source.slice(start<0?source.indexOf(`        function ${name}(`):start,
    source.indexOf(({TasksPane:'        function SharingPane(',GroupsPane:'        function MeetingsPane(',SharingPane:'        function GroupsPane(',MeetingsPane:'        function SessionsPane('})[name]));
  const hooks=new Map(); let active='pane',index=0,view,tree;
  const node=(type,props,...children)=>{
    if(typeof type==='function') {
      const before=[active,index]; active=`${type.name}:${props.task?.taskId??props.group?.groupId??props.bot?.botId??props.meeting?.meetingId??''}`;index=0;
      const result=type(props); [active,index]=before;return result;
    }
    return {type,props,children};
  };
  const useState=initial=>{
    const key=`${active}:${index++}`;
    if(!hooks.has(key))hooks.set(key,initial);
    return [hooks.get(key),value=>hooks.set(key,typeof value==='function'?value(hooks.get(key)):value)];
  };
  const make=new Function('h','useState','useRef','useEffect','useView','resourceCard','advanced','form','field','button','stateName','botsOptions','command','openSession','card','check','botLabel',body+`; return ${name};`);
  const render=make(node,useState,()=>({current:null}),()=>{},()=>view,
    (_key,title,...children)=>node('card',{title},...children),
    (title,...children)=>node('advanced',{title},...children),
    (label,submit,...children)=>node('form',{label,submit},...children),
    (label,name,options)=>node('field',{label,name,...options}),
    (label,onClick)=>node('button',{label,onClick}),value=>value,
    ()=>view.snapshot.bots.map(bot=>({value:bot.botId,label:bot.name})),
    (action,input)=>f.service.dispatch(f.human,{operationId:crypto.randomUUID(),action,input}),()=>{},
    (title,...children)=>node('card',{title},...children),
    (name,label,checked)=>node('check',{name,label,checked}),bot=>bot?.name??'Bot');
  const find=(item,predicate)=>{
    if(!item)return null;
    if(predicate(item))return item;
    for(const child of item.children??[]) {
      for(const value of Array.isArray(child)?child:[child]) {const found=find(value,predicate);if(found)return found;}
    }
    return null;
  };
  return {
    refresh() {view={snapshot:f.service.snapshot(f.human),busy:false};active='pane';index=0;tree=render();},
    submit(label,data,title) {const scope=title?find(tree,item=>item.type==='card'&&item.props.title===title):tree;const form=find(scope,item=>item.type==='form'&&item.props.label===label);assert.ok(form);return form.props.submit(data);},
    changeReceiver(title,botId,checked) {const scope=find(tree,item=>item.type==='card'&&item.props.title===title);const input=find(scope,item=>item.type==='input'&&item.props.name==='receiver'&&item.props.value===botId);assert.ok(input);input.props.onChange({target:{checked}});},
    receivers(title) {const scope=find(tree,item=>item.type==='card'&&item.props.title===title),values=[];find(scope,item=>{if(item.type==='input'&&item.props.name==='receiver'&&item.props.checked)values.push(item.props.value);return false;});return values;},
    click(label) {const button=find(tree,item=>item.type==='button'&&item.props.label===label);assert.ok(button);return button.props.onClick();},
  };
}

test('task adjustment keeps its draft revision and rejects a concurrent goal edit',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),task=await f.task(bot);
  const ui=pane(f,'TasksPane');ui.refresh();
  const external=await f.tasks.adjust(f.human,{operationId:'external-task-edit',action:'task.adjust',input:{taskId:task.taskId,expectedVersion:task.version,goal:'Other page goal'}});
  ui.refresh();
  await assert.rejects(ui.submit('调整目标',new Map([['goal','Local draft goal']])),{code:'revision_conflict'});
  assert.equal(f.store.read().tasks[task.taskId].goal,external.goal);
  ui.click('重新载入最新任务');ui.refresh();
  const saved=await ui.submit('调整目标',new Map([['goal','Reviewed goal']]));
  assert.equal(saved.goal,'Reviewed goal');
  assert.equal(saved.version,external.version+1);
  assert.equal(f.requests.length,0);
});

test('group member drafts cannot silently remove members added on another page',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),group=await f.group('Group',[a]);
  const ui=pane(f,'GroupsPane');ui.refresh();
  const external=await f.collaboration.changeMembers(f.human,{operationId:'external-group-edit',action:'group.members',input:{groupId:group.groupId,expectedVersion:group.version,botIds:[a.botId,b.botId],coordinatorBotId:a.botId}});
  const data={getAll:()=>[a.botId],get:()=>a.botId};ui.refresh();
  await assert.rejects(ui.submit('更新群成员',data),{code:'revision_conflict'});
  assert.deepEqual(f.store.read().groups[group.groupId].members,external.members);
  ui.click('重新载入最新群成员');ui.refresh();
  const saved=await ui.submit('更新群成员',data);
  assert.equal(saved.version,external.version+1);
  assert.equal(saved.members.filter(row=>row.active).length,1);
  assert.equal(f.requests.length,0);
});

test('a stale acceptance draft cannot overturn a newer recorded acceptance',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),task=await f.task(bot);
  const attempt=await f.tasks.start(f.human,{operationId:'start-for-acceptance',action:'task.start',input:{taskId:task.taskId,expectedVersion:task.version}});
  await eventually(()=>f.store.read().attempts[attempt.attemptId]?.result && !f.store.read().attempts[attempt.attemptId]?.reservationHeld,'settled acceptance attempt');
  const ui=pane(f,'TasksPane');ui.refresh();
  const current=f.store.read().tasks[task.taskId];
  const accepted=await f.tasks.accept(f.human,{operationId:'external-acceptance',action:'task.accept',input:{taskId:task.taskId,attemptId:attempt.attemptId,expectedVersion:current.version,outcome:'passed',evidence:'Other page verified the result'}});
  ui.refresh();
  await assert.rejects(ui.submit('记录验收',new Map([['outcome','failed'],['evidence','Older draft evidence']])),{code:'revision_conflict'});
  assert.equal(f.store.read().tasks[task.taskId].acceptance,accepted.acceptance);
  ui.click('重新载入最新验收');ui.refresh();
  const saved=await ui.submit('记录验收',new Map([['outcome','unknown'],['evidence','Reviewed evidence']]));
  assert.equal(saved.acceptance,'unknown');
});

test('an old sharing draft cannot restore permissions revoked on another page',async t=>{
  const f=await taskFixture(t),a=await f.bot('A'),b=await f.bot('B');
  const ui=pane(f,'SharingPane');ui.refresh();
  const revoked={enabled:false,receivers:[],scope:{sessions:[],tasks:[],memories:[]}};
  await f.policy.authorizeShare(f.human,{operationId:'external-revoke',action:'share.set',input:{botId:a.botId,expectedVersion:a.revision,share:revoked}});
  ui.refresh();
  const data={getAll:()=>[b.botId],get:()=> 'on'};
  await assert.rejects(ui.submit('保存共享上限',data,'A 的共享范围'),{code:'revision_conflict'});
  assert.deepEqual(f.store.read().bots[a.botId].share,revoked);
  ui.click('重新载入最新共享范围');ui.refresh();
  await ui.submit('保存共享上限',data,'A 的共享范围');
  assert.equal(f.store.read().bots[a.botId].share.enabled,true);
  assert.equal(f.requests.length,0);
});

test('batched sharing recipient edits preserve every explicit selection change',async t=>{
  const f=await taskFixture(t),a=await f.bot('Owner'),b=await f.bot('B'),c=await f.bot('C');
  const ui=pane(f,'SharingPane'),title='Owner 的共享范围';ui.refresh();
  // Two DOM events can run before React commits another render. Exercise both
  // callbacks from that render, then let the next snapshot reveal the draft.
  ui.changeReceiver(title,b.botId,false);ui.changeReceiver(title,c.botId,false);ui.refresh();
  assert.deepEqual(ui.receivers(title),[]);
  ui.changeReceiver(title,b.botId,true);ui.changeReceiver(title,c.botId,true);ui.refresh();
  assert.deepEqual(ui.receivers(title).sort(),[b.botId,c.botId].sort());
  const saved=await ui.submit('保存共享上限',{getAll:()=>ui.receivers(title),get:()=> 'on'},title);
  assert.deepEqual(saved.receivers.sort(),[b.botId,c.botId].sort());
  assert.equal(f.requests.length,0);
});

test('a meeting topic draft keeps its original epoch when another page changes the topic',async t=>{
  const f=await collaborationFixture(t),a=await f.bot(),group=await f.group('TopicDraft',[a]),meeting=await f.meeting(group);
  const ui=pane(f,'MeetingsPane');ui.refresh();
  const external=await f.collaboration.changeTopic(f.human,{operationId:'external-topic',action:'meeting.topic',input:{meetingId:meeting.meetingId,epoch:meeting.epoch,topic:'Other topic',materials:'Other material'}});
  ui.refresh();
  await assert.rejects(ui.submit('修改议题并重开独立意见',new Map([['topic','Local draft'],['materials','Old material']])),{code:'stale_meeting'});
  assert.equal(f.store.read().meetings[meeting.meetingId].topic,external.topic);
  ui.click('重新载入最新议题');ui.refresh();
  const saved=await ui.submit('修改议题并重开独立意见',new Map([['topic','Reviewed topic'],['materials','Reviewed material']]));
  assert.equal(saved.epoch,external.epoch+1);
});

test('an action drafted under an earlier decision cannot be linked to a new meeting epoch',async t=>{
  const f=await collaborationFixture(t),a=await f.bot(),group=await f.group('ActionDraft',[a]),meeting=await f.meeting(group);
  async function decide(epoch) {
    for(const phase of ['independent','discussion']) {
      await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId][phase==='independent'?'opinions':'discussion']).length===1);
      await f.collaboration.advance(f.human,{operationId:`advance-${epoch}-${phase}`,action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch,phase}});
    }
    await eventually(()=>f.store.read().meetings[meeting.meetingId].decision);
  }
  await decide(meeting.epoch); const ui=pane(f,'MeetingsPane');ui.refresh();
  await f.collaboration.changeTopic(f.human,{operationId:'new-topic',action:'meeting.topic',input:{meetingId:meeting.meetingId,epoch:meeting.epoch,topic:'New decision',materials:'New material'}});
  await decide(meeting.epoch+1);ui.refresh();
  const data=new Map([['botId',a.botId],['title','Original action'],['goal','Goal for old decision'],['criteria','Old criterion']]);
  await assert.rejects(ui.submit('生成真实行动任务',data),{code:'decision_missing'});
  assert.equal(Object.keys(f.store.read().tasks).length,0);
  ui.click('重新载入最新会议决定');ui.refresh();
  const task=await ui.submit('生成真实行动任务',data);
  assert.equal(task.goal,'Goal for old decision');
  assert.deepEqual(f.store.read().meetings[meeting.meetingId].actions,[task.taskId]);
});
