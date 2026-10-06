import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,human } from './helpers.mjs';
import { prepareCommand } from '../ui/command.mjs';

test('UI requires a ledger identity before persistence and refuses another ledger before mutation',async()=>{
 const a=fixture(),b=fixture();
 try {
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const locks={request:(_name,_options,fn)=>fn()};
  const input={command:'createBot',payload:{name:'identity boundary',config:{contact:{provider:'synthetic',model:'A'}}},expectedRevision:null,expectedEpochs:{}};
  await assert.rejects(()=>prepareCommand(storage,input,locks),{code:'ledger_identity_conflict'});
  assert.equal(values.size,0);
  const body=await prepareCommand(storage,{...input,ledgerInstanceId:a.host.ledgerInstanceId},locks);
  const pending=storage.getItem('dsh-bot-pending');
  const snapshot=()=>['objects','operations','observations'].map(table=>b.ledger.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
  const before=snapshot();
  assert.notEqual(a.host.ledgerInstanceId,b.host.ledgerInstanceId);
  assert.throws(()=>b.host.execute(human,body.envelope,body.payload),{code:'ledger_identity_conflict'});
  assert.deepEqual(snapshot(),before);
  assert.equal(storage.getItem('dsh-bot-pending'),pending);
 } finally {a.ledger.close();b.ledger.close();}
});
