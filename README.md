> **UNACCEPTED WIP BACKUP — NOT A RELEASE OR COMPLETE v0.1.**
> Private Mac-to-cloud development handoff only. The snapshot includes 4 known failing RED regression cases and unresolved independent review findings. Native six-requirement acceptance and cloud candidate validation have not passed. No PR, main/feature upload, merge, deployment, tag or release is authorized by this backup.
> See [the frozen handoff manifest](docs/mac-handoff-20261004.json) and [the exact three-file regression patch](docs/mac-handoff-uncommitted.patch). Product implementation is unchanged from `b42acc3`.

# dsh-bot

Private **0.1.0-alpha.1 control layer candidate**, based on the user's DSH bot v0.2.1 design. This is an independently implemented persistent control ledger and thin review UI. Native DSH owns all Session, Agent, model and tool execution. This project never starts a substitute agent runtime.

The six product requirements remain release blockers: unified native sessions, recoverable native archive, multiple persistent Bots, actual per Bot model choice, real group/meeting cooperation, and natural-language contact while background work continues. Native writes currently return `unsupported`; registered Bot records and queued Attempts are not model success. It is not a complete v0.1.

## Run locally

Requires Node 22.16+ with `node:sqlite` (experimental on Node 22). No install or external runtime dependency is needed for the offline candidate.

```sh
npm test
npm run check
npm start
```

The review UI binds only `http://127.0.0.1:8787`, writes `.local/preview.sqlite`, and has no DSH Home, provider key or native runtime connection. Four entries manage local records: management, Bots, groups and tasks. Models are nonsecret route labels; never enter keys or credentials. Manual opinions and artifact acceptance are clearly marked human records. Stop/archive/restore never claim native effects. Session-mode controls are disabled while the user's intended domain and loaded catalog remain unresolved.

Use explicit IDs and current revisions. The browser persists operationId, nonce, payload and full envelope before POST. After an uncertain response, use lookup or retry with the original identity. It never silently creates a new nonce for a pending operation. A definite invalid command may leave a pending record requiring inspection; clearing browser storage is not a native recovery procedure. Keep the SQLite file and its WAL together for backup; offline schema version 1 is supported. Unknown/future or nonempty unversioned schemas are refused before a writer opens; no automatic migration or native-log recovery is implemented.

## Implemented boundaries

- SQLite short synchronous transactions, exact actor/nonce/operation binding, immutable config versions, task revisions and epochs.
- Local canonical group routing, membership generations, message/delivery/outbox atomic persistence, manually sealed meeting records, artifact-digest human acceptance.
- Bounded persistent autonomy policy, goal digest, steps/nextStep/checkpoint/event cursor and unknown reconciliation record. There is no automatic model loop, scheduler or paid call.
- Scoped read-only DSH adapter candidate; list is explicitly incomplete. Native create/select/dispatch/stop/archive/restore are disabled regardless of test-double capability labels.
- Optional Cordis `apply(ctx,{databasePath,ownerHumanId})` service seam using the public provide/effect contract. Until a native trusted-caller bridge is verified, the service exposes capability status only, hides ledger records, and rejects every command as unsupported_host_identity. Synthetic seam tests are not proof of a loaded host. Do not install into production from this README.
- Loopback review HTTP entry with exact Host/origin checks, process-local token, no CORS, body size limit and trusted configured human. This is a local review surface, not multiuser authentication.

All tests use `scripts/test.mjs`. Its child has an isolated temporary DSH_HOME, minimal environment, filesystem permissions, denied network/child processes and the same guard for implicit subtests. Do not run test files directly. Synthetic resource/effect evidence never proves actual provider or OS settlement. Static syntax checking only parses modules; it does not start product code.

## Evidence and remaining work

[Acceptance matrix](docs/acceptance-matrix.md) accounts for every F01–F28 and U1–U8 without marking partial tests as complete native acceptance. [Capability matrix](docs/host-capabilities.md), [native contract proposal](docs/native-contract.md), [autonomy protocol](docs/autonomy-protocol.md), [session-mode definitions](docs/session-mode.md), [review ledger](docs/review-ledger.md) and [provenance](docs/provenance.md) distinguish actual local execution, synthetic data and untested native behavior.

[Full extracted v0.2.1 spec](docs/spec-v0.2.1.md) and [topology/extraction evidence](docs/spec-extraction.json) preserve the authoritative user design. Public installed type hashes are in [the static manifest](docs/public-types-manifest.json); no native private logs or credentials are included. `scripts/probe-public-types.mjs` reads only an explicitly supplied public package directory and never imports or starts a host.

Missing verified native contracts include per Session model selection, final dispatch freeze, durable operation lookup, run-addressed tree stop and authoritative resource settlement, producer/scope enforcement and interaction capacity. User-authorized independent cloud host verification is a separate task; this alpha does not anticipate its results. No production deployment, permission change or PR merge is performed.
