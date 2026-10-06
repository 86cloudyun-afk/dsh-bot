# Bot producer and Session creation implementation plan

> **For agentic workers:** REQUIRED execution skill: superpowers:executing-plans, once parent written preflight permits implementation. Sole writer executes inline; no spawned agents, commits, cleanup or broad suites. Explicit scope overrides redundant skill approval/commit gates.

**Goal:** exact owner/real contact-Agent ingress delegates through existing Host work transactions, creates and cold-verifies the original reserved Session ID, and demonstrates truthful Bot-source queue behavior with zero model requests.

**Architecture:** extend work manager; retain SessionCreationDriver as sole creator; strengthen opted-in adapter durability; stock-only producer installer; preserve synthetic generation execution contract and UI refusals.

**Source:** approved scope, adjacent design, writer/producer-interface-report.md, independent/phase1-preflight.md. Initial baseline manifest/tar hashes and all 138 source hashes are in writer/baseline-verification.json. No implementation has started.

## Exact file and interface map

| File | Change |
|---|---|
| `src/bot-producer.mjs` + `.d.ts` (new) | `installOwnedBotProducer(options)` private factory retaining owner/Host/origin Agent and scoped tools. Frozen `delegate(request,signal?)`, `query(selection)`, `queue(target,signal?)`, `dispose()`. Actual MessageSourceMap augmentation/source construction and stock transport closure. No Ledger.put calls. |
| `src/work-sessions.mjs` | Commands `prepareWorkSessionCreation` and `prepareWorkSessionDelivery`; retained port `createSession(envelope,target)` and `queueMessage(envelope,target,signal?)`; original-ID creation/delivery intents and exact-generation projection; existing delegate/admit/collect/fence/resume preserved. |
| `src/host.mjs` | Pass new manager/retained port options only as needed; all writes continue through same Host commands/transactions. No alternate owner grants or serialized Bot actor. |
| `src/session-creation.mjs` + `.d.ts` | Optional synchronous `isCurrent` lifetime guard and exact work-binding fence; unchanged one-create/original-ID inspect state machine and already-created historical receipt reuse. |
| `src/adapter.mjs` + `.d.ts` | `ownedCreationPort(ids,{scopeOf,durable?:boolean})` opted-in actual flush + original persisted header/event verification; retain old default contract. No resolveAgent in inspect. |
| `src/contracts.d.ts` | Work creation/delivery types and optional owner-only port options, additive view fields. Preserve existing WorkRuntimeReceipt/OfflineWorkSessionRuntime semantics, literal limit15 and verification=false. |
| `package.json` | Private explicit `./bot-producer` export with matching types/default; minimal accurate optional stock peer declarations only if strict consumer requires them; no new installed dependency. |
| `docs/work-sessions.md`, `docs/public-types-manifest.json` | Actual creation/producer evidence boundaries; source versus protocol role; new export/declaration inventory. Do not upgrade all capability flags. |
| `test/bot-producer.test.mjs` (new), targeted existing work/creation tests | Meaningful new behavior RED/GREEN and affected old invariants. |
| `test/bot-producer.stock.mjs`, `test/bot-producer-types.mts` (new) | Actual installed stock runtime proof and strict installed export consumer. Fixture support may be in `test/bot-producer-fixture.mjs`; fixture-only synthetic components explicitly named. |

`OwnedWorkCreationOptions = {readonly cwd:string; readonly port:OwnedCreationPort}`. Retain its callable methods on open. Creation intent adds optional `workBinding:{task_id:string;generation:number}`; view adds nullable creationOperationId/creationReceipt and independent sessionCreation `{state:none|unknown|created,proofKind:stock-session-durable|fixture-contract|null,...originalIdentity}`, never changes nativeRuntimeVerified. The trusted stock durable adapter supplies actual proof; synthetic runtime receipt labels cannot manufacture it.

Owner-only `OwnedWorkProducerOptions` carries immutable provenance `{producerId,ingress,originSessionId,callId?,rootCallId?}`, synchronous `isCurrent`, and privately retained transport functions to construct/send/inspect the exact message. These are constructor/open-time capabilities, never tool/request payloads. `queueMessage` accepts only target/envelope/signal, never a receipt or sender fields. Transport returns actual persisted message-match evidence; manager owns delivery intent and state, and rechecks authority after each await. `WorkDeliveryReceipt` has operationId/messageId/sessionId/generation plus state `prepared|sending|durably-queued|unknown|fenced`; it makes no execution claim. Content is derived from the existing immutable goal/completion condition, not a new unrestricted prompt parameter.

## Task 1 — bounded executable fixture preflight, then feature RED

1. Inspect only the exact stock entry imports/dependencies needed by the fixture and existing guard implementation. Create disposable writer/task1 roots. Compose no provider, default-model credential plugin, production boot profile or listener. Record whether Controller construction needs synthetic dependency services; never call those actual dependencies.
2. Build an execution runner outside product under `writer/run-offline.py` and guard/fixtures under writer/test support. Literal child env only: PATH pointing at pinned Node plus required fixed system binaries, HOME/DSH_HOME/TMPDIR inside this disposable run, LANG=C.UTF-8, TZ=UTC, npm_config_update_notifier=false. No inherited credentials/proxies/NODE_OPTIONS. All additional variables must be fixed fixture paths, recorded before execution. Block network, DNS, child spawn and listeners before imports; filesystem reads only candidate/stock dependencies/fixture roots and minimal Node runtime files, writes only per-run roots, with file/byte/time bounds. Instrument model prepareCall/stream to throw and count. Run metadata includes exact argv/env/cwd, UTC timestamps, monotonic elapsed, stdout/stderr/exit and IO counters.
3. Use pinned `历史隔离位置〔node〕`; targeted test argv is `--import <guard> --test <absolute-new-test-file>`, no shell inherited env. Record expected feature RED: the new installer/port methods are absent. A loader/dependency/guard failure is not feature RED and stops that lane for diagnosis.
4. Add cases: exact retained actual Agent accepted; missing/foreign/copied/replaced same-ID Agent denied; wrong/disposed fiber denied; changed Bot config/contact/epoch or grant denied; input source/actor/Bot fields rejected; tool execution callId is provenance only. No generalized mocking of positive actual-Agent proof.

## Task 2 — original-ID work creation using existing driver

1. Add RED cases to targeted work/creation tests: delegate then create returns same reserved ID and one creation intent; repeat creates once; same task_id across Bots isolated; changed instructions conflict; durable proof failure remains unknown; create-commit-throw inspects same ID without recreate; conflicting create receipt permanent unknown.
2. Extend work manager command preparation and retained creation option. Ensure intent prepared inside Host operation before driver effect. Preserve operation/nonce replay checks, task/Bot/config/authority snapshots, existing Session ID and root instruction reference. No native execution admission.
3. Extend SessionCreationDriver fence for optional workBinding and isCurrent. RED cases: stop/fence/revision/archive/revoke/dispose during create/readback blocks late successful mapping; resumed generation cannot receive old creation projection. Optional guard must return literal true synchronously; exception/promise/nontrue fails closed.
4. Add durable adapter option: flush acknowledged plus real original-ID persisted header/empty-event read; no memory fallback. Created receipt remains reusable after nonblank queued log. For generation2+, reuse a historical created intent without driver.run on its generation1 fence; old pending generation1 results remain rejected. Add a test that gen2 reuse causes zero create/driver invocations and does not rewrite the original created row. Driver confirmation still writes nativeSession through existing execution branch.
5. GREEN new cases and affected original creation/work tests once. Preserve legacy unknown, capacity15, historical receipt and current/previous-generation behavior. Add a test proving offline-synthetic confirmed/unknown receipts neither manufacture nor erase sessionCreation stock durable proof, and actual creation cannot complete/release an execution. Record execution counts; don't reclassify historical acceptance counts as new coverage.

## Task 3 — private producer and scoped tool ingress

1. RED installer cases for absent factory/export and exact owner/Agent/lifetime defenses. Bind only Bot.contactSessionId; use exact session/agent registries and official scopeOf. No cold resolve to recover a producer.
2. Implement installer with existing Host work port and owned adapter creation port. Register dsh_bot_delegate on originAgent.ctx.tools with actual defineTool/output schema and executor signature. Do not add filesystem/shell/network tools or register on target/root scope. Derive deterministic per-call operation/nonce IDs; preserve captured rootInstructionRef from owner.
3. Source augmentation uses kind dsh-bot and truthful retained identities/ingress. Official createUserMessage supplies role and message ID. Strict positive consumer accepts this source; negative consumer rejects source kind user for BotProducerMessage, source fields in tool payload, arbitrary receipt injection and fabricated capability types.
4. Test actual ToolRuntime dispatch with exact retained real origin Agent and a synthetic offline invoker. Assert tool arguments cannot select a foreign Bot; inspect returns copied safe views; disposal unregisters and prevents stale invocation. Count zero model requests. Label the stimulus synthetic; do not claim model-selected delegation.

## Task 4 — no-wake delivery and ambiguity

1. RED tests: exact current created target yields dsh-bot source; wrong/fenced/resumed target never sends; same request reuses message; ambiguous send/flush never resends; original source survives durable log read; failed readback stays unknown.
2. Manager prepares delivery intent/message identity under command transaction before effect, retaining original binding. Stock transport gets only already-live exact target Agent; it checks idle and zero target tools, then sends next-turn,false. No resolveAgent/followup/steer/inject/cancel calls in real lane.
3. Await flush and cold readback through retained transport; project durably-queued only after original message/content/source match and post-await authority/generation checks. Same command rereads original intent; sending/unknown recovery only inspects the final original message ID/source/content, including after failed flush. Add tests for send-then-throw and flush-failure-then-cold-recovery, asserting one send, one message ID, zero wake calls, and rejected late success after owner revocation. Native execution state/leases stay untouched.
4. Actual queue proof runs after and separately from blank proof. No other producers/listeners can wake the disposable Agent. Check zero prepareCall/stream and no turn/model events. Teardown without resuming the pending Session. Followup/steer call mapping remains source-inspection evidence or separately labeled offline method fixture, not an actual awake invocation.

## Task 5 — actual installed blank Session + cold proof

1. Compose actual stock Cordis, SessionStore, JSONL persistence, projections, AgentRegistry/AgentLoop, empty preset and ToolRuntime, with synthetic blocked LLM. Strongly prefer actual SessionController with each dependency inventoried; only a demonstrated clean-setup blocker permits fallback. If it cannot be safely composed, retain failure and explicitly report that lane blocked, while proving real SessionStore/Agent/backend behavior using a labeled fixture creation adapter.
2. Through actual product owner producer delegate, create one harmless temporary work Session via existing driver/adapter. Observe actual original id/task/generation mapping, empty events/seq0, effective preset, isSeeded=false, zero global/scoped target tools, acknowledged flush, nonzero durable bytes.
3. Detach live target or use a fresh independent cold context. Actual query/readSession or persistence read proves original header and complete events without Agent activation. Do not reuse memory-only proof or resolveAgent. Later separate queued-message proof preserves original ID and source.
4. Reopen disposable product Ledger and cold backend only for identity/query checks; no implicit producer authority or runtime source continuity crosses restart. Confirm unknown execution remains held and creation/query cannot settle/release it. Record component truth table: actual services; synthetic LLM/stimulus; controller actual or fixture-backed; no native execution.

## Task 6 — declarations, pack and independent handoff

1. Run existing TypeScript **6.0.3** at `历史隔离位置〔tsc〕` under pinned Node with `--noEmit --strict --skipLibCheck false --module NodeNext --moduleResolution NodeNext` and an explicit changed-export consumer. No broad repository type suite or source/dependency edits. Preserve any stock declaration limitation as evidence.
2. Verify the 138-file baseline remains unchanged; generate new candidate manifest, distinguishing changed/new paths. npm pack and install only the tar into a fresh offline consumer using existing local npm, `--ignore-scripts --offline`, update notifier disabled and no dependency resolution to network. Map source/tar/actual installed files and verify hashes.
3. Run one installed positive owner→producer→create/query case and one installed forgery/lifetime refusal, or have independent tester execute them without duplicate reruns. Verify package export points to actual installed files and changed public declarations strictly typecheck there.
4. Give parent and independent reviewer concrete manifests, RED/GREEN logs, actual component matrix and exact remaining native-generation/UI blockers. Keep original artifacts, failures, dirty main, baseline source and fixture evidence intact. Stop before any unauthorized production/UI/native activation.

## Review focus and completion gate

All spec requirements map to tasks above. Five principal failure classes: same-ID Agent replacement (Task3), authority/fence across awaits (Task2/4), memory-only durability (Task2/5), ambiguous delivery replay (Task4), and creation mistaken for generation settlement (Task2/5). Additional preserved cases are cross-Bot operation replay, shared15/unknown capacity and unchanged plugin/UI refusals.

Self-review: no product source change or runtime command has been executed in phase one. This plan requires written parent + independent preflight before Task1 runtime or product implementation. The preflight is the explicit delegated phase boundary, not a new permission gate inferred from a skill.

Credential import clarification (written preflight): the actual stock SessionController imports credentialRef, a harmless reference-constructor declaration. That import is permitted after inventory; credential resolution, auth-service composition, provider loading, real profile/config/environment reads remain prohibited. Guarded execution stops on unexpected side effects.

Authorized interface refinement: creation may carry synchronous portFor(intent) instead of port; invoke once after intent commit with frozen copied intent, retain exact returned port/methods, reject thenables, and skip factory/driver for historical created generation reuse. This preserves fixed ID allowlists and stock proof identity.
