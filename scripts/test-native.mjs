/** Dedicated artifact integration launcher, with no credential/proxy environment and no network. */
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(resolve(tmpdir(),'dsh-bot-native-tests-'));
try {
 const files=process.argv.slice(2).length?process.argv.slice(2):['test/native-controller.native.mjs','test/owner-app.native.mjs','test/owner-runtime-assembly.native.mjs'];
 const run=spawnSync(process.execPath,['--import',resolve(root,'test/native-safety.mjs'),'--experimental-test-isolation=none','--test',...files.map(file=>resolve(root,file))],
  {cwd:root,env:{DSH_BOT_TEST_ROOT:temp,DSH_HOME:resolve(temp,'home'),TMPDIR:temp,TZ:'UTC',LANG:'en_US.UTF-8'},stdio:'inherit'});
 process.exitCode=run.status ?? 1;
}finally{rmSync(temp,{recursive:true,force:true});}
