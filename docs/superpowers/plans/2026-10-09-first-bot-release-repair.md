# First Bot Release Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an installable patch with reliable first-Bot creation, clear version diagnostics and safe recovery of retained operations, then submit and merge a reviewed PR.

**Architecture:** Keep the native plugin and existing persistent schema. Check the running client/server release before writes; query original operation receipts without executing commands. Fix independently reproduced configuration defects without weakening validation or permissions.

**Tech Stack:** Node.js ESM, official DSH 0.2.0-rc.2 public APIs, React, node:test, Playwright Chromium.

**Spec:** ../specs/2026-10-08-native-dsh-plugin-v1-design.md; user-authorized goal execution and bugfix PR merge.

## Global Constraints

- Official original DSH only; no Host modification or standalone software.
- Linux/macOS; Node `^22.19.0 || >=24`; official `@deepseek-ai/dsh@0.2.0-rc.2` compatibility baseline.
- Preserve Bot IDs, independent memories, owned sessions, task history and retained original operation IDs.
- Default available native tools, native approvals, five primary workbench sections and three visible Bot fields.
- Unknown execution remains unknown; read-only receipt lookup never starts model/tool work.
- Existing v1.0.0 tag and package remain immutable; patch package uses v1.0.1.

## Investigation Evidence

- Baseline 151/151 unit tests passed.
- Formal v1.0.0 package SHA256 `1a8cab4c29db54ace76160d1e6e1ac9dfc7a4e291f77b65f974bab30fbaa1724` passed 14 focused stock GUI checks including first creation and direct conversation.
- Current editor's exact input against the previous native directory reproduces `invalid_input: invalid_input` because that directory rejects `executionMode`; current directory accepts it.
- User host operation record is not available in this workspace. Mixed client/server is a reproduced failure mode, not a confirmed diagnosis of the user's installation.

## Review Focus

- A cached/new client connects to an earlier native service: show actionable release mismatch before writing.
- A validation rejection remains in browser storage: preserve the original ID and distinguish rejection from an uncertain connection outcome.
- An original command already committed: receipt lookup returns that result without executing again; absent receipt stays unconfirmed.
- Existing explicit preset changes back to DSH default: persist the resolved default and fence subsequent work with a configuration revision.
- Editing a Bot/model while the catalog changes: preserve a user's draft and keep configuration validation strict.

### Task 1: Release and original-operation recovery

**Files:** Modify `src/native/service.mjs`, `src/native/api.mjs`, `src/client/client.js`, `package.json`; create `test/native-plugin/client-command-recovery.test.mjs`, `test/native-plugin/operation-lookup.test.mjs`.

**Interfaces:** Snapshot returns `pluginVersion` and `clientProtocol`; `operation.lookup` takes `{operationId}` and returns a read-only committed receipt or `unrecorded`. It is operator-only. Client preserves original request bytes and ID across lookup and explicit continuation.

- [x] Add RED tests for missing/mismatched release, exact receipt lookup, absent receipt and unauthorized caller.
- [x] Run those tests and confirm behavioral failures.
- [x] Publish server release metadata, enforce client preflight and add read-only lookup and truthful pending states.
- [x] Run targeted tests; verify mismatched release sends zero write calls and lookup sends zero model requests.

### Task 2: Proven write-configuration defects

**Files:** Modify `src/native/bots.mjs`, `src/client/client.js` only where a reproducer requires it; extend `test/native-plugin/bot-editor-models.test.mjs` and add native preset regression tests.

**Interfaces:** Existing Bot create/update contracts remain strict. Explicit default selection resolves the current native preset; absent update field preserves the current selection. Invalid config returns a useful field diagnostic before a write.

- [x] Reproduce reviewer findings against public official services; write and run RED tests for each confirmed defect.
- [x] Fix minimal root causes and run GREEN targeted tests.
- [x] Review all workbench write forms against the corresponding contracts; fix confirmed important defects and record hypotheses as unconfirmed.

### Task 3: Frozen patch, fresh install, upgrade and review

**Files:** Modify `README.md`, `.github/README.md`, `docs/install.zh-CN.md`, `docs/guide.zh-CN.md`, lockfiles as required, `dist/SHA256SUMS`; create `dist/dsh-bot-1.0.1.tgz`, release report and focused stock GUI regression checks.

- [x] Document exact patch installation, host restart/browser refresh and retained-ID lookup.
- [x] Run `npm test`, `npm run check`, freeze package and run `node scripts/verify-distribution.mjs`.
- [x] Test frozen package in a fresh stock GUI, and upgrade an existing profile with retained state; include first Bot and original operation recovery.
- [x] Obtain independent whole-change review and fix Critical/Important findings.
- [ ] Commit, push, create and attach PR; require fresh Linux/macOS CI success before user-authorized merge.
- [ ] Publish immutable v1.0.1 release and verify anonymous download hash; report exact evidence and remaining user-host limitations.

## Final local evidence

- Unit suite: 177/177, syntax/entry closure and diff whitespace checks passed.
- Frozen artifact: SHA256 `2e67eeb77bb5913c2192101c6e9a37d7e6fff301fdc6b22262c6544af0d94518`; all 25 allowlisted source files match and MIT is present.
- Stock Linux x64 GUI: 64/64; upgrade in a fresh host process: 4/4. Full GUI uses a controlled provider; recovery and upgrade checks issue zero model requests.
- Independent write-flow review identified stale task/acceptance/group/sharing/meeting drafts and preset/model configuration defects; each has a regression test.
- Independent whole-change review found no Critical issues and three Important issues: a full pending queue, unavailable unsaved model selections and a disappearing native preset. All three were reproduced RED, fixed and verified GREEN, including installed GUI checks. No additional re-review loop was required after this fix pass.
- Authorization CAS fields remain optional for existing direct callers; the workbench always supplies its original draft version. A full new host process is required for an upgrade because same-process shutdown retains the native module cache.
