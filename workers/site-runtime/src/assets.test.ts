import { describe, expect, it } from "vitest";
import { sha256Hex } from "@netslum/contracts";
import assetsHandler, { type AssetEnv } from "./assets.js";

function createMockEnv(overrides: {
  sites?: Array<{ did: string; slug: string; active_revision: string; active_worker: string | null; status: string }>;
  previewCaps?: Array<{ capability_hash: string; did: string; revision: string; created_at: number; expires_at: number }>;
  r2Objects?: Record<string, { body: string; mimeType: string; sha256?: string }>;
  runtimeFetcher?: (req: Request) => Promise<Response>;
} = {}): AssetEnv {
  const sites = overrides.sites ?? [];
  const previewCaps = overrides.previewCaps ?? [];
  const r2Objects = overrides.r2Objects ?? {};

  const mockDb = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first<T>(): Promise<T | null> {
              if (query.includes("FROM preview_capability")) {
                const [capHash, now] = args as [string, number];
                const found = previewCaps.find(
                  (c) => c.capability_hash === capHash && c.expires_at > now
                );
                return Promise.resolve((found ? { ...found } : null) as T | null);
              }
              if (query.includes("FROM site WHERE slug=?")) {
                const [slug] = args as [string];
                const found = sites.find((s) => s.slug === slug && s.status === "active");
                return Promise.resolve((found ? { ...found } : null) as T | null);
              }
              return Promise.resolve(null);
            },
            all<T>(): Promise<{ results: T[] }> {
              if (query.includes("FROM site WHERE status='active' AND active_revision=?")) {
                const [rev] = args as [string];
                const found = sites.filter((s) => s.active_revision === rev && s.status === "active");
                return Promise.resolve({ results: found as T[] });
              }
              return Promise.resolve({ results: [] });
            }
          };
        }
      };
    }
  } as unknown as D1Database;

  const mockR2 = {
    get(key: string) {
      const obj = r2Objects[key];
      if (!obj) return null;
      const bytes = new TextEncoder().encode(obj.body);
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        size: bytes.byteLength,
        httpEtag: '"mock-etag"',
        customMetadata: {
          mimeType: obj.mimeType,
          sha256: obj.sha256,
        },
        text() {
          return Promise.resolve(obj.body);
        },
        arrayBuffer() {
          return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        },
      };
    },
  } as unknown as R2Bucket;

  const mockFetcher = overrides.runtimeFetcher
    ? ({ fetch: overrides.runtimeFetcher } as unknown as Fetcher)
    : undefined;

  return {
    DB: mockDb,
    SITE_FILES: mockR2,
    SITE_RUNTIME_ORIGIN: "https://runtime.internal",
    SITE_RUNTIME: mockFetcher,
  };
}

describe("Tenant origin routing", () => {
  const aliceDid = "did:plc:alice123";
  let aliceSiteId: string;

  it("initializes siteId", async () => {
    aliceSiteId = `site-${(await sha256Hex(aliceDid)).slice(0, 24)}`;
    expect(aliceSiteId).toMatch(/^site-[a-f0-9]{24}$/);
  });

  it("forwards /api/ requests to SITE_RUNTIME with X-Netslum-Site-Id", async () => {
    let forwardedUrl = "";
    let forwardedSiteIdHeader: string | null = null;
    let forwardedMethod = "";

    const env = createMockEnv({
      sites: [{
        did: aliceDid,
        slug: "alice",
        active_revision: "rev1",
        active_worker: "alice-worker",
        status: "active",
      }],
      runtimeFetcher: (req) => {
        forwardedUrl = req.url;
        forwardedSiteIdHeader = req.headers.get("X-Netslum-Site-Id");
        forwardedMethod = req.method;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      },
    });

    const request = new Request("https://alice.sites.netslum.macha.sh/api/fragments/town?limit=5", {
      method: "POST",
      headers: {
        Host: "alice.sites.netslum.macha.sh",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(200);
    expect(forwardedMethod).toBe("POST");
    expect(forwardedSiteIdHeader).toBe(aliceSiteId);
    expect(forwardedUrl).toBe(`https://runtime.internal/${aliceSiteId}/api/fragments/town?limit=5`);
  });

  it("serves HTML with sandbox allow-scripts allow-same-origin and frame-ancestors on tenant origin", async () => {
    const htmlContent = "<!doctype html><html><head><title>Alice</title></head><body>Hello</body></html>";
    const env = createMockEnv({
      sites: [{
        did: aliceDid,
        slug: "alice",
        active_revision: "rev1",
        active_worker: "alice-worker",
        status: "active",
      }],
      r2Objects: {
        [`release/${aliceSiteId}/rev1/index.html`]: {
          body: htmlContent,
          mimeType: "text/html",
        },
      },
    });

    const request = new Request("https://alice.sites.netslum.macha.sh/", {
      headers: { Host: "alice.sites.netslum.macha.sh" },
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts allow-same-origin");
    expect(csp).toContain("frame-ancestors https://netslum.macha.sh");

    const body = await response.text();
    expect(body).toContain("__NETSLUM__");
    expect(body).toContain("https://alice.sites.netslum.macha.sh/api");
  });

  it("serves pinned HTMX with hash verification", async () => {
    const htmxContent = "console.log('htmx');";
    const env = createMockEnv({
      sites: [{
        did: aliceDid,
        slug: "alice",
        active_revision: "rev1",
        active_worker: null,
        status: "active",
      }],
      r2Objects: {
        "_netslum/htmx-1.9.12.min.js": {
          body: htmxContent,
          mimeType: "text/javascript",
        },
      },
    });

    // Request against real HTMX SHA
    const request = new Request("https://alice.sites.netslum.macha.sh/_netslum/htmx-1.9.12.min.js", {
      headers: { Host: "alice.sites.netslum.macha.sh" },
    });

    // Since mock body has a different hash than real HTMX_SHA256, it should reject with 503
    const failResponse = await assetsHandler.fetch(request, env);
    expect(failResponse.status).toBe(503);
  });
});

describe("Preview origin routing and capability exchange", () => {
  const aliceDid = "did:plc:alice123";
  let aliceSiteId: string;

  it("handles ?cap=<token> capability exchange and redirects with Set-Cookie", async () => {
    aliceSiteId = `site-${(await sha256Hex(aliceDid)).slice(0, 24)}`;
    const capToken = "test-token-1234567890abcdef12345678";
    const capHash = await sha256Hex(capToken);

    const env = createMockEnv({
      previewCaps: [{
        capability_hash: capHash,
        did: aliceDid,
        revision: "draft-rev-1",
        created_at: Date.now(),
        expires_at: Date.now() + 600_000,
      }],
    });

    const request = new Request(`https://preview-${aliceSiteId}.sites.netslum.macha.sh/?cap=${capToken}`, {
      headers: { Host: `preview-${aliceSiteId}.sites.netslum.macha.sh` },
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`https://preview-${aliceSiteId}.sites.netslum.macha.sh/`);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`__Host-netslum-preview=${capToken}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("rejects expired or invalid ?cap token", async () => {
    aliceSiteId = `site-${(await sha256Hex(aliceDid)).slice(0, 24)}`;
    const env = createMockEnv({
      previewCaps: [],
    });

    const request = new Request(`https://preview-${aliceSiteId}.sites.netslum.macha.sh/?cap=invalid-token`, {
      headers: { Host: `preview-${aliceSiteId}.sites.netslum.macha.sh` },
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(403);
  });

  it("authenticates subsequent requests via cookie and serves draft files with sandbox allow-scripts (no allow-same-origin)", async () => {
    aliceSiteId = `site-${(await sha256Hex(aliceDid)).slice(0, 24)}`;
    const capToken = "valid-cookie-token-abc";
    const capHash = await sha256Hex(capToken);
    const draftHtml = "<!doctype html><html><head><title>Draft</title></head><body>Draft Preview</body></html>";

    const env = createMockEnv({
      previewCaps: [{
        capability_hash: capHash,
        did: aliceDid,
        revision: "draft-rev-99",
        created_at: Date.now(),
        expires_at: Date.now() + 600_000,
      }],
      r2Objects: {
        [`draft/${aliceSiteId}/draft-rev-99/index.html`]: {
          body: draftHtml,
          mimeType: "text/html",
        },
      },
    });

    const request = new Request(`https://preview-${aliceSiteId}.sites.netslum.macha.sh/`, {
      headers: {
        Host: `preview-${aliceSiteId}.sites.netslum.macha.sh`,
        Cookie: `__Host-netslum-preview=${capToken}`,
      },
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts;");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("frame-ancestors https://netslum.macha.sh");

    const body = await response.text();
    expect(body).toContain("__NETSLUM__");
    expect(body).toContain("Draft Preview");
  });

  it("never executes or serves draft _worker.js", async () => {
    aliceSiteId = `site-${(await sha256Hex(aliceDid)).slice(0, 24)}`;
    const capToken = "valid-cookie-token-abc";
    const capHash = await sha256Hex(capToken);

    const env = createMockEnv({
      previewCaps: [{
        capability_hash: capHash,
        did: aliceDid,
        revision: "draft-rev-99",
        created_at: Date.now(),
        expires_at: Date.now() + 600_000,
      }],
      r2Objects: {
        [`draft/${aliceSiteId}/draft-rev-99/_worker.js`]: {
          body: "export default { fetch() { return new Response('worker'); } }",
          mimeType: "application/javascript",
        },
      },
    });

    const request = new Request(`https://preview-${aliceSiteId}.sites.netslum.macha.sh/_worker.js`, {
      headers: {
        Host: `preview-${aliceSiteId}.sites.netslum.macha.sh`,
        Cookie: `__Host-netslum-preview=${capToken}`,
      },
    });

    const response = await assetsHandler.fetch(request, env);
    expect(response.status).toBe(404);
  });
});
