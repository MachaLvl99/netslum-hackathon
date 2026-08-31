# Codex Desktop Acceptance Checklist

Run this in the **latest ChatGPT desktop app (Sol or Terra) on macOS or Windows**
with **Settings → Browser → Permissions → Enable site tools** turned ON.
Open `https://netslum.macha.sh` in the built-in browser.
Chrome or Playwright is *not* acceptance — the WebMCP surface only exists in
the desktop in-app browser.

The authenticated steps use the operator account
(`macha.pds.netslum.macha.sh`, did:plc:qsuk7zdyihamw2wdmpgq47ad).

## 1. Tool surface

- [ ] Before sign-in, available site tools list **exactly**:
      `show_town_square`, `open_chaos_gate`, `show_profile`.
- [ ] After sign-in (via "sign in" → AT Protocol OAuth), the list grows to 12:
      the 3 public plus `prepare_post`, `publish_prepared_post`, `react_to_post`,
      `mutate_zone`, `open_site_editor`, `read_site_file`, `save_site_file`,
      `delete_site_file`, `publish_site`.
- [ ] Open a published page (`https://netslum.macha.sh/@macha`). No authored-page
      iframe tool appears (the sandbox iframe cannot register tools).
- [ ] Disable site tools in settings → the flows below still work through the
      visible controls (progressive enhancement).

## 2. Zone + town flow

- [ ] Ask Codex: "Open `hidden.archive.echo`." The visible route changes to
      `/zone/hidden.archive.echo` and the deterministic canvas scene appears.
- [ ] Ask Codex: "Place a note saying hello slum." The note appears in the
      semantic object list and on the scene; the tool result reports the new
      zone `version`.
- [ ] Ask Codex: "Show the town square." Route changes to `/town`; tool result
      posts match the visible feed (same AT URIs).
- [ ] Reload the zone in the same browser. Same objects, same scene
      (SHA-256 seeded — every traveler sees the same space).

## 3. Two-phase post publishing

- [ ] Ask Codex: "Draft `hello slum` but do not publish." The composer text
      changes and **no** PDS record exists yet
      (check `https://pds.netslum.macha.sh/xrpc/com.atproto.repo.listRecords?repo=did:plc:qsuk7zdyihamw2wdmpgq47ad&collection=app.bsky.feed.post`).
- [ ] Ask Codex to publish that exact draft. Exactly one record appears with
      rkey `netslum-<24 hex>` and text ending `#netslum`.
- [ ] Ask Codex to publish the same draft revision again → `STALE_REVISION`.

## 4. Site studio flow

- [ ] Ask Codex: "Read `index.html` in bounded chunks." Results stay under
      1000 chars per call with `nextOffset` continuation.
- [ ] Ask Codex to save a changed draft (e.g. add a line) → tool returns the new
      `revision`; the visible Studio editor shows it. The public
      `/@macha` page still serves the **old** revision.
- [ ] Ask Codex to preview and then publish that revision → result URL is
      `https://netslum.macha.sh/@macha`; the page now shows the new revision
      (shell header shows the new `rev:` prefix).
- [ ] Publishing the same revision again succeeds idempotently (same AT record
      collection/rkey, updated CID).

## 5. Cancellation and logout

- [ ] Start a deliberately slow read (a large file chunk), then cancel in the
      Codex UI — the pending fetch aborts (no result posted).
- [ ] Log out → authenticated tools disappear from the tool list and any
      lingering invocation returns `AUTH_REQUIRED`.

## 6. Security probes (spot checks)

- [ ] On `/@macha`, view-source the iframe: `sandbox="allow-scripts"` only,
      CSP meta `default-src 'none'`, opaque origin (`about:srcdoc`).
- [ ] The published page's scripts cannot touch `window.parent`, cookies,
      storage, or top navigation (already browser-verified; re-confirm visually).

## Record results

Note pass/fail per item with the Codex model version and desktop app version.
Any failure: capture the tool result JSON (it contains only stable error codes,
never stack traces or tokens).
