# Single Bot Work-session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after root preflight. The approved three-role process overrides skill defaults: sole writer implements; the existing independent reviewer reviews; no child agents and no commits.

**Goal:** Add an owner-facing single-Bot work contract with stable task/session/generation identity, reuse, nonblocking query, bounded receipt collection and conservative shared 15-slot admission.

**Architecture:** Host retains owner authority and one runtime source, with durable work state in its existing transactional ledger. A focused internal module handles state and receipt rules. Stock dispatch remains precisely unsupported; explicit offline synthetic runtime fixtures exercise transitions without model/API work.

**Tech Stack:** Existing Node 24, ES modules, node:sqlite memory fixtures, node:test, installed TypeScript 6.0.3. No dependency downloads or SDK/core changes.

**Spec:** `docs/superpowers/specs/2026-10-06-single-bot-worksession-design.md` (read together with approved-scope.md and independent/preflight.md).

## Global constraints

- At most 15 held work reservations per Bot across all retained ports and root/child policy records; reserve before any async runtime call.
- queued, confirmed nonexecuting waiting and archived use 0 slots; admitted/running/unknown/unconfirmed stop retain 1. A fenced unknown generation remains counted.
- task_id + goal + completion_condition required; same Bot/task_id and unchanged semantics reuses; conflicting semantics fail.
- Stable botId -> taskId -> sessionId -> generation. Reserved Session identity is not confirmed creation or execution.
- Only actual retained owner capability invokes writes. No fabricated human identity, direct external Ledger writes, public write RPC or browser authority.
- Offline only; no model/API/network, profiles/secrets/environment dumps, SDK changes, deployment, push, commit, merge, broad default/native/profile/platform suites or evidence cleanup.
- Existing dependencies only. Preserve old candidate/main/frozen tarball/evidence and every failed run. Npm notifier override is child-environment-only.
- Phase 1 stops at written artifacts. Every checkbox below is initially unexecuted.

## File ownership

Writer only: `src/host.mjs`, new `src/work-sessions.mjs`, `src/contracts.d.ts`, `src/host.d.ts`, small `src/native-controller.mjs`/`.d.ts` wrapper, new `test/work-sessions.test.mjs`, new `test/work-sessions-types.mts`, new `docs/work-sessions.md`, these planning docs. Root owns coordination/evidence. Existing independent reviewer owns independent tests/evidence; no candidate edits. No package export change is required because `dsh-bot/host` already exists.

## Review focus

- Conflicting mutable task inputs and replay under new operation IDs: mapping cannot change or duplicate (Task 1 identity test).
- Simultaneous admission through different ports/reopened Host: no counter reset or 16th start (Task 1 capacity/recovery test).
- Unresolved start/lookup and stale cancellation receipt: query stays responsive and slots remain held (Task 1 pending-state test).
- Late receipt after local fence/resume/revocation: no old-generation result mutation; exact old settlement can only release its own reservation (Task 1 fence test).
- Apparent native success through dev SDK remapping or constructor-only fixture: label synthetic/development, prove default installed unsupported separately (Task 2 package test).

## Task 1: Cohesive runtime, declarations and contract tests

**Files:** all writer product/test paths listed above; spec fixes exact validation bounds, fields, command names, status/slot rules, source semantics and unsupported variants.

**Interfaces:**

- `Host({ledger,ownerHumanId,adapter?,ownerCapability?,workSessionRuntime?})`; runtime optional and accepts only explicit `OfflineWorkSessionRuntime` with `kind:'offline-synthetic'`, `sourceId`, `start(binding,signal)` and `inspect(binding,signal)`.
- `Host.openOwnedWorkSessionPort(caller,{botId,botEpoch,authorityEpoch,isCurrent?}): OwnedWorkSessionPort`.
- Frozen port: `delegate(e,p)`, `query({task_ids?})`, `admit(e,{task_id,generation})`, `collect({task_id,generation})`, `fence(e,{task_id,generation,reason})`, `resume(e,{task_id,generation})`, `spawnChild(p)`, `dispose()` as specified. Mutations use existing `Receipt<WorkSessionView>` semantics; collect Promise is bounded at 2000ms; query is synchronous.
- `OwnedNativeController.workPort(caller,options)` forwards to Host with actual fiber/controller liveness; constructor-only compatibility only. Do not alter native open/admit/drive/stop behavior.
- Internal `createTaskRecord(payload,taskId=randomUUID())` reuses task creation; `workTask` and `workGeneration` rows are the only new kinds. Pure `validateChildLineage(parent,child)`/slot policy helpers can be unit-tested without exposing a public child execution API.

- [ ] **1. Read preflight; prepare isolated evidence harness.** Confirm this exact candidate still matches baseline except the two docs. Read independent/plan-review.md, the historical guard, fixture imports and selected tests. Copy guard pattern to new `writer/io-guard.mjs`; intercept network/child IO and provide model denial; use an explicit end-of-run JSON counter. Prepare literal child environment and log command/start/end/elapsed/exit/stdout/stderr separately. Do not run historical top-level npm test/check/native scripts. Do not delete temporary fixture evidence.
- [ ] **2. Write genuine RED tests in `test/work-sessions.test.mjs`.** Begin with an existing Host fixture using memory Ledger and an opaque synthetic owner, created through existing commands. Assert missing `openOwnedWorkSessionPort` as feature RED, then behavioral tests below. No unconditional throw or edited baseline test to manufacture failure.
- [ ] **3. Run RED once under guard and filesystem permission sandbox.** Expected: missing-feature assertion, zero network/child/model calls. Record failure with original logs. Stop on novel IO; diagnose before further execution.
- [ ] **4. Implement retained authority and durable identity.** Add private Host dispatch/lifetime fencing before operation replay; factor internal task creation, register narrowly guarded work handlers in `src/work-sessions.mjs`, and clone inputs/views. Capture Bot/task/config/authority revisions. Test same task across two ports/new op IDs/at capacity, semantic conflict, invalid exact-key input, prototype-like opaque IDs, wrong caller/Host/Bot, direct-handler bypass, read-only port, revocation before replay, mutation of input/output, and reserved creation status. New operationId for same task returns current state; exact replay stays historical only when current fences permit it.
- [ ] **5. Implement atomic admission and nonblocking source calls.** No runtime means queued + `unsupported_work_generation_receipts` with no native call or slot. Synthetic start is scheduled only after committed reservation; duplicate replay must not reschedule it. Tests: first 15 held, 16th queued; duplicate at saturation; 14 held plus two concurrent candidate admissions; two ports one Bot, another Bot isolated; reopen conservatively preserves reservations. Explicit continuity test: Host A admits unresolved work; Host B on the same ledger with a different runtime and identical sourceId/copy of quiescent receipt gets `work_source_continuity_unsupported`; A's result/held reservation remain unchanged and B cannot resume or restart it. Same-Host new ports retain the original runtime. Known legacy blockers use real nativeOperation states admitting/admitted/driving/consumed/unknown and task/nativeBinding ownership, plus attempt run identity/stop uncertainty; prepared-only creations/operations and contact targets do not count as executing. Hold start promise unresolved and assert synchronous query immediately returns same reserved identity; missing/ambiguous create stays unknown without replacing Session ID or issuing a second start. Before deferred start recheck lifetime/config/task/grant/source/generation/fence. Test admit then synchronous terminate, dispose, or revoke before its scheduled callback: zero start calls; release only via exact Host's proven never-invoked path and record no completion. Once start is invoked, rejection/uncertainty holds reservation. Settle error callbacks safely.
- [ ] **6. Implement bounded collection, fences and resume.** Lookup comes only from retained source. Exact identity/source/op/sequence/schema required; duplicate exact receipt no-op; conflicting receipt ID rejects; stale sequence/wrong generation ignored or rejected without regression. Tests: unknown retains slot; unconfirmed waiting/cancel does not free; exact quiescent waiting frees; resume increments generation, preserves Session/task and reacquires on admit; resume at capacity cannot execute. Termination/handoff fences completion before await; late receipt cannot change current result. Old exact terminal settlement may only release old `workGeneration` reservation. Revocation/config/task changes during collect cannot publish result. Test a source ignoring AbortSignal and never resolving: collect settles within 2000 ms using an independent timeout race, reports unknown and retains its slot; repeated collect refuses while the original lookup remains pending instead of spawning another. Eventual late resolution/rejection is contained and cannot mutate state. Verify timer/listener cleanup, rejection, mismatched source instance/label, stale receipt and detached view. No claim of preempting synchronously blocking adapter code. Runtime fixtures are explicitly synthetic and contain no real provider.
- [ ] **7. Pin child and main-channel boundaries.** Pure policy cases: root plus at least two depth-1 children use one shared 15 budget; depth 2 rejected; only genuine parent quiescence releases its slot. Public `spawnChild` returns precise unsupported without task/Session/slot changes. Main/contact activity never counts as a work reservation; do not claim actual main-message responsiveness, only synchronous owner query during pending work.
- [ ] **8. Add declarations and docs.** Exact interfaces, discriminated unsupported/synthetic/reserved status, bounded receipt source types, readonly DTOs, no any-based proof. `test/work-sessions-types.mts` includes positive package import and @ts-expect-error cases for missing completion_condition, wrong generation, invented native runtime label, forged receipt submission and runtime access on read-only port. Document unsupported actual ingress/creation/run/stop/children and exact coverage. Re-export host types, no new runtime package export.
- [ ] **9. Run focused GREEN and strict declarations.** Run new contract test under the recorded guard. Select existing `test/owner-management.test.mjs` and `test/owner-read-port.test.mjs` after inspecting imports; memory-only constructor/read/dispose compatibility is optional and must use separate development label if dependency remapping is required. Do not select profile/native suites. `tsc --noEmit --strict --skipLibCheck false --module NodeNext --target ES2022 --types node` against source and explicit existing typeRoots. Expected: all selected assertions pass, zero prohibited IO, all resources disposed. Re-run only changed/failing/unresolved checks.

## Task 2: Packed and actual installed acceptance, provenance, independent handoff

**Files:** new evidence under `writer/`; new isolated consumer there; `docs/work-sessions.md` updates only if verified outcomes require clarification. No edit to old consumer or dependencies.

**Interfaces:** consume the frozen implementation through `import {Host} from 'dsh-bot/host'` and exported work types, not an absolute candidate src import. `native-controller` default-import failure is a capability boundary, not feature GREEN.

- [ ] **1. Freeze candidate hashes and inspect npm package whitelist.** Hash every manifest baseline path plus approved new files. Compare original source again. Ensure source has only approved changes, no secrets/state/symlinks/fixtures in tar; npmignore already excludes planning/test artifacts as configured. Preserve a manifest with direct baseline SHA and exact changed/new/unchanged counts.
- [ ] **2. Pack locally under guard.** Use pinned existing Node/npm CLI, `npm pack --offline --ignore-scripts --json --pack-destination <new writer/pack>`. In this child only, set `NPM_CONFIG_UPDATE_NOTIFIER=false`, temp cache and user/global npmconfig paths. Use empty config files, no real profile. Hash tar and record contents. Package lifecycle scripts never execute.
- [ ] **3. Install the exact tar into a fresh isolated consumer.** `npm install --offline --ignore-scripts --legacy-peer-deps --no-audit --no-fund --no-package-lock <new tar>` using only already available local dependency paths when required. No downloads or SDK/dependency modifications. If no dependency is needed for `dsh-bot/host`, do not add one gratuitously. Verify installed file hashes against tar and source; record actual resolved package path and runtime provenance.
- [ ] **4. Run installed contract acceptance and strict types.** Reuse reviewed synthetic cases via installed package export; no source import fallback. Cover identity/reuse, saturation, unresolved query, fenced late receipt, exact source settlement, real default unsupported and read-only denial. Strict type fixture imports `dsh-bot/host` from the new consumer. All prohibited IO counts must be 0. Stock Session capabilities remain static inspected evidence unless later separately authorized.
- [ ] **5. Hand frozen artifacts to existing independent reviewer.** Provide exact tar/hash/consumer path, source manifest, RED/GREEN logs, strict type logs, IO counters and changed-file diff. Root and reviewer perform their own checks. Fix review findings in candidate, preserve original failed evidence, and repeat only affected verification plus fresh pack/install hashes when product changed. No new agent or commit.
- [ ] **6. Report truthfully.** Separate completed product contract from offline synthetic runtime and stock unsupported paths. State remaining Bot/main/plugin authority ingress and native generation settlement gap. Include artifact links and all remaining blockers; keep nativeRuntimeVerified/releaseReady false.

## Exact runner ingredients (assemble recorded argv, do not run in phase 1)

Node: `历史隔离位置〔node〕`.
TypeScript: `历史隔离位置〔tsc〕`.
Stock deps/types: `历史隔离位置〔node_modules〕`.
Guard reference: `历史隔离位置〔io-guard.mjs〕`.

For runtime tests use direct Node test-file execution with `--permission`, read access only to candidate/new evidence/necessary existing dependencies, write only to new fixture directory, and `--import <new guard>`. No worker/child/network grants unless independently inspected constructor-only loader needs a worker; label that separate and avoid it if unnecessary. Use a 40-second external process bound. Literal child env: PATH to pinned Node plus `/usr/bin:/bin`, TMPDIR and DSH_BOT_TEST_ROOT to new fixture directory, TZ=UTC, LANG=C.UTF-8; never inherit credentials/proxies or dump environment. Do not repurpose HOME as a task variable. Npm receives only its additional temporary config/cache/notifier fields. Capture exact final argv/env when the corresponding files exist.

Self-review: all approved-scope requirements map to Task 1 behavioral assertions or Task 2 installed evidence; no implementation performed in phase 1. Root preflight is the next gate.
