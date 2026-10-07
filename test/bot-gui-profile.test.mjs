import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SessionController} from '@deepseek-ai/dsh-api-session-controller';

test('GUI native-only controller uses the exact stock SessionController class', async () => {
  const shim=await import('../src/bot-gui-session-controller.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
  assert.equal(shim.default,SessionController,'do not substitute native Session lifecycle behavior');
  const product=JSON.parse(await readFile(join(import.meta.dirname,'..','package.json'),'utf8'));
  assert.equal(product.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'),false);
});

test('GUI installer parses an explicit verified-export boolean without consuming a following path flag',async()=>{
 const module=await import('../scripts/install-bot-gui-profile.mjs');
 assert.equal(typeof module.parseBotGuiInstallArguments,'function');
 const flags=['--verified-export','--directory','/fresh/install','--product','/relocated/export','--runtime','/frozen/runtime','--cwd','/fresh/work',
   '--snapshot-manifest','/trusted/manifest.json','--snapshot-digest','a'.repeat(64),'--snapshot-build-id','trusted-build'];
 const parsed=module.parseBotGuiInstallArguments(flags);
 assert.equal(parsed.verifiedExport,true);assert.equal(parsed.directory,'/fresh/install');assert.equal(parsed.product,'/relocated/export');
 for(const bad of [flags.slice(0,-2),[...flags,'--verified-export'],[...flags,'--unrecognized'],['--verified-export','true',...flags.slice(1)],['--directory','--product']])
  assert.throws(()=>module.parseBotGuiInstallArguments(bad));
});
