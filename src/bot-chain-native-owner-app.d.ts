import type{Context}from'@deepseek-ai/cordis';import type{Readable,Writable}from'node:stream';
export declare const name:'dsh-bot-native-phase-app';export declare const inject:readonly string[];
export interface NativePhaseBaseline{readonly botId:string;readonly mainSessionId:string;readonly historyDigest:string}
export declare function apply(ctx:Context,config:{homeDirectory:string;cwd:string;baseline:NativePhaseBaseline;input?:Readable;output?:Writable}):Promise<void>;
export declare function verifyNativeStageEligibility(value:unknown,expected:NativePhaseBaseline&{readonly cwd:string}):Readonly<{historicalConfirmedRequests:9;historyDigest:string;heldUnknown:2;lastMainTurn:5;acknowledgments:readonly Readonly<{task_id:string;turn:number;responseMessageId:string;responseSeq:number}>[]}>;
