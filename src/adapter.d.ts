import type { Context } from '@deepseek-ai/cordis';
import type { scopeOf as nativeScopeOf } from '@deepseek-ai/dsh-scope';
import type { AgentPresetCatalog,CreationIntent,OwnedCreationPort,OwnedGenerationCreationPort,OwnedGenerationPreparation } from './contracts.js';
import type {ToolDefinition} from '@deepseek-ai/dsh-tools';
import type {InitialSessionModeSnapshot} from './initial-session-blank.mjs';
export declare const REQUIRED_NATIVE:readonly ['session_model','dispatch_freeze','operation_lookup','run_fence','resource_settlement','producer','scope_enforce','interaction_capacity'];
export type RequiredNativeCapability = typeof REQUIRED_NATIVE[number];
export interface AdapterSessionRecord {readonly sessionId?:string;readonly id?:string}
export interface AdapterSession {readonly id:string;readonly seq:number;readonly snapshotEvents?:()=>readonly unknown[]}
export interface AdapterAgent {readonly id:string;readonly session:AdapterSession;readonly ctx:Context}
export interface AdapterContext {
 sessionController?:{
  list(request:Record<string,never>,signal:AbortSignal):Promise<{items:readonly AdapterSessionRecord[]}>;
  /** The raw host result is returned unchanged; callers must narrow its actual contract. */
  inspect(id:string,signal:AbortSignal):Promise<unknown>;
  create?(request:Pick<CreationIntent,'sessionId'|'cwd'|'agentPreset'>):Promise<{sessionId:string}>;
 };
 agentPresets?:{
  list():readonly {readonly id:string;readonly name?:string;readonly description?:string;readonly broken?:unknown}[]|Promise<readonly {readonly id:string;readonly name?:string;readonly description?:string;readonly broken?:unknown}[]>;
  readonly defaultId?:string|null;
 };
 sessions?:{get(id:string):AdapterSession|undefined};
 agents?:{get(id:string):AdapterAgent|undefined};
 sessionProjections?:{stateOf(session:AdapterSession,key:'agentPreset'):unknown};
 tools?:{schemas(scope?:object):readonly unknown[]};
}
export interface UnsupportedOperation<T extends string=string> {
 status:'unsupported';operation:T;reason:string;
}
/** Read-only host adapter. A context is a service reference, never authenticated actor JSON. */
export declare class DshAdapter {
 constructor(context?:Context|AdapterContext|null);
 context:Context|AdapterContext|null;
 capabilities():Record<RequiredNativeCapability,{status:'unsupported';evidence:string}>;
 listSessions(scope:{sessionIds:readonly string[]}):Promise<{items:AdapterSessionRecord[];complete:false;coverage:string;observedAt:string}>;
 inspectSession(id:string,scope:{sessionIds:readonly string[]}):Promise<unknown>;
 sessionModeCatalog():AgentPresetCatalog;
 refreshSessionModeCatalog():Promise<AgentPresetCatalog>;
 /** Private owned creation port; scopeOf must return the exact mounted Agent identity. */
 ownedCreationPort(sessionIds:readonly string[],options:{scopeOf:typeof nativeScopeOf;durable?:boolean;initialization?:InitialSessionModeSnapshot}):OwnedCreationPort;
 /** Explicit private creation: actual prepared SDK brand and retained native handle are required. */
 ownedGenerationCreationPort(sessionIds:readonly string[],options:{scopeOf:typeof nativeScopeOf;role:'main'|'work';prepareGeneration:(intent:CreationIntent,options:Readonly<{mode:'create'|'resume';delegateTool?:ToolDefinition}>)=>OwnedGenerationPreparation|Promise<OwnedGenerationPreparation>;isCurrent:()=>boolean;initialization?:InitialSessionModeSnapshot}):OwnedGenerationCreationPort;
 /** Called once with the exact registered native ToolDefinition before first main input. */
 bindOwnedMainGeneration(port:OwnedCreationPort,intent:CreationIntent,delegateTool:ToolDefinition):object;
 unsupported<T extends string>(operation:T):UnsupportedOperation<T>;
 selectSessionModel():UnsupportedOperation<'selectSessionModel'>;
 dispatch():UnsupportedOperation<'dispatchPermit'>;
 inspectOperation():UnsupportedOperation<'inspectOperation'>;
 stopRun():UnsupportedOperation<'stopRun'>;
 archiveSession():UnsupportedOperation<'archiveSession'>;
 restoreSession():UnsupportedOperation<'restoreSession'>;
}
