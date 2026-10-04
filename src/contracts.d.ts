/** Proposed plugin contracts. These declarations do not create native host capabilities. */
export type TrustedActor = Readonly<{kind:'human'|'bot'|'host'; id:string}>;
export type ModelRoute = Readonly<{provider:string;model:string;reasoning?:string|null}>;
export interface CommandEnvelope {
 operationId:string; nonce:string; command:string; payloadDigest:string;
 expectedRevision:number|null; expectedEpochs:Record<string,number>;
 rootHumanInstructionRef:string; authorizationRef:string; createdAt:string; deadline:string|null;
}
export interface Receipt<T=unknown> { operationId:string; state:'received'; authority:'plugin-ledger'; observedAt:string; result:T }
export interface Capability {status:'unsupported'|'unverified'|'verified'; evidence:string}
export interface NativeRun {sessionId:string;runGeneration:string;fence:number}
export interface NativeAdapterContract {
 capabilities():Record<string,Capability>;
 listSessions(scope:{sessionIds:readonly string[]}):Promise<{items:readonly unknown[];complete:boolean;coverage:string;observedAt:string}>;
 inspectSession(id:string,scope:{sessionIds:readonly string[]}):Promise<unknown>;
}
export declare class Host {
 constructor(options:{ledger:Ledger;ownerHumanId:string;adapter?:NativeAdapterContract});
 execute(actor:TrustedActor,envelope:CommandEnvelope,payload:unknown):Receipt;
 snapshot(actor:TrustedActor):Record<string,unknown>;
}
export declare class Ledger {
 constructor(path:string);
 close():void;
 transaction<T>(fn:()=>T):T;
 get(kind:string,id:string):any|null;
 list(kind:string):any[];
 put(kind:string,id:string,value:unknown):unknown;
 inspectOperation(actor:TrustedActor,id:string):Receipt;
}
export interface AutonomyPolicy { enabled:boolean;maxSteps:number;maxRetries:number;observationDeadline:string|null;reportMilestonesOnly:boolean }
export interface BotConfigVersion { id:string;contact:ModelRoute;execution:ModelRoute;sessionModes:{plan:null;permissions:null};autonomy:AutonomyPolicy;createdAt:string }
export interface ProgressPlan { planId:string;taskId:string;taskRevision:number;taskEpoch:number;botEpoch:number;authorityEpoch:number;configSnapshot:BotConfigVersion;policySnapshot:AutonomyPolicy;nextStepId:string;eventCursor:number;retryCount:number;state:'planned'|'waiting_native'|'reconciling_unknown'|'blocked';nativeExecutionVerified:false }
export declare function apply(ctx:{provide(name:string,value:unknown):(()=>void)|void;effect(fn:()=>()=>Promise<void>):unknown},options:{databasePath:string;ownerHumanId:string}):Readonly<{snapshot():Record<string,unknown>;execute():never}>;
