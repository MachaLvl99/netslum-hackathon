# netslum code map — app, host, and edit orientation

## Context

An interpretive map of the netslum monorepo: what each chunk of code that
manages the **actual app/website** and the **host** does, so you can begin
manual edits with a mental model instead of guesswork.

The repo is a pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`,
`workers/*`), Node 24, TypeScript 5.9, Vitest + Playwright gates (`pnpm check`,
`pnpm test`, `pnpm test:e2e`). netslum is an agent-first social platform:
humans direct Codex agents through WebMCP site tools; AT Protocol identities
collaborate; accounts on a local Tranquil PDS publish sandboxed personal pages
at `/@slug`.

## Architecture at a glance

Three deployables + two shared packages + one vendored service:

```
Browser ─► apps/lynx  (ReactLynx UI bundle, the visible "app")
             │ served & API-backed by
             ▼
         apps/web     (Hono Cloudflare Worker: netslum.macha.sh — the "host"
                      proper: OAuth, sessions, D1, R2, ZoneRoom DO, serves
                      the Lynx bundle)
             │ AT Protocol                    assets/runtime (workers.dev)
             ▼                                    ▼
      infra/tranquil (PDS)            workers/site-runtime (3 workers:
                                        assets proxy, tenant dispatcher,
                                        egress blocker)
      packages/contracts (Zod schemas + lexicon) · packages/sandbox (parse5
      HTML rewriter for published pages)
```

## apps/lynx — the visible app (ReactLynx UI)

This is the **front-end the user sees**. It's a ReactLynx app — React components
compiled into a Lynx runtime (a cross-platform UI engine, think React Native but
for web/mobile via a `<lynx-view>` custom element). The critical mental model:

> **Two-world split.** The UI views (App.tsx + views/) run *inside* a sandboxed
> `<lynx-view>`. They **never fetch data themselves**. All data flows down from
> the **trusted host page** (`host.ts`), which runs as plain DOM JavaScript
> *outside* the Lynx sandbox and owns routing, API calls, WebSockets, canvas,
> and iframes.

### Entry & bootstrap

| File | What it does |
|---|---|
| `src/index.tsx` | 4 lines — `root.render(<App/>)`, imports `styles.css`. The Lynx entry point. |
| `lynx.config.ts` | rspeedy bundler config. Entry = `src/index.tsx`, output = `dist/main.web.bundle`. |
| `scripts/build-host.mjs` | esbuild-bundles `src/host.ts` → `dist/host.js`; copies the `@lynx-js/web-core` engine (WASM + JS) into `dist/`; patches `client.js`'s iframe handshake so the Blob-URL bridge works. |
| `package.json` | `build` = `rspeedy build && node scripts/build-host.mjs`. Output lands in `apps/lynx/dist/` — the web Worker serves `host.js` as the page and `main.web.bundle` as the Lynx UI payload. |

### host.ts — the trusted host page (~1506 lines, the "brain")

This is the **most important file for understanding the app**. It's a plain-DOM
script that the browser runs directly (not inside Lynx). It:

1. **Creates the `<lynx-view>`** on `#lynx-host` and injects the NativeModules
   bridge as a Blob URL — this is how views call back to the host.
2. **Owns the router** — `navigate()` / `syncRoute()` / `popstate` listener,
   all using the History API. Each route change triggers `loadRouteData()`.
3. **Pushes data down** to the Lynx view via `view.updateData(json)` — the
   views receive this through `useInitData` / `useInitDataChanged` hooks.
4. **Handles ~28 native calls** from views (e.g. `postMessage`, `followUser`,
   `placeZoneNote`) — each dispatches a `fetch` to `/api/*` with CSRF headers.
5. **Manages live updates** — 10-second polling for town feed on `/` and
   `/town`; WebSocket to `/api/zones/{key}/socket` on zone routes.
6. **Draws the zone canvas** — a `<canvas>` behind the Lynx view, rendered by
   `scene.ts` (deterministic from SHA-256 of zone key).
7. **Mounts iframes** for authored home pages, districts, and studio preview.
8. **Registers WebMCP tools** (via `webmcp.ts`) per route, with AbortController
   lifecycle.
9. **Trust boundary** — listens for `netslum:trustedAction` postMessages from
   tenant site iframes; shows a confirm sheet before executing (like/follow/reply).
10. **HLS video** — lazy-loads HLS.js on first `playVideo` native call; reuses
    the loader thereafter.
11. **Tenant tool registration** — fetches `webmcp.json` manifests from
    published sites and registers tools as `site.<slug>.<name>`.

### App.tsx — the UI root (~512 lines, state hub)

Lives inside the Lynx sandbox. Receives all data from the host as JSON strings
via `useInitDataChanged`. Holds UI state (drafts, search results, thread,
DMs, notifications). Routes views with a **flat if/else chain on `data.route`**:

| Route pattern | View component | What it shows |
|---|---|---|
| `/` | `HomeView` | Server chips (Δ Θ Λ Σ Ω α), 3-keyword Chaos Gate entry, composer, feed |
| `/town` | `TownView` | Split world/feed panes, portal grid, composer, feed |
| `/gate` or `/zone/{key}` | `ZoneView` | Zone title, district portals, warp gates, notes grid, note composer |
| `/district/{slug}` | `DistrictView` | Header bar + exit; actual content is a host-mounted iframe |
| `/studio` | `StudioView` | Render-only; host mounts live/preview iframe for site editing |
| `/timeline` | `TimelineView` | Thin FeedList wrapper (deprecated) |
| `/notifications` | `NotificationsView` | Notification list + "mark all seen" |
| `/messages[/...]` | `MessagesView` | Two-pane inbox/requests, composer, emoji reactions, accept/mute |
| `/search` | `SearchView` | Tabs: posts / actors / feeds |
| `/profile/{actor}` | `ProfileView` | Identity card, follow/mute/block, own-profile edit, avatar upload |
| `/post/{uri}` | `ThreadView` | Parent/root/replies, like & repost, reply composer |
| `/settings` | `SettingsView` | DM agent toggle, privacy, home mode, capabilities, sign-out |
| fallback | `NotFoundView` | 404 + link home |

Shared helpers: `FeedList.tsx` (reusable post-card list), `PostEmbeds.tsx`
(image grids, video via `NativeModules.playVideo` → host HLS overlay),
`types.ts` (the `InitData` wire contract + domain types like `PostItem`,
`ZoneObject`, `FEATURED_ZONES`, `SERVER_LETTERS`).

### webmcp.ts — agent tool surface

`registerNetslumTools(navigate, session, signal)` — registers ~38 tools on
`document.modelContext` for Codex/ChatGPT desktop agents. 3 public tools
(`show_town_square`, `open_chaos_gate`, `show_profile`); the rest are
auth-gated (posts, zones, search, graph, DMs, sites/studio, home settings).
Each tool navigates the UI, fetches with Zod-validated input from
`@netslum/contracts`, and returns `ToolResult`.

### scene.ts — deterministic zone canvas

Pure function: `zoneKeySeed` = SHA-256(zoneKey) → mulberry32 PRNG →
`sceneParamsFromSeed` (palette shuffle, density, glow, grid) →
`renderZoneScene` (background wash, glow, starfield, grid, scanlines,
note/sigil/portal glyphs). Same key = identical pixels across clients.

### styles.css — theme conventions

"Paradise" theme: monochrome black (`#0d0d0d` bg, `#141414`/`#1b1b1b` panels)
+ green accent `#49D049` (CSS vars `--cyan`/`--violet`/`--magenta` all aliased
to `--green`). Fonts: BBHSansHegarty (display), Orbitron (nav), Rajdhani
(body). Class naming: kebab-case (`post-card`, `primary-sm`, `mode-tab`),
state suffixes `.active`/`.busy`.

### Key invariant for manual edits

- Views **never fetch**. All data via InitData JSON strings from host.
- Any new native method must be added in **three places**: App.tsx (declare),
  host.ts bridge Blob module (expose), host.ts `nativeModulesCall` (dispatch).
- `scene.ts` must remain a pure function of `(zoneKey, objects, size)`.
- `build-host.mjs`'s handshake patch is load-bearing for the Blob-URL bridge.

## apps/web — the host Worker (Hono on Cloudflare)

This is the **entire backend** — a single Cloudflare Worker using the Hono
framework. It serves the Lynx bundle, handles OAuth, exposes the API, and
coordinates with D1 (SQL), R2 (object storage), a Durable Object (ZoneRoom),
and the AT Protocol PDS. Deployed to `netslum.macha.sh`.

### Entry: worker.ts (~1156 lines)

Global middleware: security headers (`Permissions-Policy: tools=(self)`,
`nosniff`, `X-Frame-Options: DENY`), error handler (ZodError→400,
NetslumError→its status code, else 500).

**The route table** (auth: P=public, A=authenticated read, M=mutation+CSRF):

#### Static / OAuth / session

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/health` | P | `{ok:true}` |
| GET | `/main.web.bundle`, `/host.js`, `/static/*`, `/binary/*`, `/decodeWorker/*`, `/common/*`, `/constants.js`, `/wasm.js` | P | ASSETS binding proxy, 5-min cache |
| GET | `/oauth-client-metadata.json`, `/.well-known/jwks.json` | P | OAuth client metadata/JWKS |
| GET | `/oauth/login` | P | Normalize handle → PDS, `client.authorize`, 302 redirect |
| GET | `/oauth/callback` | P | `client.callback` → `issueWebSession` → Set-Cookie → 302 `/` |
| GET | `/api/session` | P (soft) | Returns `{did, handle, canPublishSite, capabilities}` |
| POST | `/api/auth/logout` | M | Revoke OAuth grant, delete D1 rows, clear cookies |

#### Social (feed, posts, reactions, graph)

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/feed` | P | `AtprotoService.getTownFeed` (D1 `feed_cache`) |
| GET | `/api/feed/custom` | A | Custom feed endpoint (saved feed generator) |
| GET | `/api/timeline` | A | `AtprotoService.getTimeline` |
| GET | `/api/post-thread` | A | `AtprotoService.getPostThread` |
| PUT | `/api/post-draft` | M | `AtprotoService.preparePost` |
| POST | `/api/posts/publish` | M | `AtprotoService.publishPreparedPost` |
| DELETE | `/api/posts/:uri` | M | Own-post delete only |
| POST | `/api/reactions` | M | `AtprotoService.reactToPost` (like/unlike/repost/unrepost) |
| POST | `/api/graph/follow\|block\|mute` | M | `GraphService` set state |
| POST | `/api/graph/resolve` | M | Actor resolution (DID ↔ handle) |
| POST | `/api/moderation/report` | M | `GraphService.reportContent` |
| GET | `/api/profile/:actor` | A soft | `AtprotoService.getProfile` + active site slug |
| PUT | `/api/profile` | M | `AtprotoService.updateOwnProfile` |
| POST | `/api/profile/avatar` | M | Upload blob + update profile (≤1MB) |
| GET | `/api/search/posts\|actors\|feeds` | A soft | Search endpoints |
| GET | `/api/notifications` | A | `AtprotoService.getNotifications` |
| POST | `/api/notifications/seen` | M | Mark notifications seen |
| GET | `/api/author-feed`, `/api/post-engagement` | A soft | Per-actor feed, engagement |
| GET/POST/DEL | `/api/feeds/saved` | A/M/M | Saved feed CRUD |

#### DMs

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/dms/status\|conversations\|requests\|messages` | A | `ChatService` reads |
| GET | `/api/dms/conversation` | A | Single-conversation lookup by members |
| POST | `/api/dms/start\|prepare\|send\|read\|react\|delete-for-self\|delete\|accept\|mute` | M | `ChatService` + `DmDraftService` (idempotent send-once) |

#### Media

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/api/media/image/prepare\|upload` | M | `MediaService` image pipeline |
| POST | `/api/media/image/:draftId` | M | Alternate image upload by draft ID |
| POST | `/api/media/video/prepare\|chunk\|complete` | M | `MediaService` chunked video |
| GET | `/api/media/video/status` | A | Job status |

#### Zones (Durable Object)

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/zones/:zoneKey` | P | Proxy to ZoneRoom DO → snapshot |
| GET | `/api/zones/:zoneKey/socket` | P | WebSocket upgrade to DO |
| POST | `/api/zones/:zoneKey/mutations` | M | Validate, set `X-Netslum-Actor`, proxy to DO |

#### Sites (publish pipeline)

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/sites/draft` | A soft | `SiteService.getDraft` |
| GET/PUT/DEL | `/api/sites/file` | A/M/M | Read/save/delete draft file |
| POST | `/api/sites/preview-session` | M | Create 10-min preview capability |
| POST | `/api/sites/publish` | M | 9-stage publish pipeline (see below) |
| GET | `/api/sites/manifest` | P/A | R2 read of `webmcp.json` from release |
| GET | `/api/sites/preview/:revision/*` | A | Authenticated draft preview (direct serve) |
| POST | `/api/__webmcp/:slug/:tool` | P (gated) | Tenant tool dispatch via service binding |
| GET | `/@<slug>` | P | Vanity shell: iframe to `<slug>.sites.netslum.macha.sh` (regex param `/:vanity{@[a-z0-9]...}`) |
| GET | `/district/:slug` | P | Trusted district shell iframe |

#### Admin

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/api/admin/sites/suspend` | M | Admin-only site suspension (DID gated via `SITE_ADMIN_DIDS`) |
| POST | `/api/admin/sites/restore` | M | Admin-only site restoration |

#### Settings & Home

| Method | Path | Auth | Handler |
|---|---|---|---|
| PUT | `/api/settings/dm-agent` | M | Toggle `dm_agent_enabled` |
| GET/PUT | `/api/settings/chat-declaration` | A/M | Chat privacy declaration |
| GET/PUT | `/api/home/settings` | A/M | Home mode (standard/authored) |
| GET | `/api/home/mount` | A soft | Authored-home mount info or "standard" |
| GET | `/api/home/bridge/:view` | P | Public AT reads for tenant bridge |

#### Catch-all

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `*` | P | SPA shell HTML: `#lynx-host`, loads `/static/js/client.js` + `/host.js` |

### Server modules (apps/web/src/server/)

| Module | File(s) | Role |
|---|---|---|
| **auth/session.ts** | Web session lifecycle over D1 `web_session`. `issueWebSession` (cookie + CSRF), `authenticateRequest` (expiry + scope + CSRF/origin checks), `logout` (revoke + delete + clear), `canPublishSite` (local-PDS gate), `resolveDidDocument` (DID doc resolver with cache), `sessionCapabilities` (derives `reauthorizeRequired`/`canUseDms`/`canUploadVideo`). |
| **auth/oauth.ts** | ATProto OAuth client (private_key_jwt, DPoP, ES256). WeakMap-cached per env. AES-GCM encrypted payloads in `oauth_state`/`oauth_session` D1 tables. |
| **auth/permissions.ts** | Scope catalog. `OAUTH_SCOPE_VERSION=3`, `PHASE2_OAUTH_SCOPE` (atproto + repo + blob + rpc scopes), `LEGACY_OAUTH_SCOPE`, `grantedScopeContainsRequired`, `VIDEO_SERVICE_AUDIENCE`, `APPVIEW_METHODS`, `CHAT_METHODS`, `VIDEO_METHODS`. Drives `REAUTHORIZE_REQUIRED` 403 on stale grants. |
| **auth/crypto.ts** | `encryptJson`/`decryptJson` (AES-256-GCM), `randomToken` (32 bytes), `hashToken` (SHA-256). |
| **social/AtprotoService.ts** | Bluesky/ATProto facade (~921 lines). Anonymous Agent for public reads, OAuth-proxied Agent for user ops. D1 `feed_cache`. Prepare/publish post drafts, reactions, profile CRUD, timeline, thread, notifications, search, saved feeds, `mergeTownPosts`, `getLocalPdsPosts`. |
| **social/ChatService.ts** | Proxies `chat.bsky.convo.*` DM operations through the user's OAuth chat grant via `did:web:api.bsky.chat#bsky_chat`. Methods: getStatus, listConversations, listRequests, getConvoForMembers, getMessages, sendMessage, updateRead, react (add/remove emoji), deleteMessageForSelf, acceptConvo, setMuteState, ensureDeclaration, updateDeclaration. No message bodies stored locally. |
| **social/GraphService.ts** | Social graph: follow/block (PDS repo records), mute (AppView RPC), `resolveActor`, `getRelationships`, moderation report, search actors. |
| **social/DmDraftService.ts** | Encrypted pending DM drafts in `dm_draft` table — prepare/load/consume for idempotent send-once. 10-min TTL. Uses `PRIVATE_DATA_KEY` via encryptJson/decryptJson. |
| **zones/ZoneRoom.ts** | **Durable Object** (one per zone key). Per-DO SQLite tables: `meta` (version counter), `zone_object` (id, type, x, y, owner_did, payload_json, created_at, updated_at), `rate` (actor_did, bucket_minute, count). GET→snapshot, `/socket`→WebSocket (broadcasts mutations), POST→optimistic-concurrency mutations (10/min rate limit, 100 total / 20 per-actor objects, owner-only enforcement). |
| **media/MediaService.ts** | Image/video upload drafts (~483 lines) with AES-GCM encrypted metadata in `media_draft` table. Methods: prepareImage, prepareVideo, uploadImage, uploadVideo, getJobStatus, agentFor. Chunked video upload to Bluesky video service. |
| **home/HomeSettingsService.ts** | D1 `home_settings` row: standard vs authored home mode for local-PDS users. Columns: `did`, `mode`, `active_home_path`, `updated_at`. Methods: get, set, requireLocalPds. |
| **sites/SiteService.ts** | Personal-site draft editing (~559 lines) + **9-stage publish pipeline**: (1) claim lock, (2) validate bundle + revision hash, (3) staging deploy + validation probe (or esbuild syntax check), (4) copy to immutable R2 release, (5) production worker deploy with persistent KV, (6) upload blobs to PDS, (7) create/swap AT record `sh.macha.netslumSite` rkey `self`, (8) atomic D1 cutover, (9) cleanup superseded releases. |
| **sites/CloudflareProvisioner.ts** | Thin Cloudflare REST API client for Workers-for-Platforms dispatch namespaces: `putDispatchScript`, `deleteDispatchScript`, `getOrCreateKvNamespace`. |

### Wrangler bindings (wrangler.jsonc)

| Binding | Type | What |
|---|---|---|
| `ASSETS` | Assets | `../lynx/dist` — serves the built Lynx bundle |
| `DB` | D1 | `netslum` database, migrations in `migrations/` |
| `SITE_FILES` | R2 | `netslum-sites` bucket — draft + release file storage |
| `ZONES` | Durable Object | `ZoneRoom` class (SQLite-backed) |
| `STAGING_DISPATCHER` | Dispatch namespace | `netslum-sites-staging`, outbound → egress (used by publish pipeline for staging deploy) |
| `SITE_RUNTIME` | Service binding | `netslum-site-runtime` worker |

Secrets (in `.dev.vars`, not in wrangler): `OAUTH_STORE_KEY`,
`OAUTH_CLIENT_PRIVATE_JWK`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`PRIVATE_DATA_KEY`, `PDS_HOSTNAME`, `SITE_ADMIN_DIDS`.

### Auth model (how login works)

Cookie `__Host-netslum` (HttpOnly, SameSite=Lax, 7 days) + `__Host-netslum-csrf`
(JS-readable). Mutations also check `Origin == PUBLIC_URL` and `X-CSRF-Token`
header. If the session's `scope_version < OAUTH_SCOPE_VERSION` or the grant is
missing → 403 `REAUTHORIZE_REQUIRED`.

## workers/site-runtime — tenant site infrastructure (3 Workers)

Three Cloudflare Workers deployed from one directory, forming the tenant-site
plane. Each has its own `wrangler.*.jsonc` config and deploys independently.

### assets.ts → `netslum-site-assets` (wrangler.assets.jsonc)

**Routes `*.sites.netslum.macha.sh/*`.** Serves published and preview site
files from R2 (~240 lines). Bindings: `DB` (D1), `SITE_FILES` (R2),
`SITE_RUNTIME` (service binding to `netslum-site-runtime`). Three serving paths:

1. **Preview origin** (`preview-site-….sites.<domain>`): two-step auth —
   `?cap=<token>` → SHA-256 lookup in `preview_capability` table → 302 redirect
   setting an HttpOnly cookie, then subsequent requests use cookie auth. Serves
   from `draft/{siteId}/{revision}/{path}` in R2. `Cache-Control: no-store`,
   CSP `sandbox allow-scripts; frame-ancestors https://netslum.macha.sh` plus
   the server-controlled site content security policy. HTML rewritten via
   `@netslum/sandbox` with `apiBase: null` (no runtime API for previews).

2. **Tenant origin** (`<slug>.sites.<domain>`): slug → active site row →
   serves from `release/{siteId}/{revision}/{path}`, 60s cache
   (`Cache-Control: public,max-age=60`), CSP `sandbox allow-scripts
   allow-same-origin` + `frame-ancestors https://netslum.macha.sh`.
   `/api/*` forwards to the runtime worker. `apiBase` = `${origin}/api` if the
   site has an active worker, else null.

3. **Phase-1 release** (`/release/{siteId}/{revision}/{path}` on workers.dev):
   immutable 1-year cache (`max-age=31536000,immutable`), CORS
   `Access-Control-Allow-Origin: *`.

Also serves pinned HTMX at `/_netslum/htmx-1.9.12.min.js` (SHA-256 verified
at runtime against a compiled constant).

### dispatcher.ts → `netslum-site-runtime` (wrangler.runtime.jsonc)

**Dispatches per-tenant `_worker.js` via Workers for Platforms** (~65 lines).
Bindings: `DB` (D1), `PRODUCTION_DISPATCHER` (dispatch namespace
`netslum-sites-production`, outbound → `netslum-site-egress`), `SITE_RATE`
(ratelimit: 100/60s). Route pattern: `/{site-[a-f0-9]{24}}/api/*`. Flow:

1. CORS preflight → 204
2. 503 if no dispatcher binding
3. Rate limit (100/min per machine via `SITE_RATE`) → 429
4. `lookupSite` matches `sha256(did)` prefix → active site
5. 1 MiB body cap → 413
6. Strips ambient headers: `cookie`, `origin`, `referer`, `sec-*`,
   `x-forwarded-*`, `proxy-authorization`, `x-netslum-*`
7. Sets `X-Netslum-Site-Id`
8. `PRODUCTION_DISPATCHER.get(worker).fetch(...)` with limits (`cpuMs:50`,
   `subRequests:10`)
9. 502 on failure/oversize; strips hop-by-hop, adds CORS `*`

Note: `apps/web` has a separate `STAGING_DISPATCHER` binding (namespace
`netslum-sites-staging`) used only during the publish pipeline's staging deploy
step. The production dispatcher here is a distinct binding.

### egress.ts → `netslum-site-egress` (wrangler.egress.jsonc)

**SSRF chokepoint for all tenant outbound fetch** (~50 lines). The dispatch
namespace's outbound service. Minimal config, no bindings. Blocks:
- `macha.sh`, `workers.dev`, `localhost`, `local`, `internal` suffixes
- IPv6 loopback/link-local/ULA, IPv4 private/loopback/link-local/multicast
- Non-HTTPS

Follows up to 5 redirects (re-checking each), strips `Authorization` on
cross-origin redirect. Returns `EGRESS_DENIED` 403 or `REDIRECT_LIMIT` 508.

## Shared packages & infra

### packages/contracts (`@netslum/contracts`)

**The single source of truth for all schemas, error codes, and the AT Protocol
lexicon.** Both `apps/web` and `apps/lynx` depend on this. Key files:

| File | Contents |
|---|---|
| `errors.ts` | `errorCodes` (const array of 23 codes), `ErrorCode` type, `NetslumError` class (code/message/status/retryable/data), `ToolResult<T>` type |
| `sites.ts` | Site schemas: `slugSchema`, `sitePathSchema` (blocks `.env`, `*.pem`, etc.), `validateSiteBundle` (1–64 files, `index.html` required, `_worker.js` ≤256KB, ≤5MB total), `siteRevision(files)` (canonical JSON digest), `saveSiteFileSchema`, `publishSiteSchema` |
| `social.ts` | Phase-1 ATProto primitives: `atUriSchema`, `cidSchema`, `preparePostSchema`, `publishPostSchema`, `reactionSchema` (like/unlike/repost/unrepost), `deterministicPostRkey`, `deterministicReactionRkey` |
| `zones.ts` | Chaos Gate vocabulary: `zonePrefixes` (6) × `zonePlaces` (7) × `zoneStates` (7), `palette` (8 colors), `featuredZones` (6), `experienceSchema`, object schemas (note/sigil/portal), `zoneMutationSchema` (optimistic concurrency), `zoneSeed` (SHA-256 visual seed) |
| `phase2.ts` | Phase-2 contract surface (~334 lines): `LOCAL_PDS_SUFFIX` (`.pds.netslum.macha.sh`), `normalizeActorInput`/`presentHandle`, `capabilitiesSchema`, profile/post V2/feed/search/notification/graph/media/DM/home/district/trustedAction schemas, `tenantToolManifestSchema` (≤8 tools, bounded JSON-schema input) |
| `index.ts` | Barrel: `export *` from all the above |

**"Phase 2"** refers to the second product surface: local PDS identity, social
graph, DMs, media uploads, districts, trusted actions, and tenant WebMCP tools.
Phase 1 was zones + basic feed.

**Lexicon & generated code** (`lexicons/` + `generated/`):
- `lexicons/sh/macha/netslumSite.json` — ATProto lexicon for
  `sh.macha.netslumSite` (record type, rkey literal `self`): published-site
  record with slug, revision, files array, publishedAt.
- `generated/` — **DO NOT MODIFY** — auto-generated ATProto client:
  `AtpBaseClient`, namespace chain `ShNS → ShMachaNS → ShMachaNetslumSiteRecord`
  with list/get/create/put/delete for `sh.macha.netslumSite`. Additional files:
  `lexicons.ts`, `util.ts`, `types/sh/macha/netslumSite.ts`.

### packages/sandbox (`@netslum/sandbox`)

**HTML rewriter applied to every served tenant page** (both preview and
published). Uses parse5 (not regex). `rewriteSiteHtml(html, opts)`:

1. **Strips**: all `<base>` elements and any author `<meta http-equiv="Content-Security-Policy">`
2. **Injects** (prepended to `<head>`):
   - Server-controlled CSP meta (`default-src 'none'`, script/style `unsafe-inline + https`, etc.)
   - `<base href>` pinned to serving origin
   - Frozen `window.__NETSLUM__` bootstrap: `{siteId, revision, apiBase, bridge}` — bridge exposes only public views (town/profile/search) and 6 `trustedAction` kinds. No session data.

### infra/tranquil (vendored PDS)

Vendored **Tranquil PDS** v0.6.6 (Rust ATProto/Bluesky PDS server). Deployed
via `render.yaml` at repo root as `netslum-pds` on Render.com:
`pds.netslum.macha.sh` + `*.pds.netslum.macha.sh`, Postgres 18, 10GB disk.
Handle subdomains get native TLS via Render wildcard cert. This is the
"local PDS" that `canPublishSite()` gates on (your DID's `#atproto_pds`
endpoint must match `PDS_URL`).

## Data model & migrations

D1 (SQLite on Cloudflare) is the primary data store, managed via numbered SQL
migrations in `apps/web/migrations/`. Run locally with `pnpm db:migrate:local`.

Note: numbering starts at `0001`, then jumps to `0017` — no `0002`–`0016`
files exist.

### Tables by migration

**`0001_initial.sql`** — creates 9 core tables:

| Table | Purpose | Key columns |
|---|---|---|
| `oauth_state` | OAuth flow state (15-min TTL) | `key_hash`, encrypted payload, `expires_at` |
| `oauth_session` | Persisted OAuth grants | `did` (PK), encrypted payload |
| `web_session` | Browser sessions (7 days) | `id_hash`, `did`, `csrf_hash`, `expires_at` |
| `post_draft` | Pending post drafts | `did` (PK), `draft_id`, `revision`, text, reply refs |
| `optimistic_post` | Published-post cache for instant feed | `draft_revision` (PK) → uri/cid/post_json, `expires_at` |
| `feed_cache` | Town feed response cache | `cache_key` (PK), `response_json`, `expires_at` |
| `site` | Site metadata | `did` (PK), `slug` (UNIQUE), `draft_revision`, `active_revision`, `active_worker`, `kv_namespace_id`, `at_uri`/`at_cid`, publishing lock, `status` (active\|suspended) |
| `site_release` | Site release history | `did` + `revision` (PK), `worker_name`, `status` (staged\|active\|superseded) |
| `site_admin_action` | Audit log for suspend/restore | did, action, timestamp |

**`0017_published_post_mapping.sql`** — adds post tracking:

| Table | Purpose |
|---|---|
| `published_post` | Maps published post URIs to local metadata |
| `published_reaction` | Tracks reactions (likes/reposts) for local posts |

**`0018_session_capabilities.sql`** — ALTERs `web_session` to add `granted_scope`,
`scope_version`, `dm_agent_enabled` columns (capabilities merged into session
rather than a separate table).

**`0019_home_settings.sql`** — creates:

| Table | Purpose | Key columns |
|---|---|---|
| `home_settings` | Home mode preference | `did`, `mode` (standard\|authored), `active_home_path`, `updated_at` |

**`0020_media_drafts.sql`** — creates:

| Table | Purpose | Key columns |
|---|---|---|
| `media_draft` | Encrypted image/video upload metadata | `draft_id` (PK), `did`, `kind`, `payload_enc`, `blob_enc`, `created_at`, `expires_at` |

**`0021_dm_drafts.sql`** — creates:

| Table | Purpose | Key columns |
|---|---|---|
| `dm_draft` | Encrypted pending DM drafts (idempotent send-once) | `revision` (PK), `did`, `payload_enc`, `created_at`, `expires_at` |

**`0022_post_draft_v2.sql`** — ALTERs `post_draft` to add `destination`,
`quote_uri`, `quote_cid`, `languages`, `media_draft_ids` columns for Phase 2
post composition.

**`0023_preview_capabilities.sql`** — creates `preview_capability` table
(SHA-256 of token, 10-min TTL). Also drops transient probe tables from `0018`.

### R2 layout (`SITE_FILES` bucket)

```
draft/{siteId}/{revision}/{path}     ← working draft files
release/{siteId}/{revision}/{path}   ← immutable published releases
_netslum/htmx-1.9.12.min.js          ← pinned HTMX (sha256 verified)
```

`siteId` = `site-` + first 24 hex chars of `sha256(did)`.

### ZoneRoom per-DO SQLite (inside Durable Object, not D1)

| Table | Purpose |
|---|---|
| `meta` | Version counter (optimistic concurrency) |
| `zone_object` | id, type (note/sigil/portal), x, y, owner_did, payload_json, created_at, updated_at |
| `rate` | Per-actor per-minute rate counters (actor_did, bucket_minute, count) |

## Dev loop & how to verify edits

### Setup (one-time)

```bash
nix develop                          # Node 24, pnpm 11.24, wrangler 4.127
pnpm install --frozen-lockfile
pnpm setup:local                     # writes .dev.vars (gitignored, 0600)
pnpm db:migrate:local                # runs D1 migrations on local SQLite
```

### Running locally

| Command | What starts | Port |
|---|---|---|
| `pnpm dev` | All 4 services below (via `scripts/dev-all.mjs`) | — |
| `pnpm dev:web` | Main Worker only | :8787 |
| `pnpm dev:assets` | Site assets worker | :8791 |
| `pnpm dev:runtime` | Site runtime dispatcher | :8792 |
| `pnpm dev:egress` | Egress blocker | :8793 |

`dev-all.mjs` builds the Lynx bundle first, then spawns 4 `wrangler dev`
processes sharing `--persist-to ../../.wrangler/state`. Kills all if one dies.

### Editing different parts

| I want to change… | Edit these files | Rebuild / verify |
|---|---|---|
| **A view's layout or behavior** | `apps/lynx/src/views/<View>.tsx` | `pnpm dev` → refresh browser. Views are pure renderers — data comes from host. |
| **What data a view receives** | `apps/lynx/src/host.ts` (in `loadRouteData` or the polling/WS sections) | Same. |
| **A new native action** (view → host → API) | (1) `App.tsx`: add to `NativeModules.NetslumHost`, (2) `host.ts`: bridge Blob module + `nativeModulesCall` handler, (3) `worker.ts`: add route | `pnpm dev` → test in browser. |
| **An API endpoint** | `apps/web/src/worker.ts` (route) + relevant service in `src/server/` | `pnpm dev:web`, hit with curl or browser. |
| **A service's logic** | `apps/web/src/server/<domain>/` | `pnpm test` runs Vitest (files like `*.test.ts` colocated). |
| **A schema or contract** | `packages/contracts/src/` | `pnpm check` (tsc + eslint). Downstream code uses Zod `.parse()`. |
| **The zone canvas** | `apps/lynx/src/scene.ts` | `pnpm test` (scene.test.ts verifies determinism). |
| **CSS / theme** | `apps/lynx/src/styles.css` | `pnpm dev` → refresh. |
| **Tenant site serving** | `workers/site-runtime/src/assets.ts` or `dispatcher.ts` | `pnpm dev:assets` / `pnpm dev:runtime`. |
| **HTML rewriting for published pages** | `packages/sandbox/src/rewriteSiteHtml.ts` | `pnpm test` (rewriteSiteHtml.test.ts). |
| **D1 schema** | Add `apps/web/migrations/NNNN_<name>.sql`, reference in service code | `pnpm db:migrate:local` then `pnpm dev`. |

### Gates before committing

```bash
pnpm check    # lexicon check, wrangler types, tsc, eslint
pnpm test     # vitest (unit + integration)
pnpm test:e2e # playwright (needs PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
```

### Deploy

```bash
env -u CLOUDFLARE_API_TOKEN nix develop -c pnpm deploy:web      # main worker
env -u CLOUDFLARE_API_TOKEN nix develop -c pnpm deploy:runtime   # site-runtime
```
