# Create-Bound Session Acceptance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with the existing sole cloud writer after the root reviews this exact scope. Do not request a fresh user approval for every test assumption; prior isolated-cloud and purpose-test authorization persists.

**Goal:** Close the basic creation feature: select an opaque AgentPreset ID, create one owned native Session under it, and confirm the actual projection. No hot switching or immutable cross-restart fingerprint requirement.

**Architecture:** A narrow owned creation port calls existing rc.2 SessionController.create using a durable predetermined Session ID. The control ledger records creation intent and confirmed binding, while native DSH remains the Session owner. The separate private 90-test journal/transport slice is not implicitly installed in the native AgentLoop.

**Tech Stack:** Existing pinned npm rc.2, Node24.19.0, a fresh workspace-only SDK-minimal-derived Home, no new dependencies or credentials. Zero model tools and no public/browser service.

**Spec:** `docs/session-mode.md`; user scope: “创建时绑定模式就行”. Product baseline `1ada6886b3f0d7c239bbb3519f6d178123b561a6`, tree `f70eaf05de1b94fccd74dbcc79ffe929fe81cb9d`.

## Exact blockers and what is already available

1. **DSH has the creation API.** SessionController.create accepts agentPreset/sessionId/cwd, mounts the current definition before publication, and returns the resolved ID. Lack of a DSH creation method is not the blocker. Source commands.ts:105–143 and agent.ts:381/485.
2. **The candidate has no native creation bridge yet.** DshAdapter has read-only catalog methods; its private preflight still includes the now-unnecessary mode_revision_unavailable. Public dshBot.execute always rejects unsupported_host_identity. Merely enabling that method or calling SDK as its fallback would bypass the existing boundary.
3. **A private owned acceptance entry can test creation without production/browser identity.** The explicitly authorized launcher owns a fresh in-process runtime and one isolated Home, retaining only its own context/Session IDs. No BrowserAuth/token is generated and no serialized actor claim is accepted. This does not grant a production principal or open the public plugin service.
4. **The 90-test slice is a separate controlled text consumer.** NativeTarget has no Session ID or AgentPreset; product config identity is a string UUID, native configVersion is numeric. Its atomic admission and dispatch guard do not currently wrap native Session creation, inbox or AgentLoop. Do not cast these types together or claim a combined closed loop.
5. **Guarded real transport has an additional integration gap.** NativeRunHost.driver requires provider-owned options/resolveAuth/resolveUserId/prepareExtensions callbacks. Current registerDeepSeekProvider returns void, keeps auth resolution inside the provider, and registers an ordinary adapter without the private journal guard. No public opaque factory hands the controlled driver these dependencies. Do not read keys/headers, inspect private adapter state, or substitute an unguarded adapter. This is a guarded-transport integration gap, not evidence that the user's already-working API authentication is missing.
6. **No durable mode fingerprint is required for basic creation.** Native restart rebinds the saved ID to its current healthy definition. Document that limit; reject missing/broken definitions without standard fallback. Preserve caller/grant/epoch/operation/dispatch/stop guards where those operations actually occur.

## Global constraints

- Sole writer remains 历史隔离位置〔dsh-bot-development.〕 Keep product and safety patches independent; do not modify production runtime or source safety slice in this creation-only round.
- No model request this round, no listener startup, BrowserAuth/token, raw credential read/copy, new permission, push/merge or hot switching.
- Preserve legacy plan/permissions/model fields, config/Attempt/ProgressPlan snapshots and existing operation receipts.
- Own test mode uses plugins:[]; do not mount shipped tool-bearing presets or claim the test mode is the user's actual private composition.
- Unsupported public product commands remain unavailable. A probe result cannot turn nativeRuntimeVerified/releaseReady true.

## Review focus

- Config agentPreset maps to exactly the created native Session projection; name is never identity.
- A native await followed by revoke/archive must not enable prompting an old creation.
- Lost create receipt uses the original predetermined Session ID and a bounded cold lookup, never blind recreation.
- Both global and Agent-scoped model tool counts must be zero before any optional prompt.
- Restoring native current-definition semantics must not be misreported as immutable configuration recovery.

## Completed independent checks in this round

- [x] Both exact patches independently pass git apply --check --cached against separate temporary indices at their respective bases; real indices/source files not altered.
- [x] All24 safety source hashes and all9 reviewed product functional hashes match their manifests.
- [x] Strict NodeNext cross-contract consumer: seven positive interface assertions plus one expected string-to-numeric config-generation rejection pass. The first compiler attempt lacked external NodeJS/Disposable ambient types; using the fixed source's Node types and disposable lib resolved it without source changes.
- [x] Read source evidence for native create/preset mount/projection, absent private Session binding, and provider-owned auth/factory gap. No credentials or private Sessions read.

## Task 1: Creation-only port and keyless on-site proof (zero provider requests)

**Files proposed for next implementation:** src/session-mode.mjs, src/adapter.mjs, src/host.mjs, src/contracts.d.ts, test/session-mode.test.mjs; owned probe/evidence outside repo in 历史隔离位置〔dsh-create-binding-stage0.〕 No DSH core change is needed for this task.

**Interfaces:** immutable CreationIntent {operationId,sessionId,botId,botEpoch,configVersion,cwd,agentPreset,state}; owned port create(intent) -> native ID and exact observed preset; confirmation checks intent/epoch/binding. A pure prepared request is not an execution permit.

- [x] TDD: remove mode revision as a mandatory creation requirement; preserve all other command boundaries. Cover wrong caller, stale Bot epoch, different native ID/preset, missing projection, receipt uncertainty and unchanged legacy snapshots.
- [x] Persist creation intent and exact ID before native await; one owned consumer invokes SessionController.create({sessionId,cwd,agentPreset}). Recheck current authorization/epoch afterward before confirmation or any prompt. If effect is uncertain, retain unknown and inspect that same ID once; do not retry automatically.
- [x] Boot a fresh keyless SDK-minimal-derived Home with no web/browser/telemetry/model tools. Register one actual official declarer with opaque acceptance ID, custom display name and plugins:[]; read its healthy native roster through the candidate adapter.
- [x] Create at most one Session; allow one unknown-ID negative call and one same-ID adoption check (maximum3 create API invocations, no more than1 created Session). Confirm returned ID and ctx.sessionProjections.stateOf(theOwnedSession,'agentPreset'). Controller inspect returns meta/events, not projectionValues; if using wire list, require its own row and sequenced projections.values before explicit DTO translation.
- [x] Verify global and scoped model-tool counts0, no default mutation, no model/provider start. Dispose only the privately owned runtime; never unlink native history to hide an uncertain outcome.
- [x] Evidence records actual runtime/package/version, Bot config ID, native Session ID, preset ID, projection match, tool counts, call counts, elapsed time and disposal result. This proves creation binding only; actual user tool-bearing roster remains outside this zero-tool acceptance scope.

## Task 2: Optional one real zero-tool first reply, after creation proof

**Caller:** same explicitly authorized private runtime owner; not a BrowserAuth caller or public plugin command fallback.

**Operation:** one new stable probe operation on the already-created owned Session; provider deepseek-official/model deepseek-flash, reasoning off, maxTokens96, maxRetries0. Prompt contains only a short public acceptance password, no private code or user data. Use the official runtime's existing configured authentication/proxy path; do not resolve/copy keys in the probe.

**Evidence:** track must be native-substrate, not private-90-guard or complete-Bot. Record native Session/preset projection, actual model, success/error category, known usage or unknown, elapsed/first-text time and exact stop/disposal outcome; omit raw keys/auth headers/full config/model source payload. This validates the first reply under a created binding without promoting unsupported product gates.

**Bounds:** maximum1 actual request, provider deadline30s, local shutdown deadline10s, whole stage60s. If a reply completes before cancellation, report that fact; do not repeat to force a cancellation PASS. First auth/proxy placeholder/missing credential/403/network/429 failure stops the stage. Abort/idle/timeout do not prove remote settlement; unknown stays unknown and is not replayed.

**Prerequisite:** root must review this distinction between the separately authorized native substrate probe and production/candidate fail-closed execution. If the requested result instead must demonstrate the private 90-test guard on a native AgentLoop request, do not use Task2 as a substitute: that integration does not exist yet. It requires a narrowly reviewed provider-owned guarded factory/AgentLoop-operation seam and remains separate from the basic creation feature. No new scope is assumed here.

## Review evidence and exact deltas

Product patch: 历史隔离位置〔agent-preset-adaptation.patch〕,93443 bytes,SHA256834ba29c3cb0dbc93376d53a233c56d2c58143317220040c40a0b752594ebc0d; product review noP1/P2/minor,9 functional files fingerprint e4ef97892db952ff1ea2d9f690009b6a5a90f6974f06568f8686a507992c52af;86/86 tests.

Safety patch: 历史隔离位置〔native-slice.patch〕,113706 bytes,SHA2561515086b03e060a2acf5b77f69a24be90c463e793e4f363c3c8e00944f767261; independent GPT-6.1Sol/xhigh review noP1/P2/minor;90 focused tests plus3 built-artifact crash windows, synthetic-only. Existing46 native mode baseline stays separate.

The preceding diagnosis-only round's documentation diff and check receipt are 历史隔离位置〔creation-binding-plan.diff〕 and diagnosis-receipt.json. That preceding round changed no product behavior or core and ran no true request. The root subsequently approved implementation and zero-provider probing; no repeated user approval loop is introduced.

## Executed creation-only result

Approved Task1 completed with sole cloud writer. Added a private package subpath driver and durable ledger intent, no public caller enablement. Independent review found a repeated/reopened wrong-ID receipt issue; fixed durably before another await. Initial actual boot exposed Cordis fresh proxy reference equality; two RED→GREEN tracker identity tests and independent review fixed it. First boot created no Session and its failed receipt remains separate.

Final fresh Home2 native run: product1 create + readonly projection confirmation; repeat0 new effects. Two optional substrate calls (same-ID adoption and exact agent-preset/not-found) gave total3 calls and1 Session. Native global/scoped tools0,turns/provider requests/network/listeners/subprocess attempts0,shutdown complete0.391s. Product guard103/103,static30,strict types and runtime export verified. Native carrier support is a custom permanently denied route registry because default browser connection would generate prohibited BrowserAuth; official SessionController/AgentPreset/Agent/projection all actual. Task2 intentionally not executed this round.
