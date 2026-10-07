# Private candidate native CI contract

Only the existing private release branch push admits the builtin denial proof and
the two original cold cases, once each and in order, on Linux x64 and macOS arm64.
Refusal, missing evidence, timeout, unverified child stop, incomplete capture or
failed cleanup blocks subsequent cases. This harness makes no model requests and
adds no child environment keys or filesystem/network permissions.

## Historical partition and approved current pure tests

`partition.json` retains the original 40 test hashes from
`26f3fe74aa52705fcdd8ff212d5754ce6afe0663`, its tree, both cold migrations and
their declaration/support hashes, the support-file hashes and the five excluded
legacy native filenames. The contract pins those historical metadata fields as
one immutable digest. It continues to reconstruct each moved declaration into
its original file and compare the complete historical SHA-256.

The current pure inventory contains those 40 filenames plus nine explicitly
approved additions, each with its full SHA-256. Three original pure files have
approved extensions: `adapter.test.mjs`, `bot-client-owner.test.mjs` and
`package-snapshot.test.mjs`. Each extension records its current full SHA-256,
original prefix byte count and appended suffix SHA-256. The contract removes
that pinned suffix and hashes the entire reconstructed original body against
the unchanged historical hash. It cannot reclassify a changed original
assertion as an approved append.

For `package-snapshot.test.mjs` only, the third-line fs import at byte offset 71
adds `chmod`. Its exact original/current import bytes are declared and pinned;
the contract reverses that one six-byte expansion before checking all 6,753
original bytes. Other import changes are refused. The other two extensions
retain their complete original byte prefixes without an import transform.

The audit separately reports `originalFiles: 40`, `movedCases: 2`,
`additionalPureFiles: 9` and `extendedPureFiles: 3`, with the addition hashes and
extension reconstruction evidence. `originalBodyUnionExact` describes the
historical bytes after those explicit reversals and two cold reinsertions.
Unknown or removed pure/native test files, including nested additions, are
refused; the two admitted cold files remain byte-for-byte bound to their original
hashes. These read-only Python checks execute no JavaScript or native cases and
do not establish native acceptance or the running-budget performance margin.

## Running budget and required finalization

The builtin proof shares a 5-second monotonic running budget starting before the
initial identity checks. Each cold case shares a 20-second budget starting before
its prior-receipt checks. All identity/hash validation, preparation, observations,
tests and successful receipt/output/return checks consume that same allowance.
The child receives only the remaining time, including its Node identity check.
At exhaustion the parent latches failure, stops new execution, terminates the held
child and blocks successors. Late successful output cannot restore PASS.

Required stop/capture confirmation, failure evidence sealing and owned-directory
removal are separately measured. A separate four-second stop/capture allowance is
used after running execution ends. Successful evidence writes still consume the
running budget. Finalization never clears a timeout or waives stop/cleanup gates.
Receipts report `runningSeconds`, `stopConfirmationSeconds`,
`failureSealingSeconds`, `cleanupSeconds`, `finalizationSeconds` and
`wholeWallSeconds`; `activeSeconds` remains an alias for running time. Phase times
may overlap and must not be summed. Summary timing is sampled before its own
receipt write; successful summary commit and return still undergo budget checks.

Python alarms, subprocess timeouts and post-operation checks do not establish a
physical hard wall for uninterruptible kernel I/O. That limitation remains
explicit. Historical physical-wall reports and measured overruns are unchanged;
this approved running-budget contract does not reinterpret old results.

## Original child binding config

Before launch, the parent reads the actual bounded regular `binding-config.json`
file, rejects symlinks/duplicate keys and audits the exact permitted schema:
`source`, the full public pinned platform row, and `installed` identity hashes with
verified synthetic installation paths. Extra or sensitive/authentication fields
are refused without printing or archiving their values. No credentials or
environment values are inspected by this retention module.

The original bytes are durably copied, never reserialized or reconstructed, to
`<case>-binding-config.json`; `<case>-binding-config-receipt.json` records their
SHA-256 and byte count. The source and retained bytes are rechecked. This evidence
must exist before child launch and before cleanup, including failure sealing when
preparation created a config before failing. Retention failure blocks launch and
preserves the unretained case directory instead of claiming successful cleanup.

The expected original SHA-256 travels in the existing companion import URI
fragment. The child hashes the bytes it actually reads and records fixed safe
fields: status, actual/expected SHA-256 and actual top-level `pins.platform` and
`pins.arch`. These are distinct from `pins.node.platform`. A mismatch is refused
before native admission. The parent additionally matches this observation to the
retained original bytes and platform row. The original and retention receipt join
the prior-case immutable hash chain. Missing child evidence stays UNKNOWN; it is
never reconstructed from parent intent or a fixture.

Pure regressions use owned synthetic files, synthetic clocks and fake children;
two CLI-discovery tests launch bounded Node children without SDK/native/model
access. These tests do not establish real native acceptance. Real acceptance is
reported separately from the artifacts of the single authorized CI attempt.

The native CI job installs the same locked SDK into a fresh detached worktree
under a short, physically canonical temporary path. The triggering commit is
checked before installation, and all source, package, SDK, file, mode and hash
checks still run inside their original case budgets. This changes the actual
directory layout to reduce repeated ancestor traversal by genuine strict
`Path.resolve`; it does not cache filesystem observations, warm the case,
raise its five-second budget or move identity checks outside the timer. The
recorded binding config and receipts contain that actual source path. macOS
resolves its temporary-directory alias before the worktree is created.
