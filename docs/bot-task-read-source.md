# Bot/task read binding

The Loader plugin accepts only `/dsh-bot` → `snapshot` with an empty payload. The optional `dshBotReadSource` service is resolved afresh for each request. Without an explicitly supplied source it returns `not_configured`; mounting the bundle does not open a ledger or register a source.

`createBotTaskReadSource({resolveAccess})`, exported as `dsh-bot/bot-read-source`, binds a trusted host-owned resolver to `Host.snapshotOwnedBotTasks`. The resolver receives the actual peer object and cancellation signal. It returns `null` to refuse access, or a genuine retained owner read port plus explicit Bot/task ID arrays and a synchronous `isCurrent()` lease predicate. The legacy resolver form accepts the existing Host, its retained opaque owner capability and captured `native-owner` grant epoch; that form now projects the same safe DTO before returning. The predicate must compare the exact peer object and lease generation and check both owner and peer lifetimes. For Cordis fibers, check `uid !== null` and ACTIVE state: disposal clears the UID before updating the state. Labels, peer IDs, `role=user`, serialized actors and routing scopes confer no authority.

The source captures the retained read port (or legacy Host/capability/epoch) and array copies before checking the lease. Every read rechecks cancellation and requires `isCurrent() === true` before and after reading. Missing, asynchronous, throwing or false lease predicates refuse access. The Host checks its private owner capability and the existing `native-owner` grant's active state, epoch, host identity, authority and scope. Apart from this grant authorization check, only the explicit Bot/task keys are read with `ledger.get`; other record kinds are not read. Arrays must contain unique valid IDs with no sparse slots, at most 500 per kind. Unknown IDs and tasks whose owner Bot is outside the selected Bot IDs refuse the entire read. An explicitly authorized empty scope returns empty lists.

The public DTO allows Bot ID, name, lifecycle, readiness, epoch and revision; task ID, owner Bot ID, title, responsibility, epoch, revision and `stop.state`. Owner labels, grant information, scope namespaces, acceptance text, sessions, configuration and execution records are excluded. Task responsibility, including `verified`, is separate from native Attempt or provider execution verification. Read failures are sanitized by the channel. Disposal/cancellation fences pending completion; the client does one read per connected generation and has no polling or execution action.

Production automatic binding remains unavailable on fixed official `dsh-v0.2.0-rc.2` (`639ed015397290b3745d163aafe02ffee4aa3f84`). `HostConnectionService.admit` (`packages/client/connection/src/rpc-host.ts`) returns the connection's `operator`; `OperatorPeer` (`operator-peer.ts`) exposes only ID, context and disposal. `PeerScope` (`packages/typert/protocol/src/types.ts:382`) explicitly carries neither who the peer is nor what it may do. `scopeOf` is routing identity. There is no official peer-to-product-owner capability or Bot/task read lease resolver to connect automatically. `Host.snapshot(actor)` only checks a configured human label and is not used for this binding; the owner application's Host remains private and is not opened to obtain a source.

The isolated integration creates a fresh harmless Host with the actual retained Cordis owner fiber, creates Bot/task data through existing `executeOwned`, and reads through the actual new source, original rc.2 Loader/HostConnectionService/OperatorPeer and original client `installConnection`. The test-only resolver authorizes exact peer objects for fixed scopes and checks lease generation and both fibers' lifetimes. Authentication is an inert throwing sentinel, and transport is a decoded in-process carrier. This verifies data binding, denial, revocation and scope isolation; it does not authenticate a browser, production account or human, install a production source, start a listener, or attest native execution.

## Explicit same-Host operator installation

The approved audience is every authenticated operating endpoint of this same Host, represented by its actual `Connection.operator`. This is a shared Host audience; it does not identify or isolate individual humans. The owner must explicitly select Bot/task IDs. No raw conversations, ledger handles, grant metadata or execution authority enter the source or public DTO.

`dsh-bot/operator-read-binding` exports `createExplicitOperatorReadBinding` and `installExplicitOperatorReadBinding`. Both require the real owner Context, an independently retained `expectedHost`, and that exact Host's genuine owner read port. Private WeakMap metadata checks both Host instance and retained owner fiber. A port from another Host fails installation even when both Hosts share an owner fiber. The real `HostConnectionService`, exact operator object, both live fibers, cancellation and current selection lease are checked on every read. Cordis service proxy equality is not an identity check.

A trusted owner composition with already retained objects can install only the narrow source:

```js
import {installExplicitOperatorReadBinding} from 'dsh-bot/operator-read-binding';
const binding = installExplicitOperatorReadBinding({
  ownerCtx,
  expectedHost: existingHost,
  readPort: retainedOwnerReadPort,
});
binding.select({
  audience: 'this-host-authenticated-operator',
  botIds: ['SYNTHETIC-EXPLICIT-BOT-ID'],
  taskIds: ['SYNTHETIC-EXPLICIT-TASK-ID'],
});
```

The example IDs stand for explicitly selected existing synthetic objects; unknown IDs refuse the entire read. Mounting the public plugin alone, or installing without calling `select`, remains `not_configured`. To resolve that status, the trusted owner must install this source in the same Context service scope and select concrete IDs. An empty explicitly selected scope returns authorized empty lists. `revoke()` clears the selection and returns `access_denied`; invalid selection first revokes the previous lease. `close()` also denies pending and future reads. Owner disposal removes its service registration.

An existing private development `OwnedNativeController` offers `installReadSource(caller)`: after owner validation it atomically passes its private Host and its own `readPort(caller)` into the installer. It exposes only the binding's `source/select/revoke/close` controls. It does not open a native Host, session or provider. Its retained read port denies immediately when controller closure starts. The official read entry itself has only official Cordis/Connection dependencies and never statically imports the development-only native SDK.

This increment's in-memory composition verifies real Context/Connection identities and safe selected summaries without credentials, profiles, HTTP listeners or model requests. Actual browser authentication, real profile installation, official Loader/GUI mounting and production owner provisioning remain untested. Historical integration evidence above is not this increment's acceptance result.
