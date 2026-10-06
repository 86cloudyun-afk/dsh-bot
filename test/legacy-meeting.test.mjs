import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture,createBot,human } from './helpers.mjs';
import { Host } from '../src/host.mjs';
import { Ledger } from '../src/ledger.mjs';
import { digest } from '../src/errors.mjs';

function command(f,name,payload,revision=null) {
  if(name==='startMeeting') revision=f.ledger.get('group',payload.groupId).revision;
  return f.host.execute(human,{operationId:randomUUID(),nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision:revision,expectedEpochs:{},rootHumanInstructionRef:'test-human-input',authorizationRef:'root',createdAt:new Date().toISOString(),deadline:null},payload).result;
}
function persistedMeeting(edit,opinionIndex=0) {
  const f=fixture(),bots=['A','B'].map(name=>createBot(f,name));
  const group=f.cmd('createGroup',{name:'G',namespace:'P',members:bots.map(b=>b.botId),coordinatorBotId:bots[0].botId}).result;
  let meeting=f.cmd('startMeeting',{groupId:group.groupId,topic:'persisted meeting',materials:[],maxOpinions:2}).result;
  f.cmd('submitOpinion',{meetingId:meeting.meetingId,botId:bots[opinionIndex].botId,content:'sealed opinion'},meeting.revision);
  meeting=f.ledger.get('meeting',meeting.meetingId);
  // Exact participant shape serialized by the old schema-1 startMeeting.
  for(const p of Object.values(meeting.participants)) delete p.botEpoch;
  if(edit) edit(meeting,bots);
  f.ledger.transaction(()=>f.ledger.put('meeting',meeting.meetingId,meeting));
  assert.equal(f.ledger.db.prepare('PRAGMA user_version').get().user_version,1);
  f.ledger.close();
  f.ledger=new Ledger(f.path);
  f.host=new Host({ledger:f.ledger,ownerHumanId:human.id});
  assert.deepEqual(f.ledger.get('meeting',meeting.meetingId),meeting);
  return {...f,bots,group,meeting};
}
function stored(f) {
  return {
    objects:f.ledger.db.prepare('SELECT kind,id,value FROM objects ORDER BY kind,id').all(),
    operations:f.ledger.db.prepare('SELECT id,actor,nonce,binding,receipt FROM operations ORDER BY id').all(),
    observations:f.ledger.db.prepare('SELECT event_id,source,source_seq,value FROM observations ORDER BY event_id').all(),
    view:f.host.publicMeeting(f.meeting.meetingId),
  };
}
function unchangedReject(f,name,payload,code) {
  const before=stored(f);
  assert.throws(()=>command(f,name,payload,f.meeting.revision),{code});
  assert.deepEqual(stored(f),before,'Rejected command must preserve every record and read-only meeting view');
}
function migrationRequired(f,bot=f.bots[1]) {
  unchangedReject(f,'submitOpinion',{meetingId:f.meeting.meetingId,botId:bot.botId,content:'new opinion'},'migration_required');
  unchangedReject(f,'revealOpinions',{meetingId:f.meeting.meetingId},'migration_required');
  const m=f.ledger.get('meeting',f.meeting.meetingId);
  assert.equal(m.stage,'independent');
  assert.equal(m.revision,f.meeting.revision);
  assert.equal(m.opinions.length,1);
  assert.equal(m.opinions[0].sealed,true);
}

test('persisted legacy meeting requires migration without changing active obligations or sealed opinions',()=>{
  const f=persistedMeeting();
  try {
    for(const b of f.bots) assert.equal(f.ledger.get('bot',b.botId).epoch,1);
    migrationRequired(f);
  } finally {f.ledger.close();}
});
test('persisted legacy meeting remains migration required after archive restore without epoch backfill',()=>{
  const f=persistedMeeting();
  try {
    const b=f.bots[1],archived=command(f,'archive',{kind:'bot',id:b.botId},b.revision);
    const restored=command(f,'restore',{kind:'bot',id:b.botId},archived.revision);
    assert.equal(restored.epoch,3);
    migrationRequired(f,restored);
    assert.ok(Object.values(f.ledger.get('meeting',f.meeting.meetingId).participants).every(p=>!Object.hasOwn(p,'botEpoch')));
  } finally {f.ledger.close();}
});
test('one legacy participant blocks submit for another participant with a valid stored epoch',()=>{
  const f=persistedMeeting((m,b)=>{m.participants[b[0].botId].botEpoch=1;},1);
  try {migrationRequired(f,f.bots[0]);} finally {f.ledger.close();}
});
for(const [label,value] of [['null',null],['string','1'],['zero',0],['negative',-1],['fraction',1.5],['unsafe',Number.MAX_SAFE_INTEGER+1]]) {
  test(`persisted ${label} participant epoch requires migration before submit or reveal`,()=>{
    const f=persistedMeeting((m,b)=>{for(const p of Object.values(m.participants)) p.botEpoch=1;m.participants[b[1].botId].botEpoch=value;});
    try {migrationRequired(f);} finally {f.ledger.close();}
  });
}
test('persisted null participant requires migration before submit or reveal',()=>{
  const f=persistedMeeting((m,b)=>{m.participants[b[0].botId].botEpoch=1;m.participants[b[1].botId]=null;},1);
  try {migrationRequired(f,f.bots[0]);} finally {f.ledger.close();}
});
test('persisted scalar participant requires migration before submit or reveal',()=>{
  const f=persistedMeeting((m,b)=>{m.participants[b[0].botId].botEpoch=1;m.participants[b[1].botId]=7;},1);
  try {migrationRequired(f,f.bots[0]);} finally {f.ledger.close();}
});
test('fresh meeting renews obligations at current epochs without repairing the legacy meeting',()=>{
  const f=persistedMeeting();
  try {
    const old=f.ledger.get('meeting',f.meeting.meetingId);
    let m=command(f,'startMeeting',{groupId:f.group.groupId,topic:'fresh obligations',materials:[],maxOpinions:2});
    assert.notEqual(m.meetingId,old.meetingId);
    for(const b of f.bots) {
      assert.equal(m.participants[b.botId].botEpoch,f.ledger.get('bot',b.botId).epoch);
      assert.notEqual(m.participants[b.botId].obligationId,old.participants[b.botId].obligationId);
      command(f,'submitOpinion',{meetingId:m.meetingId,botId:b.botId,content:'valid new opinion'},m.revision);
      m=f.ledger.get('meeting',m.meetingId);
    }
    const result=command(f,'revealOpinions',{meetingId:m.meetingId},m.revision);
    assert.equal(result.opinions.length,2);
    assert.deepEqual(result.missing,[]);
    assert.deepEqual(f.ledger.get('meeting',old.meetingId),old);
  } finally {f.ledger.close();}
});
test('valid stored epoch mismatch retains membership revoked and existing reveal policy',()=>{
  const f=persistedMeeting((m,b)=>{for(const p of Object.values(m.participants)) p.botEpoch=1;m.participants[b[1].botId].botEpoch=2;});
  try {
    unchangedReject(f,'submitOpinion',{meetingId:f.meeting.meetingId,botId:f.bots[1].botId,content:'stale epoch opinion'},'membership_revoked');
    const result=command(f,'revealOpinions',{meetingId:f.meeting.meetingId},f.meeting.revision);
    assert.equal(result.opinions.length,1);
    assert.deepEqual(result.missing,[{botId:f.bots[1].botId,reason:'revoked'}]);
  } finally {f.ledger.close();}
});
