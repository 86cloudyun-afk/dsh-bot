import {storageBackendServiceKey} from '@deepseek-ai/dsh-storage';
import {PluginStore,requireCondition} from './store.mjs';
import {PermissionPolicy} from './policy.mjs';
import {NativeDshAdapter} from './adapter.mjs';
import {BotDirectory} from './bots.mjs';
import {SessionOwnership} from './sessions.mjs';
import {BotService} from './service.mjs';
import {TaskController} from './tasks.mjs';
import {Reconciler} from './recovery.mjs';
import {randomUUID} from 'node:crypto';

export const name='dsh-bot';
export const inject=['connection','storage',storageBackendServiceKey('json'),'agents','sessions','sessionPersistence','llm','tools'];
export async function apply(ctx) {
  await ctx.effect(async()=>{
    const store=await PluginStore.open(ctx.storage.backend.get('json').kv);
    let adapter,service,tasks,unprovide,unrpc,closed=false;
    const dispose=async()=>{
      closed=true;service?.close();await unrpc?.();await unprovide?.();
      try{await tasks?.close();await adapter?.close();}finally{await store.close();}
    };
    try {
      const policy=new PermissionPolicy(store,{agents:ctx.agents,operatorPeer:ctx.connection.operator});
      adapter=new NativeDshAdapter(ctx,{store,policy});
      const bots=new BotDirectory(store,policy,adapter),sessions=new SessionOwnership(store,policy,adapter);
      tasks=new TaskController({store,policy,adapter});const recovery=new Reconciler({store,policy,adapter,tasks});
      service=new BotService({store,policy,adapter,bots,sessions,tasks,recovery});adapter.setService(service);
      await recovery.reconcile(policy.fromPeer(ctx.connection.operator),{operationId:randomUUID(),action:'recovery.reconcile',input:{}});
      unprovide=ctx.provide('dshBot',service);
      unrpc=ctx.connection.rpc.handle('/dsh-bot',async(endpoint,payload,signal,peer)=>{
        try {
          requireCondition(!closed,'disabled');signal?.throwIfAborted();const actor=policy.fromPeer(peer);
          const command=endpoint==='command'?payload:endpoint==='page'?{action:'session.page',input:payload}:{action:endpoint,input:payload??{}};
          return {ok:true,value:await service.dispatch(actor,command,signal)};
        }catch(error){return {ok:false,error:{code:error.code??(signal?.aborted?'cancelled':'internal_error'),message:error.message,details:{}}};}
      });
      return dispose;
    }catch(error){await dispose();throw error;}
  });
}
