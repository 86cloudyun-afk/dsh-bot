import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('companion.mjs',import.meta.url),'utf8');
function readBinding(raw,expected){
 const start=source.indexOf('const bindingBytes=');const end=source.indexOf('const target=',start);
 assert.ok(start>=0&&end>start,'CHILD_BINDING_OBSERVATION_MISSING');
 const body=source.slice(start,end).replaceAll('import.meta.url','companionURL');
 return Function('fs','join','root','createHash','companionURL',body+';return bindingConfigObservation;')({readFileSync:()=>raw},(a,b)=>a+'/'+b,'/synthetic',createHash,'file:///synthetic/companion.mjs?builtin-dual#'+expected);
}
test('actual child binding body hashes the original bytes and records top-level pins',()=>{
 const raw=Buffer.from(JSON.stringify({source:'/synthetic/source',pins:{platform:'darwin',arch:'arm64',node:{platform:'darwin-arm64'}},installed:{}}));
 const sha=createHash('sha256').update(raw).digest('hex');
 assert.deepEqual(readBinding(raw,sha),{status:'READ_MATCHED',sha256:sha,expectedSHA256:sha,pinsPlatform:'darwin',pinsArch:'arm64'});
 const changed=Buffer.from(raw.toString()+' ');assert.equal(readBinding(changed,sha).status,'READ_HASH_MISMATCH');
});
test('actual child binding body keeps malformed hashes and pins as fixed unknown values',()=>{
 const raw=Buffer.from(JSON.stringify({source:'/synthetic/source',pins:{platform:'SYNTHETIC_SENSITIVE_SENTINEL',arch:1},installed:{}}));
 const value=readBinding(raw,'SYNTHETIC_SENSITIVE_SENTINEL');
 assert.equal(value.status,'EXPECTED_HASH_INVALID');assert.equal(value.expectedSHA256,null);
 assert.equal(value.pinsPlatform,'UNKNOWN');assert.equal(value.pinsArch,'UNKNOWN');
 assert.ok(!JSON.stringify(value).includes('SYNTHETIC_SENSITIVE_SENTINEL'));
});
