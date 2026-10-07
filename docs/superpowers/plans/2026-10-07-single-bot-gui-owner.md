# Single-Bot GUI owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user authorized autonomous inline execution and root arranges the final fresh review.

**Goal:** Install and run an authenticated single-Bot Loader GUI in a fresh Home.

**Architecture:** A supported Web profile supplies stock BrowserAuth and browser modules. A private owner app keeps the exact Cordis fiber/Host binding and installs selected controls and producer after one durable Bot/main Session binding.

**Tech Stack:** Node 24, stock DSH rc.2 services, Cordis Loader, SQLite product Ledger, React Loader client, Chromium.

**Spec:** `docs/superpowers/specs/2026-10-07-single-bot-gui-owner-design.md`

## Global Constraints

- Single Bot; work defaults to zero tools; main receives only `dsh_bot_delegate`.
- Only actual `HostConnectionService.operator` is admitted to owner controls.
- Model requests require `--enable-model-requests`; zero-model evidence uses no provider.
- UNKNOWN original operations are never resent; replies and accepted stops never release held slots.
- No edits to old native CI/budgets, cold native runner, old assembler, Host source refs, public publication, or production Home.

## Review Focus

- A lost create response reconciles the original operation without making another Bot/Session.
- Restart preserves ledger, Bot, main identity and does not activate historical work.
- A disposed/replaced operator or changed Bot config invalidates all owner actions.
- The real browser has no auth cookie until stock token exchange succeeds.
- Empty presets and disabled stock UI surfaces prevent accidental model tool exposure.

### Task 1: Installable profile

**Files:** Create `scripts/install-bot-gui-profile.mjs`, `test/bot-gui-profile.test.mjs`; modify package exports.
**Interfaces:** `installBotGuiProfile({directory, productRoot, runtimeRoot, cwd, packageSnapshot})` returns profile/Home/cwd/launcher and package identity. Accept packed-copy installation only by default.

- [x] Write tests asserting a fresh package-installed profile, empty preset, disabled stock model presets, stock BrowserAuth transport, and refusing reused/nested paths.
- [x] Run `npm test -- test/bot-gui-profile.test.mjs` and observe missing installer failure.
- [x] Implement fresh installation with stock bundles and a bounded profile overlay; export the private app.
- [x] Run profile tests, then commit.

### Task 2: Private authenticated owner app

**Files:** Create `src/bot-gui-owner-app.mjs`, `src/bot-gui-owner-app.d.ts`, `test/bot-gui-owner.stock.mjs`; preserve existing owner/producer guards.
**Interfaces:** Loader `apply(ctx, config)`; private `installBotGuiOwner({ownerCtx,homeDirectory,cwd,modelRequestsEnabled})` for real stock fixture integration returns a private test-observable disposer and safe bootstrap view, never a service.

- [x] Write stock tests for actual-operator admission, durable one-Bot creation/replay, zero-model blocking, restart identity, and stale peer/config rejection.
- [x] Run guarded stock tests and observe missing private installer failure.
- [x] Implement original-operation persistence, exact private fiber, bounded creation and same-ID recovery; install separate read/selected-control/producer bindings.
- [x] Run stock tests, then commit. These checks establish read restart, not protected history continuation.

### Task 3: Browser bootstrap and actual Loader evidence

**Files:** Modify `src/client/client.js`; create `test/bot-gui-bootstrap.test.mjs` and private evidence runner under the evidence directory.
**Interfaces:** `/dsh-bot-gui` supports bootstrap/create/reconcile with exact bounded payloads and safe version-1 replies. Existing selected actions retain their DTOs.

- [x] Write client tests for empty authenticated create form and lost original create response reconciliation.
- [x] Observe RED; implement the create/bootstrap UI with immutable local storage operation identity and Web Locks.
- [x] Run client and full existing tests; launch packed profile with empty private Home and fresh Chromium.
- [ ] Verify BrowserAuth 401/403 fence, token redirect and signed-cookie persistence, Loader roster, create/select, main receipt, result view and truthful held UNKNOWN stop evidence.
- [ ] Record limitations and request root's fresh review; commit final sources and exact evidence references.

The archived `d7e6f55` fresh relocated-export browser proof covers actual Loader/auth/create/reconcile and same-identity read restart with zero model requests. It contains no model result or native terminal settlement claim. Earlier failed creation Home remains UNKNOWN with its original IDs and is not retried.

### Task 4: Protected creation and complete known-history continuation

**Files:** Private GUI generation policy/preparation and owner composition; installer mounts actual provider directory. Shared adapter/main/work bridge stays owned by `work_generation_product`; Host SDK and frozen assembly stay owned by root's assigned agents.

- [x] Import actual-handle generation adapter and exact main delegate hook, including async preparation checkpoint.
- [x] Require an actual private source and synchronous private model gate before contact allocation; enable flag alone cannot wake a bare Agent.
- [x] Test and implement separate original-authority and dispatch callbacks, preserving fenced original receipt verification without admitting old/new dispatch.
- [x] Mount the actual protected provider directory in the profile; registration does not enable models.
- [x] Wire native journal preparation before actual create/resume, verify exact journal/prepared brands, and retain SDK sources privately after exact delegate binding. The actual M1 positive path still requires the new frozen test graph below.
- [x] Implement same-original Session resume through sealed-history SDK preparation; preserve failures and UNKNOWN without Controller/bare Agent activation or replacement identity. Unsupported/unsealed refusal is verified; successful native history continuation remains pending the M1 fixture.
- [ ] Run actual new SDK/components with explicitly synthetic external transport for execution/receipt/stop/restore checks.
- [ ] Pack exact reviewed final bytes and validate actual Loader/BrowserAuth in another fresh Home on the final frozen runtime; archive clean-URL screenshots and pins.
- [ ] Obtain root-arranged independent fresh review and deliver exact validation/limitations. Root owns any bounded real-provider acceptance.

### Task 5: Final native parent/child and archive controls

Root selected the final fresh profile policy: the main has one exact `dsh_bot_delegate`; newly prepared depth-zero parent work has one delegate definition scoped to the original task/generation; actual parent ToolCall-derived depth-one children have zero tools permanently. Parent, child and UNKNOWN generations share the same Bot limit of fifteen. Existing ordinary zero-tool work cannot be upgraded. The private product bridge and complete M2 tool policy must provide this authority before the GUI enables the final policy.

- [ ] Consume the product's exact parent preparation/tool binding and private original control-tree interfaces; verify fixed policy before native effects.
- [ ] Add Chinese original-operation work continuation and Bot archive/restore controls, preserving pending/UNKNOWN and exact historical selectors.
- [ ] Mint M2 original controls before durable dispatch/task epoch fences, stop the original tree, and archive only with the real native workspace/gate proof.
- [ ] Restore the same native Session IDs only through complete known-history selectors and a fresh genuine resumed source; never reopen UNKNOWN or reuse old dispatch authority.
