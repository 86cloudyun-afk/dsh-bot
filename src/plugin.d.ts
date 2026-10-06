/** Public runtime entry exports only Host and the Loader plugin protocol. */
export { Host, apply } from './contracts.js';
export type * from './contracts.js';
export declare const name:'dsh-bot';
export declare const inject:readonly ['connection','webServer'];
