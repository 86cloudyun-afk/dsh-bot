import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Observe fatal exits without handling them or changing Node's exit behavior.
// Boot logs stay private; this report exposes no exception message or path.
export function installStockFatalReport(getGui,{output}={}) {
  const monitor=(error,origin)=>{
    try {
      const gui=getGui(),prior=gui?.report??{},evidence=gui?.evidence??resolve(output??process.env.DSH_BOT_GUI_OUTPUT??'qualification/gui');
      const names=new Set(['Error','TypeError','RangeError','SyntaxError','AssertionError','AggregateError']);
      const codes=new Set(['ENOENT','EACCES','EPERM','EIO','ENOSPC','EMFILE','ENFILE','ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE']);
      const files=new Set(['stock-gui-run.mjs','stock-gui-runtime.mjs','stock-v11-ui-checks.mjs','stock-report.mjs','stock-simple-ui-checks.mjs','stock-repair-checks.mjs','stock-ui-regressions.mjs','stock-chat-identity-checks.mjs','stock-bot-delete-checks.mjs','stock-upgrade-run.mjs','service.mjs','adapter.mjs','state.mjs','sessions.mjs','tasks.mjs','assistant.mjs','knowledge.mjs','memory.mjs','plugin.mjs']);
      const frames=[...String(error?.stack??'').matchAll(/[\/\\]([a-z\d.-]+\.mjs):(\d+):(\d+)/gi)].filter(match=>files.has(match[1])).slice(0,12).map(match=>({file:match[1],line:Number(match[2]),column:Number(match[3])}));
      const report={passed:false,testsPassed:false,teardownComplete:false,fatalExit:true,
        stage:/^[a-z\d-]{1,100}$/.test(prior.stage??'')?prior.stage:'fatal-runner-exit',
        platform:process.platform,arch:process.arch,node:process.version,
        checks:Object.fromEntries(Object.entries(prior.checks??{}).filter(([key,value])=>/^[a-z\d]{1,140}$/i.test(key)&&typeof value==='boolean')),
        controlledRequests:Array.isArray(prior.requests)?prior.requests.length:0,
        fatal:{type:names.has(error?.name)?error.name:'Error',origin:origin==='unhandledRejection'?origin:'uncaughtException',messageHash:createHash('sha256').update(String(error?.message??'')).digest('hex'),frames,...(codes.has(error?.code)?{code:error.code}:{})}};
      for(const [key,size] of [['sourceCommit',40],['artifactSha256',64]])if(new RegExp(`^[a-f\\d]{${size}}$`).test(prior[key]??''))report[key]=prior[key];
      for(const key of ['sourceTreeDirty','standardProfile','standardPluginInstall','controlledProvider'])if(typeof prior[key]==='boolean')report[key]=prior[key];
      if(Number.isSafeInteger(prior.realModelRequests)&&prior.realModelRequests>=0)report.realModelRequests=prior.realModelRequests;
      if(Array.isArray(gui?.errors)){report.browserErrorCount=gui.errors.length;if(!gui.errors.length)report.browserErrors=[];}
      mkdirSync(evidence,{recursive:true});
      writeFileSync(join(evidence,'stock-gui-report.json'),JSON.stringify(report,null,2),{mode:0o600});
    } catch { /* Diagnostic failure must never replace or handle the fatal exit. */ }
  };
  process.on('uncaughtExceptionMonitor',monitor);
  return ()=>process.off('uncaughtExceptionMonitor',monitor);
}
