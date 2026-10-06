import type { BotTaskReadSource, BotTaskReadSourceOptions } from './contracts.js';
export type { BotTaskReadAccess, BotTaskReadScope, BotTaskReadSelection, BotTaskReadRows, BotTaskReadSummary, BotTaskReadDto, BotTaskReadSource, BotTaskReadSourceOptions, BotReadDto, TaskReadDto, OwnedBotTaskReadPort, OwnedBotTaskReadPortOptions } from './contracts.js';
/** Bind only a trusted, host-owned resolver; no default production source is registered. */
export declare function createBotTaskReadSource(options?:BotTaskReadSourceOptions):BotTaskReadSource;
