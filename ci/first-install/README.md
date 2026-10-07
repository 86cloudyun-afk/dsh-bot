# Private fresh first installation

This draft starts from exact product commit
`af3f246c4157f2489215fc1de034704d86109a17` and tree
`501c2b0a3beda8b91eec33b9be6050e66ac45582`. It has not run an SDK
installation, Chromium, a native GUI or a provider. Root must review the
exact draft and external inputs before its private branch is pushed.

The workflow accepts only a push to `ci/first-install-v1-20261007` in a
private repository, checks the genuine checkout HEAD against `github.sha`,
uses read-only repository permission, and has no secret inputs. Actual
Linux x64 or macOS arm64 and Node 24.19.0 are checked independently. The
Mac job is a new hosted environment, separate from the denied local Mac
probe; this tooling invokes no sysctl, quarantine override or hardware
probe command.

`INPUT_PINS.json` binds Root's new final thin transport, descriptor and
af3 source provenance. The 15,541,555-byte gzip archive has externally
supplied SHA-256 `f5d80350c18d13a1145ca1291f4c01add8558ae77ede5bae3916d6b3e4051818`.
Its descriptor has externally supplied SHA-256
`406e8bda96ff04d07cce613fd6209f3626ef8caeaae75845e9aba74acdf0d675`.
Neither pin is inferred from the archive's self-manifest. The extractor
accepts exactly 2,369 sorted regular members, raw bundle-relative names,
zero timestamps/owner metadata and no links, special files, PAX headers
or directory entries. It checks a closed file set and all bytes/modes:
2,363 files are 0600, four are 0700 and two are 0755. Files are safely
opened with O_NOFOLLOW and created O_EXCL in a new canonical 0700 root.
Directories are newly created 0700 and their set is checked. Git stores
the outer archive as an ordinary source blob; the inner recorded modes
are validated rather than inferred from Git checkout permissions.

Each hosted job creates an unrelated Home, temporary directories, npm
configs/caches, browser cache and browser user-data directory. It has no
prior installed runtime or source `node_modules` input. Official Node
binary hashes are pinned separately for the two actual targets. Public
Playwright core 1.63.0 is installed from the checked-in one-version lock
with its public npm SRI, ignore-scripts, strict TLS and a 120-second npm
bound. Its original CLI installs ordinary Linux dependencies and downloads
Chromium; no alternate download host or TLS bypass is configured. Linux
Chinese fonts are installed as normal system prerequisites. Stock Mac
Chromium uses its normal sandbox. The allowed Linux runner `--no-sandbox`
exception applies only to the QA browser and is reported explicitly; it
is not a product sandbox qualification.

Installation executes only the five descriptor-pinned tool sources
captured during stable canonical reads. The initial installer import
also uses captured bytes. The reviewed install-v10 entry receives public
npm's canonical CommonJS path, a new absent output, the external
descriptor pin and the 120-second timeout. Its existing exact original
child stop and UNKNOWN handling remain intact. The installer constructs
its own empty npm configs, Home and cache, uses the official SDK lock,
ignore-scripts and strict TLS, then assembles one complete runtime and
the unchanged documented GUI profile. No model key is inherited.

`install.mjs` independently rereads the complete runtime file/dir/link
inventory, exact metadata and dependency bindings, the original public
SDK file inventory, all thin bundle and selected copied material bytes
and modes, the full product archive/files, both installed product copies,
same-runtime dependency view, M3 4,074-source index, identity/lock/packet,
and generated default profile. This happens before and after GUI use.
Public installed SDK files are pinned by fresh npm lock/SRI provenance
and a full installed inventory, not compared individually to public raw
tarballs. Source-packet bytes and the source index are checked; this job
does not rebuild Host or make a cross-compiler byte claim.

The GUI harness launches the documented official CLI, unchanged profile
and newly installed graph. A QA preload counts and refuses external
fetch/http/socket calls; browser HTTP requests outside the local origin
are also counted and refused. The printed auth link exists only in
bounded memory. Stock Chromium first receives a real 401, exchanges the
printed token, retains a persistent HttpOnly cookie at a clean URL, then
clicks the real Create button once and awaits genuine asynchronous
bootstrap. It verifies the default disabled model input and uses the
actual user refresh control. An uncertain Create is never replayed.
A new CLI process reads the same newly created Home after the original
process and group are confirmed stopped. The original ledger, Bot and
main Session IDs and cookie must survive. Two clean-URL screenshots and
a typed receipt are the only GUI uploads.

Uploads are limited to `receipts/*.json` and `screenshots/*.png`. The
receipt writer rejects sensitive fields, absolute paths and URLs. No
Home, cookies, auth link/token, raw process log, source, SDK, cache or
browser profile is uploaded. Exceptions produce fixed redacted error
categories. Failure output is retained, including an uncertain original
writer; this tooling contains no automatic output deletion. Paths are
trusted exclusive installation paths. Inode checks do not support
concurrent same-UID mutation or establish atomic pathname writes.

Local verification is limited to ordinary pure transport/common tests
and Python/Node/YAML/bash syntax/static checks. Actual installer, browser,
auth, native create/restart, Mac first-install, model or task qualification
remain unexecuted here. A successful viewing receipt would establish only
these documented basic checks, not submit/continue/delegation correctness,
provider authorization, Landlock enforcement or public-release rights.

```sh
python3 -B ci/first-install/transport.test.py
node --test-isolation=none --test ci/first-install/common.test.mjs
```
