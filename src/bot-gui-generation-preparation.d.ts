import type {Context} from '@deepseek-ai/cordis';
import type {Host} from './host.mjs';
import type {CreationIntent,OwnedGenerationPreparation,OwnedGenerationBinding} from './contracts.js';
import type {InitialSessionModeSnapshot} from './initial-session-blank.mjs';
import type {OwnedBotLifecycleRestoreGrant,OwnedBotLifecycleRestoreOptions} from './owned-bot-lifecycle.mjs';
/** Exact pre-native JSON selector. It cannot mint a journal, history or archive capability. */
export interface GuiOriginalCreationSelector {readonly binding:CreationIntent;readonly operationId:string;readonly nonce:string}
export type GuiGenerationPreparation=Readonly<OwnedGenerationPreparation&{creationIntent:GuiOriginalCreationSelector}>;
export interface GuiHistoryInspectionOptions {readonly purpose:'archive-restore'|'active-recovery';readonly role:'main'|'work';readonly originalCreationIntent:GuiOriginalCreationSelector}
/** Private native preparation. Capability fields never enter any public DTO or ledger. */
export declare function createGuiGenerationPreparation(options:{
  ownerCtx:Context;host:Host;homeDirectory:string;cwd:string;agentPreset:string;
  route:{provider:string;model:string;reasoning:string};initialization?:InitialSessionModeSnapshot;
  isOwnerCurrent:()=>boolean;canModelDispatch:()=>boolean;
}):Readonly<{
  prepare(intent:CreationIntent,options:{role:'main'|'work';create:boolean;mainSessionId:string;delegateTool?:unknown;plannedBinding?:OwnedGenerationBinding}):Promise<GuiGenerationPreparation>;
  /** Genuine original parent capabilities are supplied only by the private product callback. */
  prepareChild(intent:CreationIntent,options:{create:boolean;mainSessionId:string;parentSource:unknown;parentGeneration:unknown;parentBinding:OwnedGenerationBinding;plannedBinding:OwnedGenerationBinding}):Promise<GuiGenerationPreparation>;
  /** Scope comes from the genuine product grant; historical authorization comes from SDK sealed selectors. */
  prepareRestore(intent:CreationIntent,options:OwnedBotLifecycleRestoreOptions&{delegateTool?:unknown}):Promise<GuiGenerationPreparation>;
  readOriginalCreation(intent:CreationIntent):GuiOriginalCreationSelector;
  inspectOriginalHistory(intent:CreationIntent,options:GuiHistoryInspectionOptions):Promise<Readonly<{journal:unknown;selectHistory(binding:Readonly<Record<string,unknown>>):Promise<unknown>}>>;
  inspectArchivedHistory(intent:CreationIntent,options:Omit<GuiHistoryInspectionOptions,'purpose'>):Promise<Readonly<{journal:unknown;selectHistory(binding:Readonly<Record<string,unknown>>):Promise<unknown>}>>;
  releaseArchivedJournals(grant:OwnedBotLifecycleRestoreGrant):Promise<void>;
  close():Promise<void>;
}>;
