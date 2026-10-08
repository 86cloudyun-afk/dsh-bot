import {storageBackendServiceKey} from '@deepseek-ai/dsh-storage';
import {PluginStore} from './store.mjs';
import {PermissionPolicy} from './policy.mjs';
import {NativeDshAdapter} from './adapter.mjs';
import {BotDirectory} from './bots.mjs';
import {SessionOwnership} from './sessions.mjs';
import {BotService} from './service.mjs';
import {TaskController} from './tasks.mjs';
import {Reconciler} from './recovery.mjs';
import {openProfileScope} from './profile.mjs';
import {ConversationBroker} from './broker.mjs';
import {GroupMeetingController} from './collaboration.mjs';
import {randomUUID} from 'node:crypto';
import {mountBotRoutes} from './api.mjs';

export const name='dsh-bot';
export const inject=['connection','webServer','profileContext','storage',storageBackendServiceKey('json'),'agents','sessions','sessionPersistence','llm','tools'];
export async function apply(ctx) {
  await ctx.effect(async()=>{
    const scope=await openProfileScope(ctx);let store;
    try{store=await PluginStore.open(ctx.storage.backend.get('json').kv,{namespace:scope.namespace});}catch(error){await scope.close();throw error;}
    let adapter,service,tasks,broker,collaboration,unprovide,unrpc,closed=false;
    const dispose=async()=>{
      closed=true;service?.close();await unrpc?.();await unprovide?.();
      try{await collaboration?.close();await broker?.close();await tasks?.close();await adapter?.close();}finally{try{await store.close();}finally{await scope.close();}}
    };
    try {
      const policy=new PermissionPolicy(store,{agents:ctx.agents,operatorPeer:ctx.connection.operator});
      adapter=new NativeDshAdapter(ctx,{store,policy});
      const bots=new BotDirectory(store,policy,adapter),sessions=new SessionOwnership(store,policy,adapter);
      tasks=new TaskController({store,policy,adapter});broker=new ConversationBroker({store,policy,adapter});tasks.setResultSink(broker);const recovery=new Reconciler({store,policy,adapter,tasks,broker});
      collaboration=new GroupMeetingController({store,policy,adapter,tasks});
      service=new BotService({store,policy,adapter,bots,sessions,tasks,broker,collaboration,recovery});adapter.setService(service);
      await recovery.reconcile(policy.fromPeer(ctx.connection.operator),{operationId:randomUUID(),action:'recovery.reconcile',input:{}});
      unprovide=ctx.provide('dshBot',service);
      unrpc=await mountBotRoutes(ctx,{policy,service,isClosed:()=>closed});
      return dispose;
    }catch(error){await dispose();throw error;}
  });
}
