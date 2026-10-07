# M2 native Host cold-build recipe

This recipe accepts `linux-x64` or `darwin-arm64` and requires that target to match the actual host. It builds the fixed public Harness commit `639ed015397290b3745d163aafe02ffee4aa3f84`, the original verified private snapshots, and the separately verified M0, M1 and M2 source deltas. The declared historical local HEAD is not the built identity. Local patch rights remain UNKNOWN. No retained runtime, private Home, actual session history, credential or model request contributes to construction.

Ubuntu 24.04 x64 prerequisites are Python 3.12+, Git, GCC/cc with development headers, binutils/ar, GNU Make, patch, and public HTTPS CA trust (`build-essential`, `git`, `python3`, `patch`, `ca-certificates` provide these). macOS 15 ARM64 needs Python 3.12+, Git, Xcode command-line clang/SDK, Make, patch and CA trust. The recipe obtains Node 24.19.0 and its Node-API headers from the same fixed official archive; a separate machine Node installation is not used for native compilation. Linux also obtains fixed musl 1.2.5 source and compiles its static libc. npm/pnpm lifecycle scripts are disabled; the explicit native compiler, TypeScript, Typert and decorator-build stages are retained in the recipe.

On a native Linux runner, use new source, build and test directories:

```sh
python3 recipes/prepare-cold.py --target linux-x64 \
  --source "$RUNNER_TEMP/dsh-host-source" \
  --evidence "$RUNNER_TEMP/dsh-host-build" \
  --source-packet "$GITHUB_WORKSPACE/materials/host-source-packet"

python3 recipes/offline-tests.py --target linux-x64 \
  --source "$RUNNER_TEMP/dsh-host-source" \
  --evidence "$RUNNER_TEMP/dsh-host-tests"
```

For the native macOS ARM64 runner use the same two commands with `--target darwin-arm64`. Cross compilation, architecture guessing, sysctl emulation, and transfer of Linux qualification to Darwin are refused. The Mac native gate requires a freshly built Mach-O ARM64 bundle and actual entry/flock execution; it makes no Linux Landlock claim. Linux runs the unchanged native payload test and launcher test with `NALR_REQUIRE_LANDLOCK=1`. The cloud development kernel currently returns ENOSYS for Landlock, so that strict local gate remains failed and requires actual supported-runner evidence.

A complete prepared Linux public-material index can support a fully offline rebuild:

```sh
python3 recipes/prepare-cold.py --target linux-x64 --offline \
  --source /absolute/new-source \
  --evidence /absolute/new-evidence \
  --source-packet /absolute/m3-source-packet \
  --materials /absolute/verified-public-materials \
  --expected-materials-sha256 CALLER_TRUSTED_MANIFEST_SHA256
```

TypeScript uses one ordered `--build --force` graph on every invocation. An earlier warm incremental emission reordered four inferred declaration unions; forcing the complete graph reproduced the cold emission without changing, dropping, or normalizing any artifact bytes.

The caller must pin MATERIALS.json independently. The recipe verifies every material file before use. Those materials contain the fixed public Git bundle, official raw Node/musl archives, public npm/pnpm dependency files and policy metadata, with no compiled Host or Home. The old material's source packet is not substituted for the separately pinned M3 packet. Offline metadata is Linux-specific; a Darwin offline cache has not been qualified.

The output `core-overlay` uses runtime-export format 2 with 74 source-built runtime packages and the 28 exact locked external versions. The selected 75 source packages also compile the unchanged SDK development client for tests; runtime distribution installs its CLI/SDK from the independently locked official launcher. Treating that SDK as an overlay root expands the graph to 289 packages, so it is deliberately excluded. This overlay alone does not install a Loader or GUI. Every new source/platform/compiler build has a new manifest identity; the original format 1 guards are unchanged.

Source identity separately binds all selected source files, exact source delta, public and bootstrap locks, and executed recipe snapshots. Native sources and build script remain exact public-baseline inputs. Artifact hashes and package graph bind the built result. The keyless fixtures mount the real Loader, AgentLoop, native handles, persistence, tools and strict provider with an offline SSE transport. Their finish/usage and stop assertions concern original activity and durable accounting; they do not establish real service cancellation or a model goal. M3 provides genuine one-level child creation and known same-id parent/child continuation, exact-original native archive controls, genuine blank-source archive, complete immutable delegate policy, and native-branded runtime-context settlement. UNKNOWN remains held and cannot reopen. Historical FULL plans require the exclusive sealed journal and exact opaque selector; user Continue reserves a new complete plan before the sole new start. Shared 15-work capacity belongs to the product, not the native source.

Retain upstream Harness MIT, native system BSD, vendor notices, musl COPYRIGHT and bundled notices, Node LICENSE, and applicable compiler-runtime licenses/exceptions in a distribution. The retained local compiler receipt does not identify every embedded libgcc/CRT object, so those contributions remain UNKNOWN rather than being asserted absent. Upstream notice facts do not establish private patch rights. The Linux musl addon is built and payload checked but has not been loaded with a musl Node runtime.

Source rows bind bytes and sizes, not every source POSIX mode. Git checkout preserves its executable bit only; runtime-export separately binds every actual output file mode for its target. Source packet inputs contain no node_modules, compiled Host payload, Home or historical session bytes. M0/M1/M2 identities are retained separately and do not qualify this M3 build.

A known restored child can continue after the same parent source has completed a newer original owned generation. That permission requires the actual retained activity token, exact current full binding, complete native receipt and latest sealed journal, and rereads the parent native history before child wire dispatch. Unowned or queued parent activity and UNKNOWN parent generations refuse continuation; the original g1 delegate lineage and zero-tool child policy remain unchanged.
