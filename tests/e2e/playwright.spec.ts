import { test, expect } from "@playwright/test";

test.describe("Netslum E2E Browser & API Suite", () => {
  test("loads the application and renders the Lynx custom element shell with Shadow DOM UI", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("netslum");

    const host = page.locator("#lynx-host");
    await expect(host).toBeAttached();

    const lynxView = page.locator("lynx-view");
    await expect(lynxView).toBeAttached();

    // Wait for the Lynx Shadow DOM element tree to render
    await page.waitForFunction(() => {
      const view = document.querySelector("lynx-view");
      return Boolean(view?.shadowRoot?.textContent?.includes("netslum"));
    });

    const text = await page.evaluate(() => document.querySelector("lynx-view")?.shadowRoot?.textContent);
    expect(text).toContain("AGENT-FIRST");
    expect(text).toContain("netslum");
  });

  test("registers WebMCP tools and executes public tool handlers", async ({ page }) => {
    await page.addInitScript(() => {
      const registered = new Map<string, unknown>();
      (window as unknown as { __mockRegisteredTools: Map<string, unknown> }).__mockRegisteredTools = registered;
      // @ts-expect-error WebMCP browser interface mock
      document.modelContext = {
        registerTool(tool: { name: string }) {
          registered.set(tool.name, tool);
        }
      };
    });

    await page.goto("/");
    await page.waitForFunction(() => {
      const tools = (window as unknown as { __mockRegisteredTools?: Map<string, unknown> }).__mockRegisteredTools;
      return Boolean(tools && tools.size >= 3);
    });

    const toolNames = await page.evaluate(() => {
      const tools = (window as unknown as { __mockRegisteredTools: Map<string, unknown> }).__mockRegisteredTools;
      return Array.from(tools.keys());
    });
    expect(toolNames).toContain("show_town_square");
    expect(toolNames).toContain("open_chaos_gate");
    expect(toolNames).toContain("show_profile");
    // Execute open_chaos_gate through WebMCP execution interface (local DO SQLite)
    const gateResult = await page.evaluate(async () => {
      const tools = (window as unknown as { __mockRegisteredTools: Map<string, { execute: (input: unknown) => Promise<{ ok: boolean; action: string; data?: { zoneKey: string; version: number } }> }> }).__mockRegisteredTools;
      const chaosGate = tools.get("open_chaos_gate");
      if (!chaosGate) throw new Error("open_chaos_gate tool not registered");
      return await chaosGate.execute({ prefix: "hidden", place: "archive", state: "echo" });
    });
    expect(gateResult.ok).toBe(true);
    expect(gateResult.action).toBe("open_chaos_gate");
    expect(gateResult.data?.zoneKey).toBe("hidden.archive.echo");
    expect(gateResult.data?.version).toBeGreaterThanOrEqual(0);
  });

  test("serves health check with strict security headers", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    const headers = res.headers();
    expect(headers["permissions-policy"]).toBe("tools=(self)");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  test("serves confidential OAuth client metadata and public JWKS", async ({ request }) => {
    const metaRes = await request.get("/oauth-client-metadata.json");
    expect(metaRes.status()).toBe(200);
    const metadata = await metaRes.json() as { client_name: string; scope: string; token_endpoint_auth_method: string };
    expect(metadata.client_name).toBe("netslum");
    expect(metadata.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(metadata.scope).toContain("atproto");
    expect(metadata.scope).toContain("sh.macha.netslumSite");

    const jwksRes = await request.get("/.well-known/jwks.json");
    expect(jwksRes.status()).toBe(200);
    const jwks = await jwksRes.json() as { keys: Array<{ kty: string; alg: string; kid: string }> };
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys[0]?.alg).toBe("ES256");
  });

  test("serves initial zone snapshot from Durable Objects SQLite", async ({ request }) => {
    const res = await request.get("/api/zones/hidden.archive.echo");
    expect(res.status()).toBe(200);
    const zone = await res.json() as { zoneKey: string; version: number; objects: unknown[] };
    expect(zone.zoneKey).toBe("hidden.archive.echo");
    expect(typeof zone.version).toBe("number");
    expect(zone.version).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(zone.objects)).toBe(true);
  });

  test("returns 404 for non-existent personal site vanity URL", async ({ request }) => {
    const res = await request.get("/@nonexistent");
    expect(res.status()).toBe(404);
  });
});
