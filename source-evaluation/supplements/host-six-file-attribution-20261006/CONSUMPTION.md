# Private Host attribution supplement

Classification: SOURCE_EVALUATION_ONLY. This supplement adds six immutable source/build inputs to the existing Host materials. It neither replaces nor overwrites the original 88-file packet or the 15-file consumption supplement.

- `host-head/` contains the three requested exact Host Git blobs from commit `3fbedc25d3626caf4e401b14c31a7f0326a19ec7`. These are original committed inputs, deliberately separate from the working-tree overlays supplied in the earlier 85-material manifest. The new manifest records each previous overlay/head hash and whether it matches.
- `retained-builds/` contains only the retained AgentLoop and NativeRun `lib/index.js` entries, identified through their named package manifests. These are comparison evidence. They are not asserted to have been rebuilt from the three source blobs or from current working-tree source.
- `a-assembler/` contains the exact committed assembler at `cb4937036001f93b6efe5ed801fb9dfedee4e221`. This establishes the recipe input as an immutable blob rather than the active writer tree.

Read the manifest before consuming the files. Keep this supplement under a separate path in the private evaluation branch. Compare hashes before examining or rebuilding anything. The Host public base remains `639ed015397290b3745d163aafe02ffee4aa3f84`; previous material manifests remain the authority for the larger source/build closure. This six-file subset is not independently build-complete. No portable-lock, package-license, 75-overlay, or source-to-retained equivalence gap is closed by supplying these files.

The parent-reported B result is 28/28 plus TypeScript, and 71 matching entries out of 73, with AgentLoop and NativeRun remaining different and LLM/DeepSeek matching. This reviewer did not rerun those tests, builds, imports, or comparisons. Use these files to explain the remaining differences rather than assuming the historical A stock consumer ran this retained overlay. The earlier stock official runtime and retained archive are distinct input sets.

The retained archive's safe manifest identifies candidate commit 3fbedc25 and declares 74 core packages; the prior independent inventory observed 75 retained overlays. This count discrepancy and complete recipe remain open. Only the safe manifest hash/count/flags are reproduced here, with no raw archive-manifest paths.

No runtime profile, Home, credential, environment value, operational record, log, private note, authentication header, test placeholder key, or real ledger is included. No new build, test, SDK import, model, service, authentication action, or native stop was performed. Precise stop-generation settlement remains UNSUPPORTED. No automatic activation or import of these compiled entries is authorized by this supplement.

The public-base root MIT license equality was established in prior materials. Local Git provenance records unsigned commits and author-identity hashes; this cannot prove authorship rights or blanket MIT coverage for every local patch. Rights and source-to-build equivalence remain UNKNOWN/UNPROVED. Distribution and runtime qualification are separate gates; the root may append only the reviewed packet through the already authorized private normal-forward route.
