# Evidence consistency and content acceptance implementation plan

> For agentic workers: use superpowers:executing-plans inline; /root is the sole source writer. Independent agents review read-only. Preserve existing uncommitted work and deliver traceable patches rather than committing or pushing.

**Goal:** Prevent stale facts from entering a quality candidate and keep native settlement, content acceptance, process exit and cleanup conclusions separate.

**Architecture:** Extend existing pure product helpers and submitTask/acceptTask. A keyless offline script binds approved evidence and verifies a candidate without issuing a model request. Current facts are generated from explicit authoritative fields; no new engine, ledger or model tool.

**Tech stack:** Node24.19.0 ESM, node:test, existing SQLite ledger/native fixture, locked pnpm11.7.0 and DSH0.2.0-rc.2.

**Spec:** `docs/superpowers/specs/2026-10-05-evidence-content-design.md`.

## Global constraints

- Native implementation stays in the already isolated cloud/control-alpha-fixes worktree; /root alone writes source.
- No paid API run, auto retry, credentials, permission changes, model tools, public listener, push/merge/deploy or formal product upload.
- Only approved mode-binding explanation and sanitized acceptance records may enter the candidate; binding metadata stays outside its text.
- Preserve historical FAIL/unknown, all76 protected files/all26701 original runtime bytes and observer/preview.
- Version floors and dependencies remain fixed. Format1 is schema only; commit alone cannot name an uncommitted overlay.

## Review focus

- Same counts with different summary bytes/path must invalidate the bound candidate (Task1).
- Scope expansion or forged confirmed SIGKILL/final product PASS must reject even newly generated input (Task1).
- A changed overlay file or runtime byte must reject despite unchanged declared manifest SHA (Task1).
- Automatic lexical pass or model text alone must not authorize task verification (Task2).
- Known receipt/nonzero process exit/unknown cleanup must remain three simultaneous conclusions (Task3).

### Task1: P0-A authoritative candidate freshness

**Files:** Create `src/acceptance-source.mjs`, `src/acceptance-source-files.mjs`, `scripts/prepare-quality-candidate.mjs`, `test/acceptance-source.test.mjs`; modify `src/native-controller.mjs`/`.d.ts`, `src/owner-app.mjs`, `test/native-controller.native.mjs` for an optional trusted source guard in the existing prepare/final dispatch checks; create new round2 quality artifacts. Leave old candidate/evidence files intact.

**Interfaces:** `prepareCandidate(template, sources, observedArtifacts)` returns PREPARED_NOT_SENT candidate; `verifyCandidate(candidate, sources, observedArtifacts)` returns the exact verified text and prepare frame. `sources` contains trusted canonical path plus raw bytes for summary, runtimeIdentity and template; observedArtifacts carries read-only hashes of the two patches and four runtime files.

- [ ] Write tests: generation59/52/104 with scope/digest/overlay identity; preserve mode/instructions; reject legacy candidate, same-count source replacement, equal bytes/different path, scope expansion, unconfirmed promotion, unknown/oldFAIL erasure, overlay/runtime changes, missing schema/file, text/metadata tampering.
- [ ] Run `node scripts/test.mjs test/acceptance-source.test.mjs`; observe meaningful RED.
- [ ] Implement deterministic allowlist facts, raw-byte/path binding, live observed artifact comparison and safe categories. No filesystem or network in the pure module.
- [ ] Add offline prepare/verify script with trusted paths, exclusive output write and safe receipt only. Script has no provider/run entry.
- [ ] Connect configured sources to existing owner preparation and controller final synchronous dispatch guard; verify source replacement during auth rejects before HTTP and preserves unknown/receipts. Unconfigured ordinary owner commands retain their existing behavior; no new stdin/HTTP/model tool.
- [ ] Run focused + all control tests; generate new candidate and verify it. New candidate stays PREPARED_NOT_SENT. Independently review source/gate and test it in actual CLI with run disabled, fresh Home/zero IO; record new byte sizes/budget receipt.
- [ ] Record source diff/hash and TDD evidence in round2 progress; do not create commit/push.

### Task2: P0-B thin guide-content acceptance

**Files:** Create `src/guide-acceptance.mjs`, `test/guide-acceptance.test.mjs`; extend `test/recovery.test.mjs` only where existing revision/digest acceptance needs a composed assertion; document exact non-CLI helper in `docs/owner-entry.md`.

**Interfaces:** `guideAcceptancePayloads({task, text, stopReason, automaticVerdict, semanticVerdict, executionEvidence})` returns artifactDigest plus submitTask/acceptTask payloads with existing acceptanceVersion/outcome. AcceptTask remains the authority/revision gate; helper supplies no actor/capability.

- [ ] Write RED tests: exact8 structure and semantic review; lexical pass without manual review inconclusive; nine rows/bare init/contact misrole/incorrect stop/unknown omissions failed; max_tokens inconclusive; native unknown/receipt absence cannot be overall passed; changed artifact/acceptanceVersion rejected by existing ledger.
- [ ] Implement bounded deterministic structural prerequisites plus explicit semantic verdict; preserve execution evidence separately. No new persisted state or automatic retry.
- [ ] Run focused tests and whole control suite; compose existing submitTask/acceptTask in fresh ledger and show native result is unchanged after failed/inconclusive content.
- [ ] Record evidence and independently review the thin API.

### Task3: P0-C operation/exit/cleanup explanations

**Files:** Create `src/operation-explanation.mjs`, `test/operation-explanation.test.mjs`; modify `src/owner-app.mjs`, `test/owner-app.native.mjs`, `docs/owner-entry.md` for deterministic safe projection.

**Interfaces:** `explainOperation(operation, observations={})` returns separate `operation`, `cliExit`, `cleanup` conclusions. Owner calls it without future exit facts; the parent can supply actual exit/IO observations. Model answers never affect state.

- [ ] Write RED tests for valid receipt+exit1+UNCONFIRMED; unknown with success-sounding answer; closing ACK only; SIGKILL no-finally; normal observable exit vs full OS census limitation.
- [ ] Implement pure field-based conclusions, then add them to safeOperation/status. Do not change existing commands or authority.
- [ ] Run control/native tests, actual fresh CLI normal/failure/recovery bounded cases and read-only original-ID receipt checks. Only terminate recorded test children.
- [ ] Record independent source/runtime review with final hashes.

### Task4: P0-D locked docs and fullhost types

**Files:** Expected `scripts/gen-doc-graphs.ts`, `docs/config-catalog.md`, `docs/config-catalog.zh.md` and pair metadata; native-run.spec.ts and dispatch-control.spec.ts three old Options fixtures; exact host source alias/paths file confirmed by read-only diagnosis before editing.

**Interfaces:** Generated docs reflect current source; fullhost compilation resolves one coherent source plane. No package version, dependency graph, production/security config change.

- [ ] Compare each existing failure with exact base and current source; retain old RED logs and diagnose alias identity paths.
- [ ] Add service role, generate paired catalogs with existing official scripts, update old fixtures to current retryPolicy, repair the smallest source alias defect.
- [ ] Run changed-source types/tests, then actual locked `doc-sync`; record every failing gate explicitly. Do not substitute quick checks for full docs.
- [ ] Independently review the classification and patches; preserve SIGKILL external observable facts and unresolved limits.

### Task5: P1 plan plus review delivery

**Files:** Extend current spec/plan only for P1; round2 evidence, source manifests/patches and existing Library ZIP.

**Interfaces:** Future small workset uses existing goalDigest/evidence/eventCursor/sourceSeq/generation/freshness, built at dispatch/resume and checked at actual surface. No loop/vector/ledger or preset-freezing work this round.

**Collaboration topology follow-up:** Record vertical task delegation/return, horizontal consultation and communication among authorized units. Communication grants no execution capability or cross-scope data access. Reuse task revisions, message ledger and acceptance; no new scheduler. Await parent-provided independent task/message/Team seam design for later incorporation, without extending the current P0-B/C delivery.

- [ ] Update support wording: dynamic model/public entry/full collaboration unaccepted rather than universally absent; keep exact owner preview limitations.
- [ ] Verify preservation hashes and all owned test child receipts, fix important review findings by TDD, freeze exact source/build identities.
- [ ] Apply small patches to exact base and full overlay to temporary official context, check all resulting bytes, package only selected approved source/test/docs/evidence.
- [ ] Replace the same Library identity, record actual confirmed result and SHA. Report no paid calls, P0 progress, full docs status, readiness and remaining blockers.
