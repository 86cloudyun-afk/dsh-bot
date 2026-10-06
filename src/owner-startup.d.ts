/** Native argument choices only; these values carry no caller authority. */
export interface OwnerStartupChoices {
 readonly mode:'init'|'resume';
 readonly modelRequestsEnabled:boolean;
}
export interface OwnerStartupServices {
 cmdlineArgs:{get():readonly string[]};
 appExit:(code:number)=>unknown;
}
export interface OwnerStartupContext {
 get<K extends keyof OwnerStartupServices>(name:K):OwnerStartupServices[K]|undefined;
 provide(name:'dshBotOwnerStartup',choices:Readonly<OwnerStartupChoices>):unknown;
}
export declare const name:'dsh-bot-owner-startup';
export declare const inject:readonly ['cmdlineArgs'];
/** Reads native launcher arguments and provides validated startup choices. */
export declare function apply(ctx:OwnerStartupContext):void;
