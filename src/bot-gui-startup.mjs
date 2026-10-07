/** Invocation choices only; these flags never construct owner authority. */
import {requireValue} from './errors.mjs';
export const name='dsh-bot-gui-startup';
export const inject=['cmdlineArgs'];
export function parseBotGuiArguments(args) {
  requireValue(Array.isArray(args) && args.every(v=>typeof v === 'string'),'gui_arguments_invalid');
  const options={host:'127.0.0.1',port:3080,openBrowser:false,trustedHosts:[],modelRequestsEnabled:false},seen=new Set();
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    requireValue(['--host','--port','--no-open','--enable-model-requests'].includes(flag) && !seen.has(flag),'gui_arguments_invalid');
    seen.add(flag);
    if(flag === '--no-open') continue;
    if(flag === '--enable-model-requests') {options.modelRequestsEnabled=true;continue;}
    const value=args[++i];
    if(flag === '--host') requireValue(value === '127.0.0.1','gui_loopback_required');
    else {requireValue(typeof value === 'string' && /^(0|[1-9]\d{0,4})$/.test(value) && Number(value)<=65535,'gui_port_invalid');options.port=Number(value);}
  }
  return options;
}
export function apply(ctx) {
  const options=parseBotGuiArguments(ctx.cmdlineArgs.get());
  ctx.provide('webStartup',Object.freeze({...options,trustedHosts:Object.freeze([])}));
  ctx.provide('dshBotGuiStartup',Object.freeze({modelRequestsEnabled:options.modelRequestsEnabled}));
}
