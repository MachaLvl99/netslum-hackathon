import { describe, expect, it } from "vitest";
import { forwardedHeaders } from "./dispatcher.js";

describe("tenant dispatcher boundary", () => {
  it("drops ambient credentials and forwarding metadata", () => {
    const headers = forwardedHeaders(new Headers({
      Cookie: "app=session", Origin: "https://netslum.macha.sh", Referer: "https://netslum.macha.sh/town",
      "CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.1", "Sec-Fetch-Site": "same-origin",
      "X-Netslum-Forged": "operator", Authorization: "Bearer tenant-test", "Content-Type": "application/json"
    }));
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("origin")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer tenant-test");
    expect(headers.get("content-type")).toBe("application/json");
  });
});
