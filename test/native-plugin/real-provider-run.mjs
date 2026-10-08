/** Explicit opt-in qualification: existing environment credential, no UNKNOWN replay. */
import {writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {deferred,eventually} from './official-fixture.mjs';
const owned=await mkdtemp(join(tmpdir(),'dsh-bot-real-model-')),output=resolve(process.argv[2]??join(owned,'report.json'));
process.env.DSH_HOME=join(owned,'home');
const closers=[],gate=deferred(),report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTreeDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),ownedDshHome:true,platform:process.platform,arch:process.arch,node:process.version,dsh:'0.2.0-rc.2',requests:[],checks:{},historicalUnknownReplayed:0,qualified:false};
let f,alarm;
const wait=(check,label)=>eventually(check,label,60000);
try {
  f=await collaborationFixture({after(fn){closers.push(fn);}});
  const provider=f.ctx.plugin(DeepSeek,{thinking:'disabled',maxTokens:512,streamIdleTimeoutMs:45000,retryPolicy:{mode:'normal',maxRetries:0}});await provider.await();
  f.ctx.on('llm/stream',async function*(options,next){
    if(options.provider==='controlled')throw Error('Controlled provider is excluded from real model evidence');
    if(report.requests.length>=32)throw Error('Qualification request budget exhausted');
    const row={sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort??null,usage:'UNKNOWN',finish:'UNKNOWN'};report.requests.push(row);
    try{for await(const chunk of next()){if(chunk.type==='usage')row.usage=chunk.usage;if(chunk.type==='finish')row.finish=chunk.reason.kind;yield chunk;}}catch(error){row.error=error.code??error.name;throw error;}
  },{global:true});
  alarm=setTimeout(()=>{for(const agent of f.ctx.agents.list())agent.cancel({kind:'user'});gate.resolve();},300000);
  const models=await f.ctx.llm.listModels('deepseek-official');if(!models.length)throw Error('No configured model');
  const contact={provider:'deepseek-official',model:models[0].id,reasoningEffort:'off',maxTokens:512,temperature:0};report.model=contact;
  const bots=[];for(const name of ['验收甲','验收乙','验收丙'])bots.push(await f.bots.create(f.human,{operationId:`real-bot-${bots.length}`,action:'bot.create',input:{name,role:'这是无害功能验收。按本轮要求直接简短回答；只有明确要求 long_probe 时才调用它。不要自行创建额外任务或自动转投。',cwd:f.dir,contact,execution:contact}}));
  const [a,b,c]=bots;
  const channel=await f.contact(a);await f.broker.enqueue(f.human,{operationId:'real-contact',action:'session.send',input:{sessionId:channel.sessionId,text:'只回复“联络通道正常”。不要调用工具。'}});
  await wait(()=>f.events.get(channel.sessionId)?.some(event=>event.type==='turn/end'),'first real contact');
  report.checks.actualContact=f.events.get(channel.sessionId)?.some(event=>event.type==='assistant/message'&&event.data.message.content.some(block=>block.type==='text'&&block.text));
  if(!report.checks.actualContact||report.requests.some(row=>row.finish==='error'))throw Error('Configured provider did not produce the initial native answer');
  let entered=false;const untool=f.ctx.tools.register({name:'long_probe',description:'无害的受控长任务验收工具，等待测试端释放。只调用一次。',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[{type:'text',text:'受控等待已释放'}]},execute:async()=>{entered=true;await gate.promise;return {};}});closers.push(untool);
  await f.bots.update(f.human,{operationId:'real-capability',action:'bot.update',input:{botId:a.botId,expectedVersion:a.revision,capabilities:['long_probe']}});
  const long=await f.tasks.create(f.human,{operationId:'real-long',action:'task.create',input:{botId:a.botId,title:'长工具验收',goal:'现在必须调用一次 long_probe，工具结束后直接简短答复。不得换用其他工具，不得创建其他任务。',criteria:['原生工具真实等待']}}),longAttempt=await f.tasks.start(f.human,{operationId:'real-long-start',action:'task.start',input:{taskId:long.taskId,expectedVersion:1}});
  await wait(()=>entered,'real model native long tool');
  const independent=await f.contact(a,'real-independent');await f.broker.enqueue(f.human,{operationId:'real-new-topic',action:'session.send',input:{sessionId:independent.sessionId,text:'与后台任务无关的新话题：只回答 2+3 的结果，不要调用工具。'}});
  await wait(()=>f.events.get(independent.sessionId)?.some(event=>event.type==='assistant/message'),'real independent answer');
  const short=await f.tasks.create(f.human,{operationId:'real-short',action:'task.create',input:{botId:a.botId,title:'短任务',goal:'不要调用工具，只回答 7+8 的结果。',criteria:['独立短模型答复']}}),shortAttempt=await f.tasks.start(f.human,{operationId:'real-short-start',action:'task.start',input:{taskId:short.taskId,expectedVersion:1}});
  await wait(()=>!f.store.read().attempts[shortAttempt.attemptId].reservationHeld,'real short task settlement');
  report.checks.concurrentContactAndShortTask=f.store.read().attempts[longAttempt.attemptId].reservationHeld&&f.adapter.resources(longAttempt.sessionId).tools>0&&f.store.read().attempts[shortAttempt.attemptId].state==='returned';gate.resolve();await wait(()=>!f.store.read().attempts[longAttempt.attemptId].reservationHeld,'real long task finish');
  const groups=[];for(const [name,members] of [['真实群一',[a,b]],['真实群二',[b,c]]])groups.push(await f.collaboration.createGroup(f.human,{operationId:`real-group-${groups.length}`,action:'group.create',input:{name,botIds:members.map(row=>row.botId),coordinatorBotId:members[0].botId,rounds:1,maxRequests:8}}));const rounds=[];
  for(const group of groups)rounds.push(await f.collaboration.post(f.human,{operationId:`real-post-${group.groupId}`,action:'group.post',input:{groupId:group.groupId,text:'给出一条无害的整理书桌建议；不要调用工具。'}}));
  await wait(()=>rounds.every(row=>f.store.read().groups[row.groupId].rounds[row.roundId].state==='complete'),'two real groups');report.checks.twoGroups=groups.every(group=>f.store.read().groups[group.groupId].messages.filter(row=>row.producer.kind==='bot').length===2);
  const meetings=[];for(const [group,topic,materials] of [[groups[0],'真实会议一','共同材料：活动预算 20 元，目标为整理桌面。'],[groups[1],'真实会议二','共同材料：活动预算 30 元，目标为整理书架。']])meetings.push(await f.collaboration.startMeeting(f.human,{operationId:`real-meeting-${meetings.length}`,action:'meeting.start',input:{groupId:group.groupId,topic,materials}}));
  await wait(()=>meetings.every(row=>Object.keys(f.store.read().meetings[row.meetingId].opinions).length===2),'two real independent meetings');report.checks.twoMeetings=meetings.every(row=>Object.values(f.store.read().meetings[row.meetingId].opinions).every(opinion=>opinion.source.meetingId===row.meetingId));
  const meeting=meetings[0];await f.collaboration.advance(f.human,{operationId:'real-discussion',action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch:1,phase:'independent'}});await wait(()=>Object.keys(f.store.read().meetings[meeting.meetingId].discussion).length===2,'real discussion');
  await f.collaboration.advance(f.human,{operationId:'real-decision',action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch:1,phase:'discussion'}});await wait(()=>f.store.read().meetings[meeting.meetingId].decision?.text,'real coordinator decision');report.checks.realDecision=true;
  report.qualified=Object.values(report.checks).every(Boolean)&&report.requests.every(row=>row.finish==='stop'||row.finish==='tool-calls');
}catch(error){report.error=error.code??error.name;report.qualified=false;}
finally{clearTimeout(alarm);gate.resolve();for(const close of closers.reverse())await Promise.resolve().then(close).catch(()=>{});await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({output,qualified:report.qualified,checks:report.checks,requests:report.requests.length,usageUnknown:report.requests.filter(row=>row.usage==='UNKNOWN').length,error:report.error??null}));if(!report.qualified)process.exitCode=1;}
