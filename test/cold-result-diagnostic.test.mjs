import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('./cold-result-diagnostic.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('cold diagnostics expose only fixed categories from the existing result',()=>{
 assert.equal(typeof mod.coldResultDiagnostic,'function');assert.deepEqual(mod.coldResultDiagnostic({error:{code:'gateway/internal',message:'arbitrary private diagnostic text'}}),{stage:'existing-cold-resolve',agentPresent:false,errorCode:'gateway/internal',errorCategory:'GATEWAY_INTERNAL'});
});
test('cold diagnostics keep unrecorded inner causes unknown and omit arbitrary error text',()=>{
 assert.equal(typeof mod.coldResultDiagnostic,'function');const result=mod.coldResultDiagnostic({error:{code:'arbitrary-code',message:'arbitrary private diagnostic text'}});assert.equal(result.errorCode,'UNRECORDED');assert.equal(result.errorCategory,'UNKNOWN');assert.equal(JSON.stringify(result).includes('arbitrary'),false);assert.equal(mod.coldResultDiagnostic({agent:{}}).agentPresent,true);
});

const wrapped=message=>({error:{code:'gateway/internal',message:`resume failed for session "synthetic-only": ${message}`}});
test('cold error layers distinguish addon permission denial without emitting private details',()=>{
 assert.equal(typeof mod.coldResultLayers,'function');
 const result=mod.coldResultLayers(wrapped('Error [ERR_DLOPEN_DISABLED]: PRIVATE_SENTINEL /private/path credential-sentinel'));
 assert.deepEqual(result,{errorLayer:'NATIVE_ADDON_PERMISSION',innerCodeMarker:'ERR_DLOPEN_DISABLED',innerEvidence:'SDK_STRINGIFIED_ERROR_MARKER',structuredCauseRetained:false});
 assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'),false);assert.equal(JSON.stringify(result).includes('/private/path'),false);assert.equal(JSON.stringify(result).includes('credential-sentinel'),false);
 const plain=mod.coldResultLayers(wrapped('Error: Cannot load native addon because loading addons is disabled.'));
 assert.deepEqual(plain,{errorLayer:'NATIVE_ADDON_PERMISSION',innerCodeMarker:'UNRECORDED',innerEvidence:'SDK_STRINGIFIED_ERROR_MARKER',structuredCauseRetained:false});
});
test('cold error layers distinguish dependency resolution from host capability errors',()=>{
 assert.equal(typeof mod.coldResultLayers,'function');
 for(const message of ["Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'private-dependency'","Error: Cannot find module 'private-dependency'\nRequire stack:\n/private/path"]){
  const result=mod.coldResultLayers(wrapped(message));assert.equal(result.errorLayer,'DEPENDENCY_RESOLUTION');assert.equal(result.innerEvidence,'SDK_STRINGIFIED_ERROR_MARKER');assert.equal(JSON.stringify(result).includes('private-dependency'),false);
 }
 const denied=mod.coldResultLayers(wrapped('Error [ERR_ACCESS_DENIED]: private path'));assert.equal(denied.errorLayer,'FILESYSTEM_PERMISSION');
 const unsupported=mod.coldResultLayers(wrapped('Error: flock is not supported on win32-x64'));assert.equal(unsupported.errorLayer,'HOST_PLATFORM_CAPABILITY');
 const broken=mod.coldResultLayers(wrapped('Error [ERR_DLOPEN_FAILED]: private native path'));assert.equal(broken.errorLayer,'NATIVE_ADDON_LOAD_FAILED');
});
test('cold error layers identify fixed corrupt-session classes without inferring from generic syntax errors',()=>{
 assert.equal(typeof mod.coldResultLayers,'function');
 for(const message of ['SessionPersistenceCorruptionError: private detail','SessionQueryError: stored session "synthetic-only" is corrupt: private detail','SessionQueryError: failed to project session "synthetic-only": private detail'])assert.equal(mod.coldResultLayers(wrapped(message)).errorLayer,'SYNTHETIC_FIXTURE_FORMAT');
 assert.equal(mod.coldResultLayers(wrapped('SyntaxError: arbitrary syntax failure')).errorLayer,'UNKNOWN');
 assert.equal(mod.coldResultLayers(wrapped('SessionQueryError: arbitrary failure')).errorLayer,'UNKNOWN');
});
test('cold error layers reject unrelated markers and preserve structured evidence separately',()=>{
 assert.equal(typeof mod.coldResultLayers,'function');
 for(const result of [{error:{code:'gateway/internal',message:'Error [ERR_DLOPEN_DISABLED]: unrelated'}},wrapped('Error: unrelated ERR_DLOPEN_DISABLED'),{error:{code:'other',message:'resume failed for session "synthetic-only": Error [ERR_DLOPEN_DISABLED]: unrelated'}},wrapped('Error [ERR_PRIVATE_UNKNOWN]: private detail')])assert.deepEqual(mod.coldResultLayers(result),{errorLayer:'UNKNOWN',innerCodeMarker:'UNRECORDED',innerEvidence:'UNRECORDED',structuredCauseRetained:false});
 for(const message of ['Error: unrelated Cannot load native addon because loading addons is disabled.','Error: Cannot load native addon because loading addons is disabled. private tail'])assert.equal(mod.coldResultLayers(wrapped(message)).errorLayer,'UNKNOWN');
 const structured=mod.coldResultLayers({error:{code:'gateway/internal',cause:Object.assign(new Error('private detail'),{code:'ERR_MODULE_NOT_FOUND'})}});
 assert.deepEqual(structured,{errorLayer:'DEPENDENCY_RESOLUTION',innerCodeMarker:'ERR_MODULE_NOT_FOUND',innerEvidence:'STRUCTURED_CAUSE_CODE',structuredCauseRetained:true});
});
test('cold error layers retain unknown for absent responses and oversized diagnostic prefixes',()=>{
 assert.equal(typeof mod.coldResultLayers,'function');
 for(const result of [undefined,null,{agent:{}},wrapped('private detail '.repeat(1000))])assert.equal(mod.coldResultLayers(result).errorLayer,'UNKNOWN');
});
