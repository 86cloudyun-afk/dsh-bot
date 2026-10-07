# Single-Bot GUI owner

The authorized goal is an installable first version that starts from a fresh isolated Harness Home, authenticates through stock BrowserAuth, and gives its authenticated operator one Bot with a durable main Session and owned work Sessions. Multi-Bot, groups, meetings, model filesystem and shell tools are outside this version.

## Composition

Use a supported Loader profile with the stock base/Web bundles as the transport and browser dependency source. The profile disables stock model-facing preset declarations and unrelated visible surfaces, uses an empty `dsh-bot/empty` preset by default, and installs the product package as a packed immutable snapshot. A new private GUI owner plugin retains its Cordis fiber, `Host`, `DshAdapter`, Ledger, actual `HostConnectionService`, and operator Peer. No serialized actor or gateway Peer constructs authority.

The app registers `/dsh-bot-gui` for bounded bootstrap/create/reconcile requests. The existing `/dsh-bot` summary read and `/dsh-bot-owner` selected controls remain separately gated. The browser presents an explicit create form when no Bot exists, and the existing goal/results panel once the Bot is selected. The owner never exposes its Host, private ports, caller, or secrets as a service or response.

## Identity and recovery

Creation saves the original operation ID/nonce before any native await, creates at most one Bot, prepares one contact creation intent, and reconciles that original Session ID. A restart reads the same product ledger identity and selected Bot. A bound main Session is inspected before resolution; recovery does not activate or rerun historical work. Main receives only `dsh_bot_delegate`; work receives zero tools. The initial agent preset is read from the Bot's immutable configuration and verified against persisted headers.

Owner mutations recheck the actual retained connection/operator fiber, owner fiber, connection activation, Bot epoch/config, and authority grant before and after awaits. A changed binding fails closed. The existing browser original-operation storage and locks remain intact; UNKNOWN messages are reconciled by original IDs without resending.

## Execution and truthfulness

Model requests require the explicit process flag `--enable-model-requests`; this app's zero-model validation does not use the provider. A main goal uses the actual Agent/Session inbox and confirms durable queueing. The private producer routes observed work responses to the main's next turn. Replies and `turn/end` events are evidence of output only. Stop requests are accepted fences; held work generations remain UNKNOWN and held until authoritative Host terminal evidence is available. This GUI must not manufacture native settlement from Agent idle or a reply.

Archival/restoration controls are added only with complete native log inspection and existing Host epoch invalidation. If that interface is unavailable, bootstrap truthfully reports the limitation and keeps the saved identity; unsupported restore must not create a replacement Bot or erase held UNKNOWN work.

## Validation

Use meaningful failing tests for profile isolation, authenticated owner bootstrap/create replay, actual Session persistence/restart identity, and current-peer rejection. Run the existing test suite. Launch the packed profile in a fresh private Home on loopback and use Chromium with an empty user-data directory to exchange the real process token for its signed cookie. Verify an unauthenticated root/API is refused and a foreign Origin is refused. Verify the real Loader roster loads the Bot panel and creates/selects one Bot without a model request. Synthetic external output may test result presentation and routing, and must remain labeled synthetic in evidence. No production Home/history/key values are read or copied.
### Native controller and browser roster

The stock Web SessionController browser face requires the file-upload client service. This owner profile keeps file intake closed. It mounts the exact stock native SessionController class through a host-only package subpath and disables the stock Session, Workspace, Conversation, and Sidebar browser rows. The official renderer, layout, locale, connection, and module Loader remain the browser shell. The owner panel selects itself only after its main slot has registered.
