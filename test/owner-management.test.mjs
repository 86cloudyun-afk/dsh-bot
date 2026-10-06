import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Host} from '../src/host.mjs';
import {Ledger} from '../src/ledger.mjs';
import {digest,canonical} from '../src/errors.mjs';

function fixture(t,{isCurrent=()=>true,owner='synthetic-owner',epoch=1}={}) {
 const ledger=new Ledger(':memory:'),caller=Object.freeze({});
 const adapter={capabilities:()=>({}),sessionModeCatalog:()=>({domain:'agentPreset',status:'available',defaultId:'opaque/default',options:[{id:'opaque/default'},{id:' custom:creator/v2 '}]})};
 const host=new Host({ledger,ownerHumanId:owner,ownerCapability:caller,adapter});
 if(epoch!==1)ledger.put('grant','native-owner',{...ledger.get('grant','native-owner'),epoch});
 t.after(()=>ledger.close());
 const envelope=(command,payload,expectedRevision=null,expectedEpochs={})=>({operationId:randomUUID(),nonce:randomUUID(),command,ledgerInstanceId:host.ledgerInstanceId,payloadDigest:digest(payload),expectedRevision,expectedEpochs:{nativeOwner:epoch,...expectedEpochs},rootHumanInstructionRef:'synthetic-explicit-owner-input',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline:null});
 const controlSessionId=randomUUID(),payload={controlSessionId},openOptions={envelope:envelope('openControlSession',payload),payload,isCurrent};
 assert.equal(typeof host.openOwnedControlSession,'function','owner management Host.openOwnedControlSession must exist');
 const port=host.openOwnedControlSession(caller,openOptions);
 let state={revision:1,epoch:1};
 const call=(method,p,more={})=>{p={controlSessionId,...p};const names={selectExistingBot:'selectExistingBot',createBot:'createBot',query:'queryControlSession',dispose:'disposeControlSession'};
  const e={...envelope(names[method],p,state.revision,{control:state.epoch,...more.expectedEpochs}),...more};
  const receipt=port[method](e,p);state={revision:receipt.result.revision,epoch:receipt.result.epoch};return {e,p,receipt};};
 const legacy=(command,p,expectedRevision=null,expectedEpochs={})=>host.executeOwned(caller,envelope(command,p,expectedRevision,expectedEpochs),p);
 const create=(index=0)=>call('createBot',{name:`Bot ${index}`,config:{contact:{provider:`provider-${index}`,model:`contact-${index}`,reasoning:index%2?'low':'high'},execution:{provider:`executor-${index}`,model:`execution-${index}`,reasoning:null},agentPreset:index%2?' custom:creator/v2 ':'opaque/default'}});
 const query=(bots,taskIds=[])=>call('query',{botIds:bots.map(b=>b.botId),taskIds},{expectedEpochs:{control:state.epoch,nativeOwner:epoch,...Object.fromEntries(bots.map(b=>[`bot:${b.botId}`,b.epoch]))}});
 return {ledger,caller,host,port,controlSessionId,openOptions,envelope,call,legacy,create,query,get state(){return state;}};
}

test('select existing A then create B captures independent exact config refs without creating A again',t=>{
 const f=fixture(t),a=f.legacy('createBot',{name:'Existing A',config:{contact:{provider:'A',model:'a',reasoning:'high'},execution:{provider:'AE',model:'ae',reasoning:'off'},agentPreset:' custom:creator/v2 '}}).result;
 const count=f.ledger.list('bot').length;
 const selected=f.call('selectExistingBot',{botId:a.botId,expectedBotRevision:a.revision},{expectedEpochs:{control:1,nativeOwner:1,bot:a.epoch}});
 assert.equal(selected.receipt.result.bot.botId,a.botId);assert.equal(f.ledger.list('bot').length,count);
 const made=f.create(2),b=made.receipt.result.bot;assert.notEqual(a.botId,b.botId);assert.notEqual(a.configVersion,b.configVersion);
 const q=f.query([a,b]).receipt.result;assert.equal(q.memberCount,2);assert.equal(q.selectedBotId,b.botId);
 assert.deepEqual(q.bot.map(x=>x.config),[{contact:{provider:'A',model:'a',reasoning:'high'},execution:{provider:'AE',model:'ae',reasoning:'off'},agentPreset:' custom:creator/v2 '},{contact:{provider:'provider-2',model:'contact-2',reasoning:'high'},execution:{provider:'executor-2',model:'execution-2',reasoning:null},agentPreset:'opaque/default'}]);
 assert.deepEqual(Object.keys(q.bot[0]).sort(),['botId','config','configVersion','epoch','lifecycle','name','readiness','revision'].sort());
 assert.equal(f.ledger.get('bot',b.botId).nativeStatus,'unsupported');assert.equal(f.ledger.get('bot',b.botId).contactSessionId,null);
 assert.ok(Object.isFrozen(f.port));assert.deepEqual(Object.keys(f.port).sort(),['controlSessionId','selectExistingBot','createBot','query','dispose'].sort());
});

for(const n of [2,10,50])test(`bounded N=${n} growth keeps first/middle/last identities and exact field isolation`,t=>{
 const f=fixture(t),bots=Array.from({length:n},(_,i)=>f.create(i).receipt.result.bot),before=bots.map(b=>f.ledger.get('config',b.configVersion));
 const indexes=[...new Set([0,Math.floor(n/2),n-1])],q=f.query(indexes.map(i=>bots[i])).receipt.result;
 assert.equal(q.memberCount,n);assert.equal(new Set(bots.map(b=>b.botId)).size,n);assert.equal(new Set(bots.map(b=>b.configVersion)).size,n);
 for(let j=0;j<indexes.length;j++){const i=indexes[j];assert.equal(q.bot[j].botId,bots[i].botId);assert.equal(q.bot[j].configVersion,bots[i].configVersion);assert.deepEqual(q.bot[j].config,{contact:before[i].contact,execution:before[i].execution,agentPreset:before[i].agentPreset});}
 for(let i=0;i<n;i++)assert.deepEqual(f.ledger.get('config',bots[i].configVersion),before[i]);
});

test('canonical replay survives its own revision increment and adds no Bot or member',t=>{
 const f=fixture(t),created=f.create(),r=created.receipt,b=r.result.bot;
 assert.deepEqual(f.port.createBot(created.e,created.p),r);assert.equal(f.ledger.list('bot').length,1);
 const selected=f.call('selectExistingBot',{botId:b.botId,expectedBotRevision:b.revision},{expectedEpochs:{control:1,nativeOwner:1,bot:b.epoch}});
 assert.deepEqual(f.port.selectExistingBot(selected.e,selected.p),selected.receipt);
 const q=f.query([b]);assert.deepEqual(f.port.query(q.e,q.p),q.receipt);assert.equal(f.ledger.get('control',f.controlSessionId).revision,3);
 const different={...created.p,name:'Changed'};assert.throws(()=>f.port.createBot({...created.e,payloadDigest:digest(different)},different),{code:'nonce_conflict'});
 assert.throws(()=>f.port.createBot({...created.e,nonce:randomUUID()},created.p),{code:'operation_conflict'});
 assert.equal(f.ledger.list('bot').length,1);assert.equal(f.ledger.get('control',f.controlSessionId).revision,3);
 const again=f.host.openOwnedControlSession(f.caller,f.openOptions);assert.equal(again.controlSessionId,f.controlSessionId);
});

test('new management commands cannot bypass retained port through execute or executeOwned',t=>{
 const f=fixture(t),b=f.create().receipt.result.bot,p={controlSessionId:f.controlSessionId,botIds:[b.botId],taskIds:[]};
 for(const command of ['openControlSession','selectExistingBot','queryControlSession','disposeControlSession','createBot']) {
  const e=f.envelope(command,p,f.state.revision,{control:1});
  assert.throws(()=>f.host.executeOwned(f.caller,e,p),{code:'unsupported_host_identity'});
  assert.throws(()=>f.host.execute({kind:'human',id:'synthetic-owner'},{...e,authorizationRef:'root'},p));
  const handler=f.host.commands[command];if(handler)assert.throws(()=>handler.call(f.host,p,e,{kind:'host',id:f.host.ledgerInstanceId}),{code:'unsupported_host_identity'});
 }
 assert.equal(f.ledger.list('bot').length,1);assert.equal(f.ledger.get('control',f.controlSessionId).state,'open');
});

test('wrong Host/caller/owner IDs and serialized actors cannot acquire management',t=>{
 const f=fixture(t),g=fixture(t,{owner:'other-owner'}),p={controlSessionId:randomUUID()};
 assert.throws(()=>f.host.openOwnedControlSession({}, {...f.openOptions,payload:p}),{code:'unsupported_host_identity'});
 assert.throws(()=>f.host.openOwnedControlSession(f.caller,{...f.openOptions,envelope:{...f.openOptions.envelope,ledgerInstanceId:g.host.ledgerInstanceId}}),{code:'ledger_identity_conflict'});
 const b=g.create().receipt.result.bot;
 assert.throws(()=>f.call('selectExistingBot',{botId:b.botId,expectedBotRevision:b.revision},{expectedEpochs:{control:1,nativeOwner:1,bot:1}}),{code:'not_found'});
 assert.throws(()=>f.port.query(f.envelope('queryControlSession',{controlSessionId:g.controlSessionId,botIds:[],taskIds:[]},1,{control:1}),{controlSessionId:g.controlSessionId,botIds:[],taskIds:[]}),{code:'control_identity_conflict'});
 const made=f.create(),foreign={...made.e,authorizationRef:'root'};assert.throws(()=>f.port.createBot(foreign,made.p),{code:'unauthorized'});
});

for(const mode of ['false','throw','async','async-reject'])test(`owner lifetime ${mode} denial permanently fences port before cached replay`,t=>{
 let healthy=true;const isCurrent=()=>{if(healthy)return true;if(mode==='throw')throw Error('sanitized fixture');if(mode==='async')return Promise.resolve(true);if(mode==='async-reject')return Promise.reject(Error('sanitized async fixture'));return false;};
 const f=fixture(t,{isCurrent}),made=f.create();healthy=false;
 assert.throws(()=>f.port.createBot(made.e,made.p),{code:'unauthorized'});healthy=true;
 assert.throws(()=>f.port.createBot(made.e,made.p),{code:'control_session_fenced'});assert.equal(f.ledger.list('bot').length,1);
});

test('grant epoch invalidation stays fenced after grant is restored and before cached replay',t=>{
 const f=fixture(t,{epoch:7}),made=f.create(),grant=f.ledger.get('grant','native-owner');f.ledger.put('grant','native-owner',{...grant,epoch:8});
 assert.throws(()=>f.port.createBot(made.e,made.p),{code:'unauthorized'});f.ledger.put('grant','native-owner',grant);
 assert.throws(()=>f.port.createBot(made.e,made.p),{code:'control_session_fenced'});assert.equal(f.ledger.list('bot').length,1);
});

test('revoke fences query replay; target epoch/config changes refuse cached query until explicit reselect',t=>{
 const f=fixture(t),b=f.create().receipt.result.bot,q=f.query([b]),old=f.ledger.get('config',b.configVersion);
 const updated=f.legacy('updateBotConfig',{botId:b.botId,config:{contact:{provider:'updated',model:'new'},agentPreset:null}},b.revision,{bot:b.epoch}).result;
 assert.throws(()=>f.port.query(q.e,q.p),{code:'configuration_conflict'});assert.deepEqual(f.ledger.get('config',b.configVersion),old);
 const selected=f.call('selectExistingBot',{botId:b.botId,expectedBotRevision:updated.revision},{expectedEpochs:{control:1,nativeOwner:1,bot:b.epoch}});
 assert.equal(selected.receipt.result.bot.botId,b.botId);assert.equal(f.ledger.list('bot').length,1);assert.throws(()=>f.port.query(q.e,q.p),{code:'revision_conflict'});assert.equal(f.query([updated]).receipt.result.bot[0].config.agentPreset,null);
 const archived=f.legacy('archive',{kind:'bot',id:b.botId},updated.revision,{bot:b.epoch}).result;
 assert.throws(()=>f.port.query(q.e,q.p),{code:'epoch_conflict'});assert.equal(archived.epoch,2);
 const grant=f.ledger.get('grant','native-owner');f.ledger.put('grant','native-owner',{...grant,active:false});assert.throws(()=>f.port.query(q.e,q.p),{code:'unauthorized'});
});

test('query refuses unknown/nonmember/duplicate/oversize IDs and foreign tasks as a whole',t=>{
 const f=fixture(t),b=f.create().receipt.result.bot,other=f.legacy('createBot',{name:'nonmember',config:{contact:{provider:'x',model:'x'}}}).result;
 for(const [ids,code] of [[[randomUUID()],'not_found'],[Array.from({length:500},()=>randomUUID()),'not_found'],[[other.botId],'unauthorized'],[[b.botId,b.botId],'invalid_read_scope'],[Array.from({length:501},()=>randomUUID()),'invalid_read_scope']]){
  const p={controlSessionId:f.controlSessionId,botIds:ids,taskIds:[]},e=f.envelope('queryControlSession',p,f.state.revision,{control:1,...Object.fromEntries(ids.map(id=>[`bot:${id}`,1]))});
  assert.throws(()=>f.port.query(e,p),{code});
 }
 const task=f.legacy('createTask',{ownerBotId:other.botId,title:'foreign membership task',scope:{namespace:'synthetic-other',writeResources:[]},acceptance:'inert'}).result;
 assert.throws(()=>f.query([b],[task.taskId]),{code:'unauthorized'});
 assert.deepEqual(f.query([b]).receipt.result.task,[]);
});

test('query task ownership and stopped native attempt stay exact and unsupported',t=>{
 const f=fixture(t),a=f.create(0).receipt.result.bot,b=f.create(1).receipt.result.bot;
 const makeTask=(bot,index)=>f.legacy('createTask',{ownerBotId:bot.botId,title:`Task ${index}`,scope:{namespace:`synthetic/${index}`,writeResources:[]},acceptance:'inert'}).result;
 const at=makeTask(a,0),bt=makeTask(b,1),attempt=f.legacy('startAttempt',{taskId:at.taskId},at.revision,{task:at.epoch}).result;
 assert.equal(attempt.execution,'queued');assert.equal(attempt.sessionId,null);assert.equal(attempt.runGeneration,null);assert.ok(attempt.blockers.some(x=>x.code==='unsupported'));
 assert.deepEqual(attempt.configSnapshot.contact,a.config.contact);assert.deepEqual(attempt.configSnapshot.execution,a.config.execution);assert.equal(attempt.configSnapshot.agentPreset,a.config.agentPreset);
 const summary=f.query([a,b],[at.taskId,bt.taskId]).receipt.result;assert.deepEqual(summary.task.map(x=>x.ownerBotId),[a.botId,b.botId]);
 assert.equal(Object.hasOwn(summary.task[0],'scope'),false);
});

test('invalid revisions/epochs/digest/deadline and modes roll back complete writes',t=>{
 const f=fixture(t),base=f.create(),b=base.receipt.result.bot,counts=()=>[f.ledger.list('bot').length,f.ledger.list('config').length,f.ledger.list('conversation').length,f.ledger.db.prepare('SELECT count(*) AS n FROM operations').get().n],before=counts();
 const p={controlSessionId:f.controlSessionId,name:'bad',config:{contact:{provider:'x',model:'x'}}},e=f.envelope('createBot',p,f.state.revision,{control:1});
 for(const [change,code] of [[{expectedRevision:999},'revision_conflict'],[{expectedEpochs:{nativeOwner:1,control:999}},'epoch_conflict'],[{payloadDigest:'bad'},'payload_digest_conflict'],[{deadline:'2020-01-01T00:00:00Z'},'deadline_expired']])assert.throws(()=>f.port.createBot({...e,...change},p),{code});
 const mode={...p,config:{...p.config,executionMode:'native'}};assert.throws(()=>f.port.createBot({...e,payloadDigest:digest(mode)},mode),{code:'invalid_config'});
 const plan={...p,config:{...p.config,sessionModes:{plan:'on',permissions:null}}};assert.throws(()=>f.port.createBot({...e,payloadDigest:digest(plan)},plan),{code:'unsupported_session_mode'});
 assert.throws(()=>f.call('selectExistingBot',{botId:b.botId,expectedBotRevision:999},{expectedEpochs:{control:1,nativeOwner:1,bot:1}}),{code:'revision_conflict'});assert.deepEqual(counts(),before);
});

test('returned and supplied mutable objects cannot replace stored config references',t=>{
 const f=fixture(t),r=f.create(),b=r.receipt.result.bot,original=f.ledger.get('config',b.configVersion);b.config.contact.model='tampered';r.p.config.execution.provider='tampered';
 const q=f.query([b]).receipt.result;assert.deepEqual(q.bot[0].config,{contact:original.contact,execution:original.execution,agentPreset:original.agentPreset});q.bot[0].config.agentPreset='tampered';
 assert.deepEqual(f.ledger.get('config',b.configVersion),original);assert.equal(f.query([b]).receipt.result.bot[0].config.agentPreset,original.agentPreset);
});

test('dispose is terminal and changes no Bot/task/config/native rows',t=>{
 const f=fixture(t),made=f.create(),b=made.receipt.result.bot,q=f.query([b]),before=canonical({bot:f.ledger.list('bot'),config:f.ledger.list('config'),conversation:f.ledger.list('conversation'),task:f.ledger.list('task'),attempt:f.ledger.list('attempt')});
 const disposed=f.call('dispose',{});assert.equal(disposed.receipt.result.state,'disposed');assert.equal(disposed.receipt.result.epoch,2);
 assert.throws(()=>f.port.query(q.e,q.p),{code:'control_session_disposed'});assert.throws(()=>f.port.createBot(made.e,made.p),{code:'control_session_disposed'});assert.throws(()=>f.port.dispose(disposed.e,disposed.p),{code:'control_session_disposed'});
 assert.throws(()=>f.host.openOwnedControlSession(f.caller,f.openOptions),{code:'control_session_disposed'});
 assert.equal(canonical({bot:f.ledger.list('bot'),config:f.ledger.list('config'),conversation:f.ledger.list('conversation'),task:f.ledger.list('task'),attempt:f.ledger.list('attempt')}),before);
});


test('same ledger owner and caller on another Host cannot adopt an existing control identity',t=>{
 const f=fixture(t),b=f.create().receipt.result.bot,other=new Host({ledger:f.ledger,ownerHumanId:'synthetic-owner',ownerCapability:f.caller,adapter:f.host.adapter});
 assert.equal(other.ledgerInstanceId,f.host.ledgerInstanceId);
 assert.throws(()=>other.openOwnedControlSession(f.caller,f.openOptions),{code:'unsupported_host_identity'});
 const payload={controlSessionId:randomUUID()},e=f.envelope('openControlSession',payload);
 const fresh=other.openOwnedControlSession(f.caller,{envelope:e,payload});assert.notEqual(fresh.controlSessionId,f.controlSessionId);
 assert.equal(f.query([b]).receipt.result.memberCount,1);
});


test('a readonly port or serialized owner identity cannot acquire a control port',t=>{
 const f=fixture(t),readPort=f.host.createOwnedBotTaskReadPort(f.caller);
 for(const caller of [readPort,{kind:'host',id:f.host.ledgerInstanceId},{kind:'human',id:'synthetic-owner'},'synthetic-owner'])assert.throws(()=>f.host.openOwnedControlSession(caller,f.openOptions),{code:'unsupported_host_identity'});
 assert.deepEqual(readPort.snapshot({botIds:[],taskIds:[]}),{bot:[],task:[]});
});
