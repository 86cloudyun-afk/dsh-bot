/** Stock Chromium, documented default profile, genuine create and cold restart. */
import * as fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {HERE,loadState,safeRead,sha,requireThat,cleanEnvironment,ensureFreshDirectory,writeReceipt,
 privateDirectory,redactError,finalStates} from './common.mjs';
import {verifyInstalled} from './install.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,test,code,ms=45000){
 const deadline=Date.now()+ms;
 do{const value=await read();if(test(value))return value;await delay(75);}while(Date.now()<deadline);
 requireThat(false,code);
}
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function identity(value){
 const result={ledgerId:value.ledgerId,botId:value.selectedBotId,mainSessionId:value.contactSessionId};
 requireThat(Object.values(result).every(safeId),'GUI_IDENTITY_NOT_KNOWN');return result;
}

function startOriginalServer(state,manifest){
 const nonce=randomBytes(16).toString('hex'),environment={...cleanEnvironment(state,'server'),
  DSH_HOME:manifest.home,DSH_TELEMETRY_DISABLED:'1',DSH_FIRST_OBSERVER_NONCE:nonce};
 const child=spawn(state.nodeExecutable,['--import',join(HERE,'zero-provider-observer.mjs'),manifest.dsh,
  '--profile',manifest.profile,'--port','3080','--no-open'],{cwd:manifest.cwd,env:environment,
  stdio:['ignore','pipe','pipe'],detached:true});
 const pid=child.pid;let output='',authUrl,observer,exited=false,closed=false,spawnError=false,oversized=false,stopState='ACTIVE';
 child.once('error',()=>{spawnError=true;});child.once('exit',()=>{exited=true;});child.once('close',()=>{closed=true;});
 function collect(raw){
  if(output.length+raw.length>1024*1024){oversized=true;return;}
  output+=raw.toString('utf8');
  const match=output.match(/dsh web: (http:\/\/127\.0\.0\.1:3080\/?\?token=[A-Za-z0-9_-]+)/);
  if(match)authUrl=match[1];
 }
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const group=()=>{if(!Number.isInteger(pid))return undefined;try{process.kill(-pid,0);return true;}catch(cause){return cause.code==='ESRCH'?false:undefined;}};
 const signal=value=>{
  if(exited||child.pid!==pid||child.exitCode!==null||child.signalCode!==null||group()!==true)return;
  try{process.kill(-pid,value);}catch(cause){if(cause.code!=='ESRCH')stopState='UNKNOWN';}
 };
 return {
  async ready(){
   await until(()=>({authUrl,exited,spawnError,oversized}),value=>{
    requireThat(!value.exited&&!value.spawnError&&!value.oversized,'DOCUMENTED_SERVER_STARTUP_REFUSED');return Boolean(value.authUrl);
   },'DOCUMENTED_STARTUP_AUTH_LINK_NOT_OBSERVED');
   const url=new URL(authUrl);requireThat(url.origin==='http://127.0.0.1:3080'&&url.pathname==='/'&&url.searchParams.has('token'),'DOCUMENTED_AUTH_ORIGIN_REFUSED');
   return {authUrl,origin:url.origin};
  },
  async stop(){
   if(stopState==='STOPPED')return observer;
   if(stopState==='UNKNOWN')requireThat(false,'DOCUMENTED_SERVER_STOP_UNKNOWN');
   signal('SIGTERM');const killAt=Date.now()+1000,deadline=Date.now()+8000;let escalated=false;
   while(Date.now()<deadline){
    const present=group();
    if(present===false&&exited&&closed){
     stopState='STOPPED';const lines=output.split(/\r?\n/);
     for(const line of lines)if(line.startsWith('{')){
      let value;try{value=JSON.parse(line);}catch{continue;}
      if(value.kind==='FIRST_INSTALL_NETWORK_OBSERVER'&&value.nonce===nonce){requireThat(!observer,'NETWORK_OBSERVER_DUPLICATE');observer=value;}
     }
     output='';authUrl=undefined;
     requireThat(observer&&Number.isSafeInteger(observer.providerRequests)&&Number.isSafeInteger(observer.otherExternalRequests)
      &&observer.providerRequests===0&&observer.otherExternalRequests===0&&!oversized,'ZERO_PROVIDER_REQUESTS_NOT_PROVED');
     return {providerRequests:observer.providerRequests,otherExternalRequests:observer.otherExternalRequests,stopState};
    }
    if(present===undefined||stopState==='UNKNOWN')break;
    if(!escalated&&Date.now()>=killAt){escalated=true;signal('SIGKILL');}
    await delay(25);
   }
   stopState='UNKNOWN';requireThat(false,'DOCUMENTED_SERVER_STOP_UNKNOWN');
  },
  releaseUnknown(){child.unref();child.stdout.destroy();child.stderr.destroy();output='';authUrl=undefined;},
  get stopState(){return stopState;},
 };
}

export async function guiBaseline(state){
 const initialProofFile=await safeRead(join(state.root,'installation-state.json')),initialProof=JSON.parse(initialProofFile.bytes);
 const before=await verifyInstalled(state,initialProof),manifest=before.manifest;
 const browserDirectory=join(state.root,'browser-project'),browserEntry=join(browserDirectory,'node_modules','playwright-core','index.mjs');
 const browserMetadata=JSON.parse((await safeRead(join(browserDirectory,'node_modules','playwright-core','package.json'))).bytes);
 requireThat(browserMetadata.version==='1.63.0','PUBLIC_BROWSER_VERSION_REFUSED');
 const browserEnv={...cleanEnvironment(state,'browser'),PLAYWRIGHT_BROWSERS_PATH:join(state.root,'browser-cache')};
 // Playwright resolves its recorded browser path in the harness process too.
 process.env.PLAYWRIGHT_BROWSERS_PATH=browserEnv.PLAYWRIGHT_BROWSERS_PATH;
 const {chromium}=await import(pathToFileURL(browserEntry).href);
 const executable=await fs.realpath(chromium.executablePath()),browserBinary=await safeRead(executable);
 requireThat(executable.startsWith(join(state.root,'browser-cache')+'/'),'FRESH_PUBLIC_BROWSER_CACHE_REQUIRED');
 const userData=join(state.root,'browser-user-data');await ensureFreshDirectory(userData);
 const report={classification:'FRESH_INSTALLED_DOCUMENTED_VIEWING_GUI_BASELINE',status:'FAIL',
  installationManifestSha256:initialProof.installationManifestSha256,runtimeManifestSha256:initialProof.runtimeManifestSha256,
  productSourceHead:state.pins.sourceHead,sourceIndexSha256:state.pins.sourceIndexSha256,normalInstalledProfile:true,
  profileEdited:false,sdkEdited:false,modelRequestsEnabled:false,modelsRequested:0,publicReleaseQualified:false,
  fullTaskQualification:false,browserSandbox:state.target==='darwin-arm64'?'ORIGINAL_CHROMIUM_SANDBOX':'LINUX_QA_NO_SANDBOX',
  chromiumBinarySha256:sha(browserBinary.bytes),checks:[],pageErrorCount:0,serverStarts:0,providerRequests:null,otherExternalRequests:null,
  browserProviderRequests:0,browserOtherExternalRequests:0,
  originalServerStopsConfirmed:0,serverStopState:'NOT_STARTED'};
 let server,browser,page,origin;
 const connect=async()=>{
  await page.waitForSelector('[data-dsh-bot-panel]',{timeout:45000});
  await until(()=>page.locator('[data-dsh-bot-connection]').innerText(),value=>value==='已连接','DOCUMENTED_BROWSER_NOT_CONNECTED');
 };
 const rpc=async(method,payload={})=>page.evaluate(async({method,payload,rpcId})=>{
  const response=await fetch('/dsh-bot-gui/'+method,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({type:'client-request',rpcId,method,payload})});
  return {status:response.status,body:await response.json()};
 },{method,payload,rpcId:randomUUID()});
 const boot=async()=>{
  const value=await rpc('bootstrap');requireThat(value.status===200&&value.body.result?.ok===true,'DOCUMENTED_BOOTSTRAP_NOT_KNOWN');
  return value.body.result.value;
 };
 const disabled=async()=>{
  const value=await until(boot,view=>view.modelRequestsEnabled===false&&view.modelDispatchStatus==='disabled','DOCUMENTED_DEFAULT_MODEL_GATE_NOT_READY');
  await until(()=>page.locator('[data-dsh-bot-goal]').isDisabled(),Boolean,'DOCUMENTED_MODEL_INPUT_NOT_DISABLED');return value;
 };
 const screenshot=async name=>{
  const url=new URL(page.url());requireThat(url.origin===origin&&url.pathname==='/'&&url.search===''&&url.hash===''
   &&await page.locator('[data-dsh-bot-panel]').isVisible(),'SCREENSHOT_CLEAN_AUTHENTICATED_URL_REQUIRED');
  await page.screenshot({path:join(state.root,'screenshots',name),fullPage:true});
 };
 const stop=async()=>{
  const result=await server.stop();report.originalServerStopsConfirmed++;report.serverStopState=result.stopState;
  report.providerRequests=(report.providerRequests??0)+result.providerRequests;
  report.otherExternalRequests=(report.otherExternalRequests??0)+result.otherExternalRequests;server=undefined;
 };
 try{
  server=startOriginalServer(state,manifest);report.serverStarts++;const startup=await server.ready();origin=startup.origin;
  browser=await chromium.launchPersistentContext(userData,{executablePath:executable,headless:true,
   chromiumSandbox:state.target==='darwin-arm64',args:state.target==='linux-x64'?['--no-sandbox']:[],
   viewport:{width:1320,height:1000},env:browserEnv,timeout:45000});
  await browser.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){
    if(url.hostname==='api.deepseek.com'||url.hostname.endsWith('.deepseek.com'))report.browserProviderRequests++;
    else report.browserOtherExternalRequests++;
    await route.abort('blockedbyclient');return;
   }
   await route.continue();
  });
  requireThat((await browser.cookies()).length===0,'FRESH_BROWSER_COOKIE_STORE_REQUIRED');
  page=await browser.newPage();page.on('pageerror',()=>{report.pageErrorCount++;});
  const refused=await page.goto(origin,{waitUntil:'domcontentloaded'});requireThat(refused?.status()===401,'STOCK_UNAUTHENTICATED_ROOT_NOT_401');
  report.checks.push('stock-browser-unauthenticated-root-401');
  const authenticated=await page.goto(startup.authUrl,{waitUntil:'domcontentloaded'});
  requireThat(authenticated?.status()===200,'STOCK_AUTH_LINK_EXCHANGE_FAILED');await connect();
  const cleaned=new URL(page.url());requireThat(cleaned.origin===origin&&cleaned.search===''&&cleaned.hash==='','STOCK_AUTH_URL_NOT_CLEAN');
  const cookies=await browser.cookies();requireThat(cookies.length===1&&cookies[0].httpOnly===true&&cookies[0].expires>Date.now()/1000,'STOCK_PERSISTENT_HTTPONLY_COOKIE_NOT_OBSERVED');
  report.checks.push('printed-link-exchange-clean-url-persistent-httponly-cookie');
  await page.locator('[data-dsh-bot-create-name]').fill('first-v1-docs-view');
  await until(()=>page.locator('[data-dsh-bot-create]').isEnabled(),Boolean,'DOCUMENTED_CREATE_DISABLED');
  // One real user click only. A timeout or UNKNOWN is not permission to replay Create.
  await page.locator('[data-dsh-bot-create]').click();
  const created=await until(boot,value=>Boolean(value.selectedBotId)&&value.creation?.state==='created','DOCUMENTED_CREATE_NOT_KNOWN');
  report.identity=identity(created);await disabled();report.checks.push('actual-gui-create-native-bot-default-model-input-disabled');
  await page.getByRole('button',{name:'刷新回复与工作',exact:true}).click();await disabled();
  report.checks.push('actual-user-refresh-keeps-default-model-input-disabled');await screenshot('view-created.png');
  await page.close();await stop();
  // A new original CLI process reads the same freshly created installed Home.
  server=startOriginalServer(state,manifest);report.serverStarts++;const restart=await server.ready();
  requireThat(restart.origin===origin,'DOCUMENTED_RESTART_ORIGIN_CHANGED');
  page=await browser.newPage();page.on('pageerror',()=>{report.pageErrorCount++;});
  const restored=await page.goto(origin,{waitUntil:'domcontentloaded'});requireThat(restored?.status()===200,'STOCK_PERSISTENT_COOKIE_RESTART_FAILED');await connect();
  const current=await until(boot,value=>value.selectedBotId===report.identity.botId,'DOCUMENTED_BOT_NOT_RESTORED');
  requireThat(JSON.stringify(identity(current))===JSON.stringify(report.identity),'DOCUMENTED_RESTART_IDENTITIES_CHANGED');
  await disabled();await page.getByRole('button',{name:'刷新回复与工作',exact:true}).click();await disabled();
  report.checks.push('cold-same-home-original-ledger-bot-main-session-cookie-restored');await screenshot('view-restarted.png');
  await stop();await browser.close();browser=undefined;
  const after=await verifyInstalled(state,initialProof);requireThat(after.proof.profileSha256===before.proof.profileSha256,'DOCUMENTED_PROFILE_CHANGED');
  await finalStates([initialProofFile,browserBinary]);
  requireThat(report.pageErrorCount===0&&report.serverStarts===2&&report.originalServerStopsConfirmed===2
   &&report.providerRequests===0&&report.otherExternalRequests===0&&report.browserProviderRequests===0
   &&report.browserOtherExternalRequests===0,'DOCUMENTED_VIEWING_GUI_BASELINE_NOT_PROVED');
  report.checks.push('complete-source-product-runtime-readback-and-zero-provider-after-both-stops');report.status='PASS';
 }catch(cause){report.errorCategory=redactError(cause);process.exitCode=1;}
 finally{
  if(browser)try{await browser.close();}catch{report.status='FAIL';report.errorCategory='PUBLIC_BROWSER_STOP_NOT_CONFIRMED';process.exitCode=1;}
  if(server)try{await stop();}catch(cause){report.status='FAIL';report.errorCategory=redactError(cause);report.serverStopState=server.stopState;server.releaseUnknown();process.exitCode=1;}
  await privateDirectory(join(state.root,'receipts'));await writeReceipt(state,'gui-baseline.json',report);
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let state;try{state=await loadState(process.argv[2]);await guiBaseline(state);}
 catch(cause){if(state)await writeReceipt(state,'gui-baseline-setup-failure.json',{classification:'DOCUMENTED_GUI_SETUP_FAILURE',status:'FAIL',errorCategory:redactError(cause)});
  process.stderr.write(JSON.stringify({errorCategory:redactError(cause)})+'\n');process.exitCode=1;}
}
