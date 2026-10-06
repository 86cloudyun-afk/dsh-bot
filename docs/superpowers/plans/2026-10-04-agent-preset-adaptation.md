# AgentPreset Offline Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with the existing sole cloud writer. Independent review before implementation and after the final diff; no implementer agents.

**Goal:** Persist opaque AgentPreset choice and expose healthy dynamic metadata without opening native execution.

**Architecture:** A narrow mode module validates metadata and prepares blocked native requests. Adapter explicitly refreshes a trusted host roster; synchronous Host commands use its in-memory snapshot without awaiting in ledger transactions. UI saves control records only.

**Tech Stack:** Existing Node 24.19.0, ES modules, node:sqlite, guarded test runner; no dependencies.

**Spec:** `docs/session-mode.md`.

## Global Constraints

- Sole writer: `历史隔离位置〔dsh-bot-development〕`, branch `cloud/control-alpha-fixes`; backup read-only.
- No core edits, true model calls, listener starts, credentials, permission changes, push/merge.
- Safety slice and patch remain independent and unchanged.
- Preserve schema 1, legacy sessionModes, frozen snapshots and operation identity.
- Opaque ID <=200 characters is nonblank and preserved exactly; display name is not identity.
- Missing/broken IDs reject; unavailable catalog clears options; no runtime YAML hash claim.

## Review Focus

- Failed/older refresh cannot leave stale selectable rows.
- Custom name “创造” preserves its own ID.
- Model/autonomy-only update preserves selection.
- Legacy config, receipts and snapshots remain intact.
- Prepared native request never invokes native mutations or claims acceptance.

### Task 1: Healthy metadata and blocked preflight

**Files:** create `src/session-mode.mjs`, `test/session-mode.test.mjs`; modify `src/adapter.mjs`.

**Interfaces:** `presetId(value)` exact ID; `normalizePresetCatalog(rows,defaultId)` immutable catalog; `prepareSessionCreate({cwd,agentPreset},catalog)` blocked explicit request; `readSessionAgentPreset(summary)` string|null; `prepareBlankPresetSelection(summary,id,catalog)` blocked select request. Adapter `refreshSessionModeCatalog()` async and `sessionModeCatalog()` sync publish metadata.

Helper summary is explicitly `AgentPresetSessionView {id,blank,projectionValues}`, a client/offline DTO; raw SessionController wire {sessionId,projections} is rejected unless a future trusted seam translates it. Persisted BotConfigVersion.agentPreset is optional for legacy rows; newly normalized writes always carry it.

- [x] RED tests: custom ID/name, broken/default, invalid roster, failed/competing refresh, projection and blank lock, zero native mutation. Run `node scripts/test.mjs test/session-mode.test.mjs`; inspect missing-feature failures.
- [x] Implement exact interfaces, immutable sanitized options, latest refresh publication. Preflight always has `mode_revision_unavailable` and no executable permit.
- [x] Same guarded command GREEN.

### Task 2: Compatible config and trusted read surface

**Files:** modify `src/host.mjs`, `src/contracts.d.ts`, `src/server.mjs`, `test/session-mode.test.mjs`.

**Interfaces:** config `agentPreset:string|null`; omitted update inherits old selection. `Host.refreshSessionModeCatalog(actor)` authorized read outside transactions; authenticated `/api/agent-presets` GET. Snapshot carries catalog independently of native capabilities.

- [x] RED: custom selection, unavailable/unknown rejection, model update preservation, explicit null, legacy reopening, unchanged snapshots/receipts, unauthorized read before host call.
- [x] Implement normalization only for new configs. Explicit nonnull choices require cached healthy row; omitted existing choice is preserved without claiming live binding.
- [x] Guarded mode/adapter/autonomy tests GREEN; startAttempt still disabled and schema remains 1.

### Task 3: Dynamic UI and evidence

**Files:** create `ui/session-mode.mjs`; modify `ui/app.mjs`, static asset list in server, `test/ui.test.mjs`, README, evidence/matrix documents.

**Interfaces:** render actual id/name options; unavailable picker disabled. Updates have preserve and explicit null/default choices; metadata refresh precedes snapshot. No native commands.

- [x] RED via existing synthetic DOM pattern: custom option, disabled catalog, exact ID payload, preserve update.
- [x] Implement helper and wire create/update forms, serve helper asset without starting server.
- [x] Complete `node scripts/test.mjs`, `node scripts/check.mjs`, `git diff --check`; exact counts and fingerprints.
- [x] Independent final read-only review; material fixes RED/GREEN with affected tests and full guard.
- [x] Accurate local commit/tree if committed, no push/merge. Offline PASS and native blockers separate.

## Execution ruling

Parent explicitly authorized design/compatibility/matrix, independent review, then offline TDD under the existing sole-writer handoff. Continue without another approval loop; implementation begins after independent plan review. Artifacts: `历史隔离位置〔dsh-bot-mode-stage0〕`; baseline guard 67/67. No native mutation implementation belongs to this plan.
