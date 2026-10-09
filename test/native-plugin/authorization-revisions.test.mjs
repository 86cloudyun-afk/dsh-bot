import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';

test('native sharing rejects a stale expected Bot revision',async t=>{
  const f=await businessFixture(t),bot=await f.bot();
  await f.policy.authorizeShare(f.human,{operationId:'revoke-share',action:'share.set',input:{botId:bot.botId,expectedVersion:bot.revision,share:{enabled:false,receivers:[],scope:{}}}});
  await assert.rejects(f.policy.authorizeShare(f.human,{operationId:'stale-enable-share',action:'share.set',input:{botId:bot.botId,expectedVersion:bot.revision,share:bot.share}}),{code:'revision_conflict'});
  assert.equal(f.store.read().bots[bot.botId].share.enabled,false);
});

test('native grant changes reject stale versions and never persist the precondition',async t=>{
  const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B');
  const input={grantId:'grant',ownerBotId:a.botId,recipientBotId:b.botId,scope:{sessions:['*']},level:'control',active:true};
  const grant=await f.policy.authorizeShare(f.human,{operationId:'new-grant',action:'grant.set',input});
  const revoked=await f.policy.authorizeShare(f.human,{operationId:'revoke-grant',action:'grant.set',input:{...input,expectedVersion:grant.version,active:false}});
  await assert.rejects(f.policy.authorizeShare(f.human,{operationId:'stale-enable-grant',action:'grant.set',input:{...input,expectedVersion:grant.version}}),{code:'revision_conflict'});
  assert.equal(Object.hasOwn(revoked,'expectedVersion'),false);
  assert.equal(f.store.read().grants.grant.active,false);
});
