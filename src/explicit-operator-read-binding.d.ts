import type {Context} from '@deepseek-ai/cordis';
import type {Host,OwnedBotTaskReadPort,BotTaskReadSelection,BotTaskReadSource} from './contracts.js';
export type {OwnedBotTaskReadPort,BotTaskReadSelection,BotTaskReadSource} from './contracts.js';
export interface ExplicitOperatorReadSelection extends BotTaskReadSelection {
 readonly audience:'this-host-authenticated-operator';
}
/** Trusted private installation inputs. expectedHost independently identifies the owning Host. */
export interface ExplicitOperatorReadBindingOptions {
 readonly ownerCtx:Context;
 readonly expectedHost:Host;
 readonly readPort:OwnedBotTaskReadPort;
}
export interface ExplicitOperatorReadBinding {
 readonly source:BotTaskReadSource;
 select(selection:ExplicitOperatorReadSelection):void;
 revoke():void;
 close():void;
}
/** Exact Host+owner proof and real Connection/operator required; default not_configured. */
export declare function createExplicitOperatorReadBinding(options:ExplicitOperatorReadBindingOptions):ExplicitOperatorReadBinding;
/** Registers only dshBotReadSource in the owning Context; selection remains explicit. */
export declare function installExplicitOperatorReadBinding(options:ExplicitOperatorReadBindingOptions):ExplicitOperatorReadBinding;
declare module '@deepseek-ai/cordis' {
 interface Context { dshBotReadSource:BotTaskReadSource }
}
