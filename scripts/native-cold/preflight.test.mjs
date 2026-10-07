import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('companion.mjs',import.meta.url),'utf8');
const start=source.indexOf(" checkpoint('C_BOUNDARY_PREFLIGHT');");
const end=source.indexOf(" if(!guardOnly)verifyInstalled('before');",start);
assert.ok(start>=0&&end>start);
const body=source.slice(start,end);
const names=['caseRecognized','permissionReady','environmentRestricted','platformMatches','architectureMatches'];
function exercise(change={}){
 const process={execArgv:['--permission'],env:{DSH_HOME:'UNTRUSTED_VALUE_MUST_NOT_PERSIST'},platform:'darwin',arch:'arm64',...change.process};
 const caseName=change.caseName??'builtin-dual',state={explicitApprovedAddonFlag:process.execArgv.includes('--permission')&&process.execArgv.includes('--allow-addons')};const saves=[];let refusal=null;
 try{Function('checkpoint','process','state','caseName','guardOnly','pins','refused','save',body)(()=>{},process,state,caseName,caseName==='builtin-dual',{platform:'darwin',arch:'arm64'},reason=>{refusal=reason;throw Error('SYNTHETIC_STOP');},()=>saves.push(JSON.parse(JSON.stringify(state))));}catch(error){assert.equal(error.message,'SYNTHETIC_STOP');}
 return {state,saves,refusal};
}
test('actual preflight records checked strict booleans before each single refusal',()=>{
 const faults=[
  ['caseRecognized',{caseName:'synthetic-invalid',process:{execArgv:['--permission','--allow-addons']}}],
  ['permissionReady',{process:{execArgv:[]}}],
  ['environmentRestricted',{process:{env:{UNTRUSTED_KEY_MUST_NOT_PERSIST:'UNTRUSTED_VALUE_MUST_NOT_PERSIST'}}}],
  ['platformMatches',{process:{platform:'synthetic-platform'}}],
  ['architectureMatches',{process:{arch:'synthetic-arch'}}],
 ];
 for(const [failed,change] of faults){
  const result=exercise(change);assert.equal(result.refusal,'PREFLIGHT_BOUNDARY_REFUSED');
  assert.equal(result.state.preflightBoundary?.status,'CHECKED');
  for(const name of names)assert.equal(result.state.preflightBoundary[name],name!==failed,name);
  assert.deepEqual(result.saves.at(-1).preflightBoundary,result.state.preflightBoundary);
  assert.ok(!JSON.stringify(result.state).includes('UNTRUSTED_'));
 }
});
test('successful preflight and multiple failure retain exact boolean results',()=>{
 const result=exercise();assert.equal(result.refusal,null);
 assert.deepEqual(result.state.preflightBoundary,{status:'CHECKED',...Object.fromEntries(names.map(n=>[n,true]))});
 const failed=exercise({process:{execArgv:['--permission','--allow-addons'],env:{UNTRUSTED_KEY_MUST_NOT_PERSIST:'UNTRUSTED_VALUE_MUST_NOT_PERSIST'},arch:'synthetic-arch'}});
 assert.equal(failed.refusal,'PREFLIGHT_BOUNDARY_REFUSED');
 for(const n of ['permissionReady','environmentRestricted','architectureMatches'])assert.equal(failed.state.preflightBoundary[n],false);
 assert.equal(failed.state.preflightBoundary.platformMatches,true);
 assert.ok(!JSON.stringify(failed.state).includes('UNTRUSTED_'));
});
