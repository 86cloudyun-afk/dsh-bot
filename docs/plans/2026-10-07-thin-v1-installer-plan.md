# Thin v1 installer implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this authorized plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Install a coherent private v1 runtime and fresh GUI profile from caller-pinned thin files, fetching the official public SDK through an isolated npm operation.

**Architecture:** One new orchestrator validates the descriptor and selected file inventory, creates exclusive verified materials, runs a fresh bounded npm install, then calls the existing reviewed consumer and GUI helper. The packed product is verified and unpacked without Git; all output is confined to one freshly owned root.

**Tech stack:** Node 24, built-in filesystem/crypto/child-process APIs, existing consumer/exporter/package decoder/GUI helper.

**Spec:** [Thin installer design](2026-10-07-thin-v1-installer-design.md).

## Global constraints

- Only new installer/tests/plan/first-install documentation; frozen consumer and GUI helpers are unchanged.
- Exactly Node `24.19.0`, admitted before artifact bytes/output/npm; supported targets `linux-x64`, `darwin-arm64`; official CLI `0.2.0-rc.2`; core 74; external 28.
- Caller-provided descriptor SHA-256; canonical/O_NOFOLLOW reads; every provided needed selected file binds hash, bytes and mode.
- No complete official SDK bytes in the thin artifact, no lifecycle/native/model/CLI startup during installation.
- Fresh empty npm cache/config/Home; strict TLS and fixed HTTPS registry; filtered child environment and bounded timeout.
- Fresh exclusive output/profile/work; every created failure is preserved without automatic recursive removal; no old Home/config/credentials.
- Private qualification only; model gate false by default and credential reference only.

## Review focus

- A selected symlink or protected file must be refused before any target bytes are read.
- An unselected target may be unavailable; selecting it must still be refused on the wrong host.
- Input mutation between validation/copy or within a descriptor read must never produce an accepted installation.
- npm user settings, inherited provider keys and lifecycle flags must not affect the fresh child operation.
- A replaced installation directory must survive every failure without new assembly writes; timeout must confirm the original owned group stopped or return bounded `SDK_INSTALL_STOP_UNKNOWN`.

### Task 1: Trusted thin input and material boundary

**Files:** Create `scripts/install-v1.mjs`, `scripts/install-v1.test.mjs`.

**Interfaces:** `installV1(options)` and `parseV1InstallArguments(values)`; descriptor fields and exact paths are defined in the design.

- [x] Write fixture tests for trusted digest, target selection, protected/traversal paths, symlink never-read, file hash/mode changes, required tool/lock/product/source/notice references and existing caller output.
- [x] Run `node --test scripts/install-v1.test.mjs`; preserve the expected RED output before implementing.
- [x] Implement safe pinned descriptor/file reads and fixed-layout validation, then copy only selected listed files into the owned materials view with a second complete comparison.
- [x] Run the input-boundary tests and verify fixed refusal categories and absent/unmodified output.

### Task 2: Fresh public SDK, real assembly and relocated GUI profile

**Files:** Continue the same new installer/test files; existing consumer/GUI modules are consumed from the pinned bundle without edits.

**Interfaces:** Existing `assembleDistributionRuntime(options)`, `verifyDistributionRuntime(options)`, `decodePackageArchive(bytes)`, `validatePackageClosure(files)`, `installBotGuiProfile(options)` with `packageSourceMode:'verified-export'`.

- [x] Write real child fixtures asserting fresh empty cache/config/Home, exact ignore-scripts/TLS flags, excluded secret/config environment, nonzero/timeout categories and owned-directory replacement preservation.
- [x] Write coherent actual-consumer/GUI integration fixtures with 74 peers and 28 exact registry snapshots; assert original source root/head/tree, exact packed product bytes/modes, private qualification and manual startup with model gate false.
- [x] Observe these tests fail before their implementation, then implement the bounded npm group, product extraction and the existing APIs in that order.
- [x] Run the complete installer suite and unchanged package/GUI suites appropriate to the new integration.

### Task 3: First installation contract and handoff

**Files:** Create `docs/first-install-v1.md`; update checkboxes in this plan.

- [x] Document the exact descriptor/CLI format, Node/npm prerequisites, independently obtained pin, fresh install command, result paths and manual startup, without Git or old dependencies.
- [x] State credential references/default model gate and remaining final product/Host generation, fresh OS, native enforcement and release qualification gates.
- [x] Run fresh tests and `git diff --check`; commit only the new owned files and send the exact commit/hash/test evidence for independent review.

## Verification handoff

Fresh installer tests pass 34/34 without a worktree `node_modules`; unchanged exporter tests pass 65/65; unchanged dependency-independent GUI startup/bootstrap/package snapshot tests pass 15/15. Evidence is under `/workspace/dsh-v1-evidence/distribution-consumer/thin-*.log`, including all RED runs for input, continuation, exact Node admission, SDK resolution, CA/output-mode and late descriptor/npm-entry mode boundaries.

The attempted full project suite reports 371/413 passing, with 42 failures caused by absent stock SDK imports and their dependent guard/producer assertions. The GUI profile suite likewise cannot load `@deepseek-ai/cordis-plugin-include` in this SDK-absent worktree. These failures remain recorded; the actual new installer fixture exercises the unchanged GUI helper after synthetic fresh SDK installation. No existing source, test runner, dependency manifest or frozen consumer code was changed. Full integrated-source/real-SDK validation belongs to the later parent-owned integration gate, together with final coherent product/Host pins and a real thin first install.

### Prior authorized review repair: bounded process-group stop confirmation

Independent exact `ce43756` review rejected I1: EPERM on both group and child termination left the timeout pending until the external owned harness stopped the child. The original report and exact source remain frozen. This repair retains the trusted files/npm/SDK boundaries.

- [x] Independently replay the review's one-child guarded EPERM reproduction and preserve it in `thin-timeout-repair/independent-original-repro-qualified.log`.
- [x] Record meaningful RED regressions for denied stop, leader-exit/group-presence, changed PID and replaced output; exact denied termination remains pending past the test bound until emergency teardown.
- [x] Implement immutable PID/group, owned output checks, TERM/KILL requests, a final 750ms confirmation deadline and `SDK_INSTALL_STOP_UNKNOWN` preservation; require group absence as well as leader exit.
- [x] Verify real guarded child API and actual CLI exit, changed/unavailable PID and output replacement without foreign destructive signals; external harness owns final teardown.
- [x] Run fresh complete installer tests (40/40) and unchanged GUI/package tests (15/15), then commit exact source for parent-owned fresh independent review.

Group remainder is simulated at the OS query boundary after a real leader exits; it is not claimed as an actual descendant-process reproduction. API harness teardown confirms each actual group is absent. The Linux CLI teardown separately checks captured process-start identity and confirms the exact orphaned child is stopped (including zombie state, which is not group-absence evidence); it makes no claim of native sandbox enforcement. New repair evidence is separate from all original reports and logs. No real SDK, native, model or network operations are performed.

### Authorized review repair: preserve every failed installation

Independent exact `53da328` review closed the prior stop-deadline issue but reproduced a new ownership race: replacement during an awaited realpath permitted signalling under the old path-based rule, and the failure cleanup actually deleted caller replacement bytes. The original report and RED fixtures remain unchanged. The parent explicitly changed the contract to preserve every created failure and separate original live-child stop authority from directory-name ownership. Adding more asynchronous checks around recursive removal cannot make that removal atomic.

- [x] Independently replay both original await-race RED cases, including actual caller deletion, in the separate `thin-preserve-repair/independent-original-i2-red.log`.
- [x] Record focused RED regressions for unchanged failed-root preservation, material writes into a replacement, exact caller bytes/modes/inodes preservation and late unreviewed helper import, including replacement after a completed ownership check.
- [x] Remove every recursive removal from the installer. Return fixed `PRESERVED_AFTER_FAILURE` evidence with the original identity on all post-creation errors, without further filesystem operations in the failure handler.
- [x] Recheck directory inode/device/private mode after realpath, before material writes, helper imports, delegated assembly/profile writes and acceptance. Stop only the immutable original still-live child/group, independently of output replacement.
- [x] Prove Node 24.19 captured-source hooks with real relative and builtin imports. Execute delegated tools from captured descriptor-pinned bytes through a private virtual module map, reject undeclared imports, record the derived mapping and deregister the hook on every exit. Do not treat asynchronous pre/post-import checks as executable-source safety.
- [x] Run fresh complete installer and unchanged GUI/package tests, preserving actual guarded child teardown receipts, then commit only the five owned files for a fresh exact independent review.

The old 53da328 output-ownership signal rule and removal assertions describe that frozen revision, not this revised contract. The external fixture harness alone removes its test directories after child-stop confirmation. Failed real installations and intermediate materials remain for explicit external inspection/cleanup. Separate focused RED tests reproduced unreviewed imports before a missing ownership check and after a completed ownership check; both replacement fixtures' markers must stay absent after the captured-source repair. Fresh qualification of the parent's newer preserving consumer and final coherent product/Host bundle pins remain separate gates.

The fresh preserving-installer suite passes 46/46 in `thin-preserve-repair/fresh-full-installer.log`. It includes actual guarded child teardown receipts with network/model/native/extra-child counters all zero, group absence for API fixtures and captured start-identity/stopped-state confirmation for the CLI orphan fixture. The initial unchanged-suite invocation lacked its required package fixture and failed 8 cases; that log is retained. After preparing the current source through a fresh offline, ignore-scripts npm pack with an exclusive cache/config view, the original safety-guarded GUI startup/bootstrap/package suite passes 15/15 in `fresh-unchanged-gui-package-qualified.log`. No real SDK download, native execution, model call or final runtime assembly occurred. The synthetic consumer integration still deliberately uses the frozen ede605ce fixture bytes; final bundle assembly must select the parent's separately reviewed preserving consumer and GUI/package helper pins.
