import type {Ledger} from './ledger.mjs';
/** Private composition checks; neither these callbacks nor durable DTOs grant native authority. */
export declare function createGuiGenerationPolicy(options:{
  ledger:Ledger;
  botId:string;
  botEpoch:number;
  configVersion:string;
  authorityEpoch:number;
  mainSessionId:string;
  sessionId:string;
  role:'main'|'work';
  ledgerId:string;
  isOwnerCurrent:()=>boolean;
  canModelDispatch:()=>boolean;
}):Readonly<{isCurrent(binding:unknown):boolean;canDispatch(binding:unknown):boolean}>;
