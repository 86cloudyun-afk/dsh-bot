import type {Agent} from '@deepseek-ai/dsh-agent';
import type {installSelectedBotOwnerPolicy} from './selected-bot-owner-policy.mjs';
/** Private trusted launcher installer. Not exposed as a service or RPC capability. */
export declare function installSelectedBotContactOwner(options:Omit<Parameters<typeof installSelectedBotOwnerPolicy>[0],'actions'> & {readonly contactAgent:Agent}):Readonly<{dispose():void}>;
