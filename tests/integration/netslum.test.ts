import { describe, expect, it } from "vitest";
import {
  deterministicPostRkey,
  deterministicReactionRkey,
  feedQuerySchema,
  parseZoneKey,
  preparePostSchema,
  publishPostSchema,
  publishSiteSchema,
  reactionSchema,
  readSiteFileSchema,
  saveSiteFileSchema,
  deleteSiteFileSchema,
  sitePathSchema,
  siteRevision,
  slugSchema,
  validateSiteBundle,
  zoneMutationSchema,
  type SiteFile,
  type ZoneMutation
} from "../../packages/contracts/src/index.js";
import { rewriteSiteHtml, siteContentSecurityPolicy } from "../../packages/sandbox/src/index.js";
import { deniedHostname, deniedUrl } from "../../workers/site-runtime/src/egress.js";
import { forwardedHeaders } from "../../workers/site-runtime/src/dispatcher.js";

describe("E2E Integration & Security Smoke", () => {
  describe("1. Vanity and Sandboxed Iframe Rendering", () => {
    it("rewrites authored HTML with frozen __NETSLUM__ bootstrap, base URI, and strict CSP", () => {
      const rawHtml = `<!doctype html><html><head><base href="http://evil.com"><title>Author</title></head><body><h1>Hi</h1></body></html>`;
      const baseUrl = "https://netslum-site-assets.workers.dev/release/site-123/rev-abc/";
      const rewritten = rewriteSiteHtml(rawHtml, {
        baseUrl,
        siteId: "site-123",
        revision: "rev-abc",
        apiBase: "https://netslum-site-runtime.workers.dev/site-123/api"
      });

      expect(rewritten).toContain(`<base href="${baseUrl}">`);
      expect(rewritten).not.toContain("evil.com");
      expect(rewritten).toContain("default-src 'none'");
      expect(rewritten).toContain("Object.freeze");
      expect(rewritten).toContain('"apiBase":"https://netslum-site-runtime.workers.dev/site-123/api"');
    });

    it("generates correct CSP matching the spec", () => {
      const csp = siteContentSecurityPolicy("https://assets.example.com/site/");
      expect(csp).toBe(
        "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: blob:; connect-src https:; frame-src https:; form-action 'none'; object-src 'none'; base-uri https://assets.example.com"
      );
    });

    it("enforces vanity slug regex pattern", () => {
      expect(slugSchema.safeParse("alice").success).toBe(true);
      expect(slugSchema.safeParse("bob-123").success).toBe(true);
      expect(slugSchema.safeParse("-invalid").success).toBe(false);
      expect(slugSchema.safeParse("invalid-").success).toBe(false);
      expect(slugSchema.safeParse("CAPS").success).toBe(false);
      expect(slugSchema.safeParse("a".repeat(64)).success).toBe(false);
    });
  });

  describe("2. Personal Site Bundle & CAS Lifecycle", () => {
    const html: SiteFile = { path: "index.html", mimeType: "text/html", size: 100, sha256: "0".repeat(64) };
    const css: SiteFile = { path: "style.css", mimeType: "text/css", size: 50, sha256: "1".repeat(64) };
    const worker: SiteFile = { path: "_worker.js", mimeType: "application/javascript", size: 200, sha256: "2".repeat(64) };

    it("computes deterministic revision regardless of file order", async () => {
      const rev1 = await siteRevision([html, css, worker]);
      const rev2 = await siteRevision([worker, html, css]);
      expect(rev1).toBe(rev2);
    });

    it("rejects invalid site bundles", () => {
      expect(() => validateSiteBundle([])).toThrow();
      expect(() => validateSiteBundle([css, worker])).toThrow(/index\.html is required/);
      expect(() => validateSiteBundle([html, html])).toThrow(/Duplicate site path/);
    });

    it("forbids sensitive and credential file names", () => {
      expect(sitePathSchema.safeParse(".env").success).toBe(false);
      expect(sitePathSchema.safeParse("config/.env.local").success).toBe(false);
      expect(sitePathSchema.safeParse("keys/id_rsa").success).toBe(false);
      expect(sitePathSchema.safeParse("secret.pem").success).toBe(false);
      expect(sitePathSchema.safeParse("app/main.js").success).toBe(true);
    });
  });

  describe("3. Chaos Gate Zones & Determinism", () => {
    it("validates canonical 3-word zone keys", () => {
      expect(parseZoneKey("hidden.archive.echo")).toBe("hidden.archive.echo");
      expect(() => parseZoneKey("invalid.archive.echo")).toThrow();
      expect(() => parseZoneKey("hidden.archive.echo.extra")).toThrow();
    });

    it("validates full zone mutation operation types", () => {
      const batch: ZoneMutation = {
        expectedVersion: 5,
        operations: [
          { op: "place", object: { type: "note", x: 10, y: 20, text: "note" } },
          { op: "place", object: { type: "sigil", x: 30, y: 40, shape: "wave", color: "mint" } },
          { op: "place", object: { type: "portal", x: 50, y: 60, targetZoneKey: "electric.cathedral.dawn" } },
          { op: "move", id: "00000000-0000-0000-0000-000000000001", x: 15, y: 25 },
          { op: "edit", id: "00000000-0000-0000-0000-000000000001", value: { text: "edited" } },
          { op: "delete", id: "00000000-0000-0000-0000-000000000001" }
        ]
      };
      expect(zoneMutationSchema.safeParse(batch).success).toBe(true);
    });
  });

  describe("4. Deterministic AT Protocol Records", () => {
    it("derives deterministic post rkeys from draft revisions", () => {
      const rev = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      expect(deterministicPostRkey(rev)).toBe("netslum-abcdef0123456789abcdef01");
    });

    it("derives deterministic reaction rkeys", async () => {
      const rkey = await deterministicReactionRkey("did:plc:alice", "like", "at://did:plc:bob/app.bsky.feed.post/123");
      expect(rkey).toMatch(/^netslum-[a-f0-9]{24}$/);
    });
  });

  describe("5. Tenant Dispatcher & Outbound Egress Isolation", () => {
    it("strips cookies, origin, platform headers, and forged headers before tenant execution", () => {
      const inbound = new Headers({
        Cookie: "session=123",
        Origin: "https://netslum.macha.sh",
        Referer: "https://netslum.macha.sh/town",
        "CF-Connecting-IP": "1.2.3.4",
        "X-Forwarded-For": "1.2.3.4",
        "Sec-Fetch-Mode": "cors",
        "X-Netslum-Forged": "did:plc:admin",
        Authorization: "Bearer tenant-token",
        "Content-Type": "application/json"
      });
      const forwarded = forwardedHeaders(inbound);
      expect(forwarded.get("cookie")).toBeNull();
      expect(forwarded.get("origin")).toBeNull();
      expect(forwarded.get("referer")).toBeNull();
      expect(forwarded.get("cf-connecting-ip")).toBeNull();
      expect(forwarded.get("x-forwarded-for")).toBeNull();
      expect(forwarded.get("sec-fetch-mode")).toBeNull();
      expect(forwarded.get("x-netslum-forged")).toBeNull();
      expect(forwarded.get("authorization")).toBe("Bearer tenant-token");
      expect(forwarded.get("content-type")).toBe("application/json");
    });

    it("blocks SSRF to localhost, private IP subnets, platform domains, and internal hostnames", () => {
      expect(deniedHostname("localhost")).toBe(true);
      expect(deniedHostname("sub.localhost")).toBe(true);
      expect(deniedHostname("127.0.0.1")).toBe(true);
      expect(deniedHostname("10.0.0.1")).toBe(true);
      expect(deniedHostname("172.16.0.1")).toBe(true);
      expect(deniedHostname("192.168.1.1")).toBe(true);
      expect(deniedHostname("169.254.169.254")).toBe(true);
      expect(deniedHostname("::1")).toBe(true);
      expect(deniedHostname("macha.sh")).toBe(true);
      expect(deniedHostname("pds.netslum.macha.sh")).toBe(true);
      expect(deniedHostname("netslum-site-runtime.workers.dev")).toBe(true);
      expect(deniedHostname("api.example.com")).toBe(false);

      expect(deniedUrl(new URL("https://127.0.0.1:8080/"))).toBe(true);
      expect(deniedUrl(new URL("http://api.example.com/"))).toBe(true);
      expect(deniedUrl(new URL("https://api.example.com/data"))).toBe(false);
    });
  });

  describe("6. WebMCP Schema Strictness", () => {
    it("rejects unknown properties in all tool inputs", () => {
      expect(feedQuerySchema.safeParse({ limit: 5, extra: true }).success).toBe(false);
      expect(preparePostSchema.safeParse({ text: "hi", expectedRevision: null, extra: true }).success).toBe(false);
      expect(publishPostSchema.safeParse({ draftRevision: "a".repeat(64), extra: true }).success).toBe(false);
      expect(reactionSchema.safeParse({ uri: "at://did:plc:1/app.bsky.feed.post/1", cid: "bafy123", action: "like", extra: true }).success).toBe(false);
      expect(readSiteFileSchema.safeParse({ path: "index.html", extra: true }).success).toBe(false);
      expect(saveSiteFileSchema.safeParse({ path: "index.html", content: "hello", encoding: "utf8", contentType: "text/html", expectedRevision: "a".repeat(64), extra: true }).success).toBe(false);
      expect(deleteSiteFileSchema.safeParse({ path: "file.js", expectedRevision: "a".repeat(64), extra: true }).success).toBe(false);
      expect(publishSiteSchema.safeParse({ revision: "a".repeat(64), extra: true }).success).toBe(false);
    });
  });
});
