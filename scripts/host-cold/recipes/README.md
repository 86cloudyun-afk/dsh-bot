# Linux Host cold-build recipe

This recipe targets Linux x64 with Python 3.12+, Git, GNU Make, a C11 compiler, ar, and the usual development headers. It downloads and byte-pins official Node 24.19.0 (including Node-API headers) and musl 1.2.5, builds musl locally, installs the supplied npm bootstrap lock and Host pnpm lock with lifecycle scripts disabled, then compiles the exact supplied source. No model key, dummy key, existing Home, DSH profile, retained session, or retained Host output is used. The original 85-file snapshot and nine-file consumption supplement must remain private; local patch rights are UNKNOWN.

For a GitHub Ubuntu 24.04 x64 runner, put this recipe directory and the supplied source packet in the checkout, then run:

```sh
python3 recipes/prepare-cold.py \
  --source "$RUNNER_TEMP/dsh-host-source" \
  --evidence "$RUNNER_TEMP/dsh-host-build" \
  --source-packet "$GITHUB_WORKSPACE/materials/host-source-packet"

python3 recipes/offline-tests.py \
  --source "$RUNNER_TEMP/dsh-host-source" \
  --evidence "$RUNNER_TEMP/dsh-host-tests"
```

The source directory and build evidence directory must be new. The second command requires Landlock enforcement with `NALR_REQUIRE_LANDLOCK=1`; its exit status is nonzero if any gate fails. It runs only the two supplied protected specs, the native entry, real flock tests, native payload validation, and the strict native launcher test. Tests use a separate new Home. The 28 protected cases prohibit network, listeners and child processes through their supplied source fuse.

For a wholly offline rebuild from the prepared material directory, obtain the producer's `MATERIALS.json` SHA-256 independently and pass it explicitly:

```sh
python3 recipes/prepare-cold.py --offline \
  --source /absolute/new-source \
  --evidence /absolute/new-evidence \
  --source-packet /absolute/materials/source-packet \
  --materials /absolute/materials \
  --expected-materials-sha256 CALLER_TRUSTED_MANIFEST_SHA256
```

The material directory contains the public Git bundle, hash-pinned raw Node/musl archives, freshly prepared public npm/pnpm stores and registry metadata, the exact private source files, and these recipes. It excludes the pnpm cached lock-policy verdict so offline installation must evaluate the unchanged policy using the supplied public metadata. It contains no Home, DSH profile, credential, or compiled Host runtime. The material manifest pins every regular file. `index-materials.py` independently verifies all prepared pnpm files against their SHA-512 content-addressed names.

The output `core-overlay` uses runtime-export manifest format 2 with a computed closure. The historical 75 package selection includes an unchanged development SDK client whose runtime dependency is the complete `dsh` CLI. That SDK is compiled for the protected specs and omitted from the overlay roots; it makes the old 75 selection expand to 289 packages if treated as a standalone closure. The qualified core overlay contains 74 runtime packages and 28 locked external package versions. A separately locked official CLI/SDK installation supplies the launcher side. The output is a private source-build overlay; it does not alone install a Loader/GUI application. The original format 1 assembler and its 74-declared/75-observed guards remain unchanged.

TypeScript first verifies the selected packages and generator. The Typert API then emits the five selected Host contributors explicitly. Calling the package plugin's implicit workspace-wide generation scanned an unselected SSH package and failed on its missing zod type. The scoped generation retains the inspected analyzer and export validation and does not disable a type or artifact check. Standard decorator lowering remains enabled for JavaScript bundling.

Public source identity, source file index, bootstrap lock, pnpm lock, recipes, and payload file digests are recorded separately from the declared historical local HEAD. Three dirty runtime source files and a dirty TypeScript configuration are part of the verified source packet. The two supplied retained indexes differ from the new build; the NativeSessionDriver build contains the supplied category validation, request ownership category, and late-failure journal behavior. No retained files contribute to construction. Rebuilding on a different compiler or operating system can change native bytes; every build must obtain a new artifact digest, and no cross-platform byte equivalence is claimed.

Keep the upstream Harness MIT notice, native system BSD notice, vendor notices, musl COPYRIGHT and bundled notices, and Node LICENSE with any final private distribution. These notice facts do not establish rights over local patches. The current cloud kernel reports `ENOSYS` for the Landlock syscall; the strict launcher gate remains failed there. The musl addon has a verified ELF x64 payload but has not been loaded on a musl Node runtime. NativeSessionDriver local drain, idle, and durable fences do not establish remote generation-specific stop settlement.
