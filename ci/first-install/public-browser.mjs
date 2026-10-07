/** Public prerequisites only, through one SRI lock and the original public CLI. */
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HERE,loadState,safeRead,sha,requireThat,cleanEnvironment,ensureFreshDirectory,
 writePrivate,writeReceipt,publicNpmEntry,runPublicNode,redactError,finalStates} from './common.mjs';

const SRI='sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==';
export async function publicBrowser(state,command){
 const directory=join(state.root,'browser-project'),cli=join(directory,'node_modules','playwright-core','cli.js');
 const env={...cleanEnvironment(state,'browser'),PLAYWRIGHT_BROWSERS_PATH:join(state.root,'browser-cache'),
  PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:'120000'};
 if(command==='prepare'){
  const sourceLock=await safeRead(join(HERE,'browser','package-lock.json')),sourcePackage=await safeRead(join(HERE,'browser','package.json'));
  requireThat(sha(sourceLock.bytes)===state.pins.browserLockSha256,'PUBLIC_BROWSER_LOCK_PIN_REFUSED');
  const lock=JSON.parse(sourceLock.bytes),metadata=JSON.parse(sourcePackage.bytes),item=lock.packages?.['node_modules/playwright-core'];
  requireThat(lock.lockfileVersion===3&&Object.keys(lock.packages).length===2&&metadata.private===true
   &&JSON.stringify(metadata.devDependencies)===JSON.stringify({'playwright-core':'1.63.0'})
   &&item.version==='1.63.0'&&item.integrity===SRI
   &&item.resolved==='https://registry.npmjs.org/playwright-core/-/playwright-core-1.63.0.tgz','PUBLIC_BROWSER_LOCK_REFUSED');
  await ensureFreshDirectory(directory);
  await writePrivate(join(directory,'package.json'),sourcePackage.bytes);
  await writePrivate(join(directory,'package-lock.json'),sourceLock.bytes);
  for(const leaf of ['browser-npm-cache'])await ensureFreshDirectory(join(state.root,leaf));
  const userconfig=join(state.root,'browser-user.npmrc'),globalconfig=join(state.root,'browser-global.npmrc');
  await writePrivate(userconfig,'');await writePrivate(globalconfig,'');
  const npm=await publicNpmEntry(state),wrapper=join(state.root,'browser-npm-entry.mjs');
  const source=`import Module from 'node:module';\nimport {dirname} from 'node:path';\nconst filename=${JSON.stringify(npm.path)};const entry=new Module(filename);entry.filename=filename;entry.paths=Module._nodeModulePaths(dirname(filename));process.argv=[process.execPath,filename,...process.argv.slice(2)];process.mainModule=entry;Module._cache[filename]=entry;entry._compile(Buffer.from(${JSON.stringify(npm.read.bytes.toString('base64'))},'base64').toString('utf8'),filename);entry.loaded=true;\n`;
  await writePrivate(wrapper,source);
  const stopped=await runPublicNode(state,[wrapper,'ci','--ignore-scripts','--no-audit','--no-fund','--strict-ssl=true',
   '--userconfig',userconfig,'--globalconfig',globalconfig,'--cache',join(state.root,'browser-npm-cache'),
   '--registry','https://registry.npmjs.org/','--include=dev'],{cwd:directory,env,timeoutMs:120000});
  await safeRead(join(directory,'package-lock.json'),{bytes:sourceLock.bytes.length,sha256:sha(sourceLock.bytes),mode:0o600});
  await finalStates([sourceLock,sourcePackage,npm.read]);
  await writeReceipt(state,'public-browser-install.json',{classification:'PINNED_PUBLIC_BROWSER_PREREQUISITE',status:'PASS',
   nodeSha256:state.nodeSha256,playwrightCoreVersion:'1.63.0',publicLockSha256:sha(sourceLock.bytes),publicPackageIntegrity:SRI,
   freshCache:true,emptyNpmConfigs:true,strictTls:true,lifecycleScriptsExecuted:false,npmTimeoutMs:120000,npmProcessState:stopped.state});
 }else{
  requireThat(['linux-deps','download'].includes(command),'PUBLIC_BROWSER_COMMAND_REFUSED');
  if(command==='linux-deps')requireThat(state.target==='linux-x64','PUBLIC_LINUX_DEPENDENCIES_TARGET_REQUIRED');
  const metadata=JSON.parse((await safeRead(join(directory,'node_modules','playwright-core','package.json'))).bytes);
  requireThat(metadata.name==='playwright-core'&&metadata.version==='1.63.0','PUBLIC_BROWSER_VERSION_REFUSED');
  const entry=await safeRead(cli);
  const stopped=await runPublicNode(state,[cli,command==='linux-deps'?'install-deps':'install','chromium'],
   {cwd:directory,env,timeoutMs:300000});
  await finalStates([entry]);
  await writeReceipt(state,'public-browser-'+command+'.json',{classification:'ORIGINAL_PUBLIC_PLAYWRIGHT_CLI',status:'PASS',
   playwrightCoreVersion:'1.63.0',originalCliSha256:sha(entry.bytes),processState:stopped.state,command,
   originalPublicCli:true,browserDownloadPerformed:command==='download',tlsOverridesUsed:false,
   quarantineOverridesUsed:false,ciHardwareProbeCommandsInvoked:false});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let state;try{state=await loadState(process.argv[3]);await publicBrowser(state,process.argv[2]);}
 catch(cause){if(state)await writeReceipt(state,'public-browser-failure.json',{classification:'PUBLIC_BROWSER_PREREQUISITE_FAILURE',status:'FAIL',errorCategory:redactError(cause)});
  process.stderr.write(JSON.stringify({errorCategory:redactError(cause)})+'\n');process.exitCode=1;}
}
