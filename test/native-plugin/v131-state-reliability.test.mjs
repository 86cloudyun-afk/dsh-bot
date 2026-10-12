import test from 'node:test';
import assert from 'node:assert/strict';
import {PluginStore,copy} from '../../src/native/store.mjs';
import {PermissionPolicy,defaultShare} from '../../src/native/policy.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {MemoryController} from '../../src/native/memory.mjs';
import {AssistantController} from '../../src/native/assistant.mjs';
import {BotService} from '../../src/native/service.mjs';

const command=(operationId,action,input={})=>({operationId,action,input});
const noticeRows=(action,result)=>action==='notice.list'?result:result.notices;

async function fixture(t) {
  let persisted={global:null,tables:{state:{}}};
  const kv={async open(){return {
    async loadAll(){return copy(persisted);},
    async putRecord(table,id,value){persisted.tables[table][id]=copy(value);},
    async close(){},
  };}};
  const store=await PluginStore.open(kv),agents=new Map();
  for(const sessionId of ['ownSession','freshOwnSession','foreignSession'])agents.set(sessionId,{id:sessionId,session:{seq:9}});
  const operator={},policy=new PermissionPolicy(store,{agents,operatorPeer:operator}),human=policy.fromPeer(operator),nativeReads=[];
  const nativeHistory={header:{version:1},events:[7,8].map(seq=>({seq,type:'user/message',data:{content:[{type:'text',text:`Native source ${seq}`}]}}))};
  const adapter={isArchived:()=>false,context:{agents,sessions:{async flush(){}}},async readNative(sessionId){nativeReads.push(sessionId);return copy(nativeHistory);}};
  await store.transact(command('seed','test.seed'),draft=>{
    for(const botId of ['own','foreign'])draft.bots[botId]={botId,name:botId,role:'Test assistant',lifecycle:'active',revision:1,memoryRevision:0,share:defaultShare()};
    for(const sessionId of agents.keys())draft.sessions[sessionId]={sessionId,botId:sessionId==='foreignSession'?'foreign':'own',purpose:'contact',state:'ready',archived:false,origins:[]};
    draft.sessions.ownExecution={sessionId:'ownExecution',botId:'own',purpose:'execution',state:'ready',archived:false,origins:[]};
    draft.sessions.ordinaryEvidence={sessionId:'ordinaryEvidence',botId:null,purpose:'contact',state:'ready',archived:false,origins:[]};
    return null;
  });
  const knowledge=new KnowledgeController({store,policy,adapter}),memory=new MemoryController({store,policy,adapter,knowledge});
  const assistant=new AssistantController({store,policy,adapter,clock:{now:()=>Date.parse('2026-10-12T00:00:00Z')}});
  const service=new BotService({store,policy,adapter,knowledge,memory,assistant});
  t.after(async()=>{await service.close();await assistant.close();await store.close();});
  const actor=policy.fromAgent(agents.get('ownSession')),freshActor=policy.fromAgent(agents.get('freshOwnSession'));
  async function resultNotice(botId,label,{sourceSessionId}={}) {
    return store.transact(command(`result-${label}`,'test.result'),draft=>{
      const task={taskId:`task-${label}`,botId,title:label,state:'completed',acceptance:'passed',archived:false,version:1,currentAttemptId:`attempt-${label}`,source:{kind:'human'},origins:[]};
      const artifact={content:[{type:'text',text:`Result ${label}`}],source:sourceSessionId?{kind:'session',sessionId:sourceSessionId}:{kind:'human'},origins:sourceSessionId?[{kind:'session',id:sourceSessionId}]:[]};
      const attempt={attemptId:`attempt-${label}`,taskId:task.taskId,botId,sessionId:botId==='own'?'ownExecution':'foreignSession',epoch:1,state:'completed',resultOutboxId:`outbox-${label}`,result:artifact};
      const row={outboxId:attempt.resultOutboxId,kind:'result',botId,taskId:task.taskId,attemptId:attempt.attemptId,epoch:1,sessionId:botId==='own'?'ownSession':'foreignSession',state:'accepted'};
      draft.tasks[task.taskId]=task;draft.attempts[attempt.attemptId]=attempt;draft.outbox[row.outboxId]=row;
      return assistant.recordResultNoticeInDraft(draft,task,attempt,row);
    });
  }
  return {store,policy,human,actor,freshActor,knowledge,memory,assistant,service,nativeReads,resultNotice};
}

for(const action of ['notice.list','briefing','snapshot'])test(`${action} filters a foreign result notice while preserving own and human notices`,async t=>{
  const f=await fixture(t),own=await f.resultNotice('own','own'),foreign=await f.resultNotice('foreign','foreign'),before=f.store.read();
  assert.equal(f.policy.canRead(f.actor,{kind:'task',id:foreign.taskId}),true,'default foreign task sharing remains readonly');
  assert.equal(f.policy.canRead(f.actor,{kind:'notice',id:foreign.noticeId}),false);
  const result=await f.service.dispatch(f.actor,{action,input:{}});
  assert.deepEqual(noticeRows(action,result).map(row=>row.noticeId),[own.noticeId]);
  assert.equal(noticeRows(action,result)[0].previews[0].text,'Result own');
  const humanResult=await f.service.dispatch(f.human,{action,input:{}});
  assert.deepEqual(new Set(noticeRows(action,humanResult).map(row=>row.noticeId)),new Set([own.noticeId,foreign.noticeId]));
  const after=f.store.read();
  assert.deepEqual(after.notices,before.notices);
  assert.deepEqual(after.operations['result-foreign'],before.operations['result-foreign']);
  assert.deepEqual(after.attempts,before.attempts);
  assert.deepEqual(f.nativeReads,[],'notice reads do not access native history or start model work');
});

for(const action of ['notice.list','briefing','snapshot'])test(`${action} retains current source ACL checks after an evidence grant is revoked`,async t=>{
  const f=await fixture(t),plain=await f.resultNotice('own','plain'),guarded=await f.resultNotice('own','guarded',{sourceSessionId:'ordinaryEvidence'});
  const grant={grantId:'evidence-grant',ownerBotId:null,recipientBotId:'own',level:'read',scope:{sessions:['ordinaryEvidence']},active:true};
  await f.policy.authorizeShare(f.human,command('grant-evidence','grant.set',grant));
  const allowed=await f.service.dispatch(f.actor,{action,input:{}});
  assert.deepEqual(new Set(noticeRows(action,allowed).map(row=>row.noticeId)),new Set([plain.noticeId,guarded.noticeId]));
  assert.ok(f.policy.readDependencies(f.actor).some(ref=>ref.kind==='session'&&ref.id==='ordinaryEvidence'));
  const before=f.store.read();
  await f.policy.authorizeShare(f.human,command('revoke-evidence','grant.set',{...grant,active:false,expectedVersion:1}));
  assert.equal(f.policy.canRead(f.actor,{kind:'session',id:'ordinaryEvidence'}),false,'a held caller observes current revocation');
  assert.deepEqual(f.assistant.notices(f.actor).map(row=>row.noticeId),[plain.noticeId]);
  // Use the untouched own channel: the first channel consumed the revoked evidence.
  const restricted=await f.service.dispatch(f.freshActor,{action,input:{}});
  assert.deepEqual(noticeRows(action,restricted).map(row=>row.noticeId),[plain.noticeId]);
  assert.doesNotMatch(JSON.stringify(restricted),/Result guarded/);
  const humanResult=await f.service.dispatch(f.human,{action,input:{}});
  assert.ok(noticeRows(action,humanResult).some(row=>row.noticeId===guarded.noticeId));
  const after=f.store.read();
  assert.deepEqual(after.notices,before.notices);
  assert.deepEqual(after.attempts,before.attempts);
  assert.deepEqual(after.operations['result-guarded'],before.operations['result-guarded']);
});

test('a forgotten human operation does not block an automatic write from another human operation',async t=>{
  const f=await fixture(t),firstCommand=command('human-first','memory.write',{botId:'own',text:'First human fact'});
  const first=await f.service.dispatch(f.human,firstCommand);
  await f.service.dispatch(f.human,command('human-forget','memory.forget',{memoryId:first.memoryId,expectedVersion:first.version}));
  const before=f.store.read(),second=await f.service.dispatch(f.human,command('human-second','memory.write',{botId:'own',text:'Different human fact',automatic:true}));
  assert.equal(second.source.kind,'human');assert.equal(second.source.operationId,'human-second');
  assert.notEqual(second.memoryId,first.memoryId);
  assert.deepEqual(f.store.read().memories[first.memoryId],before.memories[first.memoryId]);
  assert.deepEqual(f.store.read().operations['human-first'],before.operations['human-first']);
  assert.deepEqual(await f.service.dispatch(f.human,firstCommand),first,'the exact original receipt is preserved');
  assert.equal(f.store.read().memories[first.memoryId].forgotten,true);
  assert.deepEqual(f.nativeReads,[]);
});

test('automatic Bot writes still reject the same forgotten native session and event',async t=>{
  const f=await fixture(t),source={sessionId:'ownSession',eventSeq:7};
  const first=await f.memory.write(f.actor,command('native-first','memory.write',{botId:'own',text:'Native fact',source,automatic:true}));
  await f.memory.forget(f.human,command('native-forget','memory.forget',{memoryId:first.memoryId,expectedVersion:first.version}));
  const before=f.store.read();
  await assert.rejects(f.memory.write(f.actor,command('native-repeat','memory.write',{botId:'own',text:'Native fact again',source,automatic:true})),{code:'forgotten_source'});
  assert.deepEqual(f.store.read(),before,'the rejected source cannot change rows or operation receipts');
  const next=await f.memory.write(f.actor,command('native-next','memory.write',{botId:'own',text:'Fact from another event',source:{...source,eventSeq:8},automatic:true}));
  assert.equal(next.source.eventSeq,8);
  assert.equal(f.store.read().memories[first.memoryId].forgotten,true);
  assert.deepEqual(f.store.read().operations['native-first'],before.operations['native-first']);
});
