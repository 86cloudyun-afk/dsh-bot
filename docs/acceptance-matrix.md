# Acceptance matrix · alpha control layer

No F or U row below is a complete native acceptance PASS. `local` means actual SQLite/Host code under the isolation guard; `synthetic` means manually supplied source/verifier data; `blocked` means the native requirement remains a release blocker. Named tests cover the listed subset only. Full TestContract native trace, provider requests and semantic evidence are absent.

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
| F10 | immutable Bot config versions and Attempt/Progress snapshots | Per Session selection and atomic provider dispatch freeze blocked |
| F11 | route values retained; no fallback or native selection issued | Image/default/cold native route consistency untested |
| F12 | no native request permitted | Shared model capacity, 429 and reserved interaction slots blocked |
| F13 | separate contact record exists, UI explicitly disables conversation | Independent real natural-language replies under background load blocked |
| F14 | local meeting material namespace checks; scoped cold-read filters explicit IDs | Native model input/tool/file/retrieval enforcement blocked |
| F15 | local trusted configured human; body actor spoof rejected; manual producer marked human | Native Bot/Host producer bridge and cold provenance blocked |
| F16 | local canonical alias dedupe, removal/rejoin generations and outbox revocation | Actual model delivery remains blocked_native |
| F17 | local empty-topic/material validation and frozen digests | First real model input/topic marker untested |
| F18 | local sealed public view, independent meeting IDs and explicit revoked missing participants | Actual independent Bot opinions/summary tracing blocked |
| F19 | local duplicate opinion obligation rejected and manual opinion budget retained | Authorized A→B→A execution, token budget and cycle policy blocked |
| F20 | local manual submission != verification; human check bound to digest/acceptance version | Actual goal execution/delivery/semantic artifact acceptance not run |
| F21 | local Bot archive/restore preserves metadata with fresh epoch | Native log readability/partial stop/unarchive blocked |
| F22 | persistent browser operation; local monotone cursor rejects gap; synthetic projection gap marked stale | Native follow reconciliation, server-independent live work blocked |
| F23 | no performance claim, baseline, p95 or release-ready flag | Load and same-route baseline unapproved/unmeasured; all six hard gates blocked |
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

Added scope: per Bot sessionModes are versioned `{plan:null,permissions:null}`; nonempty mode selection fails closed pending user domain and live catalog. Autonomy policy/plan/checkpoint/eventCursor/nextStep are real local records, bounded, no dispatcher, LLM planner, automatic scheduled check or cost. Unknown stays reconciling_unknown; stop/archive epochs reject late progress. These additions do not pass any native gate.

The isolated cloud test task is independently authorized and owned by the parent. No cloud result is included here until an exact source commit, tested host version and returned evidence are reconciled. Cloud proof cannot prove another host's loaded state.
