import type{Context}from'@deepseek-ai/cordis';import type{Readable,Writable}from'node:stream';
export declare const name:'dsh-bot-chain-owner-app';export declare const inject:readonly string[];
export declare const CHAIN_FIXTURES:readonly Readonly<{task_id:string;goal:string;completion_condition:string}>[];
export declare function apply(ctx:Context,config:{homeDirectory:string;cwd:string;continuation?:ChainContinuationExpected;input?:Readable;output?:Writable}):Promise<void>;
export interface ChainContinuationExpected {readonly botId:string;readonly mainSessionId:string;readonly requestIds:readonly string[];readonly historyDigest:string}
export interface ChainHistoricalAcknowledgment {readonly turn:number;readonly responseMessageId:string;readonly responseSeq:number}
export declare function verifyChainContinuation(value:unknown,expected:ChainContinuationExpected&{readonly cwd:string}):Readonly<{acknowledgment:ChainHistoricalAcknowledgment;source:Readonly<Record<string,unknown>>;inputText:string;resultInputMessageId:string;task_id:'fixture-one';oldWorkHeld:true}>;
export declare function deriveChainCheckinAcknowledgment(events:readonly unknown[],messageId:string,text:string):ChainHistoricalAcknowledgment|null;
