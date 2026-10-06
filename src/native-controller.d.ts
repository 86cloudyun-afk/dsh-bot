import type { Context } from '@deepseek-ai/cordis';
import type { NativeCapacity,NativeOperation,NativeTarget } from '@deepseek-ai/dsh-experimental-native-run';
import type { CommandEnvelope,CreationIntent,Ledger,Receipt,AgentPresetCatalog } from './contracts.js';
import type {OwnedWorkSessionOptions,OwnedWorkSessionPort,OwnedBotTaskReadPort,OwnedControlSessionOptions,OwnedControlSession} from './contracts.js';
import type {ExplicitOperatorReadBinding} from './explicit-operator-read-binding.js';
export interface ProductNativeOperation {
 readonly operationId:string;readonly nativeOperationId:string;readonly targetId:string;
 readonly kind:'contact'|'execution';readonly steps:readonly string[];readonly inputDigest:string;
 readonly deadline:string|null;readonly acceptanceSourceVersion?:string;
 readonly workingSetVersion?:string;readonly workingSetPhase?:'dispatch'|'resume';
 readonly binding:NativeTarget;readonly state:'prepared'|'admitting'|'admitted'|'driving'|'consumed'|'settled'|'fenced'|'unknown'|'blocked';
 readonly native:NativeOperation|null;readonly stop:Record<string,unknown>|null;readonly errorCategory?:string;
}
/** Private actual runtime-owner entry. Do not expose its methods or owner through Cordis/RPC. */
export declare class OwnedNativeController {
 constructor(options:{ctx:Context;ledger:Ledger;ownerLabel:string;directory:string;capacity:NativeCapacity;
  workingSetEnabled?:boolean;
  acceptanceGuard?:(input:{phase:'prepare'|'dispatch';operationId:string;kind:'contact'|'execution';steps:readonly string[];acceptanceSourceVersion?:string})=>string});
 command<T=unknown>(caller:object,envelope:CommandEnvelope,payload:unknown):Receipt<T>;
 readPort(caller:object):OwnedBotTaskReadPort;
 /** Owner-only work contract. Default runtime remains nonexecuting/unsupported. */
 workPort(caller:object,options:OwnedWorkSessionOptions):OwnedWorkSessionPort;
 /** Private management projection; invalidated by exact owner fiber/controller lifetime. */
 controlPort(caller:object,options:OwnedControlSessionOptions):OwnedControlSession;
 /** Atomic private Host+owner installation; the returned object contains only read controls. */
 installReadSource(caller:object):ExplicitOperatorReadBinding;
 refreshModes(caller:object):Promise<AgentPresetCatalog>;
 open(caller:object,options:{contactCreationId:string;executionCreationId:string;create:boolean;maxTokens?:{contact:number;execution:number}}):Promise<void>;
 createSession(caller:object,creationId:string):Promise<CreationIntent>;
 admit(caller:object,operationId:string):Promise<ProductNativeOperation>;
 drive(caller:object,operationId:string):Promise<ProductNativeOperation>;
 inspect(caller:object,operationId:string):ProductNativeOperation;
 stop(caller:object,controlId:string):Promise<ProductNativeOperation>;
 snapshot(caller:object):{authority:'private-runtime-owner';publicHumanAuthorityVerified:false;nativeRuntimeVerified:false;releaseReady:false;privateProductPathVerified:boolean;nativeOperations:ProductNativeOperation[];recoveryWorkingSets?:Record<'contact'|'execution',{context:Readonly<Record<string,unknown>>;text:string;version:string}>};
 close(caller:object):Promise<void>;
}
