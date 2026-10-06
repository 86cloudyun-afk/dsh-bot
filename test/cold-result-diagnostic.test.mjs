import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('./cold-result-diagnostic.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('cold diagnostics expose only fixed categories from the existing result',()=>{
 assert.equal(typeof mod.coldResultDiagnostic,'function');assert.deepEqual(mod.coldResultDiagnostic({error:{code:'gateway/internal',message:'arbitrary private diagnostic text'}}),{stage:'existing-cold-resolve',agentPresent:false,errorCode:'gateway/internal',errorCategory:'GATEWAY_INTERNAL'});
});
test('cold diagnostics keep unrecorded inner causes unknown and omit arbitrary error text',()=>{
 assert.equal(typeof mod.coldResultDiagnostic,'function');const result=mod.coldResultDiagnostic({error:{code:'arbitrary-code',message:'arbitrary private diagnostic text'}});assert.equal(result.errorCode,'UNRECORDED');assert.equal(result.errorCategory,'UNKNOWN');assert.equal(JSON.stringify(result).includes('arbitrary'),false);assert.equal(mod.coldResultDiagnostic({agent:{}}).agentPresent,true);
});
