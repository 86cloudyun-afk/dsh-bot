This is a sanitized handoff copy of the independent reviewer report. Findings, dispositions, metrics, source commit/tree, and evidence hashes are retained. Local execution paths are replaced and the appended synthetic reproduction source is omitted. The original report SHA256 is `052685dd325878f3dbd47f83f7ba06760cadcde3c27152b5b14a9d27640d6065`. This copy is delivery documentation; it is not a new review.

# Independent bounded follow-up review: 47d0ce7

**Disposition: independent scoped PASS for R1/R2/R3 bounded fixes.** No remaining blocker found within the authorized review scope. This closes the previous R3-A/P2 finding and accepts the explicit ownership-unavailable disposition; it does not claim every filesystem failure can roll back cleanly.

## Exact reviewed revision

- Follow-up BASE: `4115a762cfeccca244afca88e978a6fc1aa21404`.
- Original R123 BASE: `c99a80e0af572d55b74db7d0ac744756435b2a53`.
- HEAD: `47d0ce7c123bef7560a3d8f4d6e7bc3da880f7da`.
- Tree: `2c745c4e615bf6451637dd46bb1fe777c31dbd91`.
- Snapshot: `<REVIEW_SNAPSHOT>`, independently extracted by `git archive` of that exact commit.
- All93 archived files were independently hashed as Git blobs and matched `git ls-tree -rz` for HEAD. Tests and probes import only the archived module.
- Runtime: Node24.19.0 at `node`. Runtime environment contains only PATH,LANG,TMPDIR; no inherited HOME,DSH_HOME or model-secret variables. Synthetic CLI children preload the archived offline guard; observed counters are all zero.
- Only this report was newly written inside the repository by this reviewer. All prior reports, implementation, author evidence and external source/build trees remained read-only. Probe scripts, logs and fixtures are under `/tmp`.

| File | Git blob | SHA256 |
| --- | --- | --- |
| cli.mjs | 158481bcef9b66a91b2bc25b261f13d43fb3bc37 | 1b8631e0e6b2dfcd8909d4c7e25abea8ff76d230fc23567c4eca1bcba36828c0 |
| export.mjs | c424076a60901ba044921e06f6be3ebc7c18c887 | 2d0a2faacc30106039f88b4befede54440fa6bb0761eee47ad46518971788f9d |
| export.test.mjs | c7ea9e9f76306acb1375e9cd64c9be4f64bd94bb | f2d43714f0e2dddfe05b6f022b770e1f7500adb81c4182cabc2aac2a5daadbf1 |

Inspected the production diff against4115 and against the original c99 BASE, the changed regression tests, progress ruling, prior independent4115 report, new RED/GREEN logs/status and fresh replay results. R1/R2 checks remain intact. No manifest fields/schema, old assembler identity/count guards or A integration behavior changed.

## Findings and dispositions

| Review item | Result | Independent evidence |
| --- | --- | --- |
| R1 required external peer compatibility | PASS retained |18 cases across importer peerDependencies/dependencies/devDependencies: incompatible major, caret0 boundaries, compatible caret0, tilde upper bound, unsupported comparator and wildcard. Valid cases export/verify; invalid cases return RED and no output. Verifier regression remains passing. |
| R2 declared main presence and ownership | PASS retained |7 cases: traversal, absolute path, internal dot traversal, directory, missing entry and null all rejected; safe `./lib/index.js` accepted. Reduced file-list missing-main replay rejects; original trusted pin rejects altered manifest. |
| Original R3 deterministic report conflict | PASS retained | Existing report regular file/symlink preservation, path equality, both containment directions, canonical output parent and caller output/replacement protection pass. |
|4115 R3-A/P2 swallowed cleanup lookup error | RESOLVED | `cli.mjs:11` treats only ENOENT as absent. After report-write ENOSPC, output/report lookup EACCES now produces cleanupErrorCategory:EACCES. The other owned path is independently cleaned. |
| Report ownership acquisition unavailable | ACCEPTED bounded behavior | Handle stat EIO produces primary EIO and cleanupErrorCategory:REPORT_OWNERSHIP_UNAVAILABLE. Newly claimed report remains; no output is created and no ownership-blind deletion occurs. |
| Output ownership acquisition unavailable | ACCEPTED bounded behavior | Post-mkdir stat EIO is inside exporter guarded handling. Primary EIO is preserved with ARTIFACT_OWNERSHIP_UNAVAILABLE; output remains without manifest and CLI removes its separately owned report. |
| Internal exporter cleanup error/caller replacement handling | PASS |8 newly authored cases cover normal removal, lstat EACCES/EIO, rm EPERM, replacement directory/file/symlink and absent destination. Primary ENOSPC is preserved; applicable cleanup category is attached; all caller markers and replacements remain intact. |
| Internal exporter error propagated through CLI | PASS | Additional CLI probe faults artifact-manifest write with ENOSPC and cleanup lookup with EACCES. stderr retains both categories, report is cleaned and output is retained. |

The old R3-A reproduction still leaves a complete artifact when ownership lookup fails, and that artifact can internally verify. It now explicitly reports cleanup failure. Under the approved ruling, this is correct: uncertain ownership or denied metadata access must preserve paths rather than trigger blind deletion. This result is **not** a claim that the artifact was rolled back. On such errors, retry can encounter EEXIST; root/caller must deliberately inspect and recover the residual paths.

Confirmed code behavior:

- CLI cleanup attempts artifact and report independently; one lookup/removal failure cannot skip the other attempt.
- Exporter ownership capture is inside its guarded block. If capture fails, the error explicitly carries ARTIFACT_OWNERSHIP_UNAVAILABLE.
- When identity is known, exporter uses lstat, requires a directory and matching inode/device before recursive removal, and preserves the primary error if cleanup fails.
- Existing caller output is rejected before an output claim. Existing report is rejected by exclusive wx. Distinct replacement identities are preserved. Deterministic replacement probes are safety checks, not a general adversarial concurrency guarantee.
- ENOENT remains an allowed absent-path result. A removed output does not incorrectly add a cleanup failure.

## Independent verification

Full archived module suite: **52 tests,52 pass,0 fail**, exit0. This includes the existing caller-file/replacement and concurrent-winner tests, pin checks and synthetic legacy assembler rejection.

```sh
cd <REVIEW_SNAPSHOT>
env -i PATH=<NODE24_BIN>:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp node --test tools/runtime-export/export.test.mjs
```

Independent additional assertions:18 R1 cases +7 R2 cases +6 CLI controls/faults +4 path-boundary cases +8 internal-export failure/replacement cases +1 CLI internal-error-propagation case = **44 cases**, all completed successfully. The ownership failure assertions intentionally require residual paths plus explicit blocked-cleanup diagnostics, not deletion.

Replayed the archived20-group fresh-probes script against the archive. Result SHA256 is `b0f70fd70654d4fda952c377f6337ea5516e0da52b3168735aeb157e712d0273`, exactly matching prior expected JSONL. The replay maintains previous symlink/source-change/duplicate-identity, manifest pin, glob, unexpected-payload and concurrent-output checks. The author’s new RED log records48pass/4fail and GREEN records52pass/0fail; those were inspected as supporting history, not substituted for independent execution.

Evidence files and SHA256:

- `./review-47d0ce7-identity.json`: `f5e3dd40d64470cc58889f3b8824aaff241610150f058cbbe4c6fab6221653c7`
- `./review-47d0ce7-suite.log`: `c61c2ac3d503a098754293928679445c6cfa899bbf624fc343248b4a73565a9d`
- `./review-47d0ce7-replay.jsonl`: `b0f70fd70654d4fda952c377f6337ea5516e0da52b3168735aeb157e712d0273`
- `./review-47d0ce7-independent.mjs`: `3fd42de1fc0fd8d331eaa4cb394d6d2a4609ef40575d31d85740b46a399ddb4f`
- `./review-47d0ce7-independent.jsonl`: `0524a0e2a357dda5083f71186eb523091b92438caec16348fa583b15be3ac524`
- `./review-47d0ce7-boundaries.mjs`: `93bc2c1a6869a75ddc95af2029d82980e77826fff02912c621ea3b41733d9d7b`
- `./review-47d0ce7-boundaries.jsonl`: `f4364fa8ce9240edef0d4e50f8523d81de8b4a540812df5552a31e414550aa7c`
- `./review-47d0ce7-export-faults.mjs`: `a732be39ce306a807ffb966aad363089da063e4061faa7702adacf25e589f43e`
- `./review-47d0ce7-export-faults.jsonl`: `d2c6ead5749602ceb7f37f44fbef7c30426426f21264ad5db240713e5a57311b`
- `./review-47d0ce7-cli-internal.mjs`: `8f3c7a9c65f9199b6695ce2463e3098aa4eb4f579784b4bc7dd356ce75a44901`
- `./review-47d0ce7-cli-internal.jsonl`: `0a6b63e357a197a43bddd06ed6f7ecbb5fb75b6e4f392104df3fa8d628fa6048`

## Remaining contract and coverage limits

- This PASS applies only to isolated tools/runtime-export R1/R2/R3 bounded fixes. It does not approve actual B export, Host integration, dependency installation, release, public distribution or licensing.
- Unpinned verifier success means internal consistency only. Source/build trust acceptance still requires a caller-trusted manifest digest; a self-supplied digest does not authenticate provenance.
- External package bytes remain absent. The overlay is not a standalone runtime installation.
- Historical real-B evidence remains55 workspace packages/20 external snapshots/94 indexed source files, with `bin/landlock-run` and `bin/musl/system.node` missing. No real-B preflight/export was rerun and no real runtime artifact was generated.
- The unchanged legacy assembler continues to reject with FIXED_ARTIFACT_IDENTITY_REQUIRED; old3fbedc25/74/75 assumptions have not been migrated. Consumer/root contract decisions remain open.
- No full build, Host141/28, install, API/model call, secret/Home/ledger inspection, push/merge or publication was performed.
- Malicious concurrent replacement and globally atomic multi-path visibility remain excluded by the existing README. Filesystem I/O faults can leave explicit residual claims requiring deliberate recovery, as now documented in progress. No unconditional rollback guarantee is asserted.
- R2 scope remains declared main; this review did not expand bin/exports/native schema coverage or semver support.

