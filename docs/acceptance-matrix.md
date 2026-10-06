# Acceptance matrix · alpha control layer

Current restricted entry: [native owner CLI/profile](owner-entry.md) is implemented and measured through the actual official launcher with two durable empty Sessions, prepare/admit/inspect, default run refusal, pre-stop and original-ID cold resume. No paid owner-entry run was measured in this round. This addition does not promote any historical F/U row or general product gate below to complete PASS.

No F or U row below is a complete native acceptance PASS. `local` means actual SQLite/Host code under the isolation guard; `synthetic` means manually supplied source/verifier data; `blocked` means the native requirement remains a release blocker. Named tests cover the listed subset only. Full TestContract native traces and candidate goal semantics remain absent. Bounded real provider requests and public native substrate measurements are now recorded separately below; they do not open candidate dispatch gates.

| ID | Implemented / deterministic evidence | Native remainder |
| --- | --- | --- |
| F01 | local operation/nonce binding, rollback; message+delivery+outbox share one transaction | Process-kill injection at native enqueue not run |
| F02 | local operation lookup after restart, browser retains full identity before submit | Native durable admission/lookup blocked; no recent fallback |
| F03 | epoch/fence fields retained; revoked local commands rejected | Lease takeover and final native dispatch barrier blocked |
| F04 | local durable blocked outbox; membership-generation revokes delivery and outbox together | Wake/enqueue recovery and actual replay proof blocked |
| F05 | local revoked authority, stopped task, archived owner, stale membership refusals | Async native result/publication barrier blocked |
| F06 | synthetic settlement verifier; unknown reservation remains occupied | Provider/tool/quota/OS resources and real terminal proof blocked |
| F07 | stop reports unsupported with exact stored targets; no confirmed-stopped claim | Native partial tree cancellation/retry blocked |
| F08 | synthetic old-generation observations cannot overwrite current projection | Actual old-run stop receipt/new-run safety blocked |
| F09 | persistent local ledger survives close/reopen | Real child lookup after native host restart blocked |
| F10 | immutable Bot config versions and Attempt/Progress snapshots | Agent-local selection/default separation measured on substrate (N3); candidate durable session selection and final task/grant dispatch permit remain blocked |
| F11 | route values retained; no fallback or native selection issued | Text cold resume/default separation measured (N2/N3); image route and candidate snapshots remain untested/blocked |
| F12 | no native request permitted | Real two-Agent stream concurrency measured (N4); shared quota, 429 and reserved interaction slots remain blocked |
| F13 | separate contact record exists, UI explicitly disables conversation | Real short arithmetic reply during another Agent stream measured (N4); Bot contact/execution ownership, long-tool load and reserved slots remain blocked |
| F14 | local meeting material namespace checks; scoped cold-read filters explicit IDs | Native model input/tool/file/retrieval enforcement blocked |
| F15 | local trusted configured human; body actor spoof rejected; manual producer marked human | Native Bot/Host producer bridge and cold provenance blocked |
| F16 | local canonical alias dedupe, removal/rejoin generations and outbox revocation | Actual model delivery remains blocked_native |
| F17 | local empty-topic/material validation and frozen digests | First real model input/topic marker untested |
| F18 | local sealed public view, independent meeting IDs and explicit revoked missing participants | Actual independent Bot opinions/summary tracing blocked |
| F19 | local duplicate opinion obligation rejected and manual opinion budget retained | Authorized A→B→A execution, token budget and cycle policy blocked |
| F20 | local manual submission != verification; human check bound to digest/acceptance version | Actual goal execution/delivery/semantic artifact acceptance not run |
| F21 | local Bot archive/restore preserves metadata with fresh epoch | Zero-tool native cold read/cancel/archive/unarchive/resume measured (N2/N5); candidate bad-log handling, run-addressed whole-tree stop and resource settlement remain blocked |
| F22 | persistent browser operation; local monotone cursor rejects gap; synthetic projection gap marked stale | Native follow reconciliation, server-independent live work blocked |
| F23 | no performance claim, baseline, p95 or release-ready flag | Load and same-route baseline unmeasured; metrics/load not defined; all six hard gates blocked |
| F24 | local unknown attempt/progress prevents dispatch/retry; actual native dispatch always denied | Resource-isolated concurrent live work and unified dispatch fence blocked |
| F25 | local all-or-none synthetic resource reservations; unknown not released | Real provider/OS lock concurrency and fairness untested |
| F26 | synthetic event dedupe, terminal/forward projection, trusted generation transition | Complete authoritative source trace and native replay integration blocked |
| F27 | owner/dependency blockers, no automatic reassignment, task stop epoch | Atomic role transfer and native late-output fences blocked |
| F28 | all task commands require exact taskId/revision; no global-latest selection | Natural-language ambiguity resolution and native cross-group input proof blocked |
| U1 | local same botId config update, registered-only UI | Real model failure/repaired call not run |
| U2 | persisted local archive objects; cold adapter never resolveAgent; completeness=false | Full historical ordinary/subtask/archived native inventory blocked |
| U3 | UI accurately shows unavailable contact; no canned model reply | Real independent private/group replies under long-tool barrier blocked |
| U4 | exact task CAS, pending adjustment does not activate target; stop is unsupported | Semantic clarification, priority and native settled replacement blocked |
| U5 | only coordinator local delivery without recipients; owner retained | Real coordinator reply/A→B→A/handoff blocked |
| U6 | two independent manual meeting records, seal/reveal, no fabricated missing opinion | Real deliberation/summary/meeting-close follow-up blocked |
| U7 | local restart identity, double operation collision rejected; browser same identity retry | Native commit-before-receipt disconnect/old-stop integration blocked |
| U8 | local archive/restore and unknown projections remain recoverable | Actual native bad-log recovery/partial stop/unresolved owned resources blocked |

Added scope: user mode means AgentPreset. Independent opaque `agentPreset` choices are versioned control records validated against a healthy dynamic catalog; legacy `{plan:null,permissions:null}` is retained, with nonempty plan/permission writes still unsupported. Old configs/snapshots/receipts are not migrated in place. Pure preflight itself grants no execution permit; the private creation bridge now performs one actual owned Session create and confirms its projection. Basic creation does not require an immutable mode revision. Autonomy policy/plan/checkpoint/eventCursor/nextStep remain bounded event-driven records without model dispatch or scheduled checks. These additions do not pass any native gate. See [mode design and matrix](session-mode.md).

The cloud is the sole development/test platform. Fixed host version and exact local candidate identity are recorded in the final receipt; the read-only Mac backup ref remains unchanged. No push or PR occurred. Cloud proof does not prove another host's loaded state.

## Measured native substrate (all harmless text, zero model tools)

- N1: [minimal real request](evidence/cloud-20261004/03-minimal-request.json): deepseek-official/deepseek-flash, 32 tokens, 1.58 s, completed.
- N2: [cold resume assessment](evidence/cloud-20261004/native-resume-assessed.json): complete cold read, same identity/log prefix, actual previous response recalled, completed. Strict requested seed-marker format failed and stays false. [Original malformed probe log](evidence/cloud-20261004/native-resume-diagnosed.json) is retained unreadable; it is a harness failure, not an API authentication failure.
- N3: [local model selection](evidence/cloud-20261004/native-selection-corrected.json), [saved default cold read](evidence/cloud-20261004/native-selection-read-saved.json), [untouched Home control](evidence/cloud-20261004/native-selection-read-untouched.json). Only A made the selected request; B standing selection was observed, not separately dispatched.
- N4: [real concurrency](evidence/cloud-20261004/native-concurrency-corrected.json): short substantive answer completed at 3.094 s while long stream ended at 3.217 s. This is one timing sample, not p95 or long-tool capacity proof.
- N5: [native cancel/archive/resume](evidence/cloud-20261004/native-control-corrected.json): active archive refused, cancel→aborted→idle, archive/unarchive and restored real response. Canceled usage is unknown; no provider quota refund or whole-tree settlement claim.
- N6: [actual candidate plugin load/unload](evidence/cloud-20261004/native-plugin-final.json): real Cordis fiber, service installed/disposed, zero added model tools, public execute remains unsupported_host_identity.

[JSON evidence map](test-evidence-map.json) records exact test titles, files, measured subsets and native remainders for every row. [Executable next patch design](superpowers/plans/2026-10-04-native-loop-next.md) separates public plugin extensions from required core/provider boundaries. Modes remain `{plan:null,permissions:null}`. Goals remain event driven; unknown never automatically retries.

## Exact local test mapping

| Row | Actual test name (subset only) |
| --- | --- |
| F01 | [F01 nonce identity persists across restart and conflicting binding is rejected](../test/control.test.mjs)<br>[short transactions roll back complete message and operation together](../test/control.test.mjs) |
| F02 | [client persists exact operation before submit, supports lookup after restart and never silently renonces](../test/ui.test.mjs)<br>[pending browser operation cannot execute against a replacement ledger instance](../test/ui.test.mjs)<br>[legacy canonicalVersion one operation remains inspectable and replayable without a new identity](../test/control.test.mjs) |
| F03 | [old task revision cannot be adjusted and stop never claims native completion](../test/control.test.mjs)<br>[archive keeps unknown attempt execution and resource occupancy as evidence](../test/recovery.test.mjs) |
| F04 | [remove and rejoin atomically revokes old-generation delivery and outbox](../test/collaboration.test.mjs)<br>[membership revocation keeps unknown delivery outcome visible after archive and restore](../test/collaboration.test.mjs) |
| F05 | [F05 revoked authority blocks submit but still permits inspectOperation](../test/recovery.test.mjs)<br>[F05 late opinion after membership removal cannot be sealed](../test/collaboration.test.mjs)<br>[restore does not authorize old submitted work even with a fresh task revision](../test/recovery.test.mjs) |
| F06 | [F06 precise authority settlement releases only owning attempt](../test/recovery.test.mjs) |
| F07 | [old task revision cannot be adjusted and stop never claims native completion](../test/control.test.mjs)<br>[verified responsibility does not exempt unresolved native attempts from archive fencing](../test/recovery.test.mjs) |
| F08 | [F08 old generation never overwrites current projection](../test/recovery.test.mjs)<br>[trusted generation transition advances projection while old events remain historical](../test/recovery.test.mjs) |
| F09 | [F01 nonce identity persists across restart and conflicting binding is rejected](../test/control.test.mjs) |
| F10 | [bot is registered only and config versions remain immutable](../test/control.test.mjs)<br>[plan bounds, frozen policy and bot epoch survive setting changes but reject archive resurrection](../test/autonomy.test.mjs) |
| F11 | [bot is registered only and config versions remain immutable](../test/control.test.mjs) |
| F12 | [startAttempt fails closed on native capabilities with no substitute calls](../test/control.test.mjs) |
| F13 | [Cordis public service cannot claim a human caller or expose private ledger records](../test/ui.test.mjs) |
| F14 | [F17 empty topic and cross-namespace materials are rejected](../test/collaboration.test.mjs)<br>[cold adapter uses only list/inspect, filters scoped ordinary sessions and never claims completeness](../test/adapter.test.mjs) |
| F15 | [HTTP trusted entry rejects origin, rebinding and spoofed actor before side effects](../test/ui.test.mjs)<br>[trusted actor cannot be spoofed by envelope body and bot lacks root grant](../test/control.test.mjs)<br>[Cordis public service cannot claim a human caller or expose private ledger records](../test/ui.test.mjs) |
| F16 | [F16 canonical aliases deduplicate to one delivery and preserve group context](../test/collaboration.test.mjs)<br>[F16 removal revokes only that member and rejoining gets new generation](../test/collaboration.test.mjs)<br>[membership removal preserves confirmed delivery and outbox history](../test/collaboration.test.mjs) |
| F17 | [F17 empty topic and cross-namespace materials are rejected](../test/collaboration.test.mjs) |
| F18 | [F18 two meetings retain independent topics and sealed opinions](../test/collaboration.test.mjs)<br>[F18 reveal requires complete sealed phase and never invents missing opinions](../test/collaboration.test.mjs)<br>[archive restore cannot satisfy a meeting obligation from the old bot epoch](../test/collaboration.test.mjs) |
| F19 | [F19 duplicate obligation never consumes a second opinion budget](../test/collaboration.test.mjs) |
| F20 | [F20 submitted never self-verifies and acceptance is bound to exact revision](../test/recovery.test.mjs)<br>[pending target adjustment cannot submit or accept old acceptance criteria](../test/recovery.test.mjs)<br>[stopped submission cannot be accepted, cannot reach verified](../test/recovery.test.mjs) |
| F21 | [archival remains recoverable and does not dispatch or claim stopped](../test/control.test.mjs)<br>[archive and restore fences prepared task submission and old delivery generations](../test/recovery.test.mjs) |
| F22 | [client persists exact operation before submit, supports lookup after restart and never silently renonces](../test/ui.test.mjs)<br>[cursor gaps and altered event identity are rejected; elapsed window remains unverified](../test/autonomy.test.mjs)<br>[unknown execution is visible outside collapsed details with all status dimensions](../test/ui.test.mjs) |
| F23 | No performance test; unmeasured, no PASS claim |
| F24 | [F24 unknown attempt blocks retry and does not release resource](../test/control.test.mjs)<br>[unknown progress checkpoint never advances or retries effect; events are idempotent](../test/autonomy.test.mjs) |
| F25 | [F25 resource plan is all or none and unknown remains occupied](../test/recovery.test.mjs) |
| F26 | [F26 duplicate and late same-generation events cannot regress settled state](../test/recovery.test.mjs)<br>[same-generation nonterminal state cannot regress](../test/recovery.test.mjs)<br>[trusted generation transition advances projection while old events remain historical](../test/recovery.test.mjs) |
| F27 | [stopped or archived-owner task rejects manual submission](../test/recovery.test.mjs)<br>[restore does not authorize old submitted work even with a fresh task revision](../test/recovery.test.mjs) |
| F28 | [old task revision cannot be adjusted and stop never claims native completion](../test/control.test.mjs) |
| U1 | [bot is registered only and config versions remain immutable](../test/control.test.mjs)<br>[bot policy and session mode are independent version fields; native mode fails closed](../test/autonomy.test.mjs) |
| U2 | [cold adapter uses only list/inspect, filters scoped ordinary sessions and never claims completeness](../test/adapter.test.mjs)<br>[archival remains recoverable and does not dispatch or claim stopped](../test/control.test.mjs) |
| U3 | [Cordis public service cannot claim a human caller or expose private ledger records](../test/ui.test.mjs) |
| U4 | [pending target adjustment cannot submit or accept old acceptance criteria](../test/recovery.test.mjs)<br>[task stop fences checkpoint and pending plan cannot claim delivered](../test/autonomy.test.mjs) |
| U5 | [ordinary group input only targets configured coordinator](../test/collaboration.test.mjs) |
| U6 | [F18 two meetings retain independent topics and sealed opinions](../test/collaboration.test.mjs)<br>[F18 reveal requires complete sealed phase and never invents missing opinions](../test/collaboration.test.mjs) |
| U7 | [client persists exact operation before submit, supports lookup after restart and never silently renonces](../test/ui.test.mjs)<br>[two tabs cannot create distinct operations before persistence completes](../test/ui.test.mjs)<br>[late receipt cleanup preserves a newer tab operation](../test/ui.test.mjs)<br>[pending browser operation cannot execute against a replacement ledger instance](../test/ui.test.mjs)<br>[retry only recovers an existing frozen identity and never recreates a cleared operation](../test/ui.test.mjs)<br>[two first Host initializers agree on one durable ledger identity](../test/control.test.mjs) |
| U8 | [archive and restore fences prepared task submission and old delivery generations](../test/recovery.test.mjs)<br>[archive keeps unknown attempt execution and resource occupancy as evidence](../test/recovery.test.mjs)<br>[unknown execution is visible outside collapsed details with all status dimensions](../test/ui.test.mjs) |

## Create-time AgentPreset binding, 2026-10-04

[Actual native receipt](evidence/cloud-create-20261004/native-receipt.json) proves one contact Session created by the product private creation driver on npm0.2.0-rc.2/Node24.19.0. Intent and predetermined ID were durable before create; actual preset projection and both global/Agent-scoped model-tool counts0 were confirmed. Product repeat performed no new create. The extra same-ID adoption and unknown-preset rejection are separately labeled native-substrate-only. Total3 API calls,1 Session,0 provider requests,0 listeners/network/child-process attempts; shutdown completed; Homes and evidence retained, with no native history deletion or recovery claim.

[First assembly failure](evidence/cloud-create-20261004/assembly-attempt-1.json) is preserved: catalog rejected before any Session creation because Cordis service property reads return fresh proxies. The public Service.tracker identity fix has two RED→GREEN tests and independent re-review. Latest guarded total103/103 (prior86 plus15 creation and2 identity tests), static30 modules, strict NodeNext types and package export passed. Public plugin execute still rejects unsupported_host_identity; nativeRuntimeVerified/releaseReady remain false.

This measured creation subset does not make any F/U full row PASS. It uses a plugins:[] acceptance preset and custom permanent-denial headless carrier, not the browser auth path or user tool-bearing roster. No hot switch, cold Session auto-activation, model request or 90-test journal integration was performed. Basic creation accepts current-definition-by-ID native semantics and does not require an immutable restart fingerprint. Guarded paid transport still needs a provider-owned opaque factory/AgentLoop operation seam.
