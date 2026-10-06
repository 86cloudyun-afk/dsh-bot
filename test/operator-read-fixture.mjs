/** Synthetic in-memory product objects and real Cordis/Connection identities only. */
import {Context} from '@deepseek-ai/cordis';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import {randomUUID} from 'node:crypto';
import {Host} from '../src/host.mjs';
import {Ledger} from '../src/ledger.mjs';
import {digest} from '../src/errors.mjs';
import {createExplicitOperatorReadBinding} from '../src/explicit-operator-read-binding.mjs';

export async function fixture({makeBinding=true}={}){
 const root=new Context();
 // No credentials, profile, HTTP server, transport, auth or model service is opened.
 const connectionHandle=root.plugin(ctx=>{new HostConnectionService(ctx,[],null);});
 await connectionHandle.await();await root.get('connection').operator.ctx.fiber.await();
 let ownerCtx;await root.plugin(ctx=>{ownerCtx=ctx;}).await();
 const ledger=new Ledger(':memory:'),caller=ownerCtx.fiber;
 const host=new Host({ledger,ownerHumanId:'SYNTHETIC UNIT OWNER',ownerCapability:caller});
 const command=(command,payload)=>host.executeOwned(caller,{command,payloadDigest:digest(payload),operationId:randomUUID(),nonce:randomUUID(),expectedRevision:null,expectedEpochs:{},authorizationRef:'native-owner',rootHumanInstructionRef:'isolated-operator-test',createdAt:new Date().toISOString(),deadline:null},payload).result;
 const bot=command('createBot',{name:'SYNTHETIC SELECTED',config:{contact:{provider:'inert',model:'unused'}}});
 const task=command('createTask',{ownerBotId:bot.botId,title:'SYNTHETIC TASK',scope:{namespace:'PRIVATE',writeResources:[]},acceptance:'PRIVATE'});
 const readPort=host.createOwnedBotTaskReadPort(caller);
 const binding=makeBinding?createExplicitOperatorReadBinding({ownerCtx,expectedHost:host,readPort}):null;
 return {root,ownerCtx,ledger,caller,host,command,bot,task,readPort,binding,connectionHandle,operator:root.get('connection').operator,
  scope:{audience:'this-host-authenticated-operator',botIds:[bot.botId],taskIds:[task.taskId]},
  read:peer=>binding.source.readForPeer(peer,new AbortController().signal),
  close:async()=>{await root.fiber.dispose();ledger.close();}};
}
