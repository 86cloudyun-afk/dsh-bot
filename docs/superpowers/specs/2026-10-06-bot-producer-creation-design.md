# Retained Bot producer and original-ID Session creation

Date: 2026-10-06. Architectural design for parent + independent preflight; implementation is not yet authorized by the phase-one gate. Authority and exclusions are in `历史隔离位置〔approved-scope.md〕`. Execution method already selected: one sole writer, independent combined reviewer, no child agents or commits.

## Goal and evidence

Make an existing private owner and exact live contact Agent able to delegate one Bot's work through the existing Host work contract, create the reserved original-ID ordinary Session through SessionCreationDriver, and return a durable creation/query mapping. Demonstrate truthful Bot message source using the actual installed message/Agent/tool APIs without a model request. Preserve the stable Bot/task/session/generation and existing original-ID ambiguity rules, shared15 capacity, unknown reservations and current/previous-generation fences.

Success has three separately reported facts: (1) actual blank/tool-free Session creation and cold durability; (2) actual registry/producer bridge behavior with a synthetic offline tool invocation; (3) if the guarded no-wake lane passes, actual durable queued Bot-source message. None proves a model-issued tool invocation, native execution, task completion, generation settlement or stop confirmation. `nativeRuntimeVerified` and `releaseReady` stay false.

## Choices

Recommended: extend the existing work manager with creation preparation/observation, reuse SessionCreationDriver and DshAdapter, and add a private stock-only producer installer. This yields actual creation and truthful queued delivery without changing execution admission.

Using the development OwnedNativeController would import an absent stock package, require protected-provider machinery and retain its fixed target pair; reject for this slice. Building a second creator/ledger would duplicate the original-ID/fence contract; reject. Returning only another unsupported wrapper would fail the requested actual creation outcome.

## Authority and producer identity

Add `src/bot-producer.mjs` and `.d.ts`, exported only as `dsh-bot/bot-producer`, with `installOwnedBotProducer({ownerCtx,host,caller,originAgent,botId,botEpoch,authorityEpoch,cwd,rootInstructionRef})`. This is an explicit in-process owner call, never automatic plugin mounting or a Cordis/RPC service. It retains all supplied references once. It opens the existing Host owner work capability and requires the actual ownerCtx.fiber to equal caller, be active and unchanged. Host capability admission remains authoritative.

The origin must be the Bot's already-bound contact Session, with exact Agent/Session objects in the actual registries and `scopeOf(originAgent.ctx)===originAgent`. Missing/foreign/copied/same-ID-replaced Agent and changed Bot/contact/config/authority or disposed scope fail before commands. Derive Bot scope from the retained binding, never tool arguments. ToolExecutionInput.agent is caller-supplied; registry token/callId alone do not grant owner authority. The fixture explicitly identifies its tools.execute call as synthetic same-process stimulus.

Installer returns a frozen private capability with `delegate(request, signal)`, `query(selection)`, `queue(target, signal)` and `dispose()`. Request is `{operationId,nonce,task_id,goal,completion_condition}`; target is `{task_id,generation}`. Owner-only direct delegate is labeled owner ingress; registered scoped `dsh_bot_delegate` execution is labeled bot-tool ingress and retains callId/rootCallId plus origin Session. Tool parameters are only task_id/goal/completion_condition. Its operation/nonce derive deterministically from retained origin identity and official callId; no raw tool token is persisted. Delegate commits existing delegation, ensures creation via the new retained port method, and returns the exact work view. It does not admit execution or implicitly queue a message.

Register the tool only through originAgent.ctx.tools, never root/global tools. The worker target remains tool-free. The registered body checks exact exec.agent, live origin/owner binding and signal before mutation; wrong inputs cannot reach Host. Dispose unregisters only this installation and permanently invalidates it. No source object, owner caller, grant, private ledger, runtime port or raw diagnostics are returned to browser code.

## Existing manager and creation bridge

Extend `OwnedWorkSessionOptions` with optional owner-supplied `creation:{cwd,port:OwnedCreationPort}` and optional retained producer provenance/lifetime binding used only by the private installer. Retain port method identities. Existing callers without creation remain unchanged. Add `OwnedWorkSessionPort.createSession(envelope, target): Promise<WorkSessionView>` with command `prepareWorkSessionCreation` for its synchronous preparation. Add `creationOperationId` and a separately labeled creation receipt to the view; existing runtime `evidenceKind` keeps its present meaning.

Preparation must run inside the existing Host/Ledger.operation transaction after the same replay/Bot/config/task/generation checks. It associates exactly one `kind:'execution'` creation intent with the work's already-reserved sessionId/taskId. It copies current preset/cwd/grant/config/task epochs and root instruction reference, and records a work binding `{task_id,generation}`. It never allocates another Session ID. Same work and same creation operation reuses the original intent; differing instructions, cross-Bot replay, changed cwd/preset or stale generation conflict. Cwd comes from retained owner configuration, not tool input.

Invoke the existing SessionCreationDriver outside the transaction. Extend its fence to include that exact work binding/current generation/fence and an optional synchronous retained-lifetime guard, checked wherever the existing fence runs. Existing callers retain their current behavior. A synchronous check immediately before native effect prevents disposed/revoked/fenced work from starting. Later revocation/fence leaves original identity auditable and forbids a late successful mapping.

After the driver returns, the manager projects confirmed/unknown creation into the exact current mapping in an existing transaction, without inventing a runtime receipt. Creation cannot change execution state to running/waiting/completed, release an admitted slot, overwrite a previous generation, or change offline synthetic source continuity. Once driver state is created, repeated creation returns its durable historical receipt even after a queued message makes the Session nonblank. Do not re-demand current blankness for a previously verified creation.

The installer wraps the existing DshAdapter allowlisted port with durable proof using the same original ID. On creation: official create, verify live exact Session/Agent/scope/effective preset/tool counts, await actual sessions.flush, and read persisted header/events. Durable proof requires matching id/cwd/preset, `isSeeded===false`, empty raw events and nonzero header storage. No fallback from failed flush/readback to memory-only created. After an ambiguous create, only inspect the original ID; never call create or resolveAgent as recovery. Cold evidence may prove persisted identity without proving a live effective Agent; keep unknown if the original driver proof contract cannot be met.

Three load-bearing edge rules:

1. Once original creation is durably created, a later generation reuses the same Session and historical proof after checking the current work/owner binding. It must **not** call driver.run on the generation-1-bound created intent, since its old-generation fence could rewrite created to fenced. Old pending generation-1 results still cannot bind generation 2. The manager distinguishes historical created identity from an in-flight generation-bound intent before selecting this path.
2. Add a separate `sessionCreation` view/record discriminant, with state `none|unknown|created` and proof kind `stock-session-durable|fixture-contract|null`, plus original operation/session/preset identity. The actual stock installer supplies the retained durable adapter; arbitrary offline runtime receipts cannot set, erase or downgrade this field. Existing `creationState` and `evidenceKind` remain the synthetic execution contract fields, clearly documented as such. Source labels alone never promote a fixture-contract proof to stock-session-durable.
3. A sending/unknown queued message is reconciled only by cold lookup of its final original message ID/source/content. Failed flush, send-then-throw or post-effect authority loss never causes resend, new message identity or wake. A late matching read after revoked/fenced authority cannot project a successful receipt into a current work generation.

No new product private-Ledger mutation path exists in bot-producer. Commands/provenance/delivery states are recorded by the work manager through Host operations, and creation/nativeSession rows remain owned by SessionCreationDriver.

## Truthful message and no-wake queue

Declare `MessageSourceMap['dsh-bot']` with kind dsh-bot, retained producerId, ingress (`owner` or `bot-tool`), originSessionId, botId, taskId, sessionId, generation, operationId and optional tool callId/rootCallId. Source fields describe provenance; none is authentication. Construct via actual createUserMessage. The official representation has role=user; source remains dsh-bot and documentation must never call the message human/user-origin.

Queue is a separate explicit operation after created proof. It validates exact current generation, no fence, current owner/origin, target Agent and Session identities, target idle, and actual zero global/scoped target tools. Persist an original message identity/content/source before effect via the manager. Call only retained target `send(message,'next-turn',false)`; never followup/steer/inject/cancel/resolveAgent in the real queue lane. Recheck owner/current mapping after flush and cold original-ID readback. The receipt says durably-queued only if the exact message ID/source/content exists in the actual inbox log. Otherwise retain unknown and original identity; recovery queries that identity and does not resend. Repeated queue must reuse the original message and refuse conflicting content/generation. No other wake producer is mounted in acceptance.

A durable pending message can execute if some future owner wakes the Session. This slice adds no wake path, and the disposable proof runtime is torn down without resuming it. A no-wake queue receipt cannot free a may-execute lease or be interpreted as per-message settlement. The actual target is blank at creation proof time and nonblank after inbox insertion; evidence records both times.

## Stock/development boundary

Installed rc.2 supports ordinary create/adopt, typed producer sources, Agent queue and cold reads. It lacks the development dsh-experimental-native-run package. Existing native-controller and owner-app stay outside the new stock import graph. Dynamic protected target registration, exact generation dispatch/lookup/stop and settlement receipts require separate native/core approval. This implementation leaves native execution unsupported while delivering creation and producer behavior.

UI selected-Bot submit/followup/stop remains refused pending parent authorization. No write RPC, public service, production binding, provider/auth-service composition, environment/config/profile access, listener, shell/fs/HTTP model tool or persistent setting change is added.

## Verification contract

Use targeted RED/GREEN tests for newly reachable producer/creation behavior, affected creation/work compatibility, strict changed declaration consumers, actual stock disposable fixtures and installed-tar independent cases. Do not redispatch prior43+12 acceptance as a new deliverable or run broad unsafe suites.

Actual fixture: stock Cordis/SessionStore/JSONL/Agent/tool/preset/query services, empty preset, no ambient boot listeners; blocked synthetic LLM counts and throws on prepareCall/stream. Prefer actual SessionController.create with fully inventoried safe dependencies. If that controller cannot compose under restrictions, label a fixture adapter accurately, preserve actual Session/Agent/persistence proof, and report the controller lane separately blocked. Never relabel a stub endpoint as actual Controller. Cold context has no live target and does not resolve/resume Agents. Inspect actual compression settings before choosing no-compression.

Each execution uses pinned Node, literal allowlisted child env, explicit cwd/argv, inspected offline guard and filesystem roots/caps, bounded timeout, recorded UTC start/end/elapsed/exit/stdout/stderr and IO counters. Zero model/provider/network/listener/child attempts is required. Stop a novel prohibited IO immediately and retain its failure. Pack/install locally with scripts ignored and npm update notifier false; verify source/tar/installed hashes. No git operations, SDK edits or new dependencies.

Review focus: owner disposal and same-ID Agent replacement; stale cross-Bot operation replay; create-then-throw recovery; fence during native await; failed durability acknowledgement; queue ambiguity/resend; actual creation versus synthetic execution evidence; old-generation capacity release; unchanged public refusals.

Credential import clarification (written preflight): the actual stock SessionController imports credentialRef, a harmless reference-constructor declaration. That import is permitted after inventory; credential resolution, auth-service composition, provider loading, real profile/config/environment reads remain prohibited. Guarded execution stops on unexpected side effects.

Authorized interface refinement: creation may carry synchronous portFor(intent) instead of port; invoke once after intent commit with frozen copied intent, retain exact returned port/methods, reject thenables, and skip factory/driver for historical created generation reuse. This preserves fixed ID allowlists and stock proof identity.
