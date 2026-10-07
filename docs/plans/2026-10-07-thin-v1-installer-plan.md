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
- Fresh exclusive output/profile/work; cleanup only retained owned inode/device; no old Home/config/credentials.
- Private qualification only; model gate false by default and credential reference only.

## Review focus

- A selected symlink or protected file must be refused before any target bytes are read.
- An unselected target may be unavailable; selecting it must still be refused on the wrong host.
- Input mutation between validation/copy or within a descriptor read must never produce an accepted installation.
- npm user settings, inherited provider keys and lifecycle flags must not affect the fresh child operation.
- A replaced installation directory must survive failure cleanup; timeout must terminate the owned child group.

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
