import test from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter } from '../src/adapter.mjs';
import * as modes from '../src/session-mode.mjs';
import { fixture,createBot,createTask,human } from './helpers.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Host } from '../src/host.mjs';

const opaque=' custom:creator/v2 ';
const healthy=()=>[{id:opaque,name:'创造',description:'Custom composition',plugins:['not public']},{id:'cordis',broken:'not selectable'}];
function adapter(rows=healthy(),defaultId=opaque) { return new DshAdapter({agentPresets:{list:async()=>rows,defaultId}}); }
async function refresh(a) { assert.equal(typeof a.refreshSessionModeCatalog,'function','explicit live metadata refresh required');return a.refreshSessionModeCatalog(); }
function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }

test('healthy dynamic catalog preserves custom opaque identity and only public display metadata',async()=>{
 const a=adapter(),c=await refresh(a);
 assert.equal(c.domain,'agentPreset');assert.equal(c.status,'available');
 assert.deepEqual(c.options,[{id:opaque,name:'创造',description:'Custom composition',isDefault:true}]);
 assert.equal(c.defaultId,opaque);assert.equal(JSON.stringify(c).includes('not public'),false);
 assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(c.options));assert.ok(Object.isFrozen(c.options[0]));
 assert.throws(()=>{c.options[0].id='cordis';},TypeError);
});
test('missing native registry offers no static four-mode substitute',async()=>{
 const a=new DshAdapter(),c=await refresh(a);assert.equal(c.status,'unsupported');assert.deepEqual(c.options,[]);assert.equal(c.defaultId,null);
});
test('broken default cannot become a healthy default fallback',async()=>{
 const c=await refresh(adapter(healthy(),'cordis'));assert.equal(c.defaultId,null);assert.equal(c.options[0].isDefault,false);
});
test('malformed or duplicate roster identities fail closed without partial options',async()=>{
 for(const rows of [[{id:'a'},{id:'a'}],[{id:' '}],[null],[{id:'a',name:42}],{},[{id:'a',description:{}}]]) {
  const c=await refresh(adapter(rows,'a'));assert.equal(c.status,'unavailable');assert.deepEqual(c.options,[]);
 }
});
test('failed refresh invalidates previously usable catalog without returning host diagnostics',async()=>{
 const a=adapter();await refresh(a);a.context.agentPresets.list=async()=>{throw Error('host diagnostic must stay private');};
 const c=await refresh(a);assert.equal(c.status,'unavailable');assert.deepEqual(c.options,[]);assert.equal(JSON.stringify(c).includes('host diagnostic'),false);
});
test('latest failed refresh prevents older success from publishing stale choices',async()=>{
 const a=adapter(),first=deferred(),second=deferred();let n=0;
 a.context.agentPresets.list=()=>++n===1?first.promise:second.promise;
 const old=refresh(a),latest=refresh(a);assert.deepEqual(a.sessionModeCatalog().options,[]);
 second.reject(Error('unavailable'));await latest;first.resolve(healthy());await old;
 assert.equal(a.sessionModeCatalog().status,'unavailable');assert.deepEqual(a.sessionModeCatalog().options,[]);
});
test('older failed refresh cannot erase the newer successful roster',async()=>{
 const a=adapter(),first=deferred(),second=deferred();let n=0;
 a.context.agentPresets.list=()=>++n===1?first.promise:second.promise;
 const old=refresh(a),latest=refresh(a);second.resolve([{id:'new',name:'创造'}]);await latest;first.reject(Error('old'));await old;
 assert.equal(a.sessionModeCatalog().status,'available');assert.deepEqual(a.sessionModeCatalog().options.map(x=>x.id),['new']);
});
test('registry replacement while metadata is pending cannot publish the retired roster',async()=>{
 const a=adapter(),read=deferred();a.context.agentPresets.list=()=>read.promise;const pending=refresh(a);
 a.context.agentPresets={list:async()=>[{id:'replacement'}],defaultId:'replacement'};read.resolve(healthy());await pending;
 assert.equal(a.sessionModeCatalog().status,'unavailable');assert.deepEqual(a.sessionModeCatalog().options,[]);
});
test('Cordis traceable wrappers preserve service identity without using proxy reference equality',async()=>{
 const tracker=Symbol.for('cordis.tracker'),service={[tracker]:{},list:async()=>healthy(),defaultId:opaque};
 const context={get agentPresets(){return new Proxy(service,{});}},a=new DshAdapter(context);
 assert.notEqual(context.agentPresets,context.agentPresets);assert.equal((await refresh(a)).status,'available');
 assert.equal(a.sessionModeCatalog().defaultId,opaque);assert.equal(a.sessionModeCatalog().status,'available');
});
test('replacement of a traced native service invalidates pending and cached catalogs',async()=>{
 const tracker=Symbol.for('cordis.tracker'),pending=deferred();let service={[tracker]:{},list:()=>pending.promise,defaultId:opaque};
 const a=new DshAdapter({get agentPresets(){return new Proxy(service,{});}}),reading=a.refreshSessionModeCatalog();
 service={[tracker]:{},list:async()=>[{id:'replacement'}],defaultId:'replacement'};pending.resolve(healthy());await reading;
 assert.equal(a.sessionModeCatalog().status,'unavailable');assert.equal((await refresh(a)).defaultId,'replacement');
 service={[tracker]:{},list:async()=>[],defaultId:undefined};assert.equal(a.sessionModeCatalog().status,'unavailable');
});

test('create preflight explicitly resolves opaque or default ID but never performs native writes',async()=>{
 const a=adapter(),catalog=await refresh(a);assert.equal(typeof modes.prepareSessionCreate,'function');
 for(const id of [opaque,null]) {
  const result=modes.prepareSessionCreate({cwd:'/isolated/example',agentPreset:id},catalog);
  assert.equal(result.status,'blocked');assert.deepEqual(result.request,{cwd:'/isolated/example',agentPreset:opaque});
  assert.equal(result.blockers.includes('mode_revision_unavailable'),false);assert.equal(result.permit,undefined);assert.ok(Object.isFrozen(result.request));
 }
 assert.throws(()=>modes.prepareSessionCreate({cwd:'/isolated/example',agentPreset:'standard'},catalog),{code:'agent-preset/not-found'});
 assert.throws(()=>modes.prepareSessionCreate({cwd:'/isolated/example'},a.sessionModeCatalog().status==='available'?{...catalog,defaultId:null}:null),{code:'agent-preset/not-found'});
 assert.throws(()=>modes.prepareSessionCreate({cwd:'/isolated/example',agentPreset:opaque},{status:'unavailable',options:[]}),{code:'unsupported_session_mode'});
});
test('current preset reads client projection and refuses wire or header fallback',()=>{
 assert.equal(typeof modes.readSessionAgentPreset,'function');
 assert.equal(modes.readSessionAgentPreset({projectionValues:{agentPreset:opaque},header:{agentPreset:'standard'}}),opaque);
 assert.equal(modes.readSessionAgentPreset({projectionValues:{agentPreset:null}}),null);
 for(const summary of [{header:{agentPreset:opaque}},{sessionId:'wire',projections:{values:{agentPreset:opaque}}},{projectionValues:{}}])
  assert.throws(()=>modes.readSessionAgentPreset(summary),{code:'mode_projection_unavailable'});
});
test('blank selection prepares exact identity while started client session returns native lock code',async()=>{
 const catalog=await refresh(adapter());assert.equal(typeof modes.prepareBlankPresetSelection,'function');
 const summary={id:'session-one',blank:true,projectionValues:{agentPreset:'old'}};
 const result=modes.prepareBlankPresetSelection(summary,opaque,catalog);
 assert.equal(result.status,'blocked');assert.deepEqual(result.request,{sessionId:'session-one',agentPreset:opaque});
 assert.equal(result.blockers.includes('mode_revision_unavailable'),false);
 assert.throws(()=>modes.prepareBlankPresetSelection({...summary,blank:false},opaque,catalog),{code:'agent-preset/locked'});
});
test('healthy custom mode persists separately from model plan and permissions',async()=>{
 const a=adapter(),f=fixture(a);await refresh(a);const route={provider:'synthetic',model:'model-A'};
 const b=f.cmd('createBot',{name:'custom',config:{contact:route,agentPreset:opaque}}).result;
 const cfg=f.ledger.get('config',b.configVersion);assert.equal(cfg.agentPreset,opaque);assert.deepEqual(cfg.sessionModes,{plan:null,permissions:null});assert.equal(cfg.contact.model,'model-A');
 f.ledger.close();
});
test('explicit mode selection requires cached healthy roster and rejects unknown identity',async()=>{
 const a=adapter(),f=fixture(a),route={provider:'synthetic',model:'model-A'};
 assert.throws(()=>f.cmd('createBot',{name:'blocked',config:{contact:route,agentPreset:opaque}}),{code:'unsupported_session_mode'});
 await refresh(a);
 for(const id of ['cordis','standard'])assert.throws(()=>f.cmd('createBot',{name:'blocked',config:{contact:route,agentPreset:id}}),{code:'agent-preset/not-found'});
 assert.equal(f.ledger.list('bot').length,0);assert.equal(f.ledger.list('config').length,0);f.ledger.close();
});
test('omitted model update preserves mode and old snapshots while explicit null changes future config only',async()=>{
 const a=adapter(),f=fixture(a);await refresh(a);const b=f.cmd('createBot',{name:'custom',config:{contact:{provider:'synthetic',model:'A'},agentPreset:opaque}}).result;
 const original=f.ledger.get('config',b.configVersion),task=createTask(f,b),attempt=f.cmd('startAttempt',{taskId:task.taskId},task.revision).result;
 a.context.agentPresets.list=async()=>{throw Error('unavailable');};await refresh(a);
 const next=f.cmd('updateBotConfig',{botId:b.botId,config:{contact:{provider:'synthetic',model:'B'}}},b.revision).result;
 assert.equal(f.ledger.get('config',next.configVersion).agentPreset,opaque);assert.deepEqual(f.ledger.get('config',b.configVersion),original);assert.deepEqual(f.ledger.get('attempt',attempt.attemptId).configSnapshot,original);
 const cleared=f.cmd('updateBotConfig',{botId:b.botId,config:{contact:{provider:'synthetic',model:'B'},agentPreset:null}},next.revision).result;
 assert.equal(f.ledger.get('config',cleared.configVersion).agentPreset,null);assert.equal(f.ledger.get('config',next.configVersion).agentPreset,opaque);f.ledger.close();
});
test('legacy missing mode remains unchanged on reopen and new version normalizes only after explicit update',()=>{
 const f=fixture(),b=createBot(f),stored=f.ledger.get('config',b.configVersion);
 delete stored.agentPreset;f.ledger.db.prepare('UPDATE objects SET value=? WHERE kind=? AND id=?').run(JSON.stringify(stored),'config',b.configVersion);
 const before=f.ledger.db.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get('config',b.configVersion).value;
 const receipt=f.ledger.db.prepare('SELECT receipt FROM operations ORDER BY rowid LIMIT 1').get().receipt;
 f.ledger.close();const ledger=new Ledger(f.path),host=new Host({ledger,ownerHumanId:human.id});host.snapshot(human);
 assert.equal(ledger.db.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get('config',b.configVersion).value,before);
 assert.equal(ledger.db.prepare('SELECT receipt FROM operations ORDER BY rowid LIMIT 1').get().receipt,receipt);
 assert.equal(ledger.db.prepare('PRAGMA user_version').get().user_version,1);ledger.close();
 const g=fixture(),legacy=createBot(g);const c=g.ledger.get('config',legacy.configVersion);delete c.agentPreset;g.ledger.db.prepare('UPDATE objects SET value=? WHERE kind=? AND id=?').run(JSON.stringify(c),'config',legacy.configVersion);
 const next=g.cmd('updateBotConfig',{botId:legacy.botId,config:{contact:c.contact}},legacy.revision).result;
 assert.equal(g.ledger.get('config',next.configVersion).agentPreset,null);assert.equal(Object.hasOwn(g.ledger.get('config',legacy.configVersion),'agentPreset'),false);g.ledger.close();
});
test('trusted mode read is separate from native capability verification and rejects spoofed actor',async()=>{
 const a=adapter(),f=fixture(a);let calls=0;a.context.agentPresets.list=async()=>{calls++;return healthy();};
 assert.equal(typeof f.host.refreshSessionModeCatalog,'function');
 await assert.rejects(()=>f.host.refreshSessionModeCatalog({kind:'human',id:'foreign'}),{code:'unauthorized'});assert.equal(calls,0);
 await f.host.refreshSessionModeCatalog(human);const snapshot=f.host.snapshot(human);
 assert.equal(snapshot.agentPresetCatalog.status,'available');assert.equal(snapshot.nativeRuntimeVerified,false);assert.equal(snapshot.releaseReady,false);assert.equal(calls,1);f.ledger.close();
});
