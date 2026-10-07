/** Proposed plugin contracts. These declarations do not create native host capabilities. */
export type TrustedActor = Readonly<{kind:'human'|'bot'|'host'; id:string}>;
export type ModelRoute = Readonly<{provider:string;model:string;reasoning?:string|null}>;
export interface CommandEnvelope {
 operationId:string; ledgerInstanceId?:string; nonce:string; command:string; payloadDigest:string;
 expectedRevision:number|null; expectedEpochs:Record<string,number>;
 rootHumanInstructionRef:string; authorizationRef:string; createdAt:string; deadline:string|null;
}
export interface Receipt<T=unknown> { operationId:string; ledgerInstanceId:string|null; state:'received'; authority:'plugin-ledger'; observedAt:string; result:T }
export interface Capability {status:'unsupported'|'unverified'|'verified'; evidence:string}
export interface NativeRun {sessionId:string;runGeneration:string;fence:number}
export interface NativeAdapterContract {
 capabilities():Record<string,Capability>;
 listSessions(scope:{sessionIds:readonly string[]}):Promise<{items:readonly unknown[];complete:boolean;coverage:string;observedAt:string}>;
 inspectSession(id:string,scope:{sessionIds:readonly string[]}):Promise<unknown>;
 sessionModeCatalog?():AgentPresetCatalog;
 refreshSessionModeCatalog?():Promise<AgentPresetCatalog>;
}
export interface AgentPresetOption { readonly id:string;readonly name?:string;readonly description?:string;readonly isDefault:boolean }
/** Loaded metadata only; no composition revision or native execution proof. */
export interface AgentPresetCatalog { readonly domain:'agentPreset';readonly status:'available'|'unsupported'|'unavailable';readonly defaultId:string|null;readonly options:readonly AgentPresetOption[];readonly reason?:string }
/** Client/offline DTO; raw SessionController wire projections need a trusted translation. */
export interface AgentPresetSessionView { readonly id:string;readonly blank:boolean;readonly projectionValues?:Readonly<{agentPreset?:string|null}> }
/** Durable creation-only intent. No dispatch or paid execution capability. */
export interface CreationIntent {
 readonly nonce?:string;readonly plannedBinding?:OwnedGenerationBinding;readonly workDepth?:0|1;readonly parentBinding?:OwnedGenerationBinding;
 readonly workBinding?:Readonly<{task_id:string;generation:number}>;
 readonly kind?:'execution';readonly taskId?:string;readonly taskEpoch?:number;readonly taskRevision?:number;
 readonly operationId:string;readonly sessionId:string;readonly botId:string;readonly botEpoch:number;
 readonly configVersion:string;readonly cwd:string;readonly agentPreset:string;readonly authorizationRef:string;
 readonly authorityEpoch:number;readonly rootHumanInstructionRef:string;readonly deadline:string|null;
 readonly state:'prepared'|'creating'|'unknown'|'created'|'fenced';readonly stopped?:boolean;readonly errorCategory?:string;
 readonly receipt?:'returned'|'recovered_same_id';readonly confirmedAt?:string;readonly proof?:CreationProof;
}
export interface CreationProof { readonly sessionId:string;readonly agentPreset:string;readonly blank:boolean;readonly globalTools:number;readonly scopedTools:number }
export interface OwnedCreationPort {
 createOwnedSession(intent:CreationIntent):Promise<{sessionId:string}>;
 inspectOwnedCreation(intent:CreationIntent):Promise<CreationProof|null>;
}
/** Private SDK-branded history path; the original intent is only an exact selector. */
export interface OwnedGenerationCreationPort extends OwnedCreationPort {
 resumeOwnedSession(intent:CreationIntent,options?:Readonly<{delegateTool?:import('@deepseek-ai/dsh-tools').ToolDefinition}>):Promise<{sessionId:string}>;
}
export declare class Host {
 constructor(options:{ledger:Ledger;ownerHumanId:string;adapter?:NativeAdapterContract;ownerCapability?:object;workSessionRuntime?:OfflineWorkSessionRuntime});
 execute(actor:TrustedActor,envelope:CommandEnvelope,payload:unknown):Receipt;
 executeOwned(caller:object,envelope:CommandEnvelope,payload:unknown):Receipt;
 snapshot(actor:TrustedActor):Record<string,unknown>;
 /** Private owner read; exact scope, active native-owner and captured epoch required. */
 snapshotOwnedBotTasks(caller:object,scope:BotTaskReadScope):BotTaskReadRows;
 /** Retained owner capability; synchronously returns selected safe DTO fields only. */
 createOwnedBotTaskReadPort(caller:object,options?:OwnedBotTaskReadPortOptions):OwnedBotTaskReadPort;
 refreshSessionModeCatalog(actor:TrustedActor):Promise<AgentPresetCatalog>;
 /** Exact retained owner control; no credentials or native execution are granted. */
 openOwnedControlSession(caller:object,options:OwnedControlSessionOptions):OwnedControlSession;
 openOwnedWorkSessionPort(caller:object,options:OwnedWorkSessionOptions):OwnedWorkSessionPort;
 /** Native lifecycle is an explicit private owner path, independent of ordinary ledger commands. */
 openOwnedBotLifecyclePort(caller:object,options:import('./owned-bot-lifecycle.mjs').OwnedBotLifecycleOptions):Promise<import('./owned-bot-lifecycle.mjs').OwnedBotLifecyclePort>;
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
export interface BotConfigVersion { id:string;contact:ModelRoute;execution:ModelRoute;sessionModes:{plan:null;permissions:null};agentPreset?:string|null;autonomy:AutonomyPolicy;createdAt:string }
export interface NormalizedBotConfigVersion extends BotConfigVersion { agentPreset:string|null }
export interface ProgressPlan { planId:string;taskId:string;taskRevision:number;taskEpoch:number;botEpoch:number;authorityEpoch:number;configSnapshot:BotConfigVersion;policySnapshot:AutonomyPolicy;nextStepId:string;eventCursor:number;retryCount:number;state:'planned'|'waiting_native'|'reconciling_unknown'|'blocked';nativeExecutionVerified:false }
/** Public allowlist only; readiness and responsibility do not attest native execution. */
export interface BotReadDto { readonly botId:string;readonly name:string;readonly lifecycle:string;readonly readiness:string;readonly epoch:number;readonly revision:number }
export interface TaskReadDto { readonly taskId:string;readonly ownerBotId:string;readonly title:string;readonly responsibility:string;readonly epoch:number;readonly revision:number;readonly stop:Readonly<{state:string}> }
export type BotTaskReadDto =
 | Readonly<{version:1;status:'ready';bot:readonly BotReadDto[];task:readonly TaskReadDto[]}>
 | Readonly<{version:1;status:'not_configured'|'access_denied'|'read_failed';bot:null;task:null}>;
/** Internal existing Host records; these rows must pass the public allowlist projection. */
export interface BotTaskReadRows { readonly bot:readonly Record<string,unknown>[];readonly task:readonly Record<string,unknown>[] }
/** Fixed server-selected IDs; missing or invalid IDs refuse the entire read. */
export interface BotTaskReadSelection { readonly botIds:readonly string[];readonly taskIds:readonly string[] }
export interface BotTaskReadScope extends BotTaskReadSelection { readonly authorityEpoch:number }
export interface BotTaskReadSummary { readonly bot:readonly BotReadDto[];readonly task:readonly TaskReadDto[] }
declare const retainedOwnerReadPort:unique symbol;
/** Opaque Host-issued read capability. Runtime authenticity and ownership use private metadata. */
export interface OwnedBotTaskReadPort {
 readonly [retainedOwnerReadPort]:true;
 readonly snapshot:(selection:BotTaskReadSelection)=>BotTaskReadSummary;
}
export interface OwnedBotTaskReadPortOptions { readonly isCurrent?:()=>boolean }
/** Trusted resolver lease. isCurrent checks exact peer, generation and owner/peer lifetimes synchronously. */
export type BotTaskReadAccess =
 | (BotTaskReadScope & Readonly<{host:Host;caller:object;isCurrent:()=>boolean;readPort?:never}>)
 | (BotTaskReadSelection & Readonly<{readPort:OwnedBotTaskReadPort;isCurrent:()=>boolean;host?:never;caller?:never;authorityEpoch?:never}>);
export interface BotTaskReadSource { readForPeer(peer:unknown,signal:AbortSignal):Promise<Readonly<{status:'ready';snapshot:BotTaskReadSummary}>|Readonly<{status:'not_configured'|'access_denied'}>> }
export interface BotTaskReadSourceOptions { readonly resolveAccess?:(peer:unknown,signal:AbortSignal)=>BotTaskReadAccess|null|Promise<BotTaskReadAccess|null> }
/** Read-only Loader entry; configuration does not confer actor or owner authority. */
export declare function apply(ctx:{provide(name:string,value:unknown):(()=>void|Promise<void>)|void;effect(fn:()=>()=>Promise<void>):unknown;get?(name:string):unknown;connection?:{rpc:{handle(channel:string,handler:(endpoint:string,payload:unknown,signal:AbortSignal,peer:unknown)=>Promise<unknown>):unknown}}}):Readonly<{snapshot():Record<string,unknown>;execute():never}>;

/** Ordinary identity, never an invocation credential. */
export interface OwnedControlSessionOpenPayload { readonly controlSessionId:string }
export interface OwnedControlSessionOptions { readonly envelope:CommandEnvelope; readonly payload:OwnedControlSessionOpenPayload; readonly isCurrent?:()=>boolean }
export interface OwnedControlSessionTarget { readonly controlSessionId:string }
export interface OwnedControlSessionSelect extends OwnedControlSessionTarget { readonly botId:string; readonly expectedBotRevision:number }
export interface OwnedControlSessionCreate extends OwnedControlSessionTarget {
 readonly name:string;
 readonly config:{readonly contact:ModelRoute; readonly execution?:ModelRoute; readonly agentPreset?:string|null;
  readonly sessionModes?:{readonly plan:null;readonly permissions:null}; readonly autonomy?:AutonomyPolicy};
}
export interface OwnedControlSessionQuery extends OwnedControlSessionTarget,BotTaskReadSelection {}
export interface OwnedControlSessionState {
 readonly controlSessionId:string; readonly state:'open'|'disposed'; readonly revision:number; readonly epoch:number;
 readonly authorityEpoch:number; readonly memberCount:number; readonly selectedBotId:string|null;
}
export interface OwnedControlSessionBot extends BotReadDto {
 readonly configVersion:string;
 readonly config:Readonly<{contact:ModelRoute;execution:ModelRoute;agentPreset:string|null}>;
}
export interface OwnedControlSessionSummary extends OwnedControlSessionState { readonly bot:readonly OwnedControlSessionBot[]; readonly task:readonly TaskReadDto[] }
export interface OwnedControlSessionChange extends OwnedControlSessionState { readonly bot:OwnedControlSessionBot }
declare const retainedOwnerControlSession:unique symbol;
/** Host-issued retained capability; cannot be fabricated from serialized identities. */
export interface OwnedControlSession {
 readonly [retainedOwnerControlSession]:true; readonly controlSessionId:string;
 readonly selectExistingBot:(e:CommandEnvelope,p:OwnedControlSessionSelect)=>Receipt<OwnedControlSessionChange>;
 readonly createBot:(e:CommandEnvelope,p:OwnedControlSessionCreate)=>Receipt<OwnedControlSessionChange>;
 readonly query:(e:CommandEnvelope,p:OwnedControlSessionQuery)=>Receipt<OwnedControlSessionSummary>;
 readonly dispose:(e:CommandEnvelope,p:OwnedControlSessionTarget)=>Receipt<OwnedControlSessionState>;
}

/** Work identity and reservation contract; these types confer no native execution authority. */
export interface WorkDelegation {readonly task_id:string;readonly goal:string;readonly completion_condition:string}
export interface WorkTarget {readonly task_id:string;readonly generation:number}
export interface WorkSlotLease {readonly taskId:string;readonly sessionId:string;readonly generation:number;readonly operationId:string}
export interface WorkBinding extends WorkSlotLease {readonly botId:string;readonly botEpoch:number;readonly taskEpoch:number;readonly taskRevision:number;readonly configVersion:string;readonly authorityEpoch:number}
export type WorkState='queued'|'admitted'|'running'|'settling'|'unknown'|'waiting'|'completed'|'failed'|'archived';
export type WorkUnsupportedCode='unsupported_work_generation_receipts'|'legacy_work_unreconciled'|'capacity_exhausted'|'work_start_not_invoked'|'work_start_unknown'|'work_stop_unconfirmed'|'work_generation_fenced'|'work_lookup_timeout'|'work_lookup_failed'|'work_receipt_unknown';
export interface WorkFence {readonly reason:'terminate'|'handoff'|'resumed';readonly generation:number;readonly operationId:string}
export interface WorkSessionView extends WorkDelegation {
 readonly depth:0|1;readonly parentTaskId:string|null;readonly parentSessionId:string|null;readonly parentGeneration:number|null;
 readonly botId:string;readonly taskId:string;readonly sessionId:string;readonly generation:number;readonly revision:number;readonly taskEpoch:number;
 readonly state:WorkState;readonly creationState:'reserved'|'confirmed'|'unknown';readonly held:boolean;readonly fence:WorkFence|null;
 readonly creationOperationId:string|null;readonly creationReceipt:CreationProof|null;readonly sessionCreation:WorkSessionCreation;readonly delivery:WorkDeliveryReceipt|null;
 readonly slotLease:WorkSlotLease|null;readonly summary:string|null;readonly unsupported:WorkUnsupportedCode|null;
 /** True verifies only this original generation's branded settlement, never all session history. */readonly evidenceKind:'unsupported'|'offline-synthetic'|'native-sdk';readonly nativeRuntimeVerified:boolean;
 readonly generationObservation:WorkGenerationObservation;
}
/** Serializable observations only; local return or usage defaults never imply settlement. */
export interface WorkGenerationObservation {readonly local:'unknown'|'pending'|'returned';readonly remote:'UNKNOWN'|'settled';readonly usageKnown:boolean;readonly usage:Readonly<{inputTokens:number;outputTokens:number;totalTokens?:number;cacheReadTokens?:number;cacheWriteTokens?:number;reasoningTokens?:number}>|null;readonly settlementVerified:boolean}
export interface WorkSessionSnapshot {readonly work:readonly WorkSessionView[];readonly held:number;readonly limit:15;readonly coverage:'owner-contract-ledger';readonly nativeCoverageVerified:false}
/** Returned only by the exact privately retained source, never accepted as a port input. */
export interface WorkRuntimeReceipt {
 readonly receiptId:string;readonly sourceId:string;readonly sourceSeq:number;readonly binding:WorkBinding;
 readonly state:Exclude<WorkState,'queued'|'admitted'>;readonly execution:'may-execute'|'quiescent';readonly creation:'confirmed'|'unknown';readonly summary?:string;
}
/** Constructor-only test seam. This explicit synthetic source is never stock native acceptance. */
export interface OfflineWorkSessionRuntime {
 readonly kind:'offline-synthetic';readonly sourceId:string;
 readonly start:(binding:WorkBinding,signal:AbortSignal)=>Promise<WorkRuntimeReceipt>;
 readonly inspect:(binding:WorkBinding,signal:AbortSignal)=>Promise<WorkRuntimeReceipt|null>;
}
export type WorkSessionCreation = Readonly<{state:'none';proofKind:null}> | Readonly<{state:'unknown';proofKind:null;operationId:string;sessionId:string;agentPreset:string}> | Readonly<{state:'created';proofKind:'stock-session-durable'|'fixture-contract';operationId:string;sessionId:string;agentPreset:string}>;
/** Historical durable insertion only, not current inbox membership or execution. */
export interface WorkDeliveryReceipt {readonly operationId:string;readonly messageId:string;readonly sessionId:string;readonly generation:number;readonly state:'prepared'|'sending'|'durably-queued'|'unknown'|'fenced'}
export interface WorkProducerProvenance {readonly producerId:string;readonly ingress:'owner'|'bot-tool';readonly originSessionId:string;readonly callId?:string;readonly rootCallId?:string}
export interface WorkMessageBinding {readonly botId:string;readonly taskId:string;readonly sessionId:string;readonly generation:number;readonly operationId:string}
export interface WorkProducerMessage {readonly id:string;readonly role:'user';readonly content:readonly unknown[];readonly source:WorkProducerProvenance&WorkMessageBinding&{readonly kind:'dsh-bot'}}
/** Owner-only capability, captured synchronously once per original creation intent. */
export type OwnedWorkCreationOptions = Readonly<{cwd:string;reserveGeneration?:boolean;bindSource?:(intent:CreationIntent,port:OwnedCreationPort,options:Readonly<{mode:'create'|'resume'}>)=>void;childPortFor?:(intent:CreationIntent,original:Readonly<{parentSource:object;parentGeneration:object;parentBinding:OwnedGenerationBinding;mode:'create'}>)=>OwnedCreationPort}> & (Readonly<{port:OwnedCreationPort;portFor?:never}>|Readonly<{port?:never;portFor:(intent:CreationIntent)=>OwnedCreationPort}>);
/** Configuration travels separately from the native preparation; runtime branding is mandatory. */
export interface OwnedGenerationRoute {readonly provider:string;readonly model:string;readonly maxTokens:number;readonly reasoningEffort:'off'}
export interface OwnedGenerationBinding extends WorkBinding {readonly nonce:string;readonly inputMessageId:string;readonly messageIdentity:string;readonly slotLease:WorkSlotLease;readonly parentWorkBinding?:OwnedGenerationBinding}
export interface OwnedGenerationPreparation {readonly prepared:unknown;readonly route:OwnedGenerationRoute;readonly creationIntent?:Readonly<{binding:CreationIntent;operationId:string;nonce:string}>;readonly selectHistory?:(binding:Readonly<Record<string,unknown>>)=>Promise<unknown>}
/** Private open-time transport. Never accept these methods from tool or RPC arguments. */
export interface OwnedWorkProducerOptions {readonly execution?:boolean;readonly requireOwnedGeneration?:boolean;readonly provenance:WorkProducerProvenance;readonly isCurrent:()=>boolean;readonly createMessage:(binding:WorkMessageBinding,provenance:WorkProducerProvenance,content:string)=>WorkProducerMessage;readonly send:(binding:WorkMessageBinding,message:WorkProducerMessage,signal?:AbortSignal)=>Promise<void>;readonly inspect:(binding:WorkMessageBinding,message:WorkProducerMessage,signal?:AbortSignal)=>Promise<boolean>}
export interface OwnedWorkSessionOptions {readonly botId:string;readonly botEpoch:number;readonly authorityEpoch:number;readonly isCurrent?:()=>boolean;readonly creation?:OwnedWorkCreationOptions;readonly producer?:OwnedWorkProducerOptions}
export interface WorkChildRequest extends WorkDelegation {readonly parentTaskId:string;readonly parentSessionId:string;readonly parentGeneration:number}
declare const ownedWorkSessionBrand:unique symbol;
export interface OwnedWorkSessionPort {
 readonly [ownedWorkSessionBrand]:true;
 readonly delegate:(envelope:CommandEnvelope,payload:WorkDelegation)=>Receipt<WorkSessionView>;
 readonly query:(selection:{readonly task_ids?:readonly string[]})=>WorkSessionSnapshot;
 readonly admit:(envelope:CommandEnvelope,payload:WorkTarget)=>Receipt<WorkSessionView>;
 readonly createSession:(envelope:CommandEnvelope,target:WorkTarget)=>Promise<WorkSessionView>;
 /** Genuine sealed-history source restore; performs no model send or old-input replay. */
 readonly restoreSession:(target:WorkTarget)=>Promise<WorkSessionView>;
 readonly queueMessage:(envelope:CommandEnvelope,target:WorkTarget,signal?:AbortSignal)=>Promise<WorkSessionView>;
 /** Wake original once and retain held/unknown when native terminal support is absent. */
 readonly executeMessage:(envelope:CommandEnvelope,target:WorkTarget,signal?:AbortSignal)=>Promise<WorkSessionView>;
 readonly collect:(target:WorkTarget)=>Promise<WorkSessionView>;
 /** Read only this original generation; never starts or replaces it. */readonly inspectOriginalGeneration:(target:WorkTarget)=>Promise<WorkSessionView>;
 readonly fence:(envelope:CommandEnvelope,payload:WorkTarget&{readonly reason:'terminate'|'handoff'})=>Receipt<WorkSessionView>;
 /** Persist the product fence before requesting exact retained native-generation cancellation. */
 readonly stop:(envelope:CommandEnvelope,payload:WorkTarget&{readonly reason:'terminate'|'handoff'})=>Promise<WorkSessionView>;
 readonly resume:(envelope:CommandEnvelope,payload:WorkTarget)=>Receipt<WorkSessionView>;
 /** Safe private admission query; actual continuation still performs a fresh branded receipt check. */
 readonly canResumeOriginal:(target:WorkTarget)=>boolean;
 readonly spawnChild:{(request:WorkChildRequest):Readonly<{status:'unsupported';code:'child_spawn_unsupported'}>;(envelope:CommandEnvelope,request:WorkChildRequest,signal?:AbortSignal):Promise<WorkSessionView>};
 readonly dispose:()=>void;
}
