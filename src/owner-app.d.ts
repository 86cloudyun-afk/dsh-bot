import type { Context } from '@deepseek-ai/cordis';
import type { NativeCapacity } from '@deepseek-ai/dsh-experimental-native-run';
import type { Readable,Writable } from 'node:stream';
export interface OwnerAcceptanceSource {
 readonly candidatePath:string;
 readonly summaryPath:string;
 readonly runtimeIdentityPath:string;
 readonly templatePath:string;
 readonly runtimeDirectory:string;
}
/** Private owner configuration; neither JSON actors nor configuration confer authority. */
export interface OwnerAppConfig {
 /** Explicit existing absolute owner home, validated before state writers open. */
 readonly homeDirectory:string;
 readonly agentPreset?:string;
 readonly maxTokens?:Readonly<{contact:number;execution:number}>;
 readonly capacity?:NativeCapacity;
 readonly input?:Readable;
 readonly output?:Writable;
 /** Caller-selected public evidence paths; runtime checks absolute origins and hashes. */
 readonly acceptanceSource?:OwnerAcceptanceSource;
}
export declare const name:'dsh-bot-owner-app';
export declare const inject:readonly ['dshBotOwnerStartup','appReady','appExit','llm','sessions','sessionProjections','sessionPersistence','tools','agents','agentPresets','deepseekProtectedProviders'];
/** Requires the whole reviewed development SDK and a live native Cordis owner fiber.
 * Resolves after boot/readiness registration; subsequent commands use the input stream. */
export declare function apply(ctx:Context,config:OwnerAppConfig):Promise<void>;
