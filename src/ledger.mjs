import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical, digest, requireValue } from './errors.mjs';

export class Ledger {
  constructor(path) {
    mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    requireValue(version===0 || version===1,'migration_required','Unsupported schema; preserve database for read-only recovery');
    this.db.exec(`CREATE TABLE IF NOT EXISTS objects(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,actor TEXT NOT NULL,nonce TEXT NOT NULL,binding TEXT NOT NULL,receipt TEXT NOT NULL, UNIQUE(actor,nonce));
      CREATE TABLE IF NOT EXISTS observations(event_id TEXT PRIMARY KEY,source TEXT NOT NULL,source_seq INTEGER NOT NULL,value TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  get(kind,id) { const row=this.db.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get(kind,id); return row ? JSON.parse(row.value):null; }
  list(kind) { return this.db.prepare('SELECT value FROM objects WHERE kind=? ORDER BY id').all(kind).map(r=>JSON.parse(r.value)); }
  put(kind,id,value) { if(kind==='config') { const old=this.get(kind,id); requireValue(!old || canonical(old)===canonical(value),'config_immutable'); } this.db.prepare('INSERT INTO objects(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,canonical(value)); return structuredClone(value); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); requireValue(!result?.then,'async_transaction','No await inside a ledger transaction'); this.db.exec('COMMIT'); return result; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  operation(actor,e,payload,fn) {
    requireValue(digest(payload)===e.payloadDigest,'payload_digest_conflict');
    const actorKey=canonical(actor);
    const binding=canonical({actor,command:e.command,payload,canonicalVersion:1,expectedRevision:e.expectedRevision,expectedEpochs:e.expectedEpochs,rootHumanInstructionRef:e.rootHumanInstructionRef,authorizationRef:e.authorizationRef,createdAt:e.createdAt,deadline:e.deadline});
    return this.transaction(()=>{
      const byNonce=this.db.prepare('SELECT * FROM operations WHERE actor=? AND nonce=?').get(actorKey,e.nonce);
      const byId=this.db.prepare('SELECT * FROM operations WHERE id=?').get(e.operationId);
      requireValue(!byId || !byNonce || byId.id===byNonce.id,'operation_conflict');
      if(byNonce) { requireValue(byNonce.binding===binding,'nonce_conflict'); return JSON.parse(byNonce.receipt); }
      if(byId) { requireValue(byId.actor===actorKey && byId.nonce===e.nonce && byId.binding===binding,'operation_conflict'); return JSON.parse(byId.receipt); }
      const result=fn();
      const receipt={operationId:e.operationId,state:'received',authority:'plugin-ledger',observedAt:new Date().toISOString(),result};
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(e.operationId,actorKey,e.nonce,binding,canonical(receipt));
      return receipt;
    });
  }
  inspectOperation(actor,id) { const r=this.db.prepare('SELECT actor,receipt FROM operations WHERE id=?').get(id); requireValue(r && r.actor===canonical(actor),'not_found'); return JSON.parse(r.receipt); }
}
