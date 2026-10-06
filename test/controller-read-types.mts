/** Compile-only development controller contract; no runtime initialization. */
import type {OwnedNativeController} from 'dsh-bot/native-controller';
import type {OwnedBotTaskReadPort} from 'dsh-bot/bot-read-source';
import type {ExplicitOperatorReadBinding} from 'dsh-bot/operator-read-binding';
declare const controller:OwnedNativeController,caller:object;
const port:OwnedBotTaskReadPort=controller.readPort(caller);
const binding:ExplicitOperatorReadBinding=controller.installReadSource(caller);
binding.select({audience:'this-host-authenticated-operator',botIds:[],taskIds:[]});
// @ts-expect-error The returned private installation contains no controller command capability.
binding.command(caller,{},{});
// @ts-expect-error Safe read ports do not expose their owning Host or ledger.
port.host;
