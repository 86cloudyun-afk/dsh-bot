# Private first-install CI implementation plan

> The implementation steps below record the original af3f246 work. They are
> retained as historical context. Current concrete input source is `1f111d7f3f5c54127a7523571c8ebc1a738575b8`
> (tree `49ca850d8837da106996e9717fe30dfde5ae3039`, fresh build `0f63cb5c-7951-4cfc-bf95-28b21c7fac33`).
> Root reviews this input-only replacement before committing or pushing it;
> qualification requires the new candidate's own original execution receipts.

**Current goal:** Qualify the 1f111d7 final thin bundle on genuine Linux x64 and
macOS arm64 using a new installation and the documented viewing GUI.

**Unchanged architecture:** A Python extractor first checks externally pinned transport
and descriptor bytes and restores the descriptor's exact file modes. Small
Node tools install public browser prerequisites, invoke the captured reviewed
thin installer, independently reread the complete installed graph, and drive
stock Chromium through normal auth, Bot creation and a same-Home restart.

**Constraints:** Node 24.19.0; Playwright core 1.63.0 from a one-version public
lock; official npm, ignore-scripts and strict TLS; npm bounded at 120 seconds;
private push branch only, contents read, no credentials or provider requests;
fresh private Home/cache/output; failed outputs retained; upload only typed
redacted receipts and screenshots taken after the auth URL is clean.

The eleven operational first-install helpers/workflow remain byte-identical to
84de1f31. Only INPUT_PINS.json, the transport archive, README.md and the two
historical/current provenance documents are prepared for replacement. The
original implementation steps are retained below; this update does not rerun
or relabel their earlier test evidence.

1. Add ordinary pure Python transport fixtures. Verify a deterministic sorted
   regular-only tar retains the descriptor's original executable modes, rejects
   extra files or altered bytes, and refuses unfrozen pins before allocation.
   Implement that transport contract and repeat only the affected checks.
2. Add a small pure Node contract test for clean environment construction,
   typed error redaction and receipt schema. Implement shared canonical reads,
   bounded original-child handling and captured tool imports without importing
   any SDK or executing product source in these local tests.
3. Implement public browser preparation with fresh npm configs/cache and the
   original pinned CLI. Implement installation plus a complete source/product/
   runtime readback through the captured verifier and an independent file scan.
   Static checks only until Root authorizes execution.
4. Implement the stock GUI harness: printed auth link kept only in memory,
   unauthenticated 401, token exchange, clean URL/HttpOnly cookie, real GUI Bot
   creation, disabled model input, real user refresh and a cold same-Home
   restart with the same IDs. Count and refuse provider/external fetch requests.
   Use the normal Chromium sandbox on Mac; the allowed Linux runner exception
   is explicit in the receipt.
5. Validate workflow/YAML/bash/Node/Python syntax, ordinary local tests and
   closed actual bundle bytes/modes. Seal exact source/input hashes and all
   execution limits. Commit only this private draft branch; do not push it.

Review focus: self-manifest cannot authorize inputs; transport must preserve
original executable modes; captured helper bytes must be the executed
bytes; cleanup cannot delete failure output or chase replacement processes;
no upload can expose Home, auth links, tokens, cookies, logs, SDK or caches.
