/** Fresh package/owned filesystem installer verification. No native/model effects. */
import {mkdtempSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {preparePackageSnapshot} from './prepare-package-snapshot.mjs';

const root=resolve(import.meta.dirname,'..'),temporary=realpathSync(mkdtempSync(resolve(tmpdir(),'dsh-gui-install-tests-')));
try {
  const snapshot=await preparePackageSnapshot({productRoot:root,temporaryRoot:temporary});
  writeFileSync(resolve(temporary,'current-package-snapshot.json'),JSON.stringify(snapshot),{flag:'wx',mode:0o600});
  // Node's permission mode refuses fs.symlink with path-scoped grants. These
  // separately classified installer cases need real owned-directory symlinks.
  // The existing network/listener/process fuses and fresh environment stay on.
  const result=spawnSync(process.execPath,['--experimental-test-isolation=none',
    '--import',resolve(root,'test/native-safety.mjs'),'--test',resolve(root,'scripts/install-bot-gui-profile.test.mjs')],
    {cwd:root,env:{DSH_HOME:resolve(temporary,'dsh-home'),DSH_BOT_TEST_ROOT:temporary,TMPDIR:temporary,TZ:'UTC',LANG:'en_US.UTF-8'},stdio:'inherit'});
  process.exitCode=result.status??1;
} finally { rmSync(temporary,{recursive:true,force:true}); }
