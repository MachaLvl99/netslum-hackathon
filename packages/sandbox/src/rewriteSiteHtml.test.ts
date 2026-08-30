import { describe, expect, it } from "vitest";
import { rewriteSiteHtml } from "./index.js";

const options = { baseUrl: "https://assets.example/release/site-a/rev/", siteId: "site-a", revision: "f".repeat(64), apiBase: "https://runtime.example/site-a/api" };

describe("rewriteSiteHtml", () => {
  it("repairs a document and replaces authored base and CSP", () => {
    const output = rewriteSiteHtml(`<base href="https://evil.example"><meta http-equiv="Content-Security-Policy" content="default-src *"><h1>hello</h1>`, options);
    expect(output).toContain(`<base href="${options.baseUrl}">`);
    expect(output).not.toContain("evil.example");
    expect(output).toContain("default-src 'none'");
    expect(output).toContain("Object.freeze");
    expect(output).toContain("<body><h1>hello</h1></body>");
  });

  it("escapes closing script sequences in injected data", () => {
    const output = rewriteSiteHtml("<p>safe</p>", { ...options, siteId: "</script><script>bad()</script>" });
    const head = output.slice(0, output.indexOf("</head>"));
    expect(head.match(/<script>/g)).toHaveLength(1);
    expect(head).toContain("\\u003c/script>");
  });
});
