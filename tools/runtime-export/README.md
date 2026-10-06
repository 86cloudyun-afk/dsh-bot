# Private runtime-export module handoff

This handoff contains the exact six required implementation/test/fixture files from reviewed source commit 47d0ce7c123bef7560a3d8f4d6e7bc3da880f7da. It includes the final CLI at that commit. README, handoff metadata and sanitized review copies are delivery documents. They introduce no runtime/schema changes.

Independent review: scoped PASS for R1/R2/R3, 52/52 archived module tests, 44 additional cases and 20 replay groups. These are retained independent results, not reruns during upload. The review audited the full 93-file source tree 2c745c4e615bf6451637dd46bb1fe777c31dbd91; this delivery deliberately selects the six files required to run the isolated module and suite. Per-file byte equivalence is in HANDOFF-MANIFEST.json.

From the repository root, under Node 24.19.0 or later:

```sh
node --test tools/runtime-export/export.test.mjs
```

The module exports planRuntime({sourceRoot,lock,roots,identity,platform,arch}), exportRuntime({plan,outputDirectory}) and verifyRuntime({directory,expectedManifestSha256}). Plans are immutable and belong to the creating module instance. RED plans refuse export. Use a caller-trusted manifest digest for source/build trust; unpinned verification establishes internal consistency only. External package bytes are inventoried but absent.

CLI required absolute flags: --source, --identity, --roots, --report; optional --output. The supplied source must contain the fixed source-file identity and lock. YAML parsing uses the already installed js-yaml4.2.0 from that source tree; the CLI never installs dependencies. Report/output paths must be separate, canonical and exclusive. Cleanup deletes only paths with a retained matching inode/device. Metadata/removal failures can leave explicitly reported paths requiring deliberate recovery; there is no unconditional rollback or general hostile-concurrency guarantee.

The captured contracts/scripts__assemble-owner-runtime.mjs is an unchanged test fixture, not a replacement for A scripts. It retains the original fixed commit, 74 declared/75 observed count checks and FIXED_ARTIFACT_IDENTITY_REQUIRED. Source identity, manifest2 and consumer contracts have not been migrated. Actual B runtime remains RED for missing bin/landlock-run and bin/musl/system.node; this is a tool source handoff, not a runtime export or release.

Original source recipes, real Host preflight files, private project notes and local source/build trees are deliberately omitted. No models, live ledger, credential or Home content are included. A's sole writer owns the authorized integration. This delivery changes no A release/main/PR1 branch and grants no public-distribution rights.

See evidence/handoff-47d0ce7/independent-review.md and the retained proof logs. The additive handoff patch can be checked with git apply --check; A must perform that check against its actual checkout. It is applicable when the delivered tool paths do not already exist; no existing module files are overwritten by that patch.
