import type {Context} from '@deepseek-ai/cordis';
import type {Host} from './host.mjs';
import type {CreationIntent,OwnedGenerationPreparation,OwnedGenerationBinding} from './contracts.js';
import type {InitialSessionModeSnapshot} from './initial-session-blank.mjs';
/** Private native preparation. Capability fields never enter any public DTO or ledger. */
export declare function createGuiGenerationPreparation(options:{
  ownerCtx:Context;host:Host;homeDirectory:string;cwd:string;agentPreset:string;
  route:{provider:string;model:string;reasoning:string};initialization?:InitialSessionModeSnapshot;
  isOwnerCurrent:()=>boolean;canModelDispatch:()=>boolean;
}):Readonly<{
  prepare(intent:CreationIntent,options:{role:'main'|'work';create:boolean;mainSessionId:string;delegateTool?:unknown;plannedBinding?:OwnedGenerationBinding}):Promise<Readonly<OwnedGenerationPreparation>>;
  /** Genuine original parent capabilities are supplied only by the private product callback. */
  prepareChild(intent:CreationIntent,options:{create:boolean;mainSessionId:string;parentSource:unknown;parentGeneration:unknown;parentBinding:OwnedGenerationBinding}):Promise<Readonly<OwnedGenerationPreparation>>;
  close():Promise<void>;
}>;
