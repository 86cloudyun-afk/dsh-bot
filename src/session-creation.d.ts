import type { Host,CreationIntent,OwnedCreationPort } from './contracts.js';
export type { CreationIntent,CreationProof,OwnedCreationPort } from './contracts.js';
/** Private launcher entry via dsh-bot/session-creation; never expose through ctx/RPC. */
export declare class SessionCreationDriver {
 constructor(options:{host:Host;caller:object;port:OwnedCreationPort;isCurrent?:()=>boolean});
 run(caller:object,operationId:string):Promise<CreationIntent>;
}
