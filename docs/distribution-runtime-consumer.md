# Pinned source-build distribution consumer

`scripts/assemble-distribution-runtime.mjs` consumes an explicitly trusted format 2 Host overlay. The existing format 1 `assemble-owner-runtime.mjs` and its captured contract fixture are unchanged. This consumer never labels the newly built payload as bytes built at the historical declared local HEAD.

The result is a **private GUI qualification runtime**, with the complete installed official SDK graph retained. It is not qualified for public distribution. Minimal dependency closure, private patch rights, license notices and applicable source-offer obligations remain release gates. In particular, retaining the whole SDK also retains dependencies such as LibreOffice/MPL and sharp/libvips/LGPL.

## Trusted inputs

Every path must be an explicit canonical absolute path. The overlay, source identity, official npm lock, two public license files and two musl notice files require caller-trusted SHA-256 pins. A supplied pin establishes the caller's chosen artifact identity; an internally consistent manifest alone cannot establish source/build trust.

File reads check canonical identity before opening an `O_NOFOLLOW` descriptor and compare inode, device, mode, size and modification/change times before and after reading. Package metadata decision bytes are bound to the original file hash/mode inventory and the later copy. Every trusted metadata reread, including closure, normalization, bin creation and final launcher/product checks, compares hash, length and the actual file mode before parsing. A changed name, version, publication declaration or mode cannot be accepted through a second, unrelated metadata read. Invalid JSON and unknown CLI exceptions report fixed categories without raw payload or parser messages.

The source identity's source-file index, file count and lock-object hash must match the pinned overlay. Its `declaredLocalHeadIsBuiltIdentity` must be `false`. The raw source lock must match the SHA-256 in that identity. Overlay verification runs with the trusted manifest pin before and after assembly, on the same platform and architecture. Each check creates a distinct, exclusive, owner-only temporary file view in the output's canonical parent. Only safely read, manifest-pinned bytes and modes enter that view; the shared overlay verifier reads that private view instead of caller-controlled input paths. The original manifest, full payload hashes/modes and complete file/directory set are checked again before accepting the verification result. Temporary views are retained on both success and failure; no asynchronous pathname check authorizes recursive removal. They are verification inputs outside the deliverable runtime inventory.

The current cold build pins are:

| Input | SHA-256 |
| --- | --- |
| Host format 2 manifest | `67f10c14ba778924a5d60481d97f01035612611397ad6eb994aee22364a2d7bc` |
| Source identity | `298948c3b5c83684eaacd9db2bf201e4d69e1137c21c17ccacc8742fb25bc170` |
| Source `pnpm-lock.yaml` | `67e847e73f1f0a16d38d9c414babacae6817bd74622c7ff534e07cb0b1336455` |
| Official `package-lock.json` | `75c5f79b1e3b7ee8bbbfcc2ef08fb8b62f2bcb4cc584f130f5088c81b4c5ed1a` |
| Public baseline root MIT license | `ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be` |
| Public `native/system` BSD license | `fed2134d7f6af959ff9fbf2c0a35ea747db10e21d1b5d2d1ac58be88ce43ad90` |
| musl 1.2.5 complete COPYRIGHT | `f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af` |
| Additional musl 1.2.5 source notices | `ca56b73cb9410ba6f1aaf44c51425854b4731c3a1b20d20dc34f152008517b6d` |

The audited musl source tarball SHA-256 is `a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4`, matching the frozen Host build's recorded public input. The COPYRIGHT file was independently compared byte-for-byte with that archive's `musl-1.2.5/COPYRIGHT`; the additional notice text and source index are retained under the release audit's `native-input-licenses`. Notice pins authenticate these input texts, not private patch rights.

This manifest contains 74 core packages, 28 external locked snapshots and 1,013 payload files. Its source index binds 4,046 source files. The public baseline is `639ed015397290b3745d163aafe02ffee4aa3f84`; source material and supplement are `616b511b4358dd7c173601816fc1f79f92f2a010`. The historical local HEAD `3fbedc25d3626caf4e401b14c31a7f0326a19ec7` is a declaration, not the new build identity. Private patch rights remain `UNKNOWN`.

The official launcher must be exactly `@deepseek-ai/dsh@0.2.0-rc.2`, with that exact root dependency in the pinned npm v3 lock. Installed public package names and versions must match their lock entries. Only HTTPS `registry.npmjs.org` package provenance is accepted. The consumer records every copied public file's original hash and mode plus the npm lock's URL and SRI. This consumer does **not** compare already-installed official package files against raw registry tarballs. A successful prior `npm ci --ignore-scripts` is separate installation evidence; its lock SRI alone is not proof that current installed bytes equal registry bytes.

## Offline assembly

The output must be absent, have a canonical parent and sit outside every input, without enclosing an input. Use a fresh output path for each source/product generation:

```sh
node scripts/assemble-distribution-runtime.mjs \
  --official /workspace/dsh-bot-current \
  --official-lock /workspace/dsh-bot-current/package-lock.json \
  --official-lock-sha256 75c5f79b1e3b7ee8bbbfcc2ef08fb8b62f2bcb4cc584f130f5088c81b4c5ed1a \
  --overlay /workspace/dsh-v1-evidence/host-build/core-overlay \
  --manifest-sha256 67f10c14ba778924a5d60481d97f01035612611397ad6eb994aee22364a2d7bc \
  --source-identity /workspace/dsh-v1-evidence/host-build/source-identity.json \
  --source-identity-sha256 298948c3b5c83684eaacd9db2bf201e4d69e1137c21c17ccacc8742fb25bc170 \
  --source-lock /workspace/dsh-host-v1/pnpm-lock.yaml \
  --registry /workspace/dsh-v1-evidence/host-build/runtime-registry \
  --receipts /workspace/dsh-v1-evidence/host-build/runtime-registry-receipts.json \
  --product /workspace/dsh-bot-current \
  --public-license /workspace/dsh-host-v1/LICENSE \
  --public-license-sha256 ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be \
  --native-license /workspace/dsh-host-v1/native/system/LICENSE \
  --native-license-sha256 fed2134d7f6af959ff9fbf2c0a35ea747db10e21d1b5d2d1ac58be88ce43ad90 \
  --musl-copyright /workspace/dsh-v1-evidence/release-audit/native-input-licenses/musl-1.2.5.COPYRIGHT.txt \
  --musl-copyright-sha256 f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  --musl-source-notices /workspace/dsh-v1-evidence/release-audit/native-input-licenses/musl-1.2.5.source-notices.txt \
  --musl-source-notices-sha256 ca56b73cb9410ba6f1aaf44c51425854b4731c3a1b20d20dc34f152008517b6d \
  --output /workspace/dsh-v1-runtime-new
```

The function API is `assembleDistributionRuntime(options)` with the corresponding camel-case keys visible in the CLI flag map. It returns the runtime directory, launcher path, receipt path, receipt SHA-256, directory inode/device ownership and parsed receipt. The launcher is `<output>/node_modules/.bin/dsh`.

The implementation copies public installed packages listed in the official lock, then overlays only files enumerated by the Host manifest. Source `node_modules` links are never traversed or copied. Product input is confined to `package.json` and the package's explicit publication `files`, including nested GUI assets and `cordis.patch.yml`. Prohibited publication declarations such as `.env`, `.aws` and `Home` are rejected before traversing any selected directory or reading any selected file. Product/source Home, configuration, environment files, caches, ledgers and credentials are not copied.

Each external raw registry tarball is checked against both the trusted Host manifest SRI and registry metadata SRI, plus the receipt's raw hash/length. Metadata, tarball identity, tar member paths, file modes and all extracted payload files are checked. Traversal, symlinks, hardlinks, special files, embedded `node_modules` and duplicate archive file paths are refused. Extraction does not execute scripts; koffi's install script is also not executed.

External packages occupy version-specific stores beneath `node_modules/.dsh-external`. Every core external dependency resolves via the **exact** source lock importer binding for its `sourcePath`; every external transitive binding uses the exported lock snapshot. No semver resolver chooses a new version. Thus Host `js-yaml@4.2.0` and `4.3.1` can coexist while the official GUI retains its separate `4.3.2`; Host NARB `0.1.6` can coexist with the official `0.1.7`. All core packages, including Cordis/Agent/Llm, occupy the same physical root and have no duplicate core instances.

Only package metadata is normalized. Workspace ranges resolve to the selected core version, and platform-skipped optional workspace dependencies are removed with an explicit record. Unresolved development-only workspace ranges are recorded. Original and final metadata hashes are retained; executable bytes and all file modes must match their original inputs. After copying, the complete output payload is compared with the original copy inventory, allowing only recorded metadata edits. Metadata dependency closure and exact locked bindings are then verified.

`NOTICES.txt` carries the complete caller-pinned public root MIT and native/system BSD text, preserving their separate public source scopes. It also carries the complete musl 1.2.5 COPYRIGHT and additional source notice text, limited to included compiled musl/libc portions. Additional notices are conservatively retained without asserting that every function or architecture listed is embedded. Package-local notices remain intact. The native entry's existing MIT fallback metadata is not turned into a dual-license claim. Rights for every modified package/private patch remain `UNKNOWN`. No sandbox enforcement success is asserted: the current host's Landlock syscall reports `ENOSYS`.

## Receipt and verification

`distribution-runtime-manifest.json` records original inputs and hashes, source/build identity, public lock provenance, external SRI/bytes, exact dependency bindings, metadata edits, product publication files, final package identities, notices, and the full final file/hash/mode/directory/symlink inventory. Its private release qualification is explicit. Save the returned SHA-256 as the trusted receipt pin before verification:

```js
import { verifyDistributionRuntime } from './scripts/assemble-distribution-runtime.mjs';
await verifyDistributionRuntime({
  directory: '/absolute/new/runtime',
  expectedManifestSha256: '<caller-trusted receipt SHA-256>',
});
```

Verification detects missing, extra, changed or remoded files, changed links, link escape, dependency closure changes and incorrect dependency bindings. It checks every final package name/version against the locked official, overlay, external or product identity, and checks the launcher's product version and product publication declaration. Receipts created before these explicit identity fields existed fail the new verification contract; their frozen runtime directories are never migrated in place. It validates the assembled runtime; it does not promote historical source declarations or private rights into public-release assertions.

Existing caller output is refused before assembly. A failed newly created output is retained; the consumer never recursively removes output directories. Captured owner-only verification views are also retained on success and failure, outside the runtime file inventory. They may occupy space until explicitly removed after inspecting the paths. An asynchronous inode/device check cannot make a later pathname removal atomic, so it is not used to authorize cleanup. Source-built core packages are selected before copying, which also avoids copying and deleting their public counterparts. These rules do not provide a general guarantee against hostile concurrent filesystem writers.

## Verification commands

```sh
node --test scripts/assemble-distribution-runtime.test.mjs
node --test tools/runtime-export/export.test.mjs
npm test
```

The tests use real private temporary directories, registry tarballs and module resolution. They cover exact executable bytes/modes, two dependency versions, stock public graph retention, trusted pins, source/lock/index binding, registry metadata/raw integrity, archive traversal, platform rejection, publication symlink refusal, failed-output retention and existing caller output preservation. Synthetic instrumentation observes actual pathname/descriptor reads and canonical checks, mutating only owned fixtures. Regressions prove linked outside targets and protected publication paths are never read, first-read version drift and later mode drift are refused, delegated reads use private views, original source bytes/modes/extra files are still rechecked, final identities are enforced, and replaced output or verification-view directories are preserved. Two regressions replace real fixture directories after all earlier ownership checks and before a recursive filesystem removal; the repaired consumer makes no such removal. Complete musl notice inclusion and notice pins are also tested.

The unchanged `npm test` runner enables Node's permission model with scoped filesystem access. Node refuses `fs.symlink` under scoped permissions even when source and target are inside the allowed temporary root; it requires unrestricted fs.read/fs.write. Therefore run this filesystem suite using the direct `node --test` command above. The normal existing project suite remains separate. No network or model operation is used by these tests or by the assembler. A launcher `--help` smoke test verifies only CLI launch/help behavior, not model, GUI acceptance or native sandbox enforcement.
