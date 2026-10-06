# Owner Management Implementation Plan

> **For agentic workers:** Execute inline with the existing sole fresh writer; use superpowers:executing-plans and TDD task-by-task. Root performs preflight and an existing independent tester/reviewer checks the frozen result. No worker spawns another worker.

**Goal:** Give the retained private owner one controlSessionId that can select, create, query and dispose a dynamically growing Bot membership while retaining exact immutable creation references.

**Architecture:** Add a narrow frozen port on the existing Host and a lifetime-bound projection on OwnedNativeController. Host owner commands store control records through the existing Host/ledger transaction machinery; ports call executeOwned and never write Ledger directly. A private synchronous dispatch context binds exact caller/envelope/payload/lease and rejects direct legacy execute/executeOwned management bypass. All command payloads bind the control ID and exact targets through the existing canonicalVersion 1 digest/idempotency machinery.

**Tech Stack:** Node 24.19.0, ESM, node:test, node:sqlite memory fixtures; existing offline stock Cordis for installed consumer tests; existing strict NodeNext declaration checks.

**Spec:** `历史隔离位置〔approved-scope.md〕`; prior proposal `two-bot-lifecycle/design-proposal.md`; root's 2026-10-06 mode-semantics ruling.

## Global Constraints

- Sole product root: `历史隔离位置〔candidate〕`; dirty main and all prior frozen objects remain untouched. No duplicate checkout, commit, push, deployment or new dependency.
- Evidence and progress belong only in `历史隔离位置〔writer〕`; the plan is the one requested candidate planning document.
- No model/API/network execution, credentials, real profiles/data, runtime/native open, SupportedSyntheticAdapter, archive/restore or async/result/stop feature.
- Native/custom means existing healthy opaque AgentPreset references. Do not add executionMode, creationMode.kind, a native/custom enum, preset fingerprint or inferred runtime type. A null agentPreset retains the verified default-at-future-session-create semantics.
- contact/execution provider/model/reasoning and agentPreset remain in existing immutable config versions. Plan/permission sessionModes remain independent and unsupported for non-null values.
- Management has no config update interface. A legacy explicit update may create a new config version; an old captured membership reference then fails stale until explicit reselect. Never silently replace the selected snapshot.
- Memory-only N=2/10/50 samples are bounded verification, not product caps. Preserve <=500 distinct IDs per Bot/task read request; total membership has no fixed small cap.
- Run only bounded new sanitized harnesses with literal allowlisted env and empty HOME. The default `npm test` runs `test/*.test.mjs`, including historical native/platform/profile tests, so it is inspected but expressly not run.
- Actual package must be offline packed with ignore-scripts, consumed from the reused real consumer, and preserve all six approved stock dependency links.

## Review Focus

- Correct owner capability with a stale lifetime or native-owner grant epoch must fail before operation replay.
- Extra envelope metadata is not bound by Ledger.operation: every control/target identity must occur in the digest-bound payload or existing expectedEpochs.
- A config change made through an old explicit API must not silently replace a selected membership snapshot.
- A replay after control revision advancement must reuse the original receipt, without a second Bot or membership mutation; terminal disposal must reject subsequent calls.
- A large membership must remain queryable in bounded exact batches; unknown/nonmember/cross-Host IDs refuse the entire request.

## File ownership and exact interfaces

Writer owns modifications to `src/host.mjs`, `src/contracts.d.ts`, `src/host.d.ts`, `src/native-controller.mjs`, `src/native-controller.d.ts`; creates `test/owner-management.test.mjs`, `test/owner-management-types.mts`, `docs/owner-management.md`, and this plan. No package.json/export route changes: the new method/types use existing `dsh-bot/host`; existing plugin, browser, operator binding, adapter, Ledger and SDK/core files stay byte-identical. Writer-only new execution/package/type/evidence harnesses live under the writer evidence directory. Independent owns only its separate evidence directory.

Exact exported declaration additions (existing public declarations remain compatible):

```ts
export interface OwnedControlSessionOpenPayload { readonly controlSessionId:string }
export interface OwnedControlSessionOptions {
 readonly envelope:CommandEnvelope; readonly payload:OwnedControlSessionOpenPayload;
 readonly isCurrent?:()=>boolean;
}
export interface OwnedControlSessionTarget { readonly controlSessionId:string }
export interface OwnedControlSessionSelect extends OwnedControlSessionTarget {
 readonly botId:string; readonly expectedBotRevision:number;
}
export interface OwnedControlSessionCreate extends OwnedControlSessionTarget {
 readonly name:string; readonly config:{readonly contact:ModelRoute; readonly execution?:ModelRoute;
  readonly agentPreset?:string|null; readonly sessionModes?:{readonly plan:null;readonly permissions:null};
  readonly autonomy?:AutonomyPolicy};
}
export interface OwnedControlSessionQuery extends OwnedControlSessionTarget, BotTaskReadSelection {}
export interface OwnedControlSessionState {
 readonly controlSessionId:string; readonly state:'open'|'disposed'; readonly revision:number;
 readonly epoch:number; readonly authorityEpoch:number; readonly memberCount:number;
 readonly selectedBotId:string|null;
}
export interface OwnedControlSessionBot extends BotReadDto {
 readonly configVersion:string; readonly config:Readonly<{contact:ModelRoute;execution:ModelRoute;agentPreset:string|null}>;
}
export interface OwnedControlSessionSummary extends OwnedControlSessionState {
 readonly bot:readonly OwnedControlSessionBot[]; readonly task:readonly TaskReadDto[];
}
export interface OwnedControlSessionChange extends OwnedControlSessionState { readonly bot:OwnedControlSessionBot }
declare const retainedOwnerControlSession:unique symbol;
export interface OwnedControlSession {
 readonly [retainedOwnerControlSession]:true; readonly controlSessionId:string;
 readonly selectExistingBot:(e:CommandEnvelope,p:OwnedControlSessionSelect)=>Receipt<OwnedControlSessionChange>;
 readonly createBot:(e:CommandEnvelope,p:OwnedControlSessionCreate)=>Receipt<OwnedControlSessionChange>;
 readonly query:(e:CommandEnvelope,p:OwnedControlSessionQuery)=>Receipt<OwnedControlSessionSummary>;
 readonly dispose:(e:CommandEnvelope,p:OwnedControlSessionTarget)=>Receipt<OwnedControlSessionState>;
}
// on Host, exported by dsh-bot/host:
openOwnedControlSession(caller:object,options:OwnedControlSessionOptions):OwnedControlSession;
// on private OwnedNativeController:
controlPort(caller:object,options:OwnedControlSessionOptions):OwnedControlSession;
```

Trusted launcher supplies a UUID controlSessionId (ordinary identity, not a new credential). Open's envelope command is `openControlSession`, expectedRevision null, expectedEpochs.nativeOwner equal to the current native-owner grant epoch, authorizationRef native-owner and ledgerInstanceId required to equal this Host. Duplicate identical open reuses its durable receipt and returns another port for the same open control identity; conflicting ID/nonce bindings fail.

Port methods accept only their exact command: `selectExistingBot`, `createBot`, `queryControlSession`, `disposeControlSession`. Their envelope requires this ledgerInstanceId, authorizationRef native-owner, expectedRevision equal to the control revision for a *new* operation, expectedEpochs.control equal to the control epoch, and expectedEpochs.nativeOwner equal to the captured grant epoch. Select additionally binds expectedBotRevision in payload and expectedEpochs.bot to the exact target Bot epoch. Query checks current control revision before cached replay (a query does not increment it), so membership/reselect changes require a fresh query. Query binds each requested Bot epoch under expectedEpochs[`bot:${botId}`]. Payload keys are exact allowlists; every payload controlSessionId must equal the issued port ID. Foreign control/owner/Host identity and unknown IDs fail closed before any mutation.

Control record (new kind `control`, ID controlSessionId) contains an ordinary private per-Host-instance UUID hostInstanceId, ledgerInstanceId, ownerHumanId, captured authorityEpoch, state, epoch/revision, selectedBotId and a keyed membership map. Each membership reference stores botId, botEpoch and configVersion. No caller object or credential is persisted. Host command handlers alone use Host.save/normal existing transactional ledger storage. Create reuses the existing createBot command handler inside the same operation transaction, then captures the result; ordinary legacy createBot canonicalVersion 1 semantics remain unchanged. Selection looks up one existing Bot and adds/replaces its explicit reference without creation. DTOs copy allowlisted config route fields and effective agentPreset (missing legacy field => null), never arbitrary config/native diagnostics.

## Lifecycle, failure, replay and epoch table

| Current state / request | Required checks | Result / next state |
| --- | --- | --- |
| No control / open | Exact retained caller, current lifetime, active same-Host owner grant, current nativeOwner epoch, valid envelope and fresh ID | Open control, epoch=1/revision=1, no members; durable operation receipt |
| Open / select existing | Authority/lifetime before replay; current control epoch; exact active same-owner Bot + epoch; new operation checks control and Bot revisions | Capture immutable config reference, select Bot, revision+1; no create and no duplicate member |
| Open / create | Authority/lifetime before replay; current control epoch; new operation checks control revision and existing config validation | Existing createBot transaction adds one registered/unsupported Bot and exact member ref, selects it, revision+1 |
| Open / bounded query | Authority/lifetime before replay; exact <=500 distinct Bot/task IDs; requested Bots are members, expected Bot epochs and captured epoch/configVersion still current; tasks owned by those Bots | Allowlisted summary, current selected ID/memberCount, no control revision mutation; one short existing operation transaction |
| Open / identical duplicate | Authority/lifetime and target epoch/config fences checked before cached replay; exact canonical payload/envelope identity | Original receipt/IDs, no second create, no membership/revision change; old expectedRevision is accepted only through existing replay |
| Open / explicit reselect after config update | Fresh operation and current Bot/control revisions + epochs | Explicitly recapture new immutable configVersion; old config rows and prior receipts remain unchanged |
| Open / dispose | Authority/lifetime before replay, current control epoch and new-operation revision | State disposed; epoch+1/revision+1; no Bot/Task/config/native mutation |
| Disposed / any call or reopen | State checked before replay | control_session_disposed; no replay or new authority; caller opens a fresh control ID for a new session |
| Wrong Host/owner, forged caller, root ref, expired/revoked grant, stale epoch/lifetime | Checked before operation replay | Existing identity/unauthorized/epoch errors; zero mutation |
| Missing, foreign, nonmember target, config mismatch, revision conflict, malformed payload, digest/nonce/operation collision, expired request | Exact ID/reference checks and existing operation transaction | Fail whole request; transaction rolls back all control/Bot/operation writes |

A false, throwing or asynchronous isCurrent callback, or a grant epoch change, permanently latches that port fenced; restoring true/current grant cannot revive it. New management handlers reject legacy execute(human/root) and executeOwned calls lacking the exact private retained-port dispatch context, even with copied control IDs. A grant epoch change or invalid lifetime permanently fences a port; it cannot reacquire a new epoch. There is no automatic membership refresh, fallback preset, mode switch or native execution. Control state/operation records may remain in a reopened fixture ledger, but another Host instance (even same ledger/owner/caller) cannot adopt or replay-open the old control identity; it must open a fresh control ID. No control restore is implemented; stock missing native dependencies remain explicit blockers. No cross-restart preset-composition guarantee is introduced.

## Implementation order and meaningful TDD

### Task 1: Host management authority, lifecycle and immutable references

- [ ] Write `test/owner-management.test.mjs` before product code. Use fresh memory Ledger + exact retained object; run with cwd in an allowed empty fixture directory. Assert missing openOwnedControlSession produces the intended feature RED, preserve raw output/command/exit.
- [ ] Cover open/select A/create B/query exact routes and opaque presets; create count remains unchanged by select; B gets its own config/conversation; first/middle/last lookups for N=2/10/50 retain IDs and references; N is a sample only. Query of 501/duplicate/unknown/nonmember IDs fails as a whole while read boundary remains 500.
- [ ] Cover full canonical receipt replay and collision rejection, wrong Host/caller/owner/ref, stale grant/lifetime before cached replay, permanent latch for false/throw/async callbacks and restored grant epochs, direct legacy/owned management bypass, stale control/Bot epoch, Bot revision, disposed calls, deadline and target ownership. Dispose changes only control state. Legacy update creates another config version without modifying captured config; query fails stale until explicit reselect. Snapshot isolation asserts every contact/execution provider/model/reasoning/agentPreset field and original immutable config rows, including caller mutation of returned DTO/input objects.
- [ ] Implement only the Host port/helpers and owner commands above; preserve the legacy path through existing createBot and canonicalVersion 1 machinery. Run exactly the same bounded tests GREEN and preserve logs. Review rollback behavior and cached-replay preflight before proceeding.

### Task 2: Public declarations and real-owner projection

- [ ] Add declaration tests before declarations and the controller projection: strict positive consumption of all exported management types, negative forged branded port, wrong method arguments, invented executionMode/native/custom enum and wrong DTO types. Preserve expected compile RED, then add declarations/host exports and private controlPort that composes existing owner/fiber lifetime with options.isCurrent.
- [ ] Runtime port remains frozen and never exposes caller/Host/ledger/execute; controller's closed/closing/fiber state invalidates it. Do not call controller.open, OwnerApp.apply, NativeRunHost, Session/provider/model creation. Stock missing development-only native imports remain blocked and are reported separately, not simulated into availability.
- [ ] Run strict NodeNext/skipLibCheck:false against published declarations through the actual installed package after Task 3; no need for a new package subpath. Existing export keys remain identical.

### Task 3: Actual package/consumer, evidence and handoff

- [ ] Coordinate with independent before consumer replacement (independent already captured missing public API RED on the prior actual tgz). Build one new offline npm pack --ignore-scripts tarball under writer/pack with empty HOME, two empty npmrc files and literal env. Inspect members to exclude private/evidence payloads.
- [ ] Offline install this tarball into the existing actual consumer while preserving/reinstalling the same six explicitly approved file dependency links in the same command if npm requires it. Never symlink product to candidate. Verify links and approved package entry hashes match starting-baseline proof.
- [ ] Run the new installed public-consumer harness, resolving dsh-bot/host and other public exports from the consumer, using real official inert Cordis Context/fiber, memory fixtures, N=2/10/50, exact identity/isolation/failure/replay checks and forbidden-IO counters. Run the meaningful safe legacy control/session-mode canonical compatibility subsets only after inspection; do not run the historical default suite.
- [ ] Freeze current source inventory and hashes, exact diff against the original 128-path baseline, new-path inventory, tar/installed content hashes and six-link proof. New manifest directly derives from `3b2f39a0d6ec534b4f34f3f5eb99c0a5f5f73a0cc5d18ea09a966c3a1ce59eed`; metadata describes this owner-management stage only, with historical lineage clearly separate. Record exact literal argv/env/cwd/timeouts/exits/log hashes, TDD RED/GREEN, no paid/native execution, fixture/Context/Ledger cleanup and known stock blockers. Send frozen paths/hashes to root and independent.

**Self-review:** All approved scope requirements map to the three tasks; five review-focus cases have explicit tests. Names/signatures match across tasks. Existing candidate isolation replaces new-worktree boilerplate; approved one-writer execution replaces reapproval/delegation boilerplate; no commit steps apply. Product implementation is paused until root preflight of this plan.
