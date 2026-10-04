import { createHash } from 'node:crypto';
export class CommandError extends Error {
  constructor(code, message=code, details={}) { super(message); this.name='CommandError'; this.code=code; this.details=details; }
}
export function requireValue(condition,code,message,details) { if(!condition) throw new CommandError(code,message,details); }
export function canonical(value) {
  if(value===null || ['string','boolean'].includes(typeof value)) return JSON.stringify(value);
  if(typeof value==='number' && Number.isFinite(value)) return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && Object.getPrototypeOf(value)===Object.prototype) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  throw new CommandError('invalid_payload','Only finite JSON values are accepted');
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function text(value,name,max=8000) { requireValue(typeof value==='string' && value.trim().length>0 && value.length<=max,'invalid_payload',`${name} is required (max ${max})`); return value.trim(); }
