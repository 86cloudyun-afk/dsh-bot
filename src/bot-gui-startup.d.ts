import type {Context} from '@deepseek-ai/cordis';
export interface BotGuiStartup {
  host:'127.0.0.1';port:number;openBrowser:false;trustedHosts:string[];modelRequestsEnabled:boolean;
}
export declare const name:'dsh-bot-gui-startup';
export declare const inject:string[];
export declare function parseBotGuiArguments(args:string[]):BotGuiStartup;
export declare function apply(ctx:Context):void;
