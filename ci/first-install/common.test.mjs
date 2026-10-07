import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanEnvironment, redactError, assertRedacted} from './common.mjs';

test('public installation environment excludes prior Home, configuration and keys',()=>{
 const state={root:'/new/private',nodeExecutable:'/public/node/bin/node'};
 const env=cleanEnvironment(state,'browser');
 assert.equal(env.HOME,'/new/private/browser-home');
 assert.equal(env.TMPDIR,'/new/private/browser-tmp');
 assert.equal(env.PATH,'/public/node/bin:/usr/bin:/bin:/usr/sbin:/sbin');
 assert.deepEqual(Object.keys(env).sort(),['HOME','LANG','PATH','TMPDIR','TZ','XDG_CACHE_HOME','XDG_CONFIG_HOME'].sort());
});
test('untrusted exception text never becomes uploaded diagnostics',()=>{
 assert.equal(redactError(Error('https://localhost/?token=private')),'FIRST_INSTALL_STAGE_REFUSED');
 assert.equal(redactError(Object.assign(Error('private'),{code:'MODULE_NOT_FOUND'})),'MODULE_NOT_FOUND');
});
test('receipt boundary rejects raw Home and auth URL values',()=>{
 assert.throws(()=>assertRedacted({home:'/old/home'}),{code:'RECEIPT_REDACTION_REQUIRED'});
 assert.throws(()=>assertRedacted({message:'https://localhost/?token=private'}),{code:'RECEIPT_REDACTION_REQUIRED'});
 assert.doesNotThrow(()=>assertRedacted({status:'PASS',target:'darwin-arm64',providerFetchRequests:0,identity:{botId:'1234'}}));
});
