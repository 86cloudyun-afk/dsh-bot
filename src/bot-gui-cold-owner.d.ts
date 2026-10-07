import type {Context} from '@deepseek-ai/cordis';
import type {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import type {Host} from './host.mjs';
/** Private authenticated history reader. It has no write, stop, model or native proof capability. */
export declare function installBotGuiColdOwner(options:{ownerCtx:Context;host:Host;connection:HostConnectionService;
  peer:HostConnectionService['operator'];connectionGeneration:object;getConnectionGeneration:()=>object|null;
  botId:string;mainSessionId:string;isOwnerCurrent:()=>boolean}):Readonly<{dispose():void}>;
