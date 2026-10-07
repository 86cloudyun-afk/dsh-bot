# First installation from thin v1 files

This installer builds a private local runtime from a caller-pinned thin bundle. The bundle contains the reviewed Bot package, installer/helpers, a Host overlay for the selected target, its 28 exact external registry snapshots, source identity/lock/source packet/recipe, notices and the official SDK lock. The complete official SDK is downloaded during installation; its installed bytes are not part of the thin bundle. Git and a previous SDK installation are not required.

Use exactly Node **24.19.0**, on **Linux x64** or **macOS arm64**, with that target present in the reviewed bundle. Other Node versions or platform/architecture pairs are refused before artifact reads, output creation or npm. Install Node and its ordinary public npm implementation first. Supply the canonical absolute path to npm's CommonJS `npm-cli.js`; for the qualified Linux image it is `/usr/local/lib/node_modules/npm/bin/npm-cli.js`. The installer captures that entry safely; npm resolves its public implementation modules from the supplied installation.

Obtain the descriptor's SHA-256 through an independent trusted channel. Computing a digest from an untrusted download alone does not establish trust. The descriptor pin binds every provided file required by the selected target, including installer/helper code. Resolve all paths to canonical absolute paths with no symbolic aliases. Choose an absent output directory whose existing parent is canonical and which is outside the bundle/npm inputs. The installer creates a fresh profile, work directory, Home, npm cache and configurations beneath that output.

Example, after placing a reviewed bundle at `/opt/dsh-bot-v1-thin` and creating the empty parent `/opt/dsh-bot-installations`:

```sh
node /opt/dsh-bot-v1-thin/scripts/install-v1.mjs \
  --bundle /opt/dsh-bot-v1-thin \
  --descriptor /opt/dsh-bot-v1-thin/thin-bundle.json \
  --descriptor-sha256 TRUSTED_DESCRIPTOR_SHA256 \
  --output /opt/dsh-bot-installations/my-bot-v1 \
  --npm-cli /usr/local/lib/node_modules/npm/bin/npm-cli.js \
  --npm-timeout-ms 120000
```

Replace `TRUSTED_DESCRIPTOR_SHA256` with the independently supplied 64-character lowercase digest. The timeout is optional, defaults to 120000 milliseconds, and must be between 1000 and 300000. Flags are explicit and unique. There is no installer flag that starts the CLI or enables models.

The sole child installation runs `npm ci --ignore-scripts --no-audit --no-fund` against `https://registry.npmjs.org/`, with strict TLS, a fresh empty cache, explicit empty user/global configs and the pinned SDK lock. Only PATH, LANG, standard proxy settings and safely copied public CA settings are inherited. Provider keys, NODE_OPTIONS, NPM_CONFIG settings and previous Home/config paths are excluded from that child. Lifecycle scripts, native probes and model requests are not executed during installation. npm's raw output is not forwarded; failures return bounded error categories.

Every failure after creating the installation directory preserves its contents. The installer never recursively deletes a failed installation. API errors and CLI diagnostics include `failurePreservation` with `state:PRESERVED_AFTER_FAILURE`, `automaticRecursiveDeletion:false` and the original directory's inode/device/mode, or null identity fields if initial capture failed. A replacement at the same pathname is preserved too. Ownership checks before further material writes, helper imports, assembly/profile calls and acceptance compare the original identity and private 0700 mode, including a fresh stat after the canonical-path await. These checks refuse observed replacement; they do not make asynchronous pathname operations atomic against another process with the same OS identity.

Delegated helpers execute the descriptor-pinned bytes captured during safe reads. Node's synchronous module hooks load these sources from a private virtual file-URL map rather than rereading helper pathnames. Reviewed relative imports resolve within the same captured map; undeclared imports are refused, and `node:` builtins retain their ordinary resolution. The hook is deregistered on success or failure. `helperExecution` in successful results records the source hashes, byte counts, modes, virtual URLs and derived mapping hash. The physical copied helpers remain pinned materials, not a fresh source of executable bytes.

After timeout the installer requests TERM, then KILL after 250 milliseconds, and allows at most 750 milliseconds from the start of stop confirmation. Continuation requires both the captured leader's exit and an OS query confirming its original process group is absent. A leader exit alone is insufficient. Destructive signals require the unchanged captured PID and a live original leader; there is no positive-PID fallback or signal to a different group. Replacing the output directory does not prevent stopping that original live child, and does not authorize writing to or deleting the replacement.

If stopping remains uncertain, the API rejects with `SDK_INSTALL_STOP_UNKNOWN` and the retained compatibility field `cleanupErrorCategory:SDK_CHILD_STOP_UNKNOWN`. The CLI prints that fixed category, `failurePreservation` and `stopConfirmation` containing the captured PID/group and original output inode/device/mode, then exits with status 1; its final diagnostic flush has a 100-millisecond bound. The output may still have an active npm writer. Retain it until independently confirming the captured process identity/group stopped. A recorded PID is evidence about that installation, not permission to signal a later process reusing the number. An unsuccessful installation has no accepted runtime/profile result. Choose another absent output for a new attempt; any later cleanup is an explicit external operation.

Success prints one JSON result and writes `installation-manifest.json` beneath the output. Both identify the descriptor, runtime manifest and packed product pins, target, Node version, original product source root/head/tree, fresh paths and `manualStartup`. The profile installs the supplied verified product export through the GUI helper; it does not require the original Git worktree. No previous Home, configuration, cache, ledger or credential file is copied.

To start later, use the executable, arguments and `DSH_HOME` from `manualStartup`. With the example output, the equivalent command is:

```sh
DSH_HOME=/opt/dsh-bot-installations/my-bot-v1/profile/home \
  node /opt/dsh-bot-installations/my-bot-v1/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile dsh-bot-gui --port 3080 --no-open
```

Model requests default to disabled. A later deliberate startup with the actual product flag `--enable-model-requests` changes that gate; installation never adds it. Credential information is only the environment reference `DEEPSEEK_API_KEY`. The installer reads, stores and prints no key value or auth token. Supply credentials through your chosen environment mechanism only when you deliberately start model-enabled use.

## Descriptor contract for bundle builders

The descriptor is JSON with this shape. Paths below illustrate layout; hashes, byte counts, modes, build ID and source/artifact pins must come from the final reviewed materials.

```json
{
  "format": 1,
  "classification": "DSH_BOT_V1_THIN_INSTALL_BUNDLE",
  "publicReleaseQualified": false,
  "runtime": {"nodeVersion": "24.19.0"},
  "officialSdk": {"lock": "sdk/package-lock.json", "cliVersion": "0.2.0-rc.2"},
  "product": {"manifest": "product/manifest.json", "archive": "product/dsh-bot.tgz", "buildId": "REVIEWED_BUILD_ID"},
  "registry": {"directory": "registry", "receipts": "registry-receipts.json"},
  "licenses": {
    "public": "licenses/host-MIT.txt",
    "native": "licenses/native-BSD.txt",
    "muslCopyright": "licenses/musl-1.2.5.COPYRIGHT.txt",
    "muslSourceNotices": "licenses/musl-1.2.5.source-notices.txt"
  },
  "tools": {
    "installer": "scripts/install-v1.mjs",
    "consumer": "scripts/assemble-distribution-runtime.mjs",
    "guiInstaller": "scripts/install-bot-gui-profile.mjs",
    "packageSnapshot": "scripts/package-snapshot.mjs",
    "runtimeExporter": "tools/runtime-export/export.mjs"
  },
  "targets": [{
    "id": "linux-x64", "platform": "linux", "arch": "x64",
    "overlayDirectory": "host/linux-x64/overlay",
    "sourceIdentity": "host/linux-x64/source-identity.json",
    "sourceLock": "host/linux-x64/pnpm-lock.yaml",
    "sourcePacket": "source/linux-x64/host-source.tgz",
    "buildRecipe": "source/linux-x64/build-host.mjs"
  }],
  "files": [{"path": "scripts/install-v1.mjs", "bytes": 0, "sha256": "ACTUAL_SHA256", "mode": 420, "target": "common"}]
}
```

`files` must contain the complete inventory, not the abbreviated example. Each unique record binds its relative canonical path, actual byte count, SHA-256, numeric Unix mode (0644 is 420; 0755 is 493) and `target`, which is `common` or a declared target ID. All five tools use the exact paths shown to retain relative imports. Their own code bytes, every selected overlay payload/manifest, the exact 28 tarballs/metadata/receipts, product tar/manifest, SDK lock and four complete notice files must be indexed. Product tar and manifest share a directory. The official lock is npm lockfile v3, pins `@deepseek-ai/dsh` to `0.2.0-rc.2`, and binds public registry resolutions and SRI. Host overlay format is 2 with 74 core peers and 28 external snapshots. The consumer retains the original executable payload bytes and creates one coherent core graph.

A macOS target has `id:"darwin-arm64"`, `platform:"darwin"` and `arch:"arm64"`, with its own source/artifact references and target-specific records. Only common and the actual host's target files are read or copied; an unselected target's files may be unavailable locally. Source packets and recipes are retained for provenance and rebuilding, and are never executed by this installer. Extra required recipe/source files belong in the inventory as well. Secret/configuration paths, traversal, symlinks and `node_modules` inputs are prohibited. The thin artifact must not include the complete downloaded SDK graph.

## Qualification gates

The implementation has synthetic filesystem/child and actual consumer/GUI integration tests. Final coherent product and Host generation pins, an independent review and a real first installation from thin files on a fresh OS remain required. A target appearing in the descriptor is not evidence that its native implementation has passed on that OS.

The locally assembled complete SDK graph is private qualified material. Public redistribution, modified-package rights, license/source-offer obligations and final closure auditing remain separate gates. MIT, native BSD and scoped musl notices preserve their respective original terms; unknown private patch rights remain unknown. `sandboxEnforcementVerified:false` is retained until native enforcement is independently demonstrated; filesystem tests and successful GUI installation do not establish that gate.
