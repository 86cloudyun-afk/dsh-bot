import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/initial-session-blank.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const initialization={permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'};
const actualPrefix=[
  {type:'permission/preset',seq:0,time:1791379738628,data:{preset:'workspace-write'}},
  {type:'sandbox/mode',seq:1,time:1791379738631,data:{mode:'workspace-write'}},
  {type:'approval/policy',seq:2,time:1791379738631,data:{policy:'ask'}},
];
test('initial blank accepts exactly the actual official mode prefix and preserves strict empty behavior',()=>{
  assert.equal(typeof module.isBlankInitialSessionEvents,'function');
  const blank=module.isBlankInitialSessionEvents;
  assert.equal(blank(actualPrefix,initialization,3),true);
  assert.equal(blank([],undefined,0),true);
  assert.equal(blank(actualPrefix,undefined,3),false);
  assert.equal(blank([],initialization,0),false);
});
test('initial blank refuses input, turns, tools, reordered/changed/extra metadata and live append races',()=>{
  assert.equal(typeof module.isBlankInitialSessionEvents,'function');
  const blank=module.isBlankInitialSessionEvents;
  for(const type of ['user/message','turn/start','model/response','tools/call','agent/inbox/spliced'])
    assert.equal(blank([...actualPrefix,{type,seq:3,time:1791379738632,data:{}}],initialization,4),false,type);
  assert.equal(blank([actualPrefix[1],actualPrefix[0],actualPrefix[2]],initialization,3),false);
  assert.equal(blank(actualPrefix.map((e,i)=>i===1?{...e,data:{mode:'danger-full-access'}}:e),initialization,3),false);
  assert.equal(blank(actualPrefix.map((e,i)=>i===0?{...e,data:{preset:'workspace-write',extra:'unknown'}}:e),initialization,3),false);
  assert.equal(blank(actualPrefix.map((e,i)=>i===0?{...e,seq:4}:e),initialization,3),false);
  assert.equal(blank(actualPrefix.map((e,i)=>i===2?{...e,time:1}:e),initialization,3),false);
  assert.equal(blank(actualPrefix,initialization,4),false);
});
test('initial mode is copied immutably and contradictory or open-shaped snapshots fail closed',()=>{
  assert.equal(typeof module.freezeInitialSessionMode,'function');
  const input={...initialization},snapshot=module.freezeInitialSessionMode(input);
  input.approvalPolicy='never';assert.deepEqual(snapshot,initialization);assert.equal(Object.isFrozen(snapshot),true);
  for(const bad of [{...initialization,approvalPolicy:'never'},{...initialization,extra:'ignored'},Object.assign(Object.create({}),initialization),null])
    assert.throws(()=>module.freezeInitialSessionMode(bad));
  assert.equal(module.isBlankInitialSessionEvents(actualPrefix,{...initialization,approvalPolicy:'never'},3),false);
});
