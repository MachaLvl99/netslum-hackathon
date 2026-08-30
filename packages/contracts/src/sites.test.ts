import { describe, expect, it } from "vitest";
import { NetslumError, sitePathSchema, siteRevision, validateSiteBundle, type SiteFile } from "./index.js";

const html: SiteFile = { path: "index.html", mimeType: "text/html", size: 12, sha256: "a".repeat(64) };
const css: SiteFile = { path: "styles/site.css", mimeType: "text/css", size: 8, sha256: "b".repeat(64) };

describe("personal-site contracts", () => {
  it("hashes a bundle independently of insertion order", async () => {
    await expect(siteRevision([html, css])).resolves.toBe(await siteRevision([css, html]));
  });

  it.each(["../secret", "/index.html", "a//b", "a\\b", ".env", "keys/id_ed25519"])("rejects unsafe path %s", (path) => {
    expect(sitePathSchema.safeParse(path).success).toBe(false);
  });

  it("rejects duplicate and missing entry documents", () => {
    expect(() => validateSiteBundle([html, html])).toThrowError(NetslumError);
    expect(() => validateSiteBundle([css])).toThrowError(/index\.html is required/);
  });

  it("rejects aggregate size above five MiB", () => {
    const files: SiteFile[] = [html, ...Array.from({ length: 11 }, (_, index) => ({ path: `asset-${index}.bin`, mimeType: "application/octet-stream", size: 524_288, sha256: String(index).padStart(64, "0") }))];
    expect(() => validateSiteBundle(files)).toThrowError(/5 MiB/);
  });
});
