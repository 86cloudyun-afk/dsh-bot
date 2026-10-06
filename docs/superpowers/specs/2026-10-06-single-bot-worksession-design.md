# Single Bot work-session design

Status: planning only; implementation awaits root preflight. Authority: `历史隔离位置〔approved-scope.md〕`. The writer is the sole product-file editor. No agents, commits, API/model calls, network, profile/config/secret reads, SDK changes, or default suites are authorized.

## Goal and boundary

One existing Bot accepts a delegation containing `task_id`, `goal`, and `completion_condition`, returns an immediately queryable work identity, reuses that identity on repetition, and accounts for at most 15 potentially executing work sessions. Main conversation stays a separate channel; this slice establishes the reusable owner-facing contract, not actual main-message/stop/UI integration or autonomous execution. Task completion receipts are evidence to inspect, not automatic acceptance of the completion condition.

The concrete deliverable after a later implementation gate is durable identity/reuse, conservative admission, owner-scoped query, source-bound receipt collection, and generation fencing. No new Bot collection, scheduler, provider, authorization system, public write RPC, or production service is introduced.

## Inspected existing authority and interfaces

Paths below are relative to this candidate unless marked absolute.

| Path | Existing capability and restriction |
| --- | --- |
| `src/host.mjs:32-74` | Constructor captures opaque `ownerCapability`. `executeOwned(caller,e,p)` requires object identity and `native-owner`, then uses the existing command/receipt transaction. `execute(actor,...)` accepts configured human identity and explicitly says Bot execution bridge is unavailable; it is not a Bot authority conversion. |
| `src/host.mjs:76-170` | `openOwnedControlSession` retains exact Host/caller/lifetime and grant epoch, preflights before cached replay, and returns a frozen management port. This is the pattern for the proposed narrower single-Bot work port. Existing management port cannot delegate work. |
| `src/host.mjs:259-296` | `createTask` mints a UUID task; it has no caller task_id deduplication. `startAttempt` deliberately queues with null Session/generation and unsupported native blockers. `stopTask` raises fences but reports unsupported native tree stop. |
| `src/native-controller.mjs:19-42` | Actual Cordis `ctx.fiber` retained as caller; `command` delegates to Host.executeOwned; `controlPort` additionally checks live exact fiber and controller lifetime. `readPort` and `installReadSource` only expose selected read DTOs. |
| `src/native-controller.mjs:47-121,174-249` | `prepareExecutionSession` prepares one execution creation per task. `open` fixes a single `protected-text-owner` binding with `product-contact` and `product-execution`, generation 1. `createSession` uses SessionCreationDriver. `admit/drive/inspect/stop` are protected development-native operations, not an arbitrary-session factory. |
| `src/owner-app.mjs:48-137`; `src/owner-input.mjs` | OS/runtime-owner input creates one Bot, one task, one contact Session, one execution Session. The bounded stdin grammar supports status/progress/prepare/admit/run/inspect/stop and existing progression commands. No delegate-work frame, Bot tool, main-conversation callback, or autonomous owner ingress exists. |
| `src/session-creation.mjs` | Original-ID creation intent, pre/post-await owner/Bot/task/config/deadline fences, one creation attempt and same-ID reconciliation, exact empty scoped proof. `nativeSession` records currently lack generation. This driver, not an external Ledger writer, remains the owner of real creation bookkeeping. |
| `src/adapter.mjs:57-84` | `ownedCreationPort` can call actual `sessionController.create` and inspect live Session/Agent/scope/preset/tools. It proves creation only, not execution or settlement. |
| `src/ledger.mjs:26-45` | Synchronous `BEGIN IMMEDIATE` transaction, operation/nonce payload binding, durable receipt replay. No await is legal inside transaction. New durable work writes stay behind Host commands/internal trusted observation transactions. |
| `src/observations.mjs`; `src/resources.mjs` | Trusted-adapter-only observation conventions, generation/sequence checks, default-deny settlement verifier. Neither plain incoming JSON nor a caller boolean is a native proof. |

The existing read-only operator/browser source and plugin acquire no new method or credential. Exact missing authority: there is no verified Bot/main-message/plugin caller -> existing runtime-owner fiber ingress. Owner-facing contract work is authorized and independent of that future integration gap. Do not invent `actor:{kind:'human'}`, copy grant rows into credentials, or expose the retained caller.

## Actual installed official Session boundary

Inspected files, without imports or execution, live under `历史隔离位置〔@deepseek-ai〕`:

- `dsh-api-session-controller` version `0.2.0-rc.2`: `lib/types/index.d.ts`, `lib/types/types.d.ts:278-359`, `lib/index.js:686-711,850-890,994-1000`.
- `dsh-session` version `0.2.0-rc.2`: `lib/types/index.d.ts`, `lib/types/types.d.ts`.
- Client Session interface: `dsh-api-session-controller/lib/types/client/contract/session.d.ts`.

`SessionController.create({sessionId,cwd,agentPreset})` creates or idempotently adopts the explicit ID after cwd/preset checks. `inspect`, `list`, `page`, and `follow` provide reads; use bounded original-ID reads, not activation through `resolveAgent`. `prompt` carries `requestId`, Session ID, mode and content; its return is only `{accepted:true}`. `cancel({sessionId})` calls `agent.cancel(...,{keepInbox:true})` and returns only `{accepted:true}`. It is not run-generation-addressed stop or proof that queued work cannot resume. `selectModel` has background default persistence effects and is outside this slice.

Missing from these stock contracts: product task binding, run-generation-addressed admission/lookup/settlement, genuine suspended-with-no-pending-execution proof, generation-addressed tree stop, work-slot ownership, and a receipt associating completion with this product task/session/generation. Session event sequence, prompt request ID, and control-stream generation are not interchangeable with product run generation. `fork` is history copying; it is not delegated child execution. Session parent lineage does not enforce depth 1, and SessionStore fork does not supply delegation-depth policy.

The stock installation does not contain `dsh-experimental-native-run`; the existing controller imports that package and protected provider exports from a separate reviewed development runtime. Historical loader evidence points to `历史隔离位置〔runtime〕` and `历史隔离位置〔source〕`. Loading through that remapping can only establish development/synthetic compatibility, not stock-native acceptance. Do not add the missing SDK package or change SDK/core.

## Chosen architecture and alternatives

Choose a Host-owned retained work port plus a small internal state module. It reuses existing owner identity, command envelopes, transaction/replay semantics and task creation implementation. Durable work rows carry only the additional identity, reservation and receipt metadata. The Host owns authorization and the runtime source; callers cannot submit observation DTOs. This keeps a future main-conversation caller small once its authority is solved.

Rejected for this slice: extending the fixed two-target native controller into a general scheduler (requires native capability work and expands scope), or keeping an in-memory registry in each port (loses restart deduplication and permits multiple independent budgets). A standalone public write service would invent authority and is prohibited.

## Proposed public contract

Expose types through the existing `dsh-bot/host` export; no new browser/RPC export. The `Host` gains `openOwnedWorkSessionPort(caller, options)` and a private dispatch context patterned on retained management. An optional constructor-only runtime is retained once per Host, never supplied by a delegate or read-only port. Current accepted injected runtime kind is only `offline-synthetic`; absence means stock execution is unsupported. A `stock-native` label is not accepted merely because an object claims it.

Options capture `botId`, `botEpoch`, `authorityEpoch`, and optional synchronous `isCurrent`. Validate exact owner, active native-owner grant, exact Bot owner/epoch, and current configuration. Recheck before every operation, before cached receipt reuse, and after every await; lease invalidation is terminal. Admission captures a private Host-owned runtime/source-instance identity before scheduling start. Persist an opaque instance reference on the generation, but never accept its serialized value as proof: only the exact still-retained Host/runtime instance can reconcile that generation. `sourceId` is descriptive, not authority. Separate ports for the same Bot share the same ledger work rows. Do not export the Host, caller, Ledger, runtime, or mutable records on the returned frozen port.

Proposed port methods:

- `dispose() -> void`: closes this retained port synchronously; never stops work or releases its reservations. Subsequent methods deny.
- `delegate(envelope, {task_id,goal,completion_condition}) -> Receipt<WorkSessionView>`: synchronous durable mapping and queued state; creates no native Session and issues no model work.
- `query({task_ids?}) -> WorkSessionSnapshot`: synchronous read-only current views, all selected IDs must be in this Bot. Empty omission lists this Bot's work only; at most 500 IDs per explicit request.
- `admit(envelope,{task_id,generation}) -> Receipt<WorkSessionView>`: synchronous capability check and atomic reservation before any adapter call. With no verified execution adapter, retain queued state plus precise unsupported reason; no reservation or native call. With the offline synthetic fixture source, schedule one bounded adapter start after commit and return the identity/state immediately.
- `collect({task_id,generation}) -> Promise<WorkSessionView>`: one lookup from the privately retained runtime with a 2000 ms maximum and AbortSignal, single-flight per task/generation; enforce a hard independent timeout race, not only AbortSignal. On timeout return an unknown observation with its reservation held; quarantine any eventual resolution/rejection without applying it. Keep the original unresolved lookup marker until that call settles, so repeated collection cannot accumulate pending adapter calls; report `work_lookup_in_progress` meanwhile. Clear deadline timers/listeners and contain late rejections. Synchronously blocking adapter code is outside this trusted asynchronous contract and cannot be preempted. No caller-supplied receipt fields. Recheck lease, identity and fence on return. Query remains usable while lookup is pending.
- `fence(envelope,{task_id,generation,reason:'terminate'|'handoff'}) -> Receipt<WorkSessionView>`: records a local fence before any further effects. It is not a native stop API. Held slots remain held until trusted quiescence/settlement. Never call stock cancel as proof.
- `spawnChild({parentTaskId,parentSessionId,parentGeneration,task_id,goal,completion_condition}) -> Unsupported`: verify exact current root parent, then return `child_spawn_unsupported` without creating a task/Session or reserving a slot. Recursive lineage rejects `work_depth_exceeded`; internal pure policy fixtures may represent multiple depth-1 children.
- `resume(envelope,{task_id,generation}) -> Receipt<WorkSessionView>`: only from confirmed nonexecuting waiting, with no termination/handoff fence and current Bot/task/config/authority. Increase generation once, keep taskId/sessionId, and return queued; requires a new explicit admission. No arbitrary caller generation assignment. Handoff to another owner or changing instructions is unsupported in this slice.

Envelope command names are `delegateWorkSession`, `admitWorkSession`, `fenceWorkSession`, `resumeWorkSession`. Existing root instruction reference, operationId, nonce, digest, deadline, ledger identity, expected revisions/epochs remain mandatory. New handlers are callable only with retained private work dispatch context, including when someone tries `Host.commands[...]` or `executeOwned` directly. Query and collect do not manufacture operation records for reads.

Validate plain exact-key payloads. `task_id`: nonempty exact string, no trim/coercion, maximum 200 characters; goal maximum 500 characters (existing task title); completion condition maximum 4000 characters; reject empty/whitespace-only text, arrays, inherited/unknown keys, unsafe generation numbers, sparse/duplicate/oversize query IDs. Keep task_id opaque using tuple/canonical keys, never path/object-property concatenation vulnerable to collisions or `__proto__`.

## Minimal durable state and identity

Unique mapping key is the canonical tuple `[botId, task_id]`, not an operationId. Atomically, first delegate calls the existing internal createTask implementation with title=goal, acceptance=completion_condition, ownerBotId=captured Bot, scope `{namespace: 'work-session/<generated taskId>', writeResources:[]}` (generate taskId before constructing namespace through a factored internal create helper). Factor `createTaskRecord(payload, taskId = randomUUID())` as an internal Host helper used by existing createTask and new delegation; the work caller supplies the generated UUID to that helper, never an external task_id. No authority is derived from the namespace. Save task, mapping and work row in the same command transaction.

Persist separate `workTask` rows keyed by canonical [botId, task_id] and `workGeneration` rows keyed by canonical [botId, taskId, generation], preserving old held reservations and receipt identities. Persist: botId/Bot epoch; external task_id; stable generated taskId; stable reserved `session-<UUID>` sessionId; generation initially 1; immutable instruction digest; task epoch/revision and configVersion snapshot; authority epoch; work revision; execution state; creation state `reserved|confirmed|unknown`; held-slot flag; fence descriptor; last accepted source/receipt ID/sequence/digest; last safe result summary; depth 0 and nullable parentTaskId. The original-ID creation command may later bind the reserved ID through SessionCreationDriver; it must never substitute a returned different ID. In this slice default stock `creationState=reserved` means exactly that: no actual Session exists because dispatch is unsupported. Synthetic adapter confirmations carry `evidenceKind='offline-synthetic'`.

Same Bot/task_id and identical goal/completion digest returns the same taskId/sessionId/generation, even with a new operationId. Different instructions at that key fail `work_task_conflict`, including after completion/fencing. Never title-match or deduplicate by Session name. Operation/nonce replay follows Ledger rules; a new operationId for identical delegation reports the current work mapping while an exact envelope replay retains its original immutable receipt; query supplies current state. Before returning any cached receipt revalidate current lease, Bot/task/config and generation/fence, refusing stale mutation replay. Stable identity survives a fresh owner-authorized port on the same ledger; prior running/reserved/unknown rows keep their slot, and restarting never auto-starts work. A fresh Host must revalidate ownership, may inspect/reuse queued identities and count all old held generations, but cannot inspect-to-settle, resume, release, or restart a previously runtime-bound generation. Return `work_source_continuity_unsupported` and preserve its held flag and prior result even if the new runtime copies `sourceId`, binding, operation ID and quiescent receipt. Cross-instance recovery/adoption is unsupported. Fresh never-admitted queued generations can be admitted under the new current owner/source. Same-Host new ports use its original retained runtime instance. A still-valid original Host/source may settle its own old generation under all original authority/configuration fences.

Execution state is the closed union `queued|admitted|running|settling|unknown|waiting|completed|failed|archived`; creation and fence state are separate. Snapshot includes held count, limit=15, exact coverage and discriminated unsupported/synthetic evidence flags.

No migration of old attempts/native operations into new work claims. Do not admit new work if this Bot already has existing active/uncertain legacy execution outside the new budget: fail closed with `legacy_work_unreconciled` until trusted reconciliation exists. The main/contact session is excluded; fixed execution Session is not silently ignored. Inspect actual legacy shapes: creation metadata and prepared-but-never-admitted native operations alone do not imply execution; execution native operations in admitting/admitted/driving/consumed/unknown states without proven terminal settlement block, as do attempts with active run identity or unconfirmed stop. Resolve native target ownership through nativeBinding and task ownerBotId; do not count contact targets or invent a generic status field. Missing trustworthy classification of a known execution run is a blocker. Coverage is exactly this ledger's workGeneration reservations plus known legacy execution blockers. Uncontrolled native work is not observable through this contract; snapshots say `coverage: owner-contract-ledger`, `nativeCoverageVerified:false`. Global native admission is unsupported until all work enters the controlled path.

## Shared 15-slot invariant

For each Bot, transactionally enforce held work reservations <= 15 across every port and every parent/child work record. This is independent of the Bot's contact/main Session and independent of the old protected controller token budgets.

| Work state or event | Slot rule |
| --- | --- |
| queued, never admitted | 0 |
| admitted/reserved, creating as part of admission, running, settling | 1 |
| unknown creation/start/receipt/transport outcome | 1 once admission reserved it |
| waiting requested or reported without proven nonexecution | 1 |
| confirmed waiting/suspended with no pending execution, from exact trusted runtime source | 0 |
| stop/terminate/handoff requested; cancellation merely accepted | retain 1 if previously held |
| settled/completed/failed with exact terminal no-execution proof | 0 |
| archived work with proven no execution | 0 |
| archive requested while execution uncertain | retain held reservation; do not call it archived |

Atomic admission counts all held rows and claims one before scheduling runtime work. Immediately before deferred start, revalidate retained port/owner lifetime, Bot/task/config/authority, exact source instance, generation and fence. If terminate/dispose/revoke intervened, do not invoke start. A private per-generation `startInvoked` flag changes synchronously immediately before invoking the retained function; only this exact Host's confirmed never-invoked reservation may be locally abandoned/released by the dedicated no-start path. That path records no execution/completion receipt and cannot publish stale results. Once invocation begins, throwing, timeout or uncertain return retains the slot pending exact source settlement. Do not infer never-invoked from a persisted string or another Host. The 16th distinct candidate remains queued with `capacity_exhausted`; no call reaches runtime. Duplicate admission never reserves twice or starts twice. Unsupported dispatch leaves a never-admitted row queued and slot-free. Unknown rows cannot be released by a timeout, process restart, losing a port, caller Boolean, local fence, or missing Session lookup. Failed adapter invocation after reservation is conservatively unknown unless the source proves no admission.

Parent/child records use this same counter, not separate pools. Parent can release only on genuine suspension confirmation; a waiting label, empty assistant reply, or a return from spawn is insufficient. Future roots have depth 0, children depth 1, children cannot spawn; multiple children are permitted only within available shared slots. Actual child spawn is unsupported now (`child_spawn_unsupported`), and no native child API is invoked. Pure policy tests may test depth/shared-slot rules; they cannot claim child execution worked.

## Receipt source and late-result fences

The caller requests collection; it never supplies observed state or proof. Adapter start/inspect receives a frozen binding `{botId,taskId,sessionId,generation,botEpoch,taskEpoch,taskRevision,configVersion,authorityEpoch}` and stable operation identity (`operationId` captured from admission and included in each runtime receipt). The constructor option is `workSessionRuntime?: OfflineWorkSessionRuntime`, with readonly `kind: "offline-synthetic"`, `sourceId: string`, `start(binding, signal): Promise<WorkRuntimeReceipt>`, and `inspect(binding, signal): Promise<WorkRuntimeReceipt | null>`. The adapter object and source identity are retained by the Host. A receipt contains `receiptId`, `sourceId`, `sourceSeq`, exact binding, `state`, `execution: "may-execute" | "quiescent"`, `creation: "confirmed" | "unknown"`, and optional bounded text `summary` (4000 chars); exact keys and safe integer sequences are required. These fields are trusted only from the retained source, never from port inputs. The only executable fixture source in this slice is labeled offline synthetic. Default stock adapter has no trusted work settlement source and returns `unsupported_work_generation_receipts`.

Before querying or accepting a receipt, require the original Host-owned source-instance identity for that admitted generation; matching sourceId text is insufficient. Each returned receipt must match exact binding, source identity, operation identity, monotonically increasing source sequence, receipt ID and canonical digest. Duplicate identical receipt is a no-op; same receipt ID with changed contents is conflict; out-of-order receipt is ignored/fail-closed without regression; mismatched task/session/Bot/generation or unknown source is rejected. Returned safe DTOs are cloned. Source payloads never expose arbitrary diagnostics or credentials.

Fence is separate from execution state. On local termination/handoff, increment a monotonic fence value and capture the old generation; pending results cannot write completion, resume work, or alter the current generation. Exact old-generation terminal/quiescence receipts may only settle that old reservation into retained history, never update the current generation. Resume after confirmed waiting increments generation and fences prior callbacks. On configuration/task/Bot/authority invalidation, deny writes and preserve reservations for trusted recovery; do not assert settlement. Native resource settlement is not inferred from a product completion condition.

The ordinary prompt/cancel acknowledgement, Session seq, Session created proof, or mere existence of events never releases a slot. A correct synthetic settlement test establishes only the product contract under that explicit fixture source.

## File ownership and minimal state transfer

Only the writer edits the candidate. Root owns coordination/evidence at the task root. Independent reviewer owns independent evidence and reports findings; no candidate edits. Existing baseline/main/tarball/evidence remain untouched.

| Candidate path | Planned responsibility |
| --- | --- |
| `src/host.mjs` | Retained work authority/dispatch context, register internal handlers, reuse/factor task creation, runtime ownership, command transaction integration. |
| new `src/work-sessions.mjs` | Internal work validation, canonical key/deduplication, state transitions and shared reservations, receipt projection. Not a new package export. |
| `src/contracts.d.ts`, `src/host.d.ts` | Exact work input/view/runtime/port declarations and existing host export types. |
| `src/native-controller.mjs`, `.d.ts` | Small owner-only `workPort(caller,options)` forwarding wrapper with actual fiber/controller lifetime. No native open/drive changes. |
| new `test/work-sessions.test.mjs` | Bounded offline contract, atomic capacity, synthetic receipt and late-fence tests. |
| new `test/work-sessions-types.mts` | Strict public API positive/negative fixtures. |
| new `docs/work-sessions.md` | User-visible reserved-vs-created, unsupported-vs-synthetic capability contract and future ingress gap. |
| these spec/plan files | Requirements and executable handoff. |

No planned changes to owner-app/input/UI/plugin/read source, adapter/native SDK, creation driver, legacy observations/resources or package exports. If implementation discovers a required edit outside this map, report the exact need before expanding scope. Actual creation integration is deferred, reusing SessionCreationDriver/ownedCreationPort when a sufficient retained native work adapter exists; do not implement a parallel creator now.

Minimal handoff consists of approved-scope, these two docs, baseline-verification.json, planning-report.md, exact installed interface paths/hashes, and later per-command RED/GREEN/package evidence. No credentials, user profiles, conversation contents or giant copied runtime state.

## Verification and acceptance boundaries

After root preflight only: genuine feature RED, then focused GREEN, meaningful race/identity/lifetime tests, strict declarations, real offline tarball and installed consumer test using package exports, source/tar/install file hash provenance, independent review. Use existing dependencies and copied evidence guards only; preserve failed runs. Test memory resources and fibers must dispose. Review historical scripts before use: default test/native runners delete their temp evidence and select broad native/profile suites; do not invoke them.

Acceptance statements remain separated: product contract proven offline; synthetic runtime transition/receipt tests; stock Session interface inspection; optional development-controller constructor-only compatibility. None is autonomous-model, real multi-session native execution, real child spawning, actual main-chat responsiveness, or public human authority acceptance. All runtime/release verification flags remain false.
