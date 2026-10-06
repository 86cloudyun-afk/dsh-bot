import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {UserMessage} from '@deepseek-ai/dsh-llm';
import type {Host,WorkDelegation,WorkTarget,WorkSessionView,WorkSessionSnapshot,WorkProducerProvenance,WorkMessageBinding} from './contracts.js';
export type BotProducerSource = WorkProducerProvenance & WorkMessageBinding & {readonly kind:'dsh-bot'};
declare module '@deepseek-ai/dsh-llm' {interface MessageSourceMap {'dsh-bot':BotProducerSource}}
/** The protocol role is user; the producer source identifies a Bot, never a human. */
export type BotProducerMessage = Omit<UserMessage,'source'> & {readonly source:BotProducerSource};
export interface BotProducerDelegateRequest extends WorkDelegation {readonly operationId:string;readonly nonce:string}
export interface ObservedWorkResponse {readonly botId:string;readonly taskId:string;readonly sessionId:string;readonly generation:number;readonly producerId:string;readonly originSessionId:string;readonly inputMessageId:string;readonly responseMessageId:string;readonly responseSeq:number;readonly turn:number;readonly step:number;readonly text:string;readonly textDigest:string;readonly nativeSettlementVerified:false;readonly resultInputMessageId:string}
declare module '@deepseek-ai/dsh-llm' {interface MessageSourceMap {'dsh-bot-work-result':Omit<ObservedWorkResponse,'resultInputMessageId'>&{readonly kind:'dsh-bot-work-result';readonly task_id:string}}}
export interface OwnedBotProducerOptions {readonly ownerCtx:Context;readonly host:Host;readonly caller:object;readonly originAgent:Agent;readonly botId:string;readonly botEpoch:number;readonly authorityEpoch:number;readonly cwd:string;readonly rootInstructionRef:string;readonly execution?:{readonly isCurrent?:()=>boolean;readonly concludeDelegation?:boolean;readonly onFailure?:(category:string)=>void;readonly assertTargetTools?:(binding:WorkSessionView,agent:Agent)=>boolean;readonly beforeRoute?:(response:ObservedWorkResponse,input:Readonly<{messageId:string;text:string;task_id:string}>)=>void|Promise<void>;readonly authorizeDelegation?:(request:WorkDelegation)=>void;readonly beforeExecute:(binding:WorkSessionView,agent:Agent)=>Promise<void|Readonly<{expectedMarker:string;forbiddenMarkers?:readonly string[];waitWitness?:()=>object}>>;readonly onObserved?:(response:ObservedWorkResponse)=>void|Promise<void>}}
declare const ownedBotProducerBrand:unique symbol;
/** Explicit private launcher capability. Do not expose through ctx, RPC or UI. */
export interface OwnedBotProducer {
 readonly [ownedBotProducerBrand]:true;
 readonly delegate:(request:BotProducerDelegateRequest,signal?:AbortSignal)=>Promise<WorkSessionView>;
 readonly query:(selection:{readonly task_ids?:readonly string[]})=>WorkSessionSnapshot;
 readonly queue:(target:WorkTarget,signal?:AbortSignal)=>Promise<WorkSessionView>;
 readonly execute:(target:WorkTarget,signal?:AbortSignal)=>Promise<WorkSessionView>;
 readonly acknowledged:(target:WorkTarget)=>Readonly<{turn:number;responseMessageId:string;responseSeq:number}>|null;
 readonly dispose:()=>void;
}
export declare function installOwnedBotProducer(options:OwnedBotProducerOptions):OwnedBotProducer;
