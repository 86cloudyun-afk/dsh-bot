/** Compile-only official read entry consumption. Never runs a Context, Host or Ledger. */
import type {Context} from '@deepseek-ai/cordis';
import {Host,isOwnedBotTaskReadPort,isOwnedBotTaskReadPortForHost} from 'dsh-bot/host';
import {createBotTaskReadSource,type OwnedBotTaskReadPort} from 'dsh-bot/bot-read-source';
import {createExplicitOperatorReadBinding,installExplicitOperatorReadBinding} from 'dsh-bot/operator-read-binding';
declare const ownerCtx:Context,host:Host,caller:object,signal:AbortSignal;
const port=host.createOwnedBotTaskReadPort(caller,{isCurrent:()=>true});
const ids={botIds:['SYNTHETIC BOT'],taskIds:['SYNTHETIC TASK']} as const;
const summary=port.snapshot(ids);
const id:string=summary.bot[0]!.botId;
const source=createBotTaskReadSource({resolveAccess:async()=>({readPort:port,...ids,isCurrent:()=>true})});
source.readForPeer({},signal);
createBotTaskReadSource({resolveAccess:()=>({host,caller,authorityEpoch:1,...ids,isCurrent:()=>true})});
const binding=createExplicitOperatorReadBinding({ownerCtx,expectedHost:host,readPort:port});
binding.select({audience:'this-host-authenticated-operator',...ids});binding.revoke();binding.close();
installExplicitOperatorReadBinding({ownerCtx,expectedHost:host,readPort:port});
isOwnedBotTaskReadPort(port);isOwnedBotTaskReadPortForHost(port,host,caller);
// @ts-expect-error A structural snapshot wrapper cannot fabricate a retained owner port.
const forged:OwnedBotTaskReadPort={snapshot:()=>({bot:[],task:[]})};
// @ts-expect-error isCurrent is strictly synchronous, including for async resolvers.
createBotTaskReadSource({resolveAccess:()=>({readPort:port,...ids,isCurrent:async()=>true})});
// @ts-expect-error A real expected Host is mandatory; a port brand alone proves insufficient.
createExplicitOperatorReadBinding({ownerCtx,readPort:port});
// @ts-expect-error Serialized peer roles are not an audience or authority.
binding.select({audience:'user',...ids});
// @ts-expect-error Raw acceptance data is absent from the safe snapshot.
summary.task[0]!.acceptance;
// @ts-expect-error Retained read ports have no execution capability.
port.execute();
void id;void forged;
