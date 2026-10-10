import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Observe fatal exits without handling them or changing Node's exit behavior.
// Boot logs stay private; this report exposes no exception message or path.
export function installStockFatalReport(getGui,{output}={}) {
  let ownFatalReport;
  const names=new Set(['Error','TypeError','RangeError','SyntaxError','AssertionError','AggregateError']);
  const codes=new Set(['ENOENT','EACCES','EPERM','EIO','ENOSPC','EMFILE','ENFILE','ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE']);
  const publicError=value=>names.has(value?.type)&&typeof value?.messageHash==='string'&&/^[a-f\d]{64}$/.test(value.messageHash)?{type:value.type,messageHash:value.messageHash,...(codes.has(value.code)?{code:value.code}:{})}:undefined;
  const terminalParentCleanup=value=>{
    const error=publicError(value?.error),proof=value?.complete===true?{complete:true}:value?.complete===false&&error?{complete:false,error}:undefined;
    return proof&&JSON.stringify(value)===JSON.stringify(proof)?proof:undefined;
  };
  const monitor=(error,origin,exitCode)=>{
    try {
      const gui=getGui(),evidence=gui?.evidence??resolve(output??process.env.DSH_BOT_GUI_OUTPUT??'qualification/gui'),path=join(evidence,'stock-gui-report.json');
      if(exitCode!==undefined){
        let saved,bytes;
        try {bytes=readFileSync(path,'utf8');saved=JSON.parse(bytes);} catch {}
        // Preserve only this observer's richer fatal or the current finalized report.
        // A reused evidence directory can contain a different run's failed report.
        if(ownFatalReport?.path===path&&ownFatalReport.bytes===bytes)return;
        const current=gui?.report;
        if(current?.passed===false&&typeof current.testsPassed==='boolean'&&typeof current.teardownComplete==='boolean'&&(current.teardownComplete||terminalParentCleanup(current.parentCleanup))&&JSON.stringify(current)===JSON.stringify(saved))return;
      }
      const prior=gui?.report??{};
      const controlledRequests=Array.isArray(prior.requests)?prior.requests.length:Number.isSafeInteger(prior.controlledRequests)&&prior.controlledRequests>=0?prior.controlledRequests:undefined;
      const files=new Set(['stock-gui-run.mjs','stock-gui-runtime.mjs','stock-v11-ui-checks.mjs','stock-report.mjs','stock-simple-ui-checks.mjs','stock-repair-checks.mjs','stock-ui-regressions.mjs','stock-chat-identity-checks.mjs','stock-bot-delete-checks.mjs','stock-upgrade-run.mjs','service.mjs','adapter.mjs','state.mjs','sessions.mjs','tasks.mjs','assistant.mjs','knowledge.mjs','memory.mjs','plugin.mjs']);
      const frames=[...String(error?.stack??'').matchAll(/[\/\\]([a-z\d.-]+\.mjs):(\d+):(\d+)/gi)].filter(match=>files.has(match[1])).slice(0,12).map(match=>({file:match[1],line:Number(match[2]),column:Number(match[3])}));
      const report={passed:false,testsPassed:exitCode!==undefined&&prior.testsPassed===true,teardownComplete:exitCode!==undefined&&prior.teardownComplete===true,fatalExit:true,
        stage:/^[a-z\d-]{1,100}$/.test(prior.stage??'')?prior.stage:'fatal-runner-exit',
        platform:process.platform,arch:process.arch,node:process.version,
        checks:Object.fromEntries(Object.entries(prior.checks??{}).filter(([key,value])=>/^[a-z\d]{1,140}$/i.test(key)&&typeof value==='boolean')),
        ...(controlledRequests===undefined?{}:{controlledRequests}),
        ...(exitCode===undefined?{fatal:{type:names.has(error?.name)?error.name:'Error',origin:origin==='unhandledRejection'?origin:'uncaughtException',messageHash:createHash('sha256').update(String(error?.message??'')).digest('hex'),frames,...(codes.has(error?.code)?{code:error.code}:{})}}:{processExit:{code:exitCode}})};
      for(const [key,size] of [['sourceCommit',40],['artifactSha256',64]])if(new RegExp(`^[a-f\\d]{${size}}$`).test(prior[key]??''))report[key]=prior[key];
      for(const key of ['sourceTreeDirty','standardProfile','standardPluginInstall','controlledProvider'])if(typeof prior[key]==='boolean')report[key]=prior[key];
      if(Number.isSafeInteger(prior.realModelRequests)&&prior.realModelRequests>=0)report.realModelRequests=prior.realModelRequests;
      if(exitCode!==undefined&&Number.isInteger(prior.commandExitCode))report.commandExitCode=prior.commandExitCode;
      if(exitCode!==undefined){
        for(const field of ['error','teardownError','parentError']){
          const value=publicError(prior[field]);if(value)report[field]=value;
        }
        const parentCleanup=terminalParentCleanup(prior.parentCleanup);if(parentCleanup)report.parentCleanup=parentCleanup;
      }
      if(Array.isArray(gui?.errors)){report.browserErrorCount=gui.errors.length;if(!gui.errors.length)report.browserErrors=[];}
      mkdirSync(evidence,{recursive:true});
      const bytes=JSON.stringify(report,null,2);
      writeFileSync(path,bytes,{mode:0o600});
      if(exitCode===undefined)ownFatalReport={path,bytes};
    } catch { /* Diagnostic failure must never replace or handle the fatal exit. */ }
  };
  // The official fail-loud handler may handle a rejection and then exit directly.
  // An exit observer records evidence without handling that rejection or changing Node's behavior.
  const exit=code=>{if(Number.isInteger(code)&&code!==0)monitor(undefined,undefined,code);};
  process.on('uncaughtExceptionMonitor',monitor);
  process.on('exit',exit);
  return ()=>{process.off('uncaughtExceptionMonitor',monitor);process.off('exit',exit);};
}
