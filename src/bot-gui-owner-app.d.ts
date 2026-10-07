import type {Context} from '@deepseek-ai/cordis';
import type {InitialSessionModeSnapshot} from './initial-session-blank.mjs';
export interface BotGuiOwnerConfig {
  homeDirectory:string;
  cwd:string;
  agentPreset?:string;
  route?:{provider:string;model:string;reasoning:string};
  initialMode?:InitialSessionModeSnapshot;
}
export declare const name:'dsh-bot-gui-owner-app';
export declare const inject:string[];
/** Retained private owner composition. Never expose the returned disposer or input Context through RPC. */
export declare function installBotGuiOwner(options:BotGuiOwnerConfig & {ownerCtx:Context;modelRequestsEnabled?:boolean}):Promise<Readonly<{dispose():Promise<void>}>>;
export declare function apply(ctx:Context,config:BotGuiOwnerConfig):void;
