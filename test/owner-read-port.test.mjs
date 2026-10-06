import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Host} from '../src/host.mjs';
import {Ledger} from '../src/ledger.mjs';
import {digest} from '../src/errors.mjs';
import {createBotTaskReadSource} from '../src/bot-task-read-source.mjs';

function fixture(){
 const ledger=new Ledger(':memory:');
 const caller={},host=new Host({ledger,ownerHumanId:'SYNTHETIC OWNER',ownerCapability:caller});
 const command=(command,payload)=>host.executeOwned(caller,{command,payloadDigest:digest(payload),operationId:randomUUID(),nonce:randomUUID(),expectedRevision:null,expectedEpochs:{},authorizationRef:'native-owner',rootHumanInstructionRef:'isolated-port-test',createdAt:new Date().toISOString(),deadline:null},payload).result;
 const bot=command('createBot',{name:'SYNTHETIC SELECTED',config:{contact:{provider:'inert',model:'unused'}}});
 const task=command('createTask',{ownerBotId:bot.botId,title:'SYNTHETIC TASK',scope:{namespace:'PRIVATE NAMESPACE',writeResources:[]},acceptance:'PRIVATE ACCEPTANCE'});
 return {ledger,caller,host,bot,task,ids:{botIds:[bot.botId],taskIds:[task.taskId]}};
}
test('retained owner issues a frozen read port containing only safe selected summaries',()=>{
 const f=fixture();try{
  assert.equal(typeof f.host.createOwnedBotTaskReadPort,'function','retained owner read port is missing');
  assert.throws(()=>f.host.createOwnedBotTaskReadPort({}),{code:'unsupported_host_identity'});
  const port=f.host.createOwnedBotTaskReadPort(f.caller);
  assert.deepEqual(Object.keys(port),['snapshot']);assert.equal(Object.isFrozen(port),true);
  const result=port.snapshot(f.ids);
  assert.deepEqual(Object.keys(result.bot[0]),['botId','name','lifecycle','readiness','epoch','revision']);
  assert.deepEqual(Object.keys(result.task[0]),['taskId','ownerBotId','title','responsibility','epoch','revision','stop']);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  f.ledger.put('grant','native-owner',{...f.ledger.get('grant','native-owner'),epoch:2});
  assert.throws(()=>port.snapshot(f.ids),{code:'unauthorized'});
 }finally{f.ledger.close();}
});
test('read source consumes genuine owner port and discards resolved rows after a late lease revoke',async()=>{
 const f=fixture();try{
  assert.equal(typeof f.host.createOwnedBotTaskReadPort,'function','retained owner read port is missing');
  const port=f.host.createOwnedBotTaskReadPort(f.caller);
  const source=createBotTaskReadSource({resolveAccess:()=>({readPort:port,...f.ids,isCurrent:()=>true})});
  assert.equal((await source.readForPeer({},new AbortController().signal)).status,'ready');
  let checks=0;
  const late=createBotTaskReadSource({resolveAccess:()=>({readPort:port,...f.ids,isCurrent:()=>++checks===1})});
  assert.deepEqual(await late.readForPeer({},new AbortController().signal),{status:'access_denied'});
  const forged=createBotTaskReadSource({resolveAccess:()=>({readPort:{snapshot:()=>port.snapshot(f.ids)},...f.ids,isCurrent:()=>true})});
  assert.deepEqual(await forged.readForPeer({},new AbortController().signal),{status:'access_denied'});
 }finally{f.ledger.close();}
});
