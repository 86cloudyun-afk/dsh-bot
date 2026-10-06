import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {Ledger} from '../src/ledger.mjs';

test('memory ledger opens and stores data without directory filesystem effects',()=>{
 const originalExists=fs.existsSync,originalMkdir=fs.mkdirSync,calls={exists:0,mkdir:0};
 fs.existsSync=(...args)=>{calls.exists++;return originalExists(...args);};
 fs.mkdirSync=(...args)=>{calls.mkdir++;return originalMkdir(...args);};
 syncBuiltinESMExports();let ledger;
 try{ledger=new Ledger(':memory:');ledger.put('fixture','memory',{value:'synthetic'});assert.deepEqual(ledger.get('fixture','memory'),{value:'synthetic'});assert.equal(ledger.db.prepare('PRAGMA journal_mode').get().journal_mode,'memory');assert.deepEqual(calls,{exists:0,mkdir:0});}
 finally{ledger?.close();fs.existsSync=originalExists;fs.mkdirSync=originalMkdir;syncBuiltinESMExports();}
});

test('separate memory ledgers retain transaction isolation without persistent files',()=>{
 let first,second;try{first=new Ledger(':memory:');second=new Ledger(':memory:');first.put('fixture','row',{value:1});assert.equal(second.get('fixture','row'),null);assert.throws(()=>first.transaction(()=>{first.put('fixture','rollback',{value:2});throw Error('synthetic_rollback');}),/synthetic_rollback/);assert.equal(first.get('fixture','rollback'),null);assert.deepEqual(first.get('fixture','row'),{value:1});}
 finally{first?.close();second?.close();}
});
