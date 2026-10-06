# Existing-capability Owner closure plan

Spec: `docs/superpowers/specs/2026-10-05-owner-closure-design.md`.
Execute inline under the user's current authorization. Retain patches and evidence, no commit/push. Independent reviewer writes only a new review directory.

## Task 1: Trace and RED

Files: new `test/owner-closure.test.mjs`; extend `test/owner-app.native.mjs`.
Verify exact private caller can plan/advance/submit/accept without root, host provenance stays honest, and stale grant/task/digest/version guards still reject. Actual Owner plugin stdin must expose only its bound task. Synthetic pending transport must preserve UNKNOWN and usage/reservation across content verification and cold resume. Observe RED before production changes through declared sanitized launchers.

## Task 2: Existing grant and stdin routing

Files: `src/progression.mjs`, `src/collaboration.mjs`, `src/owner-input.mjs`, `src/owner-app.mjs`, `src/owner-startup.mjs`, `docs/owner-entry.md`.
Use `e.authorizationRef` already checked by Host, persist plan reference/epoch and reject reference swaps; legacy missing reference means root. Observe unknown native operations through existing binding target/task IDs. Add strict bounded grammar and current-task-only routing; preserve existing operation ID receipts and reject changed expectedRevision for repeated owner command IDs. No serialized source or identity may grant access.

## Task 3: Scoped proof and review

Run new control fixtures and changed Owner native fixture under sanitized launchers. Run the existing product control suite because shared Host extensions changed; existing unrelated native/P0D/CLI/preflight stages are not rerun. Freeze source/patch/runtime identity and obtain a fresh isolated independent review. Fix material findings RED first. Check old file/runtime hashes and v7 ZIP unchanged; supplement v7 exact source identities and three current docs gate names/counts. New evidence is current; old 40/43 remains historical.

## Review Focus

- A repeated command ID with altered expectedRevision must reject, even if payload is unchanged.
- Private progress cannot borrow another grant with the same epoch; old root-bound plans retain their boundary.
- Revoked/stale grants, stopped or revised tasks, stale acceptanceVersion/digest reject transactionally.
- Content passed must not turn native UNKNOWN into settled or release reservation; resume must not replay it.
- Foreign task/plan or JSON actor/caller/peer fields must fail before effects; frame sizes stay bounded.
