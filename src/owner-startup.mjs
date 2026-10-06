/** Native launcher argument handoff only. This service carries choices, never caller authority. */
import { internals } from '@deepseek-ai/dsh-cmdline';
export const name='dsh-bot-owner-startup';
export const inject=['cmdlineArgs'];
const help='Usage: dsh --profile dsh-bot-owner --init|--resume [--enable-model-requests]\nInherited stdin: bounded JSON commands status, prepare, admit, run, inspect, stop, progress, plan, advance, submit, accept, close.\nModel requests are disabled unless explicitly enabled for this process.\n';
export function apply(ctx){
 const args=ctx.get('cmdlineArgs')?.get(),exit=ctx.get('appExit');
 if(!Array.isArray(args) || typeof exit!=='function')throw Error('Native launcher cmdline/appExit required');
 if(args.length===1 && ['--help','-h'].includes(args[0])){internals.stdout.write(help);exit(0);return;}
 const allowed=new Set(['--init','--resume','--enable-model-requests']);
 if(args.some(arg=>!allowed.has(arg)) || new Set(args).size!==args.length || args.includes('--init')===args.includes('--resume')){
  internals.stderr.write(help);exit(2);return;
 }
 ctx.provide('dshBotOwnerStartup',Object.freeze({mode:args.includes('--init')?'init':'resume',modelRequestsEnabled:args.includes('--enable-model-requests')}));
}
