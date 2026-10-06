import type {Host,OwnedBotTaskReadPort} from './contracts.js';
export { Host } from './contracts.js';
export type {OwnedBotTaskReadPort,OwnedBotTaskReadPortOptions,BotTaskReadSelection,BotTaskReadSummary} from './contracts.js';
/** Authenticity alone does not confer authority. */
export declare function isOwnedBotTaskReadPort(port:unknown):port is OwnedBotTaskReadPort;
/** Boolean proof for a trusted expected Host and its retained owner; exposes no metadata. */
export declare function isOwnedBotTaskReadPortForHost(port:unknown,host:Host,caller:object):boolean;

export type {CommandEnvelope,Receipt,ModelRoute,AutonomyPolicy,OwnedControlSession,OwnedControlSessionOptions,OwnedControlSessionOpenPayload,OwnedControlSessionTarget,OwnedControlSessionSelect,OwnedControlSessionCreate,OwnedControlSessionQuery,OwnedControlSessionState,OwnedControlSessionBot,OwnedControlSessionSummary,OwnedControlSessionChange} from './contracts.js';
export type {OwnedWorkSessionPort,OwnedWorkSessionOptions,OfflineWorkSessionRuntime,WorkDelegation,WorkTarget,WorkSlotLease,WorkBinding,WorkState,WorkUnsupportedCode,WorkFence,WorkSessionView,WorkSessionSnapshot,WorkRuntimeReceipt,WorkChildRequest} from './contracts.js';

export type {OwnedWorkCreationOptions,OwnedWorkProducerOptions,WorkSessionCreation,WorkDeliveryReceipt,WorkProducerProvenance,WorkMessageBinding,WorkProducerMessage} from './contracts.js';
