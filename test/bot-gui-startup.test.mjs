import test from 'node:test';
import assert from 'node:assert/strict';
async function parser() {
  const m=await import('../src/bot-gui-startup.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
  assert.equal(typeof m.parseBotGuiArguments,'function','missing bounded GUI startup');
  return m.parseBotGuiArguments;
}
test('GUI startup defaults model requests off and accepts explicit loopback enablement',async()=>{
  const parse=await parser();
  assert.deepEqual(parse([]),{host:'127.0.0.1',port:3080,openBrowser:false,trustedHosts:[],modelRequestsEnabled:false});
  assert.deepEqual(parse(['--no-open','--port','0','--enable-model-requests']),{host:'127.0.0.1',port:0,openBrowser:false,trustedHosts:[],modelRequestsEnabled:true});
});
test('GUI startup refuses nonloopback hosts, unknown flags and duplicate flags',async()=>{
  const parse=await parser();
  for(const args of [['--host','0.0.0.0'],['--port','-1'],['--port','65536'],['--trusted-host','other.test'],['--enable-model-requests','--enable-model-requests'],['--port','0','--port','1'],['--port']]) assert.throws(()=>parse(args));
});
