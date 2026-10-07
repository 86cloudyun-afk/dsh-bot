import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Every native loader, exit, model and filesystem operation in these fixtures is fake.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const platforms = JSON.parse(read('platforms.json'));
for (const [group, count] of [['dual-guard',19],['observer',12],['model-stop',10]]) {
  const fixture = Function(read(group+'.fixture.js'))();
  const source = read(group+'.mjs');
  const result = group==='dual-guard' ? fixture(source,platforms['linux-x64']) : group==='observer' ? fixture(source,read('stop.mjs')) : fixture(source);
  test(group+' pure fixtures preserve refusal and observation boundaries',()=>{
    assert.equal(result.tests,count);
    assert.equal(result.passed,count,JSON.stringify(result.failed));
  });
}
const fixture = read('dual-guard.fixture.js');
const macFixture = fixture
  .replaceAll('@deepseek-ai/node-addon-system-linux-x64/bin/glibc/system.node','@deepseek-ai/node-addon-system-darwin-arm64/bin/system.node')
  .replaceAll('@deepseek-ai/node-addon-system-linux-x64','@deepseek-ai/node-addon-system-darwin-arm64')
  .replaceAll('node-addon-require-builtin-linux-x64-gnu','node-addon-require-builtin-darwin-arm64')
  .replaceAll('linux-x64-gnu-napi-v9.node','darwin-arm64-napi-v9.node')
  .replaceAll('/linux-x64-gnu/','/darwin-arm64/')
  .replaceAll('54a9c25c05186c17520f6b7a5ced5f005752c08044c3eb76524cd517287600bc',platforms['darwin-arm64'].bindings[0].sha256)
  .replaceAll('864d3c453f1046fe20d76ed89023213d71aff61fd5a8d1daffd11c229d73935e',platforms['darwin-arm64'].bindings[1].sha256)
  .replaceAll('SYSTEM_GLIBC','SYSTEM_DARWIN_ARM64')
  .replaceAll('REQUIRE_BUILTIN_LINUX_NAPI9','REQUIRE_BUILTIN_DARWIN_ARM64_NAPI9');
test('macOS pins independently enforce all 19 native policy fixtures',()=>{
  const result=Function(macFixture)()(read('dual-guard.mjs'),platforms['darwin-arm64']);
  assert.equal(result.passed,19,JSON.stringify(result.failed));
});
